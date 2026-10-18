import React, { FunctionComponent, ReactElement } from "react";
import {
  getAllHostAlertTemplates,
  HostAlertTemplate,
} from "Common/Types/Monitor/HostAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";

/*
 * Quick Setup's host templates: the shared AlertTemplatePicker, over
 * this type's catalog.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: HostAlertTemplate) => void;
}

const HostTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<HostAlertTemplate>
      templates={getAllHostAlertTemplates()}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    />
  );
};

export default HostTemplatePicker;
