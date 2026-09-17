import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllHostMetrics,
  getAllHostMetricCategories,
  HostMetricDefinition,
  HostMetricCategory,
} from "Common/Types/Monitor/HostMetricCatalog";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: HostMetricDefinition) => void;
}

const HostMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allMetrics: Array<HostMetricDefinition> = getAllHostMetrics();
  const allCategories: Array<HostMetricCategory> = getAllHostMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: HostMetricCategory) => {
      const categoryMetrics: Array<HostMetricDefinition> = allMetrics.filter(
        (m: HostMetricDefinition) => {
          return m.category === category;
        },
      );

      return {
        label: category,
        options: categoryMetrics.map((m: HostMetricDefinition) => {
          return {
            label: `${m.friendlyName}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: HostMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find((m: HostMetricDefinition) => {
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
          const metric: HostMetricDefinition | undefined = allMetrics.find(
            (m: HostMetricDefinition) => {
              return m.id === metricId;
            },
          );

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select a host metric..."
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

export default HostMetricPicker;
