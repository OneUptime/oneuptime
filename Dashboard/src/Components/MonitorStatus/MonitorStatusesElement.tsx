import MonitorStatusElement from "./MonitorStatusElement";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorStatuses: Array<MonitorStatus>;
  shouldAnimate: boolean;
}

const MonitorStatusesElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.monitorStatuses || props.monitorStatuses.length === 0) {
    return <p>No monitor status attached.</p>;
  }

  return (
    <div>
      {props.monitorStatuses.map((monitorStatus: MonitorStatus, i: number) => {
        return (
          <span key={i}>
            <MonitorStatusElement shouldAnimate={
              props.shouldAnimate || false
            } monitorStatus={monitorStatus} />
            {i !== props.monitorStatuses.length - 1 && <span>,&nbsp;</span>}
          </span>
        );
      })}
    </div>
  );
};

export default MonitorStatusesElement;
