// app/api/dispatch/route.ts
import { NextResponse } from "next/server";
import { createBigQueryClient, insertRowsWithEnsure } from "@/lib/bigquery";

export type DispatchRow = {
  SO_No: string;
  Customer?: string | null;
  Item?: string | null;
  Color?: string | null;
  // optional quantity produced associated with this dispatch
  ProductionQty?: number | null;
  Dispatched: boolean;
  Dispatched_At?: string | null;
};

function extractErrorDetails(err: unknown): string {
  // handle null / undefined explicitly
  if (err === null || err === undefined) return String(err);

  if (typeof err === "string") return err;

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
    if (maybeResponse && typeof maybeResponse === "object") {
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
      return NextResponse.json(
        { error: "Invalid body: expected { rows: [...] }" },
        { status: 400 }
      );
    }

    const rawRows = body.rows as unknown[];

    // normalize/validate rows
    const rowsToInsert: DispatchRow[] = rawRows
      .map((r) => {
        if (!r || typeof r !== "object") return null;
        const obj = r as Record<string, unknown>;
        const so =
          typeof obj.SO_No === "string" && obj.SO_No.trim()
            ? obj.SO_No.trim()
            : undefined;
        if (!so) return null;
        // parse ProductionQty if present (allow number or numeric string)
        let prodQty: number | null = null;
        if (typeof obj.ProductionQty === "number") {
          prodQty = Number.isFinite(obj.ProductionQty)
            ? (obj.ProductionQty as number)
            : null;
        } else if (typeof obj.ProductionQty === "string") {
          const n = Number(obj.ProductionQty);
          prodQty = Number.isNaN(n) ? null : n;
        }

        return {
          SO_No: so,
          Customer: typeof obj.Customer === "string" ? obj.Customer : null,
          Item: typeof obj.Item === "string" ? obj.Item : null,
          Color: typeof obj.Color === "string" ? obj.Color : null,
          ProductionQty: prodQty,
          Dispatched: Boolean(obj.Dispatched),
          Dispatched_At: new Date().toISOString(),
        } as DispatchRow;
      })
      .filter((x): x is DispatchRow => x !== null);

    if (rowsToInsert.length === 0) {
      return NextResponse.json(
        { error: "No valid rows to insert (missing or invalid SO_No?)" },
        { status: 400 }
      );
    }

    const projectId = process.env.BQ_PROJECT;
    const dataset = process.env.BQ_DATASET;
    const table = process.env.BQ_TABLE_DISPATCHED ?? "dispatched_orders";

    if (!projectId || !dataset) {
      return NextResponse.json(
        { error: "Missing env: BQ_PROJECT and BQ_DATASET must be set" },
        { status: 500 }
      );
    }

    const bq = createBigQueryClient();

    const tableRef = `${projectId}.${dataset}.${table}`;

    // server-side debug log so you can inspect what's being inserted
    console.info(
      `Dispatch insert -> table=${tableRef}, rows=${rowsToInsert.length}`
    );
    console.debug(
      "Dispatch rows sample:",
      JSON.stringify(rowsToInsert.slice(0, 5), null, 2)
    );

    try {
      // use helper which ensures dataset/table exist before insert
      const insertResult = await insertRowsWithEnsure(
        bq,
        dataset,
        table,
        rowsToInsert as Array<Record<string, unknown>>
      );
      console.debug("BigQuery insert result:", insertResult);

      return NextResponse.json({
        inserted: rowsToInsert.length,
        table: tableRef,
      });
    } catch (insertError) {
      const details = extractErrorDetails(insertError);
      console.error("BigQuery insert (ensure) error:", details, insertError);
      return NextResponse.json(
        { error: "BigQuery insert error", details },
        { status: 500 }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("dispatch POST error", err);
    return NextResponse.json(
      { error: `Server error: ${msg}` },
      { status: 500 }
    );
  }
}
