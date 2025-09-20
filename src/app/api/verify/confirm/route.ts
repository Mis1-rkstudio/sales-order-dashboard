// app/api/verify/confirm/route.ts
import { NextResponse } from "next/server";
import { createBigQueryClient } from "@/lib/bigquery";

type VerifyConfirmRowIn = {
  SO_No: string;
  Customer?: string | null;
  Item?: string | null;
  Color?: string | null;
  Size?: string | number | null;
  // allow string too since client input may contain numbers as strings
  OrderQty?: number | string | null;
  SO_Date?: string | null;
  [key: string]: string | number | null | undefined;
};

type VerifyConfirmRequest = {
  rows: VerifyConfirmRowIn[];
};

// function createBigQueryClient(): BigQuery {
//   const projectId = process.env.BQ_PROJECT;
//   const serviceKey = process.env.GCLOUD_SERVICE_KEY;

//   const options: {
//     projectId?: string;
//     credentials?: { client_email: string; private_key: string };
//   } = {};
//   if (projectId) options.projectId = projectId;

//   if (serviceKey) {
//     try {
//       const parsed = JSON.parse(serviceKey) as {
//         client_email?: string;
//         private_key?: string;
//       };
//       if (parsed?.client_email && parsed?.private_key) {
//         options.credentials = {
//           client_email: parsed.client_email,
//           // ensure newline characters are preserved
//           private_key: parsed.private_key.replace(/\\n/g, "\n"),
//         };
//       }
//     } catch {
//       // if parsing fails, fall back to ADC (no-op)
//       console.warn(
//         "Failed to parse GCLOUD_SERVICE_KEY, using ADC if available"
//       );
//     }
//   }

//   return new BigQuery(options);
// }

/**
 * Build a row object that contains only the columns present in your BigQuery table.
 * This avoids insertion failures caused by unknown columns.
 *
 * NOTE: this function *sets* verified_at to the current time for confirm operations.
 */
function buildWhitelistedRowForConfirm(
  r: VerifyConfirmRowIn
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // Your table columns (adapt if your schema differs)
  out.SO_No = (r.SO_No ?? "").toString();
  out.Customer = r.Customer == null ? null : String(r.Customer);
  out.Item = r.Item == null ? null : String(r.Item);
  out.Color = r.Color == null ? null : String(r.Color);
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

  // server-managed metadata for confirm
  out.verified_at = new Date().toISOString();
  out.source = "sales_orders";

  return out;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VerifyConfirmRequest;
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

    const rowsToInsert = body.rows.map((r) => buildWhitelistedRowForConfirm(r));

    try {
      // ignoreUnknownValues: true tolerates extra fields
      await tableRef.insert(rowsToInsert, { ignoreUnknownValues: true });

      // Return the rows we inserted and a success flag (do not include private credentials)
      return NextResponse.json({
        success: true,
        inserted: rowsToInsert.length,
        rows: rowsToInsert,
      });
    } catch (insertErr: unknown) {
      // log full error on server for debugging
      console.error("BigQuery insert error (confirm):", insertErr);

      const payload: Record<string, unknown> = {
        error: "Insert failed",
        message:
          insertErr instanceof Error ? insertErr.message : String(insertErr),
      };

      // Safely inspect fields that BigQuery-like errors sometimes include
      const errObj = insertErr as Record<string, unknown>;
      if (Array.isArray(errObj["insertErrors"])) {
        payload.insertErrors = errObj["insertErrors"];
      }
      if (Array.isArray(errObj["errors"])) {
        payload.errors = errObj["errors"];
      }
      if (typeof errObj["name"] === "string") {
        payload.name = errObj["name"];
      }
      if (
        typeof errObj["code"] === "number" ||
        typeof errObj["code"] === "string"
      ) {
        payload.code = errObj["code"];
      }

      return NextResponse.json(payload, { status: 500 });
    }
  } catch (err) {
    console.error("Verify confirm POST unexpected error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Confirm failed: " + message },
      { status: 500 }
    );
  }
}
