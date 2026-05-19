/**
 * Butterbase serverless function: rename_calculation
 *
 * Trigger: POST /rename_calculation (auth: required)
 * Updates the title of a calculation row. RLS ensures only the owner can update.
 *
 * Body:    { id: string, title: string }
 * Returns: { ok: true } | { ok: false, error }
 */

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function handler(request: Request, ctx: any): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }
  if (request.method !== 'POST') {
    return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  }
  if (!ctx?.user?.id) {
    return jsonResp({ ok: false, error: 'Unauthorized' }, 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResp({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (typeof body?.id !== 'string' || typeof body?.title !== 'string') {
    return jsonResp({ ok: false, error: 'Invalid payload' }, 400);
  }
  const title = body.title.trim();
  if (!title || title.length > 200) {
    return jsonResp({ ok: false, error: 'Title must be 1-200 chars' }, 400);
  }

  const result = await ctx.db.query(
    `UPDATE calculations SET title = $1, title_source = 'user' WHERE id = $2 RETURNING id`,
    [title, body.id],
  );

  if (!result.rows || result.rows.length === 0) {
    return jsonResp({ ok: false, error: 'Not found' }, 404);
  }

  return jsonResp({ ok: true });
}
