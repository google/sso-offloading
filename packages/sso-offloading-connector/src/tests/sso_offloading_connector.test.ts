import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  SsoOffloadingConnector,
  type ConnectorOptions,
} from '../sso_offloading_connector';

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn(),
    lastError: undefined,
  },
});

const mockChrome = chrome;

describe('SsoOffloadingConnector', () => {
  let mockControlledFrame: ControlledFrame;
  const extensionId = 'test-extension-id';
  const options: ConnectorOptions = {
    requestFilter: {
      urls: ['https://sso.example.com/*'],
    },
  };

  beforeEach(() => {
    mockControlledFrame = {
      src: '',
      request: {
        onBeforeRequest: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    } as ControlledFrame;

    vi.clearAllMocks();
    mockChrome.runtime.lastError = undefined;
  });

  describe('request interception flow', () => {
    it('should send a message and update src on successful extension response', () => {
      const newUrl = 'https://myapp.com/callback?code=12345';
      const interceptedUrl = 'https://sso.example.com/login';

      // Simulate a successful response from the extension
      (mockChrome.runtime.sendMessage as any).mockImplementation(
        (
          _extId: string,
          _message: ExtensionMessage,
          callback: (response: ExtensionMessage) => void
        ) => {
          callback({ url: newUrl });
        }
      );

      const connector = new SsoOffloadingConnector(
        extensionId,
        mockControlledFrame,
        options
      );
      connector.start();

      // Get the first argument that was ever passed to the `addListener` function.
      const listener =
        mockControlledFrame.request.onBeforeRequest.addListener.mock
          .calls[0][0];
      const blockingResponse = listener({ url: interceptedUrl });

      // Check that the request was cancelled
      expect(blockingResponse).toEqual({ cancel: true });

      // Check that sendMessage was called correctly
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        extensionId,
        { url: interceptedUrl },
        expect.any(Function)
      );

      // Check if controlled frame was redirected.
      expect(mockControlledFrame.src).toBe(newUrl);
    });
  });
});
