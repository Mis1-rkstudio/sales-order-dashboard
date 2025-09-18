// app/api/customers/route.ts
import { NextResponse } from 'next/server';
import { getBigQueryClient } from '@/lib/bigquery';

type QueryParamsIn = {
  q?: string;
  type?: string;
  city?: string;
  minOutstanding?: string;
  limit?: string;
  offset?: string;
  sortBy?: string;
  order?: string;
};

// shape returned from BigQuery (allow additional columns too)
export type CustomerRow = {
  Company_Name?: string | null;
  Cust_Ved_Type?: string | null;
  Area?: string | null;
  City?: string | null;
  State?: string | null;
  Outstanding?: number | null;
  Type?: string | null;
  Broker?: string | null;
  Contact_Name?: string | null;
  Number?: string | null;
  Created_Date?: string | null;

  // new columns from customer_combined
  rk_rating?: string | null;
  abmulance_corridor?: string | null;
  customer_status?: string | null;

  // produced aliases (optional duplicates)
  Customer?: string | null;
  Customer_Type?: string | null;
  Rating?: string | null;

  // allow other fields present in table
  [key: string]: string | number | null | undefined;
};

function parseQueryParams(url: string): QueryParamsIn {
  const u = new URL(url);
  const s = u.searchParams;
  return {
    q: s.get('q') ?? undefined,
    type: s.get('type') ?? undefined,
    city: s.get('city') ?? undefined,
    minOutstanding: s.get('minOutstanding') ?? undefined,
    limit: s.get('limit') ?? undefined,
    offset: s.get('offset') ?? undefined,
    sortBy: s.get('sortBy') ?? undefined,
    order: s.get('order') ?? undefined,
  };
}

export async function GET(request: Request) {
  const paramsIn = parseQueryParams(request.url);

  const projectId = process.env.BQ_PROJECT;
  const dataset = process.env.BQ_DATASET;
  // default to customer_combined
  const table = process.env.BQ_TABLE_CUSTOMER ?? 'customer_combined';
  const location = process.env.BQ_LOCATION ?? 'US';

  if (!projectId || !dataset) {
    return NextResponse.json(
      { error: 'Missing env: BQ_PROJECT and BQ_DATASET must be set' },
      { status: 500 }
    );
  }

  const bq = getBigQueryClient();

  // Build parameterized WHERE clauses
  const whereClauses: string[] = [];
  const params: Record<string, string | number> = {};

  if (paramsIn.q) {
    whereClauses.push(
      `(LOWER(CAST(Company_Name AS STRING)) LIKE LOWER(@q) OR LOWER(CAST(City AS STRING)) LIKE LOWER(@q) OR LOWER(CAST(Area AS STRING)) LIKE LOWER(@q) OR LOWER(CAST(Broker AS STRING)) LIKE LOWER(@q))`
    );
    params.q = `%${paramsIn.q}%`;
  }

  if (paramsIn.type) {
    whereClauses.push(`Cust_Ved_Type = @type`);
    params.type = paramsIn.type;
  }

  if (paramsIn.city) {
    whereClauses.push(`City = @city`);
    params.city = paramsIn.city;
  }

  if (paramsIn.minOutstanding) {
    const parsed = Number(paramsIn.minOutstanding);
    if (!Number.isNaN(parsed)) {
      whereClauses.push(`CAST(Outstanding AS FLOAT64) >= @minOutstanding`);
      params.minOutstanding = parsed;
    }
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const limitNum = Math.min(1000, Math.max(1, Number(paramsIn.limit ?? '50')));
  const offsetNum = Math.max(0, Number(paramsIn.offset ?? '0'));
  params.limit = limitNum;
  params.offset = offsetNum;

  // restrict allowed sort fields for safety
  const allowedSortBy = new Set(['Created_Date', 'Outstanding', 'Company_Name']);
  const sortBy = allowedSortBy.has(paramsIn.sortBy ?? '') ? (paramsIn.sortBy as string) : 'Created_Date';
  const order = (paramsIn.order ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const tableRef = `\`${projectId}.frono.${table}\``;

  // Select explicit columns and add the aliases you requested
  const selectSql = `
    SELECT
      Company_Name,
      Area,
      City,
      State,
      Outstanding,
      Type,
      Broker,
      Contact_Name,
      Number,
      Created_Date,
      abmulance_corridor,
      customer_status,

      -- aliases (keeps original fields too)
      Company_Name AS Customer,
      Cust_Ved_Type AS Customer_Type,
      rk_rating AS Rating
    FROM ${tableRef}
    ${whereSql}
    ORDER BY ${sortBy} ${order}
    LIMIT @limit OFFSET @offset
  `;

  // If you prefer to return *every* column from customer_combined, you can replace the selectSql with:
  // const selectSql = `SELECT *, Company_Name AS Customer, Cust_Ved_Type AS Customer_Type, rk_rating AS Rating FROM ${tableRef} ${whereSql} ORDER BY ${sortBy} ${order} LIMIT @limit OFFSET @offset`;

  const countSql = `
    SELECT COUNT(1) AS cnt
    FROM ${tableRef}
    ${whereSql}
  `;

  try {
    const [rowsResult] = await bq.query({
      query: selectSql,
      location,
      params,
    });

    const rows = (rowsResult as unknown) as CustomerRow[];

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
    console.error('customers BigQuery error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
