/*
 * What the evaluation worker last found an SLO to be.
 *
 * Healthy, At Risk and Budget Exhausted are measured: the error budget left
 * against the at-risk threshold. The rest say why nothing was measured:
 *
 *   - Waiting: a Monitor Uptime SLO whose monitors nothing has checked yet
 *     (#9354). It is set up right, and is measured from their first check
 *     (SloMonitorsFirstCheck), so it is not counted with the SLOs that are
 *     set up wrong.
 *   - Misconfigured: it cannot be measured as it is set up - no monitors, no
 *     services, no metric, a target out of range - or what it measures
 *     recorded nothing in its window.
 *   - Paused: every monitor it measures is archived or not monitored.
 *
 * The values are stored, read through the API and shown as they are, so
 * they never change. Their order is the order the SLO list's Status chip
 * offers them and the docs' status table lists them.
 */
enum SloStatus {
  Healthy = "Healthy",
  AtRisk = "At Risk",
  BudgetExhausted = "Budget Exhausted",
  Waiting = "Waiting",
  Misconfigured = "Misconfigured",
  Paused = "Paused",
}

/*
 * The statuses an evaluation that measured nothing gives an SLO (the
 * worker's guards): its SLI, budget and burn rate are not recalculated, its
 * burn rate rules resolve what they had open, its error budget policy tier
 * and deploy gate stay where they were, and nobody is told of the change but
 * its feed.
 */
export const SLO_UNMEASURED_STATUSES: ReadonlyArray<SloStatus> = [
  SloStatus.Waiting,
  SloStatus.Misconfigured,
  SloStatus.Paused,
];

export function isSloUnmeasuredStatus(
  status: SloStatus | string | undefined | null,
): boolean {
  return Boolean(
    status &&
      (SLO_UNMEASURED_STATUSES as ReadonlyArray<string>).includes(status),
  );
}

export default SloStatus;
