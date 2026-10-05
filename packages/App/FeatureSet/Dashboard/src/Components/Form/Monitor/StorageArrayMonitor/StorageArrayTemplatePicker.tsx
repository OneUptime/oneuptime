import React, { FunctionComponent, ReactElement } from "react";
import {
  getStorageArrayAlertTemplatesForSystem,
  StorageArrayAlertTemplate,
  StorageArrayAlertTemplateCategory,
} from "Common/Types/Monitor/StorageArrayAlertTemplates";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  /*
   * The selected array's platform (StorageArray.storageSystem): only its
   * templates are offered. Unknown or empty offers every template.
   */
  storageSystem?: string | undefined;
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: StorageArrayAlertTemplate) => void;
}

const categories: Array<{
  category: StorageArrayAlertTemplateCategory;
  label: string;
  icon: IconProp;
  description: string;
}> = [
  {
    category: "Array Health",
    label: "Array Health",
    icon: IconProp.Activity,
    description:
      "Alert on the critical and warning alerts the array raises itself.",
  },
  {
    category: "Capacity",
    label: "Capacity",
    icon: IconProp.ChartBar,
    description:
      "Alert before the array runs out of usable capacity, at the levels Pure warns at.",
  },
  {
    category: "Performance",
    label: "Performance",
    icon: IconProp.Signal,
    description: "Alert when reads or writes take longer than they should.",
  },
  {
    category: "Hardware",
    label: "Hardware",
    icon: IconProp.CPUChip,
    description:
      "Alert on failed or degraded components, drives and controllers.",
  },
  {
    category: "Hosts",
    label: "Hosts",
    icon: IconProp.Server,
    description: "Alert when a host loses its redundant paths to the array.",
  },
  {
    category: "Replication",
    label: "Replication",
    icon: IconProp.Refresh,
    description:
      "Alert when a pod's remote copy falls behind on its replica link.",
  },
  {
    category: "File Systems",
    label: "File Systems",
    icon: IconProp.Folder,
    description: "Alert before a file system fills its provisioned size.",
  },
];

const StorageArrayTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const allTemplates: Array<StorageArrayAlertTemplate> =
    getStorageArrayAlertTemplatesForSystem(props.storageSystem);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {translator.translateText(
          "Select a pre-built alert template to quickly set up storage array monitoring. The template will auto-configure the metric, its filters, aggregation, time range, and thresholds.",
        )}
      </p>

      {categories.map(
        (cat: {
          category: StorageArrayAlertTemplateCategory;
          label: string;
          icon: IconProp;
          description: string;
        }) => {
          const categoryTemplates: Array<StorageArrayAlertTemplate> =
            allTemplates.filter((t: StorageArrayAlertTemplate) => {
              return t.category === cat.category;
            });

          if (categoryTemplates.length === 0) {
            return null;
          }

          return (
            <div key={cat.category}>
              <div className="flex items-center mb-2">
                <Icon icon={cat.icon} className="mr-2 h-4 w-4 text-gray-500" />
                <h4 className="text-sm font-semibold text-gray-700">
                  {translator.translateText(cat.label)}
                </h4>
              </div>
              <p className="text-xs text-gray-400 mb-2">
                {translator.translateText(cat.description)}
              </p>
              <div className="grid grid-cols-1 gap-2 mb-4">
                {categoryTemplates.map(
                  (template: StorageArrayAlertTemplate) => {
                    const isSelected: boolean =
                      props.selectedTemplateId === template.id;

                    return (
                      <div
                        key={template.id}
                        className={`cursor-pointer rounded-lg border p-3 transition-all hover:shadow-sm ${
                          isSelected
                            ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                        onClick={() => {
                          props.onTemplateSelected(template);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e: React.KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            props.onTemplateSelected(template);
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center">
                              <span className="text-sm font-medium text-gray-900">
                                {translator.translateText(template.name)}
                              </span>
                              <span
                                className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                  template.severity === "Critical"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-yellow-100 text-yellow-800"
                                }`}
                              >
                                {translator.translateText(template.severity)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                              {translator.translateText(template.description)}
                            </p>
                          </div>
                          {isSelected && (
                            <div className="ml-3">
                              <Icon
                                icon={IconProp.CheckCircle}
                                className="h-5 w-5 text-blue-500"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          );
        },
      )}
    </div>
  );
};

export default StorageArrayTemplatePicker;
