import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import AlertPrivacyCard from "../../../Components/Alert/AlertPrivacyCard";
import RemindersCard from "../../../Components/Reminders/RemindersCard";
import ReminderRuleScope from "../../../Components/Reminders/ReminderRuleScope";

/*
 * An alert's Settings: who can see it, and whether its owners are reminded
 * about it. Each is one switch that saves the moment it is flipped.
 */
const AlertSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <AlertPrivacyCard alertId={modelId} />

      <RemindersCard scope={ReminderRuleScope.Alert} modelId={modelId} />
    </Fragment>
  );
};

export default AlertSettings;
