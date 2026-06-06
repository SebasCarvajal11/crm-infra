const fs = require('node:fs')
const path = require('node:path')
const { test, expect } = require('@playwright/test')

test('UI Debug Screenshot', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Correo').fill('gerente@cima.dev')
  await page.getByLabel('Contrasena').fill('Demo123!')
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page).toHaveURL(/\/dashboard/)
  await page.getByRole('button', { name: 'Colaboración' }).click()
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' })).toBeVisible({ timeout: 10000 })

  // Click the first project card if there is any, or click "Nuevo proyecto"
  // Wait, let's see if there is any project card already on the board.
  // In Colaboracion, let's click the first project workspace we see.
  // Wait, let's see how project cards are matched.
  // We can click the first button containing the text "Proyecto Modabella" or click a project title.
  // Let's print project titles first.
  const projects = await page.locator('h3').allTextContents()
  console.log('Project titles / column titles:', projects)

  // Take a screenshot of the project board list
  await page.screenshot({ path: path.join(__dirname, '..', 'collab_projects.png') })
  console.log('Screenshot of projects list saved.')
})
