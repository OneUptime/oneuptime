import PersonalCalendarFeedCard, {
  PersonalCalendarFeedVariant,
} from "../../Components/OnCallPolicy/CalendarFeed/PersonalCalendarFeedCard";
import ShiftRemindersCard from "../../Components/OnCallPolicy/CalendarFeed/ShiftRemindersCard";
import UpcomingShiftsCard from "../../Components/OnCallPolicy/CalendarFeed/UpcomingShiftsCard";
import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * User Settings > Calendar Feed.
 *
 * Three cards, top to bottom in the order somebody new to the feature needs
 * them: the link itself (and its settings once it exists), what the link will
 * contain right now, and the reminders that make up for calendar clients not
 * honouring VALARM. The layout above supplies the page chrome, breadcrumbs
 * and side menu; this file only picks the identity the cards need.
 */
const UserSettingsOnCallCalendarFeed: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const userId: ObjectID | null = User.getUserId();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  return (
    <Fragment>
      <PersonalCalendarFeedCard variant={PersonalCalendarFeedVariant.Full} />
      <UpcomingShiftsCard />
      <ShiftRemindersCard projectId={projectId} userId={userId} />
    </Fragment>
  );
};

export default UserSettingsOnCallCalendarFeed;
