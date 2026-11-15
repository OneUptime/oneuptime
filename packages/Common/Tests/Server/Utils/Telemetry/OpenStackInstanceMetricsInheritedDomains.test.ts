import { afterEach, describe, expect, test } from "@jest/globals";
import {
  OpenStackInstanceMetricSample,
  OpenStackInstanceMetricsDecision,
  OpenStackInstanceMetricsHostState,
  OpenStackInstancePlacement,
  applyOpenStackInstanceMetricSamples,
  getOpenStackInstanceMetricsStateKey,
  readOpenStackInstanceMetricSamples,
} from "../../../../Server/Utils/Telemetry/OpenStackInstanceMetricsScan";
import OpenStackInstanceMetricsIngest from "../../../../Server/Utils/Telemetry/OpenStackInstanceMetricsIngest";
import { JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OpenStackInstanceMetric,
  OpenStackInstanceMetricSource,
} from "../../../../Types/OpenStack/OpenStackInstanceMetrics";
import { readOwnValue } from "../../../../Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "../../../Helpers/InheritedNames";
import {
  BURNER_ID,
  PROJECT_ID,
  parsePrometheusExposition,
  prometheusToEnvelope,
} from "../../../Helpers/OpenStackInstanceMetricsFixtures";

/*
 * ISSUE #8220 / #8221: A LIBVIRT DOMAIN NAMED LIKE WHAT EVERY OBJECT INHERITS.
 *
 * libvirt's exporter labels every series of a VM with its domain, and only
 * libvirt_domain_openstack_info says which instance a domain is. The scan
 * keeps that in its state, `d`, a plain object keyed by the domain - and
 * wrote it with an assignment and read it with a plain read. A domain named
 * "__proto__" was never written (a string under it is ignored), and every
 * later read found the prototype every object shares; one named
 * "constructor" that nothing had identified yet found the Object function.
 * Either was then used as the instance's id: its readings landed on an
 * instance keyed "[object Object]" or by the function's source, and the
 * ingest asked the database for that instance. Both are the map's own keys
 * now, written and read as such.
 */

const MINUTE_MS: number = 60 * 1000;
const START_MS: number = 1793785799000;
const HOST: string = "compute-01";

const PROTOTYPE_KEYS: Array<string> = Object.getOwnPropertyNames(
  Object.prototype,
).sort();
const OBJECT_FUNCTION_KEYS: Array<string> =
  Object.getOwnPropertyNames(Object).sort();

afterEach(() => {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
    PROTOTYPE_KEYS,
  );
  expect(Object.getOwnPropertyNames(Object).sort()).toEqual(
    OBJECT_FUNCTION_KEYS,
  );
});

const PLACEMENT: OpenStackInstancePlacement = {
  hypervisorName: "compute-01.example.internal",
  regionName: "RegionOne",
  projectId: PROJECT_ID,
  aggregates: [],
};

function samplesOf(
  text: string,
  timeMs: number,
): Array<OpenStackInstanceMetricSample> {
  return readOpenStackInstanceMetricSamples(
    prometheusToEnvelope({
      series: parsePrometheusExposition(text),
      timeMs: timeMs,
      exporterHost: HOST,
    }),
  );
}

function apply(
  text: string,
  timeMs: number,
  states: Map<string, OpenStackInstanceMetricsHostState>,
): OpenStackInstanceMetricsDecision {
  return applyOpenStackInstanceMetricSamples({
    samples: samplesOf(text, timeMs),
    states,
    placements: new Map([[BURNER_ID, PLACEMENT]]),
    isInstanceKept: (): boolean => {
      return true;
    },
  });
}

function identity(domain: string): string {
  return `libvirt_domain_openstack_info{domain="${domain}",instance_id="${BURNER_ID}",project_id="${PROJECT_ID}"} 1`;
}

function cpu(domain: string, seconds: number): string {
  return `libvirt_domain_info_cpu_time_seconds_total{domain="${domain}"} ${seconds}`;
}

function stateOf(
  states: Map<string, OpenStackInstanceMetricsHostState>,
): OpenStackInstanceMetricsHostState {
  const state: OpenStackInstanceMetricsHostState | undefined = states.get(
    getOpenStackInstanceMetricsStateKey({
      source: OpenStackInstanceMetricSource.Libvirt,
      exporterHost: HOST,
    }),
  );

  if (!state) {
    throw new Error("no state for the exporter");
  }

  return state;
}

function instanceIdsOn(
  decision: OpenStackInstanceMetricsDecision,
  name: string,
): Array<unknown> {
  const metric: JSONObject | undefined = decision.metrics.find(
    (one: JSONObject): boolean => {
      return one["name"] === name;
    },
  );
  const points: Array<JSONObject> =
    ((metric?.["gauge"] as JSONObject | undefined)?.[
      "dataPoints"
    ] as Array<JSONObject>) || [];

  return points.map((point: JSONObject): unknown => {
    const found: JSONObject | undefined = (
      point["attributes"] as Array<JSONObject>
    ).find((one: JSONObject): boolean => {
      return one["key"] === OPENSTACK_INSTANCE_ID_ATTRIBUTE;
    });

    return (found?.["value"] as JSONObject | undefined)?.["stringValue"];
  });
}

describe("a libvirt domain named like what every object inherits", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "a domain named %s is the instance its identity series says, and its readings are that instance's",
    (name: string) => {
      const states: Map<string, OpenStackInstanceMetricsHostState> = new Map();

      apply(`${identity(name)}\n${cpu(name, 1000)}`, START_MS, states);

      expect(Object.keys(stateOf(states).d)).toEqual([name]);
      expect(readOwnValue(stateOf(states).d, name)).toBe(BURNER_ID);

      const next: OpenStackInstanceMetricsDecision = apply(
        cpu(name, 1060),
        START_MS + MINUTE_MS,
        states,
      );

      expect(instanceIdsOn(next, OpenStackInstanceMetric.CpuUsage)).toEqual([
        BURNER_ID,
      ]);
      // Only the instance itself is in the state: nothing keyed by what an object inherits.
      expect(Object.keys(stateOf(states).i)).toEqual([BURNER_ID]);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a domain named %s is still known after the state's round trip through the cache, as JSON",
    (name: string) => {
      const states: Map<string, OpenStackInstanceMetricsHostState> = new Map();

      apply(`${identity(name)}\n${cpu(name, 1000)}`, START_MS, states);

      // As OpenStackInstanceMetricsIngest keeps the state between batches.
      const reloaded: Map<string, OpenStackInstanceMetricsHostState> = new Map(
        Array.from(states.entries()).map(
          ([key, state]: [string, OpenStackInstanceMetricsHostState]): [
            string,
            OpenStackInstanceMetricsHostState,
          ] => {
            return [
              key,
              JSON.parse(
                JSON.stringify(state),
              ) as OpenStackInstanceMetricsHostState,
            ];
          },
        ),
      );

      expect(readOwnValue(stateOf(reloaded).d, name)).toBe(BURNER_ID);

      const next: OpenStackInstanceMetricsDecision = apply(
        cpu(name, 1060),
        START_MS + MINUTE_MS,
        reloaded,
      );

      expect(instanceIdsOn(next, OpenStackInstanceMetric.CpuUsage)).toEqual([
        BURNER_ID,
      ]);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a domain named %s that nothing identified is no instance yet: no readings, nothing in the state",
    (name: string) => {
      const states: Map<string, OpenStackInstanceMetricsHostState> = new Map();

      const first: OpenStackInstanceMetricsDecision = apply(
        cpu(name, 1000),
        START_MS,
        states,
      );
      const second: OpenStackInstanceMetricsDecision = apply(
        cpu(name, 1060),
        START_MS + MINUTE_MS,
        states,
      );

      expect(first.metrics).toEqual([]);
      expect(second.metrics).toEqual([]);
      expect(Object.keys(stateOf(states).i)).toEqual([]);
      expect(Object.keys(stateOf(states).d)).toEqual([]);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "the ingest asks the database only for the instances its domains are, never for one a domain named %s does not name",
    (name: string) => {
      const states: Map<string, OpenStackInstanceMetricsHostState> = new Map();

      // Nothing has identified the domain: the batch's sample names no instance.
      const unknown: Array<string> = (
        OpenStackInstanceMetricsIngest as unknown as {
          getInstanceIdsOf: (data: {
            samples: ReadonlyArray<OpenStackInstanceMetricSample>;
            states: ReadonlyMap<string, OpenStackInstanceMetricsHostState>;
          }) => Array<string>;
        }
      ).getInstanceIdsOf({
        samples: samplesOf(cpu(name, 1000), START_MS),
        states,
      });

      expect(unknown).toEqual([]);

      // The exporter's state now knows another domain, but still not this one.
      apply(identity("instance-00000001"), START_MS, states);

      const stillUnknown: Array<string> = (
        OpenStackInstanceMetricsIngest as unknown as {
          getInstanceIdsOf: (data: {
            samples: ReadonlyArray<OpenStackInstanceMetricSample>;
            states: ReadonlyMap<string, OpenStackInstanceMetricsHostState>;
          }) => Array<string>;
        }
      ).getInstanceIdsOf({
        samples: samplesOf(cpu(name, 1000), START_MS),
        states,
      });

      expect(stillUnknown).toEqual([]);

      // Once identified, the domain's sample names that instance.
      apply(identity(name), START_MS, states);

      const known: Array<string> = (
        OpenStackInstanceMetricsIngest as unknown as {
          getInstanceIdsOf: (data: {
            samples: ReadonlyArray<OpenStackInstanceMetricSample>;
            states: ReadonlyMap<string, OpenStackInstanceMetricsHostState>;
          }) => Array<string>;
        }
      ).getInstanceIdsOf({
        samples: samplesOf(cpu(name, 1060), START_MS + MINUTE_MS),
        states,
      });

      expect(known).toEqual([BURNER_ID]);
    },
  );
});
