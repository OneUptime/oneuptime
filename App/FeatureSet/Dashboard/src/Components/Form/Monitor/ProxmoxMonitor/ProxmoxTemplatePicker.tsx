import React, { FunctionComponent, ReactElement } from "react";
import {
  getAllProxmoxAlertTemplates,
  ProxmoxAlertTemplate,
} from "Common/Types/Monitor/ProxmoxAlertTemplates";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: ProxmoxAlertTemplate) => void;
}

const ProxmoxTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allTemplates: Array<ProxmoxAlertTemplate> =
    getAllProxmoxAlertTemplates();

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Select a pre-built alert template to quickly set up Proxmox cluster
        monitoring. The template will auto-configure the metric, aggregation,
        time range, and thresholds.
      </p>

      <div className="grid grid-cols-1 gap-2">
        {allTemplates.map((template: ProxmoxAlertTemplate) => {
          const isSelected: boolean = props.selectedTemplateId === template.id;

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
};

export default ProxmoxTemplatePicker;
