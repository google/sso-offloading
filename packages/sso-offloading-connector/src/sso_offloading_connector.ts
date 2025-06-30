import {
  CommunicationError,
  ConfigurationError,
  InvalidResponseError,
  type SsoConnectorError,
} from './errors';
import type {
  ControlledFrame,
  ExtensionMessage,
  RequestFilter,
} from './types/types';

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

  const handleSuccess =
    onSuccess ??
    ((url) => console.log(`[SSO Connector] Successfully handled URL: ${url}`));

  const handleError =
    onError ??
    ((error) =>
      console.error(
        `[SSO Connector] ${error.name}: ${error.message}`,
        error.details ?? ''
      ));

  let isRequestInFlight = false;
  let isStarted = false;
  let interceptor: any;

  const handleInterceptRequest = (details: { url: string }): void => {
    if (isRequestInFlight) {
      console.warn(
        `[SSO Connector] Ignoring parallel request to ${details.url} while another is in flight.`
      );
      return;
    }

    isRequestInFlight = true;

    chrome.runtime.sendMessage(
      extensionId,
      { type: 'sso_request', url: details.url },
      (response: ExtensionMessage) => {
        isRequestInFlight = false;

        if (chrome.runtime.lastError) {
          handleError(
            new CommunicationError(
              'A communication error occurred while sending the SSO request.',
              { originalError: chrome.runtime.lastError }
            )
          );
          return;
        }

        if (!response) {
          handleError(
            new CommunicationError(
              'The extension did not provide a response for the SSO request.'
            )
          );
          return;
        }

        switch (response.type) {
          case 'success':
            if (
              !response?.redirect_url ||
              typeof response.redirect_url !== 'string'
            ) {
              handleError(
                new InvalidResponseError(
                  'Received an invalid success message.',
                  { received: response }
                )
              );
            } else {
              controlledFrame.src = response.redirect_url;
              handleSuccess(response.redirect_url);
            }
            break;
          case 'error':
            handleError(
              new CommunicationError(
                'The extension reported an error during SSO.',
                response.message
              )
            );
            break;
          default:
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
    if (isStarted) {
      throw new ConfigurationError('Connector is already started.');
    }

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
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

          if (chrome.runtime.lastError) {
            return reject(
              new CommunicationError(
                'Failed to connect. The extension may not be installed or enabled.',
                { extensionError: chrome.runtime.lastError }
              )
            );
          }
          if (response?.type === 'pong') {
            resolve();
          } else {
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
      throw error; // Re-throw to ensure the promise from start() is rejected
    });

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
  };

  const stop = (): void => {
    console.log(isStarted, isRequestInFlight);
    if (!isStarted) {
      return;
    }
    interceptor.removeEventListener('beforerequest', handleInterceptRequest);
    interceptor = null;
    isStarted = false;
    isRequestInFlight = false;
  };

  // public API
  return { start, stop };
};
