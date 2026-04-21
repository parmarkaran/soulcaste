/* ============================================================
   Soulcaste — OpenRouter Proxy (Netlify Edge Function)
   Route: POST /api/chat
   - Uses owner's OR_KEY env var by default (set in Netlify dashboard)
   - If request sends X-User-Key header, uses that instead (user's own key)
============================================================ */

export default async function handler(request, context) {
  // Only allow POST
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Pick key: user's own key takes priority, else fall back to owner key
  const userKey  = request.headers.get('X-User-Key');
  // Netlify Edge Functions: env vars accessible via Deno.env
  const ownerKey = Netlify.env.get('OR_KEY') ?? Deno.env.get('OR_KEY');
  const apiKey   = (userKey && userKey.startsWith('sk-')) ? userKey : ownerKey;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: 'No API key configured. Add OR_KEY in Netlify environment variables.' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer':  'https://soulcaste.netlify.app',
      'X-Title':       'Soulcaste',
    },
    body: JSON.stringify(body),
  });

  // Stream the response straight back to the browser
  return new Response(upstream.body, {
    status:  upstream.status,
    headers: {
      'Content-Type':                upstream.headers.get('Content-Type') || 'text/event-stream',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const config = { path: '/api/chat' };
