import { DataCheckRunStatus } from "./DataCheckType";

/*
 * WHAT NEEDS SOMEONE IN DATA OBSERVABILITY, WORST FIRST.
 *
 * The Overview opens on the state of the project's data: what is broken,
 * late or drifting now, whether anyone has been told, and who owns it. Each
 * thing is one item of one of these kinds, told in this order - what leaves
 * the most unknown, and what people were promised, before what is merely
 * late:
 *
 *  1. a database that could not be read: none of its tables is watched
 *     until it is;
 *  2. a pipeline whose last run failed: what it writes is stale, or wrong;
 *  3. a check whose alert is open: the data says what it should not;
 *  4. a reconciliation whose two sides differ by more than their tolerance;
 *  5. a data product past what its consumers were promised;
 *  6. a table well past its usual rhythm without a change;
 *  7. a pipeline that has not started when it usually has;
 *  8. a check, or a reconciliation, that could not run: its query failed,
 *     so nothing is known of what it tests.
 *
 * Within a kind, what has been so for longest comes first. Kept free of the
 * server, so the Dashboard and the tests read the same order.
 */

export enum DataAttentionKind {
  CollectionFailed = "Collection Failed",
  PipelineFailed = "Pipeline Failed",
  CheckFailing = "Check Failing",
  ReconciliationDrifted = "Reconciliation Drifted",
  DataProductLate = "Data Product Late",
  TableLate = "Table Late",
  PipelineLate = "Pipeline Late",
  CheckCouldNotRun = "Check Could Not Run",
  ReconciliationCouldNotRun = "Reconciliation Could Not Run",
}

export const DATA_ATTENTION_KIND_ORDER: ReadonlyArray<DataAttentionKind> = [
  DataAttentionKind.CollectionFailed,
  DataAttentionKind.PipelineFailed,
  DataAttentionKind.CheckFailing,
  DataAttentionKind.ReconciliationDrifted,
  DataAttentionKind.DataProductLate,
  DataAttentionKind.TableLate,
  DataAttentionKind.PipelineLate,
  DataAttentionKind.CheckCouldNotRun,
  DataAttentionKind.ReconciliationCouldNotRun,
];

// The most items the Overview lists; the count says how many there are in all.
export const MAX_DATA_ATTENTION_ITEMS: number = 20;

// An open alert about the item: someone has been told.
export interface DataAttentionAlert {
  alertId: string;
  // As the alert is numbered, such as "ALT-12"; null for an alert without one.
  number: string | null;
  title: string;
}

export interface DataAttentionItem {
  kind: DataAttentionKind;
  // What it is about, by name: a table, a pipeline, a check, a database.
  name: string;
  // Where it lives: the database of a table, the table a check reads.
  where: string | null;
  // The project's own words about it, such as a failed run's error: shown as text.
  message: string | null;
  // How long a late one has been late; 0 for every other.
  overdueBySeconds: number;
  // Since when it has been so, ISO 8601; null when that is not known.
  since: string | null;
  // The record it is about, to open: the ones that apply are set.
  dataStoreId: string | null;
  dataAssetId: string | null;
  dataPipelineId: string | null;
  dataCheckId: string | null;
  dataProductId: string | null;
  dataReconciliationId: string | null;
  // The open alert about it that its reader may see; null when none is open.
  alert: DataAttentionAlert | null;
}

function rankOf(kind: DataAttentionKind): number {
  const rank: number = DATA_ATTENTION_KIND_ORDER.indexOf(kind);

  return rank === -1 ? DATA_ATTENTION_KIND_ORDER.length : rank;
}

function sinceOf(item: DataAttentionItem): number {
  const time: number = item.since ? new Date(item.since).getTime() : NaN;

  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

// Worst first: by kind, then the most overdue, then what has been so longest, then by name.
export function sortDataAttentionItems(
  items: Array<DataAttentionItem>,
): Array<DataAttentionItem> {
  return [...items].sort(
    (a: DataAttentionItem, b: DataAttentionItem): number => {
      return (
        rankOf(a.kind) - rankOf(b.kind) ||
        b.overdueBySeconds - a.overdueBySeconds ||
        sinceOf(a) - sinceOf(b) ||
        a.name.localeCompare(b.name)
      );
    },
  );
}

// How a check stands now, in a word.
export enum DataCheckHealth {
  // Its alert is open: the data broke what the check says.
  Failing = "Failing",
  // Its query failed last time, so nothing is known of what it tests.
  CouldNotRun = "Could Not Run",
  // It ran, and its alert is not open.
  Passing = "Passing",
  // It ran, and has no alert to say whether what it found is wrong.
  NoAlert = "No Alert",
  // It has not run yet.
  Waiting = "Waiting",
  // Turned off: it does not run.
  Off = "Off",
}

/*
 * What a dbt test's check holds of its last result (Server's DbtIngest):
 * dbt runs the test and decides, so "Failed" is the data failing it, and
 * "Errored" the test not running - where a check of OneUptime's own says
 * "Failed" when its query could not run.
 */
export const DBT_TEST_FAILED_STATUS: string = "Failed";
export const DBT_TEST_ERRORED_STATUS: string = "Errored";

export function getDataCheckHealth(data: {
  isEnabled: boolean | undefined | null;
  lastRunAt: Date | string | undefined | null;
  lastRunStatus: string | undefined | null;
  // A dbt test's result is dbt's verdict, with or without an alert.
  isDbtTest?: boolean | undefined;
  hasAlert: boolean;
  hasOpenAlert: boolean;
}): DataCheckHealth {
  if (data.isEnabled === false) {
    return DataCheckHealth.Off;
  }

  // An open alert is the check failing, whatever its last run: someone is told.
  if (data.hasOpenAlert) {
    return DataCheckHealth.Failing;
  }

  if (data.isDbtTest) {
    if (data.lastRunStatus === DBT_TEST_FAILED_STATUS) {
      return DataCheckHealth.Failing;
    }

    if (data.lastRunStatus === DBT_TEST_ERRORED_STATUS) {
      return DataCheckHealth.CouldNotRun;
    }

    return data.lastRunAt ? DataCheckHealth.Passing : DataCheckHealth.Waiting;
  }

  if (data.lastRunStatus === DataCheckRunStatus.Failed) {
    return DataCheckHealth.CouldNotRun;
  }

  if (!data.lastRunAt) {
    return DataCheckHealth.Waiting;
  }

  return data.hasAlert ? DataCheckHealth.Passing : DataCheckHealth.NoAlert;
}

// What a check's status answer holds, per check (DataObservabilityApiTypes' checkHealth route).
export interface DataCheckHealthAnswer {
  health: DataCheckHealth;
  alert: DataAttentionAlert | null;
}

/*
 * HOW FAR A PROJECT HAS SET DATA OBSERVABILITY UP.
 *
 * Connecting a database watches its tables, but nothing tells anyone about
 * them until alerts are on - and an alert is a monitor, one a person turns
 * on (it may be billed), so it is never made behind their back. Owners say
 * who hears; checks test what the data says; pipelines show what writes it.
 * The Overview lists these steps, each done or to do, until all are done or
 * someone hides them.
 */
export interface DataObservabilitySetup {
  // Watched databases, and how many have at least one alert on.
  storeCount: number;
  storesWithAlertsCount: number;
  // The first watched database without an alert: where turning them on starts.
  firstStoreWithoutAlertsId: string | null;
  checkCount: number;
  pipelineCount: number;
  // The owners named on tables (people and teams), and owner rules: either names who hears.
  tableOwnerCount: number;
  ownerRuleCount: number;
}

export enum DataObservabilitySetupStep {
  Connect = "connect",
  Alerts = "alerts",
  Owners = "owners",
  Checks = "checks",
  Pipelines = "pipelines",
}

export interface DataObservabilitySetupStepState {
  step: DataObservabilitySetupStep;
  isDone: boolean;
}

export function getDataObservabilitySetupSteps(
  setup: DataObservabilitySetup,
): Array<DataObservabilitySetupStepState> {
  return [
    {
      step: DataObservabilitySetupStep.Connect,
      isDone: setup.storeCount > 0,
    },
    {
      step: DataObservabilitySetupStep.Alerts,
      isDone:
        setup.storeCount > 0 && setup.storesWithAlertsCount >= setup.storeCount,
    },
    {
      step: DataObservabilitySetupStep.Owners,
      isDone: setup.tableOwnerCount > 0 || setup.ownerRuleCount > 0,
    },
    {
      step: DataObservabilitySetupStep.Checks,
      isDone: setup.checkCount > 0,
    },
    {
      step: DataObservabilitySetupStep.Pipelines,
      isDone: setup.pipelineCount > 0,
    },
  ];
}

// A setup the Overview can read even from a server that sends none.
export const EMPTY_DATA_OBSERVABILITY_SETUP: DataObservabilitySetup = {
  storeCount: 0,
  storesWithAlertsCount: 0,
  firstStoreWithoutAlertsId: null,
  checkCount: 0,
  pipelineCount: 0,
  tableOwnerCount: 0,
  ownerRuleCount: 0,
};
