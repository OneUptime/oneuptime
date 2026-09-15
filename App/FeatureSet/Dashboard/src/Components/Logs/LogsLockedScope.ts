import Dictionary from "Common/Types/Dictionary";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import { LockedFilterActionOptions } from "Common/UI/Components/TelemetryViewer/components/LockedFilterActions";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
import {
  ENTITY_KEYS_FACET_KEY,
  LockedEntityScope,
  buildLockedScopeCopyText,
  describeLockedAttributeFilter,
  describeLockedEntityFilter,
  describeLockedEntityKeyFilter,
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

      /*
       * Offered only when at least one locked filter made it into the URL.
       * With none (an Inventory item's entity-key scope: no explorer grammar
       * can spell an entity key) the link would open the UNFILTERED Logs
       * explorer under a label promising this page's scope, and a "not
       * carried over: resource" caveat does not make that link useful. A
       * mixed scope keeps its link, and the caveat names what stayed behind.
       */
      if (link.carriedFilterCount > 0) {
        actions.openExplorerRoute = link.url;
        actions.notCarried = link.notCarried;
      }
    } catch {
      // No resolvable explorer route here — copy still works.
    }

    if (Object.keys(actions).length === 0) {
      return undefined;
    }

    return actions;
  };
