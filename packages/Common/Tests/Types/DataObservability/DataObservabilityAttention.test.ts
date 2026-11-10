import { describe, expect, test } from "@jest/globals";
import {
  DATA_ATTENTION_KIND_ORDER,
  DBT_TEST_ERRORED_STATUS,
  DBT_TEST_FAILED_STATUS,
  DataAttentionItem,
  DataAttentionKind,
  DataCheckHealth,
  DataObservabilitySetup,
  DataObservabilitySetupStep,
  DataObservabilitySetupStepState,
  EMPTY_DATA_OBSERVABILITY_SETUP,
  getDataCheckHealth,
  getDataObservabilitySetupSteps,
  sortDataAttentionItems,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import { DataCheckRunStatus } from "../../../Types/DataObservability/DataCheckType";

/*
 * WHAT NEEDS SOMEONE, WORST FIRST - AND WHETHER A CHECK PASSES.
 *
 * The Overview opens on what is broken, late or drifting. The order is the
 * point: a database nobody could read hides every table in it, so it comes
 * before any one late table, and a failed run before the lateness it
 * causes. A check's Status says Passing only when its alert says so - a
 * check whose query ran is not a check whose data passed.
 */

function item(
  kind: DataAttentionKind,
  name: string,
  extra: Partial<DataAttentionItem> = {},
): DataAttentionItem {
  return {
    kind,
    name,
    where: null,
    message: null,
    overdueBySeconds: 0,
    since: null,
    dataStoreId: null,
    dataAssetId: null,
    dataPipelineId: null,
    dataCheckId: null,
    dataProductId: null,
    dataReconciliationId: null,
    alert: null,
    ...extra,
  };
}

describe("the order things are told in", () => {
  test("every kind has its place, each once", () => {
    expect([...DATA_ATTENTION_KIND_ORDER].sort()).toEqual(
      Object.values(DataAttentionKind).sort(),
    );
    expect(new Set(DATA_ATTENTION_KIND_ORDER).size).toBe(
      DATA_ATTENTION_KIND_ORDER.length,
    );
  });

  test("what leaves the most unknown first, what could not run last", () => {
    expect(DATA_ATTENTION_KIND_ORDER).toEqual([
      DataAttentionKind.CollectionFailed,
      DataAttentionKind.PipelineFailed,
      DataAttentionKind.CheckFailing,
      DataAttentionKind.ReconciliationDrifted,
      DataAttentionKind.DataProductLate,
      DataAttentionKind.TableLate,
      DataAttentionKind.PipelineLate,
      DataAttentionKind.CheckCouldNotRun,
      DataAttentionKind.ReconciliationCouldNotRun,
    ]);
  });

  test("a mix is sorted by kind, whatever order it was found in", () => {
    const sorted: Array<DataAttentionItem> = sortDataAttentionItems([
      item(DataAttentionKind.CheckCouldNotRun, "nulls in email"),
      item(DataAttentionKind.TableLate, "public.orders", {
        overdueBySeconds: 600,
      }),
      item(DataAttentionKind.CollectionFailed, "warehouse"),
      item(DataAttentionKind.DataProductLate, "Finance dashboard"),
      item(DataAttentionKind.PipelineFailed, "nightly_load"),
      item(DataAttentionKind.CheckFailing, "no duplicate orders"),
    ]);

    expect(
      sorted.map((each: DataAttentionItem): string => {
        return each.name;
      }),
    ).toEqual([
      "warehouse",
      "nightly_load",
      "no duplicate orders",
      "Finance dashboard",
      "public.orders",
      "nulls in email",
    ]);
  });

  test("within a kind, the most overdue first", () => {
    const sorted: Array<DataAttentionItem> = sortDataAttentionItems([
      item(DataAttentionKind.TableLate, "a little late", {
        overdueBySeconds: 60,
      }),
      item(DataAttentionKind.TableLate, "a day late", {
        overdueBySeconds: 86_400,
      }),
      item(DataAttentionKind.TableLate, "an hour late", {
        overdueBySeconds: 3_600,
      }),
    ]);

    expect(
      sorted.map((each: DataAttentionItem): string => {
        return each.name;
      }),
    ).toEqual(["a day late", "an hour late", "a little late"]);
  });

  test("then what has been so longest, then by name; with no time, last", () => {
    const sorted: Array<DataAttentionItem> = sortDataAttentionItems([
      item(DataAttentionKind.PipelineFailed, "b_job"),
      item(DataAttentionKind.PipelineFailed, "today", {
        since: "2026-11-10T09:00:00.000Z",
      }),
      item(DataAttentionKind.PipelineFailed, "a_job"),
      item(DataAttentionKind.PipelineFailed, "yesterday", {
        since: "2026-11-09T09:00:00.000Z",
      }),
      item(DataAttentionKind.PipelineFailed, "bad time", { since: "never" }),
    ]);

    expect(
      sorted.map((each: DataAttentionItem): string => {
        return each.name;
      }),
    ).toEqual(["yesterday", "today", "a_job", "b_job", "bad time"]);
  });

  test("sorting leaves the list it was given as it was", () => {
    const given: Array<DataAttentionItem> = [
      item(DataAttentionKind.TableLate, "late"),
      item(DataAttentionKind.CollectionFailed, "failed"),
    ];

    sortDataAttentionItems(given);

    expect(given[0]!.name).toBe("late");
  });

  test("a kind a newer server sends goes after every known one", () => {
    const sorted: Array<DataAttentionItem> = sortDataAttentionItems([
      item("Something New" as DataAttentionKind, "new"),
      item(DataAttentionKind.ReconciliationCouldNotRun, "known"),
    ]);

    expect(sorted[0]!.name).toBe("known");
  });
});

describe("whether a check passes", () => {
  const RAN_AT: string = "2026-11-10T08:00:00.000Z";

  test("its alert open: failing - whatever its last run said", () => {
    for (const lastRunStatus of [
      DataCheckRunStatus.Ran,
      DataCheckRunStatus.Failed,
      null,
    ]) {
      expect(
        getDataCheckHealth({
          isEnabled: true,
          lastRunAt: RAN_AT,
          lastRunStatus,
          hasAlert: true,
          hasOpenAlert: true,
        }),
      ).toBe(DataCheckHealth.Failing);
    }
  });

  test("ran, with its alert not open: passing", () => {
    expect(
      getDataCheckHealth({
        isEnabled: true,
        lastRunAt: RAN_AT,
        lastRunStatus: DataCheckRunStatus.Ran,
        hasAlert: true,
        hasOpenAlert: false,
      }),
    ).toBe(DataCheckHealth.Passing);
  });

  test("ran with no alert: it ran, and nothing says whether it passed", () => {
    expect(
      getDataCheckHealth({
        isEnabled: undefined,
        lastRunAt: RAN_AT,
        lastRunStatus: DataCheckRunStatus.Ran,
        hasAlert: false,
        hasOpenAlert: false,
      }),
    ).toBe(DataCheckHealth.NoAlert);
  });

  test("its query failed: could not run, even with an alert", () => {
    expect(
      getDataCheckHealth({
        isEnabled: true,
        lastRunAt: RAN_AT,
        lastRunStatus: DataCheckRunStatus.Failed,
        hasAlert: true,
        hasOpenAlert: false,
      }),
    ).toBe(DataCheckHealth.CouldNotRun);
  });

  test("never run: waiting", () => {
    expect(
      getDataCheckHealth({
        isEnabled: true,
        lastRunAt: null,
        lastRunStatus: null,
        hasAlert: true,
        hasOpenAlert: false,
      }),
    ).toBe(DataCheckHealth.Waiting);
  });

  test("turned off: off, before anything else", () => {
    expect(
      getDataCheckHealth({
        isEnabled: false,
        lastRunAt: RAN_AT,
        lastRunStatus: DataCheckRunStatus.Failed,
        hasAlert: true,
        hasOpenAlert: true,
      }),
    ).toBe(DataCheckHealth.Off);
  });

  test("a dbt test: dbt's Failed is the data failing, its Errored a run that could not", () => {
    const dbt: (status: string | null) => DataCheckHealth = (
      status: string | null,
    ): DataCheckHealth => {
      return getDataCheckHealth({
        isEnabled: true,
        lastRunAt: status ? RAN_AT : null,
        lastRunStatus: status,
        isDbtTest: true,
        hasAlert: false,
        hasOpenAlert: false,
      });
    };

    expect(dbt(DBT_TEST_FAILED_STATUS)).toBe(DataCheckHealth.Failing);
    expect(dbt(DBT_TEST_ERRORED_STATUS)).toBe(DataCheckHealth.CouldNotRun);
    expect(dbt("Passed")).toBe(DataCheckHealth.Passing);
    expect(dbt("Warned")).toBe(DataCheckHealth.Passing);
    expect(dbt(null)).toBe(DataCheckHealth.Waiting);
  });

  test("a check of OneUptime's own says Failed when its query could not run: never failing by that alone", () => {
    expect(DataCheckRunStatus.Failed).toBe(DBT_TEST_FAILED_STATUS);
    expect(
      getDataCheckHealth({
        isEnabled: true,
        lastRunAt: RAN_AT,
        lastRunStatus: DataCheckRunStatus.Failed,
        isDbtTest: false,
        hasAlert: false,
        hasOpenAlert: false,
      }),
    ).toBe(DataCheckHealth.CouldNotRun);
  });
});

describe("the first steps", () => {
  function setup(
    extra: Partial<DataObservabilitySetup>,
  ): Array<DataObservabilitySetupStepState> {
    return getDataObservabilitySetupSteps({
      ...EMPTY_DATA_OBSERVABILITY_SETUP,
      ...extra,
    });
  }

  function done(
    steps: Array<DataObservabilitySetupStepState>,
  ): Array<DataObservabilitySetupStep> {
    return steps
      .filter((step: DataObservabilitySetupStepState): boolean => {
        return step.isDone;
      })
      .map((step: DataObservabilitySetupStepState) => {
        return step.step;
      });
  }

  test("five steps, in the order they are done", () => {
    expect(
      setup({}).map((step: DataObservabilitySetupStepState) => {
        return step.step;
      }),
    ).toEqual([
      DataObservabilitySetupStep.Connect,
      DataObservabilitySetupStep.Alerts,
      DataObservabilitySetupStep.Owners,
      DataObservabilitySetupStep.Checks,
      DataObservabilitySetupStep.Pipelines,
    ]);
  });

  test("nothing set up: nothing done - not even alerts, with no database to have them", () => {
    expect(done(setup({}))).toEqual([]);
  });

  test("a database connected, no alert on: connecting is done, alerts are not", () => {
    expect(done(setup({ storeCount: 1, storesWithAlertsCount: 0 }))).toEqual([
      DataObservabilitySetupStep.Connect,
    ]);
  });

  test("alerts are done only once every watched database has one", () => {
    expect(
      done(setup({ storeCount: 3, storesWithAlertsCount: 2 })),
    ).not.toContain(DataObservabilitySetupStep.Alerts);
    expect(done(setup({ storeCount: 3, storesWithAlertsCount: 3 }))).toContain(
      DataObservabilitySetupStep.Alerts,
    );
  });

  test("owners: named on a table, or by a rule", () => {
    expect(done(setup({ tableOwnerCount: 1 }))).toContain(
      DataObservabilitySetupStep.Owners,
    );
    expect(done(setup({ ownerRuleCount: 1 }))).toContain(
      DataObservabilitySetupStep.Owners,
    );
  });

  test("a check, and a pipeline", () => {
    expect(done(setup({ checkCount: 1, pipelineCount: 2 }))).toEqual([
      DataObservabilitySetupStep.Checks,
      DataObservabilitySetupStep.Pipelines,
    ]);
  });

  test("everything set up: every step done", () => {
    expect(
      done(
        setup({
          storeCount: 2,
          storesWithAlertsCount: 2,
          tableOwnerCount: 4,
          checkCount: 3,
          pipelineCount: 1,
        }),
      ),
    ).toHaveLength(5);
  });
});
