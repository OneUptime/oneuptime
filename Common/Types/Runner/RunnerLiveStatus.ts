import OneUptimeDate from "../Date";

/*
 * How recently a Runner must have heartbeated to count as online. Matches the
 * window AIAgentService.isAgentAlive uses, and comfortably clears the Runner's
 * 60s heartbeat interval.
 *
 * This lives in Types, not in RunnerService, because the dashboard has to
 * answer the same question the server does. RunnerService imports it from
 * here so the two cannot drift: a server that hands out work to Runners it
 * considers alive, next to a dashboard that calls those same Runners
 * disconnected, is worse than either answer on its own.
 */
export const RUNNER_ALIVE_WINDOW_IN_MINUTES: number = 5;

/*
 * What a Runner's heartbeat actually says about it right now.
 *
 * Deliberately NOT the same thing as the persisted RunnerConnectionStatus
 * column. That column is written exactly twice — Disconnected when the row is
 * created, Connected on the first heartbeat — and nothing ever writes it back,
 * so a Runner that ran once last March still reads "connected" today. Every
 * server-side liveness check already ignores it and compares lastAlive against
 * the window above; this enum lets the dashboard tell the user the same truth.
 */
export enum RunnerLiveStatus {
  /* Heartbeated within the window: it is polling for work right now. */
  Connected = "connected",

  /*
   * Heartbeated at some point, but not recently enough. The container is
   * stopped, wedged, or cannot reach OneUptime.
   */
  Disconnected = "disconnected",

  /*
   * Never heartbeated at all. The row exists because someone created it in the
   * dashboard, but the Docker command has not been run yet. This is a setup
   * step the user still owes us, not a failure, and the UI must not dress it up
   * as one.
   */
  NeverConnected = "never-connected",
}

/*
 * lastAlive arrives as a Date from a hydrated model and as an ISO string from
 * a raw API payload, so both are accepted. Anything falsy — null from Postgres,
 * undefined from a select that never asked for the column — means "no heartbeat
 * has ever been recorded".
 */
export type GetRunnerLiveStatusFunction = (
  lastAlive: Date | string | null | undefined,
) => RunnerLiveStatus;

export const getRunnerLiveStatus: GetRunnerLiveStatusFunction = (
  lastAlive: Date | string | null | undefined,
): RunnerLiveStatus => {
  if (!lastAlive) {
    return RunnerLiveStatus.NeverConnected;
  }

  const lastAliveDate: Date = OneUptimeDate.fromString(lastAlive);

  /*
   * An unparseable value is not evidence of life. Returning Disconnected keeps
   * a malformed timestamp from being reported as a healthy Runner.
   */
  if (isNaN(lastAliveDate.getTime())) {
    return RunnerLiveStatus.Disconnected;
  }

  const windowStart: Date = OneUptimeDate.getSomeMinutesAgo(
    RUNNER_ALIVE_WINDOW_IN_MINUTES,
  );

  if (OneUptimeDate.isAfter(lastAliveDate, windowStart)) {
    return RunnerLiveStatus.Connected;
  }

  return RunnerLiveStatus.Disconnected;
};

/*
 * The English label for each state, which is also its i18next lookup key.
 *
 * "Connected" and "Disconnected" already had translations in all sixteen
 * Dashboard locale files before any of this — the probe pages have used them
 * for years — so routing every Runner status label through these three
 * constants is what lets the new state reuse them instead of inventing a
 * parallel set that would have to be translated again.
 *
 * It lives here rather than in the component because two very different
 * surfaces need the same words: the status bubble, and the plain-string
 * option label in the runbook step editor's Runner picker.
 */
export type GetRunnerLiveStatusLabelFunction = (
  status: RunnerLiveStatus,
) => string;

export const getRunnerLiveStatusLabel: GetRunnerLiveStatusLabelFunction = (
  status: RunnerLiveStatus,
): string => {
  if (status === RunnerLiveStatus.Connected) {
    return "Connected";
  }

  if (status === RunnerLiveStatus.NeverConnected) {
    return "Never connected";
  }

  return "Disconnected";
};

export default RunnerLiveStatus;
