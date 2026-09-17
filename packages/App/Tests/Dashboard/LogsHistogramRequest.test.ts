import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import { JSONObject } from "Common/Types/JSON";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  applyTypedLogFilterToRequest,
  buildLogsHistogramRequest,
  pickTypedLogFilter,
  preserveBaseAttributesInTypedFilter,
  RESOURCE_FACET_KEYS,
  serializeTypedLogFilter,
  TYPED_LOG_FILTER_KEYS,
} from "../../FeatureSet/Dashboard/src/Components/Logs/LogsHistogramRequest";

const NOW: Date = new Date("2026-08-05T12:00:00.000Z");

const PAST_ONE_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

function facets(
  entries: Record<string, Array<string>>,
): Map<string, Set<string>> {
  const map: Map<string, Set<string>> = new Map();

  for (const [key, values] of Object.entries(entries)) {
    map.set(key, new Set(values));
  }

  return map;
}

function build(
  overrides: Partial<Parameters<typeof buildLogsHistogramRequest>[0]> = {},
): JSONObject {
  return buildLogsHistogramRequest({
    timeRange: PAST_ONE_HOUR,
    appliedFacetFilters: new Map(),
    ...overrides,
  });
}

/*
 * Only Date needs faking; the sinon backend jest 28 uses cannot hijack the
 * read-only `performance` global on current Node, so leave the timer/callback
 * APIs alone.
 */
function freezeClock(): void {
  jest.useFakeTimers({
    doNotFake: [
      "performance",
      "hrtime",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  jest.setSystemTime(NOW);
}

describe("buildLogsHistogramRequest", () => {
  beforeEach(() => {
    freezeClock();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("time window", () => {
    test("resolves a preset range against the current clock", () => {
      expect(build()).toEqual({
        startTime: "2026-08-05T11:00:00.000Z",
        endTime: "2026-08-05T12:00:00.000Z",
      });
    });

    /*
     * The reason live mode works at all: every poll rebuilds the request, and
     * a preset range has to resolve against "now" each time so the window
     * slides forward onto logs that were ingested since the last poll.
     */
    test("slides the window forward as the clock moves", () => {
      const first: JSONObject = build();

      jest.setSystemTime(new Date("2026-08-05T12:00:10.000Z"));

      const second: JSONObject = build();

      expect(second["startTime"]).toBe("2026-08-05T11:00:10.000Z");
      expect(second["endTime"]).toBe("2026-08-05T12:00:10.000Z");
      expect(second["startTime"]).not.toBe(first["startTime"]);
      expect(second["endTime"]).not.toBe(first["endTime"]);
    });

    test("keeps the window still over repeated polls of a custom range", () => {
      const customRange: RangeStartAndEndDateTime = {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-08-01T00:00:00.000Z"),
          new Date("2026-08-01T06:00:00.000Z"),
        ),
      };

      const first: JSONObject = build({ timeRange: customRange });

      jest.setSystemTime(new Date("2026-08-05T18:30:00.000Z"));

      const second: JSONObject = build({ timeRange: customRange });

      expect(second).toEqual(first);
      expect(second).toEqual({
        startTime: "2026-08-01T00:00:00.000Z",
        endTime: "2026-08-01T06:00:00.000Z",
      });
    });

    test("resolves each preset range to its own width", () => {
      expect(build({ timeRange: { range: TimeRange.PAST_FIVE_MINS } })).toEqual(
        {
          startTime: "2026-08-05T11:55:00.000Z",
          endTime: "2026-08-05T12:00:00.000Z",
        },
      );

      expect(build({ timeRange: { range: TimeRange.PAST_ONE_DAY } })).toEqual({
        startTime: "2026-08-04T12:00:00.000Z",
        endTime: "2026-08-05T12:00:00.000Z",
      });
    });
  });

  describe("base scope from the host page", () => {
    test("sends nothing but the window when the viewer is unscoped", () => {
      expect(Object.keys(build()).sort()).toEqual(["endTime", "startTime"]);
    });

    test("passes service, trace and span scope through", () => {
      const request: JSONObject = build({
        serviceIds: ["service-1", "service-2"],
        traceIds: ["trace-1"],
        spanIds: ["span-1"],
      });

      expect(request["serviceIds"]).toEqual(["service-1", "service-2"]);
      expect(request["traceIds"]).toEqual(["trace-1"]);
      expect(request["spanIds"]).toEqual(["span-1"]);
    });

    test("passes attribute and entity-key scope through", () => {
      const request: JSONObject = build({
        attributes: { "resource.k8s.pod.name": "checkout-7d9" },
        entityKeys: ["host:abc", "container:def"],
      });

      expect(request["attributes"]).toEqual({
        "resource.k8s.pod.name": "checkout-7d9",
      });
      expect(request["entityKeys"]).toEqual(["host:abc", "container:def"]);
    });
  });

  describe("facet filters", () => {
    test("forwards selected severities", () => {
      const request: JSONObject = build({
        appliedFacetFilters: facets({ severityText: ["Error", "Fatal"] }),
      });

      expect(request["severityTexts"]).toEqual(["Error", "Fatal"]);
    });

    test("forwards selected traces and spans", () => {
      const request: JSONObject = build({
        appliedFacetFilters: facets({
          traceId: ["trace-9"],
          spanId: ["span-9"],
        }),
      });

      expect(request["traceIds"]).toEqual(["trace-9"]);
      expect(request["spanIds"]).toEqual(["span-9"]);
    });

    /*
     * Only the Services facet may ride `serviceIds` — that field becomes
     * `primaryEntityId IN (...)`, and for OTLP telemetry that column holds
     * the Service id. A host or cluster id sent there is compared against a
     * column it can never appear in, which is why the Kubernetes Cluster
     * facet returned no logs at all (issue #3216). Those facets ride
     * `resourceFilters` instead, where the server resolves each id to the
     * resource's entity key.
     */
    test("keeps non-Service resource facets out of the service list", () => {
      const request: JSONObject = build({
        appliedFacetFilters: facets({
          primaryEntityId: ["service-1"],
          hostId: ["host-1"],
          dockerHostId: ["docker-1"],
          podmanHostId: ["podman-1"],
          kubernetesClusterId: ["cluster-1"],
        }),
      });

      expect(request["serviceIds"]).toEqual(["service-1"]);
      expect(request["resourceFilters"]).toEqual({
        hostId: ["host-1"],
        dockerHostId: ["docker-1"],
        podmanHostId: ["podman-1"],
        kubernetesClusterId: ["cluster-1"],
      });
    });

    test("a cluster selection alone sends no serviceIds at all", () => {
      const request: JSONObject = build({
        appliedFacetFilters: facets({ kubernetesClusterId: ["cluster-1"] }),
      });

      /*
       * The bug in one assertion: this used to be
       * `serviceIds: ["cluster-1"]`, i.e. `primaryEntityId = '<clusterId>'`,
       * which matched zero collector-ingested rows.
       */
      expect(request["serviceIds"]).toBeUndefined();
      expect(request["resourceFilters"]).toEqual({
        kubernetesClusterId: ["cluster-1"],
      });
    });

    test("a cluster and a service are sent as two independent filters", () => {
      const request: JSONObject = build({
        appliedFacetFilters: facets({
          primaryEntityId: ["service-1"],
          kubernetesClusterId: ["cluster-1"],
        }),
      });

      /*
       * Sent apart, the server ANDs them. Coalesced into one IN list they
       * OR-ed, which is what made "cluster + service" look like it worked
       * while silently ignoring the cluster.
       */
      expect(request["serviceIds"]).toEqual(["service-1"]);
      expect(request["resourceFilters"]).toEqual({
        kubernetesClusterId: ["cluster-1"],
      });
    });

    test("de-duplicates a value selected under two Service facet aliases", () => {
      const request: JSONObject = build({
        appliedFacetFilters: facets({
          primaryEntityId: ["shared-id"],
          serviceId: ["shared-id"],
        }),
      });

      expect(request["serviceIds"]).toEqual(["shared-id"]);
    });

    test("multiple values inside one resource facet stay together", () => {
      const request: JSONObject = build({
        appliedFacetFilters: facets({
          kubernetesClusterId: ["cluster-1", "cluster-2"],
        }),
      });

      expect(request["resourceFilters"]).toEqual({
        kubernetesClusterId: ["cluster-1", "cluster-2"],
      });
    });

    test("covers every resource facet key the sidebar can produce", () => {
      for (const facetKey of RESOURCE_FACET_KEYS) {
        const request: JSONObject = build({
          appliedFacetFilters: facets({ [facetKey]: ["picked"] }),
        });

        const routed: unknown =
          request["serviceIds"] ??
          (request["resourceFilters"] as Record<string, Array<string>>)[
            facetKey
          ];

        // Every resource facet reaches the server through exactly one field.
        expect(routed).toEqual(["picked"]);
      }
    });

    test("a resource facet never leaks into the request as a bare key", () => {
      const request: JSONObject = build({
        appliedFacetFilters: facets({ kubernetesClusterId: ["cluster-1"] }),
      });

      expect(request["kubernetesClusterId"]).toBeUndefined();
    });

    test("narrows the page's own scope when a resource is picked", () => {
      const request: JSONObject = build({
        serviceIds: ["service-1", "service-2"],
        traceIds: ["trace-1"],
        spanIds: ["span-1"],
        appliedFacetFilters: facets({
          primaryEntityId: ["service-2"],
          traceId: ["trace-2"],
          spanId: ["span-2"],
        }),
      });

      expect(request["serviceIds"]).toEqual(["service-2"]);
      expect(request["traceIds"]).toEqual(["trace-2"]);
      expect(request["spanIds"]).toEqual(["span-2"]);
    });

    test("keeps the page's service scope when only a cluster is picked", () => {
      const request: JSONObject = build({
        serviceIds: ["service-1"],
        appliedFacetFilters: facets({ kubernetesClusterId: ["cluster-1"] }),
      });

      /*
       * The host page's scope must survive: a cluster chip narrows within
       * it, it does not replace it. Coalescing used to overwrite serviceIds
       * with the cluster id, which both broke the filter and silently
       * widened the view past the service the page is about.
       */
      expect(request["serviceIds"]).toEqual(["service-1"]);
      expect(request["resourceFilters"]).toEqual({
        kubernetesClusterId: ["cluster-1"],
      });
    });

    test("ignores facets whose last value was just removed", () => {
      const request: JSONObject = build({
        serviceIds: ["service-1"],
        appliedFacetFilters: facets({
          severityText: [],
          primaryEntityId: [],
          traceId: [],
          spanId: [],
          kubernetesClusterId: [],
        }),
      });

      expect(request["severityTexts"]).toBeUndefined();
      expect(request["traceIds"]).toBeUndefined();
      expect(request["spanIds"]).toBeUndefined();
      /*
       * An emptied resource facet must send nothing at all — an empty id
       * list would resolve to a scope with no branch, and a reader could
       * easily turn that into "match nothing".
       */
      expect(request["resourceFilters"]).toBeUndefined();
      // The page's own scope survives an emptied facet.
      expect(request["serviceIds"]).toEqual(["service-1"]);
    });

    test("does not mutate the caller's filter map", () => {
      const applied: Map<string, Set<string>> = facets({
        primaryEntityId: ["service-1"],
        hostId: ["host-1"],
      });

      build({ appliedFacetFilters: applied });

      expect(Array.from(applied.get("primaryEntityId") || [])).toEqual([
        "service-1",
      ]);
      expect(Array.from(applied.get("hostId") || [])).toEqual(["host-1"]);
    });
  });

  test("builds an equivalent request on every poll when nothing changed", () => {
    const applied: Map<string, Set<string>> = facets({
      severityText: ["Error"],
      hostId: ["host-1"],
    });

    const first: JSONObject = build({ appliedFacetFilters: applied });
    const second: JSONObject = build({ appliedFacetFilters: applied });

    expect(second).toEqual(first);
  });
});

/*
 * The body chip is the one facet whose predicate is a contains-match. The
 * histogram receives it under its own request field, or the chart would
 * keep counting rows the list no longer shows — which is exactly what a
 * deep link from Insights' Top Errors produces.
 */
describe("buildLogsHistogramRequest — body chips", () => {
  test("forwards a body chip as bodySearchText", () => {
    const request: JSONObject = build({
      appliedFacetFilters: facets({ body: ["connection refused"] }),
    });

    expect(request["bodySearchText"]).toBe("connection refused");
  });

  test("omits the field for an absent, empty or blank chip", () => {
    expect(build()["bodySearchText"]).toBeUndefined();
    expect(
      build({ appliedFacetFilters: facets({ body: [] }) })["bodySearchText"],
    ).toBeUndefined();
    expect(
      build({ appliedFacetFilters: facets({ body: ["   "] }) })[
        "bodySearchText"
      ],
    ).toBeUndefined();
  });

  test("a body chip does not disturb the other facet fields", () => {
    const request: JSONObject = build({
      appliedFacetFilters: facets({
        body: ["timeout"],
        severityText: ["Error"],
        primaryEntityId: ["svc-1"],
      }),
    });

    expect(request["bodySearchText"]).toBe("timeout");
    expect(request["severityTexts"]).toEqual(["Error"]);
    expect(request["serviceIds"]).toEqual(["svc-1"]);
  });
});

describe("buildLogsHistogramRequest - attribute chips reach the chart", () => {
  beforeEach(() => {
    freezeClock();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("an attributes.<key> chip is forwarded", () => {
    /*
     * Only the host page's pinned `logQuery.attributes` used to be sent, so a
     * chip the user could SEE applied narrowed the list while the chart above
     * it kept counting every row in the project.
     */
    const request: JSONObject = build({
      appliedFacetFilters: facets({ "attributes.platform.team": ["abc"] }),
    });

    expect(request["attributes"]).toEqual({ "platform.team": "abc" });
  });

  test("a wildcard chip is forwarded as the operator, not as literal text", () => {
    const request: JSONObject = build({
      appliedFacetFilters: facets({ "attributes.platform.team": ["a*"] }),
    });
    const attributes: JSONObject = request["attributes"] as JSONObject;

    expect(attributes["platform.team"]).toBeInstanceOf(Wildcard);
    expect(
      (attributes["platform.team"] as unknown as Wildcard<string>).toPatterns(),
    ).toEqual(["a%"]);
  });

  test("the operator survives JSON.stringify, which is how it is POSTed", () => {
    const request: JSONObject = build({
      appliedFacetFilters: facets({ "attributes.k": ["a*"] }),
    });

    expect(JSON.parse(JSON.stringify(request))["attributes"]).toEqual({
      k: { _type: "Wildcard", value: ["a*"] },
    });
  });

  test("several values on one key become an any-of", () => {
    const request: JSONObject = build({
      appliedFacetFilters: facets({ "attributes.k": ["a", "b"] }),
    });
    const attributes: JSONObject = request["attributes"] as JSONObject;

    expect(attributes["k"]).toBeInstanceOf(Includes);
  });

  test("pinned attributes and chips merge rather than one replacing the other", () => {
    const request: JSONObject = build({
      attributes: { pinned: "yes" } as never,
      appliedFacetFilters: facets({ "attributes.typed": ["a*"] }),
    });
    const attributes: JSONObject = request["attributes"] as JSONObject;

    expect(attributes["pinned"]).toBe("yes");
    expect(attributes["typed"]).toBeInstanceOf(Wildcard);
  });

  test("no attribute filters at all sends no attributes field", () => {
    expect(build()["attributes"]).toBeUndefined();
  });

  test("a non-attribute facet is not mistaken for one", () => {
    const request: JSONObject = build({
      appliedFacetFilters: facets({ severityText: ["Error"] }),
    });

    expect(request["attributes"]).toBeUndefined();
    expect(request["severityTexts"]).toEqual(["Error"]);
  });
});

/*
 * What the search bar typed reaches the list through the viewer's
 * filterOptions and nowhere else. These pin that the chart (and, through the
 * same helper, the facets) is built over the same rows the list shows —
 * before this, a pasted `@attr:value` narrowed the list while the chart
 * above it kept counting every row the page pinned.
 */
describe("typed search on the histogram request", () => {
  beforeEach(() => {
    freezeClock();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("an absent or irrelevant typed filter changes nothing", () => {
    /*
     * Against a literal, not against another build() of the same params —
     * two identical calls agree even when both are wrong.
     */
    const withoutKey: JSONObject = buildLogsHistogramRequest({
      timeRange: PAST_ONE_HOUR,
      appliedFacetFilters: facets({ severityText: ["Error"] }),
    });

    const expected: JSONObject = {
      startTime: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      endTime: NOW.toISOString(),
      severityTexts: ["Error"],
    };

    expect(withoutKey).toEqual(expected);
    expect(
      build({
        appliedFacetFilters: facets({ severityText: ["Error"] }),
        typedFilter: undefined,
      }),
    ).toEqual(expected);
    expect(
      build({
        appliedFacetFilters: facets({ severityText: ["Error"] }),
        typedFilter: {},
      }),
    ).toEqual(expected);
    expect(
      build({
        appliedFacetFilters: facets({ severityText: ["Error"] }),
        typedFilter: { time: new InBetween<Date>(NOW, NOW), unknown: "x" },
      }),
    ).toEqual(expected);
  });

  test("typed attributes merge over the base and chip attributes, typed keys winning", () => {
    const request: JSONObject = build({
      attributes: { pinned: "yes", shared: "base" } as never,
      appliedFacetFilters: facets({ "attributes.chip": ["c"] }),
      typedFilter: {
        attributes: { typed: "t", shared: "typed" },
      },
    });
    const attributes: JSONObject = request["attributes"] as JSONObject;

    expect(attributes["pinned"]).toBe("yes");
    expect(attributes["chip"]).toBe("c");
    expect(attributes["typed"]).toBe("t");
    expect(attributes["shared"]).toBe("typed");
  });

  test("a typed operator attribute passes through as the operator instance", () => {
    const includes: Includes = new Includes(["a", "b"]);
    const request: JSONObject = build({
      typedFilter: { attributes: { k: includes } },
    });
    const attributes: JSONObject = request["attributes"] as JSONObject;

    expect(attributes["k"]).toBe(includes);
  });

  test("typed severity, service, trace, span and session REPLACE the request's — a typed column is a drill-down, as it is for the list", () => {
    const request: JSONObject = build({
      serviceIds: ["base-service"],
      traceIds: ["base-trace"],
      typedFilter: {
        severityText: "Error",
        primaryEntityId: new Includes(["s-1", "s-2"]),
        traceId: "t-1",
        spanId: new Includes(["sp-1"]),
        sessionId: "sess-1",
      },
    });

    expect(request["severityTexts"]).toEqual(["Error"]);
    expect(request["serviceIds"]).toEqual(["s-1", "s-2"]);
    expect(request["traceIds"]).toEqual(["t-1"]);
    expect(request["spanIds"]).toEqual(["sp-1"]);
    expect(request["sessionIds"]).toEqual(["sess-1"]);
  });

  test("a typed body Search becomes bodySearchText; a plain-string body (an equality) is left to the list", () => {
    expect(
      build({ typedFilter: { body: new Search("out of memory") } })[
        "bodySearchText"
      ],
    ).toBe("out of memory");
    /*
     * `message:timeout` compiles to `body = 'timeout'`. The aggregate
     * endpoints only know a contains-match, which would count every line
     * containing the word above a table that shows the exact ones — so it
     * is not forwarded at all.
     */
    expect(
      build({ typedFilter: { body: "connection refused" } })["bodySearchText"],
    ).toBeUndefined();
    expect(
      build({ typedFilter: { body: new Search("   ") } })["bodySearchText"],
    ).toBeUndefined();
  });

  test("a typed body that is neither a Search nor a string is ignored", () => {
    expect(
      build({ typedFilter: { body: ["a", "b"] } })["bodySearchText"],
    ).toBeUndefined();
  });

  test("an operator the aggregate endpoints cannot express is left to the list", () => {
    const request: JSONObject = build({
      appliedFacetFilters: facets({ severityText: ["Error"] }),
      typedFilter: { severityText: { _type: "NotEqual", value: "Debug" } },
    });

    // The chip's own severity stays; the negation is neither applied nor lost as a crash.
    expect(request["severityTexts"]).toEqual(["Error"]);
  });

  test("time, entityScope and unknown keys of the list query are ignored", () => {
    const request: JSONObject = build({
      typedFilter: {
        time: new InBetween<Date>(NOW, NOW),
        entityScope: {
          entityKeys: ["k"],
          attributeKey: "a",
          attributeValue: "v",
        },
        somethingElse: "x",
      },
    });

    expect(request).toEqual(build());
  });
});

describe("applyTypedLogFilterToRequest", () => {
  test("mutates and returns the request it was given", () => {
    const request: JSONObject = { startTime: "a", endTime: "b" };

    expect(
      applyTypedLogFilterToRequest(request, { severityText: "Error" }),
    ).toBe(request);
    expect(request["severityTexts"]).toEqual(["Error"]);
  });

  test("tolerates a missing or non-object typed filter", () => {
    expect(applyTypedLogFilterToRequest({}, undefined)).toEqual({});
    expect(applyTypedLogFilterToRequest({}, "nope" as never)).toEqual({});
    expect(applyTypedLogFilterToRequest({}, { attributes: ["x"] })).toEqual({});
  });
});

/*
 * The search bar's submit spreads its parsed filter over the current query,
 * and a parsed `@attr:value` arrives as a FRESH `attributes` object — so on a
 * page scoped by attribute alone (a Docker host, a pod) one typed attribute
 * search replaced the page's scope in the list while the locked chip above
 * it still claimed it.
 */
describe("preserveBaseAttributesInTypedFilter", () => {
  test("the page's pinned attributes are kept under the typed ones", () => {
    const typed: Query<Log> = {
      attributes: { "http.status_code": "500" },
      severityText: "Error",
    } as unknown as Query<Log>;

    const merged: Query<Log> = preserveBaseAttributesInTypedFilter(typed, {
      "resource.host.name": "web-01",
      "resource.container.runtime": "docker",
    });

    expect((merged as Record<string, unknown>)["attributes"]).toEqual({
      "resource.host.name": "web-01",
      "resource.container.runtime": "docker",
      "http.status_code": "500",
    });
    // Everything else the bar produced is untouched.
    expect((merged as Record<string, unknown>)["severityText"]).toBe("Error");
    // The input is not mutated.
    expect((typed as Record<string, unknown>)["attributes"]).toEqual({
      "http.status_code": "500",
    });
  });

  test("a typed key with the same name as a pinned one wins — the drill-down precedence chips have", () => {
    const merged: Query<Log> = preserveBaseAttributesInTypedFilter(
      {
        attributes: { "resource.host.name": "web-02" },
      } as unknown as Query<Log>,
      { "resource.host.name": "web-01" },
    );

    expect((merged as Record<string, unknown>)["attributes"]).toEqual({
      "resource.host.name": "web-02",
    });
  });

  test("a submit that typed no attributes at all still restores the pinned ones", () => {
    const merged: Query<Log> = preserveBaseAttributesInTypedFilter(
      { severityText: "Error" } as unknown as Query<Log>,
      { "resource.host.name": "web-01" },
    );

    expect((merged as Record<string, unknown>)["attributes"]).toEqual({
      "resource.host.name": "web-01",
    });
  });

  test("with nothing pinned the filter is returned as-is", () => {
    const typed: Query<Log> = {
      attributes: { k: "v" },
    } as unknown as Query<Log>;

    expect(preserveBaseAttributesInTypedFilter(typed, undefined)).toBe(typed);
    expect(preserveBaseAttributesInTypedFilter(typed, {})).toBe(typed);
  });
});

/*
 * Two filters on one attribute key (`@k:a* @k:*b`, or a mixed chip group)
 * compile to an ARRAY of operators, which the list evaluates one by one but
 * the aggregate endpoints read as `IN (...)` — and an operator stringified
 * into an IN list is '[object Object]', a chart of nothing under a table of
 * rows. Such a value is left to the list on both paths.
 */
describe("attribute values the aggregate endpoints cannot express", () => {
  beforeEach(() => {
    freezeClock();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("a typed array of operators on one key is not forwarded", () => {
    const request: JSONObject = build({
      attributes: { pinned: "yes" } as never,
      typedFilter: {
        attributes: {
          "http.route": [new Wildcard(["/api%"]), new Wildcard(["%users"])],
          env: "prod",
        },
      },
    });
    const attributes: JSONObject = request["attributes"] as JSONObject;

    expect(attributes["http.route"]).toBeUndefined();
    // The keys that CAN be expressed still travel.
    expect(attributes["env"]).toBe("prod");
    expect(attributes["pinned"]).toBe("yes");
  });

  test("a mixed chip group (glob + contains) on one key is not forwarded either", () => {
    const request: JSONObject = build({
      appliedFacetFilters: facets({
        "attributes.http.route": ["/api*", "~users"],
        "attributes.env": ["prod"],
      }),
    });
    const attributes: JSONObject = request["attributes"] as JSONObject;

    expect(attributes["http.route"]).toBeUndefined();
    expect(attributes["env"]).toBe("prod");
  });

  test("a typed array on the ONLY key sends no attributes field at all", () => {
    const request: JSONObject = build({
      typedFilter: {
        attributes: { k: [new Search("a"), new Search("b")] },
      },
    });

    expect(request["attributes"]).toBeUndefined();
  });
});

/*
 * Host / cluster chips ride `resourceFilters` on the list query. The facets
 * endpoint resolves the same field, so forwarding it is what lets a cluster
 * selected in the sidebar scope the sidebar's own counts.
 */
describe("resource filters on the typed filter", () => {
  test("resourceFilters are forwarded verbatim", () => {
    const request: JSONObject = applyTypedLogFilterToRequest(
      {},
      {
        resourceFilters: {
          kubernetesClusterId: ["cluster-1"],
          hostId: ["host-1", "host-2"],
        },
      },
    );

    expect(request["resourceFilters"]).toEqual({
      kubernetesClusterId: ["cluster-1"],
      hostId: ["host-1", "host-2"],
    });
  });

  test("an empty, array-shaped or missing resourceFilters leaves the request alone", () => {
    expect(
      applyTypedLogFilterToRequest({}, { resourceFilters: {} })[
        "resourceFilters"
      ],
    ).toBeUndefined();
    expect(
      applyTypedLogFilterToRequest({}, { resourceFilters: ["x"] })[
        "resourceFilters"
      ],
    ).toBeUndefined();
    expect(
      applyTypedLogFilterToRequest({}, {})["resourceFilters"],
    ).toBeUndefined();
  });

  test("typed resourceFilters replace the chip-derived ones on the histogram (they are the same chips, compiled)", () => {
    const request: JSONObject = build({
      appliedFacetFilters: facets({ kubernetesClusterId: ["cluster-1"] }),
      typedFilter: {
        resourceFilters: { kubernetesClusterId: ["cluster-1"] },
      },
    });

    expect(request["resourceFilters"]).toEqual({
      kubernetesClusterId: ["cluster-1"],
    });
  });
});

/*
 * The aggregate fetchers are keyed on the SLICE of the list query they read,
 * compared by value — the list query object is rebuilt on every base-scope
 * pass, and keying on it refetched the chart and the facets twice per mount
 * and once with the previous scope on every host prop change.
 */
describe("pickTypedLogFilter / serializeTypedLogFilter", () => {
  test("picks exactly the keys applyTypedLogFilterToRequest reads", () => {
    expect(TYPED_LOG_FILTER_KEYS).toEqual([
      "attributes",
      "severityText",
      "primaryEntityId",
      "traceId",
      "spanId",
      "sessionId",
      "body",
      "resourceFilters",
    ]);

    const includes: Includes = new Includes(["s-1"]);
    /*
     * Typed as a plain record: contextually typing this literal against
     * Query<Log> is the TS2589 deep-instantiation the viewers sidestep the
     * same way, and the picker accepts either shape.
     */
    const listQuery: Record<string, unknown> = {
      attributes: { k: "v" },
      primaryEntityId: includes,
      time: new InBetween<Date>(NOW, NOW),
      entityScope: {
        entityKeys: ["e"],
        attributeKey: "a",
        attributeValue: "v",
      },
      resourceFilters: { hostId: ["h"] },
    };
    const picked: Record<string, unknown> | undefined =
      pickTypedLogFilter(listQuery);

    expect(picked).toEqual({
      attributes: { k: "v" },
      primaryEntityId: includes,
      resourceFilters: { hostId: ["h"] },
    });
    // The same instance, so the request carries the real operator.
    expect(picked!["primaryEntityId"]).toBe(includes);
  });

  test("nothing aggregate-relevant picks as undefined and serializes as the empty key", () => {
    expect(pickTypedLogFilter({ time: new InBetween<Date>(NOW, NOW) })).toBe(
      undefined,
    );
    expect(pickTypedLogFilter(undefined)).toBeUndefined();
    expect(pickTypedLogFilter("nope" as never)).toBeUndefined();
    expect(
      serializeTypedLogFilter({ time: new InBetween<Date>(NOW, NOW) }),
    ).toBe("");
    expect(serializeTypedLogFilter(undefined)).toBe("");
  });

  test("equal content is the same key however many times the query was rebuilt", () => {
    // Plain records, not Query<Log> literals: see the TS2589 note above.
    const firstQuery: Record<string, unknown> = {
      attributes: { k: "v" },
      primaryEntityId: new Includes(["s-1", "s-2"]),
      body: new Search("boom"),
      time: new InBetween<Date>(NOW, NOW),
    };
    const rebuiltQuery: Record<string, unknown> = {
      attributes: { k: "v" },
      primaryEntityId: new Includes(["s-1", "s-2"]),
      body: new Search("boom"),
      time: new InBetween<Date>(new Date(0), new Date(1)),
    };
    const first: string = serializeTypedLogFilter(firstQuery);
    const rebuilt: string = serializeTypedLogFilter(rebuiltQuery);

    expect(rebuilt).toBe(first);
    expect(first.length).toBeGreaterThan(0);
  });

  test("a change in what would be sent is a different key", () => {
    const base: Record<string, unknown> = {
      attributes: { k: "v" },
      primaryEntityId: new Includes(["s-1"]),
    };

    expect(
      serializeTypedLogFilter({
        ...base,
        primaryEntityId: new Includes(["s-2"]),
      }),
    ).not.toBe(serializeTypedLogFilter(base));
    expect(
      serializeTypedLogFilter({ ...base, attributes: { k: "w" } }),
    ).not.toBe(serializeTypedLogFilter(base));
    expect(
      serializeTypedLogFilter({ ...base, severityText: "Error" }),
    ).not.toBe(serializeTypedLogFilter(base));
  });

  test("operators serialize through their wire shape, so the key survives JSON like the request does", () => {
    const key: string = serializeTypedLogFilter({
      attributes: { k: new Wildcard(["a%"]) },
    });

    expect(JSON.parse(key)).toEqual({
      attributes: { k: { _type: "Wildcard", value: ["a%"] } },
    });
  });
});
