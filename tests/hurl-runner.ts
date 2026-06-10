import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { glob } from 'node:fs/promises'

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:18080'
const TEST_SUFFIX = `hurl_${Date.now()}`
const LOGIN_IP = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`

const WORKER_EMAIL = process.env.WORKER_EMAIL || 'ana.martinez@cima.dev'
const WORKER_PASSWORD = process.env.WORKER_PASSWORD || 'Demo123!'
const CLIENT_EMAIL = process.env.CLIENT_EMAIL || 'contacto@restauranteelbuensabor.com'
const CLIENT_PASSWORD = process.env.CLIENT_PASSWORD || 'Demo123!'

interface HurlResult {
  file: string
  service: string
  passed: boolean
  duration: number
  exitCode: number | null
  stdout: string
  stderr: string
}

interface FailureAnalysis {
  type: 'INFRASTRUCTURE' | 'AUTH' | 'AUTHZ' | 'ENDPOINT' | 'BACKEND' | 'TIMEOUT' | 'UNKNOWN'
  message: string
  suggestion: string
}

const SERVICE_DIRS: Record<string, string> = {
  auth: path.resolve(__dirname, '../../crm-auth/tests'),
  collab: path.resolve(__dirname, '../../crm-collab/tests'),
  media: path.resolve(__dirname, '../../crm-media/tests'),
  'cross-service': path.resolve(__dirname, 'hurl/cross-service'),
}

const LOGS_DIR = path.resolve('../../test-results/hurl')
fs.mkdirSync(LOGS_DIR, { recursive: true })

function analyzeFailure(stderr: string): FailureAnalysis {
  const lower = stderr.toLowerCase()

  if (lower.includes('connection refused') || lower.includes('econnrefused')) {
    return {
      type: 'INFRASTRUCTURE',
      message: 'Servicio no disponible',
      suggestion: 'Verificar que el gateway y servicios estén corriendo',
    }
  }
  if (lower.includes('401') || lower.includes('unauthorized')) {
    return {
      type: 'AUTH',
      message: 'Error de autenticación',
      suggestion: 'Verificar credenciales y tokens JWT',
    }
  }
  if (lower.includes('403') || lower.includes('forbidden')) {
    return {
      type: 'AUTHZ',
      message: 'Error de autorización',
      suggestion: 'Verificar permisos del rol',
    }
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return {
      type: 'ENDPOINT',
      message: 'Endpoint no encontrado',
      suggestion: 'Verificar ruta y gateway manifest',
    }
  }
  if (lower.includes('500') || lower.includes('internal server error')) {
    return {
      type: 'BACKEND',
      message: 'Error interno del servidor',
      suggestion: 'Revisar logs del servicio',
    }
  }
  if (lower.includes('timeout')) {
    return {
      type: 'TIMEOUT',
      message: 'Timeout de conexión',
      suggestion: 'Verificar conectividad y performance',
    }
  }

  return {
    type: 'UNKNOWN',
    message: 'Error no clasificado',
    suggestion: 'Revisar stderr detallado',
  }
}

async function runHurlFile(file: string, service: string): Promise<HurlResult> {
  const start = Date.now()
  const args = [
    '--test',
    '--jobs', '1',
    '--connect-timeout', '10s',
    '--max-time', '60s',
    '--variable', `base_url=${GATEWAY_URL}`,
    '--variable', `LOGIN_IP=${LOGIN_IP}`,
    '--variable', `WORKER_EMAIL=${WORKER_EMAIL}`,
    '--variable', `WORKER_PASSWORD=${WORKER_PASSWORD}`,
    '--variable', `CLIENT_EMAIL=${CLIENT_EMAIL}`,
    '--variable', `CLIENT_PASSWORD=${CLIENT_PASSWORD}`,
    '--variable', `TEST_SUFFIX=${TEST_SUFFIX}`,
    `"${file}"`,
  ]

  const proc = spawn('hurl', args, {
    shell: process.platform === 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''

  proc.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
  proc.stderr?.on('data', (chunk) => { stderr += chunk.toString() })

  const [exitCode] = (await once(proc, 'exit')) as [number | null]

  return {
    file: path.basename(file),
    service,
    passed: exitCode === 0,
    duration: Date.now() - start,
    exitCode,
    stdout,
    stderr,
  }
}

async function persistFailure(result: HurlResult): Promise<void> {
  const safeName = result.file.replace('.hurl', '')
  const logFile = path.join(LOGS_DIR, `fallo_${result.service}_${safeName}.json`)

  const report = {
    timestamp: new Date().toISOString(),
    file: result.file,
    service: result.service,
    duration: result.duration,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    analysis: analyzeFailure(result.stderr),
  }

  fs.writeFileSync(logFile, JSON.stringify(report, null, 2), 'utf-8')
}

async function getHurlFiles(service: string): Promise<string[]> {
  const dir = SERVICE_DIRS[service]
  if (!dir || !fs.existsSync(dir)) {
    console.warn(`  [WARN] Directorio no encontrado para servicio: ${service}`)
    return []
  }

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.hurl'))
    .sort()
    .map((f) => path.join(dir, f))

  return files
}

async function runService(service: string): Promise<HurlResult[]> {
  const files = await getHurlFiles(service)
  if (files.length === 0) {
    console.log(`  [SKIP] No se encontraron archivos .hurl para ${service}`)
    return []
  }

  console.log(`\n📦 ${service}: ${files.length} archivos`)
  const results: HurlResult[] = []

  for (const file of files) {
    const name = path.basename(file)
    process.stdout.write(`  ▶ ${name} ... `)

    const result = await runHurlFile(file, service)
    results.push(result)

    if (result.passed) {
      console.log(`✅ (${result.duration}ms)`)
    } else {
      console.log(`❌ (${result.duration}ms, exit=${result.exitCode})`)
      await persistFailure(result)
    }
  }

  return results
}

async function main() {
  const args = process.argv.slice(2)
  const serviceArg = args.find((a) => a.startsWith('--service='))?.split('=')[1]
  const allArg = args.includes('--all')

  const services = serviceArg
    ? [serviceArg]
    : allArg
      ? Object.keys(SERVICE_DIRS)
      : Object.keys(SERVICE_DIRS)

  console.log('🚀 HURL Test Runner — CIMA CRM')
  console.log(`   Gateway: ${GATEWAY_URL}`)
  console.log(`   Suffix: ${TEST_SUFFIX}`)
  console.log(`   Servicios: ${services.join(', ')}`)

  const allResults: HurlResult[] = []

  for (const service of services) {
    const results = await runService(service)
    allResults.push(...results)
  }

  // Resumen
  const passed = allResults.filter((r) => r.passed).length
  const failed = allResults.filter((r) => !r.passed).length
  const total = allResults.length

  console.log('\n' + '='.repeat(50))
  console.log(`📊 RESUMEN: ${passed}/${total} passed, ${failed} failed`)

  if (failed > 0) {
    console.log('\n❌ Archivos fallidos:')
    for (const r of allResults.filter((r) => !r.passed)) {
      const analysis = analyzeFailure(r.stderr)
      console.log(`   - ${r.service}/${r.file}: [${analysis.type}] ${analysis.message}`)
      console.log(`     💡 ${analysis.suggestion}`)
    }
    console.log(`\n📁 Logs de fallos en: ${LOGS_DIR}`)
    process.exit(1)
  } else {
    console.log('\n✅ Todos los tests pasaron!')
    process.exit(0)
  }
}

void main()
