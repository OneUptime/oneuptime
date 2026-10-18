import React, { FunctionComponent, ReactElement } from "react";
import {
  getAllDockerAlertTemplates,
  DockerAlertTemplate,
} from "Common/Types/Monitor/DockerAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";

/*
 * Quick Setup's Docker templates: the shared AlertTemplatePicker, over
 * this type's catalog.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: DockerAlertTemplate) => void;
}

const DockerTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<DockerAlertTemplate>
      templates={getAllDockerAlertTemplates()}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    />
  );
};

export default DockerTemplatePicker;
