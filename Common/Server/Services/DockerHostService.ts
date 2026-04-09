import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DockerHost";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";

const LAST_SEEN_CACHE_NAMESPACE: string = "docker-host-last-seen";
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
    // Try to find existing host
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
      // Create new host
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
      /*
       * Race condition: another request created the host concurrently.
       * Re-fetch the existing host.
       */
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

      throw new Error(
        "Failed to create or find Docker host: " + data.hostIdentifier,
      );
    }
  }

  @CaptureSpan()
  public async updateLastSeen(hostId: ObjectID): Promise<void> {
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

    await this.updateOneById({
      id: hostId,
      data: {
        lastSeenAt: OneUptimeDate.getCurrentDate(),
        otelCollectorStatus: "connected",
      },
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
