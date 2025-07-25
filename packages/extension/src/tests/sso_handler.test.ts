import {
  vi,
  type Mock,
  describe,
  it,
  expect,
  afterEach,
  beforeEach,
} from 'vitest';
import initializeSsoHandler from '../sso_handler';

// Helper function to create mock Chrome API events
const createMockChromeEvent = () => ({
  addListener: vi.fn(),
  removeListener: vi.fn(),
  hasListener: vi.fn().mockReturnValue(false),
});

const mockChrome = {
  windows: {
    create: vi.fn(),
  },
  runtime: {
    onMessageExternal: createMockChromeEvent(),
  },
  tabs: {
    remove: vi.fn(),
    onRemoved: createMockChromeEvent(),
  },
  // The webNavigation API is no longer used, it's replaced by declarativeNetRequest
  declarativeNetRequest: {
    updateDynamicRules: vi.fn(),
    onRuleMatchedDebug: createMockChromeEvent(),
  },
};

vi.stubGlobal('chrome', mockChrome);

// Mock the trusted clients list
vi.mock('../trusted_clients.json', () => ({
  default: { 'isolated-app://trusted-iwa-id': { name: 'Trusted Test IWA' } },
}));

describe('SSO Handler', () => {
  let handleExternalMessage: (
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: any) => void
  ) => boolean;
  let mockSendResponse: Mock;

  // A mock sender that should be allowed by the isSenderAllowed function
  const mockSender: chrome.runtime.MessageSender = {
    id: 'test-extension-id',
    origin: 'isolated-app://trusted-iwa-id',
  };

  beforeEach(() => {
    // We need to reset the listener mock before each test to get a clean state
    (mockChrome.runtime.onMessageExternal.addListener as Mock).mockClear();
    initializeSsoHandler();
    handleExternalMessage = (
      mockChrome.runtime.onMessageExternal.addListener as Mock
    ).mock.calls[0][0];
    mockSendResponse = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization and Authorization', () => {
    it('should add the onMessageExternal listener when initialized', () => {
      expect(
        mockChrome.runtime.onMessageExternal.addListener
      ).toHaveBeenCalledOnce();
    });

    it('should reject messages from a sender without an ID', async () => {
      const untrustedSender = { origin: 'isolated-app://trusted-iwa-id' }; // No ID
      handleExternalMessage(
        { type: 'sso_request', url: 'http://a.com?redirect_uri=b' },
        untrustedSender,
        mockSendResponse
      );
      await vi.runAllTimersAsync();

      expect(mockSendResponse).toHaveBeenCalledWith({
        type: 'ssoError',
       message:'Sender not allowed.' ,
      });
    });

    it('should respond to a "ping" from a trusted origin', async () => {
      handleExternalMessage({ type: 'ping' }, mockSender, mockSendResponse);
      await vi.runAllTimersAsync();
      expect(mockSendResponse).toHaveBeenCalledWith({ type: 'pong' });
    });
  });

  describe('SSO Flow Logic', () => {
    it('should handle a full, successful SSO flow', async () => {
      const ssoUrl =
        'https://idp.com/auth?redirect_uri=https://client.com/callback';
      const finalUrl = 'https://client.com/callback?code=12345';
      const mockTabId = 202;
      const mockRuleId = 1; // Based on the implementation's counter

      (mockChrome.windows.create as Mock).mockResolvedValue({
        id: 101,
        tabs: [{ id: mockTabId }],
      });

      // Start the flow
      handleExternalMessage(
        { type: 'sso_request', url: ssoUrl },
        mockSender,
        mockSendResponse
      );
      await vi.runAllTimersAsync();

      // Verify a declarativeNetRequest rule was added and the auth window was created
      expect(
        mockChrome.declarativeNetRequest.updateDynamicRules
      ).toHaveBeenCalledWith({
        addRules: [
          expect.objectContaining({
            id: mockRuleId,
            action: { type: 'block' },
            condition: {
              resourceTypes: ['main_frame'],
              urlFilter: 'https://client.com/callback*',
            },
            priority: 1,
          }),
        ],
      });
      expect(mockChrome.windows.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: ssoUrl })
      );

      // Verify listeners were attached
      expect(
        mockChrome.declarativeNetRequest.onRuleMatchedDebug.addListener
      ).toHaveBeenCalledWith(expect.any(Function));
      expect(mockChrome.tabs.onRemoved.addListener).toHaveBeenCalledWith(
        expect.any(Function)
      );

      // Simulate the final redirect being intercepted by the rule
      const ruleMatchedHandler = (
        mockChrome.declarativeNetRequest.onRuleMatchedDebug.addListener as Mock
      ).mock.calls[0][0];
      ruleMatchedHandler({
        request: { url: finalUrl },
        rule: { ruleId: mockRuleId },
      });
      await vi.runAllTimersAsync();

      // Verify success message and cleanup
      expect(mockSendResponse).toHaveBeenCalledWith({
        type: 'ssoSuccess',
        payload: { url: finalUrl },
      });
      expect(mockChrome.tabs.remove).toHaveBeenCalledWith(mockTabId);
      expect(
        mockChrome.declarativeNetRequest.updateDynamicRules
      ).toHaveBeenCalledWith({
        removeRuleIds: [mockRuleId],
      });
      expect(
        mockChrome.declarativeNetRequest.onRuleMatchedDebug.removeListener
      ).toHaveBeenCalled();
    });

    it('should send an error if request URL is missing a redirect_uri', async () => {
      handleExternalMessage(
        { type: 'sso_request', url: 'https://idp.com/auth' },
        mockSender,
        mockSendResponse
      );
      await vi.runAllTimersAsync();

      expect(mockSendResponse).toHaveBeenCalledWith({
        type: 'ssoError',
        payload: {
          errorMessage: "URL must have a 'redirect_uri' parameter.",
        },
      });
      expect(mockChrome.windows.create).not.toHaveBeenCalled();
    });

    it('should send an error if the auth window fails to create', async () => {
      const creationError = new Error('Failed to create window');
      (mockChrome.windows.create as Mock).mockRejectedValue(creationError);

      handleExternalMessage(
        { type: 'sso_request', url: 'https://idp.com/auth?redirect_uri=x' },
        mockSender,
        mockSendResponse
      );
      await vi.runAllTimersAsync();

      expect(mockSendResponse).toHaveBeenCalledWith({
        type: 'ssoError',
        message:creationError.message ,
      });
    });

    it('should send a cancellation error if the auth tab is closed manually', async () => {
      const mockTabId = 202;
      (mockChrome.windows.create as Mock).mockResolvedValue({
        id: 101,
        tabs: [{ id: mockTabId }],
      });

      handleExternalMessage(
        { type: 'sso_request', url: 'https://idp.com/auth?redirect_uri=x' },
        mockSender,
        mockSendResponse
      );
      await vi.runAllTimersAsync();

      // Simulate the tab being closed by the user
      const tabRemovalHandler = (mockChrome.tabs.onRemoved.addListener as Mock)
        .mock.calls[0][0];
      await tabRemovalHandler(mockTabId);

      // Verify the cancellation message was sent
      expect(mockSendResponse).toHaveBeenCalledWith({
        type: 'ssoError',
        message: 'Authentication cancelled by user.' ,
      });

      // Verify cleanup happened
      expect(
        mockChrome.declarativeNetRequest.onRuleMatchedDebug.removeListener
      ).toHaveBeenCalledTimes(1);
      expect(mockChrome.tabs.onRemoved.removeListener).toHaveBeenCalledTimes(1);
      expect(
        mockChrome.declarativeNetRequest.updateDynamicRules
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          removeRuleIds: [expect.any(Number)],
        })
      );
    });
  });
});
