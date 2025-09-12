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

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { createSsoOffloadingConnector } from '../sso_offloading_connector';
import {
  CommunicationError,
  ConfigurationError,
  SsoOffloadingExtensionResponseError,
} from '../errors';

const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: undefined,
  },
});

describe('createSsoOffloadingConnector', () => {
  const mockInterceptor = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const mockCreateWebRequestInterceptor = vi
    .fn()
    .mockReturnValue(mockInterceptor);

  let mockControlledFrame: any;
  const requestFilter = { urls: ['https://sso.example.com/*'] };
  const onSuccess = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    chrome.runtime.lastError = undefined;
    mockControlledFrame = {
      src: '',
      request: {
        createWebRequestInterceptor: mockCreateWebRequestInterceptor,
      },
    };
  });

  it('should handle the full lifecycle: start, intercept, and stop successfully', async () => {
    mockSendMessage.mockImplementationOnce((_extId, _msg, cb) =>
      cb({ type: 'pong' })
    );

    const connector = createSsoOffloadingConnector(
      mockControlledFrame,
      requestFilter,
      onError
    );
    await connector.start();

    const newUrl = 'https://myapp.com/callback';
    const interceptedUrl = 'https://sso.example.com/login';
    const interceptorListener = (mockInterceptor.addEventListener as Mock).mock
      .calls[0][1];

    mockSendMessage.mockImplementationOnce((_extId, msg, cb) => {
      if (msg.type === 'sso_request') {
        cb({ type: 'success', redirect_uri: newUrl });
      }
    });

    interceptorListener({
      request: { url: interceptedUrl },
      preventDefault: vi.fn(),
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      'jmdcfpeebneidlbnldlhcifibpkidhkn',
      { type: 'sso_request', url: interceptedUrl },
      expect.any(Function)
    );
    expect(mockControlledFrame.src).toBe(newUrl);
    expect(onError).not.toHaveBeenCalled();

    connector.stop();
    expect(mockInterceptor.removeEventListener).toHaveBeenCalled();
  });

  it.each([
    {
      scenario: 'an error response',
      response: { type: 'error', message: 'Auth failed' },
      expectedError: SsoOffloadingExtensionResponseError,
    },
    {
      scenario: 'no response',
      response: undefined,
      expectedError: CommunicationError,
    },
  ])(
    'should call onError when interception gets $scenario',
    async ({ response, expectedError }) => {
      mockSendMessage.mockImplementationOnce((_extId, _msg, cb) =>
        cb({ type: 'pong' })
      );
      const connector = createSsoOffloadingConnector(
        mockControlledFrame,
        requestFilter,
        onError
      );
      await connector.start();

      const interceptorListener = (mockInterceptor.addEventListener as Mock)
        .mock.calls[0][1];
      mockSendMessage.mockImplementationOnce((_extId, _msg, cb) =>
        cb(response)
      );
      interceptorListener({
        request: { url: 'any_url' },
        preventDefault: vi.fn(),
      });

      expect(onError).toHaveBeenCalledWith(expect.any(expectedError));
      expect(onSuccess).not.toHaveBeenCalled();
    }
  );

  it('should fail to start if the extension does not respond to ping', async () => {
    const connector = createSsoOffloadingConnector(
      mockControlledFrame,
      requestFilter,
      onError
    );

    await expect(connector.start()).rejects.toThrow(CommunicationError);
  });

  it('should prevent starting if already started', async () => {
    mockSendMessage.mockImplementation((_extId, _msg, cb) =>
      cb({ type: 'pong' })
    );
    const connector = createSsoOffloadingConnector(
      mockControlledFrame,
      requestFilter,
      onError
    );

    await connector.start().catch(() => {});
    await expect(connector.start()).rejects.toThrow(ConfigurationError);
  });
});
