import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllStorageArrayMetricCategories,
  getStorageArrayMetricsForSystem,
  StorageArrayMetricDefinition,
  StorageArrayMetricCategory,
} from "Common/Types/Monitor/StorageArrayMetricCatalog";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

export interface ComponentProps {
  /*
   * The selected array's platform (StorageArray.storageSystem): only its
   * metrics are offered. Unknown or empty offers the whole catalog.
   */
  storageSystem?: string | undefined;
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: StorageArrayMetricDefinition) => void;
}

/*
 * The label filters a catalog entry pins (Pure tells read from write only
 * by the `dimension` label), written the way the query builder shows them.
 */
export function formatPinnedAttributes(
  metric: StorageArrayMetricDefinition,
): string {
  return Object.entries(metric.attributes || {})
    .map(([key, value]: [string, string]): string => {
      return `${key} = ${value}`;
    })
    .join(", ");
}

const StorageArrayMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const allMetrics: Array<StorageArrayMetricDefinition> =
    getStorageArrayMetricsForSystem(props.storageSystem);
  const allCategories: Array<StorageArrayMetricCategory> =
    getAllStorageArrayMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories
    .map((category: StorageArrayMetricCategory): DropdownOptionGroup => {
      const categoryMetrics: Array<StorageArrayMetricDefinition> =
        allMetrics.filter((m: StorageArrayMetricDefinition) => {
          return m.category === category;
        });

      return {
        label: category,
        options: categoryMetrics.map((m: StorageArrayMetricDefinition) => {
          return {
            label: `${translator.translateText(m.friendlyName)}${m.unit ? ` (${m.unit})` : ""}`,
            value: m.id,
          };
        }),
      };
    })
    .filter((group: DropdownOptionGroup): boolean => {
      // A platform without a category (a FlashBlade has no volumes) skips it.
      return group.options.length > 0;
    });

  const selectedMetric: StorageArrayMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find((m: StorageArrayMetricDefinition) => {
          return m.id === props.selectedMetricId;
        })
      : undefined;

  const selectedOption: DropdownOption | undefined = selectedMetric
    ? {
        label: `${translator.translateText(selectedMetric.friendlyName)}${selectedMetric.unit ? ` (${selectedMetric.unit})` : ""}`,
        value: selectedMetric.id,
      }
    : undefined;

  const pinnedAttributes: string = selectedMetric
    ? formatPinnedAttributes(selectedMetric)
    : "";

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
          const metric: StorageArrayMetricDefinition | undefined =
            allMetrics.find((m: StorageArrayMetricDefinition) => {
              return m.id === metricId;
            });

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select a storage array metric..."
      />

      {selectedMetric && (
        <p className="mt-2 text-xs text-gray-500">
          <TranslatedSentence
            template="{{description}} — Metric: {{metric}}"
            values={{
              description: translator.translateText(
                selectedMetric.description,
              ) as string,
            }}
            slots={{
              metric: (
                <code className="bg-gray-100 px-1 rounded text-xs">
                  {selectedMetric.metricName}
                </code>
              ),
            }}
          />
          {pinnedAttributes ? (
            <span className="ml-1">
              <TranslatedSentence
                template="Filtered to {{attributes}}."
                slots={{
                  attributes: (
                    <code className="bg-gray-100 px-1 rounded text-xs">
                      {pinnedAttributes}
                    </code>
                  ),
                }}
              />
            </span>
          ) : (
            <></>
          )}
        </p>
      )}
    </div>
  );
};

export default StorageArrayMetricPicker;
