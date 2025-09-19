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
const activeFlows = new Map<string, { tabId: number; windowId: number }>();

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

  throw new Error(
    'Window creation failed to return window or tab ID.'
  );
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
  let onTabUpdateListener: any;
  let onTabRemoveListener: any;

  const redirectPromise = new Promise<string>(
    (resolve, reject: (reason?: any) => void) => {
      onTabUpdateListener = (tabId: number, changeInfo: { url?: string }) => {
        if (
          tabId === authTabId &&
          changeInfo.url?.startsWith(expectedRedirectUrl)
        ) {
          const capturedUrl = new URL(changeInfo.url);
          // Check for standard OAuth2/OIDC error parameters in the redirect.
          // If an error is present, the flow has failed, even though it can still
          // redirect (hence the url is still passed in the error).
          if (
            capturedUrl.searchParams.has('error') ||
            capturedUrl.searchParams.has('error_code')
          ) {
            const errorMessage =
              capturedUrl.searchParams.get('error_description') ||
              capturedUrl.searchParams.get('error') ||
              'Identity Provider returned an error.';
            reject(new AuthFlowError(errorMessage, changeInfo.url));
          }
          resolve(changeInfo.url);
        }
      };

      onTabRemoveListener = (tabId: number) => {
        if (tabId === authTabId) {
          reject(new AuthFlowError('The SSO flow has been cancelled.'));
        }
      };

      chrome.tabs.onUpdated.addListener(onTabUpdateListener);
      chrome.tabs.onRemoved.addListener(onTabRemoveListener);
    }
  );

  const cleanup = () => {
    chrome.tabs.onUpdated.removeListener(onTabUpdateListener);
    chrome.tabs.onRemoved.removeListener(onTabRemoveListener);
  };

  return { redirectPromise, cleanup };
};

async function processSsoFlow(
  flowId: string,
  url: string,
  sendResponse: (response: ExtensionMessage) => void,
  senderOrigin: string
) {
  let authTabId: number | undefined;
  let cleanupListeners = () => {};

  try {
    const ssoUrl = new URL(url);
    const expectedRedirectUrl =
      ssoUrl.searchParams.get(REDIRECT_URI_PARAM) || senderOrigin;

    const authInfo = await createAuthTab(ssoUrl);

    if (!authInfo) {
      throw new Error('Failed to create a valid authentication tab.');
    }

    authTabId = authInfo.tabId;
    activeFlows.set(flowId, authInfo);

    const { redirectPromise, cleanup } = waitForAuthRedirect(
      authTabId,
      expectedRedirectUrl
    );
    // Save the cleanup function to ensure it runs in the `finally` block.
    cleanupListeners = cleanup;

    const timeoutPromise = new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new AuthFlowError('The SSO flow has timed out.')),
        SSO_FLOW_TIMEOUT_MS
      )
    );

    // Wait for either the user to finish the flow or for the timeout to occur.
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
    activeFlows.delete(flowId);
    cleanupListeners();

    if (authTabId) {
      chrome.tabs.remove(authTabId).catch(() => {});
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
    const flowId = sender.origin;
    if (flowId && activeFlows.has(flowId)) {
      const flowToCancel = activeFlows.get(flowId)!;
      // This will trigger the onRemoved listener in the running `processSsoFlow`,
      // which will cause its promise to reject and everything to clean up.
      chrome.tabs.remove(flowToCancel.tabId).catch(() => {
        // Ignore errors, tab might already be gone.
      });
      activeFlows.delete(flowId);
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

  // At this point, we know sender has an origin because `isSsoRequestValid` checks it.
  const flowId = sender.origin!;

  // Check if a flow is already active for this origin.
  if (activeFlows.has(flowId)) {
    const existingFlow = activeFlows.get(flowId)!;
    // Focus the existing window and tab.
    await chrome.windows.update(existingFlow.windowId, { focused: true });
    await chrome.tabs.update(existingFlow.tabId, { active: true });

    // Focusing on an already active flow expects the user to finish it.
    return;
  }

  // We use a keep-alive interval to prevent the service worker from becoming
  // inactive during the SSO flow.
  const keepAliveInterval = setInterval(() => {
    // This check is a safeguard. If the flow has ended for any reason
    // but the interval is still running, we clear it.
    if (!activeFlows.has(flowId)) {
      clearInterval(keepAliveInterval);
      return;
    }
    // A no-op call to a chrome API resets the service worker's inactivity timer.
    chrome.runtime.getPlatformInfo(() => {});
  }, KEEP_ALIVE_INTERVAL_MS);

  // If no flow is active, start a new one.
  // Once the flow completes (success or error), clear the interval.
  processSsoFlow(flowId, message.url, sendResponse, sender.origin!).finally(() =>
    clearInterval(keepAliveInterval)
  );
};

const initializeSsoHandler = (): void => {
  if (!chrome.runtime.onMessageExternal.hasListener(handleExternalMessage)) {
    chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
  }
};

initializeSsoHandler();

export default initializeSsoHandler;
