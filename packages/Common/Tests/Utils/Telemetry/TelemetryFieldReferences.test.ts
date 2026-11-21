import { describe, expect, test } from "@jest/globals";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import {
  TelemetryFieldPart,
  TelemetryFieldUse,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
import {
  DashboardFieldReferences,
  findDashboardFieldReferences,
  findExceptionSavedViewFieldReferences,
  findLogRecordingRuleFieldReferences,
  findLogSavedViewFieldReferences,
  findMonitorFieldReferences,
  findSloFieldReferences,
  findTraceRecordingRuleFieldReferences,
  findTraceSavedViewFieldReferences,
  isPartialFilterValue,
  readFilterTexts,
  readServiceScope,
  TelemetryFieldReference,
} from "../../../Utils/Telemetry/TelemetryFieldReferences";

/*
 * WHAT A SAVED RECORD READS OF A LOG'S OR A SPAN'S FIELDS (#10433).
 *
 * Each kind of record a project keeps - monitors, recording rules, SLOs,
 * dashboards, saved views - is walked into the fields its queries read:
 * the signal, the services, the part of the record, the attribute, how it
 * reads it, and the texts a filter or a search looks for. The walk reads
 * each query as it is stored, and never throws.
 */

const CHECKOUT: string = "0192f1a0-0000-7000-8000-00000010433a";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-00000010433b";

function steps(data: Record<string, unknown>): unknown {
  // A monitor's steps as MonitorSteps stores them: its class's JSON envelope.
  return {
    _type: "MonitorSteps",
    value: { monitorStepsInstanceArray: [{ id: "step-1", data }] },
  };
}

function only(
  references: Array<TelemetryFieldReference>,
  part: TelemetryFieldPart,
): Array<TelemetryFieldReference> {
  return references.filter((reference: TelemetryFieldReference) => {
    return reference.part === part;
  });
}

describe("reading a stored filter", () => {
  test("services: ids as text or ObjectID JSON, in lower case; none for no valid id", () => {
    expect(
      readServiceScope([
        CHECKOUT.toUpperCase(),
        { _type: "ObjectID", value: PAYMENTS },
        "not-an-id",
      ]),
    ).toEqual([CHECKOUT, PAYMENTS]);
    expect(readServiceScope([])).toBeNull();
    expect(readServiceScope(undefined)).toBeNull();
    // An Includes as JSONFunctions writes it.
    expect(readServiceScope({ _type: "Includes", value: [CHECKOUT] })).toEqual(
      [CHECKOUT],
    );
  });

  test("texts: a plain value, an operator's values, never the operator's name", () => {
    expect(readFilterTexts("alice@example.com")).toEqual(["alice@example.com"]);
    expect(readFilterTexts(500)).toEqual(["500"]);
    expect(
      readFilterTexts({ _type: "Includes", value: ["a@b.co", "c@d.co"] }),
    ).toEqual(["a@b.co", "c@d.co"]);
    expect(readFilterTexts({ _type: "Search", value: "@example.com" })).toEqual(
      ["@example.com"],
    );
    expect(readFilterTexts(null)).toEqual([]);
  });

  test("a filter for part of a value: contains, starts or ends with, a glob", () => {
    expect(isPartialFilterValue({ _type: "Search", value: "x" })).toBe(true);
    expect(isPartialFilterValue({ _type: "StartsWith", value: "x" })).toBe(
      true,
    );
    expect(isPartialFilterValue("*@example.com")).toBe(true);
    expect(isPartialFilterValue("alice@example.com")).toBe(false);
    expect(isPartialFilterValue({ _type: "NotEqual", value: "x" })).toBe(false);
  });
});

describe("monitors", () => {
  test("a Logs step: attribute filters, the body, group-bys, of its services", () => {
    const references: Array<TelemetryFieldReference> =
      findMonitorFieldReferences(
        steps({
          logMonitor: {
            telemetryServiceIds: [{ _type: "ObjectID", value: CHECKOUT }],
            attributes: {
              "user.email": "alice@example.com",
              "http.route": { _type: "Search", value: "/login" },
            },
            body: "login failed",
            groupByAttributes: ["client.address"],
            lastXSecondsOfLogs: 60,
          },
        }),
      );

    expect(references).toEqual([
      {
        signal: "log",
        serviceIds: [CHECKOUT],
        part: TelemetryFieldPart.Attributes,
        key: "user.email",
        use: TelemetryFieldUse.Filter,
        values: ["alice@example.com"],
      },
      {
        signal: "log",
        serviceIds: [CHECKOUT],
        part: TelemetryFieldPart.Attributes,
        key: "http.route",
        use: TelemetryFieldUse.Search,
        values: ["/login"],
      },
      {
        signal: "log",
        serviceIds: [CHECKOUT],
        part: TelemetryFieldPart.Body,
        use: TelemetryFieldUse.Search,
        values: ["login failed"],
      },
      {
        signal: "log",
        serviceIds: [CHECKOUT],
        part: TelemetryFieldPart.Attributes,
        key: "client.address",
        use: TelemetryFieldUse.GroupBy,
      },
    ]);
  });

  test("what resolves a group is read only on a grouped monitor", () => {
    const grouped: Array<TelemetryFieldReference> = findMonitorFieldReferences(
      steps({
        logMonitor: {
          groupByAttributes: ["con_name"],
          resolvedByAttributes: { "event.name": "interface.up" },
        },
      }),
    );
    const notGrouped: Array<TelemetryFieldReference> =
      findMonitorFieldReferences(
        steps({
          logMonitor: {
            groupByAttributes: [],
            resolvedByAttributes: { "event.name": "interface.up" },
          },
        }),
      );

    expect(
      grouped.map((reference: TelemetryFieldReference) => {
        return reference.key;
      }),
    ).toEqual(["con_name", "event.name"]);
    expect(notGrouped).toEqual([]);
  });

  test("a Traces step: attribute filters, the span's name, group-bys - of every service when it names none", () => {
    const references: Array<TelemetryFieldReference> =
      findMonitorFieldReferences(
        steps({
          traceMonitor: {
            telemetryServiceIds: [],
            attributes: { "enduser.id": "alice@example.com" },
            spanName: "POST /checkout",
            groupByAttributes: ["client.address"],
          },
        }),
      );

    expect(references).toHaveLength(3);
    expect(
      references.every((reference: TelemetryFieldReference) => {
        return reference.signal === "trace" && reference.serviceIds === null;
      }),
    ).toBe(true);
    expect(only(references, TelemetryFieldPart.SpanName)).toEqual([
      {
        signal: "trace",
        serviceIds: null,
        part: TelemetryFieldPart.SpanName,
        use: TelemetryFieldUse.Search,
        values: ["POST /checkout"],
      },
    ]);
  });

  test("an Exceptions step's message is read from span events and from log lines", () => {
    const references: Array<TelemetryFieldReference> =
      findMonitorFieldReferences(
        steps({
          exceptionMonitor: {
            telemetryServiceIds: [CHECKOUT],
            message: "card 4111 1111 1111 1111 declined",
          },
        }),
      );

    expect(
      references.map((reference: TelemetryFieldReference) => {
        return [reference.signal, reference.part, reference.use];
      }),
    ).toEqual([
      ["trace", TelemetryFieldPart.Events, TelemetryFieldUse.Search],
      ["log", TelemetryFieldPart.Body, TelemetryFieldUse.Search],
    ]);
  });

  test("steps of other kinds, steps kept as JSON text and nothing at all", () => {
    expect(
      findMonitorFieldReferences(
        steps({ metricMonitor: { metricViewConfig: { queryConfigs: [] } } }),
      ),
    ).toEqual([]);
    expect(
      findMonitorFieldReferences(
        JSON.stringify(
          steps({ logMonitor: { attributes: { "user.id": "42" } } }),
        ),
      ),
    ).toHaveLength(1);
    expect(findMonitorFieldReferences(null)).toEqual([]);
    expect(findMonitorFieldReferences("not json")).toEqual([]);
  });
});

describe("recording rules", () => {
  test("a log rule: filters, body, the value it aggregates and its groups, of its services", () => {
    const references: Array<TelemetryFieldReference> =
      findLogRecordingRuleFieldReferences({
        filter: {
          telemetryServiceIds: [CHECKOUT],
          body: "SLA summary",
          attributeFilters: [{ key: "gw_name", value: "edge-1" }],
        },
        aggregationType: AggregationType.Avg,
        valueAttribute: "latency",
        groupByAttributes: ["client.address"],
      });

    expect(
      references.map((reference: TelemetryFieldReference) => {
        return [reference.part, reference.key, reference.use];
      }),
    ).toEqual([
      [TelemetryFieldPart.Attributes, "gw_name", TelemetryFieldUse.Filter],
      [TelemetryFieldPart.Body, undefined, TelemetryFieldUse.Search],
      [TelemetryFieldPart.Attributes, "latency", TelemetryFieldUse.Value],
      [
        TelemetryFieldPart.Attributes,
        "client.address",
        TelemetryFieldUse.GroupBy,
      ],
    ]);
    expect(references[0]!.serviceIds).toEqual([CHECKOUT]);
  });

  test("a Count reads no value; a rule kept as JSON text is read too", () => {
    const references: Array<TelemetryFieldReference> =
      findLogRecordingRuleFieldReferences(
        JSON.stringify({
          filter: {},
          aggregationType: AggregationType.Count,
          valueAttribute: "latency",
        }),
      );

    expect(references).toEqual([]);
    expect(findLogRecordingRuleFieldReferences("{")).toEqual([]);
  });

  test("a trace rule: each source's filters - the older single pair too - its span name pattern, and its group", () => {
    const references: Array<TelemetryFieldReference> =
      findTraceRecordingRuleFieldReferences({
        sources: [
          {
            alias: "A",
            aggregationType: "Count",
            spanNameRegex: "^GET /users",
            filterAttributes: [{ key: "user.email", value: "a@b.co" }],
          },
          {
            alias: "B",
            aggregationType: "Count",
            filterAttributeKey: "http.route",
            filterAttributeValue: "/login",
          },
        ],
        expression: "A / B",
        groupByAttribute: "client.address",
      });

    expect(
      references.map((reference: TelemetryFieldReference) => {
        return [reference.part, reference.key, reference.use];
      }),
    ).toEqual([
      [TelemetryFieldPart.Attributes, "user.email", TelemetryFieldUse.Filter],
      [TelemetryFieldPart.SpanName, undefined, TelemetryFieldUse.Search],
      [TelemetryFieldPart.Attributes, "http.route", TelemetryFieldUse.Filter],
      [
        TelemetryFieldPart.Attributes,
        "client.address",
        TelemetryFieldUse.GroupBy,
      ],
    ]);
    // A trace rule reads the spans of every service.
    expect(
      references.every((reference: TelemetryFieldReference) => {
        return reference.serviceIds === null;
      }),
    ).toBe(true);
  });

  test("a trace rule grouped by the span's name or a column", () => {
    expect(
      findTraceRecordingRuleFieldReferences({
        sources: [],
        groupByAttribute: "name",
      }),
    ).toEqual([
      {
        signal: "trace",
        serviceIds: null,
        part: TelemetryFieldPart.SpanName,
        use: TelemetryFieldUse.GroupBy,
      },
    ]);
    expect(
      findTraceRecordingRuleFieldReferences({
        sources: [],
        groupByAttribute: "statusCode",
      }),
    ).toEqual([]);
  });
});

describe("SLOs", () => {
  test("a request SLO's filter terms, of its services", () => {
    const references: Array<TelemetryFieldReference> = findSloFieldReferences(
      {
        sliType: SliType.RequestSuccess,
        requestFilter: '@user.email:alice@example.com name:"POST /pay*"',
        serviceIds: [CHECKOUT],
      },
    );

    expect(references).toEqual([
      {
        signal: "trace",
        serviceIds: [CHECKOUT],
        part: TelemetryFieldPart.Attributes,
        key: "user.email",
        use: TelemetryFieldUse.Filter,
        values: ["alice@example.com"],
      },
      {
        signal: "trace",
        serviceIds: [CHECKOUT],
        part: TelemetryFieldPart.SpanName,
        use: TelemetryFieldUse.Search,
        values: ["POST /pay*"],
      },
    ]);
  });

  test("a Metric SLO, and one of no service, read no span", () => {
    expect(
      findSloFieldReferences({
        sliType: SliType.Metric,
        requestFilter: "@user.email:x",
        serviceIds: [CHECKOUT],
      }),
    ).toEqual([]);
    expect(
      findSloFieldReferences({
        sliType: SliType.RequestLatency,
        requestFilter: "@user.email:x",
        serviceIds: [],
      }),
    ).toEqual([]);
  });
});

describe("dashboards", () => {
  function dashboard(
    components: Array<Record<string, unknown>>,
    variables?: Array<Record<string, unknown>>,
  ): unknown {
    return {
      _type: "DashboardViewConfig",
      components,
      ...(variables ? { variables } : {}),
    };
  }

  function widget(
    id: string,
    componentType: string,
    widgetArguments: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      _type: "DashboardComponent",
      componentId: { _type: "ObjectID", value: id },
      componentType,
      arguments: widgetArguments,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
    };
  }

  test("log and trace widgets, each by the id the board draws it under; other widgets read nothing", () => {
    const found: DashboardFieldReferences = findDashboardFieldReferences(
      dashboard([
        widget(CHECKOUT, DashboardComponentType.LogStream, {
          title: "Failed sign-ins",
          bodyContains: "login failed",
          attributeFilterQuery: "@user.email:alice@example.com",
        }),
        widget(PAYMENTS, DashboardComponentType.TraceChart, {
          chartTitle: "Requests by client",
          attributeFilters: "http.route=/pay; tenant=acme",
          groupByAttribute: "client.address",
        }),
        widget(
          "0192f1a0-0000-7000-8000-00000010433c",
          DashboardComponentType.TraceList,
          { statusFilter: "Error" },
        ),
      ]),
    );

    expect(
      found.widgets.map(
        (entry: {
          widget: { id: string; title: string; type: string };
        }) => {
          return entry.widget;
        },
      ),
    ).toEqual([
      {
        id: CHECKOUT,
        title: "Failed sign-ins",
        type: DashboardComponentType.LogStream,
      },
      {
        id: PAYMENTS,
        title: "Requests by client",
        type: DashboardComponentType.TraceChart,
      },
    ]);
    expect(
      found.widgets[0]!.references.map((reference: TelemetryFieldReference) => {
        return [reference.part, reference.key, reference.values];
      }),
    ).toEqual([
      [TelemetryFieldPart.Body, undefined, ["login failed"]],
      [TelemetryFieldPart.Attributes, "user.email", ["alice@example.com"]],
    ]);
    expect(
      found.widgets[1]!.references.map((reference: TelemetryFieldReference) => {
        return [reference.key, reference.use];
      }),
    ).toEqual([
      ["http.route", TelemetryFieldUse.Filter],
      ["tenant", TelemetryFieldUse.Filter],
      ["client.address", TelemetryFieldUse.GroupBy],
    ]);
  });

  test("a Log Chart's filter record wins over the search text it was saved with", () => {
    const found: DashboardFieldReferences = findDashboardFieldReferences(
      dashboard([
        widget(CHECKOUT, DashboardComponentType.LogChart, {
          attributeFilters: { "client.address": "203.0.113.7" },
          attributeFilterQuery: "@user.email:a@b.co",
        }),
      ]),
    );

    expect(
      found.widgets[0]!.references.map((reference: TelemetryFieldReference) => {
        return reference.key;
      }),
    ).toEqual(["client.address"]);
  });

  test("a telemetry attribute variable reads its attribute in logs and spans", () => {
    const found: DashboardFieldReferences = findDashboardFieldReferences(
      dashboard(
        [],
        [
          {
            id: "v1",
            name: "user",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "user.email",
          },
          {
            id: "v2",
            name: "region",
            type: DashboardVariableType.CustomList,
            customListValues: "eu,us",
          },
        ],
      ),
    );

    expect(found.widgets).toEqual([]);
    expect(found.dashboard).toEqual([
      {
        signal: "log",
        serviceIds: null,
        part: TelemetryFieldPart.Attributes,
        key: "user.email",
        use: TelemetryFieldUse.Filter,
      },
      {
        signal: "trace",
        serviceIds: null,
        part: TelemetryFieldPart.Attributes,
        key: "user.email",
        use: TelemetryFieldUse.Filter,
      },
    ]);
  });

  test("a config that is no dashboard's reads nothing", () => {
    expect(findDashboardFieldReferences(null)).toEqual({
      widgets: [],
      dashboard: [],
    });
    expect(findDashboardFieldReferences("{")).toEqual({
      widgets: [],
      dashboard: [],
    });
  });
});

describe("saved views", () => {
  test("a Logs view: its query's attributes and body, of the services it names and its page's", () => {
    const references: Array<TelemetryFieldReference> =
      findLogSavedViewFieldReferences({
        query: {
          attributes: {
            "user.email": "alice@example.com",
            "http.route": { _type: "Search", value: "/api" },
          },
          body: [{ _type: "Search", value: "timeout" }],
          primaryEntityId: { _type: "Includes", value: [CHECKOUT, PAYMENTS] },
        },
        scope: `service:${CHECKOUT}`,
      });

    expect(
      references.map((reference: TelemetryFieldReference) => {
        return [reference.part, reference.key, reference.use, reference.values];
      }),
    ).toEqual([
      [
        TelemetryFieldPart.Attributes,
        "user.email",
        TelemetryFieldUse.Filter,
        ["alice@example.com"],
      ],
      [
        TelemetryFieldPart.Attributes,
        "http.route",
        TelemetryFieldUse.Search,
        ["/api"],
      ],
      [TelemetryFieldPart.Body, undefined, TelemetryFieldUse.Search, ["timeout"]],
    ]);
    // The page's service, among the ones its query names.
    expect(references[0]!.serviceIds).toEqual([CHECKOUT]);
  });

  test("a Logs view of a host's page reads the logs of every service", () => {
    const references: Array<TelemetryFieldReference> =
      findLogSavedViewFieldReferences({
        query: { attributes: { "user.id": "42" } },
        scope: `host:${CHECKOUT}`,
      });

    expect(references[0]!.serviceIds).toBeNull();
  });

  test("a Traces view: facets and its search, of the services it names", () => {
    const references: Array<TelemetryFieldReference> =
      findTraceSavedViewFieldReferences({
        query: {
          search:
            '@user.email:alice@example.com tenant:acme name:"GET /a" statusmessage:refused status:error checkout',
          filters: [
            ["attributes.client.address", "203.0.113.7"],
            ["!attributes.http.route", "/health"],
            ["primaryEntityId", CHECKOUT],
          ],
        },
      });

    expect(
      references.map((reference: TelemetryFieldReference) => {
        return [reference.part, reference.key, reference.values];
      }),
    ).toEqual([
      [TelemetryFieldPart.Attributes, "client.address", ["203.0.113.7"]],
      [TelemetryFieldPart.Attributes, "http.route", ["/health"]],
      [TelemetryFieldPart.Attributes, "user.email", ["alice@example.com"]],
      [TelemetryFieldPart.Attributes, "tenant", ["acme"]],
      [TelemetryFieldPart.SpanName, undefined, ["GET /a"]],
      [TelemetryFieldPart.StatusMessage, undefined, ["refused"]],
      [TelemetryFieldPart.SpanName, undefined, ["checkout"]],
    ]);
    expect(
      references.every((reference: TelemetryFieldReference) => {
        return reference.serviceIds?.[0] === CHECKOUT;
      }),
    ).toBe(true);
  });

  test("an older view's filters, kept as numbered objects, are read too", () => {
    const references: Array<TelemetryFieldReference> =
      findTraceSavedViewFieldReferences({
        query: {
          filters: [{ "0": "attributes.user.email", "1": "a@b.co" }],
        },
      });

    expect(references).toHaveLength(1);
    expect(references[0]!.key).toBe("user.email");
  });

  test("an Exceptions view: attribute facets and search terms from spans and logs, free text the message", () => {
    const references: Array<TelemetryFieldReference> =
      findExceptionSavedViewFieldReferences({
        query: {
          search: "type:TypeError @user.email:a@b.co declined",
          filters: [["attributes.customer.id", "c-42"]],
        },
      });

    expect(
      references.map((reference: TelemetryFieldReference) => {
        return [reference.signal, reference.part, reference.key, reference.use];
      }),
    ).toEqual([
      [
        "trace",
        TelemetryFieldPart.Events,
        "customer.id",
        TelemetryFieldUse.Filter,
      ],
      [
        "log",
        TelemetryFieldPart.Attributes,
        "customer.id",
        TelemetryFieldUse.Filter,
      ],
      [
        "trace",
        TelemetryFieldPart.Events,
        "user.email",
        TelemetryFieldUse.Filter,
      ],
      [
        "log",
        TelemetryFieldPart.Attributes,
        "user.email",
        TelemetryFieldUse.Filter,
      ],
      ["trace", TelemetryFieldPart.Events, undefined, TelemetryFieldUse.Search],
      ["log", TelemetryFieldPart.Body, undefined, TelemetryFieldUse.Search],
    ]);
  });

  test("views with nothing readable read nothing", () => {
    expect(findLogSavedViewFieldReferences({ query: null })).toEqual([]);
    expect(findTraceSavedViewFieldReferences({ query: "x" })).toEqual([]);
    expect(findExceptionSavedViewFieldReferences({})).toEqual([]);
  });
});
