import Host from "../../../Models/DatabaseModels/Host";
import { HostFeedEventType } from "../../../Models/DatabaseModels/HostFeed";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Select from "../../Types/Database/Select";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Yellow500 } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import QueryHelper from "../../Types/Database/QueryHelper";
import DockerHostService from "../../Services/DockerHostService";
import HostFeedService from "../../Services/HostFeedService";
import HostService from "../../Services/HostService";
import PodmanHostService from "../../Services/PodmanHostService";
import logger from "../Logger";

/*
 * THE HOSTS AN EARLIER RELEASE REGISTERED FROM TELEMETRY THAT IS NOT A HOST'S
 * (issue #11257).
 *
 * Until this release, the ingest registered a Host from any resource that
 * named a host.name with an os.type, a container.runtime or a system./
 * process. metric (Utils/Telemetry/HostResource says what now rules a
 * resource out): every Docker host the Docker Agent reports whenever its
 * Docker host did not resolve in the same batch, every pod whose app
 * exports straight to OneUptime - one per replica, one more per rollout -
 * and, before that, Kubernetes nodes. None of them gets another heartbeat
 * now, so they would sit under Infrastructure → Hosts as Not reporting for
 * ever. This archives them, as a person archiving a wrong row would: the
 * row and its telemetry stay, its page says why in its feed, and Unarchive
 * puts it back.
 *
 * Only a row that proves itself wrong is archived, and never one a machine
 * or a person vouches for:
 *
 *   - KEPT, whatever else: a person made it (createdByUserId), or its
 *     collector is one OneUptime manages (collectorInstanceUid /
 *     collectorRegisteredAt) - that is a host's own collector.
 *   - ARCHIVED: it names a Kubernetes cluster (kubernetesClusterId). Only a
 *     Kubernetes resource's telemetry ever wrote one onto a Host - the old
 *     gate took k8s.cluster.name as a host signal - so it is a node or a pod,
 *     which Kubernetes lists.
 *   - KEPT: it reported a host's metrics (readingsUpdatedAt, cpuCores,
 *     totalMemoryBytes, processCount): what remains might be a real host an
 *     app's telemetry also named.
 *   - ARCHIVED: it was registered from a container engine, a container or
 *     an application: a container runtime or a Docker host on it
 *     (containerRuntime, dockerHostId - only the Docker and Podman agents'
 *     telemetry wrote them), an application runtime (runtimeName, from the
 *     SDK resource's process.runtime.name), or a Docker or Podman host of
 *     the same name in the project.
 *   - KEPT: anything else. A host that sent only an OS and logs is still a
 *     host.
 *
 * A kept row's container runtime is cleared: it is never a host's, and only
 * a Docker or Podman host's telemetry ever wrote it.
 *
 * Postgres only. Idempotent, and safe to run twice at once: each write is a
 * compare-and-set on what was read, and a row's feed says it was archived
 * only by the run whose write archived it.
 */

export enum NonHostTelemetryRepair {
  Keep = "Keep",
  Archive = "Archive",
}

// Why a row is archived: what its stored facts prove it was registered from.
export enum NonHostTelemetrySource {
  Kubernetes = "Kubernetes",
  ContainerEngine = "ContainerEngine",
  Application = "Application",
}

export interface NonHostTelemetryRepairVerdict {
  repair: NonHostTelemetryRepair;
  source?: NonHostTelemetrySource | undefined;
}

/*
 * The facts of a Host row the verdict reads, and whether a Docker or Podman
 * host of the same name is in its project. Pure data, so the rules can be
 * tested without a database.
 */
export interface NonHostTelemetryHostFacts {
  createdByUserId?: unknown;
  collectorInstanceUid?: unknown;
  collectorRegisteredAt?: unknown;
  kubernetesClusterId?: unknown;
  readingsUpdatedAt?: unknown;
  cpuCores?: unknown;
  totalMemoryBytes?: unknown;
  processCount?: unknown;
  containerRuntime?: unknown;
  dockerHostId?: unknown;
  runtimeName?: unknown;
  hasContainerHostOfSameName: boolean;
}

function isSet(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

export function getNonHostTelemetryRepair(
  facts: NonHostTelemetryHostFacts,
): NonHostTelemetryRepairVerdict {
  if (
    isSet(facts.createdByUserId) ||
    isSet(facts.collectorInstanceUid) ||
    isSet(facts.collectorRegisteredAt)
  ) {
    return { repair: NonHostTelemetryRepair.Keep };
  }

  if (isSet(facts.kubernetesClusterId)) {
    return {
      repair: NonHostTelemetryRepair.Archive,
      source: NonHostTelemetrySource.Kubernetes,
    };
  }

  if (
    isSet(facts.readingsUpdatedAt) ||
    isSet(facts.cpuCores) ||
    isSet(facts.totalMemoryBytes) ||
    isSet(facts.processCount)
  ) {
    return { repair: NonHostTelemetryRepair.Keep };
  }

  if (
    isSet(facts.containerRuntime) ||
    isSet(facts.dockerHostId) ||
    facts.hasContainerHostOfSameName
  ) {
    return {
      repair: NonHostTelemetryRepair.Archive,
      source: NonHostTelemetrySource.ContainerEngine,
    };
  }

  if (isSet(facts.runtimeName)) {
    return {
      repair: NonHostTelemetryRepair.Archive,
      source: NonHostTelemetrySource.Application,
    };
  }

  return { repair: NonHostTelemetryRepair.Keep };
}

// What the archived host's feed says, in its own words.
export function getNonHostTelemetryArchiveFeedMarkdown(
  source: NonHostTelemetrySource,
): string {
  switch (source) {
    case NonHostTelemetrySource.Kubernetes:
      return "🗄️ Archived by the upgrade: this host was registered from Kubernetes telemetry. Kubernetes nodes and pods are listed under Kubernetes, not Hosts. Unarchive it to bring it back.";
    case NonHostTelemetrySource.ContainerEngine:
      return "🗄️ Archived by the upgrade: this host was registered from a Docker or Podman host's telemetry. Docker and Podman hosts are listed under Infrastructure → Docker and Podman, not Hosts. Unarchive it to bring it back.";
    case NonHostTelemetrySource.Application:
      return "🗄️ Archived by the upgrade: this host was registered from an application's own telemetry - in Kubernetes, a pod's name. A host is registered from its own collector's telemetry. Unarchive it to bring it back.";
  }
}

export interface NonHostTelemetryRepairResult {
  archivedCount: number;
  clearedContainerRuntimeCount: number;
}

const PAGE_SIZE: number = 500;

const HOST_SELECT: Select<Host> = {
  _id: true,
  projectId: true,
  hostIdentifier: true,
  isArchived: true,
  createdByUserId: true,
  collectorInstanceUid: true,
  collectorRegisteredAt: true,
  kubernetesClusterId: true,
  readingsUpdatedAt: true,
  cpuCores: true,
  totalMemoryBytes: true,
  processCount: true,
  containerRuntime: true,
  dockerHostId: true,
  runtimeName: true,
};

export default class NonHostTelemetryHostRepair {
  public static async run(): Promise<NonHostTelemetryRepairResult> {
    const result: NonHostTelemetryRepairResult = {
      archivedCount: 0,
      clearedContainerRuntimeCount: 0,
    };

    /*
     * Every row in _id order, archived or not: a write here never takes a
     * row out of that order, so plain skip/limit paging sees each once.
     */
    let skip: number = 0;

    while (true) {
      const hosts: Array<Host> = await HostService.findBy({
        query: {},
        select: HOST_SELECT,
        sort: { _id: SortOrder.Ascending },
        skip: skip,
        limit: PAGE_SIZE,
        props: { isRoot: true },
      });

      for (const host of hosts) {
        try {
          await NonHostTelemetryHostRepair.repairOne(host, result);
        } catch (err) {
          // One unwritable host must not cost the rest their repair.
          logger.error(
            `NonHostTelemetryHostRepair: failed to repair host ${host._id?.toString() || "(no id)"}:`,
          );
          logger.error(err);
        }
      }

      if (hosts.length < PAGE_SIZE) {
        break;
      }

      skip += hosts.length;
    }

    return result;
  }

  private static async repairOne(
    host: Host,
    result: NonHostTelemetryRepairResult,
  ): Promise<void> {
    if (host.isArchived || !host._id || !host.projectId) {
      return;
    }

    const hostId: ObjectID = new ObjectID(host._id.toString());

    const verdict: NonHostTelemetryRepairVerdict = getNonHostTelemetryRepair(
      NonHostTelemetryHostRepair.getFacts(
        host,
        await NonHostTelemetryHostRepair.hasContainerHostOfSameName(host),
      ),
    );

    if (verdict.repair === NonHostTelemetryRepair.Archive && verdict.source) {
      const archived: boolean =
        await HostService.compareAndSetColumnsByIdWithoutHooks({
          id: hostId,
          data: {
            isArchived: true,
            archivedAt: OneUptimeDate.getCurrentDate(),
          },
          expectedData: {
            isArchived: (host.isArchived ?? null) as unknown as boolean,
          },
        });

      if (archived) {
        result.archivedCount++;

        await HostFeedService.createHostFeedItem({
          hostId: hostId,
          projectId: host.projectId,
          hostFeedEventType: HostFeedEventType.HostArchived,
          displayColor: Yellow500,
          feedInfoInMarkdown: getNonHostTelemetryArchiveFeedMarkdown(
            verdict.source,
          ),
        });
      }

      return;
    }

    if (
      typeof host.containerRuntime === "string" &&
      host.containerRuntime.length > 0
    ) {
      const cleared: boolean =
        await HostService.compareAndSetColumnsByIdWithoutHooks({
          id: hostId,
          data: { containerRuntime: null as unknown as string },
          expectedData: { containerRuntime: host.containerRuntime },
          skipUpdateDateColumn: true,
        });

      if (cleared) {
        result.clearedContainerRuntimeCount++;
      }
    }
  }

  // The facts the verdict reads, off the row as read.
  private static getFacts(
    host: Host,
    hasContainerHostOfSameName: boolean,
  ): NonHostTelemetryHostFacts {
    return {
      createdByUserId: host.createdByUserId,
      collectorInstanceUid: host.collectorInstanceUid,
      collectorRegisteredAt: host.collectorRegisteredAt,
      kubernetesClusterId: host.kubernetesClusterId,
      readingsUpdatedAt: host.readingsUpdatedAt,
      cpuCores: host.cpuCores,
      totalMemoryBytes: host.totalMemoryBytes,
      processCount: host.processCount,
      containerRuntime: host.containerRuntime,
      dockerHostId: host.dockerHostId,
      runtimeName: host.runtimeName,
      hasContainerHostOfSameName: hasContainerHostOfSameName,
    };
  }

  /*
   * Whether the project holds a Docker or Podman host of the host's name -
   * the same canonical identifier ingest registers both by. Asked only when
   * the row's own facts leave its verdict to it.
   */
  private static async hasContainerHostOfSameName(
    host: Host,
  ): Promise<boolean> {
    const identifier: string | undefined = host.hostIdentifier?.trim();

    if (!identifier || !host.projectId) {
      return false;
    }

    // The row's own facts decide first; no lookup when they do.
    const decidedWithout: NonHostTelemetryRepairVerdict =
      getNonHostTelemetryRepair(
        NonHostTelemetryHostRepair.getFacts(host, false),
      );
    const decidedWith: NonHostTelemetryRepairVerdict =
      getNonHostTelemetryRepair(
        NonHostTelemetryHostRepair.getFacts(host, true),
      );

    if (decidedWithout.repair === decidedWith.repair) {
      return false;
    }

    const dockerHost: DockerHost | null = await DockerHostService.findOneBy({
      query: {
        projectId: host.projectId,
        hostIdentifier: QueryHelper.findWithSameText(identifier),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (dockerHost) {
      return true;
    }

    const podmanHost: PodmanHost | null = await PodmanHostService.findOneBy({
      query: {
        projectId: host.projectId,
        hostIdentifier: QueryHelper.findWithSameText(identifier),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    return Boolean(podmanHost);
  }
}
