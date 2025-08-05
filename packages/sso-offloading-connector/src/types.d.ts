export interface ControlledFrameWebRequest {
  createWebRequestInterceptor(
    options: CreateWebRequestInterceptorOptions
  ): WebRequestInterceptor;
  handlerBehaviorChanged(): Promise<void>;
}
/**
 * Represents the WebRequestInterceptor, which allows listening to various
 * stages of a web request. It extends EventTarget to allow for standard
 * event listener patterns.
 */
export interface WebRequestInterceptor extends EventTarget {
  /**
   * Adds a listener for a web request event.
   * @param type The type of event to listen for.
   * @param listener The function that will be called when the event occurs.
   * @param options Optional settings for the listener.
   */
  addEventListener(
    type: 'authrequired',
    listener: WebRequestListener<AuthRequiredEvent>,
    options?: AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'beforeredirect',
    listener: WebRequestListener<BeforeRedirectEvent>,
    options?: AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'beforerequest',
    listener: WebRequestListener<BeforeRequestEvent>,
    options?: AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'beforesendheaders',
    listener: WebRequestListener<BeforeSendHeadersEvent>,
    options?: AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'completed',
    listener: WebRequestListener<CompletedEvent>,
    options?: AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'erroroccurred',
    listener: WebRequestListener<ErrorOccurredEvent>,
    options?: AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'headersreceived',
    listener: WebRequestListener<HeadersReceivedEvent>,
    options?: AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'responsestarted',
    listener: WebRequestListener<ResponseStartedEvent>,
    options?: AddEventListenerOptions
  ): void;
  addEventListener(
    type: 'sendheaders',
    listener: WebRequestListener<SendHeadersEvent>,
    options?: AddEventListenerOptions
  ): void;

  /**
   * Removes a listener for a web request event.
   * @param type The type of event the listener was added for.
   * @param listener The listener function to remove.
   * @param options Optional settings that were used when adding the listener.
   */
  removeEventListener(
    type: 'authrequired',
    listener: WebRequestListener<AuthRequiredEvent>,
    options?: EventListenerOptions
  ): void;
  removeEventListener(
    type: 'beforeredirect',
    listener: WebRequestListener<BeforeRedirectEvent>,
    options?: EventListenerOptions
  ): void;
  removeEventListener(
    type: 'beforerequest',
    listener: WebRequestListener<BeforeRequestEvent>,
    options?: EventListenerOptions
  ): void;
  removeEventListener(
    type: 'beforesendheaders',
    listener: WebRequestListener<BeforeSendHeadersEvent>,
    options?: EventListenerOptions
  ): void;
  removeEventListener(
    type: 'completed',
    listener: WebRequestListener<CompletedEvent>,
    options?: EventListenerOptions
  ): void;
  removeEventListener(
    type: 'erroroccurred',
    listener: WebRequestListener<ErrorOccurredEvent>,
    options?: EventListenerOptions
  ): void;
  removeEventListener(
    type: 'headersreceived',
    listener: WebRequestListener<HeadersReceivedEvent>,
    options?: EventListenerOptions
  ): void;
  removeEventListener(
    type: 'responsestarted',
    listener: WebRequestListener<ResponseStartedEvent>,
    options?: EventListenerOptions
  ): void;
  removeEventListener(
    type: 'sendheaders',
    listener: WebRequestListener<SendHeadersEvent>,
    options?: EventListenerOptions
  ): void;
}

export interface RequestFilter {
  urls: string[];
  types?: chrome.webRequest.RequestFilter['types'];
}

export type ExtensionMessage =
  | { type: 'pong' }
  | { type: 'success'; redirect_url: string }
  | { type: 'error'; message: string }
  | { type: 'cancel' };
