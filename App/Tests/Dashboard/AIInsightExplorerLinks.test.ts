import { beforeAll, describe, expect, test } from "@jest/globals";
import AIInsightType from "Common/Types/AI/AIInsightType";
import Route from "Common/Types/API/Route";
import TimeRange from "Common/Types/Time/TimeRange";
import MetricExplorerUrl, {
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";
import type {
  AIInsightExplorerLink,
  AIInsightExplorerLinkInput,
  InsightDetectionWindow,
} from "../../FeatureSet/Dashboard/src/Utils/AIInsightExplorerLinks";

/*
 * The AI-insight -> explorer deep links: every deterministic detector maps
 * 1:1 to one explorer surface, scoped to the service / severity / metric
 * and the detection window the detector actually looked at. Each mapping is
 * exercised on its happy path, its degraded fallbacks (no service id, no
 * window anchor, no per-type essential field), and the malformed inputs a
 * JSON row can always carry — an unknown insight type must yield no action,
 * never a crash or a broken route.
 */

type LinksModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/AIInsightExplorerLinks");

let Links: LinksModule;

const LAST_SEEN: Date = new Date("2026-08-14T10:00:00.000Z");
const SERVICE_ID: string = "0195d6c1-0000-7000-8000-000000000001";
const EXCEPTION_ID: string = "0195d6c1-0000-7000-8000-0000000000ff";

/*
 * OTel names are free-form, so any of these can arrive as a service name,
 * metric name, or (malformed) exception id. The tilde entries are the
 * historic crasher: encodeURIComponent leaves "~" bare and Route's
 * character whitelist rejects it, so the old builder threw out of render.
 * The rest sweep every encoding branch — characters that percent-encode,
 * characters Route accepts raw, quoting/fallback branches of the traces
 * search-token grammar, multi-byte text, and control whitespace.
 */
import {
  SearchToken,
  parseSearchQuery,
  parseSearchValue,
} from "Common/Types/Telemetry/TelemetrySearchQuery";

const URL_HOSTILE_VALUES: Array<string> = [
  "svc~canary",
  "~tilde-first",
  'quoted "eu west"',
  "spaces and 100%",
  "{braces}<angle>|pipe",
  "back\\slash `tick` ^caret",
  "plus+amp&eq=q?hash#",
  "emoji 🚀 café",
  "line\nbreak\ttab",
];

/*
 * Common/UI/Config reads `window` the moment it loads, and the link util
 * pulls it in transitively via RouteMap -> ProjectUtil, so the browser stub
 * has to exist before the deferred import runs. Same approach as
 * LogsCrossSignalPivot.test.ts.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Links = await import(
    "../../FeatureSet/Dashboard/src/Utils/AIInsightExplorerLinks"
  );
});

/*
 * Split a built route at its "?" and hand back the query through
 * URLSearchParams — the exact single-decode every target explorer applies
 * (LogsViewer / TracesViewer / ExceptionsViewer readInitialUrlState, and
 * Navigation.getQueryStringByName for the metric explorer). Values that
 * were encoded exactly once therefore come back verbatim.
 */
function queryOf(route: { toString(): string }): URLSearchParams {
  const routeString: string = route.toString();
  const queryIndex: number = routeString.indexOf("?");

  return new URLSearchParams(
    queryIndex >= 0 ? routeString.substring(queryIndex + 1) : "",
  );
}

function pathOf(route: { toString(): string }): string {
  const routeString: string = route.toString();
  const queryIndex: number = routeString.indexOf("?");

  return queryIndex >= 0 ? routeString.substring(0, queryIndex) : routeString;
}

function input(
  overrides: Partial<AIInsightExplorerLinkInput> = {},
): AIInsightExplorerLinkInput {
  return {
    insightType: AIInsightType.ErrorLogSpike,
    lastSeenAt: LAST_SEEN,
    ...overrides,
  };
}

describe("getInsightDetectionWindow", () => {
  test("anchors every window at lastSeenAt with the per-type size", () => {
    const cases: Array<{ insightType: string; expectedStart: string }> = [
      {
        insightType: AIInsightType.ErrorLogSpike,
        expectedStart: "2026-08-14T09:00:00.000Z",
      },
      {
        insightType: AIInsightType.TraceLatencyRegression,
        expectedStart: "2026-08-14T09:00:00.000Z",
      },
      {
        insightType: AIInsightType.MetricDrift,
        expectedStart: "2026-07-31T10:00:00.000Z",
      },
      {
        insightType: AIInsightType.NewException,
        expectedStart: "2026-08-13T10:00:00.000Z",
      },
      {
        insightType: AIInsightType.ExceptionSpike,
        expectedStart: "2026-08-13T10:00:00.000Z",
      },
    ];

    for (const testCase of cases) {
      const window: InsightDetectionWindow | null =
        Links.getInsightDetectionWindow({
          insightType: testCase.insightType,
          lastSeenAt: LAST_SEEN,
        });

      expect(window).not.toBeNull();
      expect(window!.startTime.toISOString()).toBe(testCase.expectedStart);
      expect(window!.endTime.toISOString()).toBe(LAST_SEEN.toISOString());
    }
  });

  test("the evidence's own spike window wins for ErrorLogSpike", () => {
    const window: InsightDetectionWindow | null =
      Links.getInsightDetectionWindow({
        insightType: AIInsightType.ErrorLogSpike,
        lastSeenAt: LAST_SEEN,
        spikeWindowMinutes: 30,
      });

    expect(window!.startTime.toISOString()).toBe("2026-08-14T09:30:00.000Z");
  });

  test("malformed spike-window minutes fall back to the default", () => {
    for (const spikeWindowMinutes of [0, -5, NaN, Infinity]) {
      const window: InsightDetectionWindow | null =
        Links.getInsightDetectionWindow({
          insightType: AIInsightType.ErrorLogSpike,
          lastSeenAt: LAST_SEEN,
          spikeWindowMinutes,
        });

      expect(window!.startTime.toISOString()).toBe("2026-08-14T09:00:00.000Z");
    }
  });

  test("accepts the ISO string a JSON row carries instead of a Date", () => {
    const window: InsightDetectionWindow | null =
      Links.getInsightDetectionWindow({
        insightType: AIInsightType.NewException,
        lastSeenAt: "2026-08-14T10:00:00.000Z",
      });

    expect(window!.endTime.toISOString()).toBe(LAST_SEEN.toISOString());
  });

  test("no anchor, an unparseable anchor, or an unknown type yields null", () => {
    expect(
      Links.getInsightDetectionWindow({
        insightType: AIInsightType.ErrorLogSpike,
      }),
    ).toBeNull();

    expect(
      Links.getInsightDetectionWindow({
        insightType: AIInsightType.ErrorLogSpike,
        lastSeenAt: "not-a-date",
      }),
    ).toBeNull();

    expect(
      Links.getInsightDetectionWindow({
        insightType: "SomeFutureDetector",
        lastSeenAt: LAST_SEEN,
      }),
    ).toBeNull();
  });
});

describe("buildInsightInvestigationLink — MetricDrift", () => {
  test("routes to the metric explorer with the metric name and both comparison weeks", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink(
        input({
          insightType: AIInsightType.MetricDrift,
          metricName: "cpu.usage",
        }),
      );

    expect(link).not.toBeNull();
    expect(link!.target).toBe("metrics");
    expect(link!.label).toBe("Investigate in Metrics");
    expect(link!.dropped).toEqual([]);
    expect(pathOf(link!.route)).toContain("/metrics/view");

    const query: URLSearchParams = queryOf(link!.route);

    // The exact parse the metric explorer applies to the param.
    const queries: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(query.get("metricQueries")!);

    expect(queries).toHaveLength(1);
    expect(queries[0]!.metricName).toBe("cpu.usage");
    expect(queries[0]!.attributes).toEqual({});

    expect(query.get("startTime")).toBe("2026-07-31T10:00:00.000Z");
    expect(query.get("endTime")).toBe("2026-08-14T10:00:00.000Z");
    // A pinned Custom window is absolute params only — no range token.
    expect(query.get("range")).toBeNull();
  });

  test("carries the service as the resource.service.name attribute filter", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink(
        input({
          insightType: AIInsightType.MetricDrift,
          metricName: "http.server.duration",
          serviceName: "checkout",
        }),
      );

    const queries: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(
        queryOf(link!.route).get("metricQueries")!,
      );

    expect(queries[0]!.attributes).toEqual({
      "resource.service.name": "checkout",
    });
  });

  test("no usable metric name means no action", () => {
    expect(
      Links.buildInsightInvestigationLink(
        input({ insightType: AIInsightType.MetricDrift }),
      ),
    ).toBeNull();
    expect(
      Links.buildInsightInvestigationLink(
        input({ insightType: AIInsightType.MetricDrift, metricName: "   " }),
      ),
    ).toBeNull();
  });

  test("a missing window anchor still builds a link, just without the pinned window", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink({
        insightType: AIInsightType.MetricDrift,
        metricName: "cpu.usage",
      });

    expect(link).not.toBeNull();

    const query: URLSearchParams = queryOf(link!.route);

    expect(query.get("metricQueries")).not.toBeNull();
    expect(query.get("startTime")).toBeNull();
    expect(query.get("endTime")).toBeNull();
  });
});

describe("buildInsightInvestigationLink — ErrorLogSpike", () => {
  test("routes to the logs explorer with Error/Fatal severities, service scope and the spike window", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink(
        input({
          serviceName: "checkout",
          serviceId: SERVICE_ID,
        }),
      );

    expect(link).not.toBeNull();
    expect(link!.target).toBe("logs");
    expect(link!.label).toBe("Investigate in Logs");
    expect(link!.dropped).toEqual([]);
    expect(pathOf(link!.route)).toContain("/logs");

    const query: URLSearchParams = queryOf(link!.route);

    // The exact tuple shape LogsViewer.readInitialUrlState JSON.parses.
    const filters: Array<[string, Array<string>]> = JSON.parse(
      query.get("filters")!,
    );

    expect(filters).toEqual([
      ["severityText", ["Error", "Fatal"]],
      ["primaryEntityId", [SERVICE_ID]],
    ]);

    expect(query.get("range")).toBe(TimeRange.CUSTOM);
    expect(query.get("start")).toBe("2026-08-14T09:00:00.000Z");
    expect(query.get("end")).toBe("2026-08-14T10:00:00.000Z");
  });

  test("an unresolved service name degrades to a resource.service.name attribute filter", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink(input({ serviceName: "checkout" }));

    const filters: Array<[string, Array<string>]> = JSON.parse(
      queryOf(link!.route).get("filters")!,
    );

    expect(filters).toEqual([
      ["severityText", ["Error", "Fatal"]],
      ["attributes.resource.service.name", ["checkout"]],
    ]);
    expect(link!.dropped).toEqual([]);
  });

  test("a project-wide spike (no service at all) still links, severity + window only", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink(input({ spikeWindowMinutes: 30 }));

    const query: URLSearchParams = queryOf(link!.route);
    const filters: Array<[string, Array<string>]> = JSON.parse(
      query.get("filters")!,
    );

    expect(filters).toEqual([["severityText", ["Error", "Fatal"]]]);
    expect(query.get("start")).toBe("2026-08-14T09:30:00.000Z");
  });

  test("no window anchor drops only the pinned range, never the link", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink({
        insightType: AIInsightType.ErrorLogSpike,
        serviceId: SERVICE_ID,
      });

    expect(link).not.toBeNull();

    const query: URLSearchParams = queryOf(link!.route);

    expect(query.get("range")).toBeNull();
    expect(query.get("start")).toBeNull();
    expect(link!.dropped).toEqual([]);
  });
});

describe("buildInsightInvestigationLink — TraceLatencyRegression", () => {
  test("routes to the traces explorer with service scope and the recent-p99 window", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink(
        input({
          insightType: AIInsightType.TraceLatencyRegression,
          serviceName: "checkout",
          serviceId: SERVICE_ID,
        }),
      );

    expect(link).not.toBeNull();
    expect(link!.target).toBe("traces");
    expect(link!.label).toBe("Investigate in Traces");
    expect(link!.dropped).toEqual([]);
    expect(pathOf(link!.route)).toContain("/traces");

    const query: URLSearchParams = queryOf(link!.route);

    // The pair shape TracesViewer.readInitialUrlState JSON.parses.
    const filters: Array<[string, string]> = JSON.parse(query.get("filters")!);

    expect(filters).toEqual([["primaryEntityId", SERVICE_ID]]);
    expect(query.get("range")).toBe(TimeRange.CUSTOM);
    expect(query.get("start")).toBe("2026-08-14T09:00:00.000Z");
    expect(query.get("end")).toBe("2026-08-14T10:00:00.000Z");
  });

  test("an unresolved service name rides as an @resource.service.name search token", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink(
        input({
          insightType: AIInsightType.TraceLatencyRegression,
          serviceName: "checkout",
        }),
      );

    const query: URLSearchParams = queryOf(link!.route);

    expect(query.get("search")).toBe("@resource.service.name:checkout");
    expect(query.get("filters")).toBeNull();
    expect(link!.dropped).toEqual([]);
  });
});

describe("buildInsightInvestigationLink — NewException / ExceptionSpike", () => {
  test("links straight to the exception group when the insight stores its id", () => {
    for (const insightType of [
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
    ]) {
      const link: AIInsightExplorerLink | null =
        Links.buildInsightInvestigationLink(
          input({
            insightType,
            telemetryExceptionId: EXCEPTION_ID,
            serviceName: "checkout",
          }),
        );

      expect(link).not.toBeNull();
      expect(link!.target).toBe("exceptions");
      expect(link!.label).toBe("View Exception Group");
      expect(link!.dropped).toEqual([]);
      expect(pathOf(link!.route)).toContain(`/exceptions/${EXCEPTION_ID}`);
      expect(link!.route.toString()).not.toContain("?");
    }
  });

  test("falls back to the exceptions list scoped to service + window, keeping closed groups visible", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink(
        input({
          insightType: AIInsightType.ExceptionSpike,
          serviceId: SERVICE_ID,
        }),
      );

    expect(link!.label).toBe("Investigate in Exceptions");
    expect(pathOf(link!.route)).toContain("/exceptions/unresolved");

    const query: URLSearchParams = queryOf(link!.route);

    expect(query.get("status")).toBe("all");

    // The pair shape ExceptionsViewer.readInitialUrlState JSON.parses.
    const filters: Array<[string, string]> = JSON.parse(query.get("filters")!);

    expect(filters).toEqual([["primaryEntityId", SERVICE_ID]]);
    expect(query.get("range")).toBe(TimeRange.CUSTOM);
    expect(query.get("start")).toBe("2026-08-13T10:00:00.000Z");
    expect(query.get("end")).toBe("2026-08-14T10:00:00.000Z");
    expect(link!.dropped).toEqual([]);
  });

  test("a service name that never resolved to an id is reported dropped, not compiled into a dead filter", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink(
        input({
          insightType: AIInsightType.NewException,
          serviceName: "checkout",
        }),
      );

    const query: URLSearchParams = queryOf(link!.route);

    expect(query.get("filters")).toBeNull();
    expect(query.get("status")).toBe("all");
    expect(link!.dropped).toEqual(["serviceIds"]);
  });

  test("with neither exception id nor window anchor the list link still builds", () => {
    const link: AIInsightExplorerLink | null =
      Links.buildInsightInvestigationLink({
        insightType: AIInsightType.NewException,
      });

    expect(link).not.toBeNull();

    const query: URLSearchParams = queryOf(link!.route);

    expect(query.get("status")).toBe("all");
    expect(query.get("range")).toBeNull();
    expect(link!.dropped).toEqual([]);
  });
});

describe("buildInsightInvestigationLink — unknown input", () => {
  test("an unknown or absent insight type yields no action rather than a crash", () => {
    expect(
      Links.buildInsightInvestigationLink(
        input({ insightType: "SomeFutureDetector" }),
      ),
    ).toBeNull();
    expect(
      Links.buildInsightInvestigationLink(input({ insightType: undefined })),
    ).toBeNull();
    expect(Links.buildInsightInvestigationLink({})).toBeNull();
  });

  test("every built route survives Route's character validation (single-encoded params)", () => {
    /*
     * Route's setter rejects raw spaces/quotes/braces outright — building
     * with a value that needs encoding would THROW here, not produce a
     * broken href. A service name with spaces and quotes exercises the
     * worst case through every target grammar.
     */
    const hostileName: string = 'checkout "eu west" 100%';

    Object.values(AIInsightType).forEach((insightType: AIInsightType) => {
      expect(() => {
        Links.buildInsightInvestigationLink(
          input({
            insightType,
            serviceName: hostileName,
            metricName: "cpu usage (5m)",
          }),
        );
      }).not.toThrow();
    });
  });
});

describe("buildInsightInvestigationLink — tilde-bearing content", () => {
  /*
   * "~" is the one character encodeURIComponent leaves bare that Route's
   * whitelist rejects, so before the builder escaped it these inputs threw
   * BadDataException out of the row renderer and took down the whole AI
   * Insights page.
   */
  test("ErrorLogSpike with an unresolved 'svc~canary' service builds a round-tripping logs link", () => {
    const build: () => AIInsightExplorerLink | null =
      (): AIInsightExplorerLink | null => {
        return Links.buildInsightInvestigationLink(
          input({ serviceName: "svc~canary" }),
        );
      };

    expect(build).not.toThrow();

    const link: AIInsightExplorerLink | null = build();

    expect(link).not.toBeNull();

    const filters: Array<[string, Array<string>]> = JSON.parse(
      queryOf(link!.route).get("filters")!,
    );

    expect(filters).toEqual([
      ["severityText", ["Error", "Fatal"]],
      ["attributes.resource.service.name", ["svc~canary"]],
    ]);
  });

  test("TraceLatencyRegression with 'svc~canary' keeps the search token intact", () => {
    const build: () => AIInsightExplorerLink | null =
      (): AIInsightExplorerLink | null => {
        return Links.buildInsightInvestigationLink(
          input({
            insightType: AIInsightType.TraceLatencyRegression,
            serviceName: "svc~canary",
          }),
        );
      };

    expect(build).not.toThrow();

    const link: AIInsightExplorerLink | null = build();

    expect(link).not.toBeNull();
    expect(queryOf(link!.route).get("search")).toBe(
      "@resource.service.name:svc~canary",
    );
  });

  test("MetricDrift with tildes in both names builds even when a service id is present", () => {
    /*
     * buildMetricExplorerRoute never takes a service id — it always embeds
     * the NAME as an attribute — so a stored telemetryServiceId did not
     * save a tilde-bearing service from the old throw.
     */
    [SERVICE_ID, undefined].forEach((serviceId: string | undefined) => {
      const build: () => AIInsightExplorerLink | null =
        (): AIInsightExplorerLink | null => {
          return Links.buildInsightInvestigationLink(
            input({
              insightType: AIInsightType.MetricDrift,
              metricName: "metric~name",
              serviceName: "svc~canary",
              serviceId,
            }),
          );
        };

      expect(build).not.toThrow();

      const link: AIInsightExplorerLink | null = build();

      expect(link).not.toBeNull();

      const queries: Array<SerializedMetricQuery> =
        MetricExplorerUrl.parseMetricQueriesParam(
          queryOf(link!.route).get("metricQueries")!,
        );

      expect(queries[0]!.metricName).toBe("metric~name");
      expect(queries[0]!.attributes).toEqual({
        "resource.service.name": "svc~canary",
      });
    });
  });

  test("a malformed telemetryExceptionId degrades to the scoped list, never a throw", () => {
    /*
     * The exception id rides in the route PATH, so Route's whitelist
     * applies to it raw — a malformed JSON value must fall through to the
     * list fallback instead of throwing out of populateRouteParams.
     */
    const build: () => AIInsightExplorerLink | null =
      (): AIInsightExplorerLink | null => {
        return Links.buildInsightInvestigationLink(
          input({
            insightType: AIInsightType.NewException,
            telemetryExceptionId: "bad id~{}",
            serviceId: SERVICE_ID,
          }),
        );
      };

    expect(build).not.toThrow();

    const link: AIInsightExplorerLink | null = build();

    expect(link).not.toBeNull();
    expect(link!.label).toBe("Investigate in Exceptions");

    const query: URLSearchParams = queryOf(link!.route);

    expect(query.get("status")).toBe("all");
    expect(JSON.parse(query.get("filters")!)).toEqual([
      ["primaryEntityId", SERVICE_ID],
    ]);
  });
});

describe("buildInsightInvestigationLink — URL-hostile character sweep", () => {
  test("every hostile value builds a usable link for every insight type — never a throw", () => {
    Object.values(AIInsightType).forEach((insightType: AIInsightType) => {
      URL_HOSTILE_VALUES.forEach((hostileValue: string) => {
        const build: () => AIInsightExplorerLink | null =
          (): AIInsightExplorerLink | null => {
            return Links.buildInsightInvestigationLink(
              input({
                insightType,
                serviceName: hostileValue,
                metricName: hostileValue,
                telemetryExceptionId: hostileValue,
              }),
            );
          };

        expect(build).not.toThrow();

        const link: AIInsightExplorerLink | null = build();

        expect(link).not.toBeNull();

        const query: URLSearchParams = queryOf(link!.route);

        switch (insightType) {
          case AIInsightType.MetricDrift: {
            const queries: Array<SerializedMetricQuery> =
              MetricExplorerUrl.parseMetricQueriesParam(
                query.get("metricQueries")!,
              );

            expect(queries[0]!.metricName).toBe(hostileValue);
            expect(queries[0]!.attributes).toEqual({
              "resource.service.name": hostileValue,
            });
            break;
          }

          case AIInsightType.ErrorLogSpike: {
            const filters: Array<[string, Array<string>]> = JSON.parse(
              query.get("filters")!,
            );

            expect(filters).toContainEqual([
              "attributes.resource.service.name",
              [hostileValue],
            ]);
            break;
          }

          case AIInsightType.TraceLatencyRegression: {
            /*
             * The traces grammar carries the value in `search`, escaped
             * where a character would otherwise read as an operator, and
             * quarantines anything it still cannot express in `filters`.
             *
             * The assertion is a ROUND TRIP rather than a substring match:
             * a value carrying `*`, `~` or a quote is deliberately not
             * present verbatim, and requiring it to be would push the
             * builder back to emitting tokens that mean something other
             * than the value they came from.
             */
            const searchParam: string = query.get("search") || "";
            const filterTuples: Array<[string, string]> = JSON.parse(
              query.get("filters") || "[]",
            );

            const parsedValues: Array<string> = parseSearchQuery(
              searchParam,
            ).map((token: SearchToken) => {
              return token.predicate.value;
            });

            const carried: boolean =
              parsedValues.includes(hostileValue) ||
              filterTuples.some((tuple: [string, string]) => {
                /*
                 * A chip value is re-parsed by the same grammar when the
                 * explorer compiles its query, so the fallback carries an
                 * escaped token too — a raw `/api/*` would come back as a
                 * wildcard matching far more than the scope asked for.
                 */
                return parseSearchValue(tuple[1]).value === hostileValue;
              });

            expect(carried).toBe(true);
            break;
          }

          default: {
            /*
             * NewException / ExceptionSpike: a route-representable id
             * links to the group page, anything else falls back to the
             * scoped list — both are usable, neither throws.
             */
            expect(["View Exception Group", "Investigate in Exceptions"]) //
              .toContain(link!.label);
            break;
          }
        }
      });
    });
  });
});

describe("encodeRouteQueryParamValue", () => {
  test("escapes the tilde encodeURIComponent leaves bare", () => {
    expect(Links.encodeRouteQueryParamValue("svc~canary")).toBe("svc%7Ecanary");
    expect(Links.encodeRouteQueryParamValue("~~~")).toBe("%7E%7E%7E");
  });

  test("stays a single decode under the explorers' URLSearchParams parse", () => {
    for (const hostileValue of URL_HOSTILE_VALUES) {
      const params: URLSearchParams = new URLSearchParams(
        `v=${Links.encodeRouteQueryParamValue(hostileValue)}`,
      );

      expect(params.get("v")).toBe(hostileValue);
    }
  });

  test("output always lands inside Route's character whitelist", () => {
    // Pins the fix at its root: Route itself must accept every encoding.
    URL_HOSTILE_VALUES.forEach((hostileValue: string) => {
      expect(() => {
        new Route("/test").addQueryParams({
          v: Links.encodeRouteQueryParamValue(hostileValue),
        });
      }).not.toThrow();
    });
  });
});

describe("constants", () => {
  test("the degraded service scope rides the semconv resource attribute key", () => {
    /*
     * Pins the local literal to the ingest-side contract (and to
     * MetricsCrossSignalPivot.SERVICE_NAME_ATTRIBUTE_KEY, which carries
     * the same value — that module's import graph reaches ModelAPI's
     * React components, so the pure util deliberately does not import it).
     */
    expect(Links.SERVICE_NAME_ATTRIBUTE_KEY).toBe("resource.service.name");
    expect(Links.ERROR_LOG_SPIKE_SEVERITIES).toEqual(["Error", "Fatal"]);
  });
});

describe("buildMetricExplorerRoute", () => {
  test("null without a usable metric name", () => {
    expect(Links.buildMetricExplorerRoute({})).toBeNull();
    expect(Links.buildMetricExplorerRoute({ metricName: "  " })).toBeNull();
  });

  test("builds the same explorer view the MetricDrift investigate action uses", () => {
    const route: ReturnType<LinksModule["buildMetricExplorerRoute"]> =
      Links.buildMetricExplorerRoute({
        metricName: "cpu.usage",
        lastSeenAt: LAST_SEEN,
      });

    expect(route).not.toBeNull();
    expect(pathOf(route!)).toContain("/metrics/view");

    const query: URLSearchParams = queryOf(route!);
    const queries: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(query.get("metricQueries")!);

    expect(queries[0]!.metricName).toBe("cpu.usage");
    expect(query.get("startTime")).toBe("2026-07-31T10:00:00.000Z");
  });

  test("survives tilde-bearing metric and service names without a throw", () => {
    const build: () => ReturnType<
      LinksModule["buildMetricExplorerRoute"]
    > = (): ReturnType<LinksModule["buildMetricExplorerRoute"]> => {
      return Links.buildMetricExplorerRoute({
        metricName: "cpu~usage",
        serviceName: "svc~canary",
        lastSeenAt: LAST_SEEN,
      });
    };

    expect(build).not.toThrow();

    const route: ReturnType<LinksModule["buildMetricExplorerRoute"]> = build();

    expect(route).not.toBeNull();

    const queries: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(
        queryOf(route!).get("metricQueries")!,
      );

    expect(queries[0]!.metricName).toBe("cpu~usage");
    expect(queries[0]!.attributes).toEqual({
      "resource.service.name": "svc~canary",
    });
  });
});
