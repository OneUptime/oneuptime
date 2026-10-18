import React, { FunctionComponent, ReactElement } from "react";
import {
  getStorageArrayAlertTemplatesForSystem,
  StorageArrayAlertTemplate,
} from "Common/Types/Monitor/StorageArrayAlertTemplates";
import AlertTemplatePicker from "../AlertTemplatePicker/AlertTemplatePicker";
import { STORAGE_ARRAY_TEMPLATE_CATEGORIES } from "../AlertTemplatePicker/AlertTemplateCategories";

/*
 * Quick Setup's storage array templates: the shared AlertTemplatePicker, over
 * this type's catalog and under its headings.
 */

export interface ComponentProps {
  /*
   * The selected array's platform (StorageArray.storageSystem): only its
   * templates are offered. Unknown or empty offers every template.
   */
  storageSystem?: string | undefined;
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: StorageArrayAlertTemplate) => void;
}

const StorageArrayTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <AlertTemplatePicker<StorageArrayAlertTemplate>
      templates={getStorageArrayAlertTemplatesForSystem(props.storageSystem)}
      categories={STORAGE_ARRAY_TEMPLATE_CATEGORIES}
      selectedTemplateId={props.selectedTemplateId}
      onTemplateSelected={props.onTemplateSelected}
    />
  );
};

export default StorageArrayTemplatePicker;
