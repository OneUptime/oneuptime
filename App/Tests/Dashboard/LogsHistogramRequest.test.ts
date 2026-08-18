import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  buildLogsHistogramRequest,
  RESOURCE_FACET_KEYS,
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

describe("buildLogsHistogramRequest", () => {
  beforeEach(() => {
    /*
     * Only Date needs faking; the sinon backend jest 28 uses cannot hijack
     * the read-only `performance` global on current Node, so leave the
     * timer/callback APIs alone.
     */
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
