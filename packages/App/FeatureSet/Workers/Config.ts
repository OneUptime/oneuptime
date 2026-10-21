let concurrency: string | number = process.env["WORKER_CONCURRENCY"] || 100;

if (typeof concurrency === "string") {
  const parsed: number = parseInt(concurrency, 10);
  concurrency = !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const WORKER_CONCURRENCY: number = concurrency as number;

/*
 * How many AI investigations (AIInvestigationQueue) one worker-role server
 * runs at once. Each mostly waits on the model, but holds its conversation
 * in memory while it does. More wait in the queue, incident and alert
 * investigations first.
 */
const aiInvestigationConcurrency: number = parseInt(
  process.env["AI_INVESTIGATION_CONCURRENCY"] || "",
  10,
);

export const AI_INVESTIGATION_CONCURRENCY: number =
  !isNaN(aiInvestigationConcurrency) && aiInvestigationConcurrency > 0
    ? aiInvestigationConcurrency
    : 10;
