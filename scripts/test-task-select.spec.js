const fs = require('node:fs')
const path = require('node:path')
const { test, expect } = require('@playwright/test')

test('Task Select Debug', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Correo').fill('gerente@cima.dev')
  await page.getByLabel('Contrasena').fill('Demo123!')
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page).toHaveURL(/\/dashboard/)
  await page.getByRole('button', { name: 'Colaboración' }).click()
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' })).toBeVisible({ timeout: 10000 })

  await page.click('button:has-text("Proyecto Modabella")')
  await expect(page.getByRole('heading', { name: /Proyecto Modabella/ })).toBeVisible({ timeout: 10000 })

  await page.getByRole('button', { name: /Crear tarea en/i }).first().click()
  const taskDialog = page.getByRole('dialog')
  await expect(taskDialog).toBeVisible()

  // Click the worker Select
  console.log('Clicking workers select trigger...')
  const trigger = page.locator('button:has-text("Seleccionar...")').first()
  await trigger.click()
  await page.waitForTimeout(500)

  // Print all options in the page
  const options = await page.getByRole('option').allTextContents()
  console.log('Options found:', options)

  // Select Ana Martinez
  const optionAna = page.getByRole('option', { name: /ana\.martinez/i })
  if (await optionAna.count() > 0) {
    await optionAna.click()
    console.log('Selected Ana Martinez')
  } else {
    console.log('Ana Martinez option not found!')
  }
  
  await page.waitForTimeout(500)

  // Click again to add Luis Rodriguez
  await trigger.click()
  await page.waitForTimeout(500)
  
  const optionLuis = page.getByRole('option', { name: /luis\.rodriguez/i })
  if (await optionLuis.count() > 0) {
    await optionLuis.click()
    console.log('Selected Luis Rodriguez')
  } else {
    console.log('Luis Rodriguez option not found!')
  }

  await page.screenshot({ path: path.join(__dirname, '..', 'task_workers_selected.png') })
  console.log('Screenshot of selected workers saved.')
})
