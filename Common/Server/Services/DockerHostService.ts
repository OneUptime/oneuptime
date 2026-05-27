import DatabaseService from "./DatabaseService";
import DockerHostLabelRuleEngineService from "./DockerHostLabelRuleEngineService";
import DockerHostOwnerRuleEngineService from "./DockerHostOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/DockerHost";
import Label from "../../Models/DatabaseModels/Label";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";

const LAST_SEEN_CACHE_NAMESPACE: string = "docker-host-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "docker-host-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await DockerHostLabelRuleEngineService.applyRulesToDockerHost(
            createdItem,
          );
        })
        .then(async () => {
          await DockerHostOwnerRuleEngineService.applyRulesToDockerHost(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying docker host rules in DockerHostService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              dockerHostId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
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
  public async updateLastSeen(
    hostId: ObjectID,
    extra?: {
      osType?: string | undefined;
      osVersion?: string | undefined;
      agentVersion?: string | undefined;
    },
  ): Promise<void> {
    const cacheKey: string = hostId.toString();
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          osType: extra?.osType ?? null,
          osVersion: extra?.osVersion ?? null,
          agentVersion: extra?.agentVersion ?? null,
        }),
      )
      .digest("hex");

    const cached: string | null = await GlobalCache.getString(
      LAST_SEEN_CACHE_NAMESPACE,
      cacheKey,
    );

    if (cached === extrasFingerprint) {
      return; // same data was written recently
    }

    await GlobalCache.setString(
      LAST_SEEN_CACHE_NAMESPACE,
      cacheKey,
      extrasFingerprint,
      { expiresInSeconds: LAST_SEEN_THROTTLE_SECONDS },
    );

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
    if (extra?.agentVersion) {
      data.agentVersion = extra.agentVersion;
    }

    await this.updateOneById({
      id: hostId,
      data: data,
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * Additively attach labels to a Docker host. Existing labels are
   * never removed — manual labels set via the UI survive ingest. The
   * set of labelIds passed in is fingerprinted and cached for 60s so
   * the common case (steady-state collector pushing the same label
   * set every batch) costs one in-memory lookup, not a join-table
   * scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    dockerHostId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.dockerHostId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const dockerHostIdStr: string = data.dockerHostId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(dockerHostIdStr)
        .loadMany();

      const existingIds: Set<string> = new Set();
      for (const lbl of existingLabels) {
        const idStr: string | undefined = lbl._id?.toString();
        if (idStr) {
          existingIds.add(idStr);
        }
      }

      const toAddIds: Array<string> = [];
      const seen: Set<string> = new Set();
      for (const id of data.labelIds) {
        const idStr: string = id.toString();
        if (existingIds.has(idStr) || seen.has(idStr)) {
          continue;
        }
        seen.add(idStr);
        toAddIds.push(idStr);
      }

      if (toAddIds.length > 0) {
        await this.getRepository()
          .createQueryBuilder()
          .relation(Model, "labels")
          .of(dockerHostIdStr)
          .add(toAddIds);
      }

      await GlobalCache.setString(
        LABELS_APPLIED_CACHE_NAMESPACE,
        cacheKey,
        fingerprint,
        { expiresInSeconds: LABELS_APPLIED_CACHE_TTL_SECONDS },
      );
    } catch (err) {
      logger.warn(
        `DockerHostService.attachLabels failed for docker host ${data.dockerHostId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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

function fingerprintLabelIds(labelIds: Array<ObjectID>): string {
  const sorted: Array<string> = labelIds
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
  return crypto.createHash("sha1").update(sorted.join(",")).digest("hex");
}

export default new Service();
