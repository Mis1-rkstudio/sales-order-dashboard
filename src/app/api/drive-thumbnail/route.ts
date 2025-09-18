// app/api/drive-thumbnail/route.ts
import { NextResponse } from 'next/server';
import { JWT } from 'google-auth-library';
import type { GaxiosResponse } from 'gaxios';

type MaybeHeaders =
  | Headers
  | Record<string, string | string[] | undefined>
  | undefined
  | null;

function getHeaderValue(headers: MaybeHeaders, key: string): string | undefined {
  if (!headers) return undefined;

  // Fetch-like Headers instance (case-insensitive)
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(key) ?? undefined;
  }

  // Plain object map (axios/gaxios style)
  const h = headers as Record<string, string | string[] | undefined>;
  // try exact key and lowercase variant
  const exact = h[key];
  if (typeof exact === 'string') return exact;
  if (Array.isArray(exact) && exact.length) return String(exact[0]);

  const lowerKey = key.toLowerCase();
  const lower = h[lowerKey];
  if (typeof lower === 'string') return lower;
  if (Array.isArray(lower) && lower.length) return String(lower[0]);

  return undefined;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'missing id' }, { status: 400 });
    }

    const key = process.env.GCLOUD_SERVICE_KEY;
    if (!key) {
      return NextResponse.json({ error: 'missing GCLOUD_SERVICE_KEY env' }, { status: 500 });
    }

    // parse and normalize private key (it may contain escaped \n)
    let parsed: { client_email?: string; private_key?: string } | null = null;
    try {
      parsed = JSON.parse(key) as { client_email?: string; private_key?: string };
      if (parsed?.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
    } catch (parseError) {
      // keep a server-side log for debugging
      // eslint-disable-next-line no-console
      console.error('failed to parse GCLOUD_SERVICE_KEY:', parseError);
      return NextResponse.json({ error: 'failed to parse GCLOUD_SERVICE_KEY' }, { status: 500 });
    }

    if (!parsed?.client_email || !parsed?.private_key) {
      return NextResponse.json({ error: 'service key missing required fields' }, { status: 500 });
    }

    // create JWT client with Drive readonly scope
    const client = new JWT({
      email: parsed.client_email,
      key: parsed.private_key,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    // use the auth client to request file bytes
    // typed as ArrayBuffer using GaxiosResponse
    const res: GaxiosResponse<ArrayBuffer> = await client.request<ArrayBuffer>({
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
      method: 'GET',
      responseType: 'arraybuffer',
    });

    // res.data is an ArrayBuffer or Buffer
    const contentType =
      getHeaderValue(res.headers as MaybeHeaders, 'content-type') ??
      getHeaderValue(res.headers as MaybeHeaders, 'Content-Type') ??
      'application/octet-stream';

    const buffer = Buffer.from(res.data);

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=300'); // small cache

    return new Response(buffer, { status: 200, headers });
  } catch (err) {
    // server-side debugging info
    // eslint-disable-next-line no-console
    console.error('drive-thumbnail error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'drive proxy failed: ' + message }, { status: 500 });
  }
}
