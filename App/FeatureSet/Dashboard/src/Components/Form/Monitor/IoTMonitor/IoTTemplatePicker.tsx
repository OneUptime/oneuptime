import React, { FunctionComponent, ReactElement } from "react";
import {
  getAllIoTAlertTemplates,
  IoTAlertTemplate,
  IoTAlertTemplateCategory,
} from "Common/Types/Monitor/IotAlertTemplates";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: IoTAlertTemplate) => void;
}

const categories: Array<{
  category: IoTAlertTemplateCategory;
  label: string;
  icon: IconProp;
  description: string;
}> = [
  {
    category: "Availability",
    label: "Availability",
    icon: IconProp.Heartbeat,
    description:
      "Monitor device availability — alert when a device reports as down or stops responding.",
  },
  {
    category: "Power",
    label: "Power",
    icon: IconProp.Bolt,
    description:
      "Monitor device battery levels — alert before a device's battery is exhausted.",
  },
  {
    category: "Connectivity",
    label: "Connectivity",
    icon: IconProp.Signal,
    description:
      "Monitor wireless signal strength — alert when a device's signal weakens.",
  },
  {
    category: "Environment",
    label: "Environment",
    icon: IconProp.Fire,
    description:
      "Monitor device temperature — alert when a device is overheating.",
  },
  {
    category: "System",
    label: "System",
    icon: IconProp.CPUChip,
    description: "Monitor device CPU, memory, and resource usage.",
  },
  {
    category: "Fleet Health",
    label: "Fleet Health",
    icon: IconProp.SquareStack,
    description:
      "Monitor fleet-wide rollups computed by OneUptime every minute — alert when too much of the fleet is offline or the fleet's weakest batteries run low. One incident per fleet, not per device.",
  },
];

const IoTTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allTemplates: Array<IoTAlertTemplate> = getAllIoTAlertTemplates();

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Select a pre-built alert template to quickly set up IoT fleet
        monitoring. The template will auto-configure the metric, scope,
        aggregation, time range, and thresholds.
      </p>

      {categories.map(
        (cat: {
          category: IoTAlertTemplateCategory;
          label: string;
          icon: IconProp;
          description: string;
        }) => {
          const categoryTemplates: Array<IoTAlertTemplate> =
            allTemplates.filter((t: IoTAlertTemplate) => {
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
                  {cat.label}
                </h4>
              </div>
              <p className="text-xs text-gray-400 mb-2">{cat.description}</p>
              <div className="grid grid-cols-1 gap-2 mb-4">
                {categoryTemplates.map((template: IoTAlertTemplate) => {
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
                              {template.name}
                            </span>
                            <span
                              className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                template.severity === "Critical"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-yellow-100 text-yellow-800"
                              }`}
                            >
                              {template.severity}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            {template.description}
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
                })}
              </div>
            </div>
          );
        },
      )}
    </div>
  );
};

export default IoTTemplatePicker;
