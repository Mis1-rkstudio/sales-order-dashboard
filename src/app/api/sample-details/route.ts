// app/api/sample-details/route.ts
import { NextResponse } from "next/server";
import { createBigQueryClient } from "@/lib/bigquery";

type QueryParams = {
  q?: string;
  limit?: string;
  offset?: string;
};

function parseQueryParams(url: string): QueryParams {
  const u = new URL(url);
  const s = u.searchParams;
  return {
    q: s.get("q") ?? undefined,
    limit: s.get("limit") ?? undefined,
    offset: s.get("offset") ?? undefined,
  };
}

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

export async function GET(request: Request) {
  const params = parseQueryParams(request.url);

  const projectId = process.env.BQ_PROJECT;
  const dataset = "frono";
  const sampleTable = process.env.BQ_TABLE_SAMPLE ?? "Sample_details"; // set in env ideally
  const location = process.env.BQ_LOCATION ?? "US";

  if (!projectId || !dataset) {
    return NextResponse.json(
      { error: "Missing BQ_PROJECT or BQ_DATASET env vars" },
      { status: 500 }
    );
  }

  const bq = createBigQueryClient();

  const tableRef = `\`${projectId}.${dataset}.${sampleTable}\``;

  const limitNum = Math.min(1000, Number(params.limit ?? "100"));
  const offsetNum = Math.max(0, Number(params.offset ?? "0"));

  // simple search across product code and concept columns
  const filters: string[] = [];
  const queryParams: Record<string, string | number> = {
    limit: limitNum,
    offset: offsetNum,
  };

  if (params.q) {
    filters.push(
      `(LOWER(Product_Code) LIKE LOWER(@q) OR LOWER(Concept_2) LIKE LOWER(@q) OR LOWER(Concept_3) LIKE LOWER(@q))`
    );
    queryParams.q = `%${params.q}%`;
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const sql = String.raw`
    SELECT
      Concept_2 AS Concept,
      Concept_3 AS Fabric,
      Product_Code AS Item,
      File_URL
    FROM ${tableRef}
    ${whereSql}
    ORDER BY Product_Code
    LIMIT @limit OFFSET @offset
  `;

  const countSql = String.raw`
    SELECT COUNT(1) as cnt
    FROM ${tableRef}
    ${whereSql}
  `;

  try {
    const [rowsResult] = await bq.query({
      query: sql,
      location,
      params: queryParams,
    });
    const rows = rowsResult as {
      Concept?: string;
      Fabric?: string;
      Item?: string;
      File_URL?: string;
    }[];

    const [countResult] = await bq.query({
      query: countSql,
      location,
      params: queryParams,
    });
    const total =
      Array.isArray(countResult) && countResult.length > 0
        ? Number(
            (countResult[0] as { cnt?: string | number }).cnt ?? rows.length
          )
        : rows.length;

    return NextResponse.json({ rows, total });
  } catch (err) {
    console.error("sample-details BigQuery error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "BigQuery query failed: " + message },
      { status: 500 }
    );
  }
}
