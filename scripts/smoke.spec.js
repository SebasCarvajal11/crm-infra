const path = require('node:path')
const { test, expect } = require('@playwright/test')
const {
  createSmokeContext,
  logout,
  loginAs,
  writeVerificationReport,
} = require('./smoke-helpers')

const ctx = createSmokeContext()

test.describe.serial('CIMA CRM — Smoke E2E', () => {
  test('1. Admin: login → crear proyecto → tarea → comentario → archivo → chat', async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[BROWSER] ${msg.text()}`)
    })
    const uploadFile = ctx.makeUploadFile()

    try {
      await loginAs(page, 'admin@cima.dev', 'Admin123!', expect)
    } catch (e) {
      ctx.logError('Admin Login', 'Falla al iniciar sesion como admin', e)
      return
    }

    try {
      await page.getByRole('button', { name: 'Colaboración' }).click()
      await expect(page.getByRole('button', { name: 'Nuevo proyecto' })).toBeVisible({ timeout: 10000 })
    } catch (e) {
      ctx.logError('Admin Colaboración', 'Falla al navegar a Colaboración', e)
      return
    }

    try {
      await page.getByRole('button', { name: 'Nuevo proyecto' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await dialog.locator('#cp-name').fill(ctx.projectName)
      await dialog.locator('#cp-type').click()
      await page.getByRole('option', { name: /Campana \/ Servicio/i }).click()

      await dialog.getByPlaceholder('Busca por email del cliente…').fill('contacto@restauranteelbuensabor.com')
      await page.getByRole('option', { name: /contacto@restauranteelbuensabor\.com/i }).click()

      await dialog.getByPlaceholder('Busca por email del trabajador...').fill('ana.martinez@cima.dev')
      await page.getByRole('option', { name: /ana\.martinez@cima\.dev/i }).click()

      await dialog.getByPlaceholder('Busca por email del trabajador...').fill('luis.rodriguez@cima.dev')
      await page.getByRole('option', { name: /luis\.rodriguez@cima\.dev/i }).click()

      await dialog.locator('#cp-desc').fill(ctx.projectDesc)
      await dialog.locator('#cp-brief').fill(ctx.projectBrief)

      await dialog.getByRole('button', { name: 'Crear proyecto' }).click()
      await expect(page.getByRole('heading', { name: ctx.projectName })).toBeVisible({ timeout: 15000 })
    } catch (e) {
      ctx.logError('Admin Crear Proyecto', 'Falla al crear el proyecto', e)
      return
    }

    try {
      await page.getByRole('button', { name: /Crear tarea en/i }).first().click()
      const taskDialog = page.getByRole('dialog')
      await expect(taskDialog).toBeVisible()

      await taskDialog.locator('#ct-title').fill(ctx.taskTitle)
      await taskDialog.locator('#ct-desc').fill(`Detalle de la tarea smoke ${ctx.suffix}.`)

      await page.getByPlaceholder('Descripcion de la subtarea...').fill('Subtarea 1: Diseno')
      await page.getByPlaceholder('Descripcion de la subtarea...').press('Enter')

      await page.getByPlaceholder('Descripcion de la subtarea...').fill('Subtarea 2: Revision')
      await page.getByPlaceholder('Descripcion de la subtarea...').press('Enter')

      await taskDialog.getByRole('button', { name: 'Crear tarea' }).click()
      await expect(taskDialog).not.toBeVisible({ timeout: 10000 })
    } catch (e) {
      ctx.logError('Admin Crear Tarea', 'Falla al crear la tarea con subtareas', e)
      return
    }

    try {
      const taskCard = page.locator(`button[aria-label*="Tarea: ${ctx.taskTitle}"]`)
      await expect(taskCard).toBeVisible()
      await taskCard.click()

      await page.getByRole('tab', { name: 'Comentarios' }).click()
      await page.getByPlaceholder(/Escribe un comentario/i).fill('Admin: Comentario inicial de smoke test.')
      await page.getByRole('button', { name: 'Comentar' }).click()
      await expect(page.getByText('Admin: Comentario inicial de smoke test.')).toBeVisible()
    } catch (e) {
      ctx.logError('Admin Comentario', 'Falla al comentar en la tarea', e)
    }

    if (process.env.SMOKE_SKIP_FILE_UPLOAD !== 'true') {
      try {
        await page.getByRole('tab', { name: 'Archivos' }).click()
        await page.getByRole('button', { name: 'Adjuntar archivo' }).click()
        await page.locator('#tf-title').fill(`SmokeDoc ${ctx.suffix}`)
        await page.locator('#tf-desc').fill('Documento de prueba smoke')
        await page.getByLabel('Seleccionar archivo').setInputFiles(uploadFile)
        await page.locator('div[role="dialog"] button:has-text("Subir archivo")').click()
        await expect(
          page.locator('div[role="dialog"]').getByText(`SmokeDoc ${ctx.suffix}`)
        ).toBeVisible({ timeout: 60000 })
      } catch (e) {
        ctx.logError('Admin Upload', 'Falla al subir archivo a la tarea (posible latencia OCI)', e)
      }
    }

    try {
      await page.getByRole('button', { name: 'Cerrar panel' }).click()
    } catch (e) {
      ctx.logError('Admin Cerrar Panel', 'Falla al cerrar panel de tarea', e)
    }

    try {
      await page.getByRole('tab', { name: /conversaci[oó]n/i }).click()
      await page.getByRole('tab', { name: 'Cliente' }).click()
      await page.getByPlaceholder(/Escribe un mensaje/i).fill('Admin: Iniciando comunicacion del proyecto smoke.')
      await page.click('button[aria-label="Enviar mensaje"]')
      await expect(page.getByText('Admin: Iniciando comunicacion del proyecto smoke.')).toBeVisible()
    } catch (e) {
      ctx.logError('Admin Chat Externo', 'Falla al enviar mensaje en chat Cliente', e)
    }

    try {
      await page.getByRole('tab', { name: 'Equipo' }).click()
      await page.getByPlaceholder(/Escribe un mensaje/i).fill('Admin: Tarea asignada a @ana.martinez y @luis.rodriguez')
      await page.click('button[aria-label="Enviar mensaje"]')
      await expect(page.getByText(/Tarea asignada a/)).toBeVisible()
    } catch (e) {
      ctx.logError('Admin Chat Interno', 'Falla al enviar mensaje en chat Equipo', e)
    }
  })

  test('2. Worker: login → verificar proyecto → comentar → chat', async ({ context, page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[BROWSER] ${msg.text()}`)
    })

    try {
      await logout(page, context)
      await loginAs(page, 'ana.martinez@cima.dev', 'Demo123!', expect)
    } catch (e) {
      ctx.logError('Worker Login', 'Falla al iniciar sesion como worker', e)
      return
    }

    try {
      await page.getByRole('button', { name: 'Colaboración' }).click()
      await page.locator(`button[aria-label*="Abrir proyecto ${ctx.projectName}"]`).or(page.locator(`button:has-text("${ctx.projectName}")`).filter({ visible: true })).first().click()
      await expect(page.getByRole('heading', { name: ctx.projectName })).toBeVisible({ timeout: 10000 })
    } catch (e) {
      ctx.logError('Worker Abrir Proyecto', `Falla al abrir proyecto "${ctx.projectName}"`, e)
      return
    }

    try {
      const taskCard = page.locator(`button[aria-label*="Tarea: ${ctx.taskTitle}"]`)
      await expect(taskCard).toBeVisible()
      await taskCard.click()
    } catch (e) {
      ctx.logError('Worker Verificar Tarea', `La tarea "${ctx.taskTitle}" no es visible para el worker`, e)
      return
    }

    try {
      await page.getByRole('tab', { name: 'Comentarios' }).click()
      await expect(page.getByText('Admin: Comentario inicial de smoke test.')).toBeVisible()
    } catch (e) {
      ctx.logError('Worker Verificar Comentario', 'El comentario del admin no es visible', e)
    }

    try {
      await page.getByPlaceholder(/Escribe un comentario/i).fill('Worker: Recibido, revisando.')
      await page.getByRole('button', { name: 'Comentar' }).click()
      await expect(page.getByText('Worker: Recibido, revisando.')).toBeVisible()
    } catch (e) {
      ctx.logError('Worker Comentar', 'Falla al agregar comentario del worker', e)
    }

    try {
      await page.getByRole('button', { name: 'Cerrar panel' }).click()
    } catch (e) {
      ctx.logError('Worker Cerrar Panel', 'Falla al cerrar panel', e)
    }

    try {
      await page.getByRole('tab', { name: /conversaci[oó]n/i }).click()
      await page.getByRole('tab', { name: 'Equipo' }).click()
      await expect(page.getByText(/Tarea asignada a/)).toBeVisible()
    } catch (e) {
      ctx.logError('Worker Chat Equipo', 'El mensaje del chat Equipo no es visible', e)
    }

    try {
      await page.getByPlaceholder(/Escribe un mensaje/i).fill('Worker: Entendido, empezando.')
      await page.click('button[aria-label="Enviar mensaje"]')
      await expect(page.getByText('Worker: Entendido, empezando.')).toBeVisible()
    } catch (e) {
      ctx.logError('Worker Responder Chat', 'Falla al responder en chat Equipo', e)
    }
  })

  test('3. Client: login → verificar brief → aislamiento → chat', async ({ context, page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[BROWSER] ${msg.text()}`)
    })

    try {
      await logout(page, context)
      await loginAs(page, 'contacto@restauranteelbuensabor.com', 'Demo123!', expect)
    } catch (e) {
      ctx.logError('Client Login', 'Falla al iniciar sesion como client', e)
      return
    }

    try {
      await page.getByRole('button', { name: 'Colaboración' }).click()
      await page.locator(`button[aria-label*="Abrir proyecto ${ctx.projectName}"]`).or(page.locator(`button:has-text("${ctx.projectName}")`).filter({ visible: true })).first().click()
      await expect(page.getByRole('heading', { name: ctx.projectName })).toBeVisible({ timeout: 10000 })
    } catch (e) {
      ctx.logError('Client Abrir Proyecto', `Falla al abrir proyecto "${ctx.projectName}"`, e)
      return
    }

    try {
      await page.getByRole('tab', { name: 'Brief' }).click()
      const briefContainer = page.locator('div[role="region"][aria-label="Brief del proyecto"] div.whitespace-pre-wrap')
      await expect(briefContainer).toHaveText(ctx.projectBrief)
    } catch (e) {
      ctx.logError('Client Brief', 'El contenido del brief no coincide', e)
    }

    try {
      await page.getByRole('tab', { name: /conversaci[oó]n/i }).click()
      await expect(page.getByText('Admin: Iniciando comunicacion del proyecto smoke.')).toBeVisible()
    } catch (e) {
      ctx.logError('Client Chat Cliente', 'El chat Cliente no es visible o no tiene mensajes', e)
    }

    try {
      const teamTab = page.getByRole('tab', { name: 'Equipo' })
      const isVisible = await teamTab.isVisible()
      if (isVisible) {
        ctx.logError('Client Aislamiento', 'SEGURIDAD: El cliente puede ver el tab Equipo!', new Error('Security breach: client sees internal chat'))
      }
    } catch (e) {
      if (!e.message?.includes('Security breach')) {
        ctx.logError('Client Aislamiento', 'Falla al verificar aislamiento de tab Equipo', e)
      }
    }

    try {
      await page.getByPlaceholder(/Escribe un mensaje/i).fill('Cliente: Confirmado, todo se ve bien.')
      await page.click('button[aria-label="Enviar mensaje"]')
      await expect(page.getByText('Cliente: Confirmado, todo se ve bien.')).toBeVisible()
    } catch (e) {
      ctx.logError('Client Responder Chat', 'Falla al responder en chat Cliente', e)
    }
  })

  test.afterAll(async () => {
    const reportPath = path.join(__dirname, '..', 'VerificationReport.md')
    writeVerificationReport(reportPath, ctx.suffix, ctx.errors)
    expect(ctx.errors.length, `${ctx.errors.length} smoke test error(s) detected`).toBe(0)
  })
})
