/**
 * Test Seed Utility
 * 
 * Verifica que los usuarios de prueba existan en la base de datos
 * y opcionalmente los crea si no existen.
 * 
 * Uso: tsx tests/test-seed.ts [--verify] [--create]
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:18080'

interface SeedUser {
  email: string
  password: string
  role: 'admin' | 'worker' | 'client'
  firstName: string
  lastName: string
}

const SEED_USERS: SeedUser[] = [
  {
    email: 'admin@cima.dev',
    password: 'Admin123!',
    role: 'admin',
    firstName: 'Admin',
    lastName: 'CIMA',
  },
  {
    email: 'ana.martinez@cima.dev',
    password: 'Demo123!',
    role: 'worker',
    firstName: 'Ana',
    lastName: 'Martínez',
  },
  {
    email: 'contacto@restauranteelbuensabor.com',
    password: 'Demo123!',
    role: 'client',
    firstName: 'Contacto',
    lastName: 'El Buen Sabor',
  },
]

async function verifyUser(user: SeedUser): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
    })

    if (res.ok) {
      const data = await res.json()
      const role = data?.data?.user?.role
      if (role === user.role) {
        console.log(`  ✅ ${user.email} (${user.role}) — OK`)
        return true
      } else {
        console.log(`  ⚠️  ${user.email} — Rol esperado: ${user.role}, actual: ${role}`)
        return false
      }
    }

    console.log(`  ❌ ${user.email} — Login fallido (${res.status})`)
    return false
  } catch (err) {
    console.log(`  ❌ ${user.email} — Error de conexión: ${err}`)
    return false
  }
}

async function verifyGateway(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/v1/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)
  const verify = args.includes('--verify') || args.length === 0
  const create = args.includes('--create')

  console.log('🌱 Test Seed Utility — CIMA CRM')
  console.log(`   Gateway: ${GATEWAY_URL}\n`)

  // Verificar gateway
  console.log('🔍 Verificando gateway...')
  const gatewayOk = await verifyGateway()
  if (!gatewayOk) {
    console.error('❌ Gateway no disponible. Ejecuta "docker compose up" primero.')
    process.exit(1)
  }
  console.log('  ✅ Gateway disponible\n')

  if (verify) {
    console.log('🔍 Verificando usuarios de prueba...')
    const results = await Promise.all(SEED_USERS.map(verifyUser))
    const allOk = results.every(Boolean)

    if (!allOk) {
      console.error('\n❌ Algunos usuarios de prueba no están disponibles.')
      console.error('   Ejecuta: pnpm db:seed (en crm-auth)')
      process.exit(1)
    }

    console.log('\n✅ Todos los usuarios de prueba están disponibles.')
  }

  if (create) {
    console.log('\n⚠️  La creación de usuarios debe hacerse via:')
    console.log('   1. pnpm db:seed (en crm-auth)')
    console.log('   2. O manualmente via la API de auth')
  }
}

void main()
