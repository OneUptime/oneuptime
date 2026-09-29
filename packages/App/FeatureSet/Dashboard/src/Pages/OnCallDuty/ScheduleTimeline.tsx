import ScheduleTimeline from "../../Components/OnCallPolicy/ScheduleTimeline/ScheduleTimeline";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * On-Call Duty > Schedule Timeline: every schedule in the project on one
 * week / month grid, grouped by owning team.
 */
const OnCallDutyScheduleTimeline: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <ScheduleTimeline />;
};

export default OnCallDutyScheduleTimeline;
