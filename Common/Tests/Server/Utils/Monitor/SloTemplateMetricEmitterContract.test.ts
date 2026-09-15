import Label from "../../../../Models/DatabaseModels/Label";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import logger from "../../../../Server/Utils/Logger";
import SloMetricUtil from "../../../../Server/Utils/Slo/SloMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import AlertMetricType from "../../../../Types/Alerts/AlertMetricType";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../../Types/Dashboard/DashboardTemplates";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../../Types/Dashboard/DashboardViewConfig";
import Dictionary from "../../../../Types/Dictionary";
import IncidentMetricType from "../../../../Types/Incident/IncidentMetricType";
import { JSONObject } from "../../../../Types/JSON";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import ObjectID from "../../../../Types/ObjectID";
import SloMetricType from "../../../../Types/ServiceLevelObjective/SloMetricType";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { SLO_LIST_ATTRIBUTE_TO_COLUMN } from "../../../../Utils/Slo/SloListWidgetFormat";
import SloMetricTypeUtil, {
  SLO_METRIC_SLO_NAME_ATTRIBUTE,
} from "../../../../Utils/Slo/SloMetricType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The SLO dashboard template queries metric series by NAME, fans them out and
 * scopes them by one attribute KEY, and labels them with a UNIT. None of the
 * three is checked by the compiler across the two sides: the template spells
 * them, and SloMetricUtil — called by the evaluation worker — decides what
 * actually lands in the metric store. Rename either side and nothing fails to
 * compile; the dashboard just renders empty charts, an empty toolbar picker,
 * or numbers under the wrong unit, in every project.
 *
 * So this suite drives the template side from getTemplateConfig and the
 * emitter side from the REAL SloMetricUtil.saveSloMetrics (never from source
 * text), and asserts they still meet:
 *
 *   - every `oneuptime.slo.*` series the template queries is written,
 *   - with the BARE `sloName` attribute the toolbar variable binds to, the
 *     charts group by, and the SLO List maps to its name column,
 *   - published in `attributeKeys`, which is what the variable picker reads,
 *   - under the unit the template prints and the aggregation it charts with.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SLO_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const LABEL_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const SLO_NAME: string = "Checkout API";

/*
 * The spellings that fail SILENTLY: a `resource.`-prefixed key (what collector
 * resource attributes carry) offers an empty picker, and `sloId` would offer
 * UUIDs and match no SLO name.
 */
const PREFIXED_SLO_NAME_KEY: string = "resource.sloName";

// -- Template-side helpers (read from getTemplateConfig, never literals) ----

type WidgetArguments = Record<string, unknown>;

function sloTemplateConfig(): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Slo,
  );
  expect(config).not.toBeNull();
  return config as DashboardViewConfig;
}

function argumentsOf(component: DashboardBaseComponent): WidgetArguments {
  return (component.arguments as WidgetArguments | undefined) || {};
}

function metricQueryConfigOf(
  component: DashboardBaseComponent,
): WidgetArguments {
  return (
    (argumentsOf(component)["metricQueryConfig"] as
      | WidgetArguments
      | undefined) || {}
  );
}

function queryDataOf(component: DashboardBaseComponent): WidgetArguments {
  return (
    (metricQueryConfigOf(component)["metricQueryData"] as
      | WidgetArguments
      | undefined) || {}
  );
}

function filterDataOf(component: DashboardBaseComponent): WidgetArguments {
  return (
    (queryDataOf(component)["filterData"] as WidgetArguments | undefined) || {}
  );
}

function metricNameOf(component: DashboardBaseComponent): string | undefined {
  const value: unknown = filterDataOf(component)["metricName"];

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Only Chart widgets keep metricAliasData; tiles take their unit from the catalog.
function legendUnitOf(component: DashboardBaseComponent): string | undefined {
  const aliasData: WidgetArguments =
    (metricQueryConfigOf(component)["metricAliasData"] as
      | WidgetArguments
      | undefined) || {};
  const value: unknown = aliasData["legendUnit"];

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function metricWidgets(): Array<DashboardBaseComponent> {
  return sloTemplateConfig().components.filter(
    (component: DashboardBaseComponent): boolean => {
      return metricNameOf(component) !== undefined;
    },
  );
}

// Every distinct metric series the shipped SLO template asks for.
function metricNamesQueriedBySloTemplate(): Array<string> {
  return Array.from(
    new Set(
      metricWidgets().map((component: DashboardBaseComponent): string => {
        return metricNameOf(component) as string;
      }),
    ),
  ).sort();
}

// The attribute key the template's one toolbar variable scopes by.
function sloVariableAttributeKey(): string {
  const telemetryVariables: Array<DashboardVariable> = (
    sloTemplateConfig().variables || []
  ).filter((variable: DashboardVariable): boolean => {
    return variable.type === DashboardVariableType.TelemetryAttribute;
  });

  expect(telemetryVariables).toHaveLength(1);

  const attributeKey: string | undefined = telemetryVariables[0]?.attributeKey;

  expect(typeof attributeKey).toBe("string");

  return attributeKey as string;
}

// -- Emitter-side helpers --------------------------------------------------

function attributesOfRow(row: JSONObject): JSONObject {
  return (row["attributes"] as JSONObject | undefined) || {};
}

function attributeKeysOfRow(row: JSONObject): Array<string> {
  return (row["attributeKeys"] as Array<string> | undefined) || [];
}

function rowsNamed(
  rows: Array<JSONObject>,
  metricName: string,
): Array<JSONObject> {
  return rows.filter((row: JSONObject): boolean => {
    return row["name"] === metricName;
  });
}

describe("SLO template metric emitter contract", () => {
  let insertedRows: Array<JSONObject>;
  let indexedMetricTypes: Dictionary<MetricType>;

  beforeEach(() => {
    insertedRows = [];
    indexedMetricTypes = {};

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertedRows.push(...rows);
      });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          Object.assign(indexedMetricTypes, data.metricNameServiceNameMap);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * One evaluation, exactly as the worker hands it over: a named, labelled SLO
   * with a finite value for every series.
   */
  async function saveEvaluation(
    overrides: { sloName?: string | undefined } = {},
  ): Promise<void> {
    const label: Label = new Label();
    label._id = LABEL_ID.toString();
    label.id = LABEL_ID;
    label.name = "team";

    await SloMetricUtil.saveSloMetrics({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      sloName: "sloName" in overrides ? overrides.sloName : SLO_NAME,
      labels: [label],
      values: {
        [SloMetricType.SliPercent]: 99.95,
        [SloMetricType.TargetPercent]: 99.9,
        [SloMetricType.ErrorBudgetRemainingPercent]: 42.5,
        [SloMetricType.ErrorBudgetRemainingSeconds]: 3600,
        [SloMetricType.BurnRate]: 1.25,
        [SloMetricType.Status]: 0,
      },
    });
  }

  describe("the series the template asks for", () => {
    /*
     * A series added to or removed from the template is a decision: whoever
     * makes it comes here and proves the emitter writes it, with the key the
     * toolbar variable binds to.
     */
    test("queries exactly the budget and burn series, and nothing else", () => {
      expect(metricNamesQueriedBySloTemplate()).toEqual(
        [
          SloMetricType.BurnRate,
          SloMetricType.ErrorBudgetRemainingPercent,
          SloMetricType.ErrorBudgetRemainingSeconds,
        ].sort(),
      );
    });

    /*
     * Monitor, incident and alert series carry monitor keys and never
     * `sloName`, so the SLO variable would leave them showing the whole
     * project under a toolbar naming one SLO.
     */
    test("names every series through SloMetricType, and none through another catalog", () => {
      const queried: Array<string> = metricNamesQueriedBySloTemplate();
      const foreign: Array<string> = [
        ...Object.values(MonitorMetricType),
        ...Object.values(IncidentMetricType),
        ...Object.values(AlertMetricType),
      ];

      expect(queried.length).toBeGreaterThan(0);

      for (const metricName of queried) {
        expect(
          `${metricName}: SloMetricType=${(Object.values(SloMetricType) as Array<string>).includes(metricName)} foreign=${foreign.includes(metricName)}`,
        ).toBe(`${metricName}: SloMetricType=true foreign=false`);
      }
    });
  });

  describe("SloMetricUtil, the emitter the template queries", () => {
    test("writes every series the template queries", async () => {
      await saveEvaluation();

      for (const metricName of metricNamesQueriedBySloTemplate()) {
        expect(
          `${metricName}: rows emitted=${rowsNamed(insertedRows, metricName).length}`,
        ).toBe(`${metricName}: rows emitted=1`);
      }
    });

    test("stamps the BARE sloName the toolbar variable binds to, with the SLO's exact name", async () => {
      await saveEvaluation();

      const attributeKey: string = sloVariableAttributeKey();

      expect(attributeKey).toBe(SLO_METRIC_SLO_NAME_ATTRIBUTE);

      for (const metricName of metricNamesQueriedBySloTemplate()) {
        for (const row of rowsNamed(insertedRows, metricName)) {
          const attributes: JSONObject = attributesOfRow(row);

          expect(
            `${metricName}: ${attributeKey}=${String(attributes[attributeKey])}`,
          ).toBe(`${metricName}: ${attributeKey}=${SLO_NAME}`);

          const prefixedKeys: Array<string> = Object.keys(attributes).filter(
            (key: string): boolean => {
              return key.startsWith("resource.");
            },
          );

          expect(
            `${metricName}: resource-prefixed keys=${prefixedKeys.join(", ")}`,
          ).toBe(`${metricName}: resource-prefixed keys=`);
          expect(attributes[PREFIXED_SLO_NAME_KEY]).toBeUndefined();
        }
      }
    });

    /*
     * attributeKeys, not attributes, is what the variable's option list is
     * built from — a stamped-but-unpublished key offers an empty dropdown.
     */
    test("publishes the variable's key in attributeKeys, which the picker reads", async () => {
      await saveEvaluation();

      const attributeKey: string = sloVariableAttributeKey();

      for (const metricName of metricNamesQueriedBySloTemplate()) {
        for (const row of rowsNamed(insertedRows, metricName)) {
          expect(
            `${metricName}: ${attributeKey} in attributeKeys=${attributeKeysOfRow(row).includes(attributeKey)}`,
          ).toBe(`${metricName}: ${attributeKey} in attributeKeys=true`);
        }
      }
    });

    /*
     * Labels are merged onto the same attribute map. They must never clobber
     * the key the whole dashboard is scoped by.
     */
    test("keeps sloName intact when the SLO's labels are merged in", async () => {
      await saveEvaluation();

      for (const metricName of metricNamesQueriedBySloTemplate()) {
        const row: JSONObject = rowsNamed(
          insertedRows,
          metricName,
        )[0] as JSONObject;
        const attributes: JSONObject = attributesOfRow(row);

        expect(attributes[SLO_METRIC_SLO_NAME_ATTRIBUTE]).toBe(SLO_NAME);
        expect(
          Object.keys(attributes).some((key: string): boolean => {
            return key.startsWith("oneuptime.label.");
          }),
        ).toBe(true);
      }
    });

    test("groups each chart by keys every row of its series actually carries", async () => {
      await saveEvaluation();

      let checked: number = 0;

      for (const component of metricWidgets()) {
        const groupByKeys: Array<string> =
          (queryDataOf(component)["groupByAttributeKeys"] as
            | Array<string>
            | undefined) || [];

        if (groupByKeys.length === 0) {
          continue;
        }

        const metricName: string = metricNameOf(component) as string;

        for (const row of rowsNamed(insertedRows, metricName)) {
          for (const key of groupByKeys) {
            checked++;
            expect(
              `${metricName}: groups by ${key}, carried=${attributeKeysOfRow(row).includes(key)}`,
            ).toBe(`${metricName}: groups by ${key}, carried=true`);
          }
        }
      }

      expect(checked).toBeGreaterThan(0);
    });

    /*
     * The SLO List reads Postgres, not the metric store — the toolbar reaches
     * it only because its column map claims the SAME key the emitter writes.
     */
    test("writes the key the SLO List maps to its name column", async () => {
      await saveEvaluation();

      const attributeKey: string = sloVariableAttributeKey();

      expect(SLO_LIST_ATTRIBUTE_TO_COLUMN[attributeKey]).toBe("name");
      expect(attributesOfRow(insertedRows[0] as JSONObject)[attributeKey]).toBe(
        SLO_NAME,
      );
    });

    test("declares the same unit the template prints beside each chart", async () => {
      await saveEvaluation();

      let compared: number = 0;

      for (const component of metricWidgets()) {
        const metricName: string = metricNameOf(component) as string;
        const legendUnit: string | undefined = legendUnitOf(component);

        if (!legendUnit) {
          continue;
        }

        compared++;

        expect(
          `${metricName}: template legendUnit=${legendUnit}, emitted unit=${String(
            indexedMetricTypes[metricName]?.unit,
          )}, catalog unit=${SloMetricTypeUtil.getUnit(metricName as SloMetricType)}`,
        ).toBe(
          `${metricName}: template legendUnit=${legendUnit}, emitted unit=${legendUnit}, catalog unit=${legendUnit}`,
        );
      }

      // Without this the loop would pass by never running.
      expect(compared).toBeGreaterThan(0);
    });

    /*
     * The Value tiles carry no legendUnit: they print whatever unit the
     * MetricType row registers. So every series a tile reads must register a
     * real one — "%", "seconds" (scaled into minutes and hours), "x" — or the
     * tile prints a bare number that could be anything.
     */
    test("registers a unit for every series a tile totals", async () => {
      await saveEvaluation();

      const tileSeries: Array<string> = metricWidgets()
        .filter((component: DashboardBaseComponent): boolean => {
          return component.componentType === DashboardComponentType.Value;
        })
        .map((component: DashboardBaseComponent): string => {
          return metricNameOf(component) as string;
        });

      expect(tileSeries.length).toBeGreaterThan(0);

      for (const metricName of tileSeries) {
        expect(
          `${metricName}: unit=${String(indexedMetricTypes[metricName]?.unit)}`,
        ).toBe(
          `${metricName}: unit=${SloMetricTypeUtil.getUnit(metricName as SloMetricType)}`,
        );
        expect(
          String(indexedMetricTypes[metricName]?.unit).length,
        ).toBeGreaterThan(0);
      }
    });

    test("charts each series with the aggregation the catalog registers it under", () => {
      let compared: number = 0;

      for (const component of metricWidgets()) {
        if (component.componentType !== DashboardComponentType.Chart) {
          continue;
        }

        compared++;

        const metricName: SloMetricType = metricNameOf(
          component,
        ) as SloMetricType;

        expect(
          `${metricName}: ${String(filterDataOf(component)["aggegationType"])}`,
        ).toBe(
          `${metricName}: ${SloMetricTypeUtil.getAggregationType(metricName)}`,
        );
      }

      expect(compared).toBeGreaterThan(0);
    });

    /*
     * The rows are keyed to the SLO itself, not to one of its monitors — so the
     * series survive a monitor being swapped out of the objective, and telemetry
     * billing can tell them from customer telemetry.
     */
    test("keys every queried row to the SLO", async () => {
      await saveEvaluation();

      for (const metricName of metricNamesQueriedBySloTemplate()) {
        for (const row of rowsNamed(insertedRows, metricName)) {
          expect(row["primaryEntityId"]).toBe(SLO_ID.toString());
          expect(row["primaryEntityType"]).toBe(
            ServiceType.ServiceLevelObjective,
          );
          expect(attributesOfRow(row)["sloId"]).toBe(SLO_ID.toString());
          expect(attributesOfRow(row)["projectId"]).toBe(PROJECT_ID.toString());
        }
      }
    });

    /*
     * An evaluation that somehow carries no name posts no `sloName`, rather
     * than an empty-string value the picker would offer as a blank option.
     */
    test("stamps no sloName at all for a nameless evaluation", async () => {
      await saveEvaluation({ sloName: "   " });

      for (const metricName of metricNamesQueriedBySloTemplate()) {
        for (const row of rowsNamed(insertedRows, metricName)) {
          expect(
            Object.prototype.hasOwnProperty.call(
              attributesOfRow(row),
              SLO_METRIC_SLO_NAME_ATTRIBUTE,
            ),
          ).toBe(false);
        }
      }
    });
  });

  /*
   * Regression: SLO names are not unique within a project, and the fleet
   * charts grouped by `sloName` alone — so two objectives sharing a name, one
   * healthy and one overspent, were ONE line (the average of their budgets)
   * under one legend entry. The series name is built here exactly as
   * MetricCharts' buildQuerySeries builds it from the grouped attributes:
   * "key=value" segments joined by ", ".
   */
  describe("two SLOs that share a name", () => {
    const OTHER_SLO_ID: ObjectID = new ObjectID(
      "44444444-4444-4444-8444-444444444444",
    );

    type SeriesNameOfFunction = (
      row: JSONObject,
      groupByKeys: Array<string>,
    ) => string;

    const seriesNameOf: SeriesNameOfFunction = (
      row: JSONObject,
      groupByKeys: Array<string>,
    ): string => {
      return groupByKeys
        .map((key: string): string => {
          const value: unknown = attributesOfRow(row)[key];
          const displayValue: string =
            value === undefined || value === null || value === ""
              ? "(unset)"
              : String(value);

          return `${key}=${displayValue}`;
        })
        .join(", ");
    };

    test("stay two lines on every fleet chart, each still led by the name", async () => {
      for (const [sloId, budget] of [
        [SLO_ID, 90],
        [OTHER_SLO_ID, -20],
      ] as Array<[ObjectID, number]>) {
        await SloMetricUtil.saveSloMetrics({
          projectId: PROJECT_ID,
          sloId: sloId,
          sloName: SLO_NAME,
          values: {
            [SloMetricType.ErrorBudgetRemainingPercent]: budget,
            [SloMetricType.ErrorBudgetRemainingSeconds]: budget * 60,
            [SloMetricType.BurnRate]: budget > 0 ? 0.5 : 8,
          },
        });
      }

      let charts: number = 0;

      for (const component of metricWidgets()) {
        if (component.componentType !== DashboardComponentType.Chart) {
          continue;
        }

        charts++;

        const metricName: string = metricNameOf(component) as string;
        const groupByKeys: Array<string> =
          (queryDataOf(component)["groupByAttributeKeys"] as
            | Array<string>
            | undefined) || [];
        const seriesNames: Array<string> = Array.from(
          new Set(
            rowsNamed(insertedRows, metricName).map(
              (row: JSONObject): string => {
                return seriesNameOf(row, groupByKeys);
              },
            ),
          ),
        );

        expect(`${metricName}: ${seriesNames.length} series`).toBe(
          `${metricName}: 2 series`,
        );

        for (const seriesName of seriesNames) {
          expect(
            seriesName.startsWith(
              `${SLO_METRIC_SLO_NAME_ATTRIBUTE}=${SLO_NAME}`,
            ),
          ).toBe(true);
        }
      }

      expect(charts).toBeGreaterThan(0);
    });
  });

  /*
   * Regression: the toolbar picker lists the `sloName` values posted in the
   * last day. The worker posted nothing for an SLO it could only guard, so a
   * Paused, Misconfigured or never-measured SLO sat in the SLO List but could
   * never be picked. saveSloGuardMetrics is what the guard paths post.
   */
  describe("an SLO the worker can only guard (Paused, Misconfigured, not yet measured)", () => {
    type SaveGuardFunction = (overrides?: {
      targetPercentage?: number | null | undefined;
    }) => Promise<void>;

    const saveGuard: SaveGuardFunction = async (
      overrides: { targetPercentage?: number | null | undefined } = {},
    ): Promise<void> => {
      await SloMetricUtil.saveSloGuardMetrics({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        sloName: SLO_NAME,
        targetPercentage:
          "targetPercentage" in overrides ? overrides.targetPercentage : 99.9,
      });
    };

    test("still posts the key the picker lists, with the SLO's exact name", async () => {
      await saveGuard();

      const attributeKey: string = sloVariableAttributeKey();

      expect(insertedRows.length).toBeGreaterThan(0);

      for (const row of insertedRows) {
        expect(attributesOfRow(row)[attributeKey]).toBe(SLO_NAME);
        expect(attributeKeysOfRow(row)).toContain(attributeKey);
        expect(attributesOfRow(row)["sloId"]).toBe(SLO_ID.toString());
        expect(row["primaryEntityId"]).toBe(SLO_ID.toString());
        expect(row["primaryEntityType"]).toBe(
          ServiceType.ServiceLevelObjective,
        );
      }
    });

    /*
     * The target is configuration, true with or without a measurement. A
     * budget, burn rate or status point would chart a measurement that never
     * happened, and would feed the template's tiles and charts.
     */
    test("posts only the target, and nothing the template's widgets aggregate", async () => {
      await saveGuard();

      expect(
        insertedRows.map((row: JSONObject): unknown => {
          return row["name"];
        }),
      ).toEqual([SloMetricType.TargetPercent]);
      expect((insertedRows[0] as JSONObject)["value"]).toBe(99.9);

      for (const metricName of metricNamesQueriedBySloTemplate()) {
        expect(rowsNamed(insertedRows, metricName)).toHaveLength(0);
      }
    });

    test("writes nothing when there is no target to post", async () => {
      await saveGuard({ targetPercentage: null });

      expect(insertedRows).toHaveLength(0);
    });

    /*
     * The guard paths must still resolve open burn-rate alerts and record the
     * guard status, so a metric store failure is logged, never thrown.
     */
    test("never throws when the metric store fails", async () => {
      jest
        .spyOn(MetricService, "insertJsonRows")
        .mockRejectedValue(new Error("ClickHouse is down") as never);
      jest.spyOn(logger, "error").mockImplementation((): void => {
        // Silenced: the failure is the point of this test.
      });

      await expect(saveGuard()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
