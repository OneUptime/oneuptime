import { describe, expect, test } from "@jest/globals";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import {
  isTelemetryIngestionTeamLabelBudgetScope,
  isTelemetryIngestionTeamLabelBudgetSignal,
  readTelemetryIngestionBudgetStatus,
  resolveTelemetryIngestionTeamLabelBudget,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS,
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetStatus,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import {
  countOtlpLogRecords,
  countOtlpMetricPoints,
  countOtlpProfiles,
  countOtlpSpans,
} from "../../../Utils/Telemetry/OtlpRecordCount";

/*
 * A team's or a label's ingestion budget (issue #6386), as the types have
 * it: the signals it budgets, the budget in force - its own, held to the
 * project's - and what the Dashboard reads back of the status API's
 * teamsAndLabels. And the OTLP record counts a batch's bytes are shared out
 * over its resources by.
 */

const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;

describe("the signals a team or a label budgets", () => {
  test("are logs, traces, metrics and profiles: whatever is filed under a service", () => {
    expect([...TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS]).toEqual([
      ProductType.Logs,
      ProductType.Traces,
      ProductType.Metrics,
      ProductType.Profiles,
    ]);
    expect(isTelemetryIngestionTeamLabelBudgetSignal(ProductType.Logs)).toBe(
      true,
    );
    expect(
      isTelemetryIngestionTeamLabelBudgetSignal(ProductType.SecurityEvents),
    ).toBe(false);
    expect(isTelemetryIngestionTeamLabelBudgetScope("team")).toBe(true);
    expect(isTelemetryIngestionTeamLabelBudgetScope("label")).toBe(true);
    expect(isTelemetryIngestionTeamLabelBudgetScope("project")).toBe(false);
  });
});

describe("resolveTelemetryIngestionTeamLabelBudget", () => {
  test("its own budget, when the project has none or a larger one", () => {
    expect(
      resolveTelemetryIngestionTeamLabelBudget({
        scope: TelemetryIngestionBudgetScope.Team,
        ownDailyBudgetInGB: 2,
        projectDailyBudget: { bytes: null, source: null },
      }),
    ).toEqual({
      bytes: 2 * GB,
      source: TelemetryIngestionBudgetLimitSource.Team,
    });
    expect(
      resolveTelemetryIngestionTeamLabelBudget({
        scope: TelemetryIngestionBudgetScope.Label,
        ownDailyBudgetInGB: 2,
        projectDailyBudget: {
          bytes: 10 * GB,
          source: TelemetryIngestionBudgetLimitSource.Instance,
        },
      }),
    ).toEqual({
      bytes: 2 * GB,
      source: TelemetryIngestionBudgetLimitSource.Label,
    });
  });

  test("held to the project's, when the project's is lower", () => {
    expect(
      resolveTelemetryIngestionTeamLabelBudget({
        scope: TelemetryIngestionBudgetScope.Team,
        ownDailyBudgetInGB: 50,
        projectDailyBudget: {
          bytes: 10 * GB,
          source: TelemetryIngestionBudgetLimitSource.Project,
        },
      }),
    ).toEqual({
      bytes: 10 * GB,
      source: TelemetryIngestionBudgetLimitSource.Project,
    });
  });

  test("none, without a budget of its own", () => {
    for (const own of [null, 0, -1]) {
      expect(
        resolveTelemetryIngestionTeamLabelBudget({
          scope: TelemetryIngestionBudgetScope.Team,
          ownDailyBudgetInGB: own,
          projectDailyBudget: {
            bytes: 10 * GB,
            source: TelemetryIngestionBudgetLimitSource.Instance,
          },
        }).bytes,
      ).toBe(null);
    }
  });
});

describe("the teams and labels of a status, as the Dashboard reads them", () => {
  const status: (teamsAndLabels: unknown) => TelemetryIngestionBudgetStatus = (
    teamsAndLabels: unknown,
  ): TelemetryIngestionBudgetStatus => {
    return readTelemetryIngestionBudgetStatus({
      dayStartsAt: "2026-11-09T00:00:00.000Z",
      resetsAt: "2026-11-10T00:00:00.000Z",
      resetTime: "00:00",
      timezone: "UTC",
      warningPercent: 80,
      countersAvailable: true,
      project: { scope: "project", signals: [] },
      ingestionKeys: [],
      teamsAndLabels: teamsAndLabels,
    })!;
  };

  test("keeps each team and label by its id, with its name and a label's colour", () => {
    const read: TelemetryIngestionBudgetStatus = status([
      { scope: "team", teamId: "t1", teamName: "Payments", signals: [] },
      {
        scope: "label",
        labelId: "l1",
        labelName: "production",
        labelColor: "#ff0000",
        signals: [],
      },
    ]);

    expect(read.teamsAndLabels).toEqual([
      {
        scope: TelemetryIngestionBudgetScope.Team,
        teamId: "t1",
        teamName: "Payments",
        signals: [],
      },
      {
        scope: TelemetryIngestionBudgetScope.Label,
        labelId: "l1",
        labelName: "production",
        labelColor: "#ff0000",
        signals: [],
      },
    ]);
  });

  test("an older server's answer, with none, has none", () => {
    expect(status(undefined).teamsAndLabels).toEqual([]);
    expect(status("not a list").teamsAndLabels).toEqual([]);
  });

  test("leaves out an entry that is not a team's or a label's, has no id, or comes twice", () => {
    const read: TelemetryIngestionBudgetStatus = status([
      { scope: "project", signals: [] },
      { scope: "ingestion-key", ingestionKeyId: "k", signals: [] },
      { scope: "team", signals: [] },
      { scope: "label", labelId: "  ", signals: [] },
      null,
      "team",
      { scope: "team", teamId: "t1", teamName: "first", signals: [] },
      { scope: "team", teamId: "t1", teamName: "second", signals: [] },
      // A label may share a team's id: they are told apart by scope.
      { scope: "label", labelId: "t1", signals: [] },
    ]);

    expect(
      read.teamsAndLabels.map(
        (scope: TelemetryIngestionBudgetScopeStatus): Array<unknown> => {
          return [scope.scope, scope.teamName];
        },
      ),
    ).toEqual([
      ["team", "first"],
      ["label", undefined],
    ]);
  });
});

describe("the OTLP records of a resource block", () => {
  test("counts each block's log records, spans and profiles across its scopes", () => {
    expect(
      countOtlpLogRecords({
        scopeLogs: [{ logRecords: [{}, {}] }, { logRecords: [{}] }],
      }),
    ).toBe(3);
    expect(countOtlpSpans({ scopeSpans: [{ spans: [{}, {}, {}, {}] }] })).toBe(
      4,
    );
    expect(countOtlpProfiles({ scopeProfiles: [{ profiles: [{}] }, {}] })).toBe(
      1,
    );
  });

  test("counts each metric's points, of every kind, and a metric with none as one", () => {
    expect(
      countOtlpMetricPoints({
        scopeMetrics: [
          {
            metrics: [
              { gauge: { dataPoints: [{}, {}] } },
              { sum: { dataPoints: [{}] } },
              { histogram: { dataPoints: [{}, {}, {}] } },
              { exponentialHistogram: { dataPoints: [{}] } },
              { summary: { dataPoints: [{}] } },
              { name: "no points" },
            ],
          },
        ],
      }),
    ).toBe(9);
  });

  test("counts nothing in what is not a block", () => {
    for (const block of [undefined, null, "x", 7, {}, { scopeLogs: "x" }]) {
      expect(countOtlpLogRecords(block)).toBe(0);
      expect(countOtlpSpans(block)).toBe(0);
      expect(countOtlpProfiles(block)).toBe(0);
      expect(countOtlpMetricPoints(block)).toBe(0);
    }

    expect(
      countOtlpLogRecords({ scopeLogs: [null, { logRecords: "x" }] }),
    ).toBe(0);
  });
});
