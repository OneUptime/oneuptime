let concurrency: string | number = process.env["WORKER_CONCURRENCY"] || 100;

if (typeof concurrency === "string") {
  const parsed: number = parseInt(concurrency, 10);
  concurrency = !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const WORKER_CONCURRENCY: number = concurrency as number;
