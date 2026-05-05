import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/Host";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";

const LAST_SEEN_CACHE_NAMESPACE: string = "host-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async findOrCreateByHostIdentifier(data: {
    projectId: ObjectID;
    hostIdentifier: string;
  }): Promise<Model> {
    const existingHost: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        hostIdentifier: data.hostIdentifier,
      },
      select: {
        _id: true,
        projectId: true,
        hostIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingHost) {
      return existingHost;
    }

    try {
      const newHost: Model = new Model();
      newHost.projectId = data.projectId;
      newHost.name = data.hostIdentifier;
      newHost.hostIdentifier = data.hostIdentifier;
      newHost.otelCollectorStatus = "connected";
      newHost.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdHost: Model = await this.create({
        data: newHost,
        props: {
          isRoot: true,
        },
      });

      return createdHost;
    } catch {
      const reFetchedHost: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          hostIdentifier: data.hostIdentifier,
        },
        select: {
          _id: true,
          projectId: true,
          hostIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedHost) {
        return reFetchedHost;
      }

      throw new Error("Failed to create or find host: " + data.hostIdentifier);
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    hostId: ObjectID,
    extra?: {
      osType?: string | undefined;
      osVersion?: string | undefined;
      hostId?: string | undefined;
      hostArch?: string | undefined;
      hostType?: string | undefined;
      hostIpAddresses?: string | undefined;
      cpuCores?: number | undefined;
      totalMemoryBytes?: number | undefined;
      processCount?: number | undefined;
      containerRuntime?: string | undefined;
      dockerHostId?: ObjectID | undefined;
      kubernetesClusterId?: ObjectID | undefined;
    },
  ): Promise<void> {
    /*
     * Throttle the lightweight "lastSeenAt + status" pings — those
     * arrive at every metric / log / trace batch and don't carry new
     * information. Pings that bring richer state (host metadata,
     * cached infra stats, runtime detection, FK links) bypass the
     * cache so the values land promptly.
     */
    const hasRichExtras: boolean = Boolean(
      extra &&
        (extra.hostId ||
          extra.hostArch ||
          extra.hostType ||
          extra.hostIpAddresses ||
          extra.cpuCores !== undefined ||
          extra.totalMemoryBytes !== undefined ||
          extra.processCount !== undefined ||
          extra.containerRuntime ||
          extra.dockerHostId ||
          extra.kubernetesClusterId),
    );

    if (!hasRichExtras) {
      const cacheKey: string = hostId.toString();
      const cached: string | null = await GlobalCache.getString(
        LAST_SEEN_CACHE_NAMESPACE,
        cacheKey,
      );

      if (cached) {
        return; // another pod already updated recently
      }

      await GlobalCache.setString(LAST_SEEN_CACHE_NAMESPACE, cacheKey, "1", {
        expiresInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    if (extra?.osType) {
      data.osType = extra.osType;
    }
    if (extra?.osVersion) {
      data.osVersion = extra.osVersion;
    }
    if (extra?.hostId) {
      data.hostId = extra.hostId;
    }
    if (extra?.hostArch) {
      data.hostArch = extra.hostArch;
    }
    if (extra?.hostType) {
      data.hostType = extra.hostType;
    }
    if (extra?.hostIpAddresses) {
      data.hostIpAddresses = extra.hostIpAddresses;
    }
    if (extra?.cpuCores !== undefined) {
      data.cpuCores = extra.cpuCores;
    }
    if (extra?.totalMemoryBytes !== undefined) {
      data.totalMemoryBytes = extra.totalMemoryBytes;
    }
    if (extra?.processCount !== undefined) {
      data.processCount = extra.processCount;
    }
    if (extra?.containerRuntime) {
      data.containerRuntime = extra.containerRuntime;
    }
    if (extra?.dockerHostId) {
      data.dockerHostId = extra.dockerHostId;
    }
    if (extra?.kubernetesClusterId) {
      data.kubernetesClusterId = extra.kubernetesClusterId;
    }

    await this.updateOneById({
      id: hostId,
      data: data,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async markDisconnectedHosts(): Promise<void> {
    const fiveMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -5,
    );

    const connectedHosts: Array<Model> = await this.findBy({
      query: {
        otelCollectorStatus: "connected",
        lastSeenAt: QueryHelper.lessThan(fiveMinutesAgo),
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const host of connectedHosts) {
      if (host._id) {
        await this.updateOneById({
          id: new ObjectID(host._id.toString()),
          data: {
            otelCollectorStatus: "disconnected",
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }
}

export default new Service();
