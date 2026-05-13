$ErrorActionPreference='Stop'
function PostAuth($url,$body){ Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json' -Body ($body|ConvertTo-Json) }
function CH($actor){ @{ 'X-Gateway-Trust'='cima-local-gateway-trust-secret-do-not-use-production-2026'; 'X-User-Sub'=$actor.sub; 'X-User-Id'=$actor.sub; 'X-User-Role'=$actor.role; 'X-User-Email'=$actor.email } }
function CollabGet($url,$actor){ Invoke-RestMethod -Method Get -Uri $url -Headers (CH $actor) }
function CollabPost($url,$body,$actor){ Invoke-RestMethod -Method Post -Uri $url -Headers (CH $actor) -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 8) }
function CollabPatch($url,$body,$actor){ Invoke-RestMethod -Method Patch -Uri $url -Headers (CH $actor) -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 8) }

$adminTok=(PostAuth 'http://localhost:3000/auth/login' @{email='admin@cima.dev';password='Admin123!'}).data.access_token
$adminMe=Invoke-RestMethod -Method Get -Uri 'http://localhost:3000/auth/me' -Headers @{Authorization="Bearer $adminTok"}
$admin=[pscustomobject]@{sub=$adminMe.data.id; role='admin'; email='admin@cima.dev'}

$clients=@()
for($i=1;$i -le 10;$i++){
  $email="cliente$i@cima.dev"
  $tok=(PostAuth 'http://localhost:3000/auth/login' @{email=$email;password="Cliente${i}Demo1!"}).data.access_token
  $me=Invoke-RestMethod -Method Get -Uri 'http://localhost:3000/auth/me' -Headers @{Authorization="Bearer $tok"}
  $clients+=[pscustomobject]@{sub=$me.data.id; role='client'; email=$email}
}

$projects=(CollabGet 'http://localhost:3001/collab/projects?page=1&limit=50' $admin).data
$target=$projects | Select-Object -First 8
$idx=0
foreach($p in $target){
  $ws=(CollabGet "http://localhost:3001/collab/projects/$($p.id)/workspace" $admin).data
  $tasks=$ws.board.tasks
  if($tasks.Count -lt 2){ continue }
  $client=$clients[$idx % $clients.Count]
  $idx++

  CollabPost "http://localhost:3001/collab/projects/$($p.id)/tasks/$($tasks[0].id)/comments" @{content="Comentario funcional del cliente para $($p.name)"} $client | Out-Null
  CollabPost "http://localhost:3001/collab/projects/$($p.id)/change-requests/minor" @{task_id=$tasks[0].id; title='Ajuste de copy'; description='Cambiar texto principal de entrega'} $client | Out-Null
  $formal=CollabPost "http://localhost:3001/collab/projects/$($p.id)/change-requests/formal" @{task_id=$tasks[1].id; title='Cambio de alcance'; description='Agregar entregable adicional'; justification='Nueva necesidad comercial'} $client
  CollabPatch "http://localhost:3001/collab/projects/$($p.id)/change-requests/$($formal.data.id)" @{status='approved'} $admin | Out-Null
  CollabPatch "http://localhost:3001/collab/projects/$($p.id)/brief" @{body="Brief actualizado para $($p.name) con lineamientos extra"} $admin | Out-Null

  $ext=(CollabGet "http://localhost:3001/collab/projects/$($p.id)/chat/external" $client).data
  if($ext.Count -gt 0){ CollabPost "http://localhost:3001/collab/projects/$($p.id)/chat/external/read" @{up_to_message_id=$ext[-1].id} $client | Out-Null }
}

'ok'
