/**
 * Butterbase serverless function: toggle_share
 *
 * Trigger: POST /toggle_share (auth: required)
 * Toggles whether a calculation is public. On first share, generates a random
 * slug. The slug is preserved across unshare/reshare cycles so the public URL
 * is stable.
 *
 * Body:    { id: string, public: boolean }
 * Returns: { ok: true, public: boolean, slug: string } | { ok: false, error }
 */

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SLUG_LEN = 12;

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function randomSlug(): string {
  const bytes = new Uint8Array(SLUG_LEN);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < SLUG_LEN; i++) {
    s += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return s;
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
  if (typeof body?.id !== 'string' || typeof body?.public !== 'boolean') {
    return jsonResp({ ok: false, error: 'Invalid payload' }, 400);
  }

  // Fetch existing row (RLS ensures only owner can read).
  const existing = await ctx.db.query(
    `SELECT id, slug FROM calculations WHERE id = $1`,
    [body.id],
  );
  if (!existing.rows || existing.rows.length === 0) {
    return jsonResp({ ok: false, error: 'Not found' }, 404);
  }
  const current = existing.rows[0];

  // Generate slug if turning on for the first time. Retry up to 5 times on collision.
  let slug: string = current.slug;
  if (body.public && !slug) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomSlug();
      try {
        const upd = await ctx.db.query(
          `UPDATE calculations SET public = true, slug = $1
           WHERE id = $2 AND slug IS NULL
           RETURNING slug`,
          [candidate, body.id],
        );
        if (upd.rows && upd.rows.length > 0) {
          slug = upd.rows[0].slug;
          break;
        }
      } catch (err: any) {
        // Unique violation: retry
        if (err?.code !== '23505') throw err;
      }
    }
    if (!slug) {
      return jsonResp({ ok: false, error: 'Failed to generate slug' }, 500);
    }
    return jsonResp({ ok: true, public: true, slug });
  }

  // Otherwise just flip the public flag.
  await ctx.db.query(
    `UPDATE calculations SET public = $1 WHERE id = $2`,
    [body.public, body.id],
  );

  return jsonResp({ ok: true, public: body.public, slug: slug ?? '' });
}
