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

// Finds the last focused window or creates a new one for the auth flow.
const getOrCreateAuthTab = async (
  url: URL
): Promise<{ tabId: number; windowId: number } | undefined> => {
  const lastFocusedWindow = await chrome.windows.getLastFocused({
    windowTypes: ['normal'],
  });

  if (lastFocusedWindow?.id) {
    const newTab = await chrome.tabs.create({
      windowId: lastFocusedWindow.id,
      url: url.toString(),
      active: true,
    });
    // Bring window to the front.
    await chrome.windows.update(lastFocusedWindow.id, { focused: true });

    if (newTab.id) {
      return { tabId: newTab.id, windowId: lastFocusedWindow.id };
    }
  }

  // Fallback: No suitable window was found, so create a new one.
  const newWindow = await chrome.windows.create({
    url: url.toString(),
    type: 'normal',
    focused: true,
  });

  const newTabId = newWindow?.tabs?.[0]?.id;
  if (newTabId && newWindow.id) {
    return { tabId: newTabId, windowId: newWindow.id };
  }
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

  const redirectPromise = new Promise<string>((resolve, reject) => {
    onTabUpdateListener = (tabId: number, changeInfo: { url?: string }) => {
      if (
        tabId === authTabId &&
        changeInfo.url?.startsWith(expectedRedirectUrl)
      ) {
        resolve(changeInfo.url);
      }
    };

    onTabRemoveListener = (tabId: number) => {
      if (tabId === authTabId) {
        reject(new Error('User canceled the authentication flow.'));
      }
    };

    chrome.tabs.onUpdated.addListener(onTabUpdateListener);
    chrome.tabs.onRemoved.addListener(onTabRemoveListener);
  });

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

    const authInfo = await getOrCreateAuthTab(ssoUrl);

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

    // Wait for the user to finish logging in, which resolves the promise
    // and provides the final URL.
    const capturedUrl = await redirectPromise;
    sendResponse({ type: 'success', redirect_url: capturedUrl });
  } catch (error: any) {
    if (error.message.includes('User canceled')) {
      sendResponse({ type: 'cancel', message: error.message });
    } else {
      sendResponse({ type: 'error', message: error.message });
    }
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

  if (!isSsoRequestValid(sender)) {
    sendResponse({
      type: 'error',
      message: 'Request from an untrusted origin.',
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

  // If no flow is active, start a new one.
  processSsoFlow(flowId, message.url, sendResponse, sender.origin!);
};

const initializeSsoHandler = (): void => {
  if (!chrome.runtime.onMessageExternal.hasListener(handleExternalMessage)) {
    chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
  }
};

initializeSsoHandler();

export default initializeSsoHandler;
