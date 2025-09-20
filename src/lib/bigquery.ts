// lib/bigquery.ts
import { BigQuery } from "@google-cloud/bigquery";

/**
 * Use environment variables:
 * - BQ_PROJECT
 * - GCLOUD_SERVICE_KEY  (the full service-account JSON string)
 *
 * Caches the BigQuery client on globalThis for dev/HMR.
 */
export function getBigQueryClient(): BigQuery {
  const projectId = process.env.BQ_PROJECT;
  const serviceKey = process.env.GCLOUD_SERVICE_KEY;

  const opts: {
    projectId?: string;
    credentials?: { client_email: string; private_key: string };
  } = {};

  if (projectId) opts.projectId = projectId;

  if (serviceKey) {
    try {
      const parsed = JSON.parse(serviceKey) as {
        client_email?: string;
        private_key?: string;
      };
      if (parsed?.client_email && parsed?.private_key) {
        opts.credentials = {
          client_email: parsed.client_email,
          // handle literal "\n" sequences
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch (err) {
      // parse error -> fall back to ADC. Keep a warning for devs.
      console.warn(
        "getBigQueryClient: failed to parse GCLOUD_SERVICE_KEY; falling back to ADC."
      );
    }
  }

  const g = globalThis as unknown as { __BQ_CLIENT__?: BigQuery };

  if (!g.__BQ_CLIENT__) {
    g.__BQ_CLIENT__ = new BigQuery(opts);
  }

  return g.__BQ_CLIENT__;
}
