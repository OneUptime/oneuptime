import { describe, expect, test } from "@jest/globals";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import { buildQueryConfigsFromSerializedQueries } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricConfigReconstruct";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import Includes from "../../../Types/BaseDatabase/Includes";
import ServiceType from "../../../Types/Telemetry/ServiceType";

const RESOURCE_ID: string = "11111111-0000-4000-8000-000000000001";

function roundTrip(config: MetricQueryConfigData): MetricQueryConfigData {
  const params: Record<string, string> =
    MetricExplorerUrl.buildQueryParamsFromMetricViewData({
      queryConfigs: [config],
      formulaConfigs: [],
      startAndEndDate: null,
    });
  const parsed: Array<SerializedMetricQuery> =
    MetricExplorerUrl.parseMetricQueriesParam(
      params[MetricExplorerUrlParam.MetricQueries]!,
    );
  expect(parsed).toHaveLength(1);
  return buildQueryConfigsFromSerializedQueries(parsed)[0]!;
}

describe("metric event scope URL round trip", () => {
  test("preserves RUM identity without adding identifiers to the metric attribute filter", () => {
    const config: MetricQueryConfigData = {
      metricQueryData: {
        filterData: {
          metricName: "browser.page_load",
          attributes: { environment: "prod" },
        },
      },
      eventScope: {
        primaryEntityId: new Includes([RESOURCE_ID]),
        primaryEntityType: ServiceType.RealUserMonitor,
      },
    };
    const rebuilt: MetricQueryConfigData = roundTrip(config);
    expect(rebuilt.eventScope?.["primaryEntityId"]).toBeInstanceOf(Includes);
    expect(
      (rebuilt.eventScope?.["primaryEntityId"] as Includes).values,
    ).toEqual([RESOURCE_ID]);
    expect(rebuilt.eventScope?.["primaryEntityType"]).toBe(
      ServiceType.RealUserMonitor,
    );
    expect(rebuilt.metricQueryData.filterData.attributes).toEqual({
      environment: "prod",
    });
    expect(roundTrip(rebuilt).eventScope).toEqual(rebuilt.eventScope);
  });

  test("preserves all opaque inventory memberships through a share and reload", () => {
    const rebuilt: MetricQueryConfigData = roundTrip({
      metricQueryData: { filterData: { metricName: "cpu.usage" } },
      eventScope: { entityKeys: new Includes(["entity-a", "entity-b"]) },
    });
    expect((rebuilt.eventScope?.["entityKeys"] as Includes).values).toEqual([
      "entity-a",
      "entity-b",
    ]);
    expect(rebuilt.metricQueryData.filterData.attributes).toEqual({});
  });

  test("keeps an explicitly empty scope distinct from a project-wide view", () => {
    const rebuilt: MetricQueryConfigData = roundTrip({
      metricQueryData: { filterData: { metricName: "", attributes: {} } },
      eventScope: {},
    });
    expect(rebuilt.eventScope).toEqual({});
  });

  test.each([
    null,
    "bad-scope",
    { entityKeys: { nested: "invalid" } },
    { entityKeys: { _type: "Includes", value: [] } },
  ])(
    "sanitizing malformed scope %p cannot erase the explicit scope boundary",
    (eventScope: unknown) => {
      const parsed: Array<SerializedMetricQuery> =
        MetricExplorerUrl.parseMetricQueriesParam(
          JSON.stringify([{ metricName: "cpu.usage", eventScope }]),
        );
      expect(parsed[0]?.eventScope).toEqual({});
      expect(
        buildQueryConfigsFromSerializedQueries(parsed)[0]?.eventScope,
      ).toEqual({});
    },
  );

  test("older unscoped views stay unscoped", () => {
    const rebuilt: MetricQueryConfigData = roundTrip({
      metricQueryData: { filterData: { metricName: "cpu.usage" } },
    });
    expect(rebuilt.eventScope).toBeUndefined();
  });
});
