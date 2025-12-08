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

const REDIRECT_URI_PARAM = 'redirect_uri';
const activeFlows = new Map<
  number,
  { senderOrigin: string; windowId: number; keepAliveInterval?: any }
>();

const SSO_FLOW_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const KEEP_ALIVE_INTERVAL_MS = 20 * 1000; // 20 seconds

const DEFAULT_ALLOWED_ORIGINS = new Set<string>([
  'isolated-app://v5uvfpi6dtpf7xhj3swcaoxfmgui645rc47uib23a5jtt477yhyaaaic', // simple-iwa-example
  'chrome-extension://abaaiopbfcagdjfghfmbiifjolfnlagf', // chrome-app-example
  'isolated-app://aiv4bxauvcu3zvbu6r5yynoh4atkzqqaoeof5mwz54b4zfywcrjuoaacai', // iwa-sink
]);

class AuthFlowError extends Error {
  constructor(
    message: string,
    public redirect_uri?: string
  ) {
    super(message);
    this.name = 'AuthFlowError';
  }
}

// Attempts to create a tab in the last focused window, falling back to a new window.
const createAuthTab = async (
  url: URL
): Promise<{ tabId: number; windowId: number }> => {
  try {
    const lastFocusedWindow = await chrome.windows.getLastFocused({
      windowTypes: ['normal'],
    });
    if (!lastFocusedWindow?.id) throw new Error('No last focused window');
    const newTab = await chrome.tabs.create({
      windowId: lastFocusedWindow.id,
      url: url.toString(),
      active: true,
    });
    if (!newTab.id) throw new Error('Tab creation failed');
    await chrome.windows.update(lastFocusedWindow.id, { focused: true });
    return { tabId: newTab.id, windowId: lastFocusedWindow.id };
  } catch {
    // Fallback to creating a new window
    const newWindow = await chrome.windows.create({
      url: url.toString(),
      type: 'normal',
      focused: true,
    });

    if (!newWindow)
      throw new Error('New window creation failed (API returned undefined)');

    const newTabId = newWindow?.tabs?.[0]?.id;
    if (!newWindow.id || !newTabId)
      throw new Error('New window creation failed');
    return { tabId: newTabId, windowId: newWindow.id };
  }
};

// Monitors a tab for redirect or closure.
const waitForAuthRedirect = (
  authTabId: number,
  expectedRedirectUrl: string
) => {
  let onBeforeRequestListener: any, onTabRemoveListener: any;

  const redirectPromise = new Promise<string>((resolve, reject) => {
    onBeforeRequestListener = (
      details: chrome.webRequest.WebRequestDetails
    ) => {
      if (
        details.tabId === authTabId &&
        details.type === 'main_frame' &&
        details.url.startsWith(expectedRedirectUrl)
      ) {
        const capturedUrl = new URL(details.url);
        const hasError =
          capturedUrl.searchParams.has('error') ||
          capturedUrl.searchParams.has('error_code');
        const errorMessage =
          capturedUrl.searchParams.get('error_description') ||
          capturedUrl.searchParams.get('error') ||
          'Identity Provider error.';

        setTimeout(
          () =>
            hasError
              ? reject(new AuthFlowError(errorMessage, details.url))
              : resolve(details.url),
          0
        );
        return { cancel: true }; // Block navigation
      }
      return {};
    };

    onTabRemoveListener = (tabId: number) => {
      if (tabId === authTabId)
        reject(new AuthFlowError('The SSO flow has been cancelled.'));
    };

    chrome.webRequest.onBeforeRequest.addListener(
      onBeforeRequestListener,
      { tabId: authTabId, urls: ['<all_urls>'], types: ['main_frame'] },
      ['blocking']
    );
    chrome.tabs.onRemoved.addListener(onTabRemoveListener);
  });

  const cleanup = () => {
    if (onBeforeRequestListener)
      chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequestListener);
    if (onTabRemoveListener)
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
    const { redirectPromise, cleanup } = waitForAuthRedirect(
      flowTabId,
      new URL(url).searchParams.get(REDIRECT_URI_PARAM) || senderOrigin
    );
    cleanupListeners = cleanup;

    const timeoutPromise = new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new AuthFlowError('The SSO flow has timed out.')),
        SSO_FLOW_TIMEOUT_MS
      )
    );

    const finalUrl = await Promise.race([redirectPromise, timeoutPromise]);

    sendResponse({ type: 'success', redirect_uri: finalUrl });
  } catch (error: any) {
    sendResponse({
      type: 'error',
      message: `SSO flow error: ${error.message}`,
      redirect_uri: error?.redirect_uri,
    });
  } finally {
    const flowEntry = activeFlows.get(flowTabId);
    if (flowEntry?.keepAliveInterval)
      clearInterval(flowEntry.keepAliveInterval);
    
    activeFlows.delete(flowTabId);
    cleanupListeners();
    
    if (flowTabId) chrome.tabs.remove(flowTabId).catch(() => {});
  }
}

const getAdminAllowedApps = (): Promise<Set<string>> => {
  return chrome.storage.managed
    .get()
    .then((storageObject) => {
      const { allowedApps } = storageObject;

      if (!Array.isArray(allowedApps)) {
        return new Set();
      }

      const allowedOrigins = allowedApps
        .map((app) => app.origin)
        .filter(Boolean);

      return new Set(allowedOrigins); 
    })
    .catch((e) => {
      console.error('Error fetching allowedApps:', e);
      return new Set(); 
    });
};

const isOriginAllowed = async (
  sender: chrome.runtime.MessageSender
): Promise<boolean> => {
  const origin = sender.origin;
  if (!origin) return false;
  if (DEFAULT_ALLOWED_ORIGINS.has(origin)) return true;

return (
  getAdminAllowedApps()
    .then((adminAllowedOrigins) => {
      return adminAllowedOrigins.has(origin);
    })
    .catch((error) => {
      console.error('Error retrieving allowed origins:', error);
      return false;
    })
);
};

const handleExternalMessage = async (
  message: SsoRequestMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionMessage) => void
): Promise<void> => {
  const { origin } = sender;
  
  // 1. Guard against unallowed origins
  if (!(await isOriginAllowed(sender))) {
    return sendResponse({
      type: 'error',
      message: 'Request from an untrusted origin.',
    });
  }

  // 2. Handle 'stop' message (cleanup and early exit)
  if (message.type === 'stop') {
    if (origin) {
      activeFlows.forEach((flow, tabId) => {
        if (flow.senderOrigin === origin) {
          // Use a void return for the Promise from remove to satisfy TypeScript, 
          // and catch the rejection silently, as is currently done.
          void chrome.tabs.remove(tabId).catch(() => {});
        }
      });
    }
    return;
  }

  // 3. Handle 'ping' message (simple response and early exit)
  if (message.type === 'ping') {
    return sendResponse({ type: 'pong' });
  }

  // 4. Validate 'sso_request' structure and command type
  if (message.type !== 'sso_request' || !message.url) {
    return sendResponse({ type: 'error', message: 'Invalid or incomplete SSO request.' });
  }
  
  try {
    const authUrl = new URL(message.url);
    const authInfo = await createAuthTab(authUrl); // { tabId, windowId }

    // Start keep-alive interval
    const keepAliveInterval = setInterval(() => {
      // Clear interval if the flow is no longer active
      if (!activeFlows.has(authInfo.tabId)) {
        clearInterval(keepAliveInterval);
      } else {
        // Ping the extension to prevent idle suspension
        void chrome.runtime.getPlatformInfo(() => {});
      }
    }, KEEP_ALIVE_INTERVAL_MS);

    // Register and start the flow
    activeFlows.set(authInfo.tabId, {
      senderOrigin: origin!,
      windowId: authInfo.windowId,
      keepAliveInterval,
    });
    
    processSsoFlow(authInfo.tabId, message.url, sendResponse, origin!);
    
  } catch (e) {
    const errorMessage = (e as Error)?.message || 'An unknown error occurred.';
    
    sendResponse({
      type: 'error',
      message: `Failed to start auth flow: ${errorMessage}`,
    });
  }
};

const initializeSsoHandler = (): void => {
  if (!chrome.runtime.onMessageExternal.hasListener(handleExternalMessage)) {
    chrome.runtime.onMessageExternal.addListener(
      (message, sender, sendResponse) => {
        handleExternalMessage(message, sender, sendResponse);
        return true; // Indicate async response
      }
    );
  }
};

export default initializeSsoHandler;

