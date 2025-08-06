
const REDIRECT_URI_PARAM = 'redirect_uri';

const activeFlows = new Set<string>();

const handleExternalMessage = (
  message: SsoRequestMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionMessage) => void
): boolean => {
  if (message.type !== 'sso_request' || !message.url) {
    if (message.type === 'ping') {
      sendResponse({ type: 'pong' });
    }
    return false;
  }
  const flowId = sender.origin;

  if (!flowId) {
    console.error('[SSO] Request rejected: Sender has no documentId.');
    sendResponse({ type: 'error', message: 'Request source is invalid.' });
    return false;
  }

  if (activeFlows.has(flowId)) {
    console.warn(
      `[SSO] Request ignored: Flow for document ${flowId} is already in progress.`
    );
    sendResponse({
      type: 'error',
      message: 'An SSO flow for this document is already in progress.',
    });
    return false;
  }

  activeFlows.add(flowId);

  (async () => {
    let authTabId: number | undefined;
    let onTabUpdateListener: any;
    let onTabRemoveListener: any;

    try {
      const ssoUrl = new URL(message.url);
      const expectedRedirectUrl = ssoUrl.searchParams.get(REDIRECT_URI_PARAM);

      if (!expectedRedirectUrl) {
        throw new Error(`URL must have a '${REDIRECT_URI_PARAM}' parameter.`);
      }

      const userInteractionPromise = new Promise<string>((resolve, reject) => {
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

      const win = await chrome.windows.create({
        url: ssoUrl.toString(),
        type: 'normal',
        focused: true,
      });
      authTabId = win?.tabs?.[0]?.id;

      if (!authTabId) {
        throw new Error('Failed to create a valid authentication tab.');
      }

      const capturedUrl = await userInteractionPromise;

      console.log('[SSO] Detected redirect URL:', capturedUrl);
      sendResponse({ type: 'success', redirect_url: capturedUrl });
    } catch (error: any) {
      console.error('[SSO] Flow failed:', error.message);
      const responseType = error.message.includes('User canceled')
        ? 'cancel'
        : 'error';
      sendResponse({ type: responseType, message: error.message });
    } finally {
      console.log(
        `[SSO] Cleaning up flow for document ${flowId} and releasing lock.`
      );
      activeFlows.delete(flowId);

      if (onTabUpdateListener)
        chrome.tabs.onUpdated.removeListener(onTabUpdateListener);
      if (onTabRemoveListener)
        chrome.tabs.onRemoved.removeListener(onTabRemoveListener);

      if (authTabId) {
        chrome.tabs.remove(authTabId).catch(() => {});
      }
    }
  })();

  // Return true to indicate that the response will be sent asynchronously.
  return true;
};

const initializeSsoHandler = (): void => {
  if (!chrome.runtime.onMessageExternal.hasListener(handleExternalMessage)) {
    chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
  }
};

initializeSsoHandler();

export default initializeSsoHandler;
