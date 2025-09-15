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
import { createSsoOffloadingConnector } from 'sso-offloading-connector';
import './style.css';

const ssoForm = document.getElementById('ssoForm') as HTMLFormElement;
const authUrlInput = document.getElementById('authUrl') as HTMLInputElement;
const enableSsoOffloadingButton = document.getElementById(
  'enableSsoOffloadingButton'
) as HTMLButtonElement;
const ssoCf = document.getElementById('ssoCf') as HTMLIFrameElement;
const formValidationMessage = document.getElementById(
  'form-validation-message'
) as HTMLDivElement;
const authorizeApiButton = document.getElementById(
  'authorizeApiButton'
) as HTMLButtonElement;

let ssoConnector: ReturnType<typeof createSsoOffloadingConnector> | null = null;

const handleInterceptError = (error: any) => {
  formValidationMessage.textContent = `SSO Error: ${error.name} - ${error.message}`;
  formValidationMessage.className = 'error';
  formValidationMessage.style.display = 'block';
  console.error('SSO Error:', error);
};

const setupSsoOffloading = async (authUrl: string) => {
  if (ssoConnector) {
    ssoConnector.stop();
    ssoConnector = null;
  }

  formValidationMessage.textContent = 'Attempting to start SSO connector...';
  formValidationMessage.style.display = 'block';

  ssoConnector = createSsoOffloadingConnector(
    ssoCf as any,
    {
      urls: [authUrl],
    },
    handleInterceptError
  );

  try {
    await ssoConnector.start();
    formValidationMessage.textContent = 'SSO connector started successfully.';
    formValidationMessage.className = 'success';
  } catch (error: any) {
    formValidationMessage.textContent = `Failed to start SSO connector: ${error.message}`;
    formValidationMessage.className = 'error';
    console.error('Failed to start SSO connector:', error);
  }
};

ssoForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const authUrl = authUrlInput.value;
  if (authUrl) {
    enableSsoOffloadingButton.disabled = false;
    formValidationMessage.style.display = 'none';
  } else {
    formValidationMessage.className = 'error';
    formValidationMessage.textContent = 'Please enter an Auth URL.';
    formValidationMessage.style.display = 'block';
  }
});

const resetSsoButton = () => {
  formValidationMessage.style.display = 'none';
  enableSsoOffloadingButton.disabled = true;
};

authUrlInput.addEventListener('input', resetSsoButton);

enableSsoOffloadingButton.addEventListener('click', () => {
  const authUrl = authUrlInput.value;
  if (authUrl) {
    setupSsoOffloading(authUrl);
  } else {
    formValidationMessage.textContent = 'Please enter an Auth URL.';
    formValidationMessage.style.display = 'block';
  }
});

const clickAuthorizeButtonInFrame = () => {
  const scriptToExecute = `
    const button = document.getElementById('authorize-apis');
    if (button) {
      button.click();
      console.log('In-frame script: Clicked #authorize-apis button.');
    } else {
      console.error('In-frame script: Could not find #authorize-apis button.');
    }
  `;

  formValidationMessage.textContent =
    'Attempting to click "Authorize APIs" button inside frame...';
  formValidationMessage.className = 'success';
  formValidationMessage.style.display = 'block';

  if (typeof (ssoCf as any).executeScript === 'function') {
    try {
      (ssoCf as any).executeScript({ code: scriptToExecute });
      console.log(
        'Parent: Attempted to inject script to click authorize button.'
      );
    } catch (e: any) {
      const errorMsg = `Error executing script: ${e.message}`;
      console.error(errorMsg);
      formValidationMessage.textContent = errorMsg;
      formValidationMessage.className = 'error';
    }
  } else {
    const errorMsg =
      'Error: `(ssoCf as any).executeScript` is not a function. Programmatic cross-origin clicks are blocked by browser security.';
    console.error(errorMsg);
    formValidationMessage.textContent = errorMsg;
    formValidationMessage.className = 'error';
    formValidationMessage.style.display = 'block';
  }
};

authorizeApiButton.addEventListener('click', clickAuthorizeButtonInFrame);
