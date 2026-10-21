import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import Navigation from "Common/UI/Utils/Navigation";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import React, { FunctionComponent, ReactElement } from "react";
import RunbookSwitchCopy, {
  RUNBOOK_SWITCH_COLUMN,
  RUNBOOK_SWITCH_TEST_ID,
} from "../../../Components/Runbook/RunbookSwitchCopy";

/*
 * A runbook's Settings: whether it can run, one switch that saves the
 * moment it is flipped. See RunbookSwitchCopy for what it replaced.
 */
const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelSwitchCard<Runbook>
      modelType={Runbook}
      modelId={modelId}
      column={RUNBOOK_SWITCH_COLUMN}
      cardTitle={RunbookSwitchCopy.cardTitle}
      cardDescription={RunbookSwitchCopy.cardDescription}
      title={RunbookSwitchCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? RunbookSwitchCopy.switchOnDescription
          : RunbookSwitchCopy.switchOffDescription;
      }}
      dataTestId={RUNBOOK_SWITCH_TEST_ID}
    />
  );
};

export default Settings;
