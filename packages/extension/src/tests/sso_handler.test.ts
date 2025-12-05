/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */
import {
  vi,
  type Mock,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from 'vitest';

const createMockChromeEvent = () => ({
  addListener: vi.fn(),
  removeListener: vi.fn(),
  hasListener: vi.fn().mockReturnValue(false),
});

const mockChrome = {
  windows: {
    getLastFocused: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  runtime: {
    onMessageExternal: createMockChromeEvent(),
    getPlatformInfo: vi.fn((callback) => callback()), // Mock for keepAlive
    lastError: undefined as any,
  },
  storage: {
    managed: {
      get: vi.fn(),
    },
  },
  tabs: {
    create: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    onRemoved: createMockChromeEvent(),
    onUpdated: createMockChromeEvent(),
  },
  webRequest: {
    onBeforeRequest: createMockChromeEvent(),
  },
};
vi.stubGlobal('chrome', mockChrome);

let initializeSsoHandler: () => void;
let handleExternalMessage: (
  message: SsoRequestMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionMessage) => void
) => Promise<void>;

beforeAll(async () => {
  const module = await import('../sso_handler');
  initializeSsoHandler = module.default;
});

describe('SSO Handler', () => {
  let mockSendResponse: Mock;

  const defaultAllowedSender: chrome.runtime.MessageSender = {
    origin:
      'isolated-app://v5uvfpi6dtpf7xhj3swcaoxfmgui645rc47uib23a5jtt477yhyaaaic',
  };
  const adminAllowedOrigin = 'chrome-extension://adminallowedid';
  const adminAllowedSender: chrome.runtime.MessageSender = {
    origin: adminAllowedOrigin,
  };
  const untrustedSender: chrome.runtime.MessageSender = {
    origin: 'https://untrusted.com',
  };

  const ssoUrl =
    'https://idp.com/auth?redirect_uri=https://client.com/callback';

  const mockManagedStorage = (allowedAppsArray: any[] | null) => {
    (mockChrome.storage.managed.get as Mock).mockImplementation((keys) => {
      if (mockChrome.runtime.lastError) {
        return Promise.reject(new Error(mockChrome.runtime.lastError.message));
      }
      const result = keys.includes('allowedApps')
        ? { allowedApps: allowedAppsArray || [] }
        : {};
      return Promise.resolve(result);
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockChrome.runtime.lastError = undefined;
    (mockChrome.runtime.onMessageExternal.hasListener as Mock).mockReturnValue(
      false
    );
    mockManagedStorage([]); // Default to empty array

    // Initialize the listener, but it will only add if hasListener is false
    initializeSsoHandler();

    // Re-fetch the listener function from the mock, as clearAllMocks resets calls
    if (
      (mockChrome.runtime.onMessageExternal.addListener as Mock).mock.calls
        .length > 0
    ) {
      handleExternalMessage = (
        mockChrome.runtime.onMessageExternal.addListener as Mock
      ).mock.calls[0][0];
    } else {
      // This case should not happen if hasListener is mocked correctly
      throw new Error('Listener not added, check hasListener mock');
    }
    mockSendResponse = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize correctly ONE TIME', () => {
    expect(mockChrome.runtime.onMessageExternal.hasListener).toHaveBeenCalled();
    expect(
      mockChrome.runtime.onMessageExternal.addListener
    ).toHaveBeenCalledTimes(1);
  });

  it('should respond to ping requests from a default allowed sender', async () => {
    await handleExternalMessage(
      { type: 'ping' },
      defaultAllowedSender,
      mockSendResponse
    );
    await vi.runAllTimersAsync();
    expect(mockSendResponse).toHaveBeenCalledWith({ type: 'pong' });
  });

  it('should respond to ping requests from an admin allowed sender', async () => {
    mockManagedStorage([{ origin: adminAllowedOrigin, name: 'Admin Allowed' }]);
    await handleExternalMessage(
      { type: 'ping' },
      adminAllowedSender,
      mockSendResponse
    );
    await vi.runAllTimersAsync();
    expect(mockSendResponse).toHaveBeenCalledWith({ type: 'pong' });
  });

  it.each([
    {
      scenario: 'an untrusted origin',
      sender: untrustedSender,
    },
    {
      scenario: 'a missing origin',
      sender: {},
    },
  ])('should reject requests from $scenario', async ({ sender }) => {
    await handleExternalMessage(
      { type: 'sso_request', url: ssoUrl },
      sender,
      mockSendResponse
    );
    await vi.runAllTimersAsync();
    expect(mockSendResponse).toHaveBeenCalledWith({
      type: 'error',
      message: 'Request from an untrusted origin.',
    });
  });

  it('should allow requests from DEFAULT_ALLOWED_ORIGINS even with empty managed storage', async () => {
    mockManagedStorage([]);
    await handleExternalMessage(
      { type: 'ping' },
      defaultAllowedSender,
      mockSendResponse
    );
    await vi.runAllTimersAsync();
    expect(mockSendResponse).toHaveBeenCalledWith({ type: 'pong' });
  });

  it('should allow requests from origins listed in chrome.storage.managed', async () => {
    mockManagedStorage([
      { origin: adminAllowedOrigin, name: 'Test Admin App' },
    ]);
    await handleExternalMessage(
      { type: 'ping' },
      adminAllowedSender,
      mockSendResponse
    );
    await vi.runAllTimersAsync();
    expect(mockSendResponse).toHaveBeenCalledWith({ type: 'pong' });
  });

  it('should handle failure to get managed storage gracefully', async () => {
    const storageError = new Error('Failed to get storage');
    (mockChrome.storage.managed.get as Mock).mockRejectedValue(storageError);

    // Test default allowed sender - SHOULD PASS
    await handleExternalMessage(
      { type: 'ping' },
      defaultAllowedSender,
      mockSendResponse
    );
    await vi.runAllTimersAsync();
    expect(mockSendResponse).toHaveBeenCalledWith({ type: 'pong' });
    mockSendResponse.mockClear();

    // Test non-default sender - SHOULD BE REJECTED due to storage failure
    await handleExternalMessage(
      { type: 'ping' },
      adminAllowedSender,
      mockSendResponse
    );
    await vi.runAllTimersAsync();
    expect(mockSendResponse).toHaveBeenCalledWith({
      type: 'error',
      message: 'Request from an untrusted origin.',
    });
  });

  it('should handle sso_request and open a tab for default allowed sender', async () => {
    (mockChrome.windows.getLastFocused as Mock).mockResolvedValue({ id: 1 });
    (mockChrome.tabs.create as Mock).mockResolvedValue({ id: 123 });

    await handleExternalMessage(
      { type: 'sso_request', url: ssoUrl },
      defaultAllowedSender,
      mockSendResponse
    );
    await vi.runAllTimersAsync();

    expect(mockChrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: ssoUrl })
    );
  });

  it('should handle sso_request and open a tab for admin allowed sender', async () => {
    mockManagedStorage([{ origin: adminAllowedOrigin, name: 'Admin Allowed' }]);
    (mockChrome.windows.getLastFocused as Mock).mockResolvedValue({ id: 1 });
    (mockChrome.tabs.create as Mock).mockResolvedValue({ id: 123 });

    await handleExternalMessage(
      { type: 'sso_request', url: ssoUrl },
      adminAllowedSender,
      mockSendResponse
    );
    await vi.runAllTimersAsync();

    expect(mockChrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: ssoUrl })
    );
  });

  it('should handle failure when creating an auth tab', async () => {
    (mockChrome.windows.getLastFocused as Mock).mockRejectedValue(
      new Error('No focused window')
    );
    (mockChrome.windows.create as Mock).mockRejectedValue(
      new Error('Cannot create window')
    );

    await handleExternalMessage(
      { type: 'sso_request', url: ssoUrl },
      defaultAllowedSender, // Use an allowed sender
      mockSendResponse
    );
    await vi.runAllTimersAsync();
    expect(mockSendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining(
          'Failed to start auth flow'
        ),
      })
    );
  });
});

