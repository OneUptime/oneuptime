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

export interface GoogleSecOpsDiagnosticCheck {
  name: string;
  status: "success" | "failed";
  durationMs: number;
  message: string;
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
