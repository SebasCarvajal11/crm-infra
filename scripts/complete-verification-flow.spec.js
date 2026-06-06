const fs = require('node:fs')
const path = require('node:path')
const { test, expect } = require('@playwright/test')

test('Complete E2E Verification Walkthrough: Admin, Worker, and Client', async ({ context, page }) => {
  const errors = []
  const logError = (stepName, detail, error) => {
    const errorMsg = error instanceof Error ? error.message : String(error)
    errors.push({
      step: stepName,
      detail: detail,
      message: errorMsg
    })
    console.error(`[ERROR] Step "${stepName}": ${detail}. Error: ${errorMsg}`)
  }

  // Paths to PDFs created beforehand
  page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`))
  const mensajeTareaPdfPath = path.join(__dirname, 'mensaje_tarea.pdf')
  const saludoPdfPath = path.join(__dirname, 'saludo.pdf')

  const suffix = Date.now().toString()
  const projectName = `Proyecto Olimpo ${suffix}`
  const projectBrief = `Brief del Proyecto Olimpo con sufijo ${suffix}.`
  const projectDesc = `Descripcion del Proyecto Olimpo ${suffix}.`
  const taskTitle = `Diseño y Desarrollo de Menu ${suffix}`

  async function logout(page, context) {
    console.log('Logging out / clearing session...')
    await context.clearCookies()
    await page.evaluate(() => sessionStorage.clear())
    await page.goto('/login')
    await page.waitForTimeout(1000)
  }

  // --- PART 1: ADMINISTRATOR FLOW ---
  console.log('=== PART 1: ADMINISTRATOR FLOW ===')
  try {
    await page.goto('/login')
    await page.getByLabel('Correo').fill('admin@cima.dev')
    await page.getByLabel('Contrasena').fill('Admin123!')
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 })
    console.log('Admin logged in. Navigating to Colaboracion...')
    
    await page.getByRole('button', { name: 'Colaboración' }).click()
    await expect(page.getByRole('button', { name: 'Nuevo proyecto' })).toBeVisible({ timeout: 10000 })
    
    // Create Project
    await page.getByRole('button', { name: 'Nuevo proyecto' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.locator('#cp-name').fill(projectName)
    await dialog.locator('#cp-type').click()
    await page.getByRole('option', { name: /Campana \/ Servicio/i }).click()

    // Add Client: contacto@restauranteelbuensabor.com
    console.log('Adding client: contacto@restauranteelbuensabor.com')
    await dialog.getByPlaceholder('Busca por email del cliente…').fill('contacto@restauranteelbuensabor.com')
    await page.waitForTimeout(1000) // debounce
    await page.getByRole('option', { name: /contacto@restauranteelbuensabor\.com/i }).click()

    // Add Worker 1: ana.martinez@cima.dev
    console.log('Adding worker 1: ana.martinez@cima.dev')
    await dialog.getByPlaceholder('Busca por email del trabajador...').fill('ana.martinez@cima.dev')
    await page.waitForTimeout(1000)
    await page.getByRole('option', { name: /ana\.martinez@cima\.dev/i }).click()

    // Add Worker 2: luis.rodriguez@cima.dev
    console.log('Adding worker 2: luis.rodriguez@cima.dev')
    await dialog.getByPlaceholder('Busca por email del trabajador...').fill('luis.rodriguez@cima.dev')
    await page.waitForTimeout(1000)
    await page.getByRole('option', { name: /luis\.rodriguez@cima\.dev/i }).click()

    await dialog.locator('#cp-desc').fill(projectDesc)
    await dialog.locator('#cp-brief').fill(projectBrief)

    await dialog.getByRole('button', { name: 'Crear proyecto' }).click()
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 15000 })
    console.log(`Project "${projectName}" created.`)

    // Create 1 Task with 3 subtasks
    console.log('Creating task...')
    await page.getByRole('button', { name: /Crear tarea en/i }).first().click()
    const taskDialog = page.getByRole('dialog')
    await expect(taskDialog).toBeVisible()

    await taskDialog.locator('#ct-title').fill(taskTitle)
    await taskDialog.locator('#ct-desc').fill(`Detalles de la tarea de menu para Olimpo.`)

    // Assign Workers
    await page.locator('button:has-text("Seleccionar...")').first().click()
    await page.getByRole('option', { name: /ana\.martinez/i }).click()

    await page.locator('button:has-text("Seleccionar...")').first().click()
    await page.getByRole('option', { name: /luis\.rodriguez/i }).click()

    // Add Subtask 1: Assigned to ana.martinez
    await page.getByPlaceholder('Descripcion de la subtarea...').fill('Subtarea Ana: Diseñar boceto')
    await page.click('button:has-text("Sin asignar")')
    await page.getByRole('option', { name: /ana\.martinez/i }).click()
    await page.getByPlaceholder('Descripcion de la subtarea...').press('Enter')

    // Add Subtask 2: Assigned to luis.rodriguez
    await page.getByPlaceholder('Descripcion de la subtarea...').fill('Subtarea Luis: Revisar precios')
    await page.click('button:has-text("Sin asignar")')
    await page.getByRole('option', { name: /luis\.rodriguez/i }).click()
    await page.getByPlaceholder('Descripcion de la subtarea...').press('Enter')

    // Add Subtask 3: Unassigned
    await page.getByPlaceholder('Descripcion de la subtarea...').fill('Subtarea General: Enviar a imprenta')
    await page.getByPlaceholder('Descripcion de la subtarea...').press('Enter')

    // Submit Task
    await taskDialog.getByRole('button', { name: 'Crear tarea' }).click()
    await expect(taskDialog).not.toBeVisible({ timeout: 10000 })
    console.log('Task created with subtasks.')

    // Add comment and upload PDF in the task
    const taskCard = page.locator(`button[aria-label*="Tarea: ${taskTitle}"]`)
    await expect(taskCard).toBeVisible()
    await taskCard.click()

    await page.getByRole('tab', { name: 'Comentarios' }).click()
    await page.getByPlaceholder(/Escribe un comentario/i).fill('Admin: Subo los requisitos iniciales en PDF.')
    await page.getByRole('button', { name: 'Comentar' }).click()
    await page.waitForTimeout(1000)

    await page.getByRole('tab', { name: 'Archivos' }).click()
    await page.getByRole('button', { name: 'Adjuntar archivo' }).click()
    await page.locator('#tf-title').fill('RequisitosMenu')
    await page.locator('#tf-desc').fill('Detalles en PDF para el menu')
    await page.getByLabel('Seleccionar archivo').setInputFiles(mensajeTareaPdfPath)
    await page.locator('div[role="dialog"] button:has-text("Subir archivo")').click()
    await expect(page.locator('div[role="dialog"]').getByText('RequisitosMenu')).toBeVisible({ timeout: 30000 })
    console.log('File uploaded to task.')

    await page.getByRole('button', { name: 'Cerrar panel' }).click()

    // Chats and Mentions
    await page.getByRole('tab', { name: 'Conversacion' }).click()

    // External Chat
    await page.getByRole('tab', { name: 'Cliente' }).click()
    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Admin: Hola estimado cliente, iniciamos el proyecto.')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)
    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Admin: Por favor @contacto confirme recepcion.')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    // Internal Chat
    await page.getByRole('tab', { name: 'Equipo' }).click()
    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Admin: Hola equipo. Favor revisar tareas.')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)
    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Admin: Prioridad alta para @ana.martinez y @luis.rodriguez')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    // Upload file in Conversation
    await page.locator('#conv-file-title').fill('GuiaEstilo')
    await page.locator('textarea[placeholder="Descripcion opcional del archivo"]').fill('Guia de estilo oficial')
    await page.locator('#tabpanel-chat input[type="file"]').setInputFiles(saludoPdfPath)
    await page.locator('#tabpanel-chat button:has-text("Subir archivo")').click()
    await expect(page.locator('article:has-text("GuiaEstilo")')).toBeVisible({ timeout: 60000 })
    console.log('File uploaded to conversation timeline.')

  } catch (error) {
    logError('Administrador Flow', 'Falla en el flujo del administrador', error)
  }

  // --- PART 2: WORKER FLOW ---
  console.log('=== PART 2: WORKER FLOW ===')
  try {
    await logout(page, context)

    await page.getByLabel('Correo').fill('ana.martinez@cima.dev')
    await page.getByLabel('Contrasena').fill('Demo123!')
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 })
    console.log('Worker Ana Martinez logged in. Navigating to Colaboracion...')

    await page.getByRole('button', { name: 'Colaboración' }).click()
    await page.click(`button:has-text("${projectName}")`)
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 10000 })
    console.log('Project opened by Worker.')

    // Verify task and subtasks
    const taskCard = page.locator(`button[aria-label*="Tarea: ${taskTitle}"]`)
    await expect(taskCard).toBeVisible()
    await taskCard.click()

    // Verify admin comment and file in task
    await page.getByRole('tab', { name: 'Comentarios' }).click()
    await expect(page.getByText('Admin: Subo los requisitos iniciales en PDF.')).toBeVisible()

    await page.getByRole('tab', { name: 'Archivos' }).click()
    await expect(page.locator('div[role="dialog"]').getByText('RequisitosMenu')).toBeVisible()

    // Add comment from worker inside task
    await page.getByRole('tab', { name: 'Comentarios' }).click()
    await page.getByPlaceholder(/Escribe un comentario/i).fill('Ana: Recibido admin, revisando los requisitos.')
    await page.getByRole('button', { name: 'Comentar' }).click()
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: 'Cerrar panel' }).click()

    // Verify conversation messages
    await page.getByRole('tab', { name: 'Conversacion' }).click()
    await page.getByRole('tab', { name: 'Equipo' }).click()

    await expect(page.getByText("Admin: Prioridad alta para @ana.martinez y @luis.rodriguez")).toBeVisible()
    await expect(page.locator('article:has-text("GuiaEstilo")')).toBeVisible()

    // Send reply from worker in chat
    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Ana: Enterada del mensaje admin, ya respondi en la tarea.')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    console.log('Worker flow verified successfully.')
  } catch (error) {
    logError('Worker Flow', 'Falla en el flujo del trabajador', error)
  }

  // --- PART 3: CLIENT FLOW ---
  console.log('=== PART 3: CLIENT FLOW ===')
  try {
    await logout(page, context)

    await page.getByLabel('Correo').fill('contacto@restauranteelbuensabor.com')
    await page.getByLabel('Contrasena').fill('Demo123!')
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 })
    console.log('Client logged in. Navigating to Colaboracion...')

    await page.getByRole('button', { name: 'Colaboración' }).click()
    await page.click(`button:has-text("${projectName}")`)
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 10000 })
    console.log('Project opened by Client.')

    // Check project Brief
    await page.getByRole('tab', { name: 'Brief' }).click()
    await expect(page.locator('div[role="region"][aria-label="Brief del proyecto"] div.whitespace-pre-wrap')).toHaveText(projectBrief)

    // Check external chat (Cliente)
    await page.getByRole('tab', { name: 'Conversacion' }).click()

    await expect(page.getByText("Admin: Por favor @contacto confirme recepcion.")).toBeVisible()

    // Verify the Client CANNOT see the internal team chat tab
    const teamTab = page.getByRole('tab', { name: 'Equipo' })
    const isTeamTabVisible = await teamTab.isVisible()
    if (isTeamTabVisible) {
      logError('Client Flow', 'Client is able to see the internal Team chat tab!', new Error('Security Breach: Client sees internal chat'))
    } else {
      console.log('Security check passed: Client cannot see the internal Team chat tab.')
    }

    // Send reply from Client in the external chat
    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Cliente: Confirmado admin, todo se ve muy bien. Gracias.')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    console.log('Client flow verified successfully.')
  } catch (error) {
    logError('Client Flow', 'Falla en el flujo del cliente', error)
  }

  // --- REPORT ---
  const reportPath = path.join(__dirname, '..', 'VerificationReport.md')
  let reportContent = '# Informe de Verificación de Flujo E2E - CIMA CRM\n\n'
  reportContent += `**Fecha y Hora:** ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n`
  reportContent += `**Sufijo de Ejecución:** \`${suffix}\`\n\n`

  if (errors.length === 0) {
    reportContent += `## Resultado General\n\n✅ **Todas las acciones se completaron exitosamente sin errores.**\n\n- Se verificó la creación de proyectos, tareas, subtareas y asignaciones del Admin.\n- Se validó la subida de archivos y los comentarios dentro de las tareas.\n- Se comprobó el flujo de menciones y mensajería en chats interno (Equipo) y externo (Cliente).\n- Se verificó la coherencia de visualización del Trabajador implicado.\n- Se verificó el aislamiento de canales y la visibilidad correspondiente en el panel del Cliente.\n`
  } else {
    reportContent += `## Resultado General\n\n⚠️ **Se detectaron errores durante la verificación.** Detalles a continuación:\n\n`
    errors.forEach((err, idx) => {
      reportContent += `### Error #${idx + 1}: ${err.step}\n`
      reportContent += `- **Detalle:** ${err.detail}\n`
      reportContent += `- **Error:** \`${err.message}\`\n\n`
    })
  }

  fs.writeFileSync(reportPath, reportContent, 'utf8')
  console.log(`Report written to ${reportPath}`)

  expect(errors.length).toBe(0)
})
