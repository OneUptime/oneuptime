import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackHypervisorCapacity,
  OpenStackInstanceMetricsOptions,
  OpenStackInstanceMetricSource,
  getDefaultOpenStackInstanceMetricsOptions,
  getOpenStackHypervisorCapacity,
  isOpenStackInstanceMetricsKept,
  normalizeOpenStackInstanceMetricsOptions,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import GlobalCache from "../../Infrastructure/GlobalCache";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import OpenStackCloudService from "../../Services/OpenStackCloudService";
import OpenStackResourceService from "../../Services/OpenStackResourceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import {
  OpenStackInstanceMetricSample,
  OpenStackInstanceMetricsDecision,
  OpenStackInstanceMetricsHostState,
  OpenStackInstancePlacement,
  appendOpenStackInstanceMetrics,
  applyOpenStackInstanceMetricSamples,
  getEmptyOpenStackInstanceMetricsHostState,
  getOpenStackInstanceMetricsStateKey,
  hasOpenStackInstanceMetrics,
  readOpenStackInstanceMetricSamples,
  removeOpenStackInstanceOriginals,
} from "./OpenStackInstanceMetricsScan";

/*
 * What OpenStackInstanceMetricsScan needs from outside a batch, around its pure work: the
 * last readings (Redis), what the inventory says of each instance (Postgres), and what the
 * cloud chose to keep. Never in the way of a batch: if any of it fails, the originals go
 * through as they came, and a page says it has nothing to show rather than losing data.
 */

const STATE_NAMESPACE: string = "openstack-instance-metrics";

// Twice the longest gap a rate spans, so a quiet exporter's state is still there for it.
const STATE_EXPIRY_SECONDS: number = 2 * 31 * 60;

/*
 * A compute node's batches arrive every minute, and what a cloud chose and where an instance
 * runs change on a person's timescale. So each process asks Postgres at most this often, and
 * a cloud of any size costs the same one indexed read per new instance.
 */
const OPTIONS_CACHE_MS: number = 60 * 1000;
const PLACEMENT_CACHE_MS: number = 5 * 60 * 1000;
// One it doesn't know yet is being scraped now, and will be in the inventory soon.
const UNKNOWN_PLACEMENT_CACHE_MS: number = 60 * 1000;

interface CloudChoice {
  options: OpenStackInstanceMetricsOptions;
  instanceCount: number;
}

interface HypervisorFacts {
  aggregates: Array<string>;
  capacity: OpenStackHypervisorCapacity;
}

const choices: InMemoryTTLCache<CloudChoice> =
  new InMemoryTTLCache<CloudChoice>(5000);
const placements: InMemoryTTLCache<OpenStackInstancePlacement | "unknown"> =
  new InMemoryTTLCache<OpenStackInstancePlacement | "unknown">(200000);

export default class OpenStackInstanceMetricsIngest {
  public static async normalizeEnvelope(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    envelope: JSONObject;
  }): Promise<void> {
    if (!hasOpenStackInstanceMetrics(data.envelope)) {
      return;
    }

    try {
      const samples: Array<OpenStackInstanceMetricSample> =
        readOpenStackInstanceMetricSamples(data.envelope);
      if (samples.length === 0) {
        return;
      }

      const states: Map<string, OpenStackInstanceMetricsHostState> =
        await this.readStates({
          openStackCloudId: data.openStackCloudId,
          samples,
        });

      const known: Map<string, OpenStackInstancePlacement> =
        await this.readPlacements({
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          instanceIds: this.getInstanceIdsOf({ samples, states }),
        });

      const choice: CloudChoice = await this.readCloudChoice(
        data.openStackCloudId,
      );

      const decision: OpenStackInstanceMetricsDecision =
        applyOpenStackInstanceMetricSamples({
          samples,
          states,
          placements: known,
          isInstanceKept: (instance: {
            projectId: string | null;
            aggregates: ReadonlyArray<string>;
          }): boolean => {
            return isOpenStackInstanceMetricsKept({
              options: choice.options,
              instanceCount: choice.instanceCount,
              projectId: instance.projectId,
              aggregates: instance.aggregates,
            });
          },
        });

      removeOpenStackInstanceOriginals({
        envelope: data.envelope,
        droppedDomains: decision.droppedDomains,
        droppedInstanceIds: decision.droppedInstanceIds,
      });
      appendOpenStackInstanceMetrics({
        envelope: data.envelope,
        metrics: decision.metrics,
      });

      await this.writeStates({
        openStackCloudId: data.openStackCloudId,
        states,
      });
    } catch (err) {
      logger.warn(
        `OpenStack instance metrics were not worked out for cloud ${data.openStackCloudId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private static getStateCacheKey(
    openStackCloudId: ObjectID,
    stateKey: string,
  ): string {
    return `${openStackCloudId.toString()}:${stateKey}`;
  }

  private static async readStates(data: {
    openStackCloudId: ObjectID;
    samples: ReadonlyArray<OpenStackInstanceMetricSample>;
  }): Promise<Map<string, OpenStackInstanceMetricsHostState>> {
    const keys: Array<string> = Array.from(
      new Set(
        data.samples.map((sample: OpenStackInstanceMetricSample): string => {
          return getOpenStackInstanceMetricsStateKey({
            source: sample.source as OpenStackInstanceMetricSource,
            exporterHost: sample.exporterHost,
          });
        }),
      ),
    );

    const values: Array<string | null> = await GlobalCache.getStrings(
      STATE_NAMESPACE,
      keys.map((key: string): string => {
        return this.getStateCacheKey(data.openStackCloudId, key);
      }),
    );

    const states: Map<string, OpenStackInstanceMetricsHostState> = new Map();
    keys.forEach((key: string, index: number): void => {
      states.set(key, this.parseState(values[index] || null));
    });
    return states;
  }

  // A value that can't be read is a first sample, and the next scrape's rate is right again.
  private static parseState(
    value: string | null,
  ): OpenStackInstanceMetricsHostState {
    if (!value) {
      return getEmptyOpenStackInstanceMetricsHostState();
    }
    try {
      const parsed: OpenStackInstanceMetricsHostState = JSON.parse(
        value,
      ) as OpenStackInstanceMetricsHostState;
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.d &&
        typeof parsed.d === "object" &&
        parsed.i &&
        typeof parsed.i === "object"
      ) {
        return parsed;
      }
    } catch {
      // Falls through.
    }
    return getEmptyOpenStackInstanceMetricsHostState();
  }

  private static async writeStates(data: {
    openStackCloudId: ObjectID;
    states: ReadonlyMap<string, OpenStackInstanceMetricsHostState>;
  }): Promise<void> {
    await Promise.all(
      Array.from(data.states.entries()).map(
        async ([key, state]: [
          string,
          OpenStackInstanceMetricsHostState,
        ]): Promise<void> => {
          await GlobalCache.setString(
            STATE_NAMESPACE,
            this.getStateCacheKey(data.openStackCloudId, key),
            JSON.stringify(state),
            { expiresInSeconds: STATE_EXPIRY_SECONDS },
          );
        },
      ),
    );
  }

  private static getInstanceIdsOf(data: {
    samples: ReadonlyArray<OpenStackInstanceMetricSample>;
    states: ReadonlyMap<string, OpenStackInstanceMetricsHostState>;
  }): Array<string> {
    const ids: Set<string> = new Set();
    for (const sample of data.samples) {
      if (sample.instanceId) {
        ids.add(sample.instanceId);
        continue;
      }
      const state: OpenStackInstanceMetricsHostState | undefined =
        data.states.get(
          getOpenStackInstanceMetricsStateKey({
            source: sample.source,
            exporterHost: sample.exporterHost,
          }),
        );
      const known: string | undefined = sample.domain
        ? state?.d[sample.domain]
        : undefined;
      if (known) {
        ids.add(known);
      }
    }
    return Array.from(ids);
  }

  private static async readPlacements(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    instanceIds: Array<string>;
  }): Promise<Map<string, OpenStackInstancePlacement>> {
    const cloudId: string = data.openStackCloudId.toString();
    const known: Map<string, OpenStackInstancePlacement> = new Map();
    const toRead: Array<string> = [];

    for (const instanceId of data.instanceIds) {
      const cached: OpenStackInstancePlacement | "unknown" | undefined =
        placements.get(`${cloudId}:${instanceId}`);
      if (cached === undefined) {
        toRead.push(instanceId);
      } else if (cached !== "unknown") {
        known.set(instanceId, cached);
      }
    }

    if (toRead.length === 0) {
      return known;
    }

    const rows: Array<OpenStackResource> =
      await OpenStackResourceService.findBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          kind: OpenStackResourceKind.Instance,
          externalId: QueryHelper.any(toRead),
        },
        select: {
          externalId: true,
          hypervisorName: true,
          regionName: true,
          openStackProjectId: true,
        },
        limit: toRead.length,
        skip: 0,
        props: { isRoot: true },
      });

    const hypervisors: Map<string, HypervisorFacts> =
      await this.readHypervisors({
      projectId: data.projectId,
      openStackCloudId: data.openStackCloudId,
      hypervisorNames: Array.from(
        new Set(
          rows
            .map((row: OpenStackResource): string => {
              return row.hypervisorName || "";
            })
            .filter((name: string): boolean => {
              return Boolean(name);
            }),
        ),
      ),
    });

    const read: Set<string> = new Set();
    for (const row of rows) {
      if (!row.externalId) {
        continue;
      }
      read.add(row.externalId);
      const hypervisor: HypervisorFacts | undefined = hypervisors.get(
        row.hypervisorName || "",
      );
      const placement: OpenStackInstancePlacement = {
        hypervisorName: row.hypervisorName || null,
        regionName: row.regionName || null,
        projectId: row.openStackProjectId || null,
        aggregates: hypervisor?.aggregates || [],
        hypervisorCapacity: hypervisor?.capacity,
      };
      known.set(row.externalId, placement);
      placements.set(
        `${cloudId}:${row.externalId}`,
        placement,
        PLACEMENT_CACHE_MS,
      );
    }
    for (const instanceId of toRead) {
      if (!read.has(instanceId)) {
        placements.set(
          `${cloudId}:${instanceId}`,
          "unknown",
          UNKNOWN_PLACEMENT_CACHE_MS,
        );
      }
    }

    return known;
  }

  private static async readHypervisors(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    hypervisorNames: Array<string>;
  }): Promise<Map<string, HypervisorFacts>> {
    const hypervisors: Map<string, HypervisorFacts> = new Map();
    if (data.hypervisorNames.length === 0) {
      return hypervisors;
    }
    const rows: Array<OpenStackResource> =
      await OpenStackResourceService.findBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          kind: OpenStackResourceKind.Hypervisor,
          hypervisorName: QueryHelper.any(data.hypervisorNames),
        },
        select: {
          hypervisorName: true,
          facts: true,
          vcpuCapacity: true,
          memoryCapacityBytes: true,
        },
        limit: data.hypervisorNames.length,
        skip: 0,
        props: { isRoot: true },
      });
    for (const row of rows) {
      if (!row.hypervisorName) {
        continue;
      }
      const facts: JSONObject = (row.facts as JSONObject | undefined) || {};
      const text: unknown = facts["aggregates"];
      hypervisors.set(row.hypervisorName, {
        aggregates:
          typeof text === "string"
            ? text
                .split(",")
                .map((name: string): string => {
                  return name.trim();
                })
                .filter((name: string): boolean => {
                  return Boolean(name);
                })
            : [],
        capacity: getOpenStackHypervisorCapacity({
          facts,
          vcpuCapacity: row.vcpuCapacity,
          memoryCapacityBytes: row.memoryCapacityBytes,
        }),
      });
    }
    return hypervisors;
  }

  private static async readCloudChoice(
    openStackCloudId: ObjectID,
  ): Promise<CloudChoice> {
    const key: string = openStackCloudId.toString();
    const cached: CloudChoice | undefined = choices.get(key);
    if (cached) {
      return cached;
    }

    const cloud: OpenStackCloud | null =
      await OpenStackCloudService.findOneById({
        id: openStackCloudId,
        select: { instanceMetricsOptions: true, instanceCount: true },
        props: { isRoot: true },
      });

    const choice: CloudChoice = {
      options:
        normalizeOpenStackInstanceMetricsOptions(cloud?.instanceMetricsOptions)
          .options || getDefaultOpenStackInstanceMetricsOptions(),
      instanceCount: cloud?.instanceCount || 0,
    };
    choices.set(key, choice, OPTIONS_CACHE_MS);
    return choice;
  }
}
