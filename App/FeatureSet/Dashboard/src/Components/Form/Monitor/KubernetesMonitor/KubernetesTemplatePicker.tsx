import React, { FunctionComponent, ReactElement } from "react";
import {
  getAllKubernetesAlertTemplates,
  KubernetesAlertTemplate,
  KubernetesAlertTemplateCategory,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";

export interface ComponentProps {
  selectedTemplateId?: string | undefined;
  onTemplateSelected: (template: KubernetesAlertTemplate) => void;
}

const categories: Array<{
  category: KubernetesAlertTemplateCategory;
  label: string;
  icon: IconProp;
  description: string;
}> = [
  {
    category: "Workload",
    label: "Workload",
    icon: IconProp.Cube,
    description:
      "Monitor workload health including pod restarts, replica mismatches, and job failures.",
  },
  {
    category: "Node",
    label: "Node",
    icon: IconProp.Server,
    description:
      "Monitor node health including CPU, memory, disk usage, and node readiness.",
  },
  {
    category: "ControlPlane",
    label: "Control Plane",
    icon: IconProp.Settings,
    description:
      "Monitor Kubernetes control plane components including etcd, API server, and scheduler.",
  },
  {
    category: "Storage",
    label: "Storage",
    icon: IconProp.Disc,
    description: "Monitor storage resources including disk usage.",
  },
  {
    category: "Scheduling",
    label: "Scheduling",
    icon: IconProp.Clock,
    description:
      "Monitor pod scheduling including pending pods and scheduler backlog.",
  },
];

const KubernetesTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allTemplates: Array<KubernetesAlertTemplate> =
    getAllKubernetesAlertTemplates();

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Select a pre-built alert template to quickly set up monitoring. The
        template will auto-configure the metric, scope, aggregation, time range,
        and thresholds.
      </p>

      {categories.map(
        (cat: {
          category: KubernetesAlertTemplateCategory;
          label: string;
          icon: IconProp;
          description: string;
        }) => {
          const categoryTemplates: Array<KubernetesAlertTemplate> =
            allTemplates.filter(
              (t: KubernetesAlertTemplate) => t.category === cat.category,
            );

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
                {categoryTemplates.map((template: KubernetesAlertTemplate) => {
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

export default KubernetesTemplatePicker;
