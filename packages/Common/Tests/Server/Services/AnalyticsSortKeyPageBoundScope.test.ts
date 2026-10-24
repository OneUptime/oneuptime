import AnalyticsDatabaseService, {
  SORT_KEY_PAGE_BOUND_ALIAS,
  SORT_KEY_PAGE_VALUES_ALIAS,
} from "../../../Server/Services/AnalyticsDatabaseService";
import logger from "../../../Server/Utils/Logger";
import "../TestingUtils/Init";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../Types/GenericObject";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Where the sort-key page bound applies (AnalyticsDatabaseService
 * .toSortKeyPageBound, issue #4710), over every analytics model there is.
 *
 * Every list and API page of an analytics model goes through the same
 * find, so a change to the bound changes all of them at once. This pins,
 * table by table, which default lists get the bound, so a new model - or
 * a changed sort key, `_id` column or nullability - shows up here as a
 * decision rather than as a quiet change of query plan.
 *
 * And the statement names the bound `__sortKeyPage` and
 * `__sortKeyTopValues`: a model column of either name would be shadowed
 * by them, so none may exist, nor any column starting with two
 * underscores.
 */

type ModelType = { new (): AnalyticsBaseModel };

const MODELS_DIRECTORY: string = path.join(
  __dirname,
  "../../../Models/AnalyticsModels",
);

// Every model file in Models/AnalyticsModels, not only those a list registers.
const ALL_MODELS: Array<[string, ModelType]> = fs
  .readdirSync(MODELS_DIRECTORY)
  .filter((file: string): boolean => {
    return file.endsWith(".ts") && file !== "Index.ts";
  })
  .sort()
  .map((file: string): [string, ModelType] => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const loaded: { default: ModelType } = require(
      path.join(MODELS_DIRECTORY, file),
    );
    return [file.replace(".ts", ""), loaded.default];
  });

/*
 * The default list of each model, newest first: bounded or sent as
 * written. The aggregate targets carry no `_id`, so there is no tiebreaker
 * to pay for; ThreatIntelIndicator and MutableMetric sort by a column that
 * is not in their sorting key, which ClickHouse already plans as a top-N.
 */
const BOUNDED_DEFAULT_LISTS: Record<string, boolean> = {
  AuditLogV2: true,
  ChangeEventV1: true,
  ExceptionItemV3: true,
  KubernetesCostAllocationV1: true,
  LogCountBaseline: false,
  LogItemV3: true,
  MetricBaselineHourly: false,
  MetricItemAggMV1m: false,
  MetricItemAggMV1mByContainer: false,
  MetricItemAggMV1mByHostV2: false,
  MetricItemAggMV1mByK8sCluster: false,
  MetricItemAggMV1mByService: false,
  MetricItemV3: true,
  MonitorLogV3: true,
  MutableMetricItem: false,
  NetworkFlowV1: true,
  // Meraki's usage windows: sorted by project, kind and window, with an _id.
  NetworkTrafficUsageV1: true,
  ProfileItemV3: true,
  ProfileSampleItemV3: true,
  RumSessionChunkV1: true,
  RumSessionV1: true,
  SecurityEventItemV1: true,
  SloHistory: true,
  SpanCountBaseline: false,
  SpanItemV3: true,
  ThreatIntelIndicatorItemV1: false,
};

describe("the sort-key page bound across every analytics model", () => {
  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined!;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every model file is read", () => {
    expect(ALL_MODELS.length).toBeGreaterThanOrEqual(25);
    expect(
      ALL_MODELS.map(([file]: [string, ModelType]): string => {
        return file;
      }),
    ).toEqual(expect.arrayContaining(["Log", "Span", "Metric", "AuditLog"]));
  });

  test.each(ALL_MODELS)(
    "%s: no column is named like the bound, or starts with two underscores",
    (_file: string, modelType: ModelType) => {
      const keys: Array<string> = new modelType().tableColumns.map(
        (column: AnalyticsTableColumn): string => {
          return column.key;
        },
      );

      expect(
        keys.filter((key: string): boolean => {
          return (
            key.startsWith("__") ||
            key.toLowerCase() === SORT_KEY_PAGE_BOUND_ALIAS.toLowerCase() ||
            key.toLowerCase() === SORT_KEY_PAGE_VALUES_ALIAS.toLowerCase()
          );
        }),
      ).toEqual([]);
    },
  );

  test("each model's default list gets the bound exactly as listed", () => {
    const found: Record<string, boolean> = {};

    for (const [, modelType] of ALL_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const service: AnalyticsDatabaseService<AnalyticsBaseModel> =
        new AnalyticsDatabaseService({ modelType: modelType });

      const statement: string = service.toFindStatement({
        select: {} as GenericObject,
        query: {} as GenericObject,
        props: {} as GenericObject,
        sort: { [model.defaultSortColumn]: SortOrder.Descending },
        limit: 50,
        skip: 0,
      } as never).statement.query;

      found[model.tableName] = statement.startsWith("WITH (");
    }

    expect(found).toStrictEqual(BOUNDED_DEFAULT_LISTS);
  });

  /*
   * The bound is exact only on a key that is never NULL, and pays only on
   * one ClickHouse can read in order: every bounded list leads with a
   * required sorting-key column, behind a model with an `_id`.
   */
  test("every bounded list leads with a required sorting-key column of a model with an _id", () => {
    for (const [, modelType] of ALL_MODELS) {
      const model: AnalyticsBaseModel = new modelType();

      if (!BOUNDED_DEFAULT_LISTS[model.tableName]) {
        continue;
      }

      const lead: AnalyticsTableColumn | null = model.getTableColumn(
        model.defaultSortColumn,
      );

      expect([
        model.tableName,
        model.sortKeys.includes(model.defaultSortColumn),
        lead?.required,
        Boolean(model.getTableColumn("_id")),
      ]).toEqual([model.tableName, true, true, true]);
    }
  });
});
