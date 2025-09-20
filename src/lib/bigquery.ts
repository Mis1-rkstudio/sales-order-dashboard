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
