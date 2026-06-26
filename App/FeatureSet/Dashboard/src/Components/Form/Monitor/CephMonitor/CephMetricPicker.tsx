import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllCephMetrics,
  getAllCephMetricCategories,
  CephMetricDefinition,
  CephMetricCategory,
} from "Common/Types/Monitor/CephMetricCatalog";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: CephMetricDefinition) => void;
}

const CephMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allMetrics: Array<CephMetricDefinition> = getAllCephMetrics();
  const allCategories: Array<CephMetricCategory> = getAllCephMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: CephMetricCategory) => {
      const categoryMetrics: Array<CephMetricDefinition> = allMetrics.filter(
        (m: CephMetricDefinition) => {
          return m.category === category;
        },
      );

      return {
        label: category,
        options: categoryMetrics.map((m: CephMetricDefinition) => {
          return {
            label: `${m.friendlyName}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: CephMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find((m: CephMetricDefinition) => {
          return m.id === props.selectedMetricId;
        })
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
          const metric: CephMetricDefinition | undefined = allMetrics.find(
            (m: CephMetricDefinition) => {
              return m.id === metricId;
            },
          );

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select a Ceph metric..."
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

export default CephMetricPicker;
