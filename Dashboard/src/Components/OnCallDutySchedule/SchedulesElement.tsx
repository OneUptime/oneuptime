import OnCallDutyScheduleElement from "./ScheduleElement";
import OnCallDutySchedule from "Model/Models/OnCallDutyPolicySchedule";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  schedules: Array<OnCallDutySchedule>;
  onNavigateComplete?: (() => void) | undefined;
}

const OnCallDutySchedulesElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.schedules || props.schedules.length === 0) {
    return <p>No on call schedules.</p>;
  }

  return (
    <div>
      {props.schedules.map((schedule: OnCallDutySchedule, i: number) => {
        return (
          <span key={i}>
            <OnCallDutyScheduleElement
              schedule={schedule}
              onNavigateComplete={props.onNavigateComplete}
            />
            {i !== props.schedules.length - 1 && <span>,&nbsp;</span>}
          </span>
        );
      })}
    </div>
  );
};

export default OnCallDutySchedulesElement;
