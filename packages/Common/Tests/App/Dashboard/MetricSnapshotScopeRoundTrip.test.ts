import { describe, expect, test } from "@jest/globals";
import { deriveTelemetrySnapshot } from "../../../../App/FeatureSet/Dashboard/src/Utils/TelemetrySnapshot";
import { sanitizeAttributeFilters } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics";
import MetricInvestigationQueryUtil, {
  MetricInvestigationQueries,
  MetricInvestigationQueriesUrlValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationQueries";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import MetricExplorerUrl, {
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import MetricTelemetrySnapshot from "../../../Utils/Monitor/MetricTelemetrySnapshot";

/*
 * Issue #6265: a snapshot's scope may hold operators - a Docker Swarm image
 * glob and an IoT fleet are a Wildcard, Swarm's tasks-only filter a NotNull.
 * Each one is followed here along the path it really takes: the worker's
 * read, the event's JSON column, the API's model JSON, the incident or
 * alert page's derivation, the metric fetch's filter, the investigation's
 * URL and Open in Metric Explorer. None of it may turn an operator into a
 * plain value, or drop it.
 */

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-07T10:00:00.000Z"),
  new Date("2026-11-07T10:05:00.000Z"),
);

const QUERY: MetricQueryConfigData = {
  metricAliasData: {
    metricVariable: "a",
    title: "CPU",
    description: "",
    legend: "",
    legendUnit: "",
  },
  metricQueryData: {
    filterData: {
      metricName: "container.cpu.utilization",
      aggegationType: MetricsAggregationType.Avg,
    } as never,
    groupByAttributeKeys: ["resource.container.name"],
  },
};

const SCOPE: () => Dictionary<unknown> = (): Dictionary<unknown> => {
  return {
    "resource.docker.swarm.cluster.name": "swarm-1",
    "resource.container.image.name": new Wildcard<string>(["nginx", "nginx@*"]),
    "resource.docker.swarm.task.id": new NotNull(),
    "resource.iot.fleet.name": new Wildcard<string>(["Sensors"]),
  };
};

function workerSnapshot(): TelemetryQuery {
  const response: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    startAndEndDate: WINDOW,
    metricResult: [],
    metricViewConfig: { queryConfigs: [QUERY], formulaConfigs: [] },
    queryAttributes: [SCOPE()],
  };

  return MetricTelemetrySnapshot.fromResponse(response);
}

// What the event's card charts: each query with its stored scope.
function chartedOf(
  derived: TelemetryQuery | null,
): Array<MetricQueryConfigData> {
  return MetricTelemetrySnapshot.applyScopes({
    queryConfigs: derived!.metricViewData!.queryConfigs,
    scopes: MetricTelemetrySnapshot.getStoredScopes(derived)!,
  });
}

// Stored (the JSON column), served (model JSON over HTTP), read by the page.
function throughTheApi(
  snapshot: TelemetryQuery,
  modelType: typeof Incident | typeof Alert,
): unknown {
  const stored: JSONObject = JSON.parse(JSON.stringify(snapshot));
  const model: Incident | Alert = new modelType();
  model.telemetryQuery = stored as unknown as TelemetryQuery;

  const served: JSONObject = JSON.parse(
    JSON.stringify(BaseModel.toJSON(model, modelType)),
  );

  return (BaseModel.fromJSONObject(served, modelType) as Incident | Alert)
    .telemetryQuery;
}

function expectScopeOperators(attributes: unknown): void {
  const map: Dictionary<unknown> = attributes as Dictionary<unknown>;

  expect(map["resource.docker.swarm.cluster.name"]).toBe("swarm-1");
  expect(map["resource.container.image.name"]).toBeInstanceOf(Wildcard);
  expect(
    (map["resource.container.image.name"] as Wildcard<string>).values,
  ).toEqual(["nginx", "nginx@*"]);
  expect(map["resource.docker.swarm.task.id"]).toBeInstanceOf(NotNull);
  expect(map["resource.iot.fleet.name"]).toBeInstanceOf(Wildcard);
  expect((map["resource.iot.fleet.name"] as Wildcard<string>).values).toEqual([
    "Sensors",
  ]);
}

describe.each([
  ["an incident", Incident],
  ["an alert", Alert],
])(
  "%s's snapshot",
  (_name: string, modelType: typeof Incident | typeof Alert) => {
    test("is read back by the page with every operator of its scope", () => {
      const derived: TelemetryQuery | null = deriveTelemetrySnapshot({
        storedTelemetryQuery: throughTheApi(workerSnapshot(), modelType),
        seriesLabels: undefined,
      }).telemetryQuery;

      // The query as the step keeps it, its scope beside it.
      expect(
        derived!.metricViewData!.queryConfigs[0]!.metricQueryData.filterData
          .attributes,
      ).toBeUndefined();
      expectScopeOperators(
        MetricTelemetrySnapshot.getStoredScopes(derived)![0],
      );
      expectScopeOperators(
        chartedOf(derived)[0]!.metricQueryData.filterData.attributes,
      );
      // The window comes back as dates.
      expect(
        derived!.metricViewData!.startAndEndDate!.startValue,
      ).toBeInstanceOf(Date);
    });

    test("narrowed to its own series by the page, keeps its scope beside the series", () => {
      const derived: TelemetryQuery | null = deriveTelemetrySnapshot({
        storedTelemetryQuery: throughTheApi(workerSnapshot(), modelType),
        seriesLabels: { "resource.container.name": "web.1.abc" },
      }).telemetryQuery;

      const attributes: Dictionary<unknown> = chartedOf(derived)[0]!
        .metricQueryData.filterData.attributes as Dictionary<unknown>;

      expect(attributes["resource.container.name"]).toBe("web.1.abc");
      expectScopeOperators(attributes);
    });
  },
);

describe("the card's reads and links keep the scope's operators", () => {
  const derivedQueries: () => MetricInvestigationQueries =
    (): MetricInvestigationQueries => {
      const derived: TelemetryQuery | null = deriveTelemetrySnapshot({
        storedTelemetryQuery: throughTheApi(workerSnapshot(), Incident),
        seriesLabels: undefined,
      }).telemetryQuery;

      return {
        queryConfigs: chartedOf(derived),
        formulaConfigs: derived!.metricViewData!.formulaConfigs,
      };
    };

  test("the metric fetch filters with them (a NotNull takes no value, and is kept)", () => {
    const filters: unknown = sanitizeAttributeFilters(
      derivedQueries().queryConfigs[0]!.metricQueryData.filterData
        .attributes as never,
    );

    expectScopeOperators(filters);
  });

  test("Edit metrics and Copy link: the investigation's URL keeps them", () => {
    const urlValue: MetricInvestigationQueriesUrlValue | null =
      MetricInvestigationQueryUtil.toUrlValue(derivedQueries());

    expect(urlValue).not.toBeNull();

    const readBack: MetricInvestigationQueries | null =
      MetricInvestigationQueryUtil.fromUrlValue(urlValue!);

    expectScopeOperators(
      readBack!.queryConfigs[0]!.metricQueryData.filterData.attributes,
    );
    // An untouched card's queries are its defaults: the same key.
    expect(
      MetricInvestigationQueryUtil.isSame(readBack, derivedQueries()),
    ).toBe(true);
  });

  test("Open in Metric Explorer carries them", () => {
    const params: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData({
        startAndEndDate: WINDOW,
        ...derivedQueries(),
      });

    const opened: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(params["metricQueries"]!);

    expectScopeOperators(opened[0]!.attributes);
  });
});
