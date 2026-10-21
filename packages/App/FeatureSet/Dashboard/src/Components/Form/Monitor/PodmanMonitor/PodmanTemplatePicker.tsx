import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import {
  getAllPodmanAlertTemplates,
  PodmanAlertTemplate,
} from "Common/Types/Monitor/PodmanAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";

/*
 * Quick Setup's Podman templates: the shared AlertTemplatePicker, over
 * this type's catalog.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: PodmanAlertTemplate) => void;
  // What the picked template still asks for (its Time Range).
  children?: ReactNode | undefined;
}

const PodmanTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<PodmanAlertTemplate>
      templates={getAllPodmanAlertTemplates()}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    >
      {props.children}
    </AlertTemplatePicker>
  );
};

export default PodmanTemplatePicker;
