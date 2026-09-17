import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllPodmanMetrics,
  getAllPodmanMetricCategories,
  PodmanMetricDefinition,
  PodmanMetricCategory,
} from "Common/Types/Monitor/PodmanMetricCatalog";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: PodmanMetricDefinition) => void;
}

const PodmanMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allMetrics: Array<PodmanMetricDefinition> = getAllPodmanMetrics();
  const allCategories: Array<PodmanMetricCategory> =
    getAllPodmanMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: PodmanMetricCategory) => {
      const categoryMetrics: Array<PodmanMetricDefinition> = allMetrics.filter(
        (m: PodmanMetricDefinition) => {
          return m.category === category;
        },
      );

      return {
        label: category,
        options: categoryMetrics.map((m: PodmanMetricDefinition) => {
          return {
            label: `${m.friendlyName}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: PodmanMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find((m: PodmanMetricDefinition) => {
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
          const metric: PodmanMetricDefinition | undefined = allMetrics.find(
            (m: PodmanMetricDefinition) => {
              return m.id === metricId;
            },
          );

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select a Podman metric..."
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

export default PodmanMetricPicker;
