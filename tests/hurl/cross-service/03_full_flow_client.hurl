# ============================================================
# 03 — Flujo Completo Client (Cross-Service)
# ============================================================
# Flujo end-to-end para client:
# 1. Login como client
# 2. Ver proyectos propios
# 3. Ver brief
# 4. Enviar mensaje en chat externo
# 5. Crear solicitud de cambio
# 6. Verificar NO acceso a chat interno (403)
# 7. Verificar NO acceso a gestion de usuarios (403)
# ============================================================

# --- 1. Login como client ---
POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
{
  "email": "contacto@restauranteelbuensabor.com",
  "password": "Demo123!"
}
HTTP 200
[Captures]
client_token: jsonpath "$.data.access_token"
client_id: jsonpath "$.data.user.id"

# Login como admin para crear datos
POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
{
  "email": "admin@cima.dev",
  "password": "Admin123!"
}
HTTP 200
[Captures]
admin_token: jsonpath "$.data.access_token"

# Login como worker
POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
{
  "email": "ana.martinez@cima.dev",
  "password": "Demo123!"
}
HTTP 200
[Captures]
worker_token: jsonpath "$.data.access_token"
worker_id: jsonpath "$.data.user.id"

# Crear proyecto con client asignado
POST {{base_url}}/api/v1/collab/projects
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "name": "Cross Client {{TEST_SUFFIX}}",
  "type": "campaign_service",
  "client_sub": "{{client_id}}",
  "worker_subs": ["{{worker_id}}"],
  "brief": "Brief para client cross-service"
}
HTTP 201
[Captures]
client_project_id: jsonpath "$.data.id"

# --- 2. Client: Ver proyectos propios ---
GET {{base_url}}/api/v1/collab/projects
Authorization: Bearer {{client_token}}
HTTP 200
[Asserts]
jsonpath "$.data.items" isCollection

# --- 3. Client: Ver brief ---
GET {{base_url}}/api/v1/collab/projects/{{client_project_id}}/brief
Authorization: Bearer {{client_token}}
HTTP 200
[Asserts]
jsonpath "$.data.content" exists

# --- 4. Client: Enviar mensaje en chat externo ---
POST {{base_url}}/api/v1/collab/projects/{{client_project_id}}/chat/external
Authorization: Bearer {{client_token}}
Content-Type: application/json
{
  "content": "Mensaje del client {{TEST_SUFFIX}}"
}
HTTP 201
[Asserts]
jsonpath "$.data.content" == "Mensaje del client {{TEST_SUFFIX}}"

# --- 5. Client: Crear solicitud de cambio menor ---
POST {{base_url}}/api/v1/collab/projects/{{client_project_id}}/change-requests/minor
Authorization: Bearer {{client_token}}
Content-Type: application/json
{
  "description": "Solicitud menor del client {{TEST_SUFFIX}}"
}
HTTP 201
[Asserts]
jsonpath "$.data.type" == "minor"

# --- 6. Client: Crear solicitud de cambio formal ---
POST {{base_url}}/api/v1/collab/projects/{{client_project_id}}/change-requests/formal
Authorization: Bearer {{client_token}}
Content-Type: application/json
{
  "description": "Solicitud formal del client {{TEST_SUFFIX}}"
}
HTTP 201
[Asserts]
jsonpath "$.data.type" == "formal"

# --- 7. Client: NO puede acceder a chat interno (403) ---
POST {{base_url}}/api/v1/collab/projects/{{client_project_id}}/chat/internal
Authorization: Bearer {{client_token}}
Content-Type: application/json
{
  "content": "No permitido"
}
HTTP 403

# --- 8. Client: NO puede acceder a gestion de usuarios (403) ---
GET {{base_url}}/api/v1/auth/users
Authorization: Bearer {{client_token}}
HTTP 403

# --- 9. Client: NO puede crear proyecto (403) ---
POST {{base_url}}/api/v1/collab/projects
Authorization: Bearer {{client_token}}
Content-Type: application/json
{
  "name": "No permitido",
  "type": "campaign_service"
}
HTTP 403

# --- 10. Client: NO puede crear tarea (403) ---
GET {{base_url}}/api/v1/collab/projects/{{client_project_id}}/workspace
Authorization: Bearer {{client_token}}
HTTP 200
[Captures]
client_column_id: jsonpath "$.data.board.columns[0].id"

POST {{base_url}}/api/v1/collab/projects/{{client_project_id}}/tasks
Authorization: Bearer {{client_token}}
Content-Type: application/json
{
  "column_id": "{{client_column_id}}",
  "title": "No permitido",
  "priority": "low",
  "position": 0
}
HTTP 403

# --- 11. Client: Verifica avatar (deberia tener uno si se subio antes) ---
GET {{base_url}}/api/v1/media/avatars/current
Authorization: Bearer {{client_token}}
HTTP 200
