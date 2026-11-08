import PublicDashboardMetricServices, {
  PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE,
  PublicDashboardMetricSavedServices,
} from "../../../../Server/Utils/Dashboard/PublicDashboardMetricServices";
import PublicDashboardViewConfig from "../../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6280: THE SERVICES A PUBLIC DASHBOARD'S CHART READS ARE THE ONES IT
 * WAS SAVED WITH.
 *
 * The public metrics endpoint answers anyone holding a public dashboard's
 * link. A chart saved with a service filter (#6266) charts those services
 * only, so the endpoint reads a metric for the services a saved query of it
 * names - and only when the request names exactly one such query. These
 * tests hold the policy to that from both sides: every saved query reads as
 * saved, and nothing a request can say reads anything else.
 */

// Service ids with letters in them, so a change of case is a change of id.
const API: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CHECKOUT: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const BILLING: string = "3b241101-e2bb-4255-8caf-4136c566a962";
const FOREIGN: string = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const LATENCY: string = "http.server.duration";
const CPU: string = "system.cpu.utilization";
const UNCHARTED: string = "billing.revenue.total";

// A query as a chart saves it: its metric and, when it has some, its services.
function savedQuery(
  metricName: unknown,
  telemetryServiceIds?: unknown,
): JSONObject {
  return {
    metricAliasData: { metricVariable: "a" },
    metricQueryData: {
      filterData: {
        metricName: metricName as JSONValue,
        aggegationType: "Avg",
        ...(telemetryServiceIds !== undefined
          ? { telemetryServiceIds: telemetryServiceIds as JSONValue }
          : {}),
      },
    },
  };
}

// A chart widget of these queries, stored as Add to dashboard stores one.
function chart(...queries: Array<JSONObject>): JSONObject {
  return {
    _type: "DashboardComponent",
    componentType: DashboardComponentType.Chart,
    componentId: ObjectID.generate().toString(),
    arguments: {
      metricQueryConfig: queries[0] || null,
      ...(queries.length > 1 ? { metricQueryConfigs: queries.slice(1) } : {}),
    },
  };
}

function dashboardOf(...components: Array<JSONObject>): JSONObject {
  return {
    _type: "DashboardViewConfig",
    heightInDashboardUnits: 24,
    components: components,
  };
}

/*
 * A query's services as the client sends them (MetricQueryServices
 * getServiceQuery) and the route reads them: serialized, sent as JSON and
 * deserialized.
 */
function overTheWire(value: unknown): unknown {
  return JSONFunctions.deserializeValue(
    JSON.parse(
      JSON.stringify(JSONFunctions.serializeValue(value as JSONValue)),
    ) as JSONValue,
  );
}

function servicesFilter(serviceIds: Array<string>): unknown {
  return overTheWire(new Includes(serviceIds));
}

/*
 * What the public metrics route hands the policy (issue #6297): the
 * settings of the widgets the public page draws that chart metrics, as it
 * reads them - out of a stored config in any shape.
 */
function drawnSettingsOf(config: unknown): Array<JSONObject> {
  return PublicDashboardViewConfig.getMetricWidgetSettings(
    PublicDashboardViewConfig.getDrawnConfig(config),
  );
}

type ServicesRead = Array<string> | "every service" | "refused";

/*
 * What a public read of the metric runs with: the services of the filter it
 * gets, "every service" for no filter at all, or "refused" - always with
 * the one refusal, which names nothing the dashboard saves.
 */
function readFor(
  config: unknown,
  metricName: string,
  requestedServiceFilter: unknown,
): ServicesRead {
  let serviceQuery: { primaryEntityId?: Includes };

  try {
    serviceQuery = PublicDashboardMetricServices.getServiceQuery({
      savedServices: PublicDashboardMetricServices.getSavedServices(
        drawnSettingsOf(config),
      ),
      metricName: metricName,
      requestedServiceFilter: requestedServiceFilter,
    });
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    expect((err as BadDataException).message).toBe(
      PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE,
    );
    return "refused";
  }

  if (Object.keys(serviceQuery).length === 0) {
    return "every service";
  }

  expect(Object.keys(serviceQuery)).toEqual(["primaryEntityId"]);

  const filter: unknown = serviceQuery.primaryEntityId;

  expect(filter).toBeInstanceOf(Includes);
  expect(Object.getPrototypeOf(filter)).toBe(Includes.prototype);

  return [...((filter as Includes).values as Array<string>)];
}

// Every metric's saved services, by metric name in order.
function savedServicesOf(
  config: unknown,
): Array<[string, Array<Array<string>>]> {
  const savedServices: PublicDashboardMetricSavedServices =
    PublicDashboardMetricServices.getSavedServices(drawnSettingsOf(config));

  return Array.from(savedServices.entries()).sort(
    (
      a: [string, Array<Array<string>>],
      b: [string, Array<Array<string>>],
    ): number => {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    },
  );
}

describe("a public read of a dashboard's metric", () => {
  test("a chart saved with services is read for exactly those services", () => {
    const config: JSONObject = dashboardOf(
      chart(savedQuery(LATENCY, [API, CHECKOUT])),
    );

    expect(readFor(config, LATENCY, servicesFilter([API, CHECKOUT]))).toEqual([
      API,
      CHECKOUT,
    ]);
  });

  test("as saved: in the saved order, whatever order the request names them in", () => {
    const config: JSONObject = dashboardOf(
      chart(savedQuery(LATENCY, [API, CHECKOUT, BILLING])),
    );

    for (const requested of [
      [BILLING, CHECKOUT, API],
      [CHECKOUT, API, BILLING],
      [API, CHECKOUT, BILLING],
    ]) {
      expect(readFor(config, LATENCY, servicesFilter(requested))).toEqual([
        API,
        CHECKOUT,
        BILLING,
      ]);
    }
  });

  test("the filter it runs with is built from the saved ids, not handed on from the request", () => {
    const savedServices: PublicDashboardMetricSavedServices =
      PublicDashboardMetricServices.getSavedServices(
        drawnSettingsOf(
          dashboardOf(chart(savedQuery(LATENCY, [API, CHECKOUT]))),
        ),
      );
    const requested: Includes = new Includes([CHECKOUT, API]);

    const first: { primaryEntityId?: Includes } =
      PublicDashboardMetricServices.getServiceQuery({
        savedServices,
        metricName: LATENCY,
        requestedServiceFilter: requested,
      });

    expect(first.primaryEntityId).not.toBe(requested);
    expect(first.primaryEntityId!.values).not.toBe(requested.values);

    // Nothing the caller then does to either reaches the next read.
    (requested.values as Array<string>).push(FOREIGN);
    (first.primaryEntityId!.values as Array<string>).push(FOREIGN);

    const second: { primaryEntityId?: Includes } =
      PublicDashboardMetricServices.getServiceQuery({
        savedServices,
        metricName: LATENCY,
        requestedServiceFilter: new Includes([API, CHECKOUT]),
      });

    expect(second.primaryEntityId!.values).toEqual([API, CHECKOUT]);
  });

  test("a chart saved without services is read for every service, with no filter at all", () => {
    const config: JSONObject = dashboardOf(chart(savedQuery(LATENCY)));

    expect(readFor(config, LATENCY, undefined)).toBe("every service");
    // A null filter is no filter, as a null grouping is no grouping.
    expect(readFor(config, LATENCY, null)).toBe("every service");
  });

  test("a dashboard saved before service filters reads every metric as before, and for no service on its own", () => {
    const config: JSONObject = dashboardOf(
      chart(savedQuery(LATENCY), savedQuery(CPU)),
      chart(savedQuery(CPU)),
    );

    expect(readFor(config, LATENCY, undefined)).toBe("every service");
    expect(readFor(config, CPU, undefined)).toBe("every service");
    expect(readFor(config, LATENCY, servicesFilter([API]))).toBe("refused");
    expect(readFor(config, CPU, servicesFilter([API, CHECKOUT]))).toBe(
      "refused",
    );
  });

  test("a metric charted both with and without services is read either way, and no other", () => {
    const config: JSONObject = dashboardOf(
      chart(savedQuery(LATENCY, [API])),
      chart(savedQuery(LATENCY)),
    );

    expect(readFor(config, LATENCY, undefined)).toBe("every service");
    expect(readFor(config, LATENCY, servicesFilter([API]))).toEqual([API]);
    expect(readFor(config, LATENCY, servicesFilter([CHECKOUT]))).toBe(
      "refused",
    );
    expect(readFor(config, LATENCY, servicesFilter([API, CHECKOUT]))).toBe(
      "refused",
    );
  });

  test("charts of one metric saved with different services each read their own, and never their services together", () => {
    const config: JSONObject = dashboardOf(
      chart(savedQuery(LATENCY, [API]), savedQuery(LATENCY, [CHECKOUT])),
      chart(savedQuery(LATENCY, [CHECKOUT, BILLING])),
    );

    expect(readFor(config, LATENCY, servicesFilter([API]))).toEqual([API]);
    expect(readFor(config, LATENCY, servicesFilter([CHECKOUT]))).toEqual([
      CHECKOUT,
    ]);
    expect(
      readFor(config, LATENCY, servicesFilter([BILLING, CHECKOUT])),
    ).toEqual([CHECKOUT, BILLING]);

    expect(readFor(config, LATENCY, servicesFilter([API, CHECKOUT]))).toBe(
      "refused",
    );
    expect(readFor(config, LATENCY, servicesFilter([BILLING]))).toBe("refused");
    expect(
      readFor(config, LATENCY, servicesFilter([API, CHECKOUT, BILLING])),
    ).toBe("refused");
    expect(readFor(config, LATENCY, undefined)).toBe("refused");
  });
});

describe("what a public read cannot do", () => {
  const config: JSONObject = dashboardOf(
    chart(savedQuery(LATENCY, [API, CHECKOUT])),
    chart(savedQuery(CPU, [BILLING])),
  );

  test("widen a chart saved with services to every service", () => {
    expect(readFor(config, LATENCY, undefined)).toBe("refused");
    expect(readFor(config, LATENCY, null)).toBe("refused");
    expect(readFor(config, CPU, undefined)).toBe("refused");
  });

  test("read a service the dashboard does not chart", () => {
    expect(readFor(config, LATENCY, servicesFilter([FOREIGN]))).toBe("refused");
    expect(
      readFor(config, LATENCY, servicesFilter([API, CHECKOUT, FOREIGN])),
    ).toBe("refused");
  });

  test("narrow a chart to one of its services, to read it on its own", () => {
    expect(readFor(config, LATENCY, servicesFilter([API]))).toBe("refused");
    expect(readFor(config, LATENCY, servicesFilter([CHECKOUT]))).toBe(
      "refused",
    );
  });

  test("name a service twice, even among exactly its services", () => {
    for (const requested of [
      [API, API, CHECKOUT],
      [API, CHECKOUT, CHECKOUT],
      [CHECKOUT, API, CHECKOUT, API],
    ]) {
      expect(readFor(config, LATENCY, servicesFilter(requested))).toBe(
        "refused",
      );
    }

    expect(readFor(config, CPU, servicesFilter([BILLING, BILLING]))).toBe(
      "refused",
    );
  });

  test("borrow another metric's services", () => {
    expect(readFor(config, LATENCY, servicesFilter([BILLING]))).toBe("refused");
    expect(readFor(config, CPU, servicesFilter([API, CHECKOUT]))).toBe(
      "refused",
    );
    expect(
      readFor(config, LATENCY, servicesFilter([API, CHECKOUT, BILLING])),
    ).toBe("refused");
  });

  test("read a metric the dashboard does not chart, for any services or none", () => {
    for (const requested of [
      undefined,
      null,
      servicesFilter([API]),
      servicesFilter([API, CHECKOUT]),
      servicesFilter([BILLING]),
    ]) {
      expect(readFor(config, UNCHARTED, requested)).toBe("refused");
    }

    expect(readFor(dashboardOf(), LATENCY, undefined)).toBe("refused");
  });

  test("name its services in any other shape", () => {
    class LookalikeIncludes extends Includes {}

    const shapes: Array<[string, unknown]> = [
      ["one id", API],
      ["one id as an ObjectID", new ObjectID(API)],
      ["a plain list of ids", [API, CHECKOUT]],
      ["a number", 42],
      ["true", true],
      ["false", false],
      ["an empty text", ""],
      ["an object", { values: [API, CHECKOUT] }],
      ["a Mongo-style operator", { $in: [API, CHECKOUT] }],
      [
        "Includes JSON that was not revived",
        { _type: "Includes", value: [API, CHECKOUT] },
      ],
      [
        "Includes JSON as text",
        JSON.stringify(new Includes([API, CHECKOUT]).toJSON()),
      ],
      ["a list holding an Includes", [new Includes([API, CHECKOUT])]],
      ["an empty Includes", new Includes([])],
      ["an Includes of ObjectIDs", new Includes([new ObjectID(API)])],
      [
        "an Includes of the ObjectIDs of exactly its services",
        new Includes([new ObjectID(API), new ObjectID(CHECKOUT)]),
      ],
      ["an Includes of numbers", new Includes([42] as Array<number>)],
      [
        "an Includes with a number among the ids",
        new Includes([API, 42 as unknown as string, CHECKOUT]),
      ],
      [
        "an Includes with null among the ids",
        new Includes([API, null as unknown as string, CHECKOUT]),
      ],
      ["an Includes with an empty id", new Includes([API, "", CHECKOUT])],
      ["an Includes with a blank id", new Includes([API, "   ", CHECKOUT])],
      [
        "an Includes naming one of exactly its services twice",
        new Includes([API, CHECKOUT, API]),
      ],
      ["an Includes of a text that is not an id", new Includes(["smuggled"])],
      [
        "an Includes of an id followed by SQL",
        new Includes([`${API}') OR ('1'='1`, CHECKOUT]),
      ],
      [
        "an Includes of lists",
        new Includes([[API, CHECKOUT]] as unknown as Array<string>),
      ],
      [
        "an Includes of an Includes",
        new Includes([
          new Includes([API, CHECKOUT]),
        ] as unknown as Array<string>),
      ],
      [
        "IncludesNone, which reads every other service",
        new IncludesNone([API]),
      ],
      ["IncludesAll", new IncludesAll([API, CHECKOUT])],
      ["a Wildcard, whose values look the same", new Wildcard([API, CHECKOUT])],
      ["a class built on Includes", new LookalikeIncludes([API, CHECKOUT])],
      ["EqualTo", new EqualTo(API)],
      ["NotEqual", new NotEqual(API)],
      ["Search", new Search(API)],
      ["StartsWith", new StartsWith(API)],
      ["IsNull", new IsNull()],
      ["NotNull", new NotNull()],
      ["InBetween", new InBetween(API, CHECKOUT)],
    ];

    for (const [label, shape] of shapes) {
      const read: ServicesRead = readFor(config, LATENCY, shape);

      if (read !== "refused") {
        throw new Error(`${label} was read as ${JSON.stringify(read)}`);
      }
    }
  });

  test("match an id loosely", () => {
    for (const looseId of [
      ` ${API}`,
      `${API} `,
      `${API}\n`,
      API.toUpperCase(),
      `{${API}}`,
      API.replace(/-/g, ""),
    ]) {
      expect(readFor(config, CPU, servicesFilter([looseId]))).toBe("refused");
      expect(
        readFor(config, LATENCY, servicesFilter([looseId, CHECKOUT])),
      ).toBe("refused");
    }
  });

  test("learn from the refusal what the dashboard saves", () => {
    let message: string = "";

    try {
      PublicDashboardMetricServices.getServiceQuery({
        savedServices: PublicDashboardMetricServices.getSavedServices(
          drawnSettingsOf(config),
        ),
        metricName: LATENCY,
        requestedServiceFilter: new Includes([API]),
      });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toBe(PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE);

    for (const serviceId of [API, CHECKOUT, BILLING]) {
      expect(message).not.toContain(serviceId);
    }
  });
});

describe("the services a dashboard saves for each metric", () => {
  test("sit beside each query's metric name: a chart's first query, its other queries, a fallback, a table's columns", () => {
    const config: JSONObject = dashboardOf(
      chart(
        {
          ...savedQuery(LATENCY, [API]),
          fallback: {
            queryConfig: savedQuery("http.server.request.duration", [CHECKOUT]),
            hint: { text: "Older agents send the other one." },
          },
        },
        savedQuery(CPU, [CHECKOUT, BILLING]),
      ),
      {
        componentType: DashboardComponentType.Table,
        componentId: ObjectID.generate().toString(),
        arguments: {
          columns: [
            { id: "c1", kind: "Metric", metricName: "system.memory.usage" },
          ],
        },
      },
      {
        componentType: DashboardComponentType.Value,
        componentId: ObjectID.generate().toString(),
        arguments: { metricQueryConfig: savedQuery(LATENCY) },
      },
    );

    expect(savedServicesOf(config)).toEqual([
      ["http.server.duration", [[API], []]],
      ["http.server.request.duration", [[CHECKOUT]]],
      ["system.cpu.utilization", [[CHECKOUT, BILLING]]],
      ["system.memory.usage", [[]]],
    ]);
  });

  test("each distinct set once, in the order it was first saved", () => {
    const config: JSONObject = dashboardOf(
      chart(
        savedQuery(LATENCY, [CHECKOUT, API]),
        savedQuery(LATENCY, [API, CHECKOUT]),
        savedQuery(LATENCY, [API]),
      ),
      chart(savedQuery(LATENCY, [API]), savedQuery(LATENCY)),
      chart(savedQuery(LATENCY, []), savedQuery(LATENCY)),
    );

    expect(savedServicesOf(config)).toEqual([
      ["http.server.duration", [[CHECKOUT, API], [API], []]],
    ]);
  });

  test("a query saved without services, or with services that name none, is saved for every service", () => {
    const noServices: Array<[string, unknown]> = [
      ["absent", undefined],
      ["an empty list", []],
      ["null", null],
      ["one id as text, not a list", API],
      ["an object keyed like a list", { 0: API }],
      ["a list of nothing", [null, "", "   ", {}, []]],
      ["a number", 7],
      ["true", true],
    ];

    for (const [label, telemetryServiceIds] of noServices) {
      expect([
        label,
        savedServicesOf(
          dashboardOf(chart(savedQuery(LATENCY, telemetryServiceIds))),
        ),
      ]).toEqual([label, [["http.server.duration", [[]]]]]);
    }
  });

  test("ids are read as the public page reads them: trimmed, each once, ObjectID JSON as its id", () => {
    const config: JSONObject = dashboardOf(
      chart(
        savedQuery(LATENCY, [
          ` ${API} `,
          { _type: "ObjectID", value: CHECKOUT },
          API,
          "",
          7,
        ]),
      ),
    );

    expect(savedServicesOf(config)).toEqual([
      ["http.server.duration", [[API, CHECKOUT, "7"]]],
    ]);
  });

  test("a list the page cannot revive is read as it is stored, as the page then reads it", () => {
    // Includes JSON whose value is no list: reviving it throws.
    const config: JSONObject = dashboardOf(
      chart(
        savedQuery(LATENCY, [{ _type: "Includes", value: {} }, API, CHECKOUT]),
      ),
    );

    expect(() => {
      JSONFunctions.deserializeValue([
        { _type: "Includes", value: {} },
      ] as unknown as JSONValue);
    }).toThrow();

    expect(savedServicesOf(config)).toEqual([
      ["http.server.duration", [[API, CHECKOUT]]],
    ]);
  });

  test("a query saved with something that is not a service id among its services reads for no request, and never for every service", () => {
    for (const notAnId of ["smuggled", 7, `${API}x`, "{" + CHECKOUT + "}"]) {
      // As the page sends them: MetricQueryServices reads 7 as "7".
      const asSent: Array<string> = [API, String(notAnId)];
      const config: JSONObject = dashboardOf(
        chart(savedQuery(LATENCY, [API, notAnId])),
      );

      expect(savedServicesOf(config)).toEqual([[LATENCY, [asSent]]]);

      for (const requested of [
        servicesFilter(asSent),
        servicesFilter([API]),
        undefined,
        null,
      ]) {
        expect([String(notAnId), readFor(config, LATENCY, requested)]).toEqual([
          String(notAnId),
          "refused",
        ]);
      }
    }

    // On its own, too.
    const alone: JSONObject = dashboardOf(
      chart(savedQuery(LATENCY, ["smuggled"])),
    );

    expect(readFor(alone, LATENCY, servicesFilter(["smuggled"]))).toBe(
      "refused",
    );
    expect(readFor(alone, LATENCY, undefined)).toBe("refused");
  });

  test("only a text that names a metric is a metric name, kept exactly as written", () => {
    const config: JSONObject = dashboardOf(
      chart(
        savedQuery(42, [API]),
        savedQuery(null, [API]),
        savedQuery("", [API]),
        savedQuery("   ", [API]),
        savedQuery([LATENCY], [API]),
        savedQuery({ value: LATENCY }, [API]),
        savedQuery(` ${CPU} `, [CHECKOUT]),
      ),
    );

    expect(savedServicesOf(config)).toEqual([[` ${CPU} `, [[CHECKOUT]]]]);

    // The padded name is not the metric's own name.
    expect(readFor(config, CPU, servicesFilter([CHECKOUT]))).toBe("refused");
    expect(readFor(config, ` ${CPU} `, servicesFilter([CHECKOUT]))).toEqual([
      CHECKOUT,
    ]);
  });

  test("a metric named like an Object property is a metric like any other", () => {
    const config: JSONObject = JSON.parse(
      JSON.stringify(
        dashboardOf(
          chart(
            savedQuery("constructor", [API]),
            savedQuery("toString"),
            savedQuery("__proto__", [CHECKOUT]),
          ),
        ),
      ),
    ) as JSONObject;

    expect(savedServicesOf(config)).toEqual([
      ["__proto__", [[CHECKOUT]]],
      ["constructor", [[API]]],
      ["toString", [[]]],
    ]);

    expect(readFor(config, "constructor", servicesFilter([API]))).toEqual([
      API,
    ]);
    expect(readFor(config, "constructor", undefined)).toBe("refused");
    expect(readFor(config, "toString", undefined)).toBe("every service");
    expect(readFor(config, "hasOwnProperty", undefined)).toBe("refused");
    expect(readFor(config, "valueOf", servicesFilter([API]))).toBe("refused");
  });

  test("any stored value reads, as nothing at all when it charts no metric", () => {
    for (const stored of [
      null,
      undefined,
      "",
      "text",
      42,
      true,
      [],
      {},
      { components: "not a list" },
      { components: [null, 7, "widget", []] },
    ]) {
      expect(savedServicesOf(stored)).toEqual([]);
      expect(readFor(stored, LATENCY, undefined)).toBe("refused");
    }
  });
});

/*
 * ISSUE #6297: THE SERVICES ARE READ WHERE THE PUBLIC PAGE DRAWS THEM.
 *
 * The route hands the policy the settings of the widgets the public page
 * draws that chart metrics, as the page reads them (drawnSettingsOf). So a
 * chart stored in any shape the page draws reads its services as stored as
 * an object; a widget the page does not draw saves none; and a value is
 * read as the page has it - revived with its widget, or as stored when the
 * page could not revive the widget - never revived again here.
 */
describe("the services are read where the public page draws them (issue #6297)", () => {
  const STORED_SERVICES: Array<JSONValue> = [
    API,
    { _type: "ObjectID", value: CHECKOUT },
  ];

  test("a chart stored in any shape the page draws reads its services as one stored as an object", () => {
    const widget: JSONObject = chart(savedQuery(LATENCY, STORED_SERVICES));
    const expected: Array<[string, Array<Array<string>>]> = [
      [LATENCY, [[API, CHECKOUT]]],
    ];

    for (const [label, components] of [
      ["as an object", [widget]],
      ["as JSON text", [JSON.stringify(widget)]],
      [
        "in the envelope, its value as JSON text",
        [{ _type: "DashboardComponent", value: JSON.stringify(widget) }],
      ],
      ["in a widget list written as JSON text", JSON.stringify([widget])],
      [
        "with its arguments as JSON text",
        [{ ...widget, arguments: JSON.stringify(widget["arguments"]) }],
      ],
    ] as Array<[string, unknown]>) {
      const config: JSONObject = {
        _type: "DashboardViewConfig",
        components: components as JSONValue,
      };

      expect([label, savedServicesOf(config)]).toEqual([label, expected]);
      expect([
        label,
        readFor(config, LATENCY, servicesFilter([CHECKOUT, API])),
      ]).toEqual([label, [API, CHECKOUT]]);
      expect([label, readFor(config, LATENCY, undefined)]).toEqual([
        label,
        "refused",
      ]);
    }
  });

  test("a widget the page does not draw saves no services, and does not add to a drawn chart's", () => {
    const hidden: Array<[string, unknown]> = [
      [
        "a Data Source widget",
        {
          ...chart(savedQuery(LATENCY, [FOREIGN])),
          componentType: DashboardComponentType.DataSourceChart,
        },
      ],
      [
        "a type the page does not draw",
        { ...chart(savedQuery(LATENCY, [FOREIGN])), componentType: "Charts" },
      ],
      [
        "a widget that charts no metrics",
        {
          ...chart(savedQuery(LATENCY, [FOREIGN])),
          componentType: DashboardComponentType.Text,
        },
      ],
      [
        "text that says no widget",
        JSON.stringify(JSON.stringify(chart(savedQuery(LATENCY, [FOREIGN])))),
      ],
      [
        "arguments that say no object",
        {
          ...chart(savedQuery(LATENCY, [FOREIGN])),
          arguments: JSON.stringify(
            JSON.stringify(chart(savedQuery(LATENCY, [FOREIGN]))["arguments"]),
          ),
        },
      ],
    ];

    for (const [label, entry] of hidden) {
      // On its own: the metric is charted for no services at all.
      expect([
        label,
        savedServicesOf(dashboardOf(entry as JSONObject)),
      ]).toEqual([label, []]);

      // Beside a drawn chart of the metric: only the chart's services.
      const config: JSONObject = dashboardOf(
        entry as JSONObject,
        chart(savedQuery(LATENCY, [API])),
      );

      expect([label, savedServicesOf(config)]).toEqual([
        label,
        [[LATENCY, [[API]]]],
      ]);
      expect([
        label,
        readFor(config, LATENCY, servicesFilter([FOREIGN])),
      ]).toEqual([label, "refused"]);
    }
  });

  test("a widget the page cannot revive is read as the page reads it, and its services never revived here", () => {
    // An address that is not text cannot be revived: the page then draws the widget as stored.
    const widget: JSONObject = chart(savedQuery(LATENCY, STORED_SERVICES));

    (widget["arguments"] as JSONObject)["owner"] = {
      _type: "Email",
      value: 42,
    };

    const config: JSONObject = dashboardOf(widget);

    // The page reads only the text id: the ObjectID JSON is no id to it.
    const drawn: JSONObject = drawnSettingsOf(config)[0]!;
    const drawnIds: unknown = (
      (
        (drawn["metricQueryConfig"] as JSONObject)[
          "metricQueryData"
        ] as JSONObject
      )["filterData"] as JSONObject
    )["telemetryServiceIds"];

    expect(drawnIds).toEqual(STORED_SERVICES);
    expect(savedServicesOf(config)).toEqual([[LATENCY, [[API]]]]);
    expect(readFor(config, LATENCY, servicesFilter([API]))).toEqual([API]);
    expect(readFor(config, LATENCY, servicesFilter([API, CHECKOUT]))).toBe(
      "refused",
    );
  });

  test("a value under a __proto__ key, which JSON keeps as an ordinary key, is never read", () => {
    // The widget cannot be revived, so the page draws its stored JSON, key and all.
    const config: JSONObject = JSON.parse(
      JSON.stringify(dashboardOf(chart(savedQuery(LATENCY, [API])))).replace(
        '"metricQueryConfig"',
        `"owner": {"_type": "Email", "value": 42}, "__proto__": ${JSON.stringify(
          { metricQueryConfig: savedQuery(CPU, [FOREIGN]) },
        )}, "metricQueryConfig"`,
      ),
    ) as JSONObject;

    const drawn: JSONObject = drawnSettingsOf(config)[0]!;

    expect(Object.keys(drawn)).toContain("__proto__");
    expect(savedServicesOf(config)).toEqual([[LATENCY, [[API]]]]);
    expect(readFor(config, CPU, servicesFilter([FOREIGN]))).toBe("refused");
  });

  test("a deserialized value is a value, never settings to walk into", () => {
    const config: JSONObject = dashboardOf({
      ...chart(savedQuery(LATENCY, [API])),
      arguments: {
        metricQueryConfig: savedQuery(LATENCY, [API]),
        // Revived as an Includes: its values are its own, not settings.
        metricQueryConfigs: {
          _type: "Includes",
          value: [savedQuery(CPU, [FOREIGN])],
        },
      },
    });

    expect(savedServicesOf(config)).toEqual([[LATENCY, [[API]]]]);
  });
});

/*
 * PROPERTY: A PUBLIC READ IS ONLY EVER ONE A SAVED QUERY MAKES.
 *
 * Seeded dashboards of a few charts, each query a pick of a few metrics and
 * services (none, an empty list, or some - stored now and then the noisy
 * ways the page still reads as those ids), and requests that name every
 * set of services there is, some saved and most not, in an order of their
 * own and now and then with a service named twice. The answer is worked out
 * here from the generated queries alone, not from the policy.
 */
describe("property: a public read is only ever one a saved query makes", () => {
  const METRICS: Array<string> = [LATENCY, CPU, "system.memory.usage"];
  const SERVICES: Array<string> = [API, CHECKOUT, BILLING, FOREIGN];

  interface GeneratedQuery {
    metricName: string;
    // The services the page reads it for: [] for every service.
    serviceIds: Array<string>;
  }

  // The ways a saved list of these ids can be stored that the page reads as them.
  function storeServiceIds(
    serviceIds: Array<string>,
    random: SeededRandom,
  ): unknown {
    if (serviceIds.length === 0) {
      return [undefined, [], null, ["", "  "]][random(4)];
    }

    switch (random(4)) {
      case 0:
        return [...serviceIds];
      case 1:
        return serviceIds.map((serviceId: string): string => {
          return ` ${serviceId} `;
        });
      case 2:
        return [...serviceIds, serviceIds[0]];
      default:
        return serviceIds.map((serviceId: string): JSONObject => {
          return { _type: "ObjectID", value: serviceId };
        });
    }
  }

  // Every set of the services, as lists in pool order: [] first.
  function everyServiceSet(): Array<Array<string>> {
    const sets: Array<Array<string>> = [];

    for (let mask: number = 0; mask < 1 << SERVICES.length; mask++) {
      sets.push(
        SERVICES.filter((_serviceId: string, index: number): boolean => {
          return (mask & (1 << index)) !== 0;
        }),
      );
    }

    return sets;
  }

  function isSameSet(a: Array<string>, b: Array<string>): boolean {
    const setA: Set<string> = new Set<string>(a);
    const setB: Set<string> = new Set<string>(b);

    return (
      setA.size === setB.size &&
      Array.from(setA).every((value: string): boolean => {
        return setB.has(value);
      })
    );
  }

  test.each([1, 2, 3, 5, 8, 13, 21, 34])(
    "seed %i: every saved query reads as saved, and no other request reads at all",
    (seed: number) => {
      const random: SeededRandom = seededRandom(6280 + seed);
      const generated: Array<GeneratedQuery> = [];
      const components: Array<JSONObject> = [];

      const chartCount: number = 1 + random(4);

      for (let chartIndex: number = 0; chartIndex < chartCount; chartIndex++) {
        const queries: Array<JSONObject> = [];
        const queryCount: number = 1 + random(3);

        for (
          let queryIndex: number = 0;
          queryIndex < queryCount;
          queryIndex++
        ) {
          const metricName: string = METRICS[random(METRICS.length)]!;
          const serviceIds: Array<string> =
            random(3) === 0
              ? []
              : shuffled(SERVICES, random).slice(0, 1 + random(3));

          generated.push({ metricName, serviceIds });
          queries.push(
            savedQuery(metricName, storeServiceIds(serviceIds, random)),
          );
        }

        components.push(chart(...queries));
      }

      // As the dashboard's JSON column hands it back.
      const config: JSONObject = JSON.parse(
        JSON.stringify(dashboardOf(...components)),
      ) as JSONObject;

      let accepted: number = 0;
      let refused: number = 0;

      for (const metricName of [...METRICS, UNCHARTED]) {
        const savedForMetric: Array<GeneratedQuery> = generated.filter(
          (query: GeneratedQuery): boolean => {
            return query.metricName === metricName;
          },
        );

        const savedUnion: Set<string> = new Set<string>(
          savedForMetric.flatMap((query: GeneratedQuery): Array<string> => {
            return query.serviceIds;
          }),
        );

        for (const requestedSet of everyServiceSet()) {
          // The request names them in an order of its own, now and then one twice.
          const requestedIds: Array<string> = shuffled(
            [...requestedSet, ...requestedSet.slice(0, random(2))],
            random,
          );
          // No page names a service twice, so no such request is read.
          const namesOneTwice: boolean =
            requestedIds.length !== requestedSet.length;
          const requested: unknown =
            requestedSet.length === 0
              ? [undefined, null][random(2)]
              : servicesFilter(requestedIds);

          const firstSaved: GeneratedQuery | undefined = savedForMetric.find(
            (query: GeneratedQuery): boolean => {
              return isSameSet(query.serviceIds, requestedSet);
            },
          );

          const read: ServicesRead = readFor(config, metricName, requested);
          const context: string = `seed ${seed}, ${metricName}, [${requestedSet.join(", ")}]`;

          if (!firstSaved || namesOneTwice) {
            expect([context, read]).toEqual([context, "refused"]);
            refused++;
            continue;
          }

          accepted++;

          if (firstSaved.serviceIds.length === 0) {
            expect([context, read]).toEqual([context, "every service"]);
            continue;
          }

          // As the first query saved with them saved them, in its order.
          expect([context, read]).toEqual([context, firstSaved.serviceIds]);

          // Never wider than the services the dashboard charts the metric for.
          for (const serviceId of read as Array<string>) {
            expect(savedUnion.has(serviceId)).toBe(true);
          }
        }
      }

      /*
       * Each saved query's own services, with one of them named twice: what
       * would be read but for the repeat, and is read by no request.
       */
      for (const query of generated) {
        if (query.serviceIds.length === 0) {
          continue;
        }

        const requestedIds: Array<string> = shuffled(
          [
            ...query.serviceIds,
            query.serviceIds[random(query.serviceIds.length)]!,
          ],
          random,
        );
        const context: string = `seed ${seed}, ${query.metricName}, [${requestedIds.join(", ")}]`;

        expect([
          context,
          readFor(config, query.metricName, servicesFilter(requestedIds)),
        ]).toEqual([context, "refused"]);
      }

      // The sweep must have tried both answers.
      expect(accepted).toBeGreaterThan(0);
      expect(refused).toBeGreaterThan(0);
    },
  );
});
