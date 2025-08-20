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

import {
  CommunicationError,
  ConfigurationError,
  SsoOffloadingExtensionResponseError,
  SsoOffloadingConnectorError,
} from './errors'
import type {
  ExtensionMessage,
  RequestFilter,
  SsoRequestMessage,
} from './types'

// The public interface for the connector.
export interface SsoOffloadingConnector {
  start: (timeoutMs?: number) => Promise<void>
  stop: () => void
}

/**
 * Pings the extension to ensure it's active before starting.
 */
const pingExtension = (
  extensionId: string,
  timeoutMs: number
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new CommunicationError(`Connection timed out.`)),
      timeoutMs
    )

    const pingMessage: SsoRequestMessage = { type: 'ping' }
    const sendPingMessageCallback = (response: any) => {
      clearTimeout(timeoutId)
      if (chrome.runtime.lastError || response?.type !== 'pong') {
        return reject(
          new CommunicationError('Failed to connect to extension.', {
            error: chrome.runtime.lastError,
            response,
          })
        )
      }
      resolve()
    }

    chrome.runtime.sendMessage(
      extensionId,
      pingMessage,
      sendPingMessageCallback
    )
  })
}

// Creates a request listener for an Isolated Web App's <cf>.
// It returns a function that will detach the listener when called.
const createIwaRequestListener = (
  target: any,
  filter: RequestFilter,
  handleInterceptedRequest: (details: { url: string }) => void
): (() => void) => {
  const interceptor = target.request.createWebRequestInterceptor({
    urlPatterns: filter.urls,
    resourceTypes: filter.types,
    blocking: true,
  })
  const interceptingListener = (e: any) => {
    e.preventDefault()
    handleInterceptedRequest(e.request)
  }

  interceptor.addEventListener('beforerequest', interceptingListener)

  return () => {
    interceptor.removeEventListener('beforerequest', interceptingListener)
  }
}

// Creates a request listener for a Chrome App's <webview>.
const createChromeAppRequestListener = (
  target: any,
  filter: RequestFilter,
  handleInterceptedRequest: (details: { url: string }) => void
): (() => void) => {
  const interceptingListener = (details: { url: string }) => {
    handleInterceptedRequest(details)
    return { cancel: true }
  }

  target.request.onBeforeRequest.addListener(
    interceptingListener,
    { urls: filter.urls, types: filter.types },
    ['blocking']
  )

  return () => {
    target.request.onBeforeRequest.removeListener(interceptingListener)
  }
}

// Detects the app type and creates the appropriate request listener.
// It returns a function that will detach the listener when called.
const createRequestListener = (
  target: any,
  filter: RequestFilter,
  handleInterceptedRequest: (details: { url: string }) => void
): (() => void) => {
  // IWA (<controlledframe>)
  if (target?.request?.createWebRequestInterceptor) {
    return createIwaRequestListener(target, filter, handleInterceptedRequest)
  }

  // Chrome App (<webview>)
  if (target?.request?.onBeforeRequest) {
    return createChromeAppRequestListener(
      target,
      filter,
      handleInterceptedRequest
    )
  }

  throw new ConfigurationError(
    'Invalid target provided. Must be a <controlledframe> or <webview> element.'
  )
}

/**
 * Creates an SSO connector for offloading authentication to a Chrome Extension.
 */
export const createSsoOffloadingConnector = (
  extensionId: string,
  target: any,
  requestFilter: RequestFilter,
  onSuccess?: (url: string) => void,
  onError?: (error: SsoOffloadingConnectorError) => void
): SsoOffloadingConnector => {
  if (!extensionId || !target || !requestFilter?.urls?.length) {
    throw new ConfigurationError('Invalid connector configuration provided.')
  }

  const finalFilter = {
    ...requestFilter,
    types: requestFilter.types ?? ['main_frame'],
  }
  let isRequestInFlight = false
  let detachListenerOnStop: (() => void) | null = null

  const handleSuccess =
    onSuccess ?? ((url) => console.log(`SSO Success: ${url}`))
  const handleError = onError ?? ((err) => console.error(err.name, err.message))

  const updateSource = (url: string) => {
    target.src = url
  }

  const handleInterceptedRequest = (details: { url: string }) => {
    const message: SsoRequestMessage = { type: 'sso_request', url: details.url }

    if (isRequestInFlight) {
      // If a flow is already active, send the request again. The extension's
      // handler will see an active flow and focus the existing auth tab
      // instead of creating a new one. We send this without a callback,
      // as the original request is still waiting for the final response.
      chrome.runtime.sendMessage(extensionId, message)
      return
    }

    isRequestInFlight = true

    const sendMessageCallback = (response: ExtensionMessage) => {
      isRequestInFlight = false
      if (!response) {
        return handleError(
          new CommunicationError('Extension sent no response.')
        )
      }

      switch (response.type) {
        case 'success':
          updateSource(response.redirect_url)
          handleSuccess(response.redirect_url)
          break
        case 'error':
          handleError(
            new SsoOffloadingExtensionResponseError(
              'Received error response from extension.',
              response.message
            )
          )
          break
        case 'cancel':
          handleError(
            new SsoOffloadingExtensionResponseError(
              'SSO flow was canceled by the user.'
            )
          )
          break
        default:
          handleError(
            new CommunicationError('Received unexpected response from extension.')
          )
      }
    }

    chrome.runtime.sendMessage(extensionId, message, sendMessageCallback)
  }

  return {
    start: async (timeoutMs = 3000) => {
      // If `detachListenerCleanup` is not null, then it was set by an already 
      // active SSO offloading connector.
      if (detachListenerOnStop) {
        return handleError(
          new ConfigurationError('Connector is already started.')
        )
      }
      try {
        await pingExtension(extensionId, timeoutMs)
        detachListenerOnStop = createRequestListener(
          target,
          finalFilter,
          handleInterceptedRequest
        )
      } catch (error) {
        handleError(error as SsoOffloadingConnectorError)
        throw error
      }
    },

    stop: () => {
      if (detachListenerOnStop) {
        detachListenerOnStop()
        // Tell the extension it should stop SSO flow.
        chrome.runtime.sendMessage(extensionId, {
          type: 'stop',
        } as SsoRequestMessage)
        detachListenerOnStop = null
      }
      isRequestInFlight = false
    },
  }
}
