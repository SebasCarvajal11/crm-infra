const fs = require('node:fs')
const os = require('node:os')

function createSmokeContext() {
  const suffix = Date.now().toString()
  const errors = []

  const logError = (stepName, detail, error) => {
    const errorMsg = error instanceof Error ? error.message : String(error)
    errors.push({ step: stepName, detail, message: errorMsg })
    console.error(`[ERROR] Step "${stepName}": ${detail}. Error: ${errorMsg}`)
  }

  const makeUploadFile = () => {
    const filePath = `${os.tmpdir()}/crm-smoke-${suffix}.txt`
    fs.writeFileSync(filePath, `smoke test upload ${suffix}\n`, 'utf8')
    return filePath
  }

  return {
    suffix,
    errors,
    logError,
    makeUploadFile,
    projectName: `Smoke Project ${suffix}`,
    projectBrief: `Brief del proyecto smoke con sufijo ${suffix}.`,
    projectDesc: `Descripcion del proyecto smoke ${suffix}.`,
    taskTitle: `Tarea Smoke ${suffix}`,
  }
}

async function logout(page, context) {
  await context.clearCookies()
  await page.goto('/login')
  await page.evaluate(() => sessionStorage.clear()).catch(() => {})
  await page.waitForURL(/\/login/)
}

async function loginAs(page, email, password, expect) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 })
}

function writeVerificationReport(reportPath, suffix, errors) {
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
}

module.exports = {
  createSmokeContext,
  logout,
  loginAs,
  writeVerificationReport,
}
