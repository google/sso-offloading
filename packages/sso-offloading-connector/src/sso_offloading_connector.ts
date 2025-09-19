/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

       https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import {
  CommunicationError,
  ConfigurationError,
  SsoOffloadingExtensionResponseError,
  SsoOffloadingConnectorError,
} from './errors';
import type {
  ExtensionMessage,
  RequestFilter,
  SsoRequestMessage,
} from './types';

// The public interface for the connector.
export interface SsoOffloadingConnector {
  start: (timeoutMs?: number) => Promise<void>;
  stop: () => void;
}

// The official ID of the SSO Offloading Handler extension.
const SSO_OFFLOADING_EXTENSION_ID = 'jmdcfpeebneidlbnldlhcifibpkidhkn';

/**
 * Pings the extension to ensure it's active before starting.
 */
const pingExtension = (timeoutMs: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new CommunicationError(`Connection timed out.`)),
      timeoutMs
    );

    const pingMessage: SsoRequestMessage = { type: 'ping' };
    const sendPingMessageCallback = (response: any) => {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError || response?.type !== 'pong') {
        return reject(
          new CommunicationError('Failed to connect to extension.', {
            error: chrome.runtime.lastError,
            response,
          })
        );
      }
      resolve();
    };

    chrome.runtime.sendMessage(
      SSO_OFFLOADING_EXTENSION_ID,
      pingMessage,
      sendPingMessageCallback
    );
  });
};

// Creates a request listener for an Isolated Web App's <controlledframe>.
// It returns a function that will detach the listener when called.
const createIwaRequestListener = (
  target: any,
  filter: RequestFilter,
  handleInterceptedRequest: (details: { url: string }) => void
): (() => void) => {
  const interceptor = target.request.createWebRequestInterceptor({
    urlPatterns: filter.urls,
    resourceTypes: filter.types,
    blocking: true,
  });
  const interceptingListener = (e: any) => {
    e.preventDefault();
    handleInterceptedRequest(e.request);
  };

  interceptor.addEventListener('beforerequest', interceptingListener);

  return () => {
    interceptor.removeEventListener('beforerequest', interceptingListener);
  };
};

// Creates a request listener for a Chrome App's <webview>.
const createChromeAppRequestListener = (
  target: any,
  filter: RequestFilter,
  handleInterceptedRequest: (details: { url: string }) => void
): (() => void) => {
  const interceptingListener = (details: { url: string }) => {
    handleInterceptedRequest(details);
    return { cancel: true };
  };

  target.request.onBeforeRequest.addListener(
    interceptingListener,
    { urls: filter.urls, types: filter.types },
    ['blocking']
  );

  return () => {
    target.request.onBeforeRequest.removeListener(interceptingListener);
  };
};

// Detects the app type and creates the appropriate request listener.
// It returns a function that will detach the listener when called.
const createRequestListener = (
  target: any,
  filter: RequestFilter,
  handleInterceptedRequest: (details: { url: string }) => void
): (() => void) => {
  // The method for intercepting requests differs between Isolated Web Apps and
  // Chrome Apps. IWAs use a `<controlledframe>` element, which provides the
  // `createWebRequestInterceptor` API. In contrast, Chrome Apps use a `<webview>`
  // element, which exposes a `webRequest`-style API (`onBeforeRequest`). This
  // function detects the available API on the provided `target` and attaches
  // the appropriate listener.

  // IWA (<controlledframe>)
  if (target?.request?.createWebRequestInterceptor) {
    return createIwaRequestListener(target, filter, handleInterceptedRequest);
  }

  // Chrome App (<webview>)
  if (target?.request?.onBeforeRequest) {
    return createChromeAppRequestListener(
      target,
      filter,
      handleInterceptedRequest
    );
  }

  throw new ConfigurationError(
    'Invalid target provided. Must be a <controlledframe> or <webview> element.'
  );
};

/**
 * Creates an SSO connector for offloading authentication to a Chrome Extension.
 */
export const createSsoOffloadingConnector = (
  target: any,
  requestFilter: RequestFilter,
  onInterceptError: (error: SsoOffloadingConnectorError) => void
): SsoOffloadingConnector => {
  if (
    !target ||
    !requestFilter?.urls?.length ||
    !onInterceptError
  ) {
    throw new ConfigurationError('Invalid connector configuration provided.');
  }

  const finalFilter = {
    ...requestFilter,
    types: requestFilter.types ?? ['main_frame'],
  };
  let isRequestInFlight = false;
  let detachListenerOnStop: (() => void) | null = null;

  const updateSource = (url: string) => {
    target.src = url;
  };

  const handleInterceptedRequest = (details: { url: string }) => {
    const message: SsoRequestMessage = {
      type: 'sso_request',
      url: details.url,
    };
    if (isRequestInFlight) {
      // If a flow is already active, send the request again. The extension's
      // handler will see an active flow and focus the existing auth tab
      // instead of creating a new one. We send this without a callback,
      // as the original request is still waiting for the final response.
      chrome.runtime.sendMessage(SSO_OFFLOADING_EXTENSION_ID, message);
      return;
    }

    isRequestInFlight = true;

    const sendMessageCallback = (response: ExtensionMessage) => {
      isRequestInFlight = false;

      if (!response) {
        return onInterceptError(
          new CommunicationError('Extension sent no response.')
        );
      }

      switch (response.type) {
        case 'success':
          updateSource(response.redirect_uri);
          break;
        case 'error':
          // If the error response includes a redirect URI, we can still navigate
          // to it to show the user the error page from the IdP.
          if (response.redirect_uri) {
            updateSource(response.redirect_uri);
          }
          onInterceptError(
            new SsoOffloadingExtensionResponseError(response.message)
          );
          break;
        default:
          onInterceptError(
            new CommunicationError(
              'Received unexpected response type from extension: ' +
                response?.type
            )
          );
      }
    };

    try {
      chrome.runtime.sendMessage(
        SSO_OFFLOADING_EXTENSION_ID,
        message,
        sendMessageCallback
      );
    } catch (e) {
      isRequestInFlight = false;
      throw e;
    }
  };

  return {
    start: async (timeoutMs = 3000) => {
      // If `detachListenerOnStop` is not null, then it was set by an already
      // active SSO offloading connector.
      if (detachListenerOnStop) {
        throw new ConfigurationError('Connector is already started.');
      }

      await pingExtension(timeoutMs);
      detachListenerOnStop = createRequestListener(
        target,
        finalFilter,
        handleInterceptedRequest
      );
    },

    stop: () => {
      if (detachListenerOnStop) {
        detachListenerOnStop();
        // Tell the extension it should stop any unfinished SSO flow for this origin.
        chrome.runtime.sendMessage(SSO_OFFLOADING_EXTENSION_ID, {
          type: 'stop',
        } as SsoRequestMessage);
        detachListenerOnStop = null;
      }
      isRequestInFlight = false;
    },
  };
};
