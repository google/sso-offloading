import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  SsoOffloadingConnector,
  type ConnectorOptions,
} from '../sso_offloading_connector';

const createMockPort = () => ({
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

vi.stubGlobal('chrome', {
  runtime: {
    connect: vi.fn().mockImplementation(() => createMockPort()),
    lastError: undefined,
  },
});

describe('SsoOffloadingConnector', () => {
  let mockControlledFrame: ControlledFrame;
  const extensionId = 'test-extension-id';
  const options: ConnectorOptions = {
    requestFilter: {
      urls: ['https://sso.example.com/*'],
    },
    onError: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockControlledFrame = {
      src: '',
      request: {
        onBeforeRequest: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    } as ControlledFrame;

    chrome.runtime.lastError = undefined;
    (chrome.runtime.connect as any).mockImplementation(() => createMockPort());
  });

  async function getStartedConnectorAndPort() {
    const connector = new SsoOffloadingConnector(
      extensionId,
      mockControlledFrame,
      options
    );
    const startPromise = connector.start();

    const port = (chrome.runtime.connect as any).mock.results[0].value;
    // Find the handshake listener the connector added and simulate a 'pong'.
    port.onMessage.addListener.mock.calls[1][0]({
      type: 'pong',
    });

    await startPromise;

    return { connector, port };
  }

  describe('request interception flow', () => {
    it('should connect, start, intercept a request, and update src on success', async () => {
      const { port } = await getStartedConnectorAndPort();
      const newUrl = 'https://myapp.com/callback?code=12345';
      const interceptedUrl = 'https://sso.example.com/login';

      const blockingResponse =
        mockControlledFrame.request.onBeforeRequest.addListener.mock.calls[0][0](
          { url: interceptedUrl }
        );

      //  Check that the request was cancelled and sent to the extension
      expect(blockingResponse).toEqual({ cancel: true });
      // The first postMessage was the 'ping', the second is ssoRequest
      expect(port.postMessage).toHaveBeenCalledTimes(2);
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'ssoRequest',
        url: interceptedUrl,
      } as SsoRequestMessage);

      // Simulate the extension sending a successful response
      port.onMessage.addListener.mock.calls[0][0]({
        type: 'ssoSuccess',
        url: newUrl,
      } as SsoSuccessMessage);

      expect(mockControlledFrame.src).toBe(newUrl);
      expect(options.onSuccess).toHaveBeenCalledWith(newUrl);
    });
    it('should connect, start, intercept a request, and call onError on error', async () => {
      const { port } = await getStartedConnectorAndPort();
      const interceptedUrl = 'https://sso.example.com/login';

      const blockingResponse =
        mockControlledFrame.request.onBeforeRequest.addListener.mock.calls[0][0](
          { url: interceptedUrl }
        );

      expect(blockingResponse).toEqual({ cancel: true });
      expect(port.postMessage).toHaveBeenCalledTimes(2);
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'ssoRequest',
        url: interceptedUrl,
      } as SsoRequestMessage);

      port.onMessage.addListener.mock.calls[0][0]({
        type: 'ssoError',
        message: 'Something went wrong',
      } as SsoErrorMessage);

      expect(options.onError).toHaveBeenCalled();
    });
  });
});
