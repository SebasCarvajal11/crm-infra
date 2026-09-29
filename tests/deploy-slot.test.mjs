import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source = readFileSync(new URL('../deploy/remote/deploy-component.sh', import.meta.url), 'utf8');
const startWeb = source.match(/^start_slot_web\(\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(startWeb, 'El punto de entrada canónico debe existir');
const gitBash = 'C:/Program Files/Git/bin/bash.exe';
const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash';
function run(component, slot, fail = false) {
  return spawnSync(bash, ['-s'], { encoding: 'utf8', input: `set -e
component=${component}
slot_compose=compose.yml
slot_project() { echo "crm-slot-$1"; }
slot_gateway_port() { echo 18081; }
slot_frontend_port() { echo 8081; }
docker() { printf 'docker'; printf ' %s' "$@"; printf '\\n'; ${fail ? 'return 1' : ':'}; }
wait_for_http_ok() { echo "health $1"; }
${startWeb}
start_slot_web ${slot}
` });
}

for (const component of ['auth', 'collab', 'media', 'frontend', 'marketing', 'infra', 'full']) {
  for (const slot of ['blue', 'green']) test(`${component}: construir todas las revisiones antes de validar ${slot}`, () => {
    const result = run(component, slot);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      `docker compose -p crm-slot-${slot} -f compose.yml up -d --build auth media collab marketing api-gateway frontend`,
      `health slot-${slot}-frontend`, `health slot-${slot}-gateway`,
    ]);
  });
}
test('abortar antes de declarar saludable un slot si falla su construcción', () => {
  const result = run('marketing', 'green', true);
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes('health '));
});
