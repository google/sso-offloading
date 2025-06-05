/**
 * This script opens a URL, intercepts a specific redirect, and sends the redirect
 * URL back to the calling application.
 */

const requestState = new Map<
  number,
  {
    handler: (
      details: chrome.webRequest.OnBeforeRequestDetails
    ) => chrome.webRequest.BlockingResponse;
    tabId: number;
  }
>();
let nextRequestId = 0;

function setup(): void {
  console.log('[setup()]');
  if (!chrome.runtime.onMessageExternal) {
    console.error(
      'This script is meant to be run in a context where chrome.runtime.onMessageExternal is available.'
    );
    return;
  }

  chrome.runtime.onMessageExternal.addListener(
    (message, sender, sendResponse) => {
      handleMessageFromIwa(message, sender, sendResponse);
      return true;
    }
  );

  // Add a listener to clean up orphaned request handlers if the auth tab is closed manually.
  chrome.tabs.onRemoved.addListener(handleTabRemoval);
}

/**
 * Handles incoming messages from the Isolated Web App.
 * @param message The message received, expected to have a `url` property.
 * @param sender Information about the message sender.
 * @param sendResponse Function to send a response back to the sender.
 */
async function handleMessageFromIwa(
  message: { url: string },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: {
    success: boolean;
    url?: string;
    error?: string;
  }) => void
): Promise<void> {
  const requestId = nextRequestId++;
  console.log(
    `[handleMessageFromIwa] Starting request ID: ${requestId}`,
    message,
    sender
  );

  let handler:
    | ((
        details: chrome.webRequest.OnBeforeRequestDetails
      ) => chrome.webRequest.BlockingResponse)
    | undefined;

  try {
    if (!message.url) {
      throw new Error("The message must include a 'url' property.");
    }

    const url = new URL(message.url);
    const redirectUrl = url.searchParams.get('redirect_uri');

    const requestFilter: chrome.webRequest.RequestFilter = {
      types: ['main_frame'],
      urls: [`${redirectUrl}*`],
    };

    handler = (
      details: chrome.webRequest.OnBeforeRequestDetails
    ): chrome.webRequest.BlockingResponse => {
      interceptRedirect(requestId, details, sender, sendResponse);
      return { cancel: true };
    };

    chrome.webRequest.onBeforeRequest.addListener(handler, requestFilter, [
      'blocking',
    ]);

    const tab = await chrome.tabs.create({ url: url.toString() });
    if (tab.id === undefined) {
      throw new Error('Failed to create a new tab with a valid ID.');
    }

    requestState.set(requestId, { handler, tabId: tab.id });
  } catch (error: any) {
    console.error(
      `[handleMessageFromIwa] Error in request ID ${requestId}:`,
      error
    );
    sendResponse({ success: false, error: error.message });

    if (handler) {
      chrome.webRequest.onBeforeRequest.removeListener(handler);
    }
  }
}

async function interceptRedirect(
  requestId: number,
  details: chrome.webRequest.OnBeforeRequestDetails,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: {
    success: boolean;
    url?: string;
    error?: string;
  }) => void
): Promise<void> {
  console.log(
    `[interceptRedirect] Intercepted redirect for request ID: ${requestId}`,
    details
  );

  cleanupRequest(requestId);

  if (details.tabId !== -1) {
    try {
      await chrome.tabs.remove(details.tabId);
    } catch (error) {
      console.error(
        `[interceptRedirect] Error removing tab ${details.tabId}:`,
        error
      );
    }
  }

  sendResponse({ success: true, url: details.url });

  if (sender.tab?.windowId) {
    await chrome.windows.update(sender.tab.windowId, { focused: true });
  }
}

function handleTabRemoval(tabId: number): void {
  for (const [requestId, state] of requestState.entries()) {
    if (state.tabId === tabId) {
      console.log(
        `[handleTabRemoval] Auth tab ${tabId} was closed manually. Cleaning up request ID: ${requestId}.`
      );
      cleanupRequest(requestId);
      break;
    }
  }
}

function cleanupRequest(requestId: number): void {
  const state = requestState.get(requestId);
  if (state) {
    chrome.webRequest.onBeforeRequest.removeListener(state.handler);
    requestState.delete(requestId);
    console.log(
      `[cleanupRequest] Cleaned up resources for request ID: ${requestId}`
    );
  }
}

setup();
