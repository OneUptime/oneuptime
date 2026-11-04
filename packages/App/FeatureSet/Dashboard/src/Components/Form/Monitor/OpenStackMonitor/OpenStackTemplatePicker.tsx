import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import {
  getAllOpenStackAlertTemplates,
  OpenStackAlertTemplate,
} from "Common/Types/Monitor/OpenStackAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";
import { OPENSTACK_TEMPLATE_CATEGORIES } from "../AlertTemplatePicker/AlertTemplateCategories";

/*
 * Quick Setup's OpenStack templates: the shared AlertTemplatePicker, over
 * this type's catalog and under its headings.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: OpenStackAlertTemplate) => void;
  // What the picked template still asks for (its Time Range).
  children?: ReactNode | undefined;
}

const OpenStackTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<OpenStackAlertTemplate>
      templates={getAllOpenStackAlertTemplates()}
      categories={OPENSTACK_TEMPLATE_CATEGORIES}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    >
      {props.children}
    </AlertTemplatePicker>
  );
};

export default OpenStackTemplatePicker;
