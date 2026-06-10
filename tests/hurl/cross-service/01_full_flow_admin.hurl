# ============================================================
# 01 — Flujo Completo Admin (Cross-Service)
# ============================================================
# Flujo end-to-end que prueba la interaccion entre servicios:
# 1. Login como admin
# 2. Crear worker
# 3. Invitar client
# 4. Crear proyecto (collab)
# 5. Agregar miembros (collab)
# 6. Crear tarea con subtareas (collab)
# 7. Solicitar URL de subida de archivo (media)
# 8. Enviar mensaje en chat (collab)
# 9. Verificar consistencia entre servicios
# ============================================================

# --- 1. Login como admin ---
POST {{base_url}}/api/v1/auth/login
Content-Type: application/json
{
  "email": "admin@cima.dev",
  "password": "Admin123!"
}
HTTP 200
[Captures]
admin_token: jsonpath "$.data.access_token"
admin_id: jsonpath "$.data.user.id"

# --- 2. Crear worker ---
POST {{base_url}}/api/v1/auth/register-worker
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "email": "cross.worker.{{TEST_SUFFIX}}@cima.dev",
  "first_name": "Cross",
  "last_name": "Worker",
  "profession": "QA Engineer"
}
HTTP 201
[Captures]
cross_worker_token: jsonpath "$.data.token"
cross_worker_id: jsonpath "$.data.user.id"

# Aceptar invitacion del worker
POST {{base_url}}/api/v1/auth/accept-invite
Content-Type: application/json
{
  "token": "{{cross_worker_token}}",
  "password": "CrossWorker123!"
}
HTTP 201
[Captures]
cross_worker_access: jsonpath "$.data.access_token"

# --- 3. Invitar client ---
POST {{base_url}}/api/v1/auth/invite-client
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "email": "cross.client.{{TEST_SUFFIX}}@cima.dev",
  "first_name": "Cross",
  "last_name": "Client",
  "client_kind": "natural"
}
HTTP 201
[Captures]
cross_client_token: jsonpath "$.data.token"
cross_client_id: jsonpath "$.data.user.id"

# Aceptar invitacion del client
POST {{base_url}}/api/v1/auth/accept-invite
Content-Type: application/json
{
  "token": "{{cross_client_token}}",
  "password": "CrossClient123!"
}
HTTP 201
[Captures]
cross_client_access: jsonpath "$.data.access_token"

# --- 4. Crear proyecto ---
POST {{base_url}}/api/v1/collab/projects
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "name": "Cross Admin {{TEST_SUFFIX}}",
  "type": "campaign_service",
  "description": "Proyecto cross-service admin",
  "client_sub": "{{cross_client_id}}",
  "worker_subs": ["{{cross_worker_id}}"],
  "brief": "Brief cross-service"
}
HTTP 201
[Captures]
cross_project_id: jsonpath "$.data.id"

# --- 5. Verificar miembros ---
GET {{base_url}}/api/v1/collab/projects/{{cross_project_id}}/members
Authorization: Bearer {{admin_token}}
HTTP 200
[Asserts]
jsonpath "$.data" isCollection

# --- 6. Obtener workspace y crear tarea ---
GET {{base_url}}/api/v1/collab/projects/{{cross_project_id}}/workspace
Authorization: Bearer {{admin_token}}
HTTP 200
[Captures]
cross_column_id: jsonpath "$.data.board.columns[0].id"

POST {{base_url}}/api/v1/collab/projects/{{cross_project_id}}/tasks
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "column_id": "{{cross_column_id}}",
  "title": "Tarea Cross {{TEST_SUFFIX}}",
  "description": "Tarea de prueba cross-service",
  "priority": "high",
  "assignees": [
    {
      "user_sub": "{{cross_worker_id}}",
      "user_email": "cross.worker.{{TEST_SUFFIX}}@cima.dev"
    }
  ],
  "subtasks": [
    { "title": "Subtarea 1", "position": 0 },
    { "title": "Subtarea 2", "position": 1 }
  ],
  "client_visible": true,
  "position": 0
}
HTTP 201
[Captures]
cross_task_id: jsonpath "$.data.id"

# --- 7. Solicitar URL de subida de archivo (media) ---
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "fileName": "cross_admin_doc.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 75000
}
HTTP 200
[Asserts]
jsonpath "$.data.uploadUrl" exists
jsonpath "$.data.objectKey" exists

# --- 8. Enviar mensaje en chat ---
POST {{base_url}}/api/v1/collab/projects/{{cross_project_id}}/chat/internal
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "content": "Mensaje cross-service admin {{TEST_SUFFIX}}"
}
HTTP 201

POST {{base_url}}/api/v1/collab/projects/{{cross_project_id}}/chat/external
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "content": "Mensaje externo cross-service {{TEST_SUFFIX}}"
}
HTTP 201

# --- 9. Verificar consistencia ---
# Worker ve el proyecto
GET {{base_url}}/api/v1/collab/projects
Authorization: Bearer {{cross_worker_access}}
HTTP 200
[Asserts]
jsonpath "$.data.items" isCollection

# Client ve el proyecto
GET {{base_url}}/api/v1/collab/projects
Authorization: Bearer {{cross_client_access}}
HTTP 200
[Asserts]
jsonpath "$.data.items" isCollection

# Worker ve la tarea
GET {{base_url}}/api/v1/collab/projects/{{cross_project_id}}/tasks
Authorization: Bearer {{cross_worker_access}}
HTTP 200
[Asserts]
jsonpath "$.data.items" isCollection

# Client ve la tarea (client_visible: true)
GET {{base_url}}/api/v1/collab/projects/{{cross_project_id}}/tasks
Authorization: Bearer {{cross_client_access}}
HTTP 200
[Asserts]
jsonpath "$.data.items" isCollection

# Verificar identidad de los nuevos usuarios
GET {{base_url}}/api/v1/identity/me
Authorization: Bearer {{cross_worker_access}}
HTTP 200
[Asserts]
jsonpath "$.data.role" == "worker"

GET {{base_url}}/api/v1/identity/me
Authorization: Bearer {{cross_client_access}}
HTTP 200
[Asserts]
jsonpath "$.data.role" == "client"
