import React, { FunctionComponent, ReactElement, ReactNode } from "react";
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
  // What the picked template still asks for (its Time Range).
  children?: ReactNode | undefined;
}

const DockerTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<DockerAlertTemplate>
      templates={getAllDockerAlertTemplates()}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    >
      {props.children}
    </AlertTemplatePicker>
  );
};

export default DockerTemplatePicker;
