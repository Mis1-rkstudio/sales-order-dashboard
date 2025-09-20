// app/api/invoice-details/route.ts
import { NextResponse } from "next/server";
import { createBigQueryClient } from "@/lib/bigquery";

type QueryParamsIn = {
  q?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
  offset?: string;
};

export type InvoiceRow = {
  Customer_Name?: string | null;
  Area?: string | null;
  Broker_Name?: string | null;
  Order_No?: string | null;
  Date?: string | null;
  parsed_date?: string | null;
  Total?: number | null;
  Item_Code?: string | null;
  Item_Color?: string | null;
  [key: string]: string | number | null | undefined;
};

function parseQueryParams(url: string): QueryParamsIn {
  const u = new URL(url);
  const s = u.searchParams;
  return {
    q: s.get("q") ?? undefined,
    startDate: s.get("startDate") ?? undefined,
    endDate: s.get("endDate") ?? undefined,
    limit: s.get("limit") ?? undefined,
    offset: s.get("offset") ?? undefined,
  };
}

export async function GET(request: Request) {
  const paramsIn = parseQueryParams(request.url);

  const dataset = process.env.BQ_DATASET;
  // read table name from env; fallback to the previous default
  const table =
    process.env.BQ_TABLE_INVOICE_DETAILS ?? "kolkata_item_wise_customer";
  const projectId = process.env.BQ_PROJECT;
  const location = process.env.BQ_LOCATION ?? "US";

  if (!dataset || !projectId) {
    return NextResponse.json(
      { error: "Missing env: BQ_PROJECT and BQ_DATASET must be set" },
      { status: 500 }
    );
  }

  const bq = createBigQueryClient();

  // Build WHERE filters and params for BigQuery
  const filters: string[] = [];
  const params: Record<string, string | number> = {};

  if (paramsIn.q) {
    filters.push(
      `(LOWER(COALESCE(t.Customer_Name, '')) LIKE LOWER(@q) OR LOWER(COALESCE(t.Order_No, '')) LIKE LOWER(@q) OR LOWER(COALESCE(t.Item_Code, '')) LIKE LOWER(@q))`
    );
    params.q = `%${paramsIn.q}%`;
  }

  if (paramsIn.startDate) {
    filters.push(
      `COALESCE(
         SAFE_CAST(t.Date AS DATE),
         SAFE.PARSE_DATE('%Y-%m-%d', TRIM(t.Date)),
         SAFE.PARSE_DATE('%d-%m-%Y', TRIM(t.Date)),
         SAFE.PARSE_DATE('%d/%m/%Y', TRIM(t.Date))
       ) >= SAFE.PARSE_DATE('%Y-%m-%d', @startDate)`
    );
    params.startDate = paramsIn.startDate;
  }

  if (paramsIn.endDate) {
    filters.push(
      `COALESCE(
         SAFE_CAST(t.Date AS DATE),
         SAFE.PARSE_DATE('%Y-%m-%d', TRIM(t.Date)),
         SAFE.PARSE_DATE('%d-%m-%Y', TRIM(t.Date)),
         SAFE.PARSE_DATE('%d/%m/%Y', TRIM(t.Date))
       ) <= SAFE.PARSE_DATE('%Y-%m-%d', @endDate)`
    );
    params.endDate = paramsIn.endDate;
  }

  const parsedLimit = Number(paramsIn.limit ?? "100");
  const limitNum =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(1000, Math.floor(parsedLimit))
      : 100;
  const parsedOffset = Number(paramsIn.offset ?? "0");
  const offsetNum =
    Number.isFinite(parsedOffset) && parsedOffset >= 0
      ? Math.floor(parsedOffset)
      : 0;

  params.limit = limitNum;
  params.offset = offsetNum;

  const tableRef = `\`${projectId}.${dataset}.${table}\``;

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const sql = String.raw`
    WITH parsed AS (
      SELECT
        Customer_Name,
        Area,
        Broker_Name,
        Order_No,
        Date,
        COALESCE(
          SAFE_CAST(Date AS DATE),
          SAFE.PARSE_DATE('%Y-%m-%d', TRIM(Date)),
          SAFE.PARSE_DATE('%d-%m-%Y', TRIM(Date)),
          SAFE.PARSE_DATE('%d/%m/%Y', TRIM(Date))
        ) AS parsed_date,
        Total,
        Item_Code,
        Item_Color
      FROM ${tableRef} AS t
      ${whereClause}
    )
    SELECT
      Customer_Name,
      Area,
      Broker_Name,
      Order_No,
      Date,
      FORMAT_DATE('%Y-%m-%d', parsed_date) AS parsed_date,
      Total,
      Item_Code,
      Item_Color
    FROM parsed
    ORDER BY parsed_date ASC NULLS LAST, Order_No ASC
    LIMIT @limit OFFSET @offset
  `;

  const countSql = String.raw`
    WITH parsed AS (
      SELECT
        COALESCE(
          SAFE_CAST(Date AS DATE),
          SAFE.PARSE_DATE('%Y-%m-%d', TRIM(Date)),
          SAFE.PARSE_DATE('%d-%m-%Y', TRIM(Date)),
          SAFE.PARSE_DATE('%d/%m/%Y', TRIM(Date))
        ) AS parsed_date
      FROM ${tableRef} AS t
      ${whereClause}
    )
    SELECT COUNT(1) AS cnt FROM parsed
  `;

  try {
    const [rowsResult] = await bq.query({
      query: sql,
      location,
      params,
    });

    const rows = (rowsResult as unknown[])?.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        Customer_Name:
          rec.Customer_Name == null ? null : String(rec.Customer_Name),
        Area: rec.Area == null ? null : String(rec.Area),
        Broker_Name: rec.Broker_Name == null ? null : String(rec.Broker_Name),
        Order_No: rec.Order_No == null ? null : String(rec.Order_No),
        Date: rec.Date == null ? null : String(rec.Date),
        parsed_date: rec.parsed_date == null ? null : String(rec.parsed_date),
        Total:
          rec.Total == null
            ? null
            : typeof rec.Total === "number"
            ? rec.Total
            : Number(rec.Total) || null,
        Item_Code: rec.Item_Code == null ? null : String(rec.Item_Code),
        Item_Color: rec.Item_Color == null ? null : String(rec.Item_Color),
      } as InvoiceRow;
    });

    const [countResult] = await bq.query({
      query: countSql,
      location,
      params,
    });

    const total =
      Array.isArray(countResult) && countResult.length > 0
        ? Number(
            (countResult[0] as { cnt?: string | number }).cnt ?? rows.length
          )
        : rows.length;

    return NextResponse.json({ rows, total });
  } catch (error) {
    console.error("BigQuery query error (invoice-details):", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "BigQuery query failed: " + message },
      { status: 500 }
    );
  }
}
