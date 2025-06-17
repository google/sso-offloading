import {
  InvalidRequestError,
  TabCreationError,
  UnauthorizedConnectionError,
} from './errors';
import trustedClientsList from './trusted_clients.json';

type WebRequestHandler = (
  details: chrome.webRequest.OnBeforeRequestDetails
) => chrome.webRequest.BlockingResponse | undefined;

const REDIRECT_URI_PARAM = 'redirect_uri';

/**
 * Manages the entire lifecycle of a single connection from a client application.
 */
class SsoConnectionHandler {
  private readonly port: chrome.runtime.Port;
  private webRequestHandler: WebRequestHandler | null = null;
  private authTabId: number | null = null;

  constructor(port: chrome.runtime.Port) {
    this.port = port;
    console.log(
      '[SSO Extension] Connection established with sender:',
      this.port.sender
    );
  }

  /**
   * Attaches the necessary listeners to the port for message handling and cleanup.
   */
  public attachListeners(): void {
    this.port.onMessage.addListener(this.handleMessage);
    this.port.onDisconnect.addListener(this.cleanup);
  }

  /**
   * Routes incoming messages to the appropriate handler.
   */
  private handleMessage = async (message: ExtensionMessage): Promise<void> => {
    if (message.type === 'ping') {
      this.port.postMessage({ type: 'pong' } as PongMessage);
      return;
    }

    if (message.type === 'ssoRequest') {
      await this.runSsoFlow(message);
    }
  };

  /**
   * Executes the main Single Sign-On flow.
   */
  private async runSsoFlow(message: SsoRequestMessage): Promise<void> {
    try {
      await this.cleanup(); // Ensure a clean state before starting a new flow.

      const ssoUrl = new URL(message.payload.url);
      const redirectUrl = ssoUrl.searchParams.get(REDIRECT_URI_PARAM);

      if (!redirectUrl) {
        throw new InvalidRequestError(
          `The URL must contain a '${REDIRECT_URI_PARAM}' search parameter.`
        );
      }

      this.registerRedirectInterceptor(redirectUrl);
      await this.createAuthTab(ssoUrl.toString());
    } catch (error: any) {
      console.error('[SSO Extension] Error handling ssoRequest:', error);
      this.port.postMessage({
        type: 'ssoError',
        payload: { errorMessage: error.message },
      } as SsoErrorMessage);
      this.cleanup();
    }
  }

  /**
   * Creates the webRequest listener to intercept the final redirect.
   */
  private registerRedirectInterceptor(redirectUrl: string): void {
    this.webRequestHandler = (
      details: chrome.webRequest.OnBeforeRequestDetails
    ) => {
      console.log('[SSO Extension] Intercepted redirect:', details.url);
      this.port.postMessage({
        type: 'ssoSuccess',
        payload: { url: details.url },
      } as SsoSuccessMessage);
      this.cleanup();
      return { cancel: true };
    };

    chrome.webRequest.onBeforeRequest.addListener(
      this.webRequestHandler,
      { types: ['main_frame'], urls: [`${redirectUrl}*`] },
      ['blocking']
    );
  }

  /**
   * Creates a new focused popup window for the authentication process.
   */
  private async createAuthTab(url: string): Promise<void> {
    const win = await chrome.windows.create({
      url,
      type: 'popup',
      focused: true,
    });
    const tab = win.tabs?.[0];

    if (tab?.id === undefined) {
      throw new TabCreationError(
        'Failed to create an authentication tab with a valid ID.'
      );
    }

    this.authTabId = tab.id;
    chrome.tabs.onRemoved.addListener(this.handleTabRemoval);
  }

  /**
   * A specific listener to trigger cleanup if the auth tab is closed manually.
   */
  private handleTabRemoval = (removedTabId: number): void => {
    if (removedTabId === this.authTabId) {
      this.cleanup();
    }
  };

  /**
   * Removes all listeners and closes any open resources for this connection.
   */
  private cleanup = (): void => {
    console.log(
      '[SSO Extension] Cleaning up resources for port:',
      this.port.sender?.id
    );

    if (
      this.webRequestHandler &&
      chrome.webRequest.onBeforeRequest.hasListener(this.webRequestHandler)
    ) {
      chrome.webRequest.onBeforeRequest.removeListener(this.webRequestHandler);
    }
    if (chrome.tabs.onRemoved.hasListener(this.handleTabRemoval)) {
      chrome.tabs.onRemoved.removeListener(this.handleTabRemoval);
    }

    this.webRequestHandler = null;

    if (this.authTabId !== null) {
      const tabIdToClose = this.authTabId;
      this.authTabId = null; // Clear immediately to prevent re-entry
      chrome.tabs.remove(tabIdToClose).catch(() => {
        // Ignore errors if the tab is already gone.
      });
    }
  };
}

async function isSenderAllowed(
  sender: chrome.runtime.MessageSender
): Promise<boolean> {
  const prefix = 'isolated-app://';
  if (!sender.origin?.startsWith(prefix)) {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(
    trustedClientsList,
    sender.origin!
  );
}

/**
 * Handles a new connection from a single connector instance by creating a class instance.
 */
async function handleNewConnection(port: chrome.runtime.Port): Promise<void> {
  if (!port.sender || !(await isSenderAllowed(port.sender!))) {
    port.disconnect();
    throw new UnauthorizedConnectionError('Sender not allowed.');
  }
  new SsoConnectionHandler(port).attachListeners();
}

/**
 * Sets up the main listener for incoming connections from external applications.
 */
export async function initializeSsoHandler(): Promise<void> {
  chrome.runtime.onConnectExternal.addListener(handleNewConnection);
}
