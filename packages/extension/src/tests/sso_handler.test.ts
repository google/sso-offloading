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
import { vi, type Mock, describe, it, expect, beforeEach } from 'vitest';

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
  },
  tabs: {
    create: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    onRemoved: createMockChromeEvent(),
    onUpdated: createMockChromeEvent(),
  },
};
vi.stubGlobal('chrome', mockChrome);

vi.mock('../trusted_clients.json', () => ({
  default: {
    'https://trusted.app.com': {},
  },
}));

describe('SSO Handler', () => {
  let handleExternalMessage: (
    message: SsoRequestMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionMessage) => void
  ) => boolean;
  let mockSendResponse: Mock;

  const trustedSender: chrome.runtime.MessageSender = {
    origin: 'https://trusted.app.com',
  };
  const ssoUrl =
    'https://idp.com/auth?redirect_uri=https://client.com/callback';

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Dynamically import the handler to get a fresh instance with mocks applied
    const module = await import('../sso_handler');
    module.default(); // This is initializeSsoHandler()

    // Get the dynamically added listener function
    handleExternalMessage = (
      mockChrome.runtime.onMessageExternal.addListener as Mock
    ).mock.calls[0][0];
    mockSendResponse = vi.fn();
  });

  it('should initialize correctly and respond to ping requests', () => {
    expect(
      mockChrome.runtime.onMessageExternal.addListener
    ).toHaveBeenCalledTimes(2);

    handleExternalMessage({ type: 'ping' }, trustedSender, mockSendResponse);
    expect(mockSendResponse).toHaveBeenCalledWith({ type: 'pong' });
  });

  it.each([
    {
      scenario: 'an untrusted origin',
      sender: { origin: 'https://untrusted.com' },
    },
    {
      scenario: 'a missing origin',
      sender: {},
    },
  ])('should reject requests from $scenario', ({ sender }) => {
    handleExternalMessage(
      { type: 'sso_request', url: ssoUrl },
      sender,
      mockSendResponse
    );
    expect(mockSendResponse).toHaveBeenCalledWith({
      type: 'error',
      message: 'Request from an untrusted origin.',
    });
  });

  it('should handle failure when creating an auth tab', async () => {
    // Simulate failure for both ways of creating a tab
    (mockChrome.windows.getLastFocused as Mock).mockRejectedValue(
      new Error('No focused window')
    );
    (mockChrome.windows.create as Mock).mockRejectedValue(
      new Error('Cannot create window')
    );

    handleExternalMessage(
      { type: 'sso_request', url: ssoUrl },
      trustedSender,
      mockSendResponse
    );

    await vi.runAllTimersAsync();

    expect(mockSendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining(
          'Error occured during SSO flow: Failed to create a new tab for SSO flow. Error: Cannot create window'
        ),
      })
    );
  });
});
