import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import {
  getAllProxmoxAlertTemplates,
  ProxmoxAlertTemplate,
} from "Common/Types/Monitor/ProxmoxAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";
import { PROXMOX_TEMPLATE_CATEGORIES } from "../AlertTemplatePicker/AlertTemplateCategories";

/*
 * Quick Setup's Proxmox templates: the shared AlertTemplatePicker, over
 * this type's catalog and under its headings.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: ProxmoxAlertTemplate) => void;
  // What the picked template still asks for (its Time Range).
  children?: ReactNode | undefined;
}

const ProxmoxTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<ProxmoxAlertTemplate>
      templates={getAllProxmoxAlertTemplates()}
      categories={PROXMOX_TEMPLATE_CATEGORIES}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    >
      {props.children}
    </AlertTemplatePicker>
  );
};

export default ProxmoxTemplatePicker;
