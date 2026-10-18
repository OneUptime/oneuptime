import React, { FunctionComponent, ReactElement } from "react";
import {
  getAllCephAlertTemplates,
  CephAlertTemplate,
} from "Common/Types/Monitor/CephAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";
import { CEPH_TEMPLATE_CATEGORIES } from "../AlertTemplatePicker/AlertTemplateCategories";

/*
 * Quick Setup's Ceph templates: the shared AlertTemplatePicker, over
 * this type's catalog and under its headings.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: CephAlertTemplate) => void;
}

const CephTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<CephAlertTemplate>
      templates={getAllCephAlertTemplates()}
      categories={CEPH_TEMPLATE_CATEGORIES}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    />
  );
};

export default CephTemplatePicker;
