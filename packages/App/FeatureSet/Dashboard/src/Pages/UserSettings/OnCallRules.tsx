import OnCallRulesTabs from "../../Components/NotificationRule/OnCallRulesTabs";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * User Settings > On-Call Rules: how the signed-in person is notified when
 * they are on call, one tab per kind (incidents, incident episodes, alerts,
 * alert episodes) and a card per severity.
 *
 * It replaced four pages, one per kind, in two side-menu sections of their
 * own; their addresses forward to the tab they used to be
 * (UserSettingsRoutes.tsx). An admin sees the same page for a member under
 * Users > (a member) > On-Call, drawn by the same component.
 */
const UserSettingsOnCallRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <OnCallRulesTabs userPreferencesKeyPrefix="user-notification-rules-table" />;
};

export default UserSettingsOnCallRules;
