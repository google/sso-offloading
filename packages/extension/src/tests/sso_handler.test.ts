import {
  vi,
  type Mock,
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest'


const createMockChromeEvent = () => ({
  addListener: vi.fn(),
  removeListener: vi.fn(),
  hasListener: vi.fn().mockReturnValue(false),
})

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
}
vi.stubGlobal('chrome', mockChrome)

vi.mock('../trusted_clients.json', () => ({
  default: {
    'https://trusted.app.com': {}, 
  },
}))

describe('SSO Handler', () => {
  let handleExternalMessage: (
    message: SsoRequestMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionMessage) => void
  ) => boolean
  let mockSendResponse: Mock

  const trustedSender: chrome.runtime.MessageSender = {
    origin: 'https://trusted.app.com',
  }
  const ssoUrl = 'https://idp.com/auth?redirect_uri=https://client.com/callback'

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Dynamically import the handler to get a fresh instance with mocks applied
    const module = await import('../sso_handler')
    module.default() // This is initializeSsoHandler()

    // Get the dynamically added listener function
    handleExternalMessage = (
      mockChrome.runtime.onMessageExternal.addListener as Mock
    ).mock.calls[0][0]
    mockSendResponse = vi.fn()
  })

  it('should initialize correctly and respond to ping requests', () => {
    expect(
      mockChrome.runtime.onMessageExternal.addListener
    ).toHaveBeenCalledTimes(2)

    handleExternalMessage({ type: 'ping' }, trustedSender, mockSendResponse)
    expect(mockSendResponse).toHaveBeenCalledWith({ type: 'pong' })
  })

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
    )
    expect(mockSendResponse).toHaveBeenCalledWith({
      type: 'error',
      message: 'Request is invalid or a flow is already in progress.',
    })
  })

  it('should handle a successful SSO flow from start to finish', async () => {
    const mockTabId = 101
    ;(mockChrome.windows.create as Mock).mockResolvedValue({
      tabs: [{ id: mockTabId }],
    })

    handleExternalMessage(
      { type: 'sso_request', url: ssoUrl },
      trustedSender,
      mockSendResponse
    )
    await vi.runAllTimersAsync() // Let async operations like create window complete

    // Assert that a tab was created and listeners were attached
    expect(mockChrome.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: ssoUrl })
    )
    expect(mockChrome.tabs.onUpdated.addListener).toHaveBeenCalled()
    expect(mockChrome.tabs.onRemoved.addListener).toHaveBeenCalled()

    // Simulate the user completing authentication
    const finalRedirectUrl = 'https://client.com/callback?code=123'
    const onTabUpdateListener = (mockChrome.tabs.onUpdated.addListener as Mock)
      .mock.calls[0][0]
    onTabUpdateListener(mockTabId, { url: finalRedirectUrl })
    await vi.runAllTimersAsync()

    expect(mockSendResponse).toHaveBeenCalledWith({
      type: 'success',
      redirect_url: finalRedirectUrl,
    })
    expect(mockChrome.tabs.remove).toHaveBeenCalledWith(mockTabId)
    expect(mockChrome.tabs.onUpdated.removeListener).toHaveBeenCalled()
  })

  it('should handle a user-canceled flow by closing the tab', async () => {
    const mockTabId = 202
    ;(mockChrome.windows.create as Mock).mockResolvedValue({
      tabs: [{ id: mockTabId }],
    })

    handleExternalMessage(
      { type: 'sso_request', url: ssoUrl },
      trustedSender,
      mockSendResponse
    )
    await vi.runAllTimersAsync()

    // Simulate the user closing the tab
    const onTabRemoveListener = (mockChrome.tabs.onRemoved.addListener as Mock)
      .mock.calls[0][0]
    onTabRemoveListener(mockTabId)
    await vi.runAllTimersAsync()

    // Assert the cancellation response and cleanup
    expect(mockSendResponse).toHaveBeenCalledWith({
      type: 'cancel',
      message: 'User canceled the authentication flow.',
    })
    expect(mockChrome.tabs.remove).toHaveBeenCalledWith(mockTabId)
  })

  it('should send an error if the request URL is invalid (missing redirect_uri)', async () => {
    const invalidUrl = 'https://idp.com/auth'
    handleExternalMessage(
      { type: 'sso_request', url: invalidUrl },
      trustedSender,
      mockSendResponse
    )
    await vi.runAllTimersAsync()

    expect(mockSendResponse).toHaveBeenCalledWith({
      type: 'error',
      message: "URL must have a 'redirect_uri' parameter.",
    })

    // Ensure no auth tab was created for the invalid request
    expect(mockChrome.windows.create).not.toHaveBeenCalled()
  })
})
