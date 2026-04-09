import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllDockerMetrics,
  getAllDockerMetricCategories,
  DockerMetricDefinition,
  DockerMetricCategory,
} from "Common/Types/Monitor/DockerMetricCatalog";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: DockerMetricDefinition) => void;
}

const DockerMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allMetrics: Array<DockerMetricDefinition> = getAllDockerMetrics();
  const allCategories: Array<DockerMetricCategory> =
    getAllDockerMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: DockerMetricCategory) => {
      const categoryMetrics: Array<DockerMetricDefinition> =
        allMetrics.filter((m: DockerMetricDefinition) => {
          return m.category === category;
        });

      return {
        label: category,
        options: categoryMetrics.map((m: DockerMetricDefinition) => {
          return {
            label: `${m.friendlyName}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: DockerMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find((m: DockerMetricDefinition) => {
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
          const metric: DockerMetricDefinition | undefined =
            allMetrics.find((m: DockerMetricDefinition) => {
              return m.id === metricId;
            });

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select a Docker metric..."
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

export default DockerMetricPicker;
