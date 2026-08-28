import DatabaseService from "./DatabaseService";
import DockerHostLabelRuleEngineService from "./DockerHostLabelRuleEngineService";
import DockerHostOwnerRuleEngineService from "./DockerHostOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/DockerHost";
import Label from "../../Models/DatabaseModels/Label";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DockerHostFeedService from "./DockerHostFeedService";
import { DockerHostFeedEventType } from "../../Models/DatabaseModels/DockerHostFeed";
import ResourceFeedUtil from "../Utils/ResourceFeed/ResourceFeedUtil";
import { Blue500, Gray500, Green500, Yellow500 } from "../../Types/BrandColors";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ResourceHeartbeat from "../Utils/Telemetry/ResourceHeartbeat";
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
    onCreate: OnCreate<Model>,
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
    /*
     * The overview page can say what this Docker host looks like now; only
     * the feed can say why it exists at all - whether a person added it or
     * ingest registered it the first time telemetry named it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeDockerHostCreatedFeed(createdItem, onCreate).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByHostIdentifier(data: {
    projectId: ObjectID;
    hostIdentifier: string;
  }): Promise<Model> {
    /*
     * Canonicalize + look up case-insensitively. A Docker host is keyed by
     * the OTel `host.name` resource attribute (see autoDiscoverDockerHost),
     * whose casing is not stable — Windows surfaces PRIMARY01 vs primary01
     * across resource detectors. Ingest already canonicalizes host.name
     * (OtelIngestBaseService.normalizeHostNameAttributesInPlace); we repeat
     * it here so the method is correct for any caller. A case-sensitive
     * lookup would miss an existing row, then fail to create it because the
     * unique guard (checkUniqueColumnBy -> findWithSameText) compares
     * case-insensitively, wedging ingest for that host. Mirrors HostService.
     */
    const hostIdentifier: string = data.hostIdentifier.trim().toLowerCase();

    const existingHost: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        hostIdentifier: QueryHelper.findWithSameText(hostIdentifier),
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
      /*
       * Converge a legacy mixed-case identifier onto the canonical form so
       * the stored resource.host.name (canonicalized at ingest) keeps
       * matching the Docker-host detail page filter. Best-effort — never
       * block ingest on it. Updates don't re-run the unique guard.
       */
      if (
        existingHost._id &&
        existingHost.hostIdentifier &&
        existingHost.hostIdentifier !== hostIdentifier
      ) {
        try {
          await this.updateOneById({
            id: new ObjectID(existingHost._id.toString()),
            data: {
              hostIdentifier: hostIdentifier,
            },
            props: {
              isRoot: true,
            },
          });
          existingHost.hostIdentifier = hostIdentifier;
        } catch (err) {
          logger.warn(
            `DockerHostService: failed to canonicalize hostIdentifier for host ${existingHost._id.toString()}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      return existingHost;
    }

    try {
      // Create new host
      const newHost: Model = new Model();
      newHost.projectId = data.projectId;
      newHost.name = hostIdentifier;
      newHost.hostIdentifier = hostIdentifier;
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
       * Either two ingest workers raced to create the same host, or a host
       * with this identifier in a different case already existed and the
       * unique guard rejected the insert. Re-resolve case-insensitively so
       * the caller still gets the existing row instead of throwing.
       */
      const reFetchedHost: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          hostIdentifier: QueryHelper.findWithSameText(hostIdentifier),
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
        "Failed to create or find Docker host: " + hostIdentifier,
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveness: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: any = {};

    if (extra?.osType) {
      metadata.osType = extra.osType;
    }
    if (extra?.osVersion) {
      metadata.osVersion = extra.osVersion;
    }
    if (extra?.agentVersion) {
      metadata.agentVersion = extra.agentVersion;
    }

    /*
     * One gated, non-blocking heartbeat write. The gates, the fail-open /
     * fail-closed split and the liveness-only fallback all live in
     * ResourceHeartbeat — see there for why this row's throttle used to
     * provide no throttling at all.
     */
    await ResourceHeartbeat.write({
      service: this,
      id: hostId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: extrasFingerprint,
      describe: `docker host ${hostId.toString()}`,
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
    /*
     * Threshold must stay well above the 5-minute OTel ingest
     * maintenance fence (MAINTENANCE_FENCE_TTL_SECONDS in
     * OtelIngestBaseService) — lastSeenAt is legitimately up to
     * ~5 minutes stale during continuous telemetry, so a threshold
     * equal to the fence TTL flaps healthy resources. 15 minutes
     * gives 3x headroom.
     */
    const fifteenMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -15,
    );

    const connectedHosts: Array<Model> = await this.findBy({
      query: {
        otelCollectorStatus: "connected",
        lastSeenAt: QueryHelper.lessThan(fifteenMinutesAgo),
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

  /**
   * Display name for this Docker host, or an empty string when the row is
   * gone. Feed writers call this on a best-effort basis, so a missing row must
   * not throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getDockerHostName(data: {
    dockerHostId: ObjectID;
  }): Promise<string> {
    const dockerHost: Model | null = await this.findOneById({
      id: data.dockerHostId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return dockerHost?.name || "";
  }

  @CaptureSpan()
  public async getDockerHostLinkInDashboard(
    projectId: ObjectID,
    dockerHostId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/docker/${dockerHostId.toString()}`,
    );
  }

  /**
   * "[Docker Host prod-1](https://…)" - the form every feed item uses to
   * name the resource it is about.
   */
  @CaptureSpan()
  public async getDockerHostMarkdownLink(
    projectId: ObjectID,
    dockerHostId: ObjectID,
  ): Promise<string> {
    const name: string = await this.getDockerHostName({
      dockerHostId: dockerHostId,
    });
    const link: URL = await this.getDockerHostLinkInDashboard(
      projectId,
      dockerHostId,
    );

    return `[Docker Host ${name}](${link.toString()})`;
  }

  private async writeDockerHostCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const dockerHostId: ObjectID | undefined = createdItem.id || undefined;

    if (!projectId || !dockerHostId) {
      return;
    }

    /*
     * Ingest creates these rows with root props and no acting user; every
     * dashboard, API and Terraform create carries one. That is the whole
     * signal for "was this discovered automatically or added by a person".
     */
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId ||
      onCreate.createBy.props.userId ||
      undefined;

    const markdown: {
      feedInfoInMarkdown: string;
      moreInformationInMarkdown: string;
    } = await ResourceFeedUtil.getCreatedFeedMarkdown({
      resourceTypeName: "Docker host",
      resourceMarkdownLink: await this.getDockerHostMarkdownLink(
        projectId,
        dockerHostId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      identifierName: "Host identifier",
      identifierValue: createdItem.hostIdentifier,
      description: createdItem.description,
    });

    await DockerHostFeedService.createDockerHostFeedItem({
      dockerHostId: dockerHostId,
      projectId: projectId,
      dockerHostFeedEventType: DockerHostFeedEventType.DockerHostCreated,
      displayColor: Green500,
      feedInfoInMarkdown: markdown.feedInfoInMarkdown,
      moreInformationInMarkdown: markdown.moreInformationInMarkdown,
      userId: createdByUserId,
    });
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    this.writeDockerHostUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return onUpdate;
  }

  private async writeDockerHostUpdatedFeed(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<void> {
    const updateData: JSONObject = onUpdate.updateBy
      .data as unknown as JSONObject;

    /*
     * Heartbeats update lastSeenAt / otelCollectorStatus / agentVersion and the
     * rollup counters constantly. Only the columns a person would recognise as
     * a change earn a feed item - see MEANINGFUL_UPDATE_COLUMNS.
     */
    const changedColumns: Array<string> =
      ResourceFeedUtil.getUpdatedColumnsWorthRecording(updateData);

    if (changedColumns.length === 0 || updatedItemIds.length === 0) {
      return;
    }

    const isArchiveChange: boolean =
      ResourceFeedUtil.isArchiveChange(updateData);
    const isArchived: boolean = Boolean(updateData["isArchived"]);
    const otherColumns: Array<string> = changedColumns.filter(
      (column: string) => {
        return column !== "isArchived";
      },
    );

    const updatedByUserId: ObjectID | undefined =
      onUpdate.updateBy.props.userId || undefined;

    for (const dockerHostId of updatedItemIds) {
      const dockerHost: Model | null = await this.findOneById({
        id: dockerHostId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = dockerHost?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: string = await this.getDockerHostMarkdownLink(
        projectId,
        dockerHostId,
      );

      if (isArchiveChange) {
        await DockerHostFeedService.createDockerHostFeedItem({
          dockerHostId: dockerHostId,
          projectId: projectId,
          dockerHostFeedEventType: isArchived
            ? DockerHostFeedEventType.DockerHostArchived
            : DockerHostFeedEventType.DockerHostRestored,
          displayColor: isArchived ? Yellow500 : Blue500,
          feedInfoInMarkdown: isArchived
            ? `🗄️ ${resourceMarkdownLink} was archived.`
            : `♻️ ${resourceMarkdownLink} was restored from the archive.`,
          userId: updatedByUserId,
        });
      }

      if (otherColumns.length > 0) {
        const markdown: {
          feedInfoInMarkdown: string;
          moreInformationInMarkdown: string;
        } = ResourceFeedUtil.getUpdatedFeedMarkdown({
          resourceMarkdownLink: resourceMarkdownLink,
          columns: otherColumns,
        });

        await DockerHostFeedService.createDockerHostFeedItem({
          dockerHostId: dockerHostId,
          projectId: projectId,
          dockerHostFeedEventType: DockerHostFeedEventType.DockerHostUpdated,
          displayColor: Gray500,
          feedInfoInMarkdown: markdown.feedInfoInMarkdown,
          moreInformationInMarkdown: markdown.moreInformationInMarkdown,
          userId: updatedByUserId,
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
