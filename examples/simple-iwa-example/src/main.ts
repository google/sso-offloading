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
  createSsoOffloadingConnector,
  SsoOffloadingConnectorError,
} from 'sso-offloading-connector'
import './style.css'

const ssoForm = document.getElementById('ssoForm') as HTMLFormElement
const extensionIdInput = document.getElementById(
  'extensionId'
) as HTMLInputElement
const authUrlInput = document.getElementById('authUrl') as HTMLInputElement
const enableSsoOffloadingButton = document.getElementById(
  'enableSsoOffloadingButton'
) as HTMLButtonElement
const ssoCf = document.getElementById('ssoCf') as HTMLIFrameElement
const statusContainer = document.getElementById(
  'statusContainer'
) as HTMLDivElement
const formValidationMessage = document.getElementById(
  'form-validation-message'
) as HTMLDivElement


let ssoConnector: ReturnType<typeof createSsoOffloadingConnector> | null = null


const handleSuccess = (url: string) => {
  enableSsoOffloadingButton.disabled = true

  if (statusContainer) {
    statusContainer.className = 'success'
    statusContainer.innerHTML = `SSO Success! The connector has redirected the frame.`
  }

  ssoCf.src = url
}

const handleError = (error: SsoOffloadingConnectorError) => {
  console.error(`SSO Error: ${error.name} - ${error.message}`, error.details)
  if (statusContainer) {
    statusContainer.className = 'error'
    statusContainer.innerHTML = `
      SSO Error: ${error.name},
      ${error.message},
      ${error.details}
    `
  }
}

const setupSsoOffloading = async (extensionId: string, authUrl: string) => {
  if (ssoConnector) {
    ssoConnector.stop()
    ssoConnector = null
  }

  if (statusContainer) {
    statusContainer.innerHTML = 'Attempting to start SSO connector...'
    statusContainer.className = 'info'
  }

  ssoConnector = createSsoOffloadingConnector(
    extensionId,
    ssoCf as any,
    {
      urls: [authUrl],
    },
    handleSuccess,
    handleError
  )

  await ssoConnector.start()
}

ssoForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const extensionId = extensionIdInput.value
  const authUrl = authUrlInput.value
  enableSsoOffloadingButton.disabled = !(extensionId && authUrl)
})

const hideValidationMessage = () => {
  if (formValidationMessage.style.display !== 'none') {
    formValidationMessage.style.display = 'none'
  }
}

extensionIdInput.addEventListener('input', hideValidationMessage)
authUrlInput.addEventListener('input', hideValidationMessage)

enableSsoOffloadingButton.addEventListener('click', () => {
  const extensionId = extensionIdInput.value
  const authUrl = authUrlInput.value
  if (extensionId && authUrl) {
    formValidationMessage.style.display = 'none'
    setupSsoOffloading(extensionId, authUrl)
  } else {
    formValidationMessage.textContent =
      'Please enter both Extension ID and Auth URL.'
    formValidationMessage.style.display = 'block'
  }
})

// Initial check to enable button if values are present on load
if (extensionIdInput?.value && authUrlInput?.value) {
  enableSsoOffloadingButton.disabled = false
}
