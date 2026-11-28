import logger from "../Logger";

/*
 * ONEUPTIME'S OWN ALARMS ABOUT ITS PROBES, IN THE SERVER LOG.
 *
 * On 27 November 2026 every App replica answered every probe's request for
 * monitors busy for twelve hours. Every probe stayed Connected, the global
 * probes were known to be behind within a minute, and nobody at OneUptime
 * was told until a customer was: the busy warning was a warn line, which a
 * server at LOG_LEVEL=ERROR (OneUptime Cloud, and config.example.env) never
 * writes, and the master admins' outage notifications go nowhere on
 * OneUptime Cloud until its operator turns them on.
 *
 * So each alarm here is an error line - written at LOG_LEVEL=ERROR, and
 * exported with the server's own telemetry - that starts with
 * PROBE_ALARM_LOG_PREFIX and carries PROBE_ALARM_ATTRIBUTE_KEY, so one
 * search, or one log monitor, finds them all. Each is said once every few
 * minutes while it holds, never once a request:
 *
 *   - ProbeAlarm.SchedulingRefused: an App replica has answered most of a
 *     lane's probe requests busy for minutes (ProbeSchedulingRefusalAlarm);
 *   - ProbeAlarm.GlobalProbesBehind: a connected global probe has been
 *     behind for minutes, its monitors checked later than their interval
 *     (GlobalProbesBehind, read by Workers' ServerAlerts).
 *
 * Neither depends on why: the first says what a replica does, the second
 * what the probes do not get done. An alarm that is over is said once at
 * warn, with PROBE_ALARM_OVER_LOG_PREFIX, which a search for the alarm's
 * prefix does not find.
 */

export const PROBE_ALARM_LOG_PREFIX: string = "Probe alarm:";

export const PROBE_ALARM_OVER_LOG_PREFIX: string = "Probe alarm over:";

// The log attribute that names the alarm, for a log monitor to match on.
export const PROBE_ALARM_ATTRIBUTE_KEY: string = "oneuptime.probe.alarm";

export enum ProbeAlarm {
  SchedulingRefused = "probe-scheduling-refused",
  GlobalProbesBehind = "global-probes-behind",
}

export default class ProbeAlarmLog {
  // The alarm's line, as it is logged.
  public static getLine(text: string): string {
    return `${PROBE_ALARM_LOG_PREFIX} ${text}`;
  }

  // The line that says the alarm is over.
  public static getOverLine(text: string): string {
    return `${PROBE_ALARM_OVER_LOG_PREFIX} ${text}`;
  }

  public static raise(alarm: ProbeAlarm, text: string): void {
    logger.error(ProbeAlarmLog.getLine(text), {
      [PROBE_ALARM_ATTRIBUTE_KEY]: alarm,
    });
  }

  public static over(alarm: ProbeAlarm, text: string): void {
    logger.warn(ProbeAlarmLog.getOverLine(text), {
      [PROBE_ALARM_ATTRIBUTE_KEY]: alarm,
    });
  }
}
