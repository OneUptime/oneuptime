import React, { FunctionComponent, ReactElement } from "react";
import {
  getAllVMwareAlertTemplates,
  VMwareAlertTemplate,
} from "Common/Types/Monitor/VMwareAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";
import { VMWARE_TEMPLATE_CATEGORIES } from "../AlertTemplatePicker/AlertTemplateCategories";

/*
 * Quick Setup's VMware templates: the shared AlertTemplatePicker, over
 * this type's catalog and under its headings.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: VMwareAlertTemplate) => void;
}

const VMwareTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<VMwareAlertTemplate>
      templates={getAllVMwareAlertTemplates()}
      categories={VMWARE_TEMPLATE_CATEGORIES}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    />
  );
};

export default VMwareTemplatePicker;
