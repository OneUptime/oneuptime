import Dictionary from "Common/Types/Dictionary";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import { LockedFilterActionOptions } from "Common/UI/Components/TelemetryViewer/components/LockedFilterActions";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
import {
  LockedEntityScope,
  buildLockedScopeCopyText,
  describeLockedAttributeFilter,
  describeLockedEntityFilter,
  describeLockedSessionFilter,
  describeLockedSpanFilter,
  describeLockedTraceFilter,
} from "../../Utils/LockedTelemetryScope";
import {
  LockedScopeExplorerLink,
  LockedScopeLinkFilter,
  buildLockedScopeExplorerLink,
} from "../../Utils/LockedTelemetryScopeLink";
import { ATTRIBUTE_FACET_PREFIX } from "./LogsHistogramRequest";

/*
 * The logs viewer's half of the locked-filter explainer: give every locked
 * (page-pinned) chip its explanation, and turn the whole locked scope into
 * the "Copy filter" text and the "Open in Logs" link.
 *
 * Kept out of LogsAttributeFilterChips.ts on purpose. That builder is pure
 * text-shaping and its suite runs without a browser stub; the describers
 * live next to the explorer-link builder, which reaches the current URL
 * through Navigation, and importing them there would drag `window` into a
 * module whose only job is naming a chip.
 */

export const LOGS_SIGNAL: TelemetrySignal = "logs";

export interface AttachLogsLockedFilterDetailsInput {
  /*
   * The page's pinned attributes as pinned — a scalar for the implicit
   * `=`, an operator instance for anything else. The chip only carries the
   * formatted text, and an operator filter must be explained (and refused a
   * search token) from the real value, not from its rendering.
   */
  logQueryAttributes?: Dictionary<DictionaryEntryValue> | undefined;
  /*
   * The page's entity scope, when it has one. Attached to the attribute chip
   * it names so the tooltip can say the match is "attribute OR entity key".
   */
  entityScope?: LockedEntityScope | undefined;
}

type RawAttributeValueFunction = (
  attributeKey: string,
  chip: ActiveFilter,
  logQueryAttributes: Dictionary<DictionaryEntryValue> | undefined,
) => DictionaryEntryValue;

/*
 * The pinned value wins; a chip whose key the page did not pin (it should
 * not happen — the chips are built FROM the pinned map) is explained from
 * its own text rather than dropped.
 */
const rawAttributeValue: RawAttributeValueFunction = (
  attributeKey: string,
  chip: ActiveFilter,
  logQueryAttributes: Dictionary<DictionaryEntryValue> | undefined,
): DictionaryEntryValue => {
  if (
    logQueryAttributes &&
    Object.prototype.hasOwnProperty.call(logQueryAttributes, attributeKey)
  ) {
    return logQueryAttributes[attributeKey] as DictionaryEntryValue;
  }

  return chip.value;
};

type DescribeLogsLockedChipFunction = (
  chip: ActiveFilter,
  input: AttachLogsLockedFilterDetailsInput,
) => LockedFilterDetail | undefined;

/**
 * The explanation for one locked chip, chosen by the column it filters.
 * Columns without a describer (none today) keep a plain chip.
 */
export const describeLogsLockedChip: DescribeLogsLockedChipFunction = (
  chip: ActiveFilter,
  input: AttachLogsLockedFilterDetailsInput,
): LockedFilterDetail | undefined => {
  if (chip.facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
    const attributeKey: string = chip.facetKey.substring(
      ATTRIBUTE_FACET_PREFIX.length,
    );

    return describeLockedAttributeFilter({
      signal: LOGS_SIGNAL,
      attributeKey,
      rawValue: rawAttributeValue(attributeKey, chip, input.logQueryAttributes),
      displayKey: chip.displayKey,
      displayValue: chip.displayValue,
      entityScope:
        input.entityScope && input.entityScope.attributeKey === attributeKey
          ? input.entityScope
          : undefined,
    });
  }

  switch (chip.facetKey) {
    case "primaryEntityId":
    case "serviceId":
      return describeLockedEntityFilter({
        signal: LOGS_SIGNAL,
        entityTypeLabel: chip.displayKey,
        id: chip.value,
        name: chip.displayValue,
      });
    case "traceId":
      return describeLockedTraceFilter({
        signal: LOGS_SIGNAL,
        traceId: chip.value,
      });
    case "spanId":
      return describeLockedSpanFilter({
        signal: LOGS_SIGNAL,
        spanId: chip.value,
      });
    case "sessionId":
      return describeLockedSessionFilter({
        signal: LOGS_SIGNAL,
        sessionId: chip.value,
      });
    default:
      return undefined;
  }
};

type AttachLogsLockedFilterDetailsFunction = (
  chips: Array<ActiveFilter>,
  input: AttachLogsLockedFilterDetailsInput,
) => Array<ActiveFilter>;

/**
 * Every read-only chip gets its `lockedDetail`; removable chips and chips
 * with no describer pass through untouched (same object, so memoised
 * consumers see no change).
 */
export const attachLogsLockedFilterDetails: AttachLogsLockedFilterDetailsFunction =
  (
    chips: Array<ActiveFilter>,
    input: AttachLogsLockedFilterDetailsInput,
  ): Array<ActiveFilter> => {
    return chips.map((chip: ActiveFilter): ActiveFilter => {
      if (!chip.readOnly) {
        return chip;
      }

      const lockedDetail: LockedFilterDetail | undefined =
        describeLogsLockedChip(chip, input);

      if (!lockedDetail) {
        return chip;
      }

      return { ...chip, lockedDetail };
    });
  };

export interface BuildLogsLockedFilterActionsInput {
  /** The viewer's base chips (already carrying their details). */
  chips: Array<ActiveFilter>;
  logQueryAttributes?: Dictionary<DictionaryEntryValue> | undefined;
  /** The viewer's current window, carried to the explorer as-is. */
  timeRange: RangeStartAndEndDateTime;
}

type BuildLogsLockedFilterActionsFunction = (
  input: BuildLogsLockedFilterActionsInput,
) => LockedFilterActionOptions | undefined;

/**
 * "Copy filter" and "Open in Logs" for the whole locked scope, or undefined
 * when there is nothing locked (the main explorer, an unscoped embed).
 *
 * The link needs the current project's route; a viewer rendered somewhere
 * that route cannot be resolved keeps the copy affordance and loses only
 * the link, rather than taking the chip row down with it.
 */
export const buildLogsLockedFilterActions: BuildLogsLockedFilterActionsFunction =
  (
    input: BuildLogsLockedFilterActionsInput,
  ): LockedFilterActionOptions | undefined => {
    const lockedChips: Array<ActiveFilter> = input.chips.filter(
      (chip: ActiveFilter): boolean => {
        return Boolean(chip.readOnly);
      },
    );

    if (lockedChips.length === 0) {
      return undefined;
    }

    const actions: LockedFilterActionOptions = {};

    const copyText: string = buildLockedScopeCopyText(LOGS_SIGNAL, lockedChips);

    if (copyText.length > 0) {
      actions.copyText = copyText;
    }

    try {
      const link: LockedScopeExplorerLink = buildLockedScopeExplorerLink({
        signal: LOGS_SIGNAL,
        filters: lockedChips.map(
          (chip: ActiveFilter): LockedScopeLinkFilter => {
            const filter: LockedScopeLinkFilter = {
              facetKey: chip.facetKey,
              value: chip.value,
            };

            if (chip.facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
              const attributeKey: string = chip.facetKey.substring(
                ATTRIBUTE_FACET_PREFIX.length,
              );

              filter.rawValue = rawAttributeValue(
                attributeKey,
                chip,
                input.logQueryAttributes,
              );
            }

            return filter;
          },
        ),
        timeRange: input.timeRange,
      });

      actions.openExplorerRoute = link.url;
      actions.notCarried = link.notCarried;
    } catch {
      // No resolvable explorer route here — copy still works.
    }

    if (Object.keys(actions).length === 0) {
      return undefined;
    }

    return actions;
  };
