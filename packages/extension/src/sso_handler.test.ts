import { vi, describe, it, expect, afterEach } from 'vitest';
import { initializeSsoHandler } from './sso_handler';

const mockChrome = {
  windows: {
    create: vi.fn(),
    remove: vi.fn(),
  },
  runtime: {
    connect: vi.fn().mockImplementation(() => createMockPort()),
    lastError: undefined,
    onConnectExternal: {
      addListener: vi.fn(),
    },
    onRemoved: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    remove: vi.fn().mockResolvedValue(undefined),
    onRemoved: {
      addListener: vi.fn(),
      hasListener: vi.fn(),
    },
  },
  webRequest: {
    onBeforeRequest: {
      addListener: vi.fn(),
      hasListener: vi.fn().mockReturnValue(true),
      removeListener: vi.fn(),
    },
  },
};

vi.stubGlobal('chrome', mockChrome);

const createMockPort = () => ({
  sender: { id: 'test', origin: 'isolated-app://test' },
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  onDisconnect: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  postMessage: vi.fn(),
  disconnect: vi.fn(),
});

describe('SSO Offloading Extension', () => {
  afterEach(() => {
    vi.clearAllMocks();

    mockChrome.runtime.lastError = undefined;
  });

  it('should add a listener for external connections on setup', () => {
    initializeSsoHandler();
    expect(
      mockChrome.runtime.onConnectExternal.addListener
    ).toHaveBeenCalledOnce();
  });

  it('should handle a full SSO flow successfully using a new tab', async () => {
    const mockPort = createMockPort();
    const ssoUrl =
      'https://idp.com/auth?redirect_uri=https://client.com/callback';
    const finalUrl = 'https://client.com/callback?code=12345';

    initializeSsoHandler();
    expect(chrome.runtime.onConnectExternal.addListener).toHaveBeenCalledOnce();

    mockChrome.windows.create.mockResolvedValue({
      id: 101,
      tabs: [{ id: 202 }],
    });

    // Simulate connection initialization.
    const connectionHandler =
      mockChrome.runtime.onConnectExternal.addListener.mock.calls[0][0];
    await connectionHandler(mockPort);
    expect(mockPort.onMessage.addListener).toHaveBeenCalledOnce();
    expect(mockPort.onDisconnect.addListener).toHaveBeenCalledOnce();

    // Simulate a `ping` message. The extension should answer.
    const messageHandler = mockPort.onMessage.addListener.mock.calls[0][0];
    await messageHandler({
      type: 'ping',
    });
    expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'pong' });

    // Send SSO request to intercept.
    await messageHandler({
      type: 'ssoRequest',
      payload: { url: ssoUrl },
    });
    // Verify the webRequest listener was added for the redirect URI.
    expect(
      mockChrome.webRequest.onBeforeRequest.addListener
    ).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ urls: ['https://client.com/callback*'] }),
      ['blocking']
    );

    // Extension should open a tab for SSO.
    expect(mockChrome.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: ssoUrl,
        type: 'popup',
      })
    );

    // Get the webRequest handler that was just added and call it.
    const webRequestHandler =
      mockChrome.webRequest.onBeforeRequest.addListener.mock.calls[0][0];
    const blockingResponse = webRequestHandler({ url: finalUrl, tabId: 202 });

    expect(blockingResponse).toEqual({ cancel: true });
    expect(mockPort.postMessage).toHaveBeenLastCalledWith({
      type: 'ssoSuccess',
      payload: { url: finalUrl },
    });

    // The auth tab should be closed.
    expect(mockChrome.tabs.remove).toHaveBeenCalledWith(202);
    expect(
      mockChrome.webRequest.onBeforeRequest.removeListener
    ).toHaveBeenCalled();
  });
});
