export type GoogleSecOpsRunType = "test" | "poll" | "preview" | "backfill";

export type GoogleSecOpsRunStatus =
  | "queued"
  | "running"
  | "success"
  | "empty"
  | "partial"
  | "failed";

export interface GoogleSecOpsRunOptions {
  type: GoogleSecOpsRunType;
  runId?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
}

export interface GoogleSecOpsDetectionSample {
  id: string;
  ruleName: string;
  detectionTime?: string | undefined;
  createdTime?: string | undefined;
  isAlert?: boolean | undefined;
}

/*
 * "warn" is a step that completed but left something for the reader: an
 * optional source (curated rules) the tenant cannot read, or returned
 * objects that were counted and discarded. It never holds the cursor;
 * "failed" does.
 */
export interface GoogleSecOpsDiagnosticCheck {
  name: string;
  status: "success" | "failed" | "warn";
  durationMs: number;
  message: string;
}

/*
 * Which timestamp the run's window was applied to. Polls list by the time
 * Google CREATED a detection, because a rule that runs hourly creates its
 * detections long after the events they describe; preview and backfill
 * use the detection-time range the person picked (with created time read
 * as well) so what they see matches the SecOps alerts view.
 */
export type GoogleSecOpsRunBasis = "created-time" | "detection-time";

// How many records each of the three read passes returned, before the union.
export interface GoogleSecOpsSourceCounts {
  ruleDetections: number;
  curatedDetections: number;
  alertsView: number;
}

/*
 * createdTime minus detectionTime over the fetched records. A lag larger
 * than the poll interval is the exact case a detection-time cursor would
 * skip, which is why the numbers are kept on every run.
 */
export interface GoogleSecOpsCreationLag {
  // Records carrying both timestamps.
  measured: number;
  // Records created more than pollIntervalInMinutes + 1 minute after their detection time.
  lateCount: number;
  maxLagMinutes: number;
}

export interface GoogleSecOpsRunResult {
  type: GoogleSecOpsRunType;
  runId?: string | undefined;
  status: GoogleSecOpsRunStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  windowStart: string;
  windowEnd: string;
  includeNonAlertingDetections: boolean;
  basis?: GoogleSecOpsRunBasis | undefined;
  sourceCounts?: GoogleSecOpsSourceCounts | undefined;
  creationLag?: GoogleSecOpsCreationLag | undefined;
  fetchedCount: number;
  ingestedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  failedCount: number;
  complete: boolean;
  requestCount: number;
  warnings: Array<string>;
  samples: Array<GoogleSecOpsDetectionSample>;
  checks: Array<GoogleSecOpsDiagnosticCheck>;
  eventTimeStart?: string | undefined;
  eventTimeEnd?: string | undefined;
  error?: string | undefined;
}
