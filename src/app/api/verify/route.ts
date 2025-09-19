// app/api/verify/route.ts
import { NextResponse } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";

type TimestampLike =
  | string
  | number
  | { seconds?: number | string; nanos?: number | string }
  | Record<string, unknown>;

type VerifyRowIn = {
  SO_No: string;
  Customer?: string | null;
  Item?: string | null;
  Color?: string | null; // original color
  New_Color?: string | null; // new replacement color
  Size?: string | number | null;
  OrderQty?: number | string | null; // allow numeric strings from client
  SO_Date?: string | null;
  verified_at?: TimestampLike | null;
  // allow objects for fields like verified_at; other fields remain string|number|null|undefined
  [key: string]: string | number | Record<string, unknown> | null | undefined;
};

type VerifyRequest = {
  rows: VerifyRowIn[];
};

function createBigQueryClient(): BigQuery {
  const projectId = process.env.BQ_PROJECT;
  const serviceKey = process.env.GCLOUD_SERVICE_KEY;

  const options: {
    projectId?: string;
    credentials?: { client_email: string; private_key: string };
  } = {};
  if (projectId) options.projectId = projectId;

  if (serviceKey) {
    try {
      const parsed = JSON.parse(serviceKey) as {
        client_email?: string;
        private_key?: string;
      };
      if (parsed?.client_email && parsed?.private_key) {
        options.credentials = {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch {
      // fallback to ADC if available
      console.warn(
        "Failed to parse GCLOUD_SERVICE_KEY, using ADC if available"
      );
    }
  }

  return new BigQuery(options);
}

/**
 * Build a row object that contains only the columns present in your BigQuery table.
 * IMPORTANT: we intentionally do NOT set verified_at here — requests will be "pending".
 */
function buildWhitelistedRow(r: VerifyRowIn): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  out.SO_No = (r.SO_No ?? "").toString();
  out.Customer = r.Customer == null ? null : String(r.Customer);
  out.Item = r.Item == null ? null : String(r.Item);
  out.Color = r.Color == null ? null : String(r.Color);
  out.New_Color = r.New_Color == null ? null : String(r.New_Color);
  out.Size = r.Size == null ? null : String(r.Size);

  // Type-safe handling for OrderQty which may be number or string
  if (
    r.OrderQty == null ||
    (typeof r.OrderQty === "string" && r.OrderQty.trim() === "")
  ) {
    out.OrderQty = null;
  } else {
    const n = Number(r.OrderQty);
    out.OrderQty = Number.isFinite(n) ? Math.trunc(n) : null;
  }

  out.SO_Date = r.SO_Date == null ? null : String(r.SO_Date);

  out.verified_at = null;
  out.source = "sales_orders";

  return out;
}

/** Helper: normalize part for composite key */
function normalizeKeyPart(s?: string | null): string {
  return (s ?? "")
    .toString()
    .replace(/\s*\[.*?\]/g, "")
    .trim()
    .toUpperCase();
}
function makeGroupKey(
  so?: string | null,
  customer?: string | null,
  item?: string | null,
  color?: string | null
) {
  return `${normalizeKeyPart(so)}|${normalizeKeyPart(
    customer
  )}|${normalizeKeyPart(item)}|${normalizeKeyPart(color)}`;
}

/**
 * Merge server rows that share same composite key. For each property, take first non-null / non-empty value.
 * For verified_at we prefer the object/string that includes a timestamp if present.
 */
function mergeVerifyRows(
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();

  function hasTimestamp(v: unknown): boolean {
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "number") return true;
    if (typeof v === "object") {
      try {
        const anyV = v as Record<string, unknown>;
        if ("value" in anyV && String(anyV.value).trim().length > 0)
          return true;
        if ("seconds" in anyV && anyV.seconds != null) return true;
        return Object.keys(anyV).length > 0;
      } catch {
        return true;
      }
    }
    return true;
  }

  for (const r of rows) {
    const key = makeGroupKey(
      (r.SO_No as string) ?? null,
      (r.Customer as string) ?? null,
      (r.Item as string) ?? null,
      (r.Color as string) ?? null
    );
    if (!map.has(key)) {
      map.set(key, { ...(r ?? {}) });
      continue;
    }

    const existing = map.get(key)!;
    for (const prop of Object.keys(r)) {
      const val = r[prop];
      const existingVal = existing[prop];

      // If existing is undefined/null/empty string -> take new
      if (
        existingVal === undefined ||
        existingVal === null ||
        (typeof existingVal === "string" && String(existingVal).trim() === "")
      ) {
        if (val !== undefined && val !== null) existing[prop] = val;
        continue;
      }

      // Special case: verified_at - if existing does not have timestamp, but new does, take new
      if (prop === "verified_at") {
        const existingHas = hasTimestamp(existingVal);
        const newHas = hasTimestamp(val);
        if (!existingHas && newHas) existing[prop] = val;
      }
      // otherwise keep first encountered non-null value (first-wins)
    }
  }

  return Array.from(map.values());
}

/* ---------- API handlers ---------- */

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VerifyRequest;
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }

    const dataset = process.env.BQ_DATASET;
    const table = process.env.BQ_TABLE_VERIFIED ?? "verified_sales_orders";
    const projectId = process.env.BQ_PROJECT;

    if (!dataset || !projectId) {
      return NextResponse.json(
        { error: "Missing env: BQ_PROJECT and BQ_DATASET" },
        { status: 500 }
      );
    }

    const bq = createBigQueryClient();
    const tableRef = bq.dataset(dataset).table(table);

    const rowsToInsert = body.rows.map((r) => buildWhitelistedRow(r));

    try {
      await tableRef.insert(rowsToInsert, { ignoreUnknownValues: true });
      return NextResponse.json({
        success: true,
        inserted: rowsToInsert.length,
      });
    } catch (insertErr: unknown) {
      console.error("BigQuery insert error (full):", insertErr);

      const payload: Record<string, unknown> = {
        error: "Insert failed",
        message:
          insertErr instanceof Error ? insertErr.message : String(insertErr),
      };

      const errObj =
        typeof insertErr === "object" && insertErr !== null
          ? (insertErr as Record<string, unknown>)
          : {};

      if (Array.isArray(errObj["insertErrors"]))
        payload.insertErrors = errObj["insertErrors"];
      if (Array.isArray(errObj["errors"])) payload.errors = errObj["errors"];
      if (typeof errObj["name"] === "string") payload.name = errObj["name"];
      if (
        typeof errObj["code"] === "number" ||
        typeof errObj["code"] === "string"
      )
        payload.code = errObj["code"];

      return NextResponse.json(payload, { status: 500 });
    }
  } catch (err) {
    console.error("Verify POST unexpected error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Insert failed: " + message },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const dataset = process.env.BQ_DATASET;
    const table = process.env.BQ_TABLE_VERIFIED ?? "verified_sales_orders";
    const projectId = process.env.BQ_PROJECT;
    const location = process.env.BQ_LOCATION ?? "US";

    if (!dataset || !projectId) {
      return NextResponse.json(
        { error: "Missing env: BQ_PROJECT and BQ_DATASET" },
        { status: 500 }
      );
    }

    const bq = createBigQueryClient();
    const tableRef = `\`${projectId}.${dataset}.${table}\``;

    const sql = `
      SELECT * FROM ${tableRef}
      ORDER BY SAFE_CAST(verified_at AS TIMESTAMP) DESC NULLS LAST
    `;

    const [result] = await bq.query({ query: sql, location });
    const rawRows = result as unknown as Array<Record<string, unknown>>;

    // Merge rows server-side so client gets a single object per composite key
    const merged = mergeVerifyRows(rawRows);

    return NextResponse.json({ rows: merged, total: merged.length });
  } catch (err) {
    console.error("Verify GET error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Query failed: " + message },
      { status: 500 }
    );
  }
}
