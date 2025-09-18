// app/api/dispatch/route.ts
import { NextResponse } from 'next/server';
import { getBigQueryClient } from '@/lib/bigquery';

export type DispatchRow = {
  SO_No: string;
  Customer?: string | null;
  Item?: string | null;
  Color?: string | null;
  Dispatched: boolean;
  Dispatched_At?: string | null;
};

function extractErrorDetails(err: unknown): string {
  // handle null / undefined explicitly
  if (err === null || err === undefined) return String(err);

  if (typeof err === 'string') return err;

  if (err instanceof Error) {
    // treat Error as an Error that may also have arbitrary extra fields
    const e = err as Error & Record<string, unknown>;

    // e.message exists because of Error; fallback to toString()
    let details = `${e.message ?? err.toString()}`;

    // if there is an errors array (API style), include it
    const maybeErrors = e.errors as unknown;
    if (Array.isArray(maybeErrors) && maybeErrors.length) {
      try {
        details += ` | errors: ${JSON.stringify(maybeErrors)}`;
      } catch {
        details += ` | errors: (unserializable)`;
      }
    }

    // if there's a response / response.data (some libs include response/data)
    const maybeResponse = e.response as unknown;
    if (maybeResponse && typeof maybeResponse === 'object') {
      try {
        details += ` | response: ${JSON.stringify(maybeResponse)}`;
      } catch {
        details += ` | response: (unserializable)`;
      }
    }

    return details;
  }

  // last resort: try to stringify unknownish shapes
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rows?: unknown };

    if (!body || !Array.isArray(body.rows)) {
      return NextResponse.json({ error: 'Invalid body: expected { rows: [...] }' }, { status: 400 });
    }

    const rawRows = body.rows as unknown[];

    // normalize/validate rows
    const rowsToInsert: DispatchRow[] = rawRows
      .map((r) => {
        if (!r || typeof r !== 'object') return null;
        const obj = r as Record<string, unknown>;
        const so = typeof obj.SO_No === 'string' && obj.SO_No.trim() ? obj.SO_No.trim() : undefined;
        if (!so) return null;
        return {
          SO_No: so,
          Customer: typeof obj.Customer === 'string' ? obj.Customer : null,
          Item: typeof obj.Item === 'string' ? obj.Item : null,
          Color: typeof obj.Color === 'string' ? obj.Color : null,
          Dispatched: Boolean(obj.Dispatched),
          Dispatched_At: new Date().toISOString(),
        } as DispatchRow;
      })
      .filter((x): x is DispatchRow => x !== null);

    if (rowsToInsert.length === 0) {
      return NextResponse.json({ error: 'No valid rows to insert (missing or invalid SO_No?)' }, { status: 400 });
    }

    const projectId = process.env.BQ_PROJECT;
    const dataset = process.env.BQ_DATASET;
    const table = process.env.BQ_TABLE_DISPATCHED ?? 'dispatched_orders';

    if (!projectId || !dataset) {
      return NextResponse.json({ error: 'Missing env: BQ_PROJECT and BQ_DATASET must be set' }, { status: 500 });
    }

    const bq = getBigQueryClient();

    const tableRef = `${projectId}.${dataset}.${table}`;

    // server-side debug log so you can inspect what's being inserted
    console.info(`Dispatch insert -> table=${tableRef}, rows=${rowsToInsert.length}`);
    console.debug('Dispatch rows sample:', JSON.stringify(rowsToInsert.slice(0, 5), null, 2));

    try {
      // Typical google-cloud/bigquery style insert - adjust if your client is different.
      // Options: ignoreUnknownValues/skipInvalidRows may help if BigQuery complains about extra fields
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore-next-line - allow different client shapes
      const insertResult = await bq.dataset(dataset).table(table).insert(rowsToInsert, {
        ignoreUnknownValues: true,
        skipInvalidRows: false,
      });

      // some clients return a result object; log it
      console.debug('BigQuery insert result:', insertResult);

      return NextResponse.json({ inserted: rowsToInsert.length, table: tableRef });
    } catch (insertError) {
      // parse and return useful message
      const details = extractErrorDetails(insertError);
      console.error('BigQuery insert error:', details, insertError);
      return NextResponse.json({ error: 'BigQuery insert error', details }, { status: 500 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('dispatch POST error', err);
    return NextResponse.json({ error: `Server error: ${msg}` }, { status: 500 });
  }
}
