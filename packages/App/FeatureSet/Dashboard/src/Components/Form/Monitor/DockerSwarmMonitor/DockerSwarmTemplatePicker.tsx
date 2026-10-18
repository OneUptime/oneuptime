import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import {
  getAllDockerSwarmAlertTemplates,
  DockerSwarmAlertTemplate,
} from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";
import { DOCKER_SWARM_TEMPLATE_CATEGORIES } from "../AlertTemplatePicker/AlertTemplateCategories";

/*
 * Quick Setup's Docker Swarm templates: the shared AlertTemplatePicker, over
 * this type's catalog and under its headings.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: DockerSwarmAlertTemplate) => void;
  // What the picked template still asks for (its Time Range).
  children?: ReactNode | undefined;
}

const DockerSwarmTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<DockerSwarmAlertTemplate>
      templates={getAllDockerSwarmAlertTemplates()}
      categories={DOCKER_SWARM_TEMPLATE_CATEGORIES}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    >
      {props.children}
    </AlertTemplatePicker>
  );
};

export default DockerSwarmTemplatePicker;
