import {
  CommunicationError,
  ConfigurationError,
  InvalidResponseError,
  type SsoConnectorError,
} from './errors';
import type { ExtensionMessage, RequestFilter } from './types';

export interface SsoConnector {
  start: (timeoutMs?: number) => Promise<void>;
  stop: () => void;
}

// This interface defines the specific actions that differ between platforms
// (IWA's ControlledFrame vs. Chrome App's <webview>).
interface InterceptorImplementation {
  attach: (
    listener: (details: { url: string }) => void,
    filter: { urls: string[]; types?: string[] }
  ) => void;
  detach: (listener: (details: { url: string }) => void) => void;
  updateSrc: (url: string) => void;
}

// Core offloading logic.
const createSsoConnectorInternal = (
  extensionId: string,
  implementation: InterceptorImplementation,
  requestFilter: RequestFilter,
  onSuccess?: (url: string) => void,
  onError?: (error: SsoConnectorError) => void
): SsoConnector => {

  const finalRequestFilter = {
    ...requestFilter,
    types: requestFilter.types ?? ['main_frame'],
  };

  const handleSuccess =
    onSuccess ??
    ((url) => {
      console.log(`[SSO Connector] Successfully handled URL: ${url}`);
    });

  const handleError =
    onError ??
    ((error) => {
      console.error(
        `[SSO Connector] ${error.name}: ${error.message}`,
        error.details ?? ''
      );
    });

  let isRequestInFlight = false;
  let isStarted = false;

  const handleInterceptRequest = (details: { url: string }): void => {
    if (isRequestInFlight) {
      console.warn(
        `[SSO Connector] Ignoring parallel request to ${details.url}`
      );
      return;
    }
    isRequestInFlight = true;

    const message = { type: 'sso_request', url: details.url };
    chrome.runtime.sendMessage(
      extensionId,
      message,
      (response: ExtensionMessage) => {
        isRequestInFlight = false;

        if (chrome.runtime.lastError) {
          handleError(
            new CommunicationError('Communication error sending request.', {
              originalError: chrome.runtime.lastError,
            })
          );
          return;
        }
        if (!response) {
          handleError(
            new CommunicationError('The extension did not provide a response.')
          );
          return;
        }

        switch (response.type) {
          case 'success':
            if (typeof response.redirect_url === 'string') {
              implementation.updateSrc(response.redirect_url);
              handleSuccess(response.redirect_url);
            } else {
              handleError(
                new InvalidResponseError('Invalid success message.', {
                  received: response,
                })
              );
            }
            break;
          case 'error':
            handleError(
              new CommunicationError(
                'Extension reported an error.',
                response.message
              )
            );
            break;
          default:
            handleError(
              new InvalidResponseError('Unexpected response type.', {
                received: response,
              })
            );
            break;
        }
      }
    );
  };

  const start = async (timeoutMs = 3000): Promise<void> => {
    if (isStarted) {
      handleError(new ConfigurationError('Connector is already started.'));
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new CommunicationError(`Connection timed out after ${timeoutMs}ms.`)
        );
      }, timeoutMs);

      chrome.runtime.sendMessage(
        extensionId,
        { type: 'ping' },
        (response: ExtensionMessage) => {
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            return reject(
              new CommunicationError('Failed to connect to extension.', {
                extensionError: chrome.runtime.lastError,
              })
            );
          }
          if (response?.type === 'pong') {
            resolve();
          } else {
            reject(
              new InvalidResponseError('Invalid handshake response.', {
                received: response,
              })
            );
          }
        }
      );
    }).catch((error) => {
      handleError(error);
      throw error; 
    });

    implementation.attach(handleInterceptRequest, finalRequestFilter);

    isStarted = true;
    console.log('[SSO Connector] Connector started successfully.');
  };

  const stop = (): void => {
    if (!isStarted) {
      return;
    }
    implementation.detach(handleInterceptRequest);
    isStarted = false;
    isRequestInFlight = false;
  };

  return { start, stop };
};

// ==================================================================
// ==                 PUBLIC FUNCTIONS                     ==
// ==================================================================

/**
 * Creates an SSO connector for an Isolated Web App using a ControlledFrame.
 */
export const createSsoOffloadingConnector = (
  extensionId: string,
  controlledFrame: any, // Should be changed once ControlledFrame type is exposed via @types/chrome
  requestFilter: RequestFilter,
  onSuccess?: (url: string) => void,
  onError?: (error: SsoConnectorError) => void
): SsoConnector => {
  if (!extensionId || !controlledFrame || !requestFilter?.urls?.length) {
    throw new ConfigurationError('Invalid configuration for IWA connector.');
  }

  let interceptor: any;

  const iwaImplementation: InterceptorImplementation = {
    attach: (listener, filter) => {
      interceptor = controlledFrame.request.createWebRequestInterceptor({
        urlPatterns: filter.urls,
        resourceTypes: filter.types,
        blocking: true,
      });
      interceptor.addEventListener('beforerequest', (e: any) => {
        e.preventDefault();
        listener(e.request);
      });
    },
    detach: (listener) => {
      if (interceptor) {
        interceptor.removeEventListener('beforerequest', listener);
        interceptor = null;
      }
    },
    updateSrc: (url) => {
      controlledFrame.src = url;
    },
  };

  return createSsoConnectorInternal(
    extensionId,
    iwaImplementation,
    requestFilter,
    onSuccess,
    onError
  );
};

/**
 * Creates an SSO connector for a Chrome App using a <webview> tag.
 */
export const createSsoOffloadingConnectorForChromeApp = (
  extensionId: string,
  webview: any, // WebView HTML element.
  requestFilter: RequestFilter,
  onSuccess?: (url: string) => void,
  onError?: (error: SsoConnectorError) => void
): SsoConnector => {
  if (!extensionId || !webview || !requestFilter?.urls?.length) {
    throw new ConfigurationError(
      'Invalid configuration for Chrome App connector.'
    );
  }

  let webRequestListener:
    | ((details: { url: string }) => { cancel: boolean })
    | null = null;

  const chromeAppImplementation: InterceptorImplementation = {
    attach: (listener, filter) => {
      webRequestListener = (details: { url: string }) => {
        listener(details);
        return { cancel: true }; 
      };
      webview.request.onBeforeRequest.addListener(
        webRequestListener,
        { urls: filter.urls, types: filter.types },
        ['blocking']
      );
    },
    detach: () => {
      if (webRequestListener) {
        webview.request.onBeforeRequest.removeListener(webRequestListener);
        webRequestListener = null;
      }
    },
    updateSrc: (url) => {
      webview.src = url;
    },
  };

  return createSsoConnectorInternal(
    extensionId,
    chromeAppImplementation,
    requestFilter,
    onSuccess,
    onError
  );
};
