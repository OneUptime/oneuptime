import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllKubernetesMetrics,
  getAllKubernetesMetricCategories,
  KubernetesMetricDefinition,
  KubernetesMetricCategory,
} from "Common/Types/Monitor/KubernetesMetricCatalog";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: KubernetesMetricDefinition) => void;
}

const KubernetesMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allMetrics: Array<KubernetesMetricDefinition> =
    getAllKubernetesMetrics();
  const allCategories: Array<KubernetesMetricCategory> =
    getAllKubernetesMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: KubernetesMetricCategory) => {
      const categoryMetrics: Array<KubernetesMetricDefinition> =
        allMetrics.filter(
          (m: KubernetesMetricDefinition) => m.category === category,
        );

      return {
        label: category,
        options: categoryMetrics.map((m: KubernetesMetricDefinition) => {
          return {
            label: `${m.friendlyName}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: KubernetesMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find(
          (m: KubernetesMetricDefinition) => m.id === props.selectedMetricId,
        )
      : undefined;

  const selectedOption: DropdownOption | undefined = selectedMetric
    ? {
        label: `${selectedMetric.friendlyName}${selectedMetric.unit ? ` (${selectedMetric.unit})` : ""}`,
        value: selectedMetric.id,
      }
    : undefined;

  return (
    <div>
      <Dropdown
        options={groupedOptions}
        value={selectedOption}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (!value) {
            return;
          }

          const metricId: string = value as string;
          const metric: KubernetesMetricDefinition | undefined =
            allMetrics.find(
              (m: KubernetesMetricDefinition) => m.id === metricId,
            );

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select a Kubernetes metric..."
      />

      {selectedMetric && (
        <p className="mt-2 text-xs text-gray-500">
          {selectedMetric.description} — Metric:{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">
            {selectedMetric.metricName}
          </code>
        </p>
      )}
    </div>
  );
};

export default KubernetesMetricPicker;
