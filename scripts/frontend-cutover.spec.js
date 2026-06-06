const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, expect } = require('@playwright/test')

test('cutover frontend flow works against the multi-repo stack', async ({ page }) => {
  page.on('console', msg => console.log(`[BROWSER CUTOVER CONSOLE] ${msg.type()}: ${msg.text()}`))
  const suffix = Date.now().toString()
  const projectName = `Proyecto Cutover ${suffix}`
  const taskTitle = `Tarea Cutover ${suffix}`
  const uploadTitle = `Archivo Cutover ${suffix}`
  const uploadNote = `Subido desde Playwright ${suffix}`
  const uploadFile = path.join(os.tmpdir(), `crm-cutover-${suffix}.txt`)

  fs.writeFileSync(uploadFile, `cutover check ${suffix}\n`, 'utf8')

  await page.goto('/login')
  await page.getByLabel('Correo').fill('admin@cima.dev')
  await page.getByLabel('Contrasena').fill('Admin123!')
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page).toHaveURL(/\/dashboard/)
  await page.getByRole('button', { name: 'Colaboración' }).click()
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' })).toBeVisible()

  await page.getByRole('button', { name: 'Nuevo proyecto' }).click()
  const createProjectDialog = page.getByRole('dialog')
  await createProjectDialog.locator('#cp-name').fill(projectName)
  await createProjectDialog.locator('#cp-type').click()
  await page.getByRole('option', { name: /Campana \/ Servicio/i }).click()

  await createProjectDialog.getByPlaceholder(/cliente/i).fill('contacto@restauranteelbuensabor.com')
  await expect(page.getByRole('option', { name: /contacto@restauranteelbuensabor\.com/i })).toBeVisible()
  await page.getByRole('option', { name: /contacto@restauranteelbuensabor\.com/i }).click()

  await createProjectDialog.getByPlaceholder(/trabajador/i).fill('ana.martinez@cima.dev')
  await expect(page.getByRole('option', { name: /ana\.martinez@cima\.dev/i })).toBeVisible()
  await page.getByRole('option', { name: /ana\.martinez@cima\.dev/i }).click()

  await createProjectDialog.locator('#cp-desc').fill(`Descripcion ${suffix}`)
  await createProjectDialog.locator('#cp-brief').fill(`Brief ${suffix}`)
  await createProjectDialog.getByRole('button', { name: 'Crear proyecto' }).click()

  await expect(page.getByRole('heading', { name: projectName })).toBeVisible()

  await page.getByRole('button', { name: /Crear tarea en/i }).first().click()
  await page.locator('#ct-title').fill(taskTitle)
  await page.locator('#ct-desc').fill(`Detalle ${suffix}`)
  await page.getByRole('button', { name: 'Crear tarea' }).click()

  await expect(page.getByLabel(new RegExp(`Tarea: ${taskTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible()
  await page.getByLabel(new RegExp(`Tarea: ${taskTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)).click()

  await page.getByRole('tab', { name: 'Archivos' }).click()
  await page.getByRole('button', { name: 'Adjuntar archivo' }).click()
  await page.locator('#tf-title').fill(uploadTitle)
  await page.locator('#tf-desc').fill(uploadNote)
  await page.getByLabel('Seleccionar archivo').setInputFiles(uploadFile)
  await page.getByRole('button', { name: 'Subir archivo' }).click()

  await expect(page.locator('div[role="dialog"]').getByText(uploadTitle, { exact: false })).toBeVisible({ timeout: 60_000 })
})
