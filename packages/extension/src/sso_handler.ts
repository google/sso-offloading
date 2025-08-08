import { UserCanceledError } from './errors'
import trustedClients from './trusted_clients.json'

const REDIRECT_URI_PARAM = 'redirect_uri'
const activeFlows = new Set<string>()

/**
 * Finds the last focused window or creates a new one for the auth flow.
 * @returns The ID of the newly created tab.
 */
const getOrCreateAuthTab = async (url: URL): Promise<number | undefined> => {
  const lastFocusedWindow = await chrome.windows.getLastFocused({
    windowTypes: ['normal'],
  })

  if (lastFocusedWindow?.id) {
    const newTab = await chrome.tabs.create({
      windowId: lastFocusedWindow.id,
      url: url.toString(),
      active: true,
    })
    // Bring window to the front.
    await chrome.windows.update(lastFocusedWindow.id, { focused: true })
    return newTab.id
  }

  // Fallback: No suitable window was found, so create a new one.
  const newWindow = await chrome.windows.create({
    url: url.toString(),
    type: 'normal',
    focused: true,
  })
  return newWindow?.tabs?.[0]?.id
}

/**
 * Monitors a tab for a specific redirect URL or for the user closing the tab.
 * This function sets up listeners and returns a Promise that acts as a signal.
 * - The Promise resolves with the final URL if the user completes the flow.
 * - The Promise rejects if the user closes the auth tab, canceling the flow.
 * It also returns a `cleanup` function to remove listeners.
 */
const waitForAuthRedirect = (
  authTabId: number,
  expectedRedirectUrl: string
) => {
  let onTabUpdateListener: any
  let onTabRemoveListener: any

  const redirectPromise = new Promise<string>((resolve, reject) => {
    onTabUpdateListener = (tabId: number, changeInfo: { url?: string }) => {
      if (
        tabId === authTabId &&
        changeInfo.url?.startsWith(expectedRedirectUrl)
      ) {
        resolve(changeInfo.url)
      }
    }

    onTabRemoveListener = (tabId: number) => {
      if (tabId === authTabId) {
        reject(new UserCanceledError())
      }
    }

    chrome.tabs.onUpdated.addListener(onTabUpdateListener)
    chrome.tabs.onRemoved.addListener(onTabRemoveListener)
  })

  const cleanup = () => {
    chrome.tabs.onUpdated.removeListener(onTabUpdateListener)
    chrome.tabs.onRemoved.removeListener(onTabRemoveListener)
  }

  return { redirectPromise, cleanup }
}

/**
 * Handles the entire SSO process for a given request.
 */
async function processSsoFlow(
  flowId: string,
  url: string,
  sendResponse: (response: ExtensionMessage) => void
) {
  let authTabId: number | undefined
  let cleanupListeners = () => {}

  try {
    const ssoUrl = new URL(url)
    const expectedRedirectUrl = ssoUrl.searchParams.get(REDIRECT_URI_PARAM)
    if (!expectedRedirectUrl) {
      throw new Error(`URL must have a '${REDIRECT_URI_PARAM}' parameter.`)
    }

    authTabId = await getOrCreateAuthTab(ssoUrl)
    if (!authTabId) {
      throw new Error('Failed to create a valid authentication tab.')
    }

    const { redirectPromise, cleanup } = waitForAuthRedirect(
      authTabId,
      expectedRedirectUrl
    )
    cleanupListeners = cleanup

    const capturedUrl = await redirectPromise
    sendResponse({ type: 'success', redirect_url: capturedUrl })
  } catch (error: any) {
    if (error instanceof UserCanceledError) {
      sendResponse({ type: 'cancel', message: error.message })
    } else {
      sendResponse({ type: 'error', message: error.message })
    }
  } finally {
    activeFlows.delete(flowId)
    cleanupListeners()
    if (authTabId) {
      chrome.tabs.remove(authTabId).catch(() => {})
    }
  }
}

/**
 * Validates an incoming SSO request sender.
 */
const isRequestValid = (
  sender: chrome.runtime.MessageSender,
  activeFlows: Set<string>
): boolean => {
  const flowId = sender.origin

  // The sender must have a trusted origin and not have a flow already active.
  return !!flowId && flowId in trustedClients && !activeFlows.has(flowId)
}

const handleExternalMessage = (
  message: SsoRequestMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionMessage) => void
): boolean => {
  // Handle the simple 'ping' request.
  if (message.type === 'ping') {
    sendResponse({ type: 'pong' })
    return false
  }

  // Ignore any message that isn't a valid SSO request.
  if (message.type !== 'sso_request' || !message.url) {
    return false
  }

  if (!isRequestValid(sender, activeFlows)) {
    sendResponse({
      type: 'error',
      message: 'Request is invalid or a flow is already in progress.',
    })
    return false
  }

  const flowId = sender.origin!
  activeFlows.add(flowId)
  
  processSsoFlow(flowId, message.url, sendResponse)

  // Return true to indicate an async response will be sent.
  return true
}

const initializeSsoHandler = (): void => {
  if (!chrome.runtime.onMessageExternal.hasListener(handleExternalMessage)) {
    chrome.runtime.onMessageExternal.addListener(handleExternalMessage)
  }
}

initializeSsoHandler()

export default initializeSsoHandler
