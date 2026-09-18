import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllProxmoxMetrics,
  getAllProxmoxMetricCategories,
  ProxmoxMetricDefinition,
  ProxmoxMetricCategory,
} from "Common/Types/Monitor/ProxmoxMetricCatalog";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: ProxmoxMetricDefinition) => void;
}

const ProxmoxMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allMetrics: Array<ProxmoxMetricDefinition> = getAllProxmoxMetrics();
  const allCategories: Array<ProxmoxMetricCategory> =
    getAllProxmoxMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: ProxmoxMetricCategory) => {
      const categoryMetrics: Array<ProxmoxMetricDefinition> = allMetrics.filter(
        (m: ProxmoxMetricDefinition) => {
          return m.category === category;
        },
      );

      return {
        label: category,
        options: categoryMetrics.map((m: ProxmoxMetricDefinition) => {
          return {
            label: `${m.friendlyName}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: ProxmoxMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find((m: ProxmoxMetricDefinition) => {
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
          const metric: ProxmoxMetricDefinition | undefined = allMetrics.find(
            (m: ProxmoxMetricDefinition) => {
              return m.id === metricId;
            },
          );

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select a Proxmox metric..."
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

export default ProxmoxMetricPicker;
