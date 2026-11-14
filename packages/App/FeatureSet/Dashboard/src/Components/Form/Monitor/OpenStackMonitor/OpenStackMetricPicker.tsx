import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllOpenStackMetrics,
  getAllOpenStackMetricCategories,
  OpenStackMetricDefinition,
  OpenStackMetricCategory,
} from "Common/Types/Monitor/OpenStackMetricCatalog";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import MetricPickerDescription from "../MetricPickerDescription";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: OpenStackMetricDefinition) => void;
}

const OpenStackMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const allMetrics: Array<OpenStackMetricDefinition> = getAllOpenStackMetrics();
  const allCategories: Array<OpenStackMetricCategory> =
    getAllOpenStackMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: OpenStackMetricCategory) => {
      const categoryMetrics: Array<OpenStackMetricDefinition> =
        allMetrics.filter((m: OpenStackMetricDefinition) => {
          return m.category === category;
        });

      return {
        label: category,
        options: categoryMetrics.map((m: OpenStackMetricDefinition) => {
          return {
            label: `${translator.translateText(m.friendlyName)}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: OpenStackMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find((m: OpenStackMetricDefinition) => {
          return m.id === props.selectedMetricId;
        })
      : undefined;

  const selectedOption: DropdownOption | undefined = selectedMetric
    ? {
        label: `${translator.translateText(selectedMetric.friendlyName)}${selectedMetric.unit ? ` (${selectedMetric.unit})` : ""}`,
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
          const metric: OpenStackMetricDefinition | undefined = allMetrics.find(
            (m: OpenStackMetricDefinition) => {
              return m.id === metricId;
            },
          );

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select an OpenStack metric..."
      />

      {selectedMetric && (
        <MetricPickerDescription
          description={selectedMetric.description}
          metricName={selectedMetric.metricName}
        />
      )}
    </div>
  );
};

export default OpenStackMetricPicker;
