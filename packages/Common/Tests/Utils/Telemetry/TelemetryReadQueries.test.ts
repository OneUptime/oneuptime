import { describe, expect, test } from "@jest/globals";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import { TelemetryFieldPart } from "../../../Types/Telemetry/TelemetryFieldReaders";
import {
  findDashboardTelemetryQueries,
  findExceptionSavedViewTelemetryQueries,
  findLogRecordingRuleFieldReferences,
  findLogRecordingRuleTelemetryQueries,
  findLogSavedViewTelemetryQueries,
  findMonitorFieldReferences,
  findMonitorTelemetryQueries,
  findSloTelemetryQueries,
  findTraceRecordingRuleTelemetryQueries,
  findTraceSavedViewTelemetryQueries,
  readPinnedValues,
  TelemetryFieldReference,
  TelemetryReadQuery,
} from "../../../Utils/Telemetry/TelemetryFieldReferences";

/*
 * THE QUERIES A RECORD KEEPS RECORDS BY (#10436).
 *
 * A drop or sample filter takes whole records, so the lookup asks of each
 * query a saved record reads by - not each field - whether the filter can
 * take records it keeps. Each walker says, per query, the signal, the
 * services, the values it pins a field to, and the fields it reads; a
 * query that filters on nothing is a query too, reading every record of
 * its signal.
 */

const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000001043b1";

function monitorSteps(step: Record<string, unknown>): unknown {
  return {
    _type: "MonitorSteps",
    value: { monitorStepsInstanceArray: [{ data: step }] },
  };
}

describe("readPinnedValues: what a stored filter value keeps exactly", () => {
  test("a plain value is itself, as text", () => {
    expect(readPinnedValues("prod")).toEqual(["prod"]);
    expect(readPinnedValues(200)).toEqual(["200"]);
    expect(readPinnedValues(true)).toEqual(["true"]);
  });

  test("an Includes or an EqualTo is its values", () => {
    expect(
      readPinnedValues({ _type: "Includes", value: ["Error", "Fatal"] }),
    ).toEqual(["Error", "Fatal"]);
    expect(readPinnedValues({ _type: "EqualTo", value: "prod" })).toEqual([
      "prod",
    ]);
  });

  test("a search, a not, an empty text or a variable pins nothing", () => {
    expect(readPinnedValues({ _type: "Search", value: "prod" })).toBeNull();
    expect(readPinnedValues({ _type: "NotEqual", value: "prod" })).toBeNull();
    expect(readPinnedValues("")).toBeNull();
    expect(readPinnedValues("{{environment}}")).toBeNull();
    expect(readPinnedValues(null)).toBeNull();
    expect(readPinnedValues({ _type: "Includes", value: [{}] })).toBeNull();
  });
});

describe("monitors", () => {
  test("a Logs step: its services, severities and exact attributes", () => {
    const queries: Array<TelemetryReadQuery> = findMonitorTelemetryQueries(
      monitorSteps({
        logMonitor: {
          telemetryServiceIds: [CHECKOUT],
          severityTexts: ["Error", "Fatal"],
          attributes: {
            env: "prod",
            "http.route": { _type: "Search", value: "/api" },
          },
          body: "timeout",
        },
      }),
    );

    expect(queries).toHaveLength(1);
    expect(queries[0]!.signal).toBe("log");
    expect(queries[0]!.serviceIds).toEqual([CHECKOUT]);
    expect(queries[0]!.pinned).toEqual({
      "attributes.env": ["prod"],
      severityText: ["Error", "Fatal"],
    });
    expect(
      queries[0]!.references.map((reference: TelemetryFieldReference) => {
        return reference.part;
      }),
    ).toEqual([
      TelemetryFieldPart.Attributes,
      TelemetryFieldPart.Attributes,
      TelemetryFieldPart.Body,
    ]);
  });

  test("a Logs step that filters on nothing still reads every log of its services", () => {
    const queries: Array<TelemetryReadQuery> = findMonitorTelemetryQueries(
      monitorSteps({ logMonitor: { telemetryServiceIds: [CHECKOUT] } }),
    );

    expect(queries).toEqual([
      {
        signal: "log",
        serviceIds: [CHECKOUT],
        pinned: {},
        references: [],
      },
    ]);
  });

  test("a grouped Logs step's resolving log is a query of its own", () => {
    const queries: Array<TelemetryReadQuery> = findMonitorTelemetryQueries(
      monitorSteps({
        logMonitor: {
          attributes: { "event.name": "interface.down" },
          groupByAttributes: ["interface"],
          resolvedByAttributes: { "event.name": "interface.up" },
        },
      }),
    );

    expect(queries).toHaveLength(2);
    expect(queries[0]!.pinned).toEqual({
      "attributes.event.name": ["interface.down"],
    });
    expect(queries[1]!.pinned).toEqual({
      "attributes.event.name": ["interface.up"],
    });
  });

  test("a Traces step pins its span statuses", () => {
    const queries: Array<TelemetryReadQuery> = findMonitorTelemetryQueries(
      monitorSteps({
        traceMonitor: { spanStatuses: [2], spanName: "checkout" },
      }),
    );

    expect(queries).toHaveLength(1);
    expect(queries[0]!.signal).toBe("trace");
    expect(queries[0]!.pinned).toEqual({ statusCode: ["2"] });
  });

  test("an Exceptions step reads the spans and the logs its exceptions come from", () => {
    const queries: Array<TelemetryReadQuery> = findMonitorTelemetryQueries(
      monitorSteps({
        exceptionMonitor: { telemetryServiceIds: [CHECKOUT] },
      }),
    );

    expect(
      queries.map((query: TelemetryReadQuery) => {
        return [query.signal, query.serviceIds];
      }),
    ).toEqual([
      ["trace", [CHECKOUT]],
      ["log", [CHECKOUT]],
    ]);
  });

  test("the field references are every query's, in order, as the lookup has always read them", () => {
    const steps: unknown = monitorSteps({
      logMonitor: {
        attributes: { "event.name": "interface.down" },
        body: "down",
        groupByAttributes: ["interface"],
        resolvedByAttributes: { "event.name": "interface.up" },
      },
    });

    expect(findMonitorFieldReferences(steps)).toEqual(
      findMonitorTelemetryQueries(steps).flatMap(
        (query: TelemetryReadQuery): Array<TelemetryFieldReference> => {
          return query.references;
        },
      ),
    );
    expect(findMonitorFieldReferences(steps)).toHaveLength(4);
  });
});

describe("dashboards", () => {
  test("every log and trace widget, one that filters on nothing too; severities pinned, attributes left to the variables", () => {
    const found: ReturnType<typeof findDashboardTelemetryQueries> =
      findDashboardTelemetryQueries({
        _type: "DashboardViewConfig",
        components: [
          {
            _type: "DashboardComponent",
            componentId: {
              _type: "ObjectID",
              value: "0192f1a0-0000-7000-8000-0000001043c1",
            },
            componentType: DashboardComponentType.LogChart,
            arguments: {
              chartTitle: "Errors",
              severityFilters: ["Error"],
              attributeFilters: { env: "prod" },
            },
          },
          {
            _type: "DashboardComponent",
            componentId: {
              _type: "ObjectID",
              value: "0192f1a0-0000-7000-8000-0000001043c2",
            },
            componentType: DashboardComponentType.TraceChart,
            arguments: {},
          },
          {
            _type: "DashboardComponent",
            componentId: {
              _type: "ObjectID",
              value: "0192f1a0-0000-7000-8000-0000001043c3",
            },
            componentType: DashboardComponentType.Text,
            arguments: { text: "hello" },
          },
        ],
      });

    expect(
      found.widgets.map(
        (entry: {
          widget: { title: string; type: string };
          queries: Array<TelemetryReadQuery>;
        }) => {
          return [
            entry.widget.type,
            entry.widget.title,
            entry.queries[0]!.signal,
            entry.queries[0]!.pinned,
          ];
        },
      ),
    ).toEqual([
      [
        DashboardComponentType.LogChart,
        "Errors",
        "log",
        { severityText: ["Error"] },
      ],
      [DashboardComponentType.TraceChart, "", "trace", {}],
    ]);
  });
});

describe("recording rules", () => {
  test("a log rule: its services, severities and equality filters", () => {
    const definition: unknown = {
      filter: {
        telemetryServiceIds: [CHECKOUT],
        severityTexts: ["Error"],
        attributeFilters: [{ key: "env", value: "prod" }],
      },
      aggregationType: AggregationType.Count,
    };
    const queries: Array<TelemetryReadQuery> =
      findLogRecordingRuleTelemetryQueries(definition);

    expect(queries).toHaveLength(1);
    expect(queries[0]!.serviceIds).toEqual([CHECKOUT]);
    expect(queries[0]!.pinned).toEqual({
      "attributes.env": ["prod"],
      severityText: ["Error"],
    });
    expect(queries[0]!.references).toEqual(
      findLogRecordingRuleFieldReferences(definition),
    );
  });

  test("a trace rule: a query per source, its kind and its errors pinned", () => {
    const queries: Array<TelemetryReadQuery> =
      findTraceRecordingRuleTelemetryQueries({
        sources: [
          {
            alias: "A",
            aggregationType: "count",
            spanKind: "SPAN_KIND_SERVER",
            onlyErrors: true,
          },
          { alias: "B", aggregationType: "count" },
        ],
        expression: "A / B",
      });

    expect(
      queries.map((query: TelemetryReadQuery) => {
        return query.pinned;
      }),
    ).toEqual([{ kind: ["SPAN_KIND_SERVER"], statusCode: ["2"] }, {}]);
  });
});

describe("SLOs", () => {
  test("a request SLO reads the entry spans of its services, by its exact terms", () => {
    const queries: Array<TelemetryReadQuery> = findSloTelemetryQueries({
      sliType: SliType.RequestSuccess,
      requestFilter: '@http.route:/checkout name:"POST /checkout"',
      serviceIds: [CHECKOUT],
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.signal).toBe("trace");
    expect(queries[0]!.pinned).toEqual({
      isEntrySpan: ["true"],
      "attributes.http.route": ["/checkout"],
      name: ["POST /checkout"],
    });
  });

  test("an SLO of another kind, or of no service, reads no span", () => {
    expect(
      findSloTelemetryQueries({
        sliType: "Uptime",
        serviceIds: [CHECKOUT],
      }),
    ).toEqual([]);
    expect(
      findSloTelemetryQueries({
        sliType: SliType.RequestSuccess,
        serviceIds: [],
      }),
    ).toEqual([]);
  });
});

describe("saved views", () => {
  test("a Logs view: its severity and its exact attributes", () => {
    const queries: Array<TelemetryReadQuery> = findLogSavedViewTelemetryQueries(
      {
        query: {
          severityText: { _type: "Includes", value: ["Warning", "Error"] },
          attributes: { env: "prod" },
        },
      },
    );

    expect(queries[0]!.pinned).toEqual({
      "attributes.env": ["prod"],
      severityText: ["Warning", "Error"],
    });
  });

  test("a Traces view: a facet pins its values, an excluded one pins nothing", () => {
    const queries: Array<TelemetryReadQuery> =
      findTraceSavedViewTelemetryQueries({
        query: {
          filters: [
            ["attributes.env", "prod"],
            ["attributes.env", "staging"],
            ["!attributes.team", "core"],
            ["attributes.team", "payments"],
          ],
          // A term with a "-" keeps what it is not: it pins nothing.
          search: "@http.method:GET -@region:eu",
        },
      });

    expect(queries[0]!.pinned).toEqual({
      "attributes.env": ["prod", "staging"],
      "attributes.http.method": ["GET"],
    });
  });

  test("an Exceptions view reads the spans and the logs of its services", () => {
    const queries: Array<TelemetryReadQuery> =
      findExceptionSavedViewTelemetryQueries({
        query: { filters: [["serviceId", CHECKOUT]] },
      });

    expect(
      queries.map((query: TelemetryReadQuery) => {
        return [query.signal, query.serviceIds, query.pinned];
      }),
    ).toEqual([
      ["trace", [CHECKOUT], {}],
      ["log", [CHECKOUT], {}],
    ]);
  });
});
