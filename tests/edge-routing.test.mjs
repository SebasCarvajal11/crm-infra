import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source = readFileSync(new URL('../deploy/remote/deploy-component.sh', import.meta.url), 'utf8');
const appendSources = source.match(/^append_csp_sources\(\) \{[\s\S]*?^\}/m)?.[0];
const renderEdge = source.match(/^render_edge_config\(\) \{[\s\S]*?^EOF\r?\n\}/m)?.[0];
const activateSlot = source.match(/^activate_edge_slot\(\) \{[\s\S]*?^\}/m)?.[0];

assert.ok(appendSources, 'append_csp_sources debe existir');
assert.ok(renderEdge, 'render_edge_config debe existir');
assert.ok(activateSlot, 'activate_edge_slot debe existir');

const gitBash = 'C:/Program Files/Git/bin/bash.exe';
const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash';

function runEdgeConfig(args) {
  const script = `set -e
runtime_dir="$(mktemp -d)"
${appendSources}
${renderEdge}
render_edge_config ${args}
cat "$runtime_dir/edge.conf"
rm -rf "$runtime_dir"
`;
  return spawnSync(bash, ['-s'], { encoding: 'utf8', input: script });
}

test('render_edge_config genera bypass directo a gateway_port en /api/ y frontend_port en /', () => {
  const result = runEdgeConfig('8081 18081');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /location \^~ \/api\/ \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:18081;/);
  assert.match(result.stdout, /location \/ \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8081;/);
});

test('render_edge_config mantiene fallback compatible cuando gateway_port no se pasa', () => {
  const result = runEdgeConfig('8081');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /location \^~ \/api\/ \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8081;/);
  assert.match(result.stdout, /location \/ \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8081;/);
});

test('activate_edge_slot invoca render_edge_config con ambos puertos por slot', () => {
  const script = `set -e
runtime_dir="$(mktemp -d)"
slot_frontend_port() { echo 8082; }
slot_gateway_port() { echo 18082; }
ensure_shared_docker_primitives() { :; }
render_edge_config() { echo "RENDERED front=$1 gw=$2"; }
shared_compose_cmd() { :; }
${activateSlot}
activate_edge_slot green
`;
  const result = spawnSync(bash, ['-s'], { encoding: 'utf8', input: script });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'RENDERED front=8082 gw=18082');
});
