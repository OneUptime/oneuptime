import Dictionary from "Common/Types/Dictionary";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
import {
  ENTITY_KEYS_FACET_KEY,
  LockedEntityScope,
  describeLockedAttributeFilter,
  describeLockedEntityFilter,
  describeLockedEntityKeyFilter,
  describeLockedSessionFilter,
  describeLockedSpanFilter,
  describeLockedTraceFilter,
} from "../../Utils/LockedTelemetryScope";
import {
  LockedEntityKeyDisplayMap,
  getLockedEntityKeySearchAttributes,
} from "../../Utils/LockedEntityKeyChips";
import { ATTRIBUTE_FACET_PREFIX } from "./LogsHistogramRequest";

/*
 * The logs viewer's half of the locked-filter explainer: give every locked
 * (page-pinned) chip its explanation and search syntax.
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
  /*
   * Every entity key the page pins through `logQuery.entityKeys` (an
   * Inventory item's pages). The column is matched with `hasAny`, so several
   * keys WIDEN the scope and each chip has to say so — which a describer
   * handed one chip at a time cannot know. attachLogsLockedFilterDetails
   * fills it from the chips it decorates when the caller leaves it out.
   */
  entityKeys?: ReadonlyArray<string> | undefined;
  /*
   * Who pinned those entity keys: the page (an Inventory item's Logs tab, and
   * the default) or the stored query the view was opened with (an incident's
   * log snapshot). This step re-describes every entity-key chip, so without
   * the source here the builder's stored-query wording would be overwritten
   * with "Pinned by this page".
   */
  entityKeysSource?: string | undefined;
  /*
   * How the page names its entity keys — an Inventory item's pages hand over
   * the item's identifying resource attributes here. This step re-describes
   * every entity-key chip, so without them the chip would lose the search
   * syntax the chip builder spelled from those attributes.
   */
  entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;
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
    case ENTITY_KEYS_FACET_KEY:
      /*
       * Described here rather than trusted from whatever detail the chip
       * builder attached, so a chip that reaches this step without one still
       * explains itself. The chip's key ("Kubernetes Pod", or the "Resource"
       * fallback) is what the summary calls the thing.
       */
      return describeLockedEntityKeyFilter({
        rows: LOGS_SIGNAL,
        entityKey: chip.value,
        entityKeys: input.entityKeys,
        entityTypeLabel: chip.displayKey,
        source: input.entityKeysSource,
        searchAttributes: getLockedEntityKeySearchAttributes(
          input.entityKeyDisplays,
          chip.value,
        ),
      });
    default:
      return undefined;
  }
};

type CollectLockedEntityKeysFunction = (
  chips: Array<ActiveFilter>,
) => Array<string>;

/*
 * The entity keys the locked chips stand for, in chip order. A removable
 * chip on the same column is the user's own filter — it narrows the pinned
 * scope rather than widening it — so it is not counted.
 */
const collectLockedEntityKeys: CollectLockedEntityKeysFunction = (
  chips: Array<ActiveFilter>,
): Array<string> => {
  const entityKeys: Array<string> = [];

  for (const chip of chips) {
    if (
      chip.readOnly &&
      chip.facetKey === ENTITY_KEYS_FACET_KEY &&
      typeof chip.value === "string" &&
      !entityKeys.includes(chip.value)
    ) {
      entityKeys.push(chip.value);
    }
  }

  return entityKeys;
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
    /*
     * The chips on screen ARE the pinned entity keys (one per key), so they
     * are the list a multi-key summary counts unless the caller named one.
     * Without this the decoration would quietly replace the builder's "along
     * with the N other resources" wording with the single-key sentence.
     */
    const describeInput: AttachLogsLockedFilterDetailsInput =
      input.entityKeys === undefined
        ? { ...input, entityKeys: collectLockedEntityKeys(chips) }
        : input;

    return chips.map((chip: ActiveFilter): ActiveFilter => {
      if (!chip.readOnly) {
        return chip;
      }

      const lockedDetail: LockedFilterDetail | undefined =
        describeLogsLockedChip(chip, describeInput);

      if (!lockedDetail) {
        return chip;
      }

      return { ...chip, lockedDetail };
    });
  };
