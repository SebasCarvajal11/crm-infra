# ============================================================
# 02 — Flujo Completo Worker (Cross-Service)
# ============================================================
# Flujo end-to-end para worker:
# 1. Login como worker
# 2. Ver proyectos asignados
# 3. Ver tareas asignadas
# 4. Actualizar estado de tarea
# 5. Comentar en tarea
# 6. Solicitar URL de subida de archivo
# 7. Mensaje en chat interno
# ============================================================

# --- 1. Login como worker ---
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

# Login como client
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

# Crear proyecto con worker asignado
POST {{base_url}}/api/v1/collab/projects
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "name": "Cross Worker {{TEST_SUFFIX}}",
  "type": "campaign_service",
  "client_sub": "{{client_id}}",
  "worker_subs": ["{{worker_id}}"]
}
HTTP 201
[Captures]
worker_project_id: jsonpath "$.data.id"

# --- 2. Worker: Ver proyectos asignados ---
GET {{base_url}}/api/v1/collab/projects
Authorization: Bearer {{worker_token}}
HTTP 200
[Asserts]
jsonpath "$.data.items" isCollection

# --- 3. Obtener workspace y crear tarea ---
GET {{base_url}}/api/v1/collab/projects/{{worker_project_id}}/workspace
Authorization: Bearer {{worker_token}}
HTTP 200
[Captures]
worker_column_id: jsonpath "$.data.board.columns[0].id"

POST {{base_url}}/api/v1/collab/projects/{{worker_project_id}}/tasks
Authorization: Bearer {{admin_token}}
Content-Type: application/json
{
  "column_id": "{{worker_column_id}}",
  "title": "Tarea Worker {{TEST_SUFFIX}}",
  "priority": "high",
  "assignees": [
    {
      "user_sub": "{{worker_id}}",
      "user_email": "ana.martinez@cima.dev"
    }
  ],
  "position": 0
}
HTTP 201
[Captures]
worker_task_id: jsonpath "$.data.id"

# --- 4. Worker: Ver tareas asignadas ---
GET {{base_url}}/api/v1/collab/projects/{{worker_project_id}}/tasks
Authorization: Bearer {{worker_token}}
HTTP 200
[Asserts]
jsonpath "$.data.items" isCollection

# --- 5. Worker: Actualizar estado de tarea ---
PATCH {{base_url}}/api/v1/collab/tasks/{{worker_task_id}}
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "title": "Tarea Worker Actualizada {{TEST_SUFFIX}}"
}
HTTP 200
[Asserts]
jsonpath "$.data.title" == "Tarea Worker Actualizada {{TEST_SUFFIX}}"

# --- 6. Worker: Comentar en tarea ---
POST {{base_url}}/api/v1/collab/projects/{{worker_project_id}}/tasks/{{worker_task_id}}/comments
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "content": "Comentario del worker {{TEST_SUFFIX}}"
}
HTTP 201
[Asserts]
jsonpath "$.data.content" == "Comentario del worker {{TEST_SUFFIX}}"

# --- 7. Worker: Solicitar URL de subida de archivo ---
POST {{base_url}}/api/v1/media/documents/upload-url
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "fileName": "worker_doc.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 50000
}
HTTP 200
[Asserts]
jsonpath "$.data.uploadUrl" exists

# --- 8. Worker: Mensaje en chat interno ---
POST {{base_url}}/api/v1/collab/projects/{{worker_project_id}}/chat/internal
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "content": "Mensaje interno del worker {{TEST_SUFFIX}}"
}
HTTP 201

# --- 9. Verificar que worker NO puede crear proyecto ---
POST {{base_url}}/api/v1/collab/projects
Authorization: Bearer {{worker_token}}
Content-Type: application/json
{
  "name": "No permitido",
  "type": "campaign_service"
}
HTTP 403
