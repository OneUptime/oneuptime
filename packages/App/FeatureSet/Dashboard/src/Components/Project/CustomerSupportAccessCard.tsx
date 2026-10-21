import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";
import CustomerSupportAccessSwitchCopy, {
  CUSTOMER_SUPPORT_ACCESS_SWITCH_COLUMN,
  CUSTOMER_SUPPORT_ACCESS_SWITCH_TEST_ID,
} from "./CustomerSupportAccessSwitchCopy";

/*
 * "Customer Support Access", on Settings -> Project: one switch that lets
 * OneUptime's support team into the project, saving the moment it is
 * flipped. Letting support in asks first and says what it grants; taking
 * the access away saves at once (see CustomerSupportAccessSwitchCopy).
 */

export interface ComponentProps {
  projectId: ObjectID;
}

export const getAllowCustomerSupportAccessConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  return {
    title: CustomerSupportAccessSwitchCopy.allowConfirmTitle,
    description: CustomerSupportAccessSwitchCopy.allowConfirmDescription,
    submitButtonText: CustomerSupportAccessSwitchCopy.allowConfirmButton,
  };
};

const CustomerSupportAccessCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={CUSTOMER_SUPPORT_ACCESS_SWITCH_COLUMN}
      cardTitle={CustomerSupportAccessSwitchCopy.cardTitle}
      cardDescription={CustomerSupportAccessSwitchCopy.cardDescription}
      title={CustomerSupportAccessSwitchCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? CustomerSupportAccessSwitchCopy.switchOnDescription
          : CustomerSupportAccessSwitchCopy.switchOffDescription;
      }}
      getConfirmation={getAllowCustomerSupportAccessConfirmation}
      dataTestId={CUSTOMER_SUPPORT_ACCESS_SWITCH_TEST_ID}
    />
  );
};

export default CustomerSupportAccessCard;
