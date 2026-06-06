const fs = require('node:fs')
const path = require('node:path')
const { test, expect } = require('@playwright/test')

test('Task Modal Debug Screenshot', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Correo').fill('gerente@cima.dev')
  await page.getByLabel('Contrasena').fill('Demo123!')
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page).toHaveURL(/\/dashboard/)
  await page.getByRole('button', { name: 'Colaboración' }).click()
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' })).toBeVisible({ timeout: 10000 })

  // Click the project card
  await page.click('button:has-text("Proyecto Modabella")')
  
  // Wait for the project heading to be visible
  await expect(page.getByRole('heading', { name: /Proyecto Modabella/ })).toBeVisible({ timeout: 10000 })
  console.log('Project workspace loaded.')

  // Take a screenshot of the project workspace board
  await page.screenshot({ path: path.join(__dirname, '..', 'project_workspace_board.png') })
  console.log('Screenshot of workspace board saved.')

  // Click "Crear tarea en..." in the first column
  const createBtn = page.getByRole('button', { name: /Crear tarea en/i }).first()
  await expect(createBtn).toBeVisible()
  await createBtn.click()

  // Wait for the Dialog to be visible
  const taskDialog = page.getByRole('dialog')
  await expect(taskDialog).toBeVisible()

  // Take a screenshot of the task modal
  await page.screenshot({ path: path.join(__dirname, '..', 'task_modal_open.png') })
  console.log('Screenshot of task modal saved.')
})
