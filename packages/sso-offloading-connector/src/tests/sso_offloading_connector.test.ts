import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { createSsoOffloadingConnector } from '../sso_offloading_connector';
import type {
  ControlledFrame,
  ExtensionMessage,
  RequestFilter,
  WebRequestInterceptor,
} from '../types';
import { CommunicationError } from '../errors';

const mockInterceptor: WebRequestInterceptor = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: function (event: Event): boolean {
    throw new Error('Function not implemented.');
  },
};

const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: undefined,
  },
});

describe('createSsoOffloadingConnector', () => {
  let mockControlledFrame: ControlledFrame;
  let mockCreateWebRequestInterceptor: Mock;
  const extensionId = 'test-extension-id';
  const requestFilter: RequestFilter = {
    urls: ['https://sso.example.com/*'],
  };
  const onSuccess = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (mockInterceptor.addEventListener as Mock).mockClear();
    (mockInterceptor.removeEventListener as Mock).mockClear();
    chrome.runtime.lastError = undefined;
  });

  async function getStartedConnector() {
    mockSendMessage.mockImplementationOnce((_extId, message, callback) => {
      if (message.type === 'ping') {
        callback({ type: 'pong' });
      }
    });

    const connector = createSsoOffloadingConnector(
      extensionId,
      mockControlledFrame,
      requestFilter,
      onSuccess,
      onError
    );

    await connector.start();
    return connector;
  }

  beforeEach(() => {
    mockCreateWebRequestInterceptor = vi.fn().mockReturnValue(mockInterceptor);
    mockControlledFrame = {
      src: '',
      request: {
        createWebRequestInterceptor: mockCreateWebRequestInterceptor,
      },
    } as unknown as ControlledFrame;
  });

  describe('start and stop', () => {
    it('should create an interceptor and add a listener on start', async () => {
      await getStartedConnector();

      expect(mockCreateWebRequestInterceptor).toHaveBeenCalledWith({
        urlPatterns: requestFilter.urls,
        resourceTypes: ['main_frame'],
        blocking: true,
      });

      expect(mockInterceptor.addEventListener).toHaveBeenCalledWith(
        'beforerequest',
        expect.any(Function)
      );
    });

    it('should remove the listener on stop', async () => {
      const connector = await getStartedConnector();
      const listener = (mockInterceptor.addEventListener as Mock).mock
        .calls[0][1];
      console.log(listener.toString());
      connector.stop();

      expect(mockInterceptor.removeEventListener).toHaveBeenCalledWith(
        'beforerequest',
        expect.any(Function)
      );
    });

    it('should throw an error if started twice', async () => {
      const connector = await getStartedConnector();
      await expect(connector.start()).rejects.toThrow(
        'Connector is already started.'
      );
    });

    it('should handle handshake timeout and call onError', async () => {
      vi.useFakeTimers();
      const connector = createSsoOffloadingConnector(
        extensionId,
        mockControlledFrame,
        requestFilter,
        onSuccess,
        onError
      );

      const startPromise = connector.start();
      vi.runAllTimers();

      await expect(startPromise).rejects.toThrow(CommunicationError);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('timed out'),
        })
      );

      vi.useRealTimers();
    });
  });

  describe('request interception flow', () => {
    it('should intercept a request and update src on success', async () => {
      await getStartedConnector();
      const newUrl = 'https://myapp.com/callback?code=12345';
      const interceptedUrl = 'https://sso.example.com/login';
      const mockPreventDefault = vi.fn();

      const interceptorListener = (mockInterceptor.addEventListener as Mock)
        .mock.calls[0][1];

      // Set up the SSO request mock
      mockSendMessage.mockImplementation((_extId, message, callback) => {
        if (message.type === 'sso_request') {
          callback({
            type: 'success',
            redirect_url: newUrl,
          } as ExtensionMessage);
        }
      });

      interceptorListener({
        request: { url: interceptedUrl },
        preventDefault: mockPreventDefault,
      });

      expect(mockPreventDefault).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith(
        extensionId,
        { type: 'sso_request', url: interceptedUrl },
        expect.any(Function)
      );
      expect(mockControlledFrame.src).toBe(newUrl);
      expect(onSuccess).toHaveBeenCalledWith(newUrl);
      expect(onError).not.toHaveBeenCalled();
    });

    it('should intercept a request and call onError on error response', async () => {
      await getStartedConnector();
      const interceptedUrl = 'https://sso.example.com/login';
      const errorMessage = 'Authentication failed';
      const mockPreventDefault = vi.fn();

      const interceptorListener = (mockInterceptor.addEventListener as Mock)
        .mock.calls[0][1];

      // Set up the SSO request mock for an error response
      mockSendMessage.mockImplementation((_extId, message, callback) => {
        if (message.type === 'sso_request') {
          callback({
            type: 'error',
            message: errorMessage,
          } as ExtensionMessage);
        }
      });

      interceptorListener({
        request: { url: interceptedUrl },
        preventDefault: mockPreventDefault,
      });

      expect(onError).toHaveBeenCalledWith(expect.any(CommunicationError));
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          details: errorMessage,
        })
      );
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('should call onError if extension provides no response', async () => {
      await getStartedConnector();
      const interceptorListener = (mockInterceptor.addEventListener as Mock)
        .mock.calls[0][1];

      // Mock a call that provides no response to the callback
      mockSendMessage.mockImplementation((_extId, message, callback) => {
        if (message.type === 'sso_request') {
          callback(undefined);
        }
      });

      interceptorListener({
        request: { url: 'https://sso.example.com' },
        preventDefault: vi.fn(),
      });

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'The extension did not provide a response for the SSO request.',
        })
      );
    });
  });
});
