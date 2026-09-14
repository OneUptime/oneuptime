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
 * optional source (curated rules) the tenant cannot read, returned objects
 * that were counted and discarded, or a pass a request or time budget
 * stopped. A budget-stopped pass leaves the poll partial, so the next
 * scheduled window is narrowed; the other warnings do not affect the
 * cursor. "failed" is a step that threw, and the cursor is held.
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
  /*
   * Adaptive catch-up, scheduled polls only. chunkMinutes is the minutes of
   * creation time this poll read past the saved cursor (from the window
   * start when there was no usable cursor); the overlap before the cursor is
   * not counted. nextChunkMinutes is the chunk the next scheduled poll is
   * given. A poll that could not read its window halves it (or, when the
   * source reads in ascending creation order, resumes from the last record
   * read); a complete poll never shrinks it and doubles it back towards the
   * 24 hour maximum; a failed poll keeps it. forcedAdvance records a one
   * minute window that still could not be read completely and was skipped
   * past so polling keeps moving.
   */
  chunkMinutes?: number | undefined;
  nextChunkMinutes?: number | undefined;
  forcedAdvance?: boolean | undefined;
}
