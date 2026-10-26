import React, { FunctionComponent, ReactElement } from "react";
import {
  composedValue,
  translatableTerm,
  translationKey,
  Translator,
} from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import { ActiveFilter } from "../types";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import LockedFilterChip from "./LockedFilterChip";
import { TelemetrySignal } from "../../../../Utils/Telemetry/LockedFilterSearch";
import {
  FacetChipReading,
  FacetValueState,
  readFacetChip,
} from "../FacetSelection";

// A chip that leaves its value out, so a test can tell it from one that keeps it.
export const EXCLUDED_FILTER_CHIP_TEST_ID: string = "excluded-filter-chip";

export interface TelemetryActiveFilterChipsProps {
  filters: Array<ActiveFilter>;
  onRemove: (facetKey: string, value: string) => void;
  onClearAll: () => void;
  /*
   * Which explorer the read-only chips belong to — names the explorer in the
   * locked chips' tooltips. Without it the chips still show their search
   * syntax but name no explorer.
   */
  signal?: TelemetrySignal | undefined;
}

/*
 * How an exclusion's key reads: "Severity is not", in the reader's language,
 * the field's name translated with it when it is one of the product's own
 * ("Severity") and as written when it is an attribute (device.hostname).
 * Every explorer's exclusion chip says it excludes in words, not in red
 * alone: "Severity: Informational" reads as the opposite of the filter it
 * applies, the one mistake a filter chip must never make.
 */
export const EXCLUDED_CHIP_KEY_TEMPLATE: string =
  translationKey("{{field}} is not");

export const getFilterChipKeyText: (
  displayKey: string,
  isExcluded: boolean,
  translator: Translator,
) => string = (
  displayKey: string,
  isExcluded: boolean,
  translator: Translator,
): string => {
  if (isExcluded) {
    return translator.translateTemplate(EXCLUDED_CHIP_KEY_TEMPLATE, {
      field: translatableTerm(displayKey),
    });
  }

  return translator.translateText(displayKey) || displayKey;
};

const TelemetryActiveFilterChips: FunctionComponent<
  TelemetryActiveFilterChipsProps
> = (props: TelemetryActiveFilterChipsProps): ReactElement | null => {
  const translator: Translator = useTranslator();
  if (props.filters.length === 0) {
    return null;
  }

  const readOnlyFilters: Array<ActiveFilter> = props.filters.filter(
    (f: ActiveFilter) => {
      return f.readOnly;
    },
  );
  const removableFilters: Array<ActiveFilter> = props.filters.filter(
    (f: ActiveFilter) => {
      return !f.readOnly;
    },
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-0.5">
      {readOnlyFilters.map((filter: ActiveFilter) => {
        const chipKey: string = `readonly:${filter.facetKey}:${filter.value}`;
        return (
          <LockedFilterChip
            key={chipKey}
            displayKey={filter.displayKey}
            displayValue={filter.displayValue}
            lockedDetail={filter.lockedDetail}
            signal={props.signal}
          />
        );
      })}
      {removableFilters.map((filter: ActiveFilter) => {
        const chipKey: string = `${filter.facetKey}:${filter.value}`;
        /*
         * An exclusion is drawn in the red the sidebar draws an excluded
         * value in, so the chip and the row it came from read as one thing.
         */
        const reading: FacetChipReading | null = readFacetChip(filter);
        const isExcluded: boolean = reading?.state === FacetValueState.Excluded;
        const keyText: string = getFilterChipKeyText(
          filter.displayKey,
          isExcluded,
          translator,
        );
        return (
          <span
            key={chipKey}
            data-testid={isExcluded ? EXCLUDED_FILTER_CHIP_TEST_ID : undefined}
            className={
              isExcluded
                ? "inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 py-0.5 pl-2 pr-1 text-xs text-red-700"
                : "inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 py-0.5 pl-2 pr-1 text-xs text-indigo-700"
            }
          >
            <span
              className={
                isExcluded
                  ? "font-medium text-red-600"
                  : "font-medium text-indigo-500"
              }
            >
              {keyText}:
            </span>
            <span>{filter.displayValue}</span>
            <button
              type="button"
              className={
                isExcluded
                  ? "ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-red-500 transition-colors hover:bg-red-100 hover:text-red-700"
                  : "ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600"
              }
              onClick={() => {
                props.onRemove(filter.facetKey, filter.value);
              }}
              title={translator.translateTemplate("Remove {{key}}: {{value}}", {
                // In the sentence's language, so it never mixes two.
                key: composedValue((sentence: Translator): string => {
                  return getFilterChipKeyText(
                    filter.displayKey,
                    isExcluded,
                    sentence,
                  );
                }),
                value: filter.displayValue,
              })}
            >
              <Icon icon={IconProp.Close} className="h-2.5 w-2.5" />
            </button>
          </span>
        );
      })}
      {removableFilters.length > 1 && (
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          onClick={props.onClearAll}
        >
          {translator.translateText("Clear all")}
        </button>
      )}
    </div>
  );
};

export default TelemetryActiveFilterChips;
