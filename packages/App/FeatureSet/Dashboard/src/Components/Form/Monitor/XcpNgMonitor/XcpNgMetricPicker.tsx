import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  getAllXcpNgMetrics,
  getAllXcpNgMetricCategories,
  XcpNgMetricDefinition,
  XcpNgMetricCategory,
  getXcpNgMetricCategoryLabel,
} from "Common/Types/Monitor/XcpNgMetricCatalog";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

export interface ComponentProps {
  selectedMetricId?: string | undefined;
  onMetricSelected: (metric: XcpNgMetricDefinition) => void;
}

/*
 * Grouped dropdown over the XCP-ng metric catalog: every series of Xen
 * Orchestra's OpenMetrics plugin and the 0/1 health series OneUptime
 * derives from its status series. Groups are the catalog's categories
 * (Availability, Host, VM, Storage, Network, XOSTOR), and every option
 * shows the unit its values are stored in, so a threshold is written in
 * the right one (bytes/s, not "bytes_total").
 */
const XcpNgMetricPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const allMetrics: Array<XcpNgMetricDefinition> = getAllXcpNgMetrics();
  const allCategories: Array<XcpNgMetricCategory> =
    getAllXcpNgMetricCategories();

  const groupedOptions: Array<DropdownOptionGroup> = allCategories.map(
    (category: XcpNgMetricCategory) => {
      const categoryMetrics: Array<XcpNgMetricDefinition> = allMetrics.filter(
        (m: XcpNgMetricDefinition) => {
          return m.category === category;
        },
      );

      // The group's heading, a key of the catalog's (#8653).
      const heading: string = getXcpNgMetricCategoryLabel(category);

      return {
        label: translator.translateText(heading) || heading,
        options: categoryMetrics.map((m: XcpNgMetricDefinition) => {
          return {
            label: `${translator.translateText(m.friendlyName)}${m.unit ? ` (${m.unit})` : ""}`,
            // In the reader's words already: never looked up again.
            isUserContent: true,
            isInPageDirection: true,
            value: m.id,
          };
        }),
      };
    },
  );

  const selectedMetric: XcpNgMetricDefinition | undefined =
    props.selectedMetricId
      ? allMetrics.find((m: XcpNgMetricDefinition) => {
          return m.id === props.selectedMetricId;
        })
      : undefined;

  const selectedOption: DropdownOption | undefined = selectedMetric
    ? {
        label: `${translator.translateText(selectedMetric.friendlyName)}${selectedMetric.unit ? ` (${selectedMetric.unit})` : ""}`,
        // In the reader's words already: never looked up again.
        isUserContent: true,
        isInPageDirection: true,
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
          const metric: XcpNgMetricDefinition | undefined = allMetrics.find(
            (m: XcpNgMetricDefinition) => {
              return m.id === metricId;
            },
          );

          if (metric) {
            props.onMetricSelected(metric);
          }
        }}
        placeholder="Select an XCP-ng metric..."
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
        </p>
      )}
    </div>
  );
};

export default XcpNgMetricPicker;
