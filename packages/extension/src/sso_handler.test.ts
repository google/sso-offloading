import { vi, type Mock, describe, it, expect, afterEach } from 'vitest';
import SsoConnectionHandler, { initializeSsoHandler } from './sso_handler';

const createMockChromeEvent = () => ({
  addListener: vi.fn(),
  removeListener: vi.fn(),
  hasListener: vi.fn().mockReturnValue(true),
  addRules: vi.fn(),
  removeRules: vi.fn(),
  getRules: vi.fn(),
});

const mockChrome = {
  windows: {
    create: vi.fn(),
    remove: vi.fn(),
  },
  runtime: {
    connect: vi.fn(),
    lastError: undefined,
    onConnectExternal: createMockChromeEvent(),
  },
  tabs: {
    remove: vi.fn(),
    onRemoved: createMockChromeEvent(),
  },
  webRequest: {
    onBeforeRequest: createMockChromeEvent(),
  },
};

vi.stubGlobal('chrome', mockChrome);
vi.mock('./trusted_clients.json', () => ({
  default: { 'isolated-app://trusted-app': { name: 'test app' } },
}));

const createMockPort = (
  origin = 'isolated-app://trusted-app'
): chrome.runtime.Port =>
  ({
    name: 'sso-port',
    sender: { id: 'test-sender', origin } as chrome.runtime.MessageSender,
    onMessage: createMockChromeEvent(),
    onDisconnect: createMockChromeEvent(),
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    // Cast is necessary because mock isn't a true class instance.
  }) as unknown as chrome.runtime.Port;

describe('Service Worker Initialization', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should add the onConnectExternal listener on setup', () => {
    initializeSsoHandler();
    expect(
      mockChrome.runtime.onConnectExternal.addListener
    ).toHaveBeenCalledOnce();
  });

  it('should handle a new connection and attach listeners for a trusted origin', async () => {
    const mockPort = createMockPort();
    const attachListenersSpy = vi.spyOn(
      SsoConnectionHandler.prototype,
      'attachListeners'
    );

    initializeSsoHandler();
    const connectionHandler = (
      mockChrome.runtime.onConnectExternal.addListener as Mock
    ).mock.calls[0][0];

    // Simulate a connection
    await connectionHandler(mockPort);

    // Verify a new handler was created and listeners were attached
    expect(attachListenersSpy).toHaveBeenCalledOnce();
    expect(mockPort.disconnect).not.toHaveBeenCalled();
    attachListenersSpy.mockRestore();
  });

  it('should reject and disconnect connections from an untrusted origin', async () => {
    const untrustedPort = createMockPort('https://untrusted.com');

    initializeSsoHandler();
    const connectionHandler = (
      mockChrome.runtime.onConnectExternal.addListener as Mock
    ).mock.calls[0][0];

    // Simulate a connection from an untrusted source
    await expect(connectionHandler(untrustedPort)).rejects.toThrow(
      'Sender not allowed.'
    );

    expect(untrustedPort.disconnect).toHaveBeenCalledOnce();
  });
});

describe('SsoConnectionHandler', () => {
  afterEach(() => {
    vi.clearAllMocks();
    if (mockChrome.runtime) {
      mockChrome.runtime.lastError = undefined;
    }
    (mockChrome.tabs.remove as Mock).mockResolvedValue(undefined);
    (mockChrome.windows.create as Mock).mockReset();
  });

  it('should attach listeners and respond to ping', () => {
    const mockPort = createMockPort();
    const handler = new SsoConnectionHandler(mockPort);

    handler.attachListeners();

    expect(mockPort.onMessage.addListener).toHaveBeenCalledOnce();
    expect(mockPort.onDisconnect.addListener).toHaveBeenCalledOnce();

    const messageHandler = (mockPort.onMessage.addListener as Mock).mock
      .calls[0][0];
    messageHandler({ type: 'ping' });
    expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'pong' });
  });

  it('should handle a full successful SSO flow', async () => {
    const mockPort = createMockPort();
    const handler = new SsoConnectionHandler(mockPort);
    handler.attachListeners();
    const messageHandler = (mockPort.onMessage.addListener as Mock).mock
      .calls[0][0];

    const ssoUrl =
      'https://idp.com/auth?redirect_uri=https://client.com/callback';
    const finalUrl = 'https://client.com/callback?code=12345';

    (mockChrome.windows.create as Mock).mockResolvedValue({
      id: 101,
      tabs: [{ id: 202 }],
    });

    await messageHandler({ type: 'ssoRequest', payload: { url: ssoUrl } });

    expect(mockChrome.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: ssoUrl })
    );
    expect(
      mockChrome.webRequest.onBeforeRequest.addListener
    ).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ urls: ['https://client.com/callback*'] }),
      ['blocking']
    );

    const webRequestHandler = (
      mockChrome.webRequest.onBeforeRequest.addListener as Mock
    ).mock.calls[0][0];
    const blockingResponse = webRequestHandler({
      url: finalUrl,
      tabId: 202,
      type: 'main_frame',
      method: 'GET',
      frameId: 0,
      parentFrameId: -1,
      requestId: '1',
      timeStamp: Date.now(),
    });

    expect(blockingResponse).toEqual({ cancel: true });
    expect(mockPort.postMessage).toHaveBeenCalledWith({
      type: 'ssoSuccess',
      payload: { url: finalUrl },
    });
    expect(mockChrome.tabs.remove).toHaveBeenCalledWith(202);
    expect(
      mockChrome.webRequest.onBeforeRequest.removeListener
    ).toHaveBeenCalled();
  });

  it('should send an ssoError if the request URL is missing a redirect_uri', async () => {
    const mockPort = createMockPort();
    const handler = new SsoConnectionHandler(mockPort);
    handler.attachListeners();
    const messageHandler = (mockPort.onMessage.addListener as Mock).mock
      .calls[0][0];

    await messageHandler({
      type: 'ssoRequest',
      payload: { url: 'https://idp.com/auth' },
    });

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      type: 'ssoError',
      payload: {
        errorMessage: "The URL must contain a 'redirect_uri' search parameter.",
      },
    });
    expect(mockChrome.windows.create).not.toHaveBeenCalled();
  });

  it('should send an ssoError if the authentication window fails to create', async () => {
    const mockPort = createMockPort();
    const creationError = new Error('Failed to create window');
    (mockChrome.windows.create as Mock).mockRejectedValue(creationError);
    const handler = new SsoConnectionHandler(mockPort);
    handler.attachListeners();
    const messageHandler = (mockPort.onMessage.addListener as Mock).mock
      .calls[0][0];

    await messageHandler({
      type: 'ssoRequest',
      payload: { url: 'https://idp.com/auth?redirect_uri=x' },
    });

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      type: 'ssoError',
      payload: { errorMessage: creationError.message },
    });
  });

  it('should clean up listeners if the auth tab is closed manually', async () => {
    const mockPort = createMockPort();
    (mockChrome.windows.create as Mock).mockResolvedValue({
      id: 101,
      tabs: [{ id: 202 }],
    });
    const handler = new SsoConnectionHandler(mockPort);
    handler.attachListeners();
    const messageHandler = (mockPort.onMessage.addListener as Mock).mock
      .calls[0][0];

    await messageHandler({
      type: 'ssoRequest',
      payload: { url: 'https://idp.com/auth?redirect_uri=x' },
    });
    expect(
      mockChrome.webRequest.onBeforeRequest.addListener
    ).toHaveBeenCalledTimes(1);

    const tabRemovalHandler = (mockChrome.tabs.onRemoved.addListener as Mock)
      .mock.calls[0][0];
    await tabRemovalHandler(202);

    expect(
      mockChrome.webRequest.onBeforeRequest.removeListener
    ).toHaveBeenCalledTimes(1);
  });

  it('should clean up listeners if the client port disconnects', async () => {
    const mockPort = createMockPort();
    (mockChrome.windows.create as Mock).mockResolvedValue({
      id: 101,
      tabs: [{ id: 202 }],
    });
    const handler = new SsoConnectionHandler(mockPort);
    handler.attachListeners();
    const messageHandler = (mockPort.onMessage.addListener as Mock).mock
      .calls[0][0];

    await messageHandler({
      type: 'ssoRequest',
      payload: { url: 'https://idp.com/auth?redirect_uri=x' },
    });
    expect(
      mockChrome.webRequest.onBeforeRequest.addListener
    ).toHaveBeenCalledTimes(1);

    const disconnectHandler = (mockPort.onDisconnect.addListener as Mock).mock
      .calls[0][0];
    await disconnectHandler();

    expect(
      mockChrome.webRequest.onBeforeRequest.removeListener
    ).toHaveBeenCalledTimes(1);
  });
});
