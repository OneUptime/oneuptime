import Pill, { PillSize } from "../Pill/Pill";
import { Gray500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import { translationKey } from "../../Utils/TranslateTemplate";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The English text, which is also its key in the Dashboard locale files -
 * the title of MonitorStatusTimeline.isMonitoringOff, the column this pill
 * reads, so the two always say the same thing.
 */
export const MONITORING_OFF_TEXT: string = translationKey("Monitoring Off");

export interface ComponentProps {
  size?: PillSize | undefined;
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
  const { translateString } = useTranslateValue();

  return (
    <span
      data-testid="monitoring-off-indicator"
      className="inline-flex max-w-full align-middle"
    >
      <Pill
        color={Gray500}
        text={translateString(MONITORING_OFF_TEXT) || MONITORING_OFF_TEXT}
        size={props.size}
        icon={IconProp.Pause}
      />
    </span>
  );
};

export default MonitoringOffIndicator;
