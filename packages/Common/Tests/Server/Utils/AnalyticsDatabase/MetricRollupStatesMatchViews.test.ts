import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../../Models/AnalyticsModels/Index";
import {
  METRIC_ROLLUP_STATE_COLUMNS,
  METRIC_ROLLUP_STATES_FROM_RAW_ROWS,
  METRIC_ROLLUP_VALUE,
} from "../../../../Server/Utils/AnalyticsDatabase/MetricRollupStates";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY METRIC ROLLUP ROLLS A MINUTE UP AS A SPLIT READ ROLLS ITS EDGES
 * (issue #11373).
 *
 * A check's window the one-minute rollups cannot serve whole is read from
 * their buckets for its whole minutes and from the raw rows for the partial
 * minute at each end, rolled up into the rollups' own states and merged as
 * one rollup (MetricService's split rollup source, MetricRollupStates). That
 * is only one rollup if every view rolls a minute up exactly so: the same
 * states of the same value, the same minute, and of the rows its key holds.
 * A view changed on its own would read differently in a window's edges than
 * in its middle; this fails first.
 */

// The metric rollups a read is served by: each a table its view fills from MetricItemV3.
const ROLLUP_TABLES: Array<string> = [
  AnalyticsTableName.MetricItemAggMV1m,
  AnalyticsTableName.MetricItemAggMV1mByHostV2,
  AnalyticsTableName.MetricItemAggMV1mByK8sCluster,
  AnalyticsTableName.MetricItemAggMV1mByContainer,
  AnalyticsTableName.MetricItemAggMV1mByService,
];

// The entity a per-entity rollup is keyed by: a column of the raw rows too.
const ENTITY_KEY_OF: Record<string, string | null> = {
  [AnalyticsTableName.MetricItemAggMV1m]: null,
  [AnalyticsTableName.MetricItemAggMV1mByHostV2]: "hostEntityKey",
  [AnalyticsTableName.MetricItemAggMV1mByK8sCluster]: "k8sClusterEntityKey",
  [AnalyticsTableName.MetricItemAggMV1mByContainer]: "containerEntityKey",
  [AnalyticsTableName.MetricItemAggMV1mByService]: "serviceEntityKey",
};

const SPACES: RegExp = /\s+/g;

function modelOf(tableName: string): AnalyticsBaseModel {
  const modelType: { new (): AnalyticsBaseModel } | undefined = (
    AnalyticsModels as Array<{ new (): AnalyticsBaseModel }>
  ).find((candidate: { new (): AnalyticsBaseModel }): boolean => {
    return new candidate().tableName === tableName;
  });

  expect(modelType).toBeDefined();
  return new modelType!();
}

function viewOf(tableName: string): string {
  const views: Array<{ query: string }> =
    (modelOf(tableName).materializedViews as Array<{ query: string }>) || [];

  expect(views).toHaveLength(1);
  return views[0]!.query.replace(SPACES, " ");
}

describe.each(ROLLUP_TABLES)("%s", (tableName: string) => {
  test("its view rolls the raw rows of a minute up into the split read's states, of the same value", () => {
    const view: string = viewOf(tableName);

    for (const state of METRIC_ROLLUP_STATES_FROM_RAW_ROWS) {
      expect(view).toContain(state);
    }

    expect(view).toContain("FROM MetricItemV3");
    expect(view).toContain(METRIC_ROLLUP_VALUE);
  });

  test("its buckets are the minute a raw row starts in", () => {
    expect(viewOf(tableName)).toContain("toStartOfMinute(time) AS bucketTime");
  });

  test("its table holds the states the split read selects, by those names", () => {
    const model: AnalyticsBaseModel = modelOf(tableName);

    for (const column of ["bucketTime", ...METRIC_ROLLUP_STATE_COLUMNS]) {
      expect(model.getTableColumn(column)).toBeTruthy();
    }
  });

  test("it rolls up only the rows its key holds, and the raw rows hold the same key", () => {
    const keyColumn: string | null = ENTITY_KEY_OF[tableName]!;
    const view: string = viewOf(tableName);

    if (!keyColumn) {
      // The project's rollup holds every row, grouped by what a read filters by.
      expect(view).not.toContain(" WHERE ");
      expect(view).toContain(
        "GROUP BY projectId, name, primaryEntityId, bucketTime",
      );
      return;
    }

    expect(view).toContain(`WHERE ${keyColumn} != ''`);
    expect(view).toContain(
      `GROUP BY projectId, name, ${keyColumn}, bucketTime`,
    );
    expect(
      modelOf(AnalyticsTableName.Metric).getTableColumn(keyColumn),
    ).toBeTruthy();
  });
});
