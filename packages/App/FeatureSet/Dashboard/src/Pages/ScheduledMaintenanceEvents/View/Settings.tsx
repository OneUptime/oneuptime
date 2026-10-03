import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import RemindersCard from "../../../Components/Reminders/RemindersCard";
import ReminderRuleScope from "../../../Components/Reminders/ReminderRuleScope";
import StatusPageVisibilityCard from "../../../Components/StatusPageVisibility/StatusPageVisibilityCard";
import { StatusPageVisibilityKind } from "../../../Components/StatusPageVisibility/StatusPageVisibilitySwitchCopy";

/*
 * A scheduled maintenance event's Settings: whether it shows on its status
 * pages, and whether its owners are reminded about it. Each is one switch
 * that saves the moment it is flipped.
 */
const ScheduledMaintenanceSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <StatusPageVisibilityCard
        kind={StatusPageVisibilityKind.ScheduledMaintenance}
        modelId={modelId}
      />

      <RemindersCard
        scope={ReminderRuleScope.ScheduledMaintenance}
        modelId={modelId}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceSettings;
