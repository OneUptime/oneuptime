import Pill, { PillSize } from "../Pill/Pill";
import { Gray500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import MonitorPausedBy, {
  MonitorPausedByUtil,
} from "../../../Types/Monitor/MonitorPausedBy";
import { translationKey } from "../../Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The English text, which is also its key in the Dashboard locale files -
 * the title of MonitorStatusTimeline.isMonitoringOff, the column this pill
 * reads, so the two always say the same thing.
 */
export const MONITORING_OFF_TEXT: string = translationKey("Monitoring Off");

/*
 * Time a pause left out of uptime is not monitoring turned off (#11433): an
 * incident declared by hand, or scheduled maintenance, paused the checks
 * with no status set for the monitor (MonitorStatusTimeline.pausedBy). Its
 * pill says it was paused, and by what; the legend names all of it Paused.
 */
export const PAUSED_TEXT: string = translationKey("Paused");

export const PAUSED_BY_TEXTS: Record<MonitorPausedBy, string> = {
  [MonitorPausedBy.Incident]: translationKey("Paused by Incident"),
  [MonitorPausedBy.ScheduledMaintenance]: translationKey(
    "Paused for Maintenance",
  ),
  [MonitorPausedBy.IncidentAndScheduledMaintenance]: translationKey(
    "Paused by Incident and Maintenance",
  ),
};

// The pill's words: what paused the monitor, or that its monitoring was off.
export const getMonitoringOffIndicatorText: (
  pausedBy: MonitorPausedBy | string | null | undefined,
) => string = (pausedBy: MonitorPausedBy | string | null | undefined): string => {
  const reason: MonitorPausedBy | null = MonitorPausedByUtil.fromValue(pausedBy);

  return reason ? PAUSED_BY_TEXTS[reason] : MONITORING_OFF_TEXT;
};

export interface ComponentProps {
  size?: PillSize | undefined;
  // What paused the monitor, when a pause rather than its switch left the time out.
  pausedBy?: MonitorPausedBy | string | null | undefined;
}

/*
 * Marks a monitor status event held while the monitor's monitoring was
 * turned off (MonitorStatusTimeline.isMonitoringOff, issue #6480): nothing
 * checked the monitor then, so the status beside it is only what its last
 * check saw, and uptime, status pages and SLOs leave the time out. Without
 * it, turning monitoring off or back on read as a second "Operational" in a
 * row - "by Ada Lovelace", as if she had set the status.
 *
 * A pill like "Currently Active" beside it, in the gray the product draws a
 * monitor whose monitoring is off in (Disabled, Not monitored), with the
 * pause the "Monitoring is turned off" banner carries in place of its dot.
 */
const MonitoringOffIndicator: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <span
      data-testid="monitoring-off-indicator"
      data-paused-by={MonitorPausedByUtil.fromValue(props.pausedBy) || undefined}
      className="inline-flex max-w-full align-middle"
    >
      <Pill
        color={Gray500}
        // In English: the badge looks it up, once (#8067).
        text={getMonitoringOffIndicatorText(props.pausedBy)}
        size={props.size}
        icon={IconProp.Pause}
      />
    </span>
  );
};

export default MonitoringOffIndicator;
