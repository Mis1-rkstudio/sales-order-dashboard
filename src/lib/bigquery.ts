// lib/bigquery.ts
import { BigQuery } from "@google-cloud/bigquery";

export function createBigQueryClient(): BigQuery {
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

/**
 * Ensure the dataset exists; create it if missing.
 */
export async function ensureDatasetExists(
  bq: BigQuery,
  datasetId: string
): Promise<void> {
  const ds = bq.dataset(datasetId);
  const [exists] = await ds.exists();
  if (!exists) {
    await ds.create();
  }
}

/**
 * Derive a basic BigQuery schema from a sample object.
 * Uses STRING for unknowns and JSON-stringifies objects.
 */
function deriveSchemaFromSample(sample: Record<string, unknown>) {
  const fields: Array<{ name: string; type: string; mode?: string }> = [];
  for (const [k, v] of Object.entries(sample)) {
    let t = "STRING";
    if (v === null || v === undefined) {
      t = "STRING";
    } else if (typeof v === "number") {
      // use FLOAT for numbers (safe general choice)
      t = "FLOAT";
    } else if (typeof v === "boolean") {
      t = "BOOLEAN";
    } else if (typeof v === "string") {
      // attempt to detect ISO timestamp-ish strings
      const s = v as string;
      const maybeTs = Date.parse(s);
      if (!Number.isNaN(maybeTs) && s.length >= 8) {
        t = "TIMESTAMP";
      } else {
        t = "STRING";
      }
    } else if (typeof v === "object") {
      // store objects as STRING (JSON)
      t = "STRING";
    }

    fields.push({ name: k, type: t, mode: "NULLABLE" });
  }
  return { fields };
}

/**
 * Ensure the table exists; create it with a simple schema inferred from sampleRow if missing.
 */
export async function ensureTableExists(
  bq: BigQuery,
  datasetId: string,
  tableId: string,
  sampleRow?: Record<string, unknown>
): Promise<void> {
  await ensureDatasetExists(bq, datasetId);
  const ds = bq.dataset(datasetId);
  const tbl = ds.table(tableId);
  const [exists] = await tbl.exists();
  if (!exists) {
    const options: Record<string, unknown> = {};
    if (sampleRow && Object.keys(sampleRow).length > 0) {
      options.schema = deriveSchemaFromSample(sampleRow);
    }
    await ds.createTable(tableId, options);
  }
}

/**
 * Insert rows, ensuring the dataset and table exist first. If rows is empty this is a no-op.
 */
export async function insertRowsWithEnsure(
  bq: BigQuery,
  datasetId: string,
  tableId: string,
  rows: Array<Record<string, unknown>>
): Promise<unknown> {
  if (!rows || rows.length === 0) return { inserted: 0 };
  // ensure table exists using the first row as schema hint
  try {
    await ensureTableExists(bq, datasetId, tableId, rows[0]);
  } catch (err) {
    // if create fails, rethrow so caller can handle
    throw err;
  }

  // perform insert with same options used previously
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore-next-line - allow different client shapes
  const insertResult = await bq
    .dataset(datasetId)
    .table(tableId)
    .insert(rows, { ignoreUnknownValues: true, skipInvalidRows: false });
  return insertResult;
}
