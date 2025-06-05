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
 * and delegating them to a browser extension for SSO handling using a
 * persistent communication port.
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

  private port: chrome.runtime.Port | null = null;
  private isRequestInFlight = false;
  private isStarted = false;

  private readonly handleMessageFromExtension = (
    message: ExtensionMessage
  ): void => {
    switch (message.type) {
      case 'ssoSuccess':
        if (!message?.url || typeof message.url !== 'string') {
          this.onError(
            new InvalidResponseError(
              'Received an invalid ssoSuccess message.',
              { received: message }
            )
          );
        }
        this.controlledFrame.src = message.url;
        this.onSuccess(message.url);
        break;
      case 'ssoError':
        this.onError(
          new CommunicationError(
            'The extension reported an error during SSO.',
            message.message
          )
        );
        break;
    }
    this.isRequestInFlight = false;
  };

  private readonly handlePortDisconnect = (): void => {
    if (this.isStarted) {
      this.onError(
        new CommunicationError(
          'Connection to the SSO extension was lost unexpectedly.'
        )
      );
    }
    this.port = null;
    this.isRequestInFlight = false;
    this.stop();
  };

  private readonly interceptRequestListener = (details: {
    url: string;
  }): chrome.webRequest.BlockingResponse => {
    this.handleInterceptRequest(details);
    return { cancel: true };
  };

  constructor(
    extensionId: string,
    controlledFrame: ControlledFrame,
    options: ConnectorOptions
  ) {
    if (
      !extensionId ||
      !controlledFrame ||
      !options?.requestFilter?.urls?.length
    ) {
      const reason = !extensionId
        ? 'extensionId is required'
        : !controlledFrame
          ? 'controlledFrame is required'
          : 'options.requestFilter.urls must be a non-empty array';

      throw new ConfigurationError(
        `[SSO Connector] Configuration Error: ${reason}`
      );
    }

    this.extensionId = extensionId;
    this.controlledFrame = controlledFrame;
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

  /**
   * Establishes a connection with the extension and starts listening for requests.
   * Resolves when the connection is successful, otherwise rejects.
   * @param timeoutMs The time to wait for the extension to respond to a handshake.
   */
  public async start(timeoutMs = 3000): Promise<void> {
    if (this.isStarted) {
      throw new ConfigurationError('Connector is already started.');
    }

    try {
      this.port = chrome.runtime.connect(this.extensionId);
    } catch (error) {
      throw new CommunicationError(
        `Failed to initiate connection. The extension may not be installed or enabled.`,
        { originalError: error }
      );
    }

    this.port.onMessage.addListener(this.handleMessageFromExtension);
    this.port.onDisconnect.addListener(this.handlePortDisconnect);

    // Asynchronously perform a handshake to ensure the extension is responsive.
    await new Promise<void>((resolve, reject) => {
      const handshakeTimeout = setTimeout(() => {
        reject(
          new CommunicationError(
            `Connection to extension timed out after ${timeoutMs}ms.`
          )
        );
      }, timeoutMs);

      const handleHandshake = (message: ExtensionMessage) => {
        if (message.type == 'pong') {
          clearTimeout(handshakeTimeout);
          this.port?.onMessage.removeListener(handleHandshake);
          resolve();
        }
      };

      this.port?.onMessage.addListener(handleHandshake);

      // Handle the case where the connection fails immediately.
      const initialDisconnect = () => {
        clearTimeout(handshakeTimeout);
        reject(
          new CommunicationError(
            'Failed to connect. The extension may not be installed or is misconfigured.'
          )
        );
      };
      this.port?.onDisconnect.addListener(initialDisconnect);
      this.port?.postMessage({ type: 'ping' });
    });

    this.controlledFrame.request.onBeforeRequest.addListener(
      this.interceptRequestListener,
      this.requestFilter,
      ['blocking']
    );
    this.isStarted = true;
  }

  public stop(): void {
    if (!this.isStarted) {
      console.warn('[SSO Connector] Connector is already stopped.');
      return;
    }

    this.controlledFrame.request.onBeforeRequest.removeListener(
      this.interceptRequestListener
    );

    if (this.port) {
      this.port.onMessage.removeListener(this.handleMessageFromExtension);
      this.port.onDisconnect.removeListener(this.handlePortDisconnect);
      this.port.disconnect();
      this.port = null;
    }

    this.isStarted = false;
    this.isRequestInFlight = false;
  }

  private handleInterceptRequest(details: { url: string }): void {
    if (!this.port) {
      this.onError(
        new CommunicationError(
          'Cannot handle request: not connected to extension.'
        )
      );
      return;
    }

    if (this.isRequestInFlight) {
      console.warn(
        `[SSO Connector] Ignoring parallel request to ${details.url} while another is in flight.`
      );
      return;
    }

    this.isRequestInFlight = true;
    this.port.postMessage({
      type: 'ssoRequest',
      url: details.url,
    });
  }
}
