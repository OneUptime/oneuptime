import React, { FunctionComponent, ReactElement } from "react";
import {
  getAllKubernetesAlertTemplates,
  KubernetesAlertTemplate,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";
import { KUBERNETES_TEMPLATE_CATEGORIES } from "../AlertTemplatePicker/AlertTemplateCategories";

/*
 * Quick Setup's Kubernetes templates: the shared AlertTemplatePicker, over
 * this type's catalog and under its headings.
 */

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: KubernetesAlertTemplate) => void;
}

const KubernetesTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<KubernetesAlertTemplate>
      templates={getAllKubernetesAlertTemplates()}
      categories={KUBERNETES_TEMPLATE_CATEGORIES}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    />
  );
};

export default KubernetesTemplatePicker;
