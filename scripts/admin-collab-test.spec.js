const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, expect } = require('@playwright/test')

test('Administrator Collaboration E2E flow verification', async ({ context, page }) => {
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

  // --- Step 1: Login ---
  console.log('--- Step 1: Logging in as Admin ---')
  try {
    await page.goto('/login')
    await page.getByLabel('Correo').fill('gerente@cima.dev')
    await page.getByLabel('Contrasena').fill('Demo123!')
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 })
    console.log('Successfully logged in. Navigating to Colaboracion...')
    
    await page.getByRole('button', { name: 'Colaboración' }).click()
    // Verify that the "Nuevo proyecto" button is visible
    await expect(page.getByRole('button', { name: 'Nuevo proyecto' })).toBeVisible({ timeout: 10000 })
    console.log('Colaboracion panel loaded successfully.')
  } catch (error) {
    logError('1. Iniciar y login', 'Falla al iniciar sesión o acceder a la pestaña de colaboración', error)
  }

  // --- Step 2: Create a new project ---
  console.log('--- Step 2: Creating a new project ---')
  const suffix = Date.now().toString()
  const projectName = `Proyecto Modabella ${suffix}`
  const projectBrief = `Este es el brief inicial del proyecto Modabella con sufijo ${suffix}.`
  const projectDesc = `Descripcion detallada para el proyecto Modabella ${suffix}.`
  
  try {
    await page.getByRole('button', { name: 'Nuevo proyecto' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.locator('#cp-name').fill(projectName)
    
    // Choose project type: click and select Campana / Servicio
    await dialog.locator('#cp-type').click()
    await page.getByRole('option', { name: /Campana \/ Servicio/i }).click()

    // Add Client: info@modabella.com
    console.log('Adding client: info@modabella.com')
    await dialog.getByPlaceholder('Busca por email del cliente…').fill('info@modabella.com')
    await page.waitForTimeout(1000) // wait for debounce
    await page.getByRole('option', { name: /info@modabella\.com/i }).click()

    // Add Worker 1: ana.martinez@cima.dev
    console.log('Adding worker 1: ana.martinez@cima.dev')
    await dialog.getByPlaceholder('Busca por email del trabajador...').fill('ana.martinez@cima.dev')
    await page.waitForTimeout(1000) // wait for debounce
    await page.getByRole('option', { name: /ana\.martinez@cima\.dev/i }).click()

    // Add Worker 2: luis.rodriguez@cima.dev
    console.log('Adding worker 2: luis.rodriguez@cima.dev')
    await dialog.getByPlaceholder('Busca por email del trabajador...').fill('luis.rodriguez@cima.dev')
    await page.waitForTimeout(1000) // wait for debounce
    await page.getByRole('option', { name: /luis\.rodriguez@cima\.dev/i }).click()

    await dialog.locator('#cp-desc').fill(projectDesc)
    await dialog.locator('#cp-brief').fill(projectBrief)

    // Submit
    await dialog.getByRole('button', { name: 'Crear proyecto' }).click()
    
    // Wait for project heading
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 15000 })
    console.log(`Project "${projectName}" created successfully.`)
  } catch (error) {
    logError('2. Crear proyecto nuevo', 'Falla al llenar o enviar el formulario de nuevo proyecto', error)
  }

  // --- Step 3: Create 5 tasks with 3 subtasks each ---
  console.log('--- Step 3: Creating 5 tasks with 3 subtasks each ---')
  const taskTitles = []
  for (let i = 1; i <= 5; i++) {
    const taskTitle = `Tarea ${i} - ${suffix}`
    taskTitles.push(taskTitle)
    console.log(`Creating ${taskTitle}...`)
    try {
      await page.getByRole('button', { name: /Crear tarea en/i }).first().click()
      
      const taskDialog = page.getByRole('dialog')
      await expect(taskDialog).toBeVisible()

      await taskDialog.locator('#ct-title').fill(taskTitle)
      await taskDialog.locator('#ct-desc').fill(`Detalles de la tarea ${i} del proyecto modabella.`)
      
      // Assign Workers to the Task
      console.log('Assigning workers to the task...')
      await page.locator('button:has-text("Seleccionar...")').first().click()
      await page.getByRole('option', { name: /ana\.martinez/i }).click()

      await page.locator('button:has-text("Seleccionar...")').first().click()
      await page.getByRole('option', { name: /luis\.rodriguez/i }).click()

      // Add Subtask 1: Assigned to ana.martinez
      console.log('Adding subtask 1...')
      await page.getByPlaceholder('Descripcion de la subtarea...').fill(`Subtarea 1 para ${taskTitle}`)
      await page.click('button:has-text("Sin asignar")')
      await page.getByRole('option', { name: /ana\.martinez/i }).click()
      await page.getByPlaceholder('Descripcion de la subtarea...').press('Enter')

      // Add Subtask 2: Assigned to luis.rodriguez
      console.log('Adding subtask 2...')
      await page.getByPlaceholder('Descripcion de la subtarea...').fill(`Subtarea 2 para ${taskTitle}`)
      await page.click('button:has-text("Sin asignar")')
      await page.getByRole('option', { name: /luis\.rodriguez/i }).click()
      await page.getByPlaceholder('Descripcion de la subtarea...').press('Enter')

      // Add Subtask 3: Unassigned
      console.log('Adding subtask 3...')
      await page.getByPlaceholder('Descripcion de la subtarea...').fill(`Subtarea 3 para ${taskTitle}`)
      await page.getByPlaceholder('Descripcion de la subtarea...').press('Enter')

      // Submit task
      await taskDialog.getByRole('button', { name: 'Crear tarea' }).click()
      
      // Wait for task dialog to close
      await expect(taskDialog).not.toBeVisible({ timeout: 10000 })
      console.log(`Task ${i} created.`)
    } catch (error) {
      logError('3. Crear 5 tareas y subtareas', `Falla al crear la tarea ${i} (${taskTitle})`, error)
      // Try to close dialog if it's open to not block next tasks
      try {
        await page.click('button:has-text("Cancelar")')
      } catch (e) {}
    }
  }

  // Verify tasks are present on the board
  for (const title of taskTitles) {
    try {
      const taskCard = page.locator(`button[aria-label*="Tarea: ${title}"]`)
      await expect(taskCard).toBeVisible()
    } catch (error) {
      logError('3. Verificar tareas', `La tarea "${title}" no es visible en el tablero`, error)
    }
  }

  // --- Step 4: Add comment and upload PDF in each task ---
  console.log('--- Step 4: Write message and upload PDF in each task ---')
  for (const title of taskTitles) {
    console.log(`Opening sheet for task: ${title}...`)
    try {
      const taskCard = page.locator(`button[aria-label*="Tarea: ${title}"]`)
      await taskCard.click()

      // Click Comments tab
      console.log('Navigating to Comments tab...')
      await page.getByRole('tab', { name: 'Comentarios' }).click()
      
      // Type comment
      await page.getByPlaceholder(/Escribe un comentario/i).fill(`Comentario para la tarea ${title}`)
      await page.getByRole('button', { name: 'Comentar' }).click()
      // Wait a moment for comment to be created
      await page.waitForTimeout(1000)

      // Click Files tab
      console.log('Navigating to Files tab...')
      await page.getByRole('tab', { name: 'Archivos' }).click()

      // Click Adjuntar archivo
      await page.getByRole('button', { name: 'Adjuntar archivo' }).click()
      
      // Fill file details
      await page.locator('#tf-title').fill(`Archivo_${title}.pdf`)
      await page.locator('#tf-desc').fill(`Mensaje de tarea en pdf para ${title}`)
      
      // Use specific file input label inside task files tab
      await page.getByLabel('Seleccionar archivo').setInputFiles(mensajeTareaPdfPath)
      
      // Upload using specific dialog button
      await page.locator('div[role="dialog"] button:has-text("Subir archivo")').click()
      
      // Wait for uploaded file to show up
      await expect(page.locator('div[role="dialog"]').getByText(`Archivo_${title}.pdf`)).toBeVisible({ timeout: 30000 })
      console.log(`File uploaded successfully for task: ${title}. Closing sheet.`)

      // Close Sheet
      await page.getByRole('button', { name: 'Cerrar panel' }).click()
    } catch (error) {
      logError('4. Comentarios y archivos de tarea', `Falla en comentarios o archivo para la tarea "${title}"`, error)
      // Attempt to close panel if open
      try { await page.getByRole('button', { name: 'Cerrar panel' }).click() } catch (e) {}
    }
  }

  // --- Step 5: Conversations & @ mentions ---
  console.log('--- Step 5: Chat conversations and @ mentions ---')
  try {
    await page.getByRole('tab', { name: 'Conversacion' }).click()

    // 1. External chat (Cliente)
    console.log('external chat (Cliente)...')
    await page.getByRole('tab', { name: 'Cliente' }).click()
    
    // Greeting
    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Hola a todos. Iniciando la comunicación del proyecto.')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    // Mentions
    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Hola @info')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Hola @ana.martinez')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Hola @luis.rodriguez')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    // 2. Internal chat (Equipo)
    console.log('internal chat (Equipo)...')
    await page.getByRole('tab', { name: 'Equipo' }).click()

    // Greeting
    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Hola a todo el equipo de trabajo. Bienvenidos.')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    // Mentions
    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Hola @ana.martinez')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    await page.getByPlaceholder(/Escribe un mensaje/i).fill('Hola @luis.rodriguez')
    await page.click('button[aria-label="Enviar mensaje"]')
    await page.waitForTimeout(1000)

    console.log('Mentions sent successfully.')
  } catch (error) {
    logError('5. Menciones en Conversación', 'Falla al enviar mensajes o realizar menciones en el chat', error)
  }

  // --- Step 6: Upload PDF in Conversation ---
  console.log('--- Step 6: Uploading PDF in Conversation ---')
  try {
    await page.locator('#conv-file-title').fill('ArchivoSaludoOficial')
    await page.locator('textarea[placeholder="Descripcion opcional del archivo"]').fill('Saludo oficial de bienvenida en formato PDF')
    
    // File input inside chat tab panel
    await page.locator('#tabpanel-chat input[type="file"]').setInputFiles(saludoPdfPath)
    
    // Click Upload inside chat tab panel
    await page.locator('#tabpanel-chat button:has-text("Subir archivo")').click()

    // Wait for timeline item to appear in trazabilidad
    await expect(page.locator('article:has-text("ArchivoSaludoOficial")')).toBeVisible({ timeout: 60000 })
    console.log('Conversation file uploaded successfully.')
  } catch (error) {
    logError('6. Subir archivo en conversación', 'Falla al subir el PDF de saludo en la sección de conversación', error)
  }

  // --- Step 7: Preview uploaded PDF from timeline ---
  console.log('--- Step 7: Previewing PDF from Trazabilidad ---')
  try {
    const previewBtn = page.locator('article:has-text("ArchivoSaludoOficial") button:has-text("Previsualizar")')
    await previewBtn.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 60000 })
    await expect(dialog.locator('iframe')).toBeVisible({ timeout: 60000 })
    console.log('PDF preview dialog is visible and iframe is loaded.')

    // Close preview dialog
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    console.log('Preview dialog closed successfully.')
  } catch (error) {
    logError('7. Previsualizar archivo de trazabilidad', 'Falla al abrir o validar la previsualización del PDF', error)
  }

  // --- Step 8: Brief verification ---
  console.log('--- Step 8: Verifying Brief content ---')
  try {
    await page.getByRole('tab', { name: 'Brief' }).click()
    const briefContainer = page.locator('div[role="region"][aria-label="Brief del proyecto"] div.whitespace-pre-wrap')
    await expect(briefContainer).toHaveText(projectBrief)
    console.log('Brief content matches the brief set at project creation.')
  } catch (error) {
    logError('8. Verificar Brief', 'El contenido del brief no coincide o no es visible', error)
  }

  // --- Step 9: Members verification ---
  console.log('--- Step 9: Verifying Members information ---')
  try {
    await page.getByRole('tab', { name: 'Integrantes' }).click()

    // Verify Admin Card: gerente@cima.dev
    const adminCard = page.locator('#tabpanel-members article:has-text("gerente@cima.dev")')
    await expect(adminCard).toBeVisible()
    await expect(adminCard.locator('p:has-text("Administrador")')).toBeVisible()

    // Verify Worker Card 1: ana.martinez@cima.dev
    const workerCard1 = page.locator('#tabpanel-members article:has-text("ana.martinez@cima.dev")')
    await expect(workerCard1).toBeVisible()
    await expect(workerCard1.locator('p:has-text("Trabajador")')).toBeVisible()

    // Verify Worker Card 2: luis.rodriguez@cima.dev
    const workerCard2 = page.locator('#tabpanel-members article:has-text("luis.rodriguez@cima.dev")')
    await expect(workerCard2).toBeVisible()
    await expect(workerCard2.locator('p:has-text("Trabajador")')).toBeVisible()

    // Verify Client Card: info@modabella.com
    const clientCard = page.locator('#tabpanel-members article:has-text("info@modabella.com")')
    await expect(clientCard).toBeVisible()
    await expect(clientCard.locator('p:has-text("Cliente")')).toBeVisible()

    console.log('All members are listed with correct information.')
  } catch (error) {
    logError('9. Verificar Integrantes', 'Falla al verificar los integrantes o su rol/información en el proyecto', error)
  }

  // --- Step 10: Session persistence and redirect check ---
  console.log('--- Step 10: Testing session redirect without logout ---')
  try {
    // Open another page in the same context to share session/localStorage
    const page2 = await context.newPage()
    page2.on('console', msg => console.log(`[BROWSER PAGE2 CONSOLE] ${msg.type()}: ${msg.text()}`))
    await page2.goto('/login')
    
    // It should immediately redirect to /dashboard and not show the login page
    await expect(page2).toHaveURL(/\/dashboard/)
    
    // Check that we don't see the login form
    const loginForm = page2.locator('form')
    await expect(loginForm).not.toBeVisible()

    console.log('Session is properly maintained and login page redirects authenticated users.')
    await page2.close()
  } catch (error) {
    logError('10. Prueba de sesión persistente', 'El sistema permitió acceder a /login o no redirigió correctamente', error)
  }

  // Write report "Informe.md" to project root
  console.log('--- Process completed. Writing report if errors found ---')
  const reportPath = path.join(__dirname, '..', 'Informe.md') // root is one level up from scripts
  
  let reportContent = '# Informe de Verificación de Funcionalidades - Administrador\n\n'
  reportContent += `**Fecha y Hora:** ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n`
  reportContent += `**Usuario de Pruebas:** Admin (gerente@cima.dev)\n\n`
  
  if (errors.length === 0) {
    reportContent += `## Resultado General\n\n✅ **Todas las acciones se completaron exitosamente sin errores.**\n\nNo se encontraron fallas en el flujo de Colaboración ni en el manejo de sesiones del administrador.\n`
  } else {
    reportContent += `## Resultado General\n\n⚠️ **Se detectaron errores en el flujo del proceso.** A continuación se detallan las fallas encontradas:\n\n`
    errors.forEach((err, idx) => {
      reportContent += `### Falla #${idx + 1}: ${err.step}\n`
      reportContent += `- **Momento del proceso:** ${err.detail}\n`
      reportContent += `- **Error reportado:** \`${err.message}\`\n`
      reportContent += `- **Recomendación para solución:**\n`
      
      // Provide context-aware recommendations
      if (err.step.includes('Login')) {
        reportContent += `  - Verificar el estado de \`crm-auth\` y \`api-gateway\`.\n  - Revisar si el usuario \`gerente@cima.dev\` está debidamente registrado y activo en la base de datos con contraseña \`Demo123!\`.\n`
      } else if (err.step.includes('Crear proyecto')) {
        reportContent += `  - Asegurar que \`crm-collab\` esté respondiendo y se conecte a la base de datos Postgres.\n  - Validar que los usuarios \`info@modabella.com\` y \`ana.martinez@cima.dev\` existan en la base de datos de Auth, y que el Gateway permita su resolución.\n`
      } else if (err.step.includes('tareas')) {
        reportContent += `  - Verificar la inserción de tareas en la base de datos de \`crm-collab\`.\n  - Validar si hay conflictos al relacionar los subjects de los trabajadores con la tarea.\n`
      } else if (err.step.includes('archivos') || err.step.includes('conversación') || err.step.includes('previsualizar') || err.step.includes('Previsualizar')) {
        reportContent += `  - **Diagnóstico:** El worker \`quarantine-scan\` de \`crm-media\` reporta un error \`InsufficientServicePermissions\` (código 400) al realizar \`copyObject\` en OCI Object Storage. Esto indica que los permisos asignados en Oracle Cloud al Service Principal \`objectstorage-us-sanjose-1\` sobre el bucket \`crm-docs-private\` son insuficientes para mover los archivos desde la carpeta \`quarantine/\` a su ubicación definitiva.\n  - **Recomendación:** Actualizar y verificar las políticas IAM en el panel de control de Oracle Cloud Infrastructure (OCI) para otorgar permisos de lectura, escritura y copia de objetos en el bucket \`crm-docs-private\` al servicio de almacenamiento correspondiente.\n`
      } else if (err.step.includes('Menciones')) {
        reportContent += `  - Validar la conexión con el servidor Redis para el sistema de chat y eventos de colaboración.\n`
      } else if (err.step.includes('Previsualizar')) {
        reportContent += `  - Verificar el endpoint de generación de URLs privadas (PAR) en OCI Object Storage o almacenamiento local, asegurando que devuelva un enlace seguro accesible para el iframe.\n`
      } else {
        reportContent += `  - Revisar la consola y logs del microservicio correspondiente para diagnosticar la falla.\n`
      }
      reportContent += `\n`
    });
  }

  fs.writeFileSync(reportPath, reportContent, 'utf8')
  console.log(`Report written to ${reportPath}`)
})
