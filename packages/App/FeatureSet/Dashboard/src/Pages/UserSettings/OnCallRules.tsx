import HowToReachMe from "../../Components/NotificationRule/HowToReachMe";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * User Settings > How to Reach Me (#6820): how the signed-in person is
 * reached when they are paged on call. It opens on one ladder for every
 * kind of page and every severity; the grid behind it - a tab per kind
 * (incidents, incident episodes, alerts, alert episodes) and a card per
 * severity - is one click away, and opens by itself for rules that differ
 * between cards or a link to one kind's tab.
 *
 * It was called On-Call Rules, which is also the name of the project's
 * rules under Incidents and Alerts (#6817); its address is the same, and
 * Search still finds it by that name. It replaced four pages, one per kind,
 * whose addresses forward to the tab they used to be
 * (UserSettingsRoutes.tsx). An admin sees the same page for a member under
 * Users > (a member) > On-Call, drawn by the same component.
 *
 * "Send me a test page" (OnCallTestPage) sits at its foot: it runs these
 * rules for a severity the person picks, at once, so they can hear them work.
 */
const UserSettingsOnCallRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <HowToReachMe userPreferencesKeyPrefix="user-notification-rules-table" />
  );
};

export default UserSettingsOnCallRules;
