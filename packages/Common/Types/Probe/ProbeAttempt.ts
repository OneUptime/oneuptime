export default interface ProbeAttempt {
  attemptNumber: number;
  attemptedAt: Date;
  responseReceivedAt: Date;
  responseTimeInMs?: number | undefined;
  responseCode?: number | undefined;
  isOnline: boolean;
  failureCause?: string | undefined;
}
