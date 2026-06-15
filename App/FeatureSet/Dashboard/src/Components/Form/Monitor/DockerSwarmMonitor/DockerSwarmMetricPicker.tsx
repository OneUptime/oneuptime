import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllDockerSwarmMetrics,
  getAllDockerSwarmMetricCategories,
  DockerSwarmMetricDefinition,
  DockerSwarmMetricCategory,
} from "Common/Types/Monitor/DockerSwarmMetricCatalog";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: DockerSwarmMetricDefinition) => void;
}

const DockerSwarmMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allMetrics: Array<DockerSwarmMetricDefinition> =
    getAllDockerSwarmMetrics();
  const allCategories: Array<DockerSwarmMetricCategory> =
    getAllDockerSwarmMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: DockerSwarmMetricCategory) => {
      const categoryMetrics: Array<DockerSwarmMetricDefinition> =
        allMetrics.filter((m: DockerSwarmMetricDefinition) => {
          return m.category === category;
        });

      return {
        label: category,
        options: categoryMetrics.map((m: DockerSwarmMetricDefinition) => {
          return {
            label: `${m.friendlyName}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: DockerSwarmMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find((m: DockerSwarmMetricDefinition) => {
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
          const metric: DockerSwarmMetricDefinition | undefined =
            allMetrics.find((m: DockerSwarmMetricDefinition) => {
              return m.id === metricId;
            });

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select a Docker Swarm metric..."
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

export default DockerSwarmMetricPicker;
