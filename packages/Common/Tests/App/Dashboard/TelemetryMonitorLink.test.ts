import { describe, expect, test } from "@jest/globals";
import {
  applyTelemetryMonitorLinkQuery,
  getLogsFilterLinkQuery,
  getTelemetryFilterLinkNotCarried,
  getTelemetryMonitorLinkParams,
  getTelemetryMonitorLinkRecipeKey,
  getTracesFilterLinkQuery,
  isTelemetryMonitorLinkType,
  readTelemetryMonitorLinkQuery,
  TELEMETRY_MONITOR_LINK_MAX_ATTRIBUTES,
  TELEMETRY_MONITOR_LINK_MAX_TEXT_LENGTH,
  TELEMETRY_MONITOR_LINK_MAX_VALUES,
  TELEMETRY_MONITOR_QUERY_PARAM,
  TELEMETRY_MONITOR_TYPE_QUERY_PARAM,
  TelemetryMonitorLinkQuery,
  writeTelemetryMonitorLinkQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryMonitorLink";
import { TelemetryRuleRecipeKey } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleRecipes";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import Search from "../../../Types/BaseDatabase/Search";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import Dictionary from "../../../Types/Dictionary";
import LogSeverity from "../../../Types/Log/LogSeverity";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepExceptionMonitorUtil } from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepTraceMonitorUtil } from "../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

/*
 * "Create monitor" from where the data is. The logs explorer, the traces
 * explorer and an exception's page link to Create Monitor with the monitor
 * type and what they show; Create Monitor reads the link and starts a
 * monitor watching just that, on the recipe that suits it.
 *
 * The link is text in an address bar: anyone can edit it. So reading it
 * keeps only what a monitor can watch - real ids, severities and statuses
 * that exist, text cut to a length, a bounded number of values - and a
 * link can only ever narrow the form, never break it.
 */

const SERVICE_A: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_B: string = "22222222-2222-4222-8222-222222222222";

describe("which monitor types a link starts", () => {
  test("Logs, Traces and Exceptions, whose explorers link here", () => {
    expect(isTelemetryMonitorLinkType(MonitorType.Logs)).toBe(true);
    expect(isTelemetryMonitorLinkType(MonitorType.Traces)).toBe(true);
    expect(isTelemetryMonitorLinkType(MonitorType.Exceptions)).toBe(true);
  });

  test("not a Metrics monitor, whose explorer has a link of its own, nor anything else", () => {
    expect(isTelemetryMonitorLinkType(MonitorType.Metrics)).toBe(false);
    expect(isTelemetryMonitorLinkType(MonitorType.Website)).toBe(false);
    expect(isTelemetryMonitorLinkType("Nonsense")).toBe(false);
    expect(isTelemetryMonitorLinkType(null)).toBe(false);
    expect(isTelemetryMonitorLinkType(undefined)).toBe(false);
  });
});

describe("a link's query, written and read back", () => {
  test("every part survives the round trip", () => {
    const query: TelemetryMonitorLinkQuery = {
      serviceIds: [SERVICE_A, SERVICE_B],
      attributes: { "http.route": "/checkout", "k8s.namespace": "shop" },
      severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
      messageContains: "payment declined",
      spanStatuses: [SpanStatus.Error],
      spanName: "POST /api/checkout",
      exceptionTypes: ["TypeError", "TimeoutError"],
    };

    expect(
      readTelemetryMonitorLinkQuery(writeTelemetryMonitorLinkQuery(query)),
    ).toEqual(query);
  });

  test("an empty query writes as an empty object, and the link carries only the type", () => {
    expect(writeTelemetryMonitorLinkQuery({})).toBe("{}");
    expect(
      getTelemetryMonitorLinkParams({
        monitorType: MonitorType.Logs,
        query: {},
      }),
    ).toEqual({ [TELEMETRY_MONITOR_TYPE_QUERY_PARAM]: MonitorType.Logs });
  });

  test("a query rides in its own parameter, beside the type Create Monitor already reads", () => {
    const params: Dictionary<string> = getTelemetryMonitorLinkParams({
      monitorType: MonitorType.Traces,
      query: { spanName: "GET /cart" },
    });

    expect(params[TELEMETRY_MONITOR_TYPE_QUERY_PARAM]).toBe(MonitorType.Traces);
    expect(
      readTelemetryMonitorLinkQuery(params[TELEMETRY_MONITOR_QUERY_PARAM]),
    ).toEqual({ spanName: "GET /cart" });
    expect(TELEMETRY_MONITOR_TYPE_QUERY_PARAM).toBe("monitorType");
  });

  test.each([
    ["nothing", null],
    ["an empty string", ""],
    ["text that is not JSON", "not json"],
    ["a list", "[1,2]"],
    ["a number", "42"],
    ["null", "null"],
  ])("%s reads as no query", (_label: string, raw: string | null) => {
    expect(readTelemetryMonitorLinkQuery(raw)).toBeNull();
  });

  test("an object holding nothing a monitor can watch reads as an empty query", () => {
    expect(readTelemetryMonitorLinkQuery('{"something":"else"}')).toEqual({});
  });
});

describe("a link's query, read as text anyone can edit", () => {
  test("only real ids are kept as services", () => {
    expect(
      readTelemetryMonitorLinkQuery(
        JSON.stringify({
          serviceIds: [SERVICE_A, "not-an-id", 42, null, SERVICE_A, SERVICE_B],
        }),
      ),
    ).toEqual({ serviceIds: [SERVICE_A, SERVICE_B] });
  });

  test("severities are read as the logs store them, unknown ones left out", () => {
    expect(
      readTelemetryMonitorLinkQuery(
        JSON.stringify({ severityTexts: ["error", "FATAL", "Loud", 3] }),
      ),
    ).toEqual({ severityTexts: [LogSeverity.Error, LogSeverity.Fatal] });
  });

  test("only the three span statuses a span can have are kept", () => {
    expect(
      readTelemetryMonitorLinkQuery(
        JSON.stringify({ spanStatuses: [2, "1", 7, -1, 2, "x"] }),
      ),
    ).toEqual({ spanStatuses: [SpanStatus.Error, SpanStatus.Ok] });
  });

  test("text is trimmed and cut to a length a monitor's field holds", () => {
    const long: string = "x".repeat(
      TELEMETRY_MONITOR_LINK_MAX_TEXT_LENGTH + 250,
    );

    const query: TelemetryMonitorLinkQuery | null =
      readTelemetryMonitorLinkQuery(
        JSON.stringify({ messageContains: `  ${long}  `, spanName: "   " }),
      );

    expect(query?.messageContains).toHaveLength(
      TELEMETRY_MONITOR_LINK_MAX_TEXT_LENGTH,
    );
    expect(query?.spanName).toBeUndefined();
  });

  test("lists and attributes are capped, so a crafted link stays small", () => {
    const types: Array<string> = Array.from(
      { length: TELEMETRY_MONITOR_LINK_MAX_VALUES + 30 },
      (_value: unknown, index: number) => {
        return `Error${index}`;
      },
    );
    const attributes: Dictionary<string> = {};

    for (let index: number = 0; index < 60; index++) {
      attributes[`key${index}`] = `value${index}`;
    }

    const query: TelemetryMonitorLinkQuery | null =
      readTelemetryMonitorLinkQuery(
        JSON.stringify({ exceptionTypes: types, attributes }),
      );

    expect(query?.exceptionTypes).toHaveLength(
      TELEMETRY_MONITOR_LINK_MAX_VALUES,
    );
    expect(Object.keys(query?.attributes || {})).toHaveLength(
      TELEMETRY_MONITOR_LINK_MAX_ATTRIBUTES,
    );
  });

  test("attributes that are not text, and lists that are not lists, are left out", () => {
    expect(
      readTelemetryMonitorLinkQuery(
        JSON.stringify({
          attributes: { good: "yes", bad: { nested: true }, empty: "" },
          exceptionTypes: "TypeError",
          severityTexts: { error: true },
        }),
      ),
    ).toEqual({ attributes: { good: "yes" } });

    expect(
      readTelemetryMonitorLinkQuery(JSON.stringify({ attributes: ["a"] })),
    ).toEqual({});
  });
});

describe("what the logs explorer's view becomes", () => {
  test("its services, severities, typed text and exact attributes", () => {
    expect(
      getLogsFilterLinkQuery({
        primaryEntityId: new Includes([
          new ObjectID(SERVICE_A),
          new ObjectID(SERVICE_B),
        ]),
        severityText: new Includes(["Error", "Fatal"]),
        body: new Search("payment declined"),
        attributes: { "http.route": "/checkout", tenant: 42 },
      }),
    ).toEqual({
      serviceIds: [SERVICE_A, SERVICE_B],
      severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
      messageContains: "payment declined",
      attributes: { "http.route": "/checkout", tenant: "42" },
    });
  });

  test("one service and one severity, as plain values", () => {
    expect(
      getLogsFilterLinkQuery({
        primaryEntityId: new ObjectID(SERVICE_A),
        severityText: "Warning",
        body: "  timeout  ",
      }),
    ).toEqual({
      serviceIds: [SERVICE_A],
      severityTexts: [LogSeverity.Warning],
      messageContains: "timeout",
    });
  });

  test("a part a monitor cannot hold is left out, which widens and never narrows", () => {
    expect(
      getLogsFilterLinkQuery({
        primaryEntityId: "not-an-id",
        severityText: new Includes(["Loud"]),
        body: new Search("   "),
        attributes: {
          "http.route": new Includes(["/a", "/b"]),
          tenant: { range: [1, 2] },
        },
        time: new Includes([1, 2]),
      }),
    ).toEqual({});
  });

  test("nothing filtered is an empty query", () => {
    expect(getLogsFilterLinkQuery({})).toEqual({});
  });
});

describe("what the traces explorer's view becomes", () => {
  test("its services, statuses, span name and exact attributes", () => {
    expect(
      getTracesFilterLinkQuery({
        primaryEntityId: new Includes([new ObjectID(SERVICE_A)]),
        statusCode: new Includes([SpanStatus.Error]),
        name: new Search("POST /api/checkout"),
        attributes: { "http.method": "POST" },
      }),
    ).toEqual({
      serviceIds: [SERVICE_A],
      spanStatuses: [SpanStatus.Error],
      spanName: "POST /api/checkout",
      attributes: { "http.method": "POST" },
    });
  });

  test("one span name as a plain value, and several as none", () => {
    expect(getTracesFilterLinkQuery({ name: "GET /cart" })).toEqual({
      spanName: "GET /cart",
    });
    expect(
      getTracesFilterLinkQuery({ name: new Includes(["GET /a", "GET /b"]) }),
    ).toEqual({});
  });

  test("unknown statuses are left out", () => {
    expect(
      getTracesFilterLinkQuery({ statusCode: new Includes([9, 42]) }),
    ).toEqual({});
    expect(
      getTracesFilterLinkQuery({ statusCode: new Includes(["x"]) }),
    ).toEqual({});
  });
});

describe("the recipe a link's monitor starts on", () => {
  test.each([
    [
      "words to look for",
      MonitorType.Logs,
      { messageContains: "declined" },
      TelemetryRuleRecipeKey.LogMessage,
    ],
    [
      "words to look for, among errors",
      MonitorType.Logs,
      {
        messageContains: "declined",
        severityTexts: [LogSeverity.Error],
      },
      TelemetryRuleRecipeKey.LogMessage,
    ],
    [
      "error logs",
      MonitorType.Logs,
      { severityTexts: [LogSeverity.Error, LogSeverity.Fatal] },
      TelemetryRuleRecipeKey.ErrorLogs,
    ],
    [
      "logs of other severities",
      MonitorType.Logs,
      { severityTexts: [LogSeverity.Error, LogSeverity.Warning] },
      TelemetryRuleRecipeKey.LogMessage,
    ],
    [
      "a service's logs",
      MonitorType.Logs,
      { serviceIds: [SERVICE_A] },
      TelemetryRuleRecipeKey.LogMessage,
    ],
    [
      "failing spans",
      MonitorType.Traces,
      { spanStatuses: [SpanStatus.Error] },
      TelemetryRuleRecipeKey.FailedSpans,
    ],
    [
      "a set of requests",
      MonitorType.Traces,
      { spanName: "GET /cart" },
      TelemetryRuleRecipeKey.SpansStop,
    ],
    [
      "an exception",
      MonitorType.Exceptions,
      { exceptionTypes: ["TypeError"] },
      TelemetryRuleRecipeKey.AnyException,
    ],
  ])(
    "%s: %s starts on %s",
    (
      _label: string,
      monitorType: MonitorType,
      query: TelemetryMonitorLinkQuery,
      key: TelemetryRuleRecipeKey,
    ) => {
      expect(getTelemetryMonitorLinkRecipeKey({ monitorType, query })).toBe(
        key,
      );
    },
  );

  test("no other type has a link recipe", () => {
    expect(
      getTelemetryMonitorLinkRecipeKey({
        monitorType: MonitorType.Metrics,
        query: { serviceIds: [SERVICE_A] },
      }),
    ).toBeUndefined();
  });
});

describe("the step watching what the link shows", () => {
  const step: () => MonitorStep = (): MonitorStep => {
    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.setLogMonitor({
      ...MonitorStepLogMonitorUtil.getDefault(),
      severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
      lastXSecondsOfLogs: 300,
    });
    monitorStep.setTraceMonitor({
      ...MonitorStepTraceMonitorUtil.getDefault(),
      spanStatuses: [SpanStatus.Error],
    });
    monitorStep.setExceptionMonitor(
      MonitorStepExceptionMonitorUtil.getDefault(),
    );
    return monitorStep;
  };

  test("a Logs link's parts are put over the step's, and the rest kept", () => {
    const result: MonitorStep = applyTelemetryMonitorLinkQuery({
      monitorType: MonitorType.Logs,
      monitorStep: step(),
      query: {
        serviceIds: [SERVICE_A],
        messageContains: "declined",
        attributes: { tenant: "acme" },
      },
    });

    expect(result.data?.logMonitor).toMatchObject({
      body: "declined",
      attributes: { tenant: "acme" },
      // Not in the link: the recipe's severities stay.
      severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
      lastXSecondsOfLogs: 300,
    });
    expect(
      result.data?.logMonitor?.telemetryServiceIds?.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([SERVICE_A]);
    // The trace part of the step is not touched.
    expect(result.data?.traceMonitor?.spanStatuses).toEqual([SpanStatus.Error]);
  });

  test("a Traces link sets the statuses and span name it shows", () => {
    const result: MonitorStep = applyTelemetryMonitorLinkQuery({
      monitorType: MonitorType.Traces,
      monitorStep: step(),
      query: { spanStatuses: [SpanStatus.Ok], spanName: "GET /cart" },
    });

    expect(result.data?.traceMonitor).toMatchObject({
      spanStatuses: [SpanStatus.Ok],
      spanName: "GET /cart",
    });
  });

  test("an Exceptions link sets the type and the service, and a message as the message filter", () => {
    const result: MonitorStep = applyTelemetryMonitorLinkQuery({
      monitorType: MonitorType.Exceptions,
      monitorStep: step(),
      query: {
        serviceIds: [SERVICE_B],
        exceptionTypes: ["TypeError"],
        messageContains: "undefined is not a function",
      },
    });

    expect(result.data?.exceptionMonitor).toMatchObject({
      exceptionTypes: ["TypeError"],
      message: "undefined is not a function",
    });
    expect(
      result.data?.exceptionMonitor?.telemetryServiceIds?.map(
        (id: ObjectID) => {
          return id.toString();
        },
      ),
    ).toEqual([SERVICE_B]);
  });

  test("the step it is applied to is left as it was", () => {
    const original: MonitorStep = step();

    applyTelemetryMonitorLinkQuery({
      monitorType: MonitorType.Logs,
      monitorStep: original,
      query: { messageContains: "declined" },
    });

    expect(original.data?.logMonitor?.body).toBe(
      MonitorStepLogMonitorUtil.getDefault().body,
    );
  });

  test("a step without the type's part starts from that part's defaults", () => {
    const result: MonitorStep = applyTelemetryMonitorLinkQuery({
      monitorType: MonitorType.Traces,
      monitorStep: new MonitorStep(),
      query: { spanName: "GET /cart" },
    });

    expect(result.data?.traceMonitor).toEqual({
      ...MonitorStepTraceMonitorUtil.getDefault(),
      spanName: "GET /cart",
    });
  });
});

/*
 * A view that LEAVES values out (a facet row's minus: "Severity is not
 * debug"). Before, Create monitor read only what a view kept, so a monitor
 * made from "everything but debug" watched debug too. Now what the monitor's
 * filters can hold is carried exactly - a severity or a span status left out
 * as the ones left in, an attribute value as "does not equal" / "is none
 * of" - and what they cannot is named, for the button to say so.
 */
describe("a view that leaves values out", () => {
  test("a severity left out is every other severity a log is stored with", () => {
    expect(
      getLogsFilterLinkQuery({ severityText: new NotEqual("Debug") }),
    ).toEqual({
      severityTexts: [
        LogSeverity.Unspecified,
        LogSeverity.Information,
        LogSeverity.Warning,
        LogSeverity.Error,
        LogSeverity.Trace,
        LogSeverity.Fatal,
      ],
    });
  });

  test("several left out are the ones left in, and the recipe follows them", () => {
    const query: TelemetryMonitorLinkQuery = getLogsFilterLinkQuery({
      severityText: new IncludesNone([
        "Unspecified",
        "Information",
        "Warning",
        "Trace",
        "Debug",
      ]),
    });

    expect(query.severityTexts).toEqual([LogSeverity.Error, LogSeverity.Fatal]);
    expect(
      getTelemetryMonitorLinkRecipeKey({
        monitorType: MonitorType.Logs,
        query,
      }),
    ).toBe(TelemetryRuleRecipeKey.ErrorLogs);
  });

  test("a severity nobody stores, or every severity, left out narrows nothing", () => {
    expect(
      getLogsFilterLinkQuery({ severityText: new NotEqual("Loud") }),
    ).toEqual({});
    expect(
      getLogsFilterLinkQuery({
        severityText: new IncludesNone(Object.values(LogSeverity)),
      }),
    ).toEqual({});
  });

  test("a severity kept wins over one left out of the same column", () => {
    expect(
      getLogsFilterLinkQuery({ severityText: "Error" }).severityTexts,
    ).toEqual([LogSeverity.Error]);
  });

  test("a span status left out is the other statuses, and Status is not Error watches the spans that stop", () => {
    const query: TelemetryMonitorLinkQuery = getTracesFilterLinkQuery({
      statusCode: new NotEqual(SpanStatus.Error),
    });

    expect(query.spanStatuses).toEqual([SpanStatus.Unset, SpanStatus.Ok]);
    expect(
      getTelemetryMonitorLinkRecipeKey({
        monitorType: MonitorType.Traces,
        query,
      }),
    ).toBe(TelemetryRuleRecipeKey.SpansStop);
    expect(
      getTracesFilterLinkQuery({
        statusCode: new IncludesNone([SpanStatus.Unset, SpanStatus.Ok]),
      }).spanStatuses,
    ).toEqual([SpanStatus.Error]);
    expect(getTracesFilterLinkQuery({ statusCode: new NotEqual(42) })).toEqual(
      {},
    );
  });

  test("an attribute value left out is carried beside the kept ones", () => {
    expect(
      getLogsFilterLinkQuery({
        attributes: {
          "k8s.namespace": "shop",
          "http.method": new NotEqual("OPTIONS"),
          "http.route": new IncludesNone(["/health", "/ready", "/health"]),
        },
      }),
    ).toEqual({
      attributes: { "k8s.namespace": "shop" },
      excludedAttributes: {
        "http.method": ["OPTIONS"],
        "http.route": ["/health", "/ready"],
      },
    });
    expect(
      getTracesFilterLinkQuery({
        attributes: { "resource.host.name": new NotEqual("web-01") },
      }),
    ).toEqual({ excludedAttributes: { "resource.host.name": ["web-01"] } });
  });

  test("the attributes left out survive the link's round trip, and an edited link is read with care", () => {
    const query: TelemetryMonitorLinkQuery = {
      attributes: { tenant: "acme" },
      excludedAttributes: { "http.method": ["OPTIONS", "HEAD"] },
    };

    expect(
      readTelemetryMonitorLinkQuery(writeTelemetryMonitorLinkQuery(query)),
    ).toEqual(query);

    expect(
      readTelemetryMonitorLinkQuery(
        JSON.stringify({
          attributes: { tenant: "acme" },
          excludedAttributes: {
            // Kept and left out at once: kept.
            tenant: ["acme"],
            "http.method": "OPTIONS",
            "http.route": [42, "/health", "", "/health"],
            "": ["x"],
          },
        }),
      ),
    ).toEqual({
      attributes: { tenant: "acme" },
      excludedAttributes: { "http.route": ["/health"] },
    });

    const tooMany: JSONObject = {};

    for (let index: number = 0; index < 40; index++) {
      tooMany[`key.${index}`] = [`value-${index}`];
    }

    expect(
      Object.keys(
        readTelemetryMonitorLinkQuery(
          JSON.stringify({ excludedAttributes: tooMany }),
        )?.excludedAttributes || {},
      ),
    ).toHaveLength(TELEMETRY_MONITOR_LINK_MAX_ATTRIBUTES);
  });

  test("the monitor's attribute filter holds them as does not equal and is none of", () => {
    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.setLogMonitor(MonitorStepLogMonitorUtil.getDefault());

    const result: MonitorStep = applyTelemetryMonitorLinkQuery({
      monitorType: MonitorType.Logs,
      monitorStep,
      query: {
        attributes: { tenant: "acme" },
        excludedAttributes: {
          "http.method": ["OPTIONS"],
          "http.route": ["/health", "/ready"],
          // A key kept stays kept.
          tenant: ["globex"],
        },
      },
    });
    const attributes: Dictionary<unknown> = result.data?.logMonitor
      ?.attributes as Dictionary<unknown>;

    expect(attributes["tenant"]).toBe("acme");
    expect(attributes["http.method"]).toBeInstanceOf(NotEqual);
    expect((attributes["http.method"] as NotEqual<string>).value).toBe(
      "OPTIONS",
    );
    expect(attributes["http.route"]).toBeInstanceOf(IncludesNone);
    expect((attributes["http.route"] as IncludesNone).values).toEqual([
      "/health",
      "/ready",
    ]);

    // The query the monitor runs leaves them out too.
    const runQuery: Dictionary<unknown> = MonitorStepLogMonitorUtil.toQuery(
      result.data!.logMonitor!,
    ) as unknown as Dictionary<unknown>;

    expect(
      (runQuery["attributes"] as Dictionary<unknown>)["http.method"],
    ).toBeInstanceOf(NotEqual);
  });

  test("saved and read back, the step's attribute filter keeps its operators", () => {
    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.setTraceMonitor(MonitorStepTraceMonitorUtil.getDefault());

    const seeded: MonitorStep = applyTelemetryMonitorLinkQuery({
      monitorType: MonitorType.Traces,
      monitorStep,
      query: { excludedAttributes: { "resource.host.name": ["web-01"] } },
    });
    const stored: JSONObject = JSONFunctions.serialize(
      seeded.data!.traceMonitor!.attributes as unknown as JSONObject,
    ) as JSONObject;
    const restored: Dictionary<unknown> = JSONFunctions.deserialize(
      stored,
    ) as unknown as Dictionary<unknown>;

    expect(restored["resource.host.name"]).toBeInstanceOf(NotEqual);
    expect((restored["resource.host.name"] as NotEqual<string>).value).toBe(
      "web-01",
    );
  });

  test("what a monitor's filters cannot hold is named: services, resources, message text, names and kinds, attribute patterns", () => {
    expect(
      getTelemetryFilterLinkNotCarried({
        primaryEntityId: new NotEqual(new ObjectID(SERVICE_A)),
        excludedResourceFilters: {
          hostId: [SERVICE_B],
          kubernetesClusterId: [],
        },
        body: new NotContains("healthcheck"),
        attributes: {
          "http.route": new NotWildcard(["/api/*"]),
          "http.user_agent": [new NotContains("bot"), new NotEqual("x")],
          // Carried, so never named.
          "http.method": new NotEqual("OPTIONS"),
        },
      }),
    ).toEqual([
      "!serviceIds",
      "!hostId",
      "!body",
      "!attributes.http.route",
      "!attributes.http.user_agent",
    ]);

    expect(
      getTelemetryFilterLinkNotCarried({
        primaryEntityId: new IncludesNone([SERVICE_A, SERVICE_B]),
        name: [new Search("GET"), new NotEqual("GET /health")],
        kind: new NotEqual("SPAN_KIND_CLIENT"),
        statusCode: new NotEqual(SpanStatus.Error),
      }),
    ).toEqual(["!serviceIds", "!name", "!kind"]);
  });

  test("a view that keeps what it shows, or leaves out only what is carried, names nothing", () => {
    expect(
      getTelemetryFilterLinkNotCarried({
        primaryEntityId: new Includes([SERVICE_A]),
        severityText: new NotEqual("Debug"),
        statusCode: new IncludesNone([SpanStatus.Error]),
        body: new Search("declined"),
        attributes: { tenant: "acme", "http.method": new NotEqual("GET") },
      }),
    ).toEqual([]);
    expect(getTelemetryFilterLinkNotCarried({})).toEqual([]);
  });

  test("a span name searched as a part of it beside names left out keeps the part searched for", () => {
    expect(
      getTracesFilterLinkQuery({
        name: [new Search("GET"), new IncludesNone(["GET /health"])],
      }),
    ).toEqual({ spanName: "GET" });
  });
});
