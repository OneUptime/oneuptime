import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  DataAttentionItem,
  DataAttentionKind,
  DataObservabilitySetup,
  DataObservabilitySetupStep,
  EMPTY_DATA_OBSERVABILITY_SETUP,
} from "Common/Types/DataObservability/DataObservabilityAttention";
import {
  DataObservabilityOverview,
  DataObservabilityStoreSummary,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE WORDS AND THE WAY ON, FOR WHAT NEEDS SOMEONE.
 *
 * Each kind of item the Overview lists (DataObservabilityAttention) says,
 * in a word, what is wrong, then in a sentence what that means for the
 * data, and offers the one page where it is put right. The first steps
 * after connecting a database are worded here too, each with its page.
 * Kept free of React, so the words, the order and every page they open
 * can be pinned in plain tests.
 */

export enum AttentionTone {
  // Broken: something failed, or the data says what it should not.
  Danger = "danger",
  // Late: nothing failed, but it has not happened when it usually does.
  Warning = "warning",
}

export interface AttentionKindCopy {
  // In a word or two, on the item's pill.
  label: string;
  // What it means for the data, in a sentence.
  sentence: string;
  icon: IconProp;
  tone: AttentionTone;
  // The page where it is put right.
  actionTitle: string;
  // When it happened, worded for the kind: {{time}} is "3 hours ago".
  caption: string;
}

export const DATA_ATTENTION_COPY: Readonly<
  Record<DataAttentionKind, AttentionKindCopy>
> = {
  // Named as its database is in the Databases card and on its own page: "Collection failed".
  [DataAttentionKind.CollectionFailed]: {
    label: "Collection Failed",
    sentence:
      "OneUptime could not read this database, so none of its tables is watched until it can.",
    icon: IconProp.Database,
    tone: AttentionTone.Danger,
    actionTitle: "Open Database",
    caption: "Last tried {{time}}",
  },
  [DataAttentionKind.PipelineFailed]: {
    label: "Run Failed",
    sentence:
      "Its last run failed, so the tables it writes may be stale or wrong.",
    icon: IconProp.Workflow,
    tone: AttentionTone.Danger,
    actionTitle: "Open Pipeline",
    caption: "Failed {{time}}",
  },
  [DataAttentionKind.CheckFailing]: {
    label: "Failing",
    sentence: "The data broke this check, and its alert is open.",
    icon: IconProp.CheckCircle,
    tone: AttentionTone.Danger,
    actionTitle: "Open Checks",
    caption: "Last ran {{time}}",
  },
  [DataAttentionKind.ReconciliationDrifted]: {
    label: "Drifted",
    sentence: "Its two tables no longer agree by more than their tolerance.",
    icon: IconProp.Scale,
    tone: AttentionTone.Danger,
    actionTitle: "Open Reconciliations",
    caption: "Drifted {{time}}",
  },
  [DataAttentionKind.DataProductLate]: {
    label: "Late",
    sentence:
      "It is past what its consumers were promised: some of its tables are late.",
    icon: IconProp.Layers,
    tone: AttentionTone.Warning,
    actionTitle: "Open Data Product",
    caption: "Became late {{time}}",
  },
  [DataAttentionKind.TableLate]: {
    label: "Late",
    sentence: "It has gone well past its usual rhythm without a change.",
    icon: IconProp.Clock,
    tone: AttentionTone.Warning,
    actionTitle: "Open Table",
    caption: "Last changed {{time}}",
  },
  [DataAttentionKind.PipelineLate]: {
    label: "Late",
    sentence: "It has not started when it usually does.",
    icon: IconProp.Workflow,
    tone: AttentionTone.Warning,
    actionTitle: "Open Pipeline",
    caption: "Due {{time}}",
  },
  [DataAttentionKind.CheckCouldNotRun]: {
    label: "Could Not Run",
    sentence:
      "Its query failed, so nothing is known of what it tests until it runs.",
    icon: IconProp.Error,
    tone: AttentionTone.Warning,
    actionTitle: "Open Checks",
    caption: "Last tried {{time}}",
  },
  [DataAttentionKind.ReconciliationCouldNotRun]: {
    label: "Could Not Compare",
    sentence:
      "One of its sides could not be read, so the two tables were not compared.",
    icon: IconProp.Error,
    tone: AttentionTone.Warning,
    actionTitle: "Open Reconciliations",
    caption: "Failed {{time}}",
  },
};

// Whether an item is late, and so says by how much on its pill.
export function isLateKind(kind: DataAttentionKind): boolean {
  return (
    kind === DataAttentionKind.TableLate ||
    kind === DataAttentionKind.PipelineLate
  );
}

function routeOf(page: PageMap, modelId?: string | null): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[page] as Route,
    modelId ? { modelId: new ObjectID(modelId) } : undefined,
  );
}

// The page that puts an item right: its record's own page, or the list it is in.
export function getAttentionRoute(item: DataAttentionItem): Route {
  switch (item.kind) {
    case DataAttentionKind.CollectionFailed:
      return item.dataStoreId
        ? routeOf(PageMap.DATA_OBSERVABILITY_STORE_VIEW, item.dataStoreId)
        : routeOf(PageMap.DATA_OBSERVABILITY_STORES);
    case DataAttentionKind.PipelineFailed:
    case DataAttentionKind.PipelineLate:
      return item.dataPipelineId
        ? routeOf(PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW, item.dataPipelineId)
        : routeOf(PageMap.DATA_OBSERVABILITY_PIPELINES);
    case DataAttentionKind.CheckFailing:
    case DataAttentionKind.CheckCouldNotRun:
      return item.dataAssetId
        ? routeOf(
            PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS,
            item.dataAssetId,
          )
        : routeOf(PageMap.DATA_OBSERVABILITY_CHECKS);
    case DataAttentionKind.DataProductLate:
      return item.dataProductId
        ? routeOf(
            PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW,
            item.dataProductId,
          )
        : routeOf(PageMap.DATA_OBSERVABILITY_DATA_PRODUCTS);
    case DataAttentionKind.TableLate:
      return item.dataAssetId
        ? routeOf(PageMap.DATA_OBSERVABILITY_TABLE_VIEW, item.dataAssetId)
        : routeOf(PageMap.DATA_OBSERVABILITY_TABLES);
    case DataAttentionKind.ReconciliationDrifted:
    case DataAttentionKind.ReconciliationCouldNotRun:
    default:
      return routeOf(PageMap.DATA_OBSERVABILITY_RECONCILIATIONS);
  }
}

/*
 * Where an item's owners are named: a data product's Settings, whose Owner
 * Team it is, or its table's Owners page, for an item about a table.
 */
export function getAttentionOwnersRoute(item: DataAttentionItem): Route | null {
  if (item.dataProductId) {
    return routeOf(
      PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_SETTINGS,
      item.dataProductId,
    );
  }

  return item.dataAssetId
    ? routeOf(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_OWNERS, item.dataAssetId)
    : null;
}

export function getAlertRoute(alertId: string): Route {
  return routeOf(PageMap.ALERT_VIEW, alertId);
}

// A database's recommended alerts: where its alerts are turned on.
export function getStoreAlertsRoute(dataStoreId: string): Route {
  return routeOf(
    PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS,
    dataStoreId,
  );
}

export interface SetupStepCopy {
  title: string;
  description: string;
  linkText: string;
}

export const DATA_OBSERVABILITY_SETUP_COPY: Readonly<
  Record<DataObservabilitySetupStep, SetupStepCopy>
> = {
  [DataObservabilitySetupStep.Connect]: {
    title: "Connect a database",
    description:
      "Use a read-only login. OneUptime reads its catalog every few minutes: each table's rows, size, columns and when it last changed. No value leaves the database.",
    linkText: "Open Databases",
  },
  [DataObservabilitySetupStep.Alerts]: {
    title: "Turn on alerts",
    description:
      "Nobody is told when a table is late, loses rows or changes its columns until its database's recommended alerts are on. Each is a monitor you review and turn on.",
    linkText: "Set Up Alerts",
  },
  [DataObservabilitySetupStep.Owners]: {
    title: "Say who owns which tables",
    description:
      "A table's alert goes to its owners. Name them on a table, or let a rule name them for every table it matches.",
    linkText: "Open Owner Rules",
  },
  [DataObservabilitySetupStep.Checks]: {
    title: "Add a check",
    description:
      "Table health says when a table changed, not whether its values are right. A check tests what it holds: empty or repeated values, values outside a list, or a query of your own.",
    linkText: "Open Tables",
  },
  [DataObservabilitySetupStep.Pipelines]: {
    title: "Send your pipeline runs",
    description:
      "Send OpenLineage events from Airflow, dbt or Spark, or Fivetran and Airbyte webhooks, to see every run, the tables it writes, and which failure made a table late.",
    linkText: "Open Pipelines",
  },
};

export function getSetupStepRoute(
  step: DataObservabilitySetupStep,
  setup: DataObservabilitySetup,
): Route {
  switch (step) {
    case DataObservabilitySetupStep.Alerts:
      return setup.firstStoreWithoutAlertsId
        ? getStoreAlertsRoute(setup.firstStoreWithoutAlertsId)
        : routeOf(PageMap.DATA_OBSERVABILITY_STORES);
    case DataObservabilitySetupStep.Owners:
      return routeOf(PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULES);
    // A check is added on its table's Checks tab.
    case DataObservabilitySetupStep.Checks:
      return routeOf(PageMap.DATA_OBSERVABILITY_TABLES);
    case DataObservabilitySetupStep.Pipelines:
      return routeOf(PageMap.DATA_OBSERVABILITY_PIPELINES);
    case DataObservabilitySetupStep.Connect:
    default:
      return routeOf(PageMap.DATA_OBSERVABILITY_STORES);
  }
}

// Where dismissing the first steps is remembered, per project.
export function getSetupDismissedKey(projectId: string): string {
  return `data-observability-setup-hidden-${projectId}`;
}

function arrayOr<T>(value: unknown): Array<T> {
  return Array.isArray(value) ? (value as Array<T>) : [];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/*
 * The Overview as the page reads it, whatever the server sent: a server a
 * version behind sends no attention and no setup, and the page still says
 * what it can rather than failing.
 */
export function normalizeDataObservabilityOverview(
  raw: Partial<DataObservabilityOverview> | null | undefined,
): DataObservabilityOverview {
  const value: Partial<DataObservabilityOverview> = raw || {};
  const stores: Array<DataObservabilityStoreSummary> =
    arrayOr<DataObservabilityStoreSummary>(value.stores);
  const attention: Array<DataAttentionItem> = arrayOr<DataAttentionItem>(
    value.attention,
  );
  const setup: Partial<DataObservabilitySetup> =
    value.setup && typeof value.setup === "object" ? value.setup : {};

  return {
    storeCount: numberOr(value.storeCount, stores.length),
    assetCount: numberOr(value.assetCount, 0),
    lateAssetCount: numberOr(value.lateAssetCount, 0),
    droppedAssetCount: numberOr(value.droppedAssetCount, 0),
    unusedAssetCount: numberOr(value.unusedAssetCount, 0),
    unusedSizeInBytes: numberOr(value.unusedSizeInBytes, 0),
    schemaChangeCount: numberOr(value.schemaChangeCount, 0),
    failingStoreCount: numberOr(value.failingStoreCount, 0),
    lateAssets: arrayOr(value.lateAssets),
    recentChanges: arrayOr(value.recentChanges),
    stores,
    attention,
    attentionCount: numberOr(value.attentionCount, attention.length),
    failingCheckCount: numberOr(value.failingCheckCount, 0),
    setup: {
      ...EMPTY_DATA_OBSERVABILITY_SETUP,
      storeCount: stores.length,
      ...setup,
    },
  };
}

/*
 * Whether the server said what is set up: one a version behind does not, and
 * its first steps are then not shown rather than shown as all to do.
 */
export function isSetupKnown(
  raw: Partial<DataObservabilityOverview> | null | undefined,
): boolean {
  return Boolean(raw && raw.setup && typeof raw.setup === "object");
}

// Whether the server said how many alerts a database has: one a version behind does not.
export function hasAlertCount(store: DataObservabilityStoreSummary): boolean {
  return (
    typeof store.alertMonitorCount === "number" &&
    Number.isFinite(store.alertMonitorCount)
  );
}
