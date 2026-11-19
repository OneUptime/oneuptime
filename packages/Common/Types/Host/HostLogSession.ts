/*
 * A log session: every app's Logcat on one Android device for a while, for
 * troubleshooting, asked for in OneUptime and allowed by the person at the
 * device (#9806).
 *
 * Android 13 and later show other apps' log lines only to an app that is on
 * screen when it starts reading, after the person at the device allows it in
 * Android's own prompt. So OneUptime cannot just turn it on: it asks, the
 * OneUptime Android agent shows the request on the device, and the person
 * there allows it, in the agent and in Android's prompt. The agent then
 * sends every app's lines, tagged with the session, for the minutes asked,
 * and says how it went the next time it asks for sessions (every minute,
 * POST /telemetry/android-agent/v1/log-sessions).
 *
 * The status words are the agent's too (agents/AndroidAgent,
 * logsession/LogSession.kt): the device and OneUptime read the same ones.
 */

export enum HostLogSessionStatus {
  // Asked for in OneUptime; the device has not fetched it yet.
  Requested = "Requested",
  // The device has it, and waits for the person at the device to allow it.
  AwaitingApproval = "AwaitingApproval",
  // Allowed in the agent; Android's own prompt is being answered (Android 13 and later).
  Starting = "Starting",
  // Sending every app's logs until its time is up.
  Collecting = "Collecting",
  // Not allowed, in the agent or in Android's prompt.
  Declined = "Declined",
  // Ran its time, was stopped at the device, or ended when the device or the agent restarted.
  Ended = "Ended",
  // Called off in OneUptime.
  Cancelled = "Cancelled",
  // Nobody at the device allowed it in time.
  Expired = "Expired",
  // The device cannot: READ_LOGS is not granted, or Logcat is switched off there.
  Unavailable = "Unavailable",
}

// The lowest level a session sends: never quieter than Info, so whether Android allowed it shows at once.
export enum HostLogSessionLevel {
  Info = "info",
  Debug = "debug",
  Verbose = "verbose",
}

export const HOST_LOG_SESSION_ACTIVE_STATUSES: ReadonlyArray<HostLogSessionStatus> =
  [
    HostLogSessionStatus.Requested,
    HostLogSessionStatus.AwaitingApproval,
    HostLogSessionStatus.Starting,
    HostLogSessionStatus.Collecting,
  ];

// How long a session may send for, in minutes; 30 unless someone picks another.
export const HOST_LOG_SESSION_DURATIONS: ReadonlyArray<number> = [
  15, 30, 60, 120, 240,
];

export const HOST_LOG_SESSION_DEFAULT_DURATION_MINUTES: number = 30;

// How long a request waits for someone at the device to allow it.
export const HOST_LOG_SESSION_REQUEST_VALID_MINUTES: number = 60;

/*
 * How long OneUptime keeps telling the device about a session it cancelled,
 * so a device that fetched it before the cancel learns to stop.
 */
export const HOST_LOG_SESSION_CANCEL_NOTICE_MINUTES: number = 60;

/*
 * A session the device last said was collecting, past its end by this much
 * with no word from the device, ended without it: the device went quiet.
 */
export const HOST_LOG_SESSION_SILENT_END_GRACE_MINUTES: number = 10;

// The attribute every log line a session sent carries: what finds its lines in Logs.
export const HOST_LOG_SESSION_ATTRIBUTE: string =
  "oneuptime.agent.log_session.id";

// The route the agent asks, with its Server ingestion key.
export const ANDROID_AGENT_LOG_SESSIONS_ROUTE: string =
  "/android-agent/v1/log-sessions";

export default class HostLogSessionUtil {
  public static isActive(status: HostLogSessionStatus | undefined): boolean {
    return Boolean(status && HOST_LOG_SESSION_ACTIVE_STATUSES.includes(status));
  }

  public static isStatus(value: unknown): value is HostLogSessionStatus {
    return (
      typeof value === "string" &&
      (Object.values(HostLogSessionStatus) as Array<string>).includes(value)
    );
  }

  public static isLevel(value: unknown): value is HostLogSessionLevel {
    return (
      typeof value === "string" &&
      (Object.values(HostLogSessionLevel) as Array<string>).includes(value)
    );
  }

  /*
   * Whether the device may move a session from `from` to `to`. A session the
   * device has can only move on - waiting, starting, collecting, then one of
   * the ends - and a session that has ended, or that OneUptime cancelled,
   * is never moved by the device again: a device that reports late cannot
   * bring a cancelled session back.
   */
  public static canDeviceMove(
    from: HostLogSessionStatus,
    to: HostLogSessionStatus,
  ): boolean {
    if (!HostLogSessionUtil.isActive(from) || from === to) {
      return false;
    }

    // OneUptime's words, never the device's.
    if (
      to === HostLogSessionStatus.Requested ||
      to === HostLogSessionStatus.Cancelled
    ) {
      return false;
    }

    const order: Array<HostLogSessionStatus> = [
      HostLogSessionStatus.Requested,
      HostLogSessionStatus.AwaitingApproval,
      HostLogSessionStatus.Starting,
      HostLogSessionStatus.Collecting,
    ];

    if (order.includes(to)) {
      return order.indexOf(to) > order.indexOf(from);
    }

    // Declined, Ended, Expired or Unavailable: from any active status.
    return true;
  }
}
