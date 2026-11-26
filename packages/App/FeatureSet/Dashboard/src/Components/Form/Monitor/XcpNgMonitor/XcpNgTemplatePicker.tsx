import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import {
  getAllXcpNgAlertTemplates,
  XcpNgAlertTemplate,
} from "Common/Types/Monitor/XcpNgAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";
import { XCP_NG_TEMPLATE_CATEGORIES } from "../AlertTemplatePicker/AlertTemplateCategories";

/*
 * Quick Setup's XCP-ng templates: the shared AlertTemplatePicker, over
 * this type's catalog and under its headings.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: XcpNgAlertTemplate) => void;
  // What the picked template still asks for (its Time Range).
  children?: ReactNode | undefined;
}

const XcpNgTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<XcpNgAlertTemplate>
      templates={getAllXcpNgAlertTemplates()}
      categories={XCP_NG_TEMPLATE_CATEGORIES}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    >
      {props.children}
    </AlertTemplatePicker>
  );
};

export default XcpNgTemplatePicker;
