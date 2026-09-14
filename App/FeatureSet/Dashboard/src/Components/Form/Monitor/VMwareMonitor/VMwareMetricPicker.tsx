import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllVMwareMetrics,
  getAllVMwareMetricCategories,
  VMwareMetricDefinition,
  VMwareMetricCategory,
} from "Common/Types/Monitor/VMwareMetricCatalog";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: VMwareMetricDefinition) => void;
}

/*
 * Grouped dropdown over the vcenter-receiver metric catalog. Groups are the
 * catalog's categories (Datacenter, Cluster, Host, Virtual Machine,
 * Datastore, Resource Pool, vSAN) so the list reads the way vSphere's own
 * inventory does, and every option shows the receiver's declared unit so a
 * user can tell `MHz` from `%` before writing a threshold.
 */
const VMwareMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const allMetrics: Array<VMwareMetricDefinition> = getAllVMwareMetrics();
  const allCategories: Array<VMwareMetricCategory> =
    getAllVMwareMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: VMwareMetricCategory) => {
      const categoryMetrics: Array<VMwareMetricDefinition> = allMetrics.filter(
        (m: VMwareMetricDefinition) => {
          return m.category === category;
        },
      );

      return {
        label: category,
        options: categoryMetrics.map((m: VMwareMetricDefinition) => {
          return {
            label: `${m.friendlyName}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: VMwareMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find((m: VMwareMetricDefinition) => {
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
          const metric: VMwareMetricDefinition | undefined = allMetrics.find(
            (m: VMwareMetricDefinition) => {
              return m.id === metricId;
            },
          );

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select a VMware metric..."
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

export default VMwareMetricPicker;
