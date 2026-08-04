import MonitoringIntervalUtil from "Common/Utils/Monitor/MonitoringIntervalUtil";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitoringInterval: string;
}

const MonitoringIntervalElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.monitoringInterval) {
    /*
     * The lookup is over every interval OneUptime offers, not the subset this
     * instance lets you pick. A value set on a self-hosted instance, or
     * through the API, still has to render - and falling back to the raw cron
     * beats rendering an empty box.
     */
    const label: string | null = MonitoringIntervalUtil.getLabel(
      props.monitoringInterval,
    );

    return <div>{label || props.monitoringInterval}</div>;
  }

  return <div>No interval defined</div>;
};

export default MonitoringIntervalElement;
