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

 export interface ControlledFrameWebRequest {
  createWebRequestInterceptor(
    options: CreateWebRequestInterceptorOptions
  ): WebRequestInterceptor
  handlerBehaviorChanged(): Promise<void>
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
  ): void
  addEventListener(
    type: 'beforeredirect',
    listener: WebRequestListener<BeforeRedirectEvent>,
    options?: AddEventListenerOptions
  ): void
  addEventListener(
    type: 'beforerequest',
    listener: WebRequestListener<BeforeRequestEvent>,
    options?: AddEventListenerOptions
  ): void
  addEventListener(
    type: 'beforesendheaders',
    listener: WebRequestListener<BeforeSendHeadersEvent>,
    options?: AddEventListenerOptions
  ): void
  addEventListener(
    type: 'completed',
    listener: WebRequestListener<CompletedEvent>,
    options?: AddEventListenerOptions
  ): void
  addEventListener(
    type: 'erroroccurred',
    listener: WebRequestListener<ErrorOccurredEvent>,
    options?: AddEventListenerOptions
  ): void
  addEventListener(
    type: 'headersreceived',
    listener: WebRequestListener<HeadersReceivedEvent>,
    options?: AddEventListenerOptions
  ): void
  addEventListener(
    type: 'responsestarted',
    listener: WebRequestListener<ResponseStartedEvent>,
    options?: AddEventListenerOptions
  ): void
  addEventListener(
    type: 'sendheaders',
    listener: WebRequestListener<SendHeadersEvent>,
    options?: AddEventListenerOptions
  ): void

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

export interface RequestFilter {
  urls: string[]
  types?: chrome.webRequest.RequestFilter['types']
}

export type SsoRequestMessage =
  | { type: 'ping' }
  | { type: 'sso_request'; url: string }
  | { type: 'stop' }

export type ExtensionMessage =
  | { type: 'pong' }
  | { type: 'success'; redirect_url: string }
  | { type: 'error'; message: string }
  | { type: 'cancel' }
