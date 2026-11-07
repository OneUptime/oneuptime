import { describe, expect, test } from "@jest/globals";
import Includes from "../../../Types/BaseDatabase/Includes";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import MetricQueryServices from "../../../Utils/Metrics/MetricQueryServices";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Issue #6266: a metric query that reads its metric for some telemetry
 * services only - the rows' service (primaryEntityId), which no attribute
 * filter can name - as a Metrics monitor limited to them reads it.
 */

const API: string = "11111111-1111-4111-8111-111111111111";
const CHECKOUT: string = "22222222-2222-4222-8222-222222222222";

const queryOf: (serviceIds?: unknown) => MetricQueryConfigData = (
  serviceIds?: unknown,
): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "http.server.duration",
        aggegationType: MetricsAggregationType.Avg,
        attributes: { "http.route": "/pay" },
        ...(serviceIds !== undefined
          ? { telemetryServiceIds: serviceIds }
          : {}),
      } as never,
    },
  };
};

describe("the services a query reads for", () => {
  test("each once, in order, trimmed; ObjectIDs as their ids", () => {
    expect(
      MetricQueryServices.normalize([
        ` ${API} `,
        new ObjectID(CHECKOUT),
        API,
        "",
        null,
        undefined,
        {},
        7,
      ]),
    ).toEqual([API, CHECKOUT, "7"]);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", API],
    ["a map", { 0: API }],
  ])("%s names no service", (_name: string, value: unknown) => {
    expect(MetricQueryServices.normalize(value)).toEqual([]);
  });

  test("a query without the filter reads every service", () => {
    expect(MetricQueryServices.getServiceIds(queryOf())).toEqual([]);
    expect(MetricQueryServices.getServiceIds(null)).toEqual([]);
    expect(
      MetricQueryServices.getServiceIds({} as MetricQueryConfigData),
    ).toEqual([]);
  });

  test("a query with it reads those", () => {
    expect(MetricQueryServices.getServiceIds(queryOf([API, CHECKOUT]))).toEqual(
      [API, CHECKOUT],
    );
  });
});

describe("setting the services a query reads for", () => {
  test("a copy that reads for them; the rest of the query as it was", () => {
    const query: MetricQueryConfigData = queryOf();
    const scoped: MetricQueryConfigData = MetricQueryServices.withServiceIds(
      query,
      [API],
    );

    expect(scoped).not.toBe(query);
    expect(scoped.metricQueryData.filterData).toEqual({
      ...query.metricQueryData.filterData,
      telemetryServiceIds: [API],
    });
    // The query handed in is left as it was.
    expect(Object.keys(query.metricQueryData.filterData)).not.toContain(
      "telemetryServiceIds",
    );
  });

  test("none takes the filter out", () => {
    const scoped: MetricQueryConfigData = MetricQueryServices.withServiceIds(
      queryOf([API]),
      [],
    );

    expect(Object.keys(scoped.metricQueryData.filterData)).not.toContain(
      "telemetryServiceIds",
    );
    expect(
      Object.keys(
        MetricQueryServices.withServiceIds(queryOf([]), undefined)
          .metricQueryData.filterData,
      ),
    ).not.toContain("telemetryServiceIds");
  });

  test("the very same query when it reads for exactly these already", () => {
    const query: MetricQueryConfigData = queryOf([API, CHECKOUT]);
    const bare: MetricQueryConfigData = queryOf();

    expect(MetricQueryServices.withServiceIds(query, [API, CHECKOUT])).toBe(
      query,
    );
    expect(MetricQueryServices.withServiceIds(bare, [])).toBe(bare);
    // Another order is another list.
    expect(MetricQueryServices.withServiceIds(query, [CHECKOUT, API])).not.toBe(
      query,
    );
  });
});

describe("what the metric store reads the rows with", () => {
  test("the rows' service among the query's services", () => {
    const filter: { primaryEntityId?: Includes } =
      MetricQueryServices.getServiceQuery(queryOf([API, CHECKOUT]));

    expect(filter.primaryEntityId).toBeInstanceOf(Includes);
    expect(filter.primaryEntityId!.values).toEqual([API, CHECKOUT]);
  });

  test("nothing for a query that reads every service, as before", () => {
    expect(MetricQueryServices.getServiceQuery(queryOf())).toEqual({});
    expect(MetricQueryServices.getServiceQuery(queryOf([]))).toEqual({});
    expect(MetricQueryServices.getServiceQuery(queryOf("garbage"))).toEqual({});
  });
});

describe("whatever a query holds (seeded)", () => {
  test("setting what it reads, it reads exactly that; nothing handed in changes", () => {
    const random: SeededRandom = seededRandom(6266);
    const pool: Array<string> = [API, CHECKOUT, "a", " b ", "", "c"];

    for (let round: number = 0; round < 300; round++) {
      const before: Array<string> = [];
      const after: Array<string> = [];
      for (let index: number = 0; index < random(4); index++) {
        before.push(pool[random(pool.length)]!);
      }
      for (let index: number = 0; index < random(4); index++) {
        after.push(pool[random(pool.length)]!);
      }

      const query: MetricQueryConfigData = queryOf(
        before.length > 0 ? before : undefined,
      );
      const snapshot: string = JSON.stringify(query);

      const scoped: MetricQueryConfigData = MetricQueryServices.withServiceIds(
        query,
        after,
      );

      expect(MetricQueryServices.getServiceIds(scoped)).toEqual(
        MetricQueryServices.normalize(after),
      );
      expect(scoped.metricQueryData.filterData.metricName).toBe(
        "http.server.duration",
      );
      expect(JSON.stringify(query)).toBe(snapshot);
    }
  });
});
