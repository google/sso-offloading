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

import trustedClients from './trusted_clients.json';

const REDIRECT_URI_PARAM = 'redirect_uri';
const activeFlows = new Map<
  number,
  { senderOrigin: string; windowId: number; keepAliveInterval?: any }
>();

// Timeout for the entire SSO flow in milliseconds (2 minutes).
const SSO_FLOW_TIMEOUT_MS = 2 * 60 * 1000;
// Interval to keep the service worker alive, should be less than 30s.
const KEEP_ALIVE_INTERVAL_MS = 20 * 1000;

class AuthFlowError extends Error {
  redirect_uri?: string;

  constructor(message: string, redirect_uri?: string) {
    super(message);
    this.name = 'AuthFlowError';
    // Authorization resulting in an error can still
    // include a `redirect_uri` or `error_uri` for the final redirection
    // https://www.oauth.com/oauth2-servers/authorization/the-authorization-response/
    this.redirect_uri = redirect_uri;
  }
}

// Finds the last focused window or creates a new one for the auth flow.
const createAuthTab = async (
  url: URL
): Promise<{ tabId: number; windowId: number } | undefined> => {
  return getLastFocusedWindow(url)
    .catch(() => {
      return createNewWindow(url);
    })
    .catch((e) => {
      throw new Error('Failed to create a new tab for SSO flow. ' + e);
    });
};

const getLastFocusedWindow = async (
  url: URL
): Promise<{ tabId: number; windowId: number }> => {
  const lastFocusedWindow = await chrome.windows.getLastFocused({
    windowTypes: ['normal'],
  });

  if (!lastFocusedWindow?.id) {
    throw new Error('No last focused window found.');
  }

  const newTab = await chrome.tabs.create({
    windowId: lastFocusedWindow.id,
    url: url.toString(),
    active: true,
  });

  await chrome.windows.update(lastFocusedWindow.id, { focused: true });

  if (!newTab.id) {
    throw new Error('Tab was created but did not return an ID.');
  }

  return { tabId: newTab.id, windowId: lastFocusedWindow.id };
};

const createNewWindow = async (
  url: URL
): Promise<{ tabId: number; windowId: number }> => {
  const newWindow = await chrome.windows.create({
    url: url.toString(),
    type: 'normal',
    focused: true,
  });

  const newTabId = newWindow?.tabs?.[0]?.id;

  if (newTabId && newWindow.id) {
    return { tabId: newTabId, windowId: newWindow.id };
  }

  throw new Error('Window creation failed to return window or tab ID.');
};

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
  let onBeforeRequestListener: any;
  let onTabRemoveListener: any;

  const redirectPromise = new Promise<string>(
    (resolve, reject: (reason?: any) => void) => {
      onBeforeRequestListener = (
        details: chrome.webRequest.WebRequestDetails
      ) => {
        const capturedUrl = new URL(details.url);

        if (details.tabId === authTabId && details.type === 'main_frame') {
          // 1. Check if the navigation is to the expected redirect URL
          if (capturedUrl.toString().startsWith(expectedRedirectUrl)) {
            // **Block the navigation.**
            // This prevents the browser from actually navigating away from the IdP.
            // The flow will now complete in the extension's background script.

            // 2. Check for standard OAuth2/OIDC error parameters in the redirect.
            if (
              capturedUrl.searchParams.has('error') ||
              capturedUrl.searchParams.has('error_code')
            ) {
              const errorMessage =
                capturedUrl.searchParams.get('error_description') ||
                capturedUrl.searchParams.get('error') ||
                'Identity Provider returned an error.';

              // Note: we reject asynchronously to ensure the return for blocking is handled first
              // and the promise is not resolved/rejected multiple times.
              setTimeout(
                () => reject(new AuthFlowError(errorMessage, details.url)),
                0
              );
            } else {
              setTimeout(() => resolve(details.url), 0);
            }

            // Crucially, cancel the request to prevent navigation.
            return { cancel: true };
          }
        }
        // Allow all other requests
        return {};
      };

      onTabRemoveListener = (tabId: number) => {
        if (tabId === authTabId) {
          reject(new AuthFlowError('The SSO flow has been cancelled.'));
        }
      };

      chrome.webRequest.onBeforeRequest.addListener(
        onBeforeRequestListener,
        { tabId: authTabId, urls: ['<all_urls>'], types: ['main_frame'] },
        ['blocking']
      );

      chrome.tabs.onRemoved.addListener(onTabRemoveListener);
    }
  );

  const cleanup = () => {
    try {
      chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequestListener);
    } catch (e) {
      // Ignore error, listener might have already been removed.
    }
    chrome.tabs.onRemoved.removeListener(onTabRemoveListener);
  };

  return { redirectPromise, cleanup };
};

async function processSsoFlow(
  flowTabId: number,
  url: string,
  sendResponse: (response: ExtensionMessage) => void,
  senderOrigin: string
) {
  let cleanupListeners = () => {};

  try {
    const ssoUrl = new URL(url);
    const expectedRedirectUrl =
      ssoUrl.searchParams.get(REDIRECT_URI_PARAM) || senderOrigin;

    const { redirectPromise, cleanup } = waitForAuthRedirect(
      flowTabId,
      expectedRedirectUrl
    );
    cleanupListeners = cleanup;

    const timeoutPromise = new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new AuthFlowError('The SSO flow has timed out.')),
        SSO_FLOW_TIMEOUT_MS
      )
    ); // Wait for either the user to finish the flow or for the timeout to occur.

    const finalUrl = await Promise.race([redirectPromise, timeoutPromise]);

    sendResponse({ type: 'success', redirect_uri: finalUrl });
  } catch (error: any) {
    // If an error occurs (e.g., timeout, user cancellation), send an error response.
    sendResponse({
      type: 'error',
      message: 'Error occured during SSO flow: ' + error.message,
      redirect_uri: error?.redirect_uri,
    });
  } finally {
    const flowEntry = activeFlows.get(flowTabId);
    if (flowEntry && flowEntry.keepAliveInterval) {
      clearInterval(flowEntry.keepAliveInterval);
    }
    activeFlows.delete(flowTabId);
    cleanupListeners();

    if (flowTabId) {
      chrome.tabs.remove(flowTabId).catch(() => {});
    }
  }
}

const isSsoRequestValid = (sender: chrome.runtime.MessageSender): boolean => {
  const flowId = sender.origin;
  console.log(flowId);
  return !!flowId && flowId in trustedClients;
};

const handleExternalMessage = async (
  message: SsoRequestMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionMessage) => void
): Promise<void> => {
  if (message.type === 'stop') {
    const flowOrigin = sender.origin;
    if (flowOrigin) {
      // Iterate over all active flows and cancel any that belong to this origin.
      for (const [tabId, flow] of activeFlows.entries()) {
        if (flow.senderOrigin === flowOrigin) {
          // This triggers the onRemoved listener, leading to flow cancellation and cleanup.
          chrome.tabs.remove(tabId).catch(() => {
            // Ignore errors, tab might already be gone.
          }); // NOTE: We don't delete from activeFlows here; the finally block in processSsoFlow will.
        }
      }
    }
    return;
  }

  if (!isSsoRequestValid(sender)) {
    sendResponse({
      type: 'error',
      message: 'Request from an untrusted origin.',
    });
    return;
  }

  if (message.type === 'ping') {
    sendResponse({ type: 'pong' });
    return;
  }

  if (message.type !== 'sso_request' || !message.url) {
    sendResponse({
      type: 'error',
      message: 'Request is invalid',
    });
    return;
  }

  const flowOrigin = sender.origin!;

  let authInfo: { tabId: number; windowId: number } | undefined;
  try {
    authInfo = await createAuthTab(new URL(message.url));
  } catch (e: any) {
    sendResponse({
      type: 'error',
      message: 'Failed to open authentication tab: ' + e.message,
    });
    return;
  }

  if (!authInfo) {
    // This case should theoretically be covered by the error catch above
    // based on how createAuthTab is implemented (it throws on failure).
    sendResponse({
      type: 'error',
      message: 'Failed to create a valid authentication tab (internal error).',
    });
    return;
  }

  const keepAliveInterval = setInterval(() => {
    // Check if the flow is still active.
    if (!activeFlows.has(authInfo.tabId)) {
      clearInterval(keepAliveInterval);
      return;
    } // A no-op call to a chrome API resets the service worker's inactivity timer.
    chrome.runtime.getPlatformInfo(() => {});
  }, KEEP_ALIVE_INTERVAL_MS);

  activeFlows.set(authInfo.tabId, {
    senderOrigin: flowOrigin,
    windowId: authInfo.windowId,
    keepAliveInterval,
  });

  processSsoFlow(
    authInfo.tabId,
    message.url,
    sendResponse,
    sender.origin!
  ).finally(() =>
    // Cleanup of the interval is now handled in processSsoFlow's finally block
    // to ensure it's cleared if the tab is closed externally/times out.
    {}
  );
};

const initializeSsoHandler = (): void => {
  if (!chrome.runtime.onMessageExternal.hasListener(handleExternalMessage)) {
    chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
  }
};

initializeSsoHandler();

export default initializeSsoHandler;
