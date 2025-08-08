let concurrency: string | number =
  process.env["INCOMING_REQUEST_INGEST_CONCURRENCY"] || 100;

if (typeof concurrency === "string") {
  const parsed: number = parseInt(concurrency, 10);
  concurrency = !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const INCOMING_REQUEST_INGEST_CONCURRENCY: number =
  concurrency as number;
