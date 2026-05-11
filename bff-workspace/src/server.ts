const MOD_AUTH_URL = process.env.MOD_AUTH_URL ?? "http://localhost:3000";
const MOD_COLLAB_URL = process.env.MOD_COLLAB_URL ?? "http://localhost:3001";
const GATEWAY_TRUST_SECRET = process.env.GATEWAY_TRUST_SECRET ?? "";
const PORT = Number(process.env.PORT ?? "3002");

/** Headers de confianza hacia los backends. */
function trustHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (GATEWAY_TRUST_SECRET) h["X-Gateway-Trust"] = GATEWAY_TRUST_SECRET;
  return h;
}

/** GET /bff/workspace/:projectId — workspace enriquecido con perfiles de miembros. */
async function handleWorkspace(projectId: string): Promise<Response> {
  const headers = trustHeaders();

  // 1. Fetch workspace from mod-collab
  const wsResp = await fetch(`${MOD_COLLAB_URL}/collab/projects/${projectId}/workspace`, { headers });
  if (!wsResp.ok) {
    return new Response(JSON.stringify({ error: `mod-collab ${wsResp.status}` }), {
      status: wsResp.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const ws = (await wsResp.json()) as {
    data: {
      project: Record<string, unknown>;
      members: Array<{ userSub: string; role: string }>;
      board: { columns: unknown[]; tasks: unknown[] };
      brief: unknown;
      formalChanges: unknown[];
    };
  };

  const members = ws.data.members ?? [];
  const userSubs = [...new Set(members.map((m) => m.userSub).filter(Boolean))];

  // 2. Fetch user profiles from mod-auth (parallel for all unique subs)
  const profileMap = new Map<string, { email: string; role: string }>();
  if (userSubs.length > 0) {
    const profilePromises = userSubs.map(async (sub) => {
      try {
        const r = await fetch(`${MOD_AUTH_URL}/auth/users/search?q=${encodeURIComponent(sub)}&role=client`, { headers });
        if (!r.ok) return;
        const body = (await r.json()) as { data: Array<{ subject: string; email: string; role: string }> };
        for (const u of body.data ?? []) {
          profileMap.set(u.subject, { email: u.email, role: u.role });
        }
      } catch {
        // Profile fetch failed — skip enrichment for this user
      }
    });
    await Promise.all(profilePromises);
  }

  // 3. Merge: enrich members with profile data
  const enrichedMembers = members.map((m) => ({
    ...m,
    email: profileMap.get(m.userSub)?.email ?? null,
    role_label: profileMap.get(m.userSub)?.role ?? m.role,
  }));

  // 4. Return enriched response
  const response = {
    data: {
      ...ws.data,
      members: enrichedMembers,
    },
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/bff/workspace/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  return handleWorkspace(projectId);
});

app.get("/health", (c) => c.json({ status: "ok", service: "bff-workspace" }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`BFF Workspace corriendo en http://localhost:${info.port}`);
});
