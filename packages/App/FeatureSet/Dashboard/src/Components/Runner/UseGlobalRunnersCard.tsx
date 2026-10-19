import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";
import GlobalRunnersCopy, {
  USE_GLOBAL_RUNNERS_COLUMN,
  USE_GLOBAL_RUNNERS_SWITCH_TEST_ID,
} from "./GlobalRunnersCopy";

/*
 * "Use global Runners", on Runbooks -> Runners: one switch for the whole
 * project, on by default, that saves the moment it is flipped
 * (Project.useGlobalRunners, which takes a project admin - the switch says
 * so, locked, to anyone else). Turned off, nothing of the project runs on a
 * global Runner, which is the guarantee a team that keeps every step on its
 * own hosts needs in one place rather than step by step. Turning it off asks
 * first: JavaScript steps that picked no Runner stop running.
 */

export interface ComponentProps {
  projectId: ObjectID;
  // Told whether the switch is on: once read, and each time it moves.
  onChange?: ((isOn: boolean) => void) | undefined;
}

export const getStopUsingGlobalRunnersConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (isTurningOn) {
    return undefined;
  }

  return {
    title: GlobalRunnersCopy.turnOffTitle,
    description: GlobalRunnersCopy.turnOffDescription,
    submitButtonText: GlobalRunnersCopy.turnOffButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

const UseGlobalRunnersCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={USE_GLOBAL_RUNNERS_COLUMN}
      cardTitle={GlobalRunnersCopy.switchCardTitle}
      cardDescription={GlobalRunnersCopy.switchCardDescription}
      title={GlobalRunnersCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? GlobalRunnersCopy.switchOnDescription
          : GlobalRunnersCopy.switchOffDescription;
      }}
      getConfirmation={getStopUsingGlobalRunnersConfirmation}
      onChange={props.onChange}
      dataTestId={USE_GLOBAL_RUNNERS_SWITCH_TEST_ID}
    />
  );
};

export default UseGlobalRunnersCard;
