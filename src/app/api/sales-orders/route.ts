// app/api/sales-orders/route.ts
import { NextResponse } from 'next/server';
import { BigQuery } from '@google-cloud/bigquery';

type QueryParamsIn = {
  q?: string;
  tokens?: string[];
  brand?: string;
  city?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
  offset?: string;
  includeColumn?: string;
  includeValues?: string[];
};

export type SalesOrderRow = {
  SO_Date?: string | null;
  SO_No?: string | null;
  Customer?: string | null;
  Customer_Type?: string | null;
  Rating?: string | null;
  Broker?: string | null;
  Item?: string | null;
  Color?: string | null;
  Size?: string | null;
  OrderQty?: number | null;
  Expected_Date?: string | null;
  Status?: string | null;
  Concept?: string | null;
  Fabric?: string | null;
  ItemCode?: string | null;
  File_URL?: string | null;
  so_date_parsed?: string | null;
};

function parseQueryParams(url: string): QueryParamsIn {
  const u = new URL(url);
  const s = u.searchParams;
  return {
    q: s.get('q') ?? undefined,
    tokens: s.getAll('tokens')?.length ? s.getAll('tokens') : undefined,
    brand: s.get('brand') ?? undefined,
    city: s.get('city') ?? undefined,
    startDate: s.get('startDate') ?? undefined,
    endDate: s.get('endDate') ?? undefined,
    limit: s.get('limit') ?? undefined,
    offset: s.get('offset') ?? undefined,
    includeColumn: s.get('includeColumn') ?? undefined,
    includeValues: s.getAll('includeValues')?.length ? s.getAll('includeValues') : undefined,
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
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
        };
      }
    } catch {
      // fallback to ADC if available
      // eslint-disable-next-line no-console
      console.warn('Failed to parse GCLOUD_SERVICE_KEY, using ADC if available');
    }
  }

  return new BigQuery(options);
}

export async function GET(request: Request) {
  const paramsIn = parseQueryParams(request.url);

  const dataset = process.env.BQ_DATASET;
  const table = process.env.BQ_TABLE_SO;
  const sampleTable = process.env.BQ_TABLE_SAMPLE ?? 'Sample_details';
  const customersTable = process.env.BQ_TABLE_CUSTOMER_COMBINED ?? 'customer_combined';
  const projectId = process.env.BQ_PROJECT;
  const location = process.env.BQ_LOCATION ?? 'US';

  if (!dataset || !table || !projectId) {
    return NextResponse.json({ error: 'Missing env: BQ_PROJECT, BQ_DATASET, BQ_TABLE_SO must be set' }, { status: 500 });
  }

  const bq = createBigQueryClient();

  // Build WHERE filters and parameter bag
  const filters: string[] = [];
  const params: Record<string, string | number | string[]> = {};

  if (paramsIn.q) {
    filters.push(
      `(LOWER(COALESCE(ps.SO_No, '')) LIKE LOWER(@q) OR LOWER(COALESCE(ps.Item_Name_Code, '')) LIKE LOWER(@q) OR LOWER(COALESCE(ps.Parent_CustomerCity, '')) LIKE LOWER(@q))`
    );
    params.q = `%${paramsIn.q}%`;
  }

  if (paramsIn.tokens && paramsIn.tokens.length > 0) {
    paramsIn.tokens.forEach((token, idx) => {
      const key = `token${idx}`;
      filters.push(
        `(LOWER(COALESCE(ps.SO_No, '')) LIKE LOWER(@${key}) OR LOWER(COALESCE(ps.Item_Name_Code, '')) LIKE LOWER(@${key}) OR LOWER(COALESCE(ps.Parent_CustomerCity, '')) LIKE LOWER(@${key}))`
      );
      params[key] = `%${token}%`;
    });
  }

  if (paramsIn.brand) {
    filters.push('ps.Brand = @brand');
    params.brand = paramsIn.brand;
  }
  if (paramsIn.city) {
    filters.push('(LOWER(ps.Parent_CustomerCity) = LOWER(@city) OR LOWER(ps.Child_Customer_City) = LOWER(@city))');
    params.city = paramsIn.city;
  }
  if (paramsIn.startDate) {
    filters.push('ps.so_date_parsed >= SAFE.PARSE_DATE("%Y-%m-%d", @startDate)');
    params.startDate = paramsIn.startDate;
  }
  if (paramsIn.endDate) {
    filters.push('ps.so_date_parsed <= SAFE.PARSE_DATE("%Y-%m-%d", @endDate)');
    params.endDate = paramsIn.endDate;
  }

  // always apply item length and pending filter (qualified)
  const itemLengthFilter = 'CHAR_LENGTH(TRIM(ps.Item_Name_Code)) <= 8';
  const pendingFilter = `UPPER(TRIM(ps.Status)) = 'PENDING'`;

  // include logic - validated against allowed columns (we will qualify with ps.)
  // Added "Customer" mapping -> Parent_CustomerCity so client can request includeColumn=Customer
  const ALLOWED_INCLUDE_COLUMNS: Record<string, string> = {
    SO_No: 'SO_No',
    Item_Name_Code: 'Item_Name_Code',
    Parent_CustomerCity: 'Parent_CustomerCity',
    Color_Code: 'Color_Code',
    Broker: 'Broker',
    Customer: 'Parent_CustomerCity', // accept "Customer" from client and map it to Parent_CustomerCity
  };

  let includeConditionSql = '';
  if (paramsIn.includeColumn && paramsIn.includeValues && paramsIn.includeValues.length > 0) {
    const mapped = ALLOWED_INCLUDE_COLUMNS[paramsIn.includeColumn];
    if (mapped) {
      // qualify mapped column with ps alias and parameterize values
      includeConditionSql = `(ps.${mapped} IN UNNEST(@includeValues))`;
      // ensure includeValues is an array of strings
      params.includeValues = paramsIn.includeValues.map((v) => (v ?? '').toString());
    } else {
      // ignore invalid includeColumn
      // eslint-disable-next-line no-console
      console.warn('Ignored invalid includeColumn:', paramsIn.includeColumn);
    }
  }

  const baseFiltersSql = filters.length ? filters.join(' AND ') : 'TRUE';
  const leftSide = `(${baseFiltersSql}) AND ${itemLengthFilter} AND ${pendingFilter}`;

  const limitNum = Math.min(500, Number(paramsIn.limit ?? '25'));
  const offsetNum = Math.max(0, Number(paramsIn.offset ?? '0'));
  params.limit = limitNum;
  params.offset = offsetNum;

  const tableRef = `\`${projectId}.${dataset}.${table}\``;
  const sampleRef = `\`${projectId}.frono.${sampleTable}\``;
  const customersRef = `\`${projectId}.frono.${customersTable}\``;

  const sql = String.raw`
    WITH parsed_sales AS (
      SELECT
        Parent_CustomerCity,
        Child_Customer_City,
        Broker,
        SO_No,
        SO_Date,
        Item_Name_Code,
        Color_Code,
        Brand,
        SubCategory,
        Size,
        Total,
        Remark,
        Expected_Date,
        GroupBy,
        Status,
        COALESCE(
          SAFE_CAST(SO_Date AS DATE),
          SAFE.PARSE_DATE('%Y-%m-%d', TRIM(SO_Date)),
          SAFE.PARSE_DATE('%d-%m-%Y', TRIM(SO_Date)),
          SAFE.PARSE_DATE('%d/%m/%Y', TRIM(SO_Date))
        ) AS so_date_parsed,
        LOWER(TRIM(REGEXP_REPLACE(COALESCE(Parent_CustomerCity, ''), r'\\s*\\[.*?\\]', ''))) AS customer_norm
      FROM ${tableRef}
    ),

    sample AS (
      SELECT
        Product_Code,
        Concept_2,
        Concept_3,
        File_URL
      FROM ${sampleRef}
    ),

    customers AS (
      SELECT
        Company_Name,
        Cust_Ved_Type,
        rk_rating
      FROM ${customersRef}
    )

    SELECT
      CASE WHEN ps.so_date_parsed IS NOT NULL THEN FORMAT_DATE('%d-%m-%Y', ps.so_date_parsed) ELSE ps.SO_Date END AS SO_Date,
      ps.SO_No,
      ps.Parent_CustomerCity AS Customer,
      cc.Cust_Ved_Type AS Customer_Type,
      cc.rk_rating AS Rating,
      ps.Broker,
      ps.Item_Name_Code AS Item,
      ps.Color_Code AS Color,
      ps.Size,
      SAFE_CAST(ps.Total AS INT64) AS OrderQty,
      ps.Expected_Date,
      ps.Status,
      s.Concept_2 AS Concept,
      s.Concept_3 AS Fabric,
      s.Product_Code AS ItemCode,
      s.File_URL AS File_URL,
      CAST(ps.so_date_parsed AS STRING) as so_date_parsed

    FROM parsed_sales ps
    LEFT JOIN sample s
      ON LOWER(TRIM(ps.Item_Name_Code)) = LOWER(TRIM(s.Product_Code))
    LEFT JOIN customers cc
      ON LOWER(TRIM(cc.Company_Name)) = ps.customer_norm
    ${includeConditionSql ? `WHERE ( ${leftSide} ) OR (${includeConditionSql})` : `WHERE ${leftSide}`}
    ORDER BY ps.so_date_parsed ASC NULLS LAST
    LIMIT @limit OFFSET @offset
  `;

  const countSql = String.raw`
    WITH parsed_sales AS (
      SELECT
        COALESCE(
          SAFE_CAST(SO_Date AS DATE),
          SAFE.PARSE_DATE('%Y-%m-%d', TRIM(SO_Date)),
          SAFE.PARSE_DATE('%d-%m-%Y', TRIM(SO_Date)),
          SAFE.PARSE_DATE('%d/%m/%Y', TRIM(SO_Date))
        ) AS so_date_parsed,
        Item_Name_Code,
        Status,
        SO_No,
        Color_Code,
        LOWER(TRIM(REGEXP_REPLACE(COALESCE(Parent_CustomerCity, ''), r'\\s*\\[.*?\\]', ''))) AS customer_norm
      FROM ${tableRef}
    )
    SELECT COUNT(1) as cnt
    FROM parsed_sales ps
    LEFT JOIN ${sampleRef} s
      ON LOWER(TRIM(ps.Item_Name_Code)) = LOWER(TRIM(s.Product_Code))
    LEFT JOIN ${customersRef} cc
      ON LOWER(TRIM(cc.Company_Name)) = ps.customer_norm
    ${includeConditionSql ? `WHERE ( ${leftSide} ) OR (${includeConditionSql})` : `WHERE ${leftSide}`}
  `;

  try {
    // debug SQL & param keys server-side (safe to log keys only). Remove or guard in production.
    // console.debug('BigQuery SQL (preview):', sql.split('\n').slice(0, 10).join('\n'));
    // console.debug('BigQuery params keys:', Object.keys(params));

    const [rowsResult] = await bq.query({
      query: sql,
      location,
      params,
    });

    const rows = (rowsResult as unknown) as SalesOrderRow[];

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
    console.error('BigQuery query error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'BigQuery query failed: ' + message }, { status: 500 });
  }
}
