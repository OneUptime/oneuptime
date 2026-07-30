import OneUptimeDate from "../../../Types/Date";
import {
  DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
} from "../../../Types/Rum/SessionReplay";
import TelemetryRetentionConfig from "../../../Types/Telemetry/TelemetryRetentionConfig";
import SessionIdentity from "../../../Utils/Rum/SessionIdentity";

/*
 * Retention resolution for session replay.
 *
 * Deliberately NOT resolveTelemetryRetentionInDays. Its candidate order is
 *
 *   service[pillar].default -> service.retainTelemetryDataForDays
 *     -> project[pillar].default -> project.defaultTelemetryRetentionInDays
 *     -> 15
 *
 * and service.retainTelemetryDataForDays is RumApplication's single
 * telemetry retention knob, sitting ABOVE the project pillar default. An
 * application set to keep traces for 90 days would therefore silently keep
 * recordings of real end users' screens for 90 days too, and an
 * application that had never been configured at all would get 15 days
 * rather than replay's 7. Neither is something anybody asked for.
 *
 * So replay reads only its own pillar, falls back to 7, and then clamps.
 */

export interface SessionReplayRetentionInput {
  /*
   * RumApplication.sessionReplayRetentionInDays - the explicit per-app
   * setting, and the highest-priority candidate.
   */
  applicationRetentionInDays?: number | null | undefined;

  /* RumApplication.telemetryRetentionConfig */
  applicationConfig?: TelemetryRetentionConfig | null | undefined;

  /* Project.telemetryRetentionConfig */
  projectConfig?: TelemetryRetentionConfig | null | undefined;
}

function pickPositive(value: number | null | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

/*
 * The clamp is load-bearing twice over, which is why it is not optional
 * and not configurable:
 *
 *  - Replay chunks are partitioned by expiry date, so every distinct
 *    retention value in a project creates its own partition per ingest
 *    day. A free integer would mean unbounded partitions on the fattest
 *    table in the system.
 *  - It bounds the blast radius of a mis-set value: a typo of 900 becomes
 *    90, not two and a half years of end-user screen recordings.
 *
 * SessionIdentity.clampRetentionDays rounds UP to the next allowed value,
 * because silently shortening a customer's configured retention destroys
 * evidence they expected to have, whereas keeping it a little longer costs
 * only disk.
 */
export function resolveSessionReplayRetentionInDays(
  input: SessionReplayRetentionInput,
): number {
  const { applicationRetentionInDays, applicationConfig, projectConfig } =
    input;

  const candidates: Array<number | null> = [
    pickPositive(applicationRetentionInDays),
    pickPositive(applicationConfig?.sessionReplay?.default),
    pickPositive(projectConfig?.sessionReplay?.default),
  ];

  let requestedDays: number = DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS;

  for (const candidate of candidates) {
    if (candidate !== null) {
      requestedDays = candidate;
      break;
    }
  }

  return SessionIdentity.clampRetentionDays(
    requestedDays,
    SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
    DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
  );
}

/*
 * The retentionDate written on both the session header and every chunk of
 * that session.
 *
 * Derived from the SERVER-CLAMPED session start, not from the ingest date
 * the way every other pillar does it. A chunk buffered offline and flushed
 * hours later would otherwise get full retention from the moment it
 * arrived, so one session's chunks would expire on different days, TTL
 * would drop them mid-session, and what remained would be an unplayable
 * fragment. Session-start derivation makes a session expire atomically.
 *
 * It also keeps the chunk retentionDate equal to the header's, which
 * matters because reads have `AND retentionDate >= now()` appended
 * silently - a mismatch produces sessions that are listable but
 * unplayable, or playable but invisible.
 */
export function getSessionReplayRetentionDate(data: {
  serverClampedSessionStart: Date;
  retentionInDays: number;
}): Date {
  return OneUptimeDate.addRemoveDays(
    data.serverClampedSessionStart,
    data.retentionInDays,
  );
}
