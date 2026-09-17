import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * The decisions behind the SLO Monitors page, kept out of the page so they can
 * be tested in plain node: which monitors a rule owns, what a person may add
 * or remove by hand while rules are enabled, and the exact payload that writes
 * the monitor list.
 *
 * React-free on purpose, and free of RouteMap / Navigation / UI Config too:
 * those read `window` at module load and would break the App test that imports
 * this (see App/Tests/FeatureSetImportsStayReactFree).
 *
 * The rules mirror the server guard in ServiceLevelObjectiveService, which is
 * the real enforcement - this module only keeps the page from offering an
 * action the API would refuse:
 *
 *   - ServiceLevelObjective.monitors is the effective set; autoAddedMonitors
 *     is the subset the monitor rules attached.
 *   - While at least one monitor rule is enabled, nothing new may be added by
 *     hand, and rule-attached monitors may not be removed by hand (the next
 *     sync would attach them again). Removing a hand-attached monitor is
 *     always fine.
 */

export enum SloMonitorSource {
  Rule = "Rule",
  Manual = "Manual",
}

/*
 * Word for word the message the API returns when it refuses the same add, so
 * the disabled button and the server error read as one product.
 */
export const SLO_MONITORS_MANAGED_BY_RULES_MESSAGE: string =
  "This SLO's monitors are managed by its monitor rules. Disable the rules to add monitors by hand.";

export const SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE: string =
  "A monitor rule attached this monitor, so removing it by hand would not stick: the rule would attach it again. Change or disable the rule to detach it.";

export interface SloMonitorReference {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
}

export type SloMonitorIdValue =
  | ObjectID
  | string
  | SloMonitorReference
  | null
  | undefined;

type NormalizeMonitorIdFunction = (value: SloMonitorIdValue) => string;

/*
 * One spelling per monitor id. Ids arrive as ObjectIDs, bare strings and
 * `{ _id }` stubs, and Postgres renders a uuid lower-case whatever case it was
 * written in - comparing them verbatim would report a monitor that is plainly
 * attached as missing.
 */
export const normalizeMonitorId: NormalizeMonitorIdFunction = (
  value: SloMonitorIdValue,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value instanceof ObjectID) {
    return value.toString().trim().toLowerCase();
  }

  const reference: SloMonitorReference = value as SloMonitorReference;

  return (reference._id?.toString() || reference.id?.toString() || "")
    .trim()
    .toLowerCase();
};

type ToMonitorIdListFunction = (
  items: Array<SloMonitorIdValue> | null | undefined,
) => Array<string>;

// Normalized, de-duplicated, in first-seen order; blanks dropped.
export const toMonitorIdList: ToMonitorIdListFunction = (
  items: Array<SloMonitorIdValue> | null | undefined,
): Array<string> => {
  const ids: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of items || []) {
    const id: string = normalizeMonitorId(item);

    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
};

export interface SloMonitorMembership {
  // Every attached monitor, rule-attached or not.
  monitorIds: Array<string>;
  // The attached monitors a monitor rule put there.
  ruleAttachedMonitorIds: Set<string>;
}

type GetSloMonitorMembershipFunction = (slo: {
  monitors?: Array<SloMonitorReference> | null | undefined;
  autoAddedMonitors?: Array<SloMonitorReference> | null | undefined;
}) => SloMonitorMembership;

export const getSloMonitorMembership: GetSloMonitorMembershipFunction = (slo: {
  monitors?: Array<SloMonitorReference> | null | undefined;
  autoAddedMonitors?: Array<SloMonitorReference> | null | undefined;
}): SloMonitorMembership => {
  const monitorIds: Array<string> = toMonitorIdList(slo.monitors);
  const attached: Set<string> = new Set<string>(monitorIds);

  /*
   * Intersected with the attached set: a bookkeeping entry for a monitor that
   * is no longer attached is a sync mid-repair, not a row on this page.
   */
  const ruleAttachedMonitorIds: Set<string> = new Set<string>(
    toMonitorIdList(slo.autoAddedMonitors).filter((id: string): boolean => {
      return attached.has(id);
    }),
  );

  return { monitorIds, ruleAttachedMonitorIds };
};

type GetSloMonitorSourceFunction = (data: {
  monitorId: SloMonitorIdValue;
  ruleAttachedMonitorIds: ReadonlySet<string>;
}) => SloMonitorSource;

export const getSloMonitorSource: GetSloMonitorSourceFunction = (data: {
  monitorId: SloMonitorIdValue;
  ruleAttachedMonitorIds: ReadonlySet<string>;
}): SloMonitorSource => {
  return data.ruleAttachedMonitorIds.has(normalizeMonitorId(data.monitorId))
    ? SloMonitorSource.Rule
    : SloMonitorSource.Manual;
};

export interface SloMonitorActionAvailability {
  isAllowed: boolean;
  // Why not, ready for a tooltip. Only set when isAllowed is false.
  disabledReason?: string | undefined;
}

type GetAddMonitorsAvailabilityFunction = (data: {
  enabledMonitorRuleCount: number;
}) => SloMonitorActionAvailability;

export const getAddMonitorsAvailability: GetAddMonitorsAvailabilityFunction =
  (data: { enabledMonitorRuleCount: number }): SloMonitorActionAvailability => {
    if (data.enabledMonitorRuleCount > 0) {
      return {
        isAllowed: false,
        disabledReason: SLO_MONITORS_MANAGED_BY_RULES_MESSAGE,
      };
    }

    return { isAllowed: true };
  };

type GetRemoveMonitorAvailabilityFunction = (data: {
  monitorId: SloMonitorIdValue;
  ruleAttachedMonitorIds: ReadonlySet<string>;
  enabledMonitorRuleCount: number;
}) => SloMonitorActionAvailability;

export const getRemoveMonitorAvailability: GetRemoveMonitorAvailabilityFunction =
  (data: {
    monitorId: SloMonitorIdValue;
    ruleAttachedMonitorIds: ReadonlySet<string>;
    enabledMonitorRuleCount: number;
  }): SloMonitorActionAvailability => {
    const isRuleAttached: boolean =
      getSloMonitorSource({
        monitorId: data.monitorId,
        ruleAttachedMonitorIds: data.ruleAttachedMonitorIds,
      }) === SloMonitorSource.Rule;

    /*
     * With no enabled rule left, a rule-attached row is leftover bookkeeping
     * the next sync would release anyway, so taking it off by hand is allowed
     * - the server agrees.
     */
    if (isRuleAttached && data.enabledMonitorRuleCount > 0) {
      return {
        isAllowed: false,
        disabledReason: SLO_RULE_ATTACHED_MONITOR_REMOVAL_MESSAGE,
      };
    }

    return { isAllowed: true };
  };

type ApplySloMonitorChangeFunction = (data: {
  currentMonitorIds: Array<SloMonitorIdValue>;
  addMonitorIds?: Array<SloMonitorIdValue> | undefined;
  removeMonitorIds?: Array<SloMonitorIdValue> | undefined;
}) => Array<string>;

/*
 * The monitor list after an add or remove, applied to the list as it is NOW.
 * The page re-reads the SLO right before saving and applies only the user's
 * delta to it, so a rule sync that moved the list while the modal was open is
 * kept rather than overwritten with a stale copy.
 */
export const applySloMonitorChange: ApplySloMonitorChangeFunction = (data: {
  currentMonitorIds: Array<SloMonitorIdValue>;
  addMonitorIds?: Array<SloMonitorIdValue> | undefined;
  removeMonitorIds?: Array<SloMonitorIdValue> | undefined;
}): Array<string> => {
  const removed: Set<string> = new Set<string>(
    toMonitorIdList(data.removeMonitorIds),
  );

  return toMonitorIdList([
    ...data.currentMonitorIds,
    ...(data.addMonitorIds || []),
  ]).filter((id: string): boolean => {
    return !removed.has(id);
  });
};

type BuildSloMonitorsUpdateDataFunction = (
  monitorIds: Array<SloMonitorIdValue>,
) => JSONObject;

/*
 * The `data` for ModelAPI.updateById on a ServiceLevelObjective. It is the
 * shape ModelForm sends for an EntityArray column - model stubs carrying only
 * `_id` - which BaseModel.fromJSON turns back into Monitor rows on the server.
 * An empty array is sent as-is: it is how the last monitor gets removed.
 */
export const buildSloMonitorsUpdateData: BuildSloMonitorsUpdateDataFunction = (
  monitorIds: Array<SloMonitorIdValue>,
): JSONObject => {
  return {
    monitors: toMonitorIdList(monitorIds).map((id: string): JSONObject => {
      return { _id: id };
    }),
  };
};

export interface SloAddableMonitorOption {
  label: string;
  value: string;
}

type GetAddableMonitorOptionsFunction = (data: {
  monitors: Array<SloMonitorReference & { name?: string | undefined }>;
  attachedMonitorIds: Iterable<string>;
}) => Array<SloAddableMonitorOption>;

// The project's monitors not already on the SLO, by name.
export const getAddableMonitorOptions: GetAddableMonitorOptionsFunction =
  (data: {
    monitors: Array<SloMonitorReference & { name?: string | undefined }>;
    attachedMonitorIds: Iterable<string>;
  }): Array<SloAddableMonitorOption> => {
    const attached: Set<string> = new Set<string>(
      toMonitorIdList(Array.from(data.attachedMonitorIds)),
    );
    const seen: Set<string> = new Set<string>();
    const options: Array<SloAddableMonitorOption> = [];

    for (const monitor of data.monitors) {
      const id: string = normalizeMonitorId(monitor);

      if (!id || attached.has(id) || seen.has(id)) {
        continue;
      }

      seen.add(id);
      options.push({
        value: id,
        label: monitor.name?.trim() || "Untitled monitor",
      });
    }

    return options.sort(
      (a: SloAddableMonitorOption, b: SloAddableMonitorOption): number => {
        return a.label.localeCompare(b.label, undefined, {
          sensitivity: "base",
        });
      },
    );
  };

type GetSelectedMonitorIdsFunction = (value: unknown) => Array<string>;

/*
 * A multi-select hands back the chosen values, but depending on the dropdown
 * that can be bare strings or `{ value, label }` options. Accept both, and
 * nothing else.
 */
export const getSelectedMonitorIds: GetSelectedMonitorIdsFunction = (
  value: unknown,
): Array<string> => {
  const values: Array<unknown> = Array.isArray(value)
    ? value
    : value === null || value === undefined || value === ""
      ? []
      : [value];

  return toMonitorIdList(
    values.map((item: unknown): SloMonitorIdValue => {
      if (typeof item === "string" || item instanceof ObjectID) {
        return item;
      }

      if (item && typeof item === "object" && "value" in item) {
        const optionValue: unknown = (item as { value: unknown }).value;

        return typeof optionValue === "string" ? optionValue : undefined;
      }

      return undefined;
    }),
  );
};

type DescribeSloMonitorCountsFunction = (
  membership: SloMonitorMembership,
) => string;

// "No monitors attached" / "3 monitors: 2 attached by rules, 1 by hand".
export const describeSloMonitorCounts: DescribeSloMonitorCountsFunction = (
  membership: SloMonitorMembership,
): string => {
  const total: number = membership.monitorIds.length;

  if (total === 0) {
    return "No monitors attached";
  }

  const byRules: number = membership.ruleAttachedMonitorIds.size;
  const byHand: number = total - byRules;
  const noun: string = total === 1 ? "monitor" : "monitors";

  if (byRules === 0) {
    return `${total} ${noun}, all attached by hand`;
  }

  if (byHand === 0) {
    return `${total} ${noun}, all attached by monitor rules`;
  }

  return `${total} ${noun}: ${byRules} attached by monitor rules, ${byHand} by hand`;
};
