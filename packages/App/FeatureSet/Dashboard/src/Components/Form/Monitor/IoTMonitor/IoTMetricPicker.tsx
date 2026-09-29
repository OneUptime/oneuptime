import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllIoTMetrics,
  getAllIoTMetricCategories,
  IoTMetricDefinition,
  IoTMetricCategory,
} from "Common/Types/Monitor/IotMetricCatalog";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: IoTMetricDefinition) => void;
}

const IoTMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allMetrics: Array<IoTMetricDefinition> = getAllIoTMetrics();
  const allCategories: Array<IoTMetricCategory> = getAllIoTMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: IoTMetricCategory) => {
      const categoryMetrics: Array<IoTMetricDefinition> = allMetrics.filter(
        (m: IoTMetricDefinition) => {
          return m.category === category;
        },
      );

      return {
        label: category,
        options: categoryMetrics.map((m: IoTMetricDefinition) => {
          return {
            label: `${m.friendlyName}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: IoTMetricDefinition | undefined = props.selectedMetricId
    ? allMetrics.find((m: IoTMetricDefinition) => {
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
          const metric: IoTMetricDefinition | undefined = allMetrics.find(
            (m: IoTMetricDefinition) => {
              return m.id === metricId;
            },
          );

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select an IoT metric..."
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

export default IoTMetricPicker;
