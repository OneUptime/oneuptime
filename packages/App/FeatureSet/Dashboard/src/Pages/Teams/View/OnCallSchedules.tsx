import ScheduleTimeline from "../../../Components/OnCallPolicy/ScheduleTimeline/ScheduleTimeline";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Teams > View Team > On-Call Schedules: the schedule timeline locked to the
 * schedules this team owns, so a team lead can see their whole rotation
 * without filtering the project-wide page.
 */
const TeamViewOnCallSchedules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const teamId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <ScheduleTimeline teamId={teamId} />;
};

export default TeamViewOnCallSchedules;
