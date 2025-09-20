// app/api/dispatch/keys/route.ts
import { NextResponse } from "next/server";
import { getBigQueryClient } from "@/lib/bigquery";

export async function GET(_: Request) {
  try {
    const projectId = process.env.BQ_PROJECT;
    const dataset = process.env.BQ_DATASET;
    const table = process.env.BQ_TABLE_DISPATCHED ?? "dispatched_orders";

    if (!projectId || !dataset) {
      return NextResponse.json(
        { error: "Missing BQ_PROJECT or BQ_DATASET" },
        { status: 500 }
      );
    }

    const bq = getBigQueryClient();

    // build composite normalized key: SO_No|Customer|Item|Color (each TRIM()+UPPER()); coalesce nulls to empty string
    const sql = `
      SELECT DISTINCT
        CONCAT(
          COALESCE(UPPER(TRIM(SO_No)), ''),
          '|',
          COALESCE(UPPER(TRIM(Customer)), ''),
          '|',
          COALESCE(UPPER(TRIM(Item)), ''),
          '|',
          COALESCE(UPPER(TRIM(Color)), '')
        ) AS dispatch_key
      FROM \`${projectId}.${dataset}.${table}\`
      WHERE SO_No IS NOT NULL
    `;

    const [job] = await bq.createQueryJob({ query: sql });
    const [rows] = await job.getQueryResults();

    const keys: string[] = (rows ?? [])
      .map((r) => {
        const v = (r as Record<string, unknown>)["dispatch_key"];
        return typeof v === "string" ? v : String(v ?? "");
      })
      .filter((k) => k.length > 0);

    return NextResponse.json({ keys });
  } catch (err) {
    console.error("dispatch keys error", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
