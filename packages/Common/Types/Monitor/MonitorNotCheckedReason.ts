/*
 * Why nothing checks a monitor, when nothing does: its monitoring is turned
 * off (`disableActiveMonitoring`), or it is archived. A monitor that is
 * checked has no reason at all.
 *
 * Decided by MonitoringOff.getNotCheckedReason (Utils/Monitor/MonitoringOff),
 * where archived wins over turned off: unarchiving is what puts the monitor
 * back, and its switch only matters after that. The values travel in JSON
 * (the Network Map's device nodes carry one - NetworkTopology's
 * NetworkTopologyMonitorNotChecked), so they are words, not numbers, and
 * never change once written.
 */
enum MonitorNotCheckedReason {
  MonitoringOff = "monitoringOff",
  MonitorArchived = "monitorArchived",
}

export default MonitorNotCheckedReason;

// Every reason, in the order a reader of a payload should accept them.
export const MONITOR_NOT_CHECKED_REASONS: ReadonlyArray<MonitorNotCheckedReason> =
  [
    MonitorNotCheckedReason.MonitoringOff,
    MonitorNotCheckedReason.MonitorArchived,
  ];

/*
 * Whether a value read from a payload is one of the reasons. A payload from
 * a newer or an older server may carry anything, so a reader asks this
 * before it names a reason.
 */
export function isMonitorNotCheckedReason(
  value: unknown,
): value is MonitorNotCheckedReason {
  return (
    typeof value === "string" &&
    (MONITOR_NOT_CHECKED_REASONS as ReadonlyArray<string>).includes(value)
  );
}
