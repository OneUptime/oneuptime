import type {
  BulkAddStatusPageMonitorResourceOptions,
  BulkAddStatusPageMonitorsOptions,
  BulkAddStatusPageMonitorsResult,
} from "./BulkAddStatusPageMonitors";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPageMonitorRule from "Common/Models/DatabaseModels/StatusPageMonitorRule";
import ColumnLength from "Common/Types/Database/ColumnLength";
import ObjectID from "Common/Types/ObjectID";

/**
 * Adding monitors to a status page by label, in a way that keeps working.
 *
 * The monitor picker can bulk-add every monitor carrying a label, but that is
 * a one-time expansion: the label produces a list of monitors, each becomes an
 * ordinary resource, and the label itself is thrown away. A monitor created
 * with that label tomorrow lands nowhere, and the group has to be re-populated
 * by hand - which is the whole thing the label was meant to avoid (#3418).
 *
 * A StatusPageMonitorRule is the durable form of the same intent: it records
 * the labels, and the server re-runs it whenever a monitor is created or
 * relabelled. So when someone populates a group from a label, this writes the
 * rule as well as the resources.
 *
 * Order is deliberate - resources first, rule second. The rule's server-side
 * backfill skips monitors already on the page, so running it after the bulk
 * add means the monitors just added keep the resources (and the display names)
 * this add created, and the rule owns only what it adds from here on.
 */
export interface AddStatusPageMonitorsWithLabelSyncOptions {
  monitors: Array<Monitor>;
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPageGroupId?: ObjectID | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
  resourceOptions?: BulkAddStatusPageMonitorResourceOptions | undefined;

  /**
   * The labels the picker expanded to produce `monitors`. Empty when the user
   * picked monitors one at a time, in which case there is no label to keep in
   * sync with and no rule is written.
   */
  syncLabels?: Array<SyncLabelSelection> | undefined;

  /**
   * Whether the user asked for those labels to stay live. Off means behave
   * exactly as before: add these monitors once and forget the label.
   */
  keepInSyncWithLabels?: boolean | undefined;

  /*
   * The two writes, injected rather than imported. Keeping the API calls out
   * of here is what lets every branch below be driven without a renderer or a
   * network, the same way StatusPageGroupImportRunner takes its createGroup.
   */
  bulkAdd: (
    options: BulkAddStatusPageMonitorsOptions,
  ) => Promise<BulkAddStatusPageMonitorsResult>;
  createMonitorRule: (rule: StatusPageMonitorRule) => Promise<void>;
}

export interface AddStatusPageMonitorsWithLabelSyncResult
  extends BulkAddStatusPageMonitorsResult {
  /**
   * The rule that was written, or null when none was asked for. Present even
   * when the create failed, so the caller can name the labels it was for.
   */
  monitorRule: StatusPageMonitorRule | null;

  /**
   * Why the rule could not be written - a caller without permission to create
   * rules, most likely. Never a reason to throw away resources that were added
   * successfully, so it is reported rather than raised.
   */
  monitorRuleError: unknown | null;
}

/**
 * A label the picker expanded, as the caller has it: an id, and the name it
 * was shown under. The name is only used to title the rule, so it is optional
 * - a rule with a duller name still keeps the group in sync.
 */
export interface SyncLabelSelection {
  id: ObjectID | string;
  name?: string | undefined;
}

/** The same, once it is known to be usable. */
export interface NormalizedSyncLabel {
  id: ObjectID;
  name: string;
}

/**
 * The labels worth writing a rule for: whatever the caller passed, with blanks
 * dropped and duplicates collapsed. Selecting the same label twice through two
 * passes of the picker must not produce a rule that names it twice.
 */
export type NormalizeSyncLabelsFunction = (
  labels: Array<SyncLabelSelection> | undefined,
) => Array<NormalizedSyncLabel>;

export const normalizeSyncLabels: NormalizeSyncLabelsFunction = (
  labels: Array<SyncLabelSelection> | undefined,
): Array<NormalizedSyncLabel> => {
  const seen: Set<string> = new Set<string>();
  const normalized: Array<NormalizedSyncLabel> = [];

  for (const label of labels || []) {
    const rawId: ObjectID | string | undefined = label?.id;

    const asString: string =
      rawId instanceof ObjectID ? rawId.toString() : `${rawId || ""}`;

    if (!asString || seen.has(asString)) {
      continue;
    }

    seen.add(asString);
    normalized.push({
      id: new ObjectID(asString),
      name: (label?.name || "").trim(),
    });
  }

  return normalized;
};

/**
 * What the rule is called in Status Page > Monitor Rules.
 *
 * name is a required column, so this is not decoration - a rule without one is
 * refused by the server and the group silently stops being kept in sync. It
 * names the labels because that is the only thing that distinguishes one of
 * these rules from the next, and it is clamped to the column's length because
 * a project can easily have labels whose names do not fit in a hundred
 * characters between them.
 */
export type BuildMonitorRuleNameFunction = (
  labels: Array<NormalizedSyncLabel>,
) => string;

export const buildMonitorRuleName: BuildMonitorRuleNameFunction = (
  labels: Array<NormalizedSyncLabel>,
): string => {
  const names: Array<string> = labels
    .map((label: NormalizedSyncLabel) => {
      return label.name;
    })
    .filter((name: string) => {
      return Boolean(name);
    });

  /*
   * Labels the picker could not name still deserve a rule. "Monitors by label"
   * is duller than the label's own name and every bit as valid.
   */
  if (names.length === 0) {
    return "Monitors by label";
  }

  const name: string = `${names.length === 1 ? "Label" : "Labels"}: ${names.join(", ")}`;

  if (name.length <= ColumnLength.ShortText) {
    return name;
  }

  return `${name.slice(0, ColumnLength.ShortText - 1)}\u2026`;
};

/**
 * Builds the rule that makes a label-populated group stay populated, or null
 * when there is nothing to keep in sync.
 *
 * The rule carries the same display options the resources were created with,
 * so a monitor the rule adds next week looks like the ones added today.
 */
export type BuildMonitorRuleForLabelSyncFunction = (data: {
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPageGroupId?: ObjectID | undefined;
  labels: Array<NormalizedSyncLabel>;
  resourceOptions?: BulkAddStatusPageMonitorResourceOptions | undefined;
}) => StatusPageMonitorRule | null;

export const buildMonitorRuleForLabelSync: BuildMonitorRuleForLabelSyncFunction =
  (data: {
    projectId: ObjectID;
    statusPageId: ObjectID;
    statusPageGroupId?: ObjectID | undefined;
    labels: Array<NormalizedSyncLabel>;
    resourceOptions?: BulkAddStatusPageMonitorResourceOptions | undefined;
  }): StatusPageMonitorRule | null => {
    /*
     * A rule with no criteria matches nothing and is refused by the server, so
     * there is no rule to write for an empty label list.
     */
    if (data.labels.length === 0) {
      return null;
    }

    const rule: StatusPageMonitorRule = new StatusPageMonitorRule();

    rule.projectId = data.projectId;
    rule.statusPageId = data.statusPageId;
    rule.name = buildMonitorRuleName(data.labels);
    rule.description =
      "Created from Status Page > Resources when monitors were added by label.";

    if (data.statusPageGroupId) {
      rule.statusPageGroupId = data.statusPageGroupId;
    }

    rule.isEnabled = true;

    rule.monitorLabels = data.labels.map((syncLabel: NormalizedSyncLabel) => {
      const label: Label = new Label();
      label.id = syncLabel.id;
      return label;
    });

    const resourceOptions: BulkAddStatusPageMonitorResourceOptions =
      data.resourceOptions || {};

    if (resourceOptions.showCurrentStatus !== undefined) {
      rule.showCurrentStatus = resourceOptions.showCurrentStatus;
    }

    if (resourceOptions.showUptimePercent !== undefined) {
      rule.showUptimePercent = resourceOptions.showUptimePercent;
    }

    if (resourceOptions.uptimePercentPrecision) {
      rule.uptimePercentPrecision = resourceOptions.uptimePercentPrecision;
    }

    if (resourceOptions.showStatusHistoryChart !== undefined) {
      rule.showStatusHistoryChart = resourceOptions.showStatusHistoryChart;
    }

    return rule;
  };

export type AddStatusPageMonitorsWithLabelSyncFunction = (
  options: AddStatusPageMonitorsWithLabelSyncOptions,
) => Promise<AddStatusPageMonitorsWithLabelSyncResult>;

export const addStatusPageMonitorsWithLabelSync: AddStatusPageMonitorsWithLabelSyncFunction =
  async (
    options: AddStatusPageMonitorsWithLabelSyncOptions,
  ): Promise<AddStatusPageMonitorsWithLabelSyncResult> => {
    const bulkResult: BulkAddStatusPageMonitorsResult = await options.bulkAdd({
      monitors: options.monitors,
      projectId: options.projectId,
      statusPageId: options.statusPageId,
      statusPageGroupId: options.statusPageGroupId,
      rowAxisValue: options.rowAxisValue,
      columnAxisValue: options.columnAxisValue,
      resourceOptions: options.resourceOptions,
    });

    const result: AddStatusPageMonitorsWithLabelSyncResult = {
      succeeded: bulkResult.succeeded,
      failed: bulkResult.failed,
      monitorRule: null,
      monitorRuleError: null,
    };

    if (!options.keepInSyncWithLabels) {
      return result;
    }

    /*
     * A group drawn as a grid places each resource in a row/column cell, and
     * the public page skips any resource in such a group that has neither -
     * getGridForGroup drops it, so it is on the page in the database and
     * rendered nowhere. StatusPageMonitorRule has no axis columns, and the
     * engine's createResource sets none, so every monitor a rule added here
     * later would be invisible. Refusing the rule is the honest half of that:
     * the caller does not offer the toggle for a grid group either, so this is
     * the guarantee rather than the message.
     */
    if (options.rowAxisValue || options.columnAxisValue) {
      return result;
    }

    const rule: StatusPageMonitorRule | null = buildMonitorRuleForLabelSync({
      projectId: options.projectId,
      statusPageId: options.statusPageId,
      statusPageGroupId: options.statusPageGroupId,
      labels: normalizeSyncLabels(options.syncLabels),
      resourceOptions: options.resourceOptions,
    });

    if (!rule) {
      return result;
    }

    /*
     * Reported whether or not the write lands, so a caller that has to explain
     * the failure can still name the labels it was for.
     */
    result.monitorRule = rule;

    try {
      await options.createMonitorRule(rule);
    } catch (error) {
      result.monitorRuleError = error;
    }

    return result;
  };

export default addStatusPageMonitorsWithLabelSync;
