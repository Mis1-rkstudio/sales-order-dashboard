// app/api/stock/batch/route.ts
import { NextResponse } from "next/server";
import { createBigQueryClient } from "@/lib/bigquery";

type BatchRequest = {
  items: string[]; // list of normalized/literal item strings (lowercase recommended)
};

export type StockBatchRow = {
  Item?: string | null;
  normalized_item?: string | null;
  Color?: string | null;
  Closing_Stock?: number | null;
  Location?: string | null;
  Product_type?: string | null;
  Concept?: string | null;
  Fabric?: string | null;
  file_URL?: string | null;
  // maybe extra fields
  [key: string]: string | number | null | undefined;
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
//           private_key: parsed.private_key.replace(/\\n/g, "\n"),
//         };
//       }
//     } catch {
//       // fallback to ADC
//       console.warn(
//         "Failed to parse GCLOUD_SERVICE_KEY, using ADC if available"
//       );
//     }
//   }

//   return new BigQuery(options);
// }

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BatchRequest;
    const items = (body.items ?? [])
      .map((s) =>
        String(s ?? "")
          .trim()
          .toLowerCase()
      )
      .filter(Boolean);

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    const bq = createBigQueryClient();
    const projectId = process.env.BQ_PROJECT;
    const dataset = process.env.BQ_DATASET;
    const table = process.env.BQ_TABLE_STOCK ?? "stock_combined";
    if (!projectId || !dataset) {
      return NextResponse.json(
        { error: "Missing BQ_PROJECT or BQ_DATASET" },
        { status: 500 }
      );
    }

    const tableRef = `\`${projectId}.frono.${table}\``;

    // Query matches by normalized_item OR raw Item (case-insensitive)
    const sql = `
      SELECT
        Item,
        normalized_item,
        Color,
        Closing_Stock,
        Location,
        Product_type,
        Concept,
        Fabric,
        file_URL
      FROM ${tableRef}
      WHERE LOWER(TRIM(normalized_item)) IN UNNEST(@items)
         OR LOWER(TRIM(Item)) IN UNNEST(@items)
    `;

    const [rowsResult] = await bq.query({
      query: sql,
      params: { items },
      // location optional
      location: process.env.BQ_LOCATION ?? "US",
    });

    const rows = rowsResult as unknown as StockBatchRow[];
    return NextResponse.json({ rows });
  } catch (err) {
    console.error("stock/batch error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
