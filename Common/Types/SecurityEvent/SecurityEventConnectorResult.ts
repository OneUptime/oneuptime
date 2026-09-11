export default interface SecurityEventConnectorResult {
  startedAt: string;
  completedAt: string;
  windowStart: string;
  windowEnd: string;
  fetchedCount: number;
  ingestedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  failedCount: number;
  markerCount: number;
  requestCount: number;
  complete: boolean;
  warnings: Array<string>;
  error?: string | undefined;
  cursorAdvanced?: boolean | undefined;
  retryScheduled?: boolean | undefined;
  dataLossPossible?: boolean | undefined;
}
