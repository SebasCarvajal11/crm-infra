const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, expect } = require('@playwright/test')

const errors = []
const logError = (stepName, detail, error) => {
  const errorMsg = error instanceof Error ? error.message : String(error)
  errors.push({ step: stepName, detail, message: errorMsg })
  console.error(`[ERROR] Step "${stepName}": ${detail}. Error: ${errorMsg}`)
}

const suffix = Date.now().toString()
const projectName = `Smoke Project ${suffix}`
const projectBrief = `Brief del proyecto smoke con sufijo ${suffix}.`
const projectDesc = `Descripcion del proyecto smoke ${suffix}.`
const taskTitle = `Tarea Smoke ${suffix}`

function makeUploadFile() {
  const filePath = path.join(os.tmpdir(), `crm-smoke-${suffix}.txt`)
  fs.writeFileSync(filePath, `smoke test upload ${suffix}\n`, 'utf8')
  return filePath
}

async function logout(page, context) {
  await context.clearCookies()
  await page.evaluate(() => sessionStorage.clear())
  await page.goto('/login')
  await page.waitForURL(/\/login/)
}

test.describe.serial('CIMA CRM — Smoke E2E', () => {

  test('1. Admin: login → crear proyecto → tarea → comentario → archivo → chat', async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`[BROWSER] ${msg.text()}`)
    })
    const uploadFile = makeUploadFile()

    // ── Login ──────────────────────────────────────────────────
    try {
      await page.goto('/login')
      await page.getByLabel('Correo').fill('admin@cima.dev')
      await page.getByLabel('Contrasena').fill('Admin123!')
      await page.getByRole('button', { name: 'Entrar' }).click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 })
    } catch (e) {
      logError('Admin Login', 'Falla al iniciar sesion como admin', e)
      return
    }

    // ── Navegar a Colaboración ─────────────────────────────────
    try {
      await page.getByRole('button', { name: 'Colaboración' }).click()
      await expect(page.getByRole('button', { name: 'Nuevo proyecto' })).toBeVisible({ timeout: 10000 })
    } catch (e) {
      logError('Admin Colaboración', 'Falla al navegar a Colaboración', e)
      return
    }

    // ── Crear proyecto ─────────────────────────────────────────
    try {
      await page.getByRole('button', { name: 'Nuevo proyecto' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await dialog.locator('#cp-name').fill(projectName)
      await dialog.locator('#cp-type').click()
      await page.getByRole('option', { name: /Campana \/ Servicio/i }).click()

      await dialog.getByPlaceholder('Busca por email del cliente…').fill('contacto@restauranteelbuensabor.com')
      await page.getByRole('option', { name: /contacto@restauranteelbuensabor\.com/i }).click()

      await dialog.getByPlaceholder('Busca por email del trabajador...').fill('ana.martinez@cima.dev')
      await page.getByRole('option', { name: /ana\.martinez@cima\.dev/i }).click()

      await dialog.getByPlaceholder('Busca por email del trabajador...').fill('luis.rodriguez@cima.dev')
      await page.getByRole('option', { name: /luis\.rodriguez@cima\.dev/i }).click()

      await dialog.locator('#cp-desc').fill(projectDesc)
      await dialog.locator('#cp-brief').fill(projectBrief)

      await dialog.getByRole('button', { name: 'Crear proyecto' }).click()
      await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 15000 })
    } catch (e) {
      logError('Admin Crear Proyecto', 'Falla al crear el proyecto', e)
      return
    }

    // ── Crear tarea con subtareas ──────────────────────────────
    try {
      await page.getByRole('button', { name: /Crear tarea en/i }).first().click()
      const taskDialog = page.getByRole('dialog')
      await expect(taskDialog).toBeVisible()

      await taskDialog.locator('#ct-title').fill(taskTitle)
      await taskDialog.locator('#ct-desc').fill(`Detalle de la tarea smoke ${suffix}.`)

      // Asignar workers
      await page.locator('button:has-text("Seleccionar...")').first().click()
      await page.getByRole('option', { name: /ana\.martinez/i }).click()
      await page.locator('button:has-text("Seleccionar...")').first().click()
      await page.getByRole('option', { name: /luis\.rodriguez/i }).click()

      // Subtarea 1
      await page.getByPlaceholder('Descripcion de la subtarea...').fill('Subtarea 1: Diseno')
      await page.click('button:has-text("Sin asignar")')
      await page.getByRole('option', { name: /ana\.martinez/i }).click()
      await page.getByPlaceholder('Descripcion de la subtarea...').press('Enter')

      // Subtarea 2
      await page.getByPlaceholder('Descripcion de la subtarea...').fill('Subtarea 2: Revision')
      await page.getByPlaceholder('Descripcion de la subtarea...').press('Enter')

      await taskDialog.getByRole('button', { name: 'Crear tarea' }).click()
      await expect(taskDialog).not.toBeVisible({ timeout: 10000 })
    } catch (e) {
      logError('Admin Crear Tarea', 'Falla al crear la tarea con subtareas', e)
      return
    }

    // ── Comentar en tarea ──────────────────────────────────────
    try {
      const taskCard = page.locator(`button[aria-label*="Tarea: ${taskTitle}"]`)
      await expect(taskCard).toBeVisible()
      await taskCard.click()

      await page.getByRole('tab', { name: 'Comentarios' }).click()
      await page.getByPlaceholder(/Escribe un comentario/i).fill('Admin: Comentario inicial de smoke test.')
      await page.getByRole('button', { name: 'Comentar' }).click()
      await expect(page.getByText('Admin: Comentario inicial de smoke test.')).toBeVisible()
    } catch (e) {
      logError('Admin Comentario', 'Falla al comentar en la tarea', e)
    }

    // ── Subir archivo a tarea ──────────────────────────────────
    try {
      await page.getByRole('tab', { name: 'Archivos' }).click()
      await page.getByRole('button', { name: 'Adjuntar archivo' }).click()
      await page.locator('#tf-title').fill(`SmokeDoc ${suffix}`)
      await page.locator('#tf-desc').fill('Documento de prueba smoke')
      await page.getByLabel('Seleccionar archivo').setInputFiles(uploadFile)
      await page.locator('div[role="dialog"] button:has-text("Subir archivo")').click()
      await expect(
        page.locator('div[role="dialog"]').getByText(`SmokeDoc ${suffix}`)
      ).toBeVisible({ timeout: 60000 })
    } catch (e) {
      logError('Admin Upload', 'Falla al subir archivo a la tarea (posible latencia OCI)', e)
    }

    // ── Cerrar panel de tarea ──────────────────────────────────
    try {
      await page.getByRole('button', { name: 'Cerrar panel' }).click()
    } catch (e) {
      logError('Admin Cerrar Panel', 'Falla al cerrar panel de tarea', e)
    }

    // ── Chat Externo (Cliente) ─────────────────────────────────
    try {
      await page.getByRole('tab', { name: 'Conversacion' }).click()
      await page.getByRole('tab', { name: 'Cliente' }).click()
      await page.getByPlaceholder(/Escribe un mensaje/i).fill('Admin: Iniciando comunicacion del proyecto smoke.')
      await page.click('button[aria-label="Enviar mensaje"]')
      await expect(page.getByText('Admin: Iniciando comunicacion del proyecto smoke.')).toBeVisible()
    } catch (e) {
      logError('Admin Chat Externo', 'Falla al enviar mensaje en chat Cliente', e)
    }

    // ── Chat Interno (Equipo) ──────────────────────────────────
    try {
      await page.getByRole('tab', { name: 'Equipo' }).click()
      await page.getByPlaceholder(/Escribe un mensaje/i).fill('Admin: Tarea asignada a @ana.martinez y @luis.rodriguez')
      await page.click('button[aria-label="Enviar mensaje"]')
      await expect(page.getByText(/Tarea asignada a/)).toBeVisible()
    } catch (e) {
      logError('Admin Chat Interno', 'Falla al enviar mensaje en chat Equipo', e)
    }
  })

  // ═════════════════════════════════════════════════════════════
  // WORKER FLOW
  // ═════════════════════════════════════════════════════════════
  test('2. Worker: login → verificar proyecto → comentar → chat', async ({ context, page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`[BROWSER] ${msg.text()}`)
    })

    // ── Login como worker ──────────────────────────────────────
    try {
      await logout(page, context)
      await page.goto('/login')
      await page.getByLabel('Correo').fill('ana.martinez@cima.dev')
      await page.getByLabel('Contrasena').fill('Demo123!')
      await page.getByRole('button', { name: 'Entrar' }).click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 })
    } catch (e) {
      logError('Worker Login', 'Falla al iniciar sesion como worker', e)
      return
    }

    // ── Abrir proyecto ─────────────────────────────────────────
    try {
      await page.getByRole('button', { name: 'Colaboración' }).click()
      await page.click(`button:has-text("${projectName}")`)
      await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 10000 })
    } catch (e) {
      logError('Worker Abrir Proyecto', `Falla al abrir proyecto "${projectName}"`, e)
      return
    }

    // ── Verificar tarea visible ────────────────────────────────
    try {
      const taskCard = page.locator(`button[aria-label*="Tarea: ${taskTitle}"]`)
      await expect(taskCard).toBeVisible()
      await taskCard.click()
    } catch (e) {
      logError('Worker Verificar Tarea', `La tarea "${taskTitle}" no es visible para el worker`, e)
      return
    }

    // ── Verificar comentario del admin ─────────────────────────
    try {
      await page.getByRole('tab', { name: 'Comentarios' }).click()
      await expect(page.getByText('Admin: Comentario inicial de smoke test.')).toBeVisible()
    } catch (e) {
      logError('Worker Verificar Comentario', 'El comentario del admin no es visible', e)
    }

    // ── Agregar comentario del worker ──────────────────────────
    try {
      await page.getByPlaceholder(/Escribe un comentario/i).fill('Worker: Recibido, revisando.')
      await page.getByRole('button', { name: 'Comentar' }).click()
      await expect(page.getByText('Worker: Recibido, revisando.')).toBeVisible()
    } catch (e) {
      logError('Worker Comentar', 'Falla al agregar comentario del worker', e)
    }

    // ── Cerrar panel ───────────────────────────────────────────
    try {
      await page.getByRole('button', { name: 'Cerrar panel' }).click()
    } catch (e) {
      logError('Worker Cerrar Panel', 'Falla al cerrar panel', e)
    }

    // ── Verificar chat Equipo ──────────────────────────────────
    try {
      await page.getByRole('tab', { name: 'Conversacion' }).click()
      await page.getByRole('tab', { name: 'Equipo' }).click()
      await expect(page.getByText(/Tarea asignada a/)).toBeVisible()
    } catch (e) {
      logError('Worker Chat Equipo', 'El mensaje del chat Equipo no es visible', e)
    }

    // ── Responder en chat Equipo ───────────────────────────────
    try {
      await page.getByPlaceholder(/Escribe un mensaje/i).fill('Worker: Entendido, empezando.')
      await page.click('button[aria-label="Enviar mensaje"]')
      await expect(page.getByText('Worker: Entendido, empezando.')).toBeVisible()
    } catch (e) {
      logError('Worker Responder Chat', 'Falla al responder en chat Equipo', e)
    }
  })

  // ═════════════════════════════════════════════════════════════
  // CLIENT FLOW
  // ═════════════════════════════════════════════════════════════
  test('3. Client: login → verificar brief → aislamiento → chat', async ({ context, page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`[BROWSER] ${msg.text()}`)
    })

    // ── Login como client ──────────────────────────────────────
    try {
      await logout(page, context)
      await page.goto('/login')
      await page.getByLabel('Correo').fill('contacto@restauranteelbuensabor.com')
      await page.getByLabel('Contrasena').fill('Demo123!')
      await page.getByRole('button', { name: 'Entrar' }).click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 })
    } catch (e) {
      logError('Client Login', 'Falla al iniciar sesion como client', e)
      return
    }

    // ── Abrir proyecto ─────────────────────────────────────────
    try {
      await page.getByRole('button', { name: 'Colaboración' }).click()
      await page.click(`button:has-text("${projectName}")`)
      await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 10000 })
    } catch (e) {
      logError('Client Abrir Proyecto', `Falla al abrir proyecto "${projectName}"`, e)
      return
    }

    // ── Verificar Brief ────────────────────────────────────────
    try {
      await page.getByRole('tab', { name: 'Brief' }).click()
      const briefContainer = page.locator('div[role="region"][aria-label="Brief del proyecto"] div.whitespace-pre-wrap')
      await expect(briefContainer).toHaveText(projectBrief)
    } catch (e) {
      logError('Client Brief', 'El contenido del brief no coincide', e)
    }

    // ── Verificar chat Cliente visible ─────────────────────────
    try {
      await page.getByRole('tab', { name: 'Conversacion' }).click()
      await page.getByRole('tab', { name: 'Cliente' }).click()
      await expect(page.getByText('Admin: Iniciando comunicacion del proyecto smoke.')).toBeVisible()
    } catch (e) {
      logError('Client Chat Cliente', 'El chat Cliente no es visible o no tiene mensajes', e)
    }

    // ── Verificar aislamiento: tab Equipo NO visible ───────────
    try {
      const teamTab = page.getByRole('tab', { name: 'Equipo' })
      const isVisible = await teamTab.isVisible()
      if (isVisible) {
        logError('Client Aislamiento', 'SEGURIDAD: El cliente puede ver el tab Equipo!', new Error('Security breach: client sees internal chat'))
      }
    } catch (e) {
      if (!e.message?.includes('Security breach')) {
        logError('Client Aislamiento', 'Falla al verificar aislamiento de tab Equipo', e)
      }
    }

    // ── Responder en chat Cliente ──────────────────────────────
    try {
      await page.getByPlaceholder(/Escribe un mensaje/i).fill('Cliente: Confirmado, todo se ve bien.')
      await page.click('button[aria-label="Enviar mensaje"]')
      await expect(page.getByText('Cliente: Confirmado, todo se ve bien.')).toBeVisible()
    } catch (e) {
      logError('Client Responder Chat', 'Falla al responder en chat Cliente', e)
    }
  })

  // ═════════════════════════════════════════════════════════════
  // REPORTE
  // ═════════════════════════════════════════════════════════════
  test.afterAll(async () => {
    const reportPath = path.join(__dirname, '..', 'VerificationReport.md')
    let report = '# Smoke E2E — Verification Report\n\n'
    report += `**Date:** ${new Date().toISOString()}\n`
    report += `**Suffix:** \`${suffix}\`\n\n`

    if (errors.length === 0) {
      report += '## Result\n\n✅ All smoke flows completed successfully.\n\n'
      report += '- Admin: login, project, task, comment, file upload, chat\n'
      report += '- Worker: login, verify project, comment, chat\n'
      report += '- Client: login, verify brief, isolation check, chat\n'
    } else {
      report += `## Result\n\n⚠️ ${errors.length} error(s) detected:\n\n`
      errors.forEach((err, idx) => {
        report += `### Error ${idx + 1}: ${err.step}\n`
        report += `- **Detail:** ${err.detail}\n`
        report += `- **Message:** \`${err.message}\`\n\n`
      })
    }

    fs.writeFileSync(reportPath, report, 'utf8')
    console.log(`Report written to ${reportPath}`)
    expect(errors.length, `${errors.length} smoke test error(s) detected`).toBe(0)
  })
})
