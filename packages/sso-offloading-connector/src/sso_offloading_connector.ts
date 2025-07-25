import {
  CommunicationError,
  ConfigurationError,
  InvalidResponseError,
  type SsoConnectorError,
} from './errors';
import type { ControlledFrame, ExtensionMessage, RequestFilter } from './types';

export interface SsoConnector {
  start: (timeoutMs?: number) => Promise<void>;
  stop: () => void;
}

export const createSsoOffloadingConnector = (
  extensionId: string,
  controlledFrame: ControlledFrame,
  requestFilter: RequestFilter,
  onSuccess?: (url: string) => void,
  onError?: (error: SsoConnectorError) => void
): SsoConnector => {

  console.log('[SSO Connector DEBUG] Initializing with config:', {
    extensionId,
    controlledFrame,
    requestFilter,
  });

  if (!extensionId || !controlledFrame || !requestFilter?.urls?.length) {
    const reason = !extensionId
      ? 'extensionId is required'
      : !controlledFrame
        ? 'controlledFrame is required'
        : 'requestFilter.urls must be a non-empty array';
    throw new ConfigurationError(
      `[SSO Connector] Configuration Error: ${reason}`
    );
  }

  const finalRequestFilter = {
    ...requestFilter,
    types: requestFilter.types ?? ['main_frame'],
  };
  console.log(
    '[SSO Connector DEBUG] Final request filter:',
    finalRequestFilter
  );

  const handleSuccess =
    onSuccess ??
    ((url) => {
      console.log('[SSO Connector DEBUG] Using default onSuccess handler.');
      console.log(`[SSO Connector] Successfully handled URL: ${url}`);
    });

  const handleError =
    onError ??
    ((error) => {
      console.log('[SSO Connector DEBUG] Using default onError handler.');
      console.error(
        `[SSO Connector] ${error.name}: ${error.message}`,
        error.details ?? ''
      );
    });

  let isRequestInFlight = false;
  let isStarted = false;
  let interceptor: any;

  const handleInterceptRequest = (details: { url: string }): void => {
    console.log(`[SSO Connector DEBUG] Intercepted request to: ${details.url}`);

    if (isRequestInFlight) {
      console.warn(
        `[SSO Connector] Ignoring parallel request to ${details.url} while another is in flight.`
      );
      return;
    }

    isRequestInFlight = true;
    console.log('[SSO Connector DEBUG] Set isRequestInFlight to true.');

    const message = { type: 'sso_request', url: details.url };
    console.log(
      `[SSO Connector DEBUG] Sending message to extension "${extensionId}":`,
      message
    );

    chrome.runtime.sendMessage(
      extensionId,
      message,
      (response: ExtensionMessage) => {
        console.log(
          '[SSO Connector DEBUG] Received response from extension:',
          response
        );
        isRequestInFlight = false;
        console.log('[SSO Connector DEBUG] Set isRequestInFlight to false.');

        if (chrome.runtime.lastError) {
          console.error(
            '[SSO Connector DEBUG] chrome.runtime.lastError found:',
            chrome.runtime.lastError
          );
          handleError(
            new CommunicationError(
              'A communication error occurred while sending the SSO request.',
              { originalError: chrome.runtime.lastError }
            )
          );
          return;
        }

        if (!response) {
          console.error(
            '[SSO Connector DEBUG] Response was empty or undefined.'
          );
          handleError(
            new CommunicationError(
              'The extension did not provide a response for the SSO request.'
            )
          );
          return;
        }

        switch (response.type) {
          case 'success':
            console.log('[SSO Connector DEBUG] Handling "success" response.');
            if (
              !response?.redirect_url ||
              typeof response.redirect_url !== 'string'
            ) {
              console.error(
                '[SSO Connector DEBUG] Invalid success response received:',
                response
              );
              handleError(
                new InvalidResponseError(
                  'Received an invalid success message.',
                  { received: response }
                )
              );
            } else {
              console.log(
                `[SSO Connector DEBUG] Setting controlledFrame.src to: ${response.redirect_url}`
              );
              controlledFrame.src = response.redirect_url;
              handleSuccess(response.redirect_url);
            }
            break;
          case 'error':
            console.warn('[SSO Connector DEBUG] Handling "error" response.');
            handleError(
              new CommunicationError(
                'The extension reported an error during SSO.',
                response.message
              )
            );
            break;
          default:
            console.error(
              `[SSO Connector DEBUG] Received unknown response type: "${response.type}"`,
              response
            );
            handleError(
              new InvalidResponseError(
                'Received an unexpected response type from the extension.',
                { received: response }
              )
            );
            break;
        }
      }
    );
  };

  const start = async (timeoutMs = 3000): Promise<void> => {
    console.log('[SSO Connector DEBUG] start() called.');
    if (isStarted) {
      console.warn(
        '[SSO Connector DEBUG] start() called but connector is already running.'
      );
      const error = new ConfigurationError('Connector is already started.');
      handleError(error);
    }

    if (!chrome?.runtime?.sendMessage) {
      const error = new ConfigurationError(
        'SSO Connector cannot start: chrome.runtime.sendMessage is not available...'
      );
      handleError(error);
    }

    await new Promise<void>((resolve, reject) => {
      console.log(
        `[SSO Connector DEBUG] Pinging extension with a ${timeoutMs}ms timeout.`
      );
      const timeoutId = setTimeout(() => {
        console.error('[SSO Connector DEBUG] Ping timed out.');
        reject(
          new CommunicationError(
            `Connection to extension timed out after ${timeoutMs}ms.`
          )
        );
      }, timeoutMs);

      chrome.runtime.sendMessage(
        extensionId,
        { type: 'ping' },
        (response: ExtensionMessage) => {
          clearTimeout(timeoutId);
          console.log(
            '[SSO Connector DEBUG] Received ping response:',
            response
          );

          if (chrome.runtime.lastError) {
            console.error(
              '[SSO Connector DEBUG] chrome.runtime.lastError on ping:',
              chrome.runtime.lastError
            );
            return reject(
              new CommunicationError(
                'Failed to connect. The extension may not be installed or enabled.',
                { extensionError: chrome.runtime.lastError }
              )
            );
          }
          if (response?.type === 'pong') {
            console.log(
              '[SSO Connector DEBUG] Handshake successful (ping/pong).'
            );
            resolve();
          } else {
            console.error(
              '[SSO Connector DEBUG] Invalid handshake response:',
              response
            );
            reject(
              new InvalidResponseError(
                'Received an invalid handshake response from the extension.',
                { received: response }
              )
            );
          }
        }
      );
    }).catch((error) => {
      handleError(error);
    });

    console.log('[SSO Connector DEBUG] Creating WebRequest interceptor.');
    interceptor = controlledFrame.request.createWebRequestInterceptor({
      urlPatterns: finalRequestFilter.urls,
      resourceTypes: finalRequestFilter.types,
      blocking: true,
    });

    interceptor.addEventListener('beforerequest', (e: any) => {
      e.preventDefault();
      handleInterceptRequest(e.request);
    });

    isStarted = true;
    console.log('[SSO Connector] Connector started successfully.');
  };

  const stop = (): void => {
    console.log('[SSO Connector DEBUG] stop() called with state:', {
      isStarted,
      isRequestInFlight,
    });
    if (!isStarted) {
      console.log(
        '[SSO Connector DEBUG] stop() called but connector was not running.'
      );
      return;
    }
    interceptor.removeEventListener('beforerequest', handleInterceptRequest);
    interceptor = null;
    isStarted = false;
    isRequestInFlight = false;
    console.log('[SSO Connector] Connector stopped and state has been reset.');
  };

  return { start, stop };
};
