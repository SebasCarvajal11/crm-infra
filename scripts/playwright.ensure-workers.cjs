const { execFileSync, spawn } = require('node:child_process')
const path = require('node:path')

const workspaceRoot = path.resolve(__dirname, '..', '..')
const collabRepo = path.join(workspaceRoot, 'crm-collab')
const mediaRepo = path.join(workspaceRoot, 'crm-media')

function listProcesses() {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine",
    ],
    { encoding: 'utf8' },
  )
  return output
}

function isWorkerRunning(repoName, workerCommand) {
  const processes = listProcesses().split(/\r?\n/)
  return processes.some(line => line.includes(repoName) && line.includes(workerCommand))
}

function startWorker(repoPath, repoName, workerCommand) {
  if (isWorkerRunning(repoName, workerCommand)) {
    process.stdout.write(`[playwright.ensure-workers] ${repoName} ${workerCommand} ya activo\n`)
    return
  }

  const psCommand = `Set-Location '${repoPath.replace(/'/g, "''")}'; pnpm ${workerCommand}`
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
    {
      cwd: repoPath,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  child.unref()
  process.stdout.write(`[playwright.ensure-workers] iniciado ${repoName} ${workerCommand}\n`)
}

async function globalSetup() {
  startWorker(mediaRepo, 'crm-media', 'worker:quarantine-scan')

  await new Promise((resolve) => setTimeout(resolve, 2000))
}

module.exports = globalSetup
