import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchesCard, {
  ModelSwitchesCardChildSwitch,
  ModelSwitchesCardSwitch,
} from "Common/UI/Components/ModelSwitch/ModelSwitchesCard";
import { ModelSwitchColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import {
  getProjectAiSwitchTestId,
  ProjectAiSwitchDefinition,
} from "./ProjectAiSettingsCopy";

/*
 * A card of the project's AI switches - "Investigate new incidents",
 * "Watch telemetry for problems" - each saving its own Project column the
 * moment it is flipped (the shared ModelSwitchesCard). Each one locks, with
 * the permission it needs, for someone who may not change it: the AI
 * behaviours take Project Owner or Project Admin, narrower than the
 * Project table's update list, which also lets Edit Project and Manage
 * Billing in.
 *
 * A switch with switches of its own - "Fix new incidents automatically" and
 * the two pull requests under it - draws them under its name while it is
 * on, and turns them on and off with it in the same save.
 */

export interface ComponentProps {
  cardTitle: string;
  cardDescription: string;
  switches: Array<ProjectAiSwitchDefinition<ModelSwitchColumn<Project>>>;
  dataTestId: string;
}

// One switch as the shared card draws it, from the page's words.
const toCardSwitch: (
  definition: ProjectAiSwitchDefinition<ModelSwitchColumn<Project>>,
) => ModelSwitchesCardChildSwitch<Project> = (
  definition: ProjectAiSwitchDefinition<ModelSwitchColumn<Project>>,
): ModelSwitchesCardChildSwitch<Project> => {
  return {
    column: definition.column,
    title: definition.title,
    getDescription: (): string => {
      return definition.description;
    },
    note: definition.note,
    dataTestId: getProjectAiSwitchTestId(definition.column),
  };
};

const ProjectAiSwitchesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <ModelSwitchesCard<Project>
      modelType={Project}
      modelId={projectId}
      cardTitle={props.cardTitle}
      cardDescription={props.cardDescription}
      switches={props.switches.map(
        (
          definition: ProjectAiSwitchDefinition<ModelSwitchColumn<Project>>,
        ): ModelSwitchesCardSwitch<Project> => {
          return {
            ...toCardSwitch(definition),
            children: definition.children?.map(toCardSwitch),
          };
        },
      )}
      dataTestId={props.dataTestId}
    />
  );
};

export default ProjectAiSwitchesCard;
