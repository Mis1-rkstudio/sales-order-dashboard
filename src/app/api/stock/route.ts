// app/api/stock/route.ts
import { NextResponse } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";

type QueryParamsIn = {
  q?: string;
  item?: string;
  normalizedItem?: string;
  location?: string;
  limit?: string;
  offset?: string;
  sortBy?: string;
  order?: string;
};

export type StockRow = {
  Item?: string | null;
  Color?: string | null;
  Sizes?: string[] | null; // aggregated distinct sizes for the Item+Color group
  Opening_Stock?: number | null;
  Stock_In?: number | null;
  Stock_Out?: number | null;
  Closing_Stock?: number | null;
  normalized_item?: string | null;
  Location?: string | null;
  Product_type?: string | null;
  Concept?: string | null;
  Fabric?: string | null;
  file_URL?: string | null;
  SNP?: number | null;
  WSP?: number | null;
  stock_status?: string | null;
  cost_price?: number | null;
  adjusted_cost_price?: number | null;
  [key: string]: string | number | null | undefined | string[] | undefined;
};

function parseQueryParams(url: string): QueryParamsIn {
  const u = new URL(url);
  const s = u.searchParams;
  return {
    q: s.get("q") ?? undefined,
    item: s.get("item") ?? undefined,
    normalizedItem: s.get("normalizedItem") ?? undefined,
    location: s.get("location") ?? undefined,
    limit: s.get("limit") ?? undefined,
    offset: s.get("offset") ?? undefined,
    sortBy: s.get("sortBy") ?? undefined,
    order: s.get("order") ?? undefined,
  };
}

function createBigQueryClient(): BigQuery {
  const projectId = process.env.BQ_PROJECT;
  const serviceKey = process.env.GCLOUD_SERVICE_KEY;

  const options: { projectId?: string; credentials?: { client_email: string; private_key: string } } = {};
  if (projectId) options.projectId = projectId;

  if (serviceKey) {
    try {
      const parsed = JSON.parse(serviceKey) as { client_email?: string; private_key?: string };
      if (parsed?.client_email && parsed?.private_key) {
        options.credentials = {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch {
      // fallback to ADC if available
      // eslint-disable-next-line no-console
      console.warn("Failed to parse GCLOUD_SERVICE_KEY, using ADC if available");
    }
  }

  return new BigQuery(options);
}

export async function GET(request: Request) {
  const paramsIn = parseQueryParams(request.url);

  const dataset = process.env.BQ_DATASET;
  const table = process.env.BQ_TABLE_STOCK ?? "stock_combined";
  const projectId = process.env.BQ_PROJECT;
  const location = paramsIn.location ?? process.env.BQ_LOCATION ?? "US";

  if (!dataset || !projectId) {
    return NextResponse.json({ error: "Missing env: BQ_PROJECT and BQ_DATASET must be set" }, { status: 500 });
  }

  const bq = createBigQueryClient();

  // build WHERE clauses and params
  const whereClauses: string[] = [];
  const params: Record<string, string | number> = {};

  if (paramsIn.q) {
    // search common textual columns
    whereClauses.push(
      `(
        LOWER(COALESCE(Item, '')) LIKE LOWER(@q) OR
        LOWER(COALESCE(normalized_item, '')) LIKE LOWER(@q) OR
        LOWER(COALESCE(Concept, '')) LIKE LOWER(@q) OR
        LOWER(COALESCE(Fabric, '')) LIKE LOWER(@q)
      )`
    );
    params.q = `%${paramsIn.q}%`;
  }

  if (paramsIn.normalizedItem) {
    whereClauses.push(`LOWER(COALESCE(normalized_item, '')) = LOWER(@normalizedItem)`);
    params.normalizedItem = paramsIn.normalizedItem.trim();
  }

  if (paramsIn.item) {
    // exact match on Item (case-insensitive)
    whereClauses.push(`LOWER(COALESCE(Item, '')) = LOWER(@item)`);
    params.item = paramsIn.item.trim();
  }

  if (paramsIn.location) {
    whereClauses.push(`LOWER(COALESCE(Location, '')) = LOWER(@location)`);
    params.location = paramsIn.location;
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // pagination params (preserved)
  const limitNum = Math.min(1000, Math.max(1, Number(paramsIn.limit ?? "50")));
  const offsetNum = Math.max(0, Number(paramsIn.offset ?? "0"));
  params.limit = limitNum;
  params.offset = offsetNum;

  // allow limited sort fields for safety (must exist in outer select)
  const allowedSort = new Set(["Closing_Stock", "Item", "normalized_item", "Product_type", "Color"]);
  const sortBy = allowedSort.has(paramsIn.sortBy ?? "") ? (paramsIn.sortBy as string) : "Item";
  const order = (paramsIn.order ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";

  const tableRef = `\`${projectId}.frono.${table}\``;

  /**
   * Aggregation strategy:
   * - Group by normalized_item_key (coalesced) + Color
   * - Collapse duplicates that have same Item+Color (regardless of Size)
   * - Return MAX(Closing_Stock) for each group
   * - Provide distinct Sizes array for visibility of sizes present in the group
   * - Representative fields use ANY_VALUE(); numeric aggregates use MAX where appropriate
   */
  const aggSql = `
    SELECT
      COALESCE(TRIM(normalized_item), TRIM(Item)) AS normalized_item_key,
      ANY_VALUE(Item) AS Item,
      COALESCE(TRIM(Color), '') AS Color,
      ARRAY_AGG(DISTINCT TRIM(CAST(Size AS STRING))) AS Sizes,
      ANY_VALUE(Opening_Stock) AS Opening_Stock,
      MAX(CAST(Closing_Stock AS INT64)) AS Closing_Stock,
      ANY_VALUE(Location) AS Location,
      ANY_VALUE(Product_type) AS Product_type,
      ANY_VALUE(Concept) AS Concept,
      ANY_VALUE(Fabric) AS Fabric,
      ANY_VALUE(file_URL) AS file_URL,
      MAX(CAST(SNP AS INT64)) AS SNP,
      MAX(CAST(WSP AS INT64)) AS WSP,
      ANY_VALUE(stock_status) AS stock_status,
      MAX(CAST(cost_price AS FLOAT64)) AS cost_price,
      MAX(CAST(adjusted_cost_price AS FLOAT64)) AS adjusted_cost_price
    FROM ${tableRef}
    ${whereSql}
    GROUP BY normalized_item_key, Color
  `;

  // Map sort column into available outer columns
  const orderByExpr =
    sortBy === "Closing_Stock"
      ? "Closing_Stock"
      : sortBy === "Product_type"
      ? "Product_type"
      : sortBy === "Color"
      ? "Color"
      : "Item";

  // Outer select with pagination
  const pagedSql = `
    SELECT
      normalized_item_key AS normalized_item,
      Item,
      Color,
      Sizes,
      Opening_Stock,
      Closing_Stock,
      Location,
      Product_type,
      Concept,
      Fabric,
      file_URL,
      SNP,
      WSP,
      stock_status,
      cost_price,
      adjusted_cost_price
    FROM (
      ${aggSql}
    )
    ORDER BY ${orderByExpr} ${order}
  `;

  // Count grouped rows to compute total
  const countSql = `
    SELECT COUNT(1) AS cnt FROM (
      SELECT 1
      FROM ${tableRef}
      ${whereSql}
      GROUP BY COALESCE(TRIM(normalized_item), TRIM(Item)), COALESCE(TRIM(Color), '')
    )
  `;

  try {
    const [rowsResult] = await bq.query({
      query: pagedSql,
      location,
      params,
    });

    const rows = (rowsResult as unknown) as StockRow[];

    const [countResult] = await bq.query({
      query: countSql,
      location,
      params,
    });

    const total =
      Array.isArray(countResult) && countResult.length > 0
        ? Number((countResult[0] as { cnt?: string | number }).cnt ?? rows.length)
        : rows.length;

    return NextResponse.json({ rows, total });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("BigQuery stock query error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "BigQuery query failed: " + message }, { status: 500 });
  }
}
