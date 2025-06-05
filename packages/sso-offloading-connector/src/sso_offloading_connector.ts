import {
  CommunicationError,
  ConfigurationError,
  InvalidResponseError,
  SsoConnectorError,
} from './errors';

export interface ConnectorOptions {
  requestFilter: {
    urls: string[];
    types?: chrome.webRequest.RequestFilter['types'];
  };
  onError?: (error: SsoConnectorError) => void;
  onSuccess?: (url: string) => void;
}

/**
 * SsoOffloadingConnector handles intercepting requests from a <webview>
 * and delegating them to a browser extension for SSO handling.
 */
export class SsoOffloadingConnector {
  private readonly extensionId: string;
  private readonly controlledFrame: ControlledFrame;
  private readonly requestFilter: {
    urls: string[];
    types: chrome.webRequest.RequestFilter['types'];
  };
  private readonly onError: (error: SsoConnectorError) => void;
  private readonly onSuccess: (url: string) => void;

  private interceptRequestListener = (details: {
    url: string;
  }): chrome.webRequest.BlockingResponse => {
    this.handleInterceptRequest(details);
    return { cancel: true };
  };

  /**
   * Initializes a new instance of the connector.
   * @param extensionId The ID of the Chrome extension to communicate with.
   * @param controlledFrame The <webview> element to monitor.
   * @param options Configuration for filtering requests.
   */
  constructor(
    extensionId: string,
    controlledFrame: ControlledFrame,
    options: ConnectorOptions
  ) {
    if (!extensionId) {
      throw new ConfigurationError('Extension ID is required.');
    }
    if (!controlledFrame) {
      throw new ConfigurationError('A controlled frame element is required.');
    }
    if (!options?.requestFilter?.urls?.length) {
      throw new ConfigurationError(
        'Request filter with at least one URL is required.'
      );
    }

    this.extensionId = extensionId;
    this.controlledFrame = controlledFrame;

    // Set up the filter with a default value for 'types'
    this.requestFilter = {
      urls: options.requestFilter.urls,
      types: options.requestFilter.types ?? ['main_frame'],
    };

    this.onError =
      options.onError ??
      ((error) =>
        console.error(
          `[SSO Connector] ${error.name}: ${error.message}`,
          error.details ?? ''
        ));
    this.onSuccess =
      options.onSuccess ??
      ((url) =>
        console.log(`[SSO Connector] Successfully handled URL: ${url}`));
  }

  public start(): void {
    console.log('[SSO Connector] Starting to listen for requests.');
    this.controlledFrame.request.onBeforeRequest.addListener(
      this.interceptRequestListener,
      this.requestFilter,
      ['blocking']
    );
  }

  public stop(): void {
    console.log('[SSO Connector] Stopping listener.');
    this.controlledFrame.request.onBeforeRequest.removeListener(
      this.interceptRequestListener
    );
  }

  private handleInterceptRequest(details: { url: string }): void {
    console.log('[SSO Connector] Intercepted request:', details.url);
    const message: ExtensionMessage = { url: details.url };

    chrome.runtime.sendMessage(
      this.extensionId,
      message,
      (response: ExtensionMessage) => {
        if (chrome.runtime.lastError) {
          this.onError(
            new CommunicationError(
              'Failed to communicate with the SSO extension.',
              chrome.runtime.lastError
            )
          );
          return;
        }
        this.handleMessageFromExtension(response);
      }
    );
  }

  private handleMessageFromExtension(message: ExtensionMessage): void {
    if (message?.url && typeof message.url === 'string') {
      console.log(
        '[SSO Connector] Received new URL from extension:',
        message.url
      );
      this.controlledFrame.src = message.url;
      this.onSuccess(message.url);
    } else {
      this.onError(
        new InvalidResponseError(
          'Received an invalid or empty response from the extension.',
          { received: message }
        )
      );
    }
  }
}
