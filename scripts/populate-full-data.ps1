$ErrorActionPreference = 'Stop'

function PostJson($url, $body, $token=$null) {
  $headers = @{}
  if ($token) { $headers['Authorization'] = "Bearer $token" }
  return Invoke-RestMethod -Method Post -Uri $url -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 12)
}
function PutJson($url, $body, $token) {
  $headers = @{ Authorization = "Bearer $token" }
  return Invoke-RestMethod -Method Put -Uri $url -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 12)
}
function GetJson($url, $token) {
  $headers = @{ Authorization = "Bearer $token" }
  return Invoke-RestMethod -Method Get -Uri $url -Headers $headers
}
function CollabHeaders($actor) {
  return @{
    'X-Gateway-Trust' = 'cima-local-gateway-trust-secret-do-not-use-production-2026'
    'X-User-Sub' = $actor.sub
    'X-User-Id' = $actor.sub
    'X-User-Role' = $actor.role
    'X-User-Email' = $actor.email
  }
}
function PostCollab($url, $body, $actor) {
  return Invoke-RestMethod -Method Post -Uri $url -Headers (CollabHeaders $actor) -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 12)
}
function PutCollab($url, $body, $actor) {
  return Invoke-RestMethod -Method Put -Uri $url -Headers (CollabHeaders $actor) -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 12)
}
function GetCollab($url, $actor) {
  return Invoke-RestMethod -Method Get -Uri $url -Headers (CollabHeaders $actor)
}

$adminToken = (PostJson 'http://localhost:3000/auth/login' @{ email='admin@cima.dev'; password='Admin123!' }).data.access_token
$adminActor = [pscustomobject]@{ sub = 'pending'; role = 'admin'; email = 'admin@cima.dev' }

$workers = @()
for ($i=1; $i -le 14; $i++) {
  $email = "worker$i@cima.dev"
  $resp = PostJson 'http://localhost:3000/auth/register-worker' @{
    email = $email
    first_name = "Worker$i"
    last_name = "Equipo"
    profession = @('Disenador','Desarrollador','QA','Marketing')[($i-1)%4]
  } $adminToken
  $workers += [pscustomobject]@{ sub = $resp.data.user.id; email = $email; role='worker' }
}

$clients = @()
for ($i=1; $i -le 14; $i++) {
  $email = "cliente$i@cima.dev"
  $kind = if ($i % 2 -eq 0) { 'juridical' } else { 'natural' }
  $inviteBody = @{
    email = $email
    first_name = "Cliente$i"
    last_name = 'Demo'
    client_kind = $kind
  }
  if ($kind -eq 'juridical') { $inviteBody.company_name = "Empresa $i SAS" }
  $invite = PostJson 'http://localhost:3000/auth/invite-client' $inviteBody $adminToken
  $pass = "Cliente${i}Demo1!"
  $accept = PostJson 'http://localhost:3000/auth/accept-invite' @{ token = $invite.data.token; password = $pass }
  $clients += [pscustomobject]@{ sub = $accept.data.user.id; email = $email; token = $accept.data.access_token; role='client' }
}
$adminActor.sub = ((Invoke-RestMethod -Method Get -Uri 'http://localhost:3000/auth/me' -Headers @{ Authorization = "Bearer $adminToken" }).data.id)

$projectCount = 18
$taskPerProject = 8

for ($p=1; $p -le $projectCount; $p++) {
  $client = $clients[($p-1) % $clients.Count]
  $created = PostCollab 'http://localhost:3001/collab/projects' @{
    name = "Proyecto $p"
    description = "Proyecto de prueba masivo $p"
    client_name = "Cliente Comercial $p"
    client_sub = $client.sub
    type = if ($p % 2 -eq 0) { 'product_order' } else { 'campaign_service' }
    estimated_due_date = (Get-Date).AddDays(20 + $p).ToString('o')
    brief = "Brief inicial enriquecido del proyecto $p"
  } $adminActor

  $projectId = $created.data.id
  $assignedWorkers = @(
    $workers[($p-1) % $workers.Count],
    $workers[$p % $workers.Count],
    $workers[($p+1) % $workers.Count],
    $workers[($p+2) % $workers.Count]
  )

  PutCollab "http://localhost:3001/collab/projects/$projectId/members" @{ user_sub = $client.sub; role='client'; user_email=$client.email } $adminActor | Out-Null
  foreach ($w in $assignedWorkers) {
    PutCollab "http://localhost:3001/collab/projects/$projectId/members" @{ user_sub = $w.sub; role='worker'; user_email=$w.email } $adminActor | Out-Null
  }

  $ws = GetCollab "http://localhost:3001/collab/projects/$projectId/workspace" $adminActor
  $columns = $ws.data.board.columns

  for ($t=1; $t -le $taskPerProject; $t++) {
    $col = $columns[($t-1) % $columns.Count]
    $w1 = $assignedWorkers[($t-1) % $assignedWorkers.Count]
    $w2 = $assignedWorkers[$t % $assignedWorkers.Count]

    PostCollab "http://localhost:3001/collab/projects/$projectId/tasks" @{
      column_id = $col.id
      title = "Tarea $t - Proyecto $p"
      description = "Descripcion extensa de la tarea $t del proyecto $p"
      priority = @('low','medium','high','urgent')[($t-1)%4]
      assignees = @(
        @{ user_sub = $w1.sub; user_email = $w1.email },
        @{ user_sub = $w2.sub; user_email = $w2.email }
      )
      due_date = (Get-Date).AddDays(5 + $t + $p).ToString('o')
      checklist_progress = 0
      client_visible = ($t % 2 -eq 0)
      position = $t
      subtasks = @(
        @{ id = "st-${p}-${t}-1"; title = 'Analisis'; is_completed = $false; assignee_sub = $w1.sub },
        @{ id = "st-${p}-${t}-2"; title = 'Implementacion'; is_completed = $false; assignee_sub = $w2.sub },
        @{ id = "st-${p}-${t}-3"; title = 'QA'; is_completed = $false; assignee_sub = $w1.sub },
        @{ id = "st-${p}-${t}-4"; title = 'Entrega'; is_completed = $false; assignee_sub = $w2.sub }
      )
    } $adminActor | Out-Null
  }

  PostCollab "http://localhost:3001/collab/projects/$projectId/chat/internal" @{
    body = "Kickoff interno del proyecto $p, prioridades y tiempos"
    mentions = @($assignedWorkers[0].sub, $assignedWorkers[1].sub)
  } $adminActor | Out-Null

  PostCollab "http://localhost:3001/collab/projects/$projectId/chat/internal" @{
    body = "Seguimiento tecnico del proyecto $p"
    mentions = @($assignedWorkers[2].sub)
  } $adminActor | Out-Null

  PostCollab "http://localhost:3001/collab/projects/$projectId/chat/external" @{
    body = "Bienvenido cliente, iniciamos oficialmente el proyecto $p"
    mentions = @($client.sub)
  } $adminActor | Out-Null

  PostCollab "http://localhost:3001/collab/projects/$projectId/chat/external" @{
    body = "Cliente solicita avance puntual en hito del proyecto $p"
    mentions = @($assignedWorkers[0].sub)
  } $client | Out-Null
}

$countsSql = @'
SELECT 'users' k, COUNT(*) v FROM schema_auth.users
UNION ALL SELECT 'invitations', COUNT(*) FROM schema_auth.invitations
UNION ALL SELECT 'projects', COUNT(*) FROM schema_collab.projects
UNION ALL SELECT 'project_members', COUNT(*) FROM schema_collab.project_members
UNION ALL SELECT 'tasks', COUNT(*) FROM schema_collab.project_tasks
UNION ALL SELECT 'chat_messages', COUNT(*) FROM schema_collab.project_chat_messages
UNION ALL SELECT 'mention_notifications', COUNT(*) FROM schema_collab.project_mention_notifications;
'@
$counts = $countsSql | docker exec -i crm_postgres_db psql -U root -d crm_database -At
$counts
