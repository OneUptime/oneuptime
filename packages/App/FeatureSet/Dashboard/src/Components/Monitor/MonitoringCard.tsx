import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";
import MonitoringSwitchCopy, {
  MONITORING_SWITCH_COLUMN,
  MONITORING_SWITCH_TEST_ID,
} from "./MonitoringSwitchCopy";

/*
 * "Monitoring", on a monitor's Settings page: one switch, "Check this
 * monitor", that saves the moment it is flipped. It stores
 * Monitor.disableActiveMonitoring, the other way round (on = checked).
 *
 * Turning monitoring off asks first. It is the one press here that silently
 * stops alerting - nothing checks the monitor and it opens no incidents
 * until someone turns it back on - and, unlike before, it is one press, not
 * Edit, flip, Save. Turning it on saves at once.
 *
 * See MonitoringSwitchCopy for what it replaced.
 */

export interface ComponentProps {
  monitorId: ObjectID;
}

export const getTurnOffMonitoringConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (isTurningOn) {
    return undefined;
  }

  return {
    title: MonitoringSwitchCopy.turnOffConfirmTitle,
    description: MonitoringSwitchCopy.turnOffConfirmDescription,
    submitButtonText: MonitoringSwitchCopy.turnOffConfirmButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

const MonitoringCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Monitor>
      modelType={Monitor}
      modelId={props.monitorId}
      column={MONITORING_SWITCH_COLUMN}
      isInverted={true}
      cardTitle={MonitoringSwitchCopy.cardTitle}
      cardDescription={MonitoringSwitchCopy.cardDescription}
      title={MonitoringSwitchCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? MonitoringSwitchCopy.switchOnDescription
          : MonitoringSwitchCopy.offDescription;
      }}
      getConfirmation={getTurnOffMonitoringConfirmation}
      dataTestId={MONITORING_SWITCH_TEST_ID}
    />
  );
};

export default MonitoringCard;
