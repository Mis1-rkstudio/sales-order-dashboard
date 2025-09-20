// app/api/sales-orders/route.ts
import { NextResponse } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";

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
  Customer_Type?: string | null; // from customer_combined.Cust_Ved_Type
  Rating?: string | null; // from customer_combined.rk_rating
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
  CustomerCity?: string | null;
  [key: string]: string | number | null | undefined;
};

function parseQueryParams(url: string): QueryParamsIn {
  const u = new URL(url);
  const s = u.searchParams;
  return {
    q: s.get("q") ?? undefined,
    tokens: s.getAll("tokens")?.length ? s.getAll("tokens") : undefined,
    brand: s.get("brand") ?? undefined,
    city: s.get("city") ?? undefined,
    startDate: s.get("startDate") ?? undefined,
    endDate: s.get("endDate") ?? undefined,
    limit: s.get("limit") ?? undefined,
    offset: s.get("offset") ?? undefined,
    includeColumn: s.get("includeColumn") ?? undefined,
    includeValues: s.getAll("includeValues")?.length
      ? s.getAll("includeValues")
      : undefined,
  };
}

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

export async function GET(request: Request) {
  const paramsIn = parseQueryParams(request.url);

  const dataset = process.env.BQ_DATASET;
  const table = process.env.BQ_TABLE_SO;
  const sampleTable = process.env.BQ_TABLE_SAMPLE ?? "Sample_details";
  const customersTable =
    process.env.BQ_TABLE_CUSTOMER_COMBINED ?? "customer_combined";
  const projectId = process.env.BQ_PROJECT;
  const location = process.env.BQ_LOCATION ?? "US";

  if (!dataset || !table || !projectId) {
    return NextResponse.json(
      { error: "Missing env: BQ_PROJECT, BQ_DATASET, BQ_TABLE_SO must be set" },
      { status: 500 }
    );
  }

  const bq = createBigQueryClient();

  // Build WHERE filters and parameter bag
  const filters: string[] = [];
  const params: Record<string, string | number | string[]> = {};

  if (paramsIn.q) {
    filters.push(
      `(LOWER(COALESCE(ps.SO_No, '')) LIKE LOWER(@q) OR LOWER(COALESCE(ps.Item_Name_Code, '')) LIKE LOWER(@q) OR LOWER(COALESCE(ps.Parent_CustomerCity_raw, '')) LIKE LOWER(@q))`
    );
    params.q = `%${paramsIn.q}%`;
  }

  if (paramsIn.tokens && paramsIn.tokens.length > 0) {
    paramsIn.tokens.forEach((token, idx) => {
      const key = `token${idx}`;
      filters.push(
        `(LOWER(COALESCE(ps.SO_No, '')) LIKE LOWER(@${key}) OR LOWER(COALESCE(ps.Item_Name_Code, '')) LIKE LOWER(@${key}) OR LOWER(COALESCE(ps.Parent_CustomerCity_raw, '')) LIKE LOWER(@${key}))`
      );
      params[key] = `%${token}%`;
    });
  }

  if (paramsIn.brand) {
    filters.push("ps.Brand = @brand");
    params.brand = paramsIn.brand;
  }
  if (paramsIn.city) {
    filters.push(
      "(LOWER(ps.Parent_CustomerCity_raw) = LOWER(@city) OR LOWER(ps.Child_Customer_City) = LOWER(@city))"
    );
    params.city = paramsIn.city;
  }
  if (paramsIn.startDate) {
    filters.push(
      'ps.so_date_parsed >= SAFE.PARSE_DATE("%Y-%m-%d", @startDate)'
    );
    params.startDate = paramsIn.startDate;
  }
  if (paramsIn.endDate) {
    filters.push('ps.so_date_parsed <= SAFE.PARSE_DATE("%Y-%m-%d", @endDate)');
    params.endDate = paramsIn.endDate;
  }

  // always apply item length and pending filter (qualified)
  const itemLengthFilter = "CHAR_LENGTH(TRIM(ps.Item_Name_Code)) <= 8";
  const pendingFilter = `UPPER(TRIM(ps.Status)) = 'PENDING'`;

  const ALLOWED_INCLUDE_COLUMNS: Record<string, string> = {
    SO_No: "SO_No",
    Item_Name_Code: "Item_Name_Code",
    Parent_CustomerCity: "Parent_CustomerCity_raw",
    Color_Code: "Color_Code",
    Broker: "Broker",
    Customer: "customer_norm", // use normalized field from parsed_sales
  };

  let includeConditionSql = "";
  if (
    paramsIn.includeColumn &&
    paramsIn.includeValues &&
    paramsIn.includeValues.length > 0
  ) {
    const mapped = ALLOWED_INCLUDE_COLUMNS[paramsIn.includeColumn];
    if (mapped) {
      includeConditionSql = `(ps.${mapped} IN UNNEST(@includeValues))`;
      // ensure an array of strings for BigQuery
      params.includeValues = paramsIn.includeValues.map((v) =>
        (v ?? "").toString()
      );
    } else {
      // ignore invalid includeColumn
      console.warn("Ignored invalid includeColumn:", paramsIn.includeColumn);
    }
  }

  const baseFiltersSql = filters.length ? filters.join(" AND ") : "TRUE";
  const leftSide = `(${baseFiltersSql}) AND ${itemLengthFilter} AND ${pendingFilter}`;

  // parse limit/offset with safe fallbacks
  const parsedLimit = Number(paramsIn.limit ?? "25");
  const limitNum =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(500, Math.floor(parsedLimit))
      : 25;
  const parsedOffset = Number(paramsIn.offset ?? "0");
  const offsetNum =
    Number.isFinite(parsedOffset) && parsedOffset >= 0
      ? Math.floor(parsedOffset)
      : 0;

  params.limit = limitNum;
  params.offset = offsetNum;

  const tableRef = `\`${projectId}.${dataset}.${table}\``;
  const sampleRef = `\`${projectId}.frono.${sampleTable}\``;
  const customersRef = `\`${projectId}.frono.${customersTable}\``;

  const whereClause = includeConditionSql
    ? `WHERE ( ${leftSide} ) OR (${includeConditionSql})`
    : `WHERE ${leftSide}`;

  // Rating priority CASE (1 highest). Second layer: FIFO by so_date_parsed (earliest first).
  // Third deterministic tiebreaker: SO_No ascending.
  const ratingPriorityCase = `
    CASE
      WHEN UPPER(TRIM(COALESCE(Rating, ''))) = 'HIGH' THEN 1
      WHEN UPPER(TRIM(COALESCE(Rating, ''))) = 'HIGH - CASH' THEN 2
      WHEN UPPER(TRIM(COALESCE(Rating, ''))) = 'CASH' THEN 3
      WHEN UPPER(TRIM(COALESCE(Rating, ''))) = 'CASH - NEW CLIENT' THEN 4
      ELSE 5
    END
  `;

  const sql = String.raw`
    WITH parsed_sales AS (
      SELECT
        Parent_CustomerCity AS Parent_CustomerCity_raw,
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
        LOWER(TRIM(REGEXP_REPLACE(COALESCE(Parent_CustomerCity, ''), r'\s*\[.*?\]', ''))) AS customer_norm
      FROM ${tableRef}
    ),

    sample_raw AS (
      SELECT
        Product_Code,
        Concept_2,
        Concept_3,
        File_URL,
        LOWER(TRIM(Product_Code)) AS product_code_norm
      FROM ${sampleRef}
    ),

    sample_best AS (
      SELECT Product_Code, Concept_2, Concept_3, File_URL, product_code_norm
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY product_code_norm ORDER BY Product_Code) AS rn
        FROM sample_raw
      )
      WHERE rn = 1
    ),

    customers_raw AS (
      SELECT
        Company_Name,
        Cust_Ved_Type,
        rk_rating,
        LOWER(TRIM(REGEXP_REPLACE(COALESCE(Company_Name, ''), r'\s*\[.*?\]', ''))) AS company_norm
      FROM ${customersRef}
    ),

    customers_best AS (
      SELECT Company_Name, Cust_Ved_Type, rk_rating, company_norm
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY company_norm ORDER BY Company_Name) AS rn
        FROM customers_raw
      )
      WHERE rn = 1
    ),

    joined AS (
      SELECT
        CASE WHEN ps.so_date_parsed IS NOT NULL THEN FORMAT_DATE('%d-%m-%Y', ps.so_date_parsed) ELSE ps.SO_Date END AS SO_Date,
        ps.SO_No,
        ps.Parent_CustomerCity_raw AS Customer,
        cb.Cust_Ved_Type AS Customer_Type,
        cb.rk_rating AS Rating,
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
        CAST(ps.so_date_parsed AS STRING) AS so_date_parsed
      FROM parsed_sales ps
      LEFT JOIN sample_best s
        ON LOWER(TRIM(ps.Item_Name_Code)) = s.product_code_norm
      LEFT JOIN customers_best cb
        ON cb.company_norm = ps.customer_norm
      ${whereClause}
    ),

    deduped AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(SO_No, ''), LOWER(TRIM(Item)), COALESCE(Color, '')
          ORDER BY
            /* 1) rating priority (1 best), 2) FIFO by date (earliest), 3) deterministic SO_No */
            ${ratingPriorityCase} ASC,
            SAFE_CAST(so_date_parsed AS DATE) ASC NULLS LAST,
            COALESCE(SO_No, '') ASC
        ) AS rn
      FROM joined
    )

    SELECT
      SO_Date,
      SO_No,
      Customer,
      Customer_Type,
      Rating,
      Broker,
      Item,
      Color,
      Size,
      OrderQty,
      Expected_Date,
      Status,
      Concept,
      Fabric,
      ItemCode,
      File_URL,
      so_date_parsed
    FROM deduped
    WHERE rn = 1
    ORDER BY
      ${ratingPriorityCase} ASC,
      SAFE_CAST(so_date_parsed AS DATE) ASC NULLS LAST,
      COALESCE(SO_No, '') ASC
    LIMIT @limit OFFSET @offset;
  `;

  const countSql = String.raw`
    WITH parsed_sales AS (
      SELECT
        Parent_CustomerCity AS Parent_CustomerCity_raw,
        Child_Customer_City,
        Broker,
        SO_No,
        SO_Date,
        Item_Name_Code,
        Color_Code,
        Brand,
        Size,
        Status,
        COALESCE(
          SAFE_CAST(SO_Date AS DATE),
          SAFE.PARSE_DATE('%Y-%m-%d', TRIM(SO_Date)),
          SAFE.PARSE_DATE('%d-%m-%Y', TRIM(SO_Date)),
          SAFE.PARSE_DATE('%d/%m/%Y', TRIM(SO_Date))
        ) AS so_date_parsed,
        LOWER(TRIM(REGEXP_REPLACE(COALESCE(Parent_CustomerCity, ''), r'\s*\[.*?\]', ''))) AS customer_norm
      FROM ${tableRef}
    ),

    sample_raw AS (
      SELECT LOWER(TRIM(Product_Code)) AS product_code_norm
      FROM ${sampleRef}
    ),

    sample_best AS (
      SELECT product_code_norm
      FROM (
        SELECT product_code_norm,
          ROW_NUMBER() OVER (PARTITION BY product_code_norm ORDER BY product_code_norm) AS rn
        FROM sample_raw
      )
      WHERE rn = 1
    ),

    customers_raw AS (
      SELECT
        LOWER(TRIM(REGEXP_REPLACE(COALESCE(Company_Name, ''), r'\s*\[.*?\]', ''))) AS company_norm
      FROM ${customersRef}
    ),

    customers_best AS (
      SELECT company_norm
      FROM (
        SELECT company_norm,
          ROW_NUMBER() OVER (PARTITION BY company_norm ORDER BY company_norm) AS rn
        FROM customers_raw
      )
      WHERE rn = 1
    )

    SELECT
      COUNT(DISTINCT CONCAT(
        COALESCE(ps.SO_No, ''), '|',
        LOWER(TRIM(ps.Item_Name_Code)), '|',
        COALESCE(ps.Color_Code, '')
      )) AS cnt
    FROM parsed_sales ps
    LEFT JOIN sample_best s
      ON LOWER(TRIM(ps.Item_Name_Code)) = s.product_code_norm
    LEFT JOIN customers_best cb
      ON cb.company_norm = ps.customer_norm
    ${whereClause};
  `;

  try {
    const [rowsResult] = await bq.query({
      query: sql,
      location,
      params,
    });

    const rawRows = rowsResult as unknown as SalesOrderRow[];

    // Helper: split "NAME [City]" into { name, city } and return cleaned rows
    function splitCustomerAndCity(input?: string | null): {
      name: string | null;
      city: string | null;
    } {
      if (!input) return { name: null, city: null };
      const s = input.toString().trim();
      const m = s.match(/^(.*?)\s*\[\s*(.*?)\s*\]\s*$/);
      if (m) {
        return {
          name: (m[1] || "").trim() || null,
          city: (m[2] || "").trim() || null,
        };
      }
      return { name: s || null, city: null };
    }

    const cleanedRows: SalesOrderRow[] = rawRows.map((r) => {
      const { name: custName, city: custCity } = splitCustomerAndCity(
        r.Customer ?? null
      );
      const out: SalesOrderRow & { CustomerCity?: string | null } = {
        ...r,
        Customer: custName,
      };
      if (custCity) out.CustomerCity = custCity;
      return out;
    });

    const [countResult] = await bq.query({
      query: countSql,
      location,
      params,
    });

    const total =
      Array.isArray(countResult) && countResult.length > 0
        ? Number(
            (countResult[0] as { cnt?: string | number }).cnt ??
              cleanedRows.length
          )
        : cleanedRows.length;

    return NextResponse.json({ rows: cleanedRows, total });
  } catch (error) {
    console.error("BigQuery query error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "BigQuery query failed: " + message },
      { status: 500 }
    );
  }
}
