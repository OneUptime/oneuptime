import React, { FunctionComponent, ReactElement } from "react";
import {
  composedValue,
  translatableTerm,
  Translator,
} from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import { ActiveFilter } from "../types";
import Icon from "../../Icon/Icon";
import IsolatedText from "../../IsolatedText/IsolatedText";
import IconProp from "../../../../Types/Icon/IconProp";
import Link from "../../Link/Link";
import { formatDictionaryValueForDisplay } from "../../Dictionary/DictionaryFilterOperator";
import LockedFilterChip from "../../TelemetryViewer/components/LockedFilterChip";
import { TelemetrySignal } from "../../../../Utils/Telemetry/LockedFilterSearch";
import {
  EXCLUDED_FILTER_CHIP_TEST_ID,
  getFilterChipKeyText,
} from "../../TelemetryViewer/components/TelemetryActiveFilterChips";
import {
  FacetChipReading,
  FacetValueState,
  readFacetChip,
} from "../../TelemetryViewer/FacetSelection";

export interface ActiveFilterChipsProps {
  filters: Array<ActiveFilter>;
  onRemove: (facetKey: string, value: string) => void;
  onClearAll: () => void;
  /*
   * Which explorer the read-only chips belong to — names the explorer in the
   * locked chips' tooltips. Defaults to logs, the only signal this list
   * renders.
   */
  signal?: TelemetrySignal | undefined;
}

/*
 * `ActiveFilter.displayValue` is typed `string`, but chips are built from
 * query objects that reach here through `as` casts, and an attribute filter
 * carrying an operator (`contains`, `is any of`, ...) is an object, not a
 * string. React answers an object child by throwing, which unmounts whatever
 * renders the viewer — for the log monitor's criteria modal that meant a
 * "Something went wrong" card in place of the form and no way to reach Save.
 *
 * Callers are expected to format their own text (see the log viewer's base
 * chips); this is the backstop that keeps a mistyped value a bad-looking chip
 * instead of a lost page.
 */
const chipText: (value: string) => string = (value: string): string => {
  if (typeof value === "string") {
    return value;
  }

  return formatDictionaryValueForDisplay(value);
};

const renderOpenAffordance: (
  filter: ActiveFilter,
  colorClassName: string,
  translator: Translator,
) => ReactElement | null = (
  filter: ActiveFilter,
  colorClassName: string,
  translator: Translator,
): ReactElement | null => {
  if (!filter.openRoute) {
    return null;
  }

  return (
    <Link
      to={filter.openRoute}
      className={`ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded transition-colors ${colorClassName}`}
      title={translator.translateTemplate("Open {{name}} view", {
        name: translatableTerm(filter.displayKey, { inSentence: true }),
      })}
      isTitleTranslated={true}
    >
      <Icon icon={IconProp.ExternalLink} className="h-2.5 w-2.5" />
    </Link>
  );
};

const ActiveFilterChips: FunctionComponent<ActiveFilterChipsProps> = (
  props: ActiveFilterChipsProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  if (props.filters.length === 0) {
    return null;
  }

  const signal: TelemetrySignal = props.signal || "logs";

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
        const chipKey: string = `readonly:${filter.facetKey}:${chipText(filter.value)}`;
        return (
          <LockedFilterChip
            key={chipKey}
            displayKey={filter.displayKey}
            displayValue={chipText(filter.displayValue)}
            lockedDetail={filter.lockedDetail}
            signal={signal}
            trailing={renderOpenAffordance(
              filter,
              "text-gray-400 hover:bg-gray-200 hover:text-indigo-600",
              translator,
            )}
          />
        );
      })}
      {removableFilters.map((filter: ActiveFilter) => {
        const chipKey: string = `${filter.facetKey}:${chipText(filter.value)}`;
        /*
         * A chip that leaves its value out reads "Severity is not: debug",
         * in the red the sidebar draws an excluded value in - the words and
         * the colour every explorer's chip row uses for it
         * (TelemetryActiveFilterChips), never the indigo of a kept value.
         */
        const reading: FacetChipReading | null = readFacetChip({
          facetKey: filter.facetKey,
          value: chipText(filter.value),
        });
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
            {/*
             * The value as its telemetry wrote it - a service, a host, a
             * message - read its own way on a page read the other way. In a
             * span of the page's direction, so a value long enough to wrap
             * still wraps from the chip's side.
             */}
            <span>
              <IsolatedText text={chipText(filter.displayValue)} />
            </span>
            {renderOpenAffordance(
              filter,
              isExcluded
                ? "text-red-500 hover:bg-red-100 hover:text-red-700"
                : "text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600",
              translator,
            )}
            <button
              type="button"
              className={
                isExcluded
                  ? "ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-red-500 transition-colors hover:bg-red-100 hover:text-red-700"
                  : "ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-600"
              }
              onClick={() => {
                /*
                 * The same coercion the chip's text gets. `value` is what the
                 * viewer deletes out of its Set<string> of applied filters, so
                 * handing the handler a raw object made the chip render fine
                 * and then refuse to be removed.
                 */
                props.onRemove(filter.facetKey, chipText(filter.value));
              }}
              title={translator.translateTemplate("Remove {{key}}: {{value}}", {
                // In the sentence's language, so it never mixes two.
                key: isExcluded
                  ? composedValue((sentence: Translator): string => {
                      return getFilterChipKeyText(
                        filter.displayKey,
                        true,
                        sentence,
                      );
                    })
                  : translatableTerm(filter.displayKey),
                value: chipText(filter.displayValue),
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

export default ActiveFilterChips;
