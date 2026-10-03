import NotificationMethodTabs from "../../Components/NotificationMethods/NotificationMethodTabs";
import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * WHERE THE DELETION WARNING LIVES.
 *
 * Every method on this page can be deleted with two clicks, and each one takes
 * every notification rule that points at it down with it - the foreign keys
 * from UserNotificationRule are all `onDelete: "CASCADE"`. The person doing it
 * is usually retiring an old phone number and has no way of knowing that a
 * severity just lost the only rule it had.
 *
 * That is answered in the delete confirmation itself (DeletionImpactModal, via
 * useNotificationMethodDeleteGuard on each method table), which names the rules
 * and the severities the delete would empty out. It is deliberately NOT also
 * restated in a standing panel above the tabs: the same warning shown on every
 * visit is the warning people learn to skim, and it arrives there long before
 * anyone can act on it.
 */
const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <NotificationMethodTabs />
    </Fragment>
  );
};

export default Settings;
