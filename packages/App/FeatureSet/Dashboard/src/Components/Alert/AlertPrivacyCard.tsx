import Alert from "Common/Models/DatabaseModels/Alert";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";
import AlertPrivacySwitchCopy, {
  ALERT_PRIVACY_SWITCH_COLUMN,
  ALERT_PRIVACY_SWITCH_TEST_ID,
} from "./AlertPrivacySwitchCopy";

/*
 * "Who can see this alert", on an alert's Settings page: one switch,
 * "Private Alert", that saves the moment it is flipped, and says who keeps
 * access. Making the alert private asks first, because the person flipping
 * it may lose access to it (see AlertPrivacySwitchCopy); making it visible
 * again saves at once.
 */

export interface ComponentProps {
  alertId: ObjectID;
}

export const getMakeAlertPrivateConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  return {
    title: AlertPrivacySwitchCopy.makePrivateConfirmTitle,
    description: AlertPrivacySwitchCopy.makePrivateConfirmDescription,
    submitButtonText: AlertPrivacySwitchCopy.makePrivateConfirmButton,
  };
};

const AlertPrivacyCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Alert>
      modelType={Alert}
      modelId={props.alertId}
      column={ALERT_PRIVACY_SWITCH_COLUMN}
      cardTitle={AlertPrivacySwitchCopy.cardTitle}
      cardDescription={AlertPrivacySwitchCopy.cardDescription}
      title={AlertPrivacySwitchCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? AlertPrivacySwitchCopy.switchOnDescription
          : AlertPrivacySwitchCopy.switchOffDescription;
      }}
      getConfirmation={getMakeAlertPrivateConfirmation}
      dataTestId={ALERT_PRIVACY_SWITCH_TEST_ID}
    />
  );
};

export default AlertPrivacyCard;
