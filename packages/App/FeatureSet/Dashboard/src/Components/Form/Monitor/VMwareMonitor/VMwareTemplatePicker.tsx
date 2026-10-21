import React, { FunctionComponent, ReactElement, ReactNode } from "react";
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
  // What the picked template still asks for (its Time Range).
  children?: ReactNode | undefined;
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
    >
      {props.children}
    </AlertTemplatePicker>
  );
};

export default VMwareTemplatePicker;
