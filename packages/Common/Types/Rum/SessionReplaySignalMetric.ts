/*
 * The series that lets a RUM application alert on a signal of its own
 * (issue #6518): how many recorded sessions hit each of its signals, minute
 * by minute.
 *
 * The session replay ingest writes it (App/FeatureSet/Telemetry/Utils/
 * SessionReplaySignalMetrics.ts): a session counts once for a signal, in
 * the minute the chunk that first carried the signal arrived, as a Delta
 * Sum point under the RUM application. A Metrics monitor that sums the
 * points of a window reads how many sessions hit the signal in it - which
 * is what the application's "Sessions hit <signal>" recommendation is.
 *
 * A point names the signal by its id as well as its name: the id outlives a
 * rename on the Frustration Signals page, so the monitor a recommendation
 * created keeps counting the signal it was created for. A session from a
 * page that loaded before the rename still names the old name, and carries
 * no id until the page loads again.
 *
 * The name sits under the session replay prefix
 * (SESSION_REPLAY_METRIC_NAME_PREFIX): OTLP ingest drops a customer metric
 * under it and a recording rule cannot write one, so only the ingest can.
 * It counts sessions the project already recorded, so it is not billed
 * (TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES).
 */

export const SESSION_REPLAY_SIGNAL_SESSIONS_METRIC: string =
  "oneuptime.rum.session.replay.signal.sessions";

/* The signal's id on the Frustration Signals page; absent when unknown. */
export const SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE: string = "signal.id";

/* The signal's name, as the session recorded it. */
export const SESSION_REPLAY_SIGNAL_NAME_ATTRIBUTE: string = "signal.name";

/* The minute the series counts over, in milliseconds. */
export const SESSION_REPLAY_SIGNAL_METRIC_INTERVAL_MS: number = 60000;

export const SESSION_REPLAY_SIGNAL_SESSIONS_METRIC_DESCRIPTION: string =
  "Recorded sessions in which one of the application's own signals first fired, counted per minute, by signal.id and signal.name.";

/*
 * The id of each signal of the application's own, by its name in lower
 * case, from the stored settings: how a hit the recorders report by name is
 * filed under the signal it belongs to. A name the settings no longer hold
 * (renamed or deleted since the page loaded) has none.
 */
export function getSessionReplaySignalIdsByName(
  customSignals: ReadonlyArray<{ id: string; name: string }>,
): Record<string, string> {
  // No prototype: a signal may be called "constructor" or "__proto__".
  const ids: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;

  for (const signal of customSignals) {
    const key: string = signal.name.trim().toLowerCase();

    if (key && signal.id && !Object.prototype.hasOwnProperty.call(ids, key)) {
      ids[key] = signal.id;
    }
  }

  return ids;
}

export function getSessionReplaySignalId(
  idsByName: Readonly<Record<string, string>> | null | undefined,
  name: string,
): string {
  const key: string = name.trim().toLowerCase();

  if (!idsByName || !Object.prototype.hasOwnProperty.call(idsByName, key)) {
    return "";
  }

  const id: unknown = idsByName[key];

  return typeof id === "string" ? id : "";
}
