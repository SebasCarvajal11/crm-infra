import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const smokeHelpers = require('../scripts/smoke-helpers.js')

test('smoke-helpers: dismissWelcomeIfPresent descarta el diálogo si está visible', async () => {
  let clicked = false
  let waitedHidden = false

  const mockButton = {
    waitFor: async ({ state, timeout }) => {
      if (state === 'hidden') {
        waitedHidden = true
      }
    },
    click: async () => {
      clicked = true
    },
  }

  const mockPage = {
    getByRole: (role, options) => {
      if (role === 'button' && options?.name === 'Explorar por mi cuenta') {
        return mockButton
      }
      throw new Error(`Unexpected getByRole call: ${role}`)
    },
  }

  assert.equal(typeof smokeHelpers.dismissWelcomeIfPresent, 'function')
  await smokeHelpers.dismissWelcomeIfPresent(mockPage)
  assert.equal(clicked, true)
  assert.equal(waitedHidden, true)
})

test('smoke-helpers: dismissWelcomeIfPresent tolera ausencia del modal sin lanzar error', async () => {
  const mockButton = {
    waitFor: async () => {
      throw new Error('Timeout 3000ms exceeded waiting for element')
    },
    click: async () => {
      throw new Error('Should not be called')
    },
  }

  const mockPage = {
    getByRole: () => mockButton,
  }

  assert.equal(typeof smokeHelpers.dismissWelcomeIfPresent, 'function')
  await assert.doesNotReject(async () => {
    await smokeHelpers.dismissWelcomeIfPresent(mockPage)
  })
})

test('smoke-helpers: loginAs navega, completa credenciales y descarta el modal de bienvenida', async () => {
  const actions = []

  const mockPage = {
    goto: async (url) => actions.push(`goto:${url}`),
    getByLabel: (label) => ({
      fill: async (val) => actions.push(`fill:${label}:${val}`),
    }),
    locator: (selector) => ({
      fill: async (val) => actions.push(`fill:${selector}:${val}`),
    }),
    getByRole: (role, options) => {
      if (role === 'button' && options?.name === 'Entrar') {
        return { click: async () => actions.push('click:Entrar') }
      }
      if (role === 'button' && options?.name === 'Explorar por mi cuenta') {
        return {
          waitFor: async ({ state }) => actions.push(`wait:${state}`),
          click: async () => actions.push('click:ExplorarPorMiCuenta'),
        }
      }
      throw new Error(`Unexpected: ${role} ${JSON.stringify(options)}`)
    },
  }

  const mockExpect = (page) => ({
    toHaveURL: async (regex) => actions.push(`toHaveURL:${regex}`),
  })

  await smokeHelpers.loginAs(mockPage, 'admin@cima.dev', 'Admin123!', mockExpect)

  assert.deepEqual(actions, [
    'goto:/login',
    'fill:Correo:admin@cima.dev',
    'fill:#password:Admin123!',
    'click:Entrar',
    'toHaveURL:/\\/dashboard/',
    'wait:visible',
    'click:ExplorarPorMiCuenta',
    'wait:hidden',
  ])
})
