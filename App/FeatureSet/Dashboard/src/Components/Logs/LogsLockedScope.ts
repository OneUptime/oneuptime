import Dictionary from "Common/Types/Dictionary";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
import {
  describeLockedAttributeFilter,
  describeLockedEntityFilter,
  describeLockedSessionFilter,
  describeLockedSpanFilter,
  describeLockedTraceFilter,
} from "../../Utils/LockedTelemetryScope";
import { ATTRIBUTE_FACET_PREFIX } from "./LogsHistogramRequest";

/*
 * The logs viewer's half of the locked-chip search syntax: give every locked
 * (page-pinned) chip its search token, or the reason it has none.
 *
 * Entity-key chips are not described here: they arrive with their detail
 * from buildLockedEntityKeyChips, spelled from the page's entity-key
 * displays, and pass through untouched.
 */

export const LOGS_SIGNAL: TelemetrySignal = "logs";

export interface AttachLogsLockedFilterDetailsInput {
  /*
   * The page's pinned attributes as pinned — a scalar for the implicit
   * `=`, an operator instance for anything else. The chip only carries the
   * formatted text, and an operator filter must get its token (or be refused
   * one) from the real value, not from its rendering.
   */
  logQueryAttributes?: Dictionary<DictionaryEntryValue> | undefined;
}

type RawAttributeValueFunction = (
  attributeKey: string,
  chip: ActiveFilter,
  logQueryAttributes: Dictionary<DictionaryEntryValue> | undefined,
) => DictionaryEntryValue;

/*
 * The pinned value wins; a chip whose key the page did not pin (it should
 * not happen — the chips are built FROM the pinned map) is described from
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
 * The search syntax (or the reason there is none) for one locked chip,
 * chosen by the column it filters. Columns without a describer — the
 * entity-key column among them, whose chips arrive with their detail from
 * buildLockedEntityKeyChips — get nothing here.
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
    });
  }

  switch (chip.facetKey) {
    case "primaryEntityId":
    case "serviceId":
      return describeLockedEntityFilter({
        signal: LOGS_SIGNAL,
        id: chip.value,
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
 * consumers see no change). Entity-key chips are among the latter: they keep
 * the detail buildLockedEntityKeyChips attached.
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
