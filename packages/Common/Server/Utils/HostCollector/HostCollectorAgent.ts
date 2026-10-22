import HostService from "../../Services/HostService";
import HostCollectorConfigService from "../../Services/HostCollectorConfigService";
import HostCollectorConfigVersionService from "../../Services/HostCollectorConfigVersionService";
import LabelService from "../../Services/LabelService";
import Host from "../../../Models/DatabaseModels/Host";
import HostCollectorConfig from "../../../Models/DatabaseModels/HostCollectorConfig";
import HostCollectorConfigVersion from "../../../Models/DatabaseModels/HostCollectorConfigVersion";
import Label from "../../../Models/DatabaseModels/Label";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import {
  HostCollectorConfigStatus,
  HostCollectorOsType,
  getHostCollectorOsType,
  isHostCollectorConfigStatus,
} from "../../../Types/HostCollector/HostCollector";
import {
  HostCollectorConfigCandidate,
  HostCollectorConfigChoice,
  HostCollectorConfigChoiceReason,
  chooseHostCollectorConfig,
} from "../../../Utils/HostCollector/HostCollectorConfigResolution";
import {
  HostCollectorHostFeatures,
  UNKNOWN_HOST_FEATURES,
  getHostCollectorDefaultConfig,
  hostCollectorHostFeaturesFromText,
  hostCollectorHostFeaturesToText,
} from "../../../Utils/HostCollector/HostCollectorDefaultConfig";
import { canonicalizeEntityValue } from "../../../Utils/Telemetry/EntityKey";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import HostCollectorAgentCache from "./HostCollectorAgentCache";
import HostCollectorProjectConfigsMemo, {
  HostCollectorProjectConfig,
} from "./HostCollectorProjectConfigsMemo";
import { getHostCollectorConfigHash } from "./HostCollectorConfigHash";
import OpAmpCodec, {
  OpAmpAgentToServer,
  OpAmpServerToAgent,
} from "./OpAmp/OpAmpCodec";
import {
  DesiredHostCollectorConfig,
  HostCollectorAgentDescription,
  HostCollectorAgentState,
  OpAmpExchangeResult,
  describeHostCollectorAgent,
  exchangeWithHostCollector,
  getOpAmpErrorResponse,
  getOpAmpInstanceUidText,
  getReportFullStateResponse,
} from "./OpAmp/OpAmpExchange";

/*
 * The server side of a managed host's collector: every message its OpAMP
 * supervisor posts to <OneUptime URL>/opamp/v1 (authorized by the project's
 * telemetry ingestion key before it gets here) comes through handleMessage.
 *
 *   1. Which host: the one the supervisor names (host.name, as the
 *      collector's own telemetry names it - so both land on one host), or
 *      the one its instance was seen on, when it sends only its id. A host
 *      seen first this way is created now, so it shows under Hosts the
 *      moment the command finishes, before its first metrics.
 *   2. Which config it should run (HostCollectorConfigResolution): the one
 *      picked for it, the first Collector Config that applies to it, or
 *      OneUptime's default for its system.
 *   3. What it reports and what to answer (OpAmpExchange): its config's
 *      status, its health, and the config when it needs it.
 *
 * Polls are frequent (every 30 seconds per host) and mostly say nothing new,
 * so a poll that changes nothing reads the host from the shared cache and
 * writes nothing; last contact is written at most every few minutes.
 */

// How often a host that reports nothing new has its last contact written.
export const HOST_COLLECTOR_LAST_CONTACT_WRITE_INTERVAL_MS: number =
  5 * 60 * 1000;

// The most configs a project's hosts are matched against.
const MAX_CONFIGS_PER_PROJECT: number = 500;

type ProjectConfig = HostCollectorProjectConfig;

// The hash of each default, which only changes with a OneUptime release.
const defaultConfigHashes: Map<string, string> = new Map<string, string>();

/*
 * A host as a poll needs it. Kept in the shared cache between polls, and
 * read from the host when it is not there.
 */
export interface HostCollectorSnapshot {
  hostId: string;
  osType: HostCollectorOsType | null;
  hostArch: string | null;
  agentVersion: string | null;
  labelIds: Array<string>;
  // What the installer found on the host, as stored ("journald,systemd").
  hostFeatures: string | null;
  instanceUid: string | null;
  configId: string | null;
  isConfigPinned: boolean;
  versionId: string | null;
  lastContactAt: number | null;
  state: HostCollectorAgentState;
}

export interface HostCollectorMessageResult {
  // What to answer: a ServerToAgent, protobuf.
  body: Uint8Array;
  // Set when the message could not be read at all: answered with HTTP 400.
  isBadRequest: boolean;
}

export default class HostCollectorAgent {
  /*
   * Answers one AgentToServer. The ingestion key has been checked: the
   * project is the key's.
   */
  @CaptureSpan()
  public static async handleMessage(data: {
    projectId: ObjectID;
    body: Uint8Array;
  }): Promise<HostCollectorMessageResult> {
    let message: OpAmpAgentToServer;

    try {
      message = OpAmpCodec.decodeAgentToServer(data.body);
    } catch {
      return {
        body: OpAmpCodec.encodeServerToAgent(
          getOpAmpErrorResponse({
            instanceUid: new Uint8Array(),
            message: "The request is not an OpAMP AgentToServer message.",
          }),
        ),
        isBadRequest: true,
      };
    }

    const response: OpAmpServerToAgent =
      await HostCollectorAgent.respondToMessage({
        projectId: data.projectId,
        message: message,
      });

    return {
      body: OpAmpCodec.encodeServerToAgent(response),
      isBadRequest: false,
    };
  }

  @CaptureSpan()
  public static async respondToMessage(data: {
    projectId: ObjectID;
    message: OpAmpAgentToServer;
  }): Promise<OpAmpServerToAgent> {
    const message: OpAmpAgentToServer = data.message;
    const instanceUidBytes: Uint8Array =
      message.instanceUid || new Uint8Array();
    const instanceUid: string | null =
      getOpAmpInstanceUidText(instanceUidBytes);

    if (!instanceUid) {
      return getOpAmpErrorResponse({
        instanceUid: instanceUidBytes,
        message: "instance_uid must be 16 bytes.",
      });
    }

    const description: HostCollectorAgentDescription | null =
      describeHostCollectorAgent(message);

    if (description && !description.hostName) {
      return getOpAmpErrorResponse({
        instanceUid: instanceUidBytes,
        message:
          "The collector did not report host.name, which OneUptime files the host under.",
      });
    }

    let hostId: string | null = await HostCollectorAgent.findHostId({
      projectId: data.projectId,
      instanceUid: instanceUid,
      description: description,
      bypassMemo: false,
    });

    if (!hostId) {
      // Only its id, and nothing seen of it before: ask for everything.
      return getReportFullStateResponse(instanceUidBytes);
    }

    let snapshot: HostCollectorSnapshot | null =
      await HostCollectorAgent.getSnapshot(hostId);

    if (!snapshot && description?.hostName) {
      /*
       * The host was deleted since its id was remembered (host names are
       * remembered for a minute in each process): look it up again, which
       * files it anew.
       */
      await HostCollectorAgentCache.dropState(hostId);
      hostId = await HostCollectorAgent.findHostId({
        projectId: data.projectId,
        instanceUid: instanceUid,
        description: description,
        bypassMemo: true,
      });
      snapshot = hostId ? await HostCollectorAgent.getSnapshot(hostId) : null;
    }

    if (!hostId || !snapshot) {
      /*
       * The host is gone (deleted since). Forget where this instance was,
       * and ask for everything, to file it anew.
       */
      if (hostId) {
        await HostCollectorAgentCache.dropState(hostId);
      }
      await HostCollectorAgentCache.dropHostIdForInstance({
        projectId: data.projectId.toString(),
        instanceUid: instanceUid,
      });
      return getReportFullStateResponse(instanceUidBytes);
    }

    const changes: JSONObject = {};

    if (description) {
      await HostCollectorAgent.takeDescription({
        projectId: data.projectId,
        snapshot: snapshot,
        description: description,
        changes: changes,
      });
    }

    // A new instance: the collector was installed, or installed again.
    if (snapshot.instanceUid !== instanceUid) {
      snapshot.instanceUid = instanceUid;
      changes["collectorInstanceUid"] = instanceUid;
      changes["collectorRegisteredAt"] = OneUptimeDate.getCurrentDate();
    }

    const configs: Array<ProjectConfig> =
      await HostCollectorAgent.getProjectConfigs(data.projectId);

    const choice: HostCollectorConfigChoice = chooseHostCollectorConfig(
      configs.map((config: ProjectConfig): HostCollectorConfigCandidate => {
        return {
          id: config.id,
          osType: config.osType,
          labelIds: config.labelIds,
          order: config.order,
        };
      }),
      {
        osType: snapshot.osType,
        labelIds: snapshot.labelIds,
        pinnedConfigId: snapshot.isConfigPinned ? snapshot.configId : null,
      },
    );

    const desired: DesiredHostCollectorConfig =
      HostCollectorAgent.getDesiredConfig({
        choice: choice,
        configs: configs,
        osType: snapshot.osType,
        hostFeatures:
          hostCollectorHostFeaturesFromText(snapshot.hostFeatures) ||
          UNKNOWN_HOST_FEATURES,
      });

    /*
     * The config picked for this host is gone (deleted): the host goes back
     * to the first config that applies to it, and its page says so.
     */
    if (
      snapshot.isConfigPinned &&
      choice.reason !== HostCollectorConfigChoiceReason.Pinned
    ) {
      snapshot.isConfigPinned = false;
      changes["isCollectorConfigPinned"] = false;
    }

    const isConfigChanged: boolean =
      !snapshot.isConfigPinned && snapshot.configId !== choice.configId;

    if (isConfigChanged) {
      snapshot.configId = choice.configId;
      changes["collectorConfigId"] = choice.configId
        ? new ObjectID(choice.configId)
        : null;
    }

    const exchange: OpAmpExchangeResult = exchangeWithHostCollector({
      state: snapshot.state,
      message: message,
      desired: desired,
    });

    await HostCollectorAgent.recordStateChanges({
      projectId: data.projectId,
      snapshot: snapshot,
      next: exchange.state,
      isConfigChanged: isConfigChanged,
      changes: changes,
    });

    const now: number = OneUptimeDate.getCurrentDate().getTime();
    const hasChanges: boolean = Object.keys(changes).length > 0;

    if (
      hasChanges ||
      snapshot.lastContactAt === null ||
      now - snapshot.lastContactAt >=
        HOST_COLLECTOR_LAST_CONTACT_WRITE_INTERVAL_MS
    ) {
      changes["collectorLastContactAt"] = new Date(now);
      snapshot.lastContactAt = now;
    }

    snapshot.state = exchange.state;

    if (Object.keys(changes).length > 0) {
      try {
        await HostService.updateColumnsByIdWithoutHooks({
          id: new ObjectID(hostId),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: changes as any,
          skipUpdateDateColumn: !hasChanges,
        });
      } catch (err) {
        /*
         * The answer does not depend on the write: the host still gets its
         * config. Forget the cached state, so the next poll writes again.
         */
        logger.error(
          `HostCollectorAgent: could not record the collector state of host ${hostId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await HostCollectorAgentCache.dropState(hostId);
        return exchange.response;
      }
    }

    await HostCollectorAgentCache.setState(
      hostId,
      HostCollectorAgent.snapshotToJSON(snapshot),
    );

    return exchange.response;
  }

  /*
   * The host a message is about: by its host name when it names one (the
   * host is created when there is none), else by the instance.
   */
  private static async findHostId(data: {
    projectId: ObjectID;
    instanceUid: string;
    description: HostCollectorAgentDescription | null;
    // Look the host up even when its name is remembered.
    bypassMemo: boolean;
  }): Promise<string | null> {
    const projectIdText: string = data.projectId.toString();

    if (data.description?.hostName) {
      const host: Host = await HostService.findOrCreateByHostIdentifier({
        projectId: data.projectId,
        hostIdentifier: canonicalizeEntityValue(data.description.hostName),
        isRegisteredByCollectorManagement: true,
        bypassMemo: data.bypassMemo,
      });

      const hostId: string | undefined = host._id?.toString();
      if (!hostId) {
        return null;
      }

      await HostCollectorAgentCache.setHostIdForInstance({
        projectId: projectIdText,
        instanceUid: data.instanceUid,
        hostId: hostId,
      });

      return hostId;
    }

    const cached: string | null =
      await HostCollectorAgentCache.getHostIdForInstance({
        projectId: projectIdText,
        instanceUid: data.instanceUid,
      });

    if (cached) {
      return cached;
    }

    const host: Host | null = await HostService.findOneBy({
      query: {
        projectId: data.projectId,
        collectorInstanceUid: data.instanceUid,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    const hostId: string | undefined = host?._id?.toString();
    if (!hostId) {
      return null;
    }

    await HostCollectorAgentCache.setHostIdForInstance({
      projectId: projectIdText,
      instanceUid: data.instanceUid,
      hostId: hostId,
    });

    return hostId;
  }

  public static async getSnapshot(
    hostId: string,
  ): Promise<HostCollectorSnapshot | null> {
    const cached: JSONObject | null =
      await HostCollectorAgentCache.getState(hostId);

    if (cached) {
      const snapshot: HostCollectorSnapshot | null =
        HostCollectorAgent.snapshotFromJSON(cached);
      if (snapshot && snapshot.hostId === hostId) {
        return snapshot;
      }
    }

    const host: Host | null = await HostService.findOneById({
      id: new ObjectID(hostId),
      select: {
        _id: true,
        osType: true,
        hostArch: true,
        agentVersion: true,
        collectorInstanceUid: true,
        collectorLastContactAt: true,
        collectorConfigId: true,
        isCollectorConfigPinned: true,
        collectorConfigVersionId: true,
        collectorConfigHash: true,
        collectorConfigStatus: true,
        collectorFailedConfigHash: true,
        collectorConfigError: true,
        isCollectorHealthy: true,
        collectorHealthError: true,
        collectorHostFeatures: true,
        labels: {
          _id: true,
        },
      },
      props: { isRoot: true },
    });

    if (!host) {
      return null;
    }

    return {
      hostId: hostId,
      osType: getHostCollectorOsType(host.osType),
      hostArch: host.hostArch || null,
      agentVersion: host.agentVersion || null,
      labelIds: (host.labels || [])
        .map((label: Label): string => {
          return label._id?.toString() || "";
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
      hostFeatures:
        host.collectorHostFeatures === undefined ||
        host.collectorHostFeatures === null
          ? null
          : host.collectorHostFeatures,
      instanceUid: host.collectorInstanceUid || null,
      configId: host.collectorConfigId?.toString() || null,
      isConfigPinned: Boolean(host.isCollectorConfigPinned),
      versionId: host.collectorConfigVersionId?.toString() || null,
      lastContactAt: host.collectorLastContactAt
        ? new Date(host.collectorLastContactAt).getTime()
        : null,
      state: {
        configHash: host.collectorConfigHash || null,
        configStatus: isHostCollectorConfigStatus(host.collectorConfigStatus)
          ? host.collectorConfigStatus
          : null,
        failedConfigHash: host.collectorFailedConfigHash || null,
        configError: host.collectorConfigError || null,
        isHealthy:
          host.isCollectorHealthy === undefined ||
          host.isCollectorHealthy === null
            ? null
            : Boolean(host.isCollectorHealthy),
        healthError: host.collectorHealthError || null,
      },
    };
  }

  /*
   * What the supervisor says about where it runs: the host's system, its
   * architecture, the collector's release, and the labels it was installed
   * with (which are added to the host, never taken off).
   */
  private static async takeDescription(data: {
    projectId: ObjectID;
    snapshot: HostCollectorSnapshot;
    description: HostCollectorAgentDescription;
    changes: JSONObject;
  }): Promise<void> {
    const { snapshot, description, changes } = data;

    if (description.osType && snapshot.osType !== description.osType) {
      snapshot.osType = description.osType;
      changes["osType"] = description.osType;
    }

    if (description.hostArch && !snapshot.hostArch) {
      snapshot.hostArch = description.hostArch;
      changes["hostArch"] = description.hostArch;
    }

    if (
      description.collectorVersion &&
      snapshot.agentVersion !== description.collectorVersion
    ) {
      snapshot.agentVersion = description.collectorVersion;
      changes["agentVersion"] = description.collectorVersion;
    }

    if (description.hostFeatures) {
      const hostFeatures: string = hostCollectorHostFeaturesToText(
        description.hostFeatures,
      );
      if (snapshot.hostFeatures !== hostFeatures) {
        snapshot.hostFeatures = hostFeatures;
        changes["collectorHostFeatures"] = hostFeatures;
      }
    }

    if (description.labelNames.length === 0) {
      return;
    }

    try {
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames: description.labelNames,
        });

      await HostService.attachLabels({
        hostId: new ObjectID(snapshot.hostId),
        labelIds: labelIds,
      });

      for (const labelId of labelIds) {
        const id: string = labelId.toString();
        if (!snapshot.labelIds.includes(id)) {
          snapshot.labelIds.push(id);
        }
      }
    } catch (err) {
      logger.warn(
        `HostCollectorAgent: could not label host ${snapshot.hostId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * The columns this exchange changes, and the version the host now runs
   * when the config it reports, or the config it should run, changed.
   */
  private static async recordStateChanges(data: {
    projectId: ObjectID;
    snapshot: HostCollectorSnapshot;
    next: HostCollectorAgentState;
    isConfigChanged: boolean;
    changes: JSONObject;
  }): Promise<void> {
    const previous: HostCollectorAgentState = data.snapshot.state;
    const next: HostCollectorAgentState = data.next;
    const changes: JSONObject = data.changes;
    const isHashChanged: boolean = previous.configHash !== next.configHash;

    if (isHashChanged) {
      changes["collectorConfigHash"] = next.configHash;
    }

    if (isHashChanged || data.isConfigChanged) {
      const versionId: string | null =
        next.configHash && data.snapshot.configId
          ? await HostCollectorAgent.findVersionId({
              projectId: data.projectId,
              configId: data.snapshot.configId,
              configHash: next.configHash,
            })
          : null;

      if (versionId !== data.snapshot.versionId) {
        data.snapshot.versionId = versionId;
        changes["collectorConfigVersionId"] = versionId
          ? new ObjectID(versionId)
          : null;
      }
    }

    if (previous.configStatus !== next.configStatus) {
      changes["collectorConfigStatus"] = next.configStatus;
    }

    if (previous.failedConfigHash !== next.failedConfigHash) {
      changes["collectorFailedConfigHash"] = next.failedConfigHash;
    }

    if (previous.configError !== next.configError) {
      changes["collectorConfigError"] = next.configError;
    }

    if (previous.isHealthy !== next.isHealthy) {
      changes["isCollectorHealthy"] = next.isHealthy;
    }

    if (previous.healthError !== next.healthError) {
      changes["collectorHealthError"] = next.healthError;
    }
  }

  /*
   * The newest version with this hash of the config the host should run, in
   * the host's own project: null while the host still runs another config
   * (or a default, which has no versions). Two projects, or two configs, can
   * hold the same YAML; a host only ever shows a version of its own config.
   */
  private static async findVersionId(data: {
    projectId: ObjectID;
    configId: string;
    configHash: string;
  }): Promise<string | null> {
    const version: HostCollectorConfigVersion | null =
      await HostCollectorConfigVersionService.findOneBy({
        query: {
          projectId: data.projectId,
          hostCollectorConfigId: new ObjectID(data.configId),
          configHash: data.configHash,
        },
        select: { _id: true },
        sort: { versionNumber: SortOrder.Descending },
        props: { isRoot: true },
      });

    return version?._id?.toString() || null;
  }

  public static getDesiredConfig(data: {
    choice: HostCollectorConfigChoice;
    configs: Array<ProjectConfig>;
    osType: HostCollectorOsType | null;
    hostFeatures: HostCollectorHostFeatures;
  }): DesiredHostCollectorConfig {
    const config: ProjectConfig | undefined = data.choice.configId
      ? data.configs.find((item: ProjectConfig): boolean => {
          return item.id === data.choice.configId;
        })
      : undefined;

    if (config) {
      return {
        configYaml: config.configYaml,
        configHash: config.configHash,
      };
    }

    const osType: HostCollectorOsType = data.osType || HostCollectorOsType.Any;
    const configYaml: string = getHostCollectorDefaultConfig(
      osType,
      data.hostFeatures,
    );
    const hashKey: string = `${osType}:${hostCollectorHostFeaturesToText(
      data.hostFeatures,
    )}`;
    let configHash: string | undefined = defaultConfigHashes.get(hashKey);

    if (!configHash) {
      configHash = getHostCollectorConfigHash(configYaml);
      defaultConfigHashes.set(hashKey, configHash);
    }

    return { configYaml, configHash };
  }

  public static async getProjectConfigs(
    projectId: ObjectID,
  ): Promise<Array<ProjectConfig>> {
    const key: string = projectId.toString();
    const memoed: Array<ProjectConfig> | undefined =
      HostCollectorProjectConfigsMemo.get(key);

    if (memoed) {
      return memoed;
    }

    const rows: Array<HostCollectorConfig> =
      await HostCollectorConfigService.findBy({
        query: { projectId: projectId },
        select: {
          _id: true,
          osType: true,
          order: true,
          configYaml: true,
          configHash: true,
          labels: { _id: true },
        },
        sort: { order: SortOrder.Ascending },
        limit: MAX_CONFIGS_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    const configs: Array<ProjectConfig> = [];

    rows.forEach((row: HostCollectorConfig, index: number): void => {
      const id: string | undefined = row._id?.toString();
      if (!id || !row.configYaml) {
        return;
      }

      configs.push({
        id: id,
        osType:
          (row.osType as HostCollectorOsType | undefined) ||
          HostCollectorOsType.Linux,
        labelIds: (row.labels || [])
          .map((label: Label): string => {
            return label._id?.toString() || "";
          })
          .filter((labelId: string): boolean => {
            return Boolean(labelId);
          }),
        order: typeof row.order === "number" ? row.order : index,
        configYaml: row.configYaml,
        configHash:
          row.configHash || getHostCollectorConfigHash(row.configYaml),
      });
    });

    HostCollectorProjectConfigsMemo.set(key, configs);

    return configs;
  }

  public static snapshotToJSON(snapshot: HostCollectorSnapshot): JSONObject {
    return {
      hostId: snapshot.hostId,
      osType: snapshot.osType,
      hostArch: snapshot.hostArch,
      agentVersion: snapshot.agentVersion,
      labelIds: snapshot.labelIds,
      hostFeatures: snapshot.hostFeatures,
      instanceUid: snapshot.instanceUid,
      configId: snapshot.configId,
      isConfigPinned: snapshot.isConfigPinned,
      versionId: snapshot.versionId,
      lastContactAt: snapshot.lastContactAt,
      configHash: snapshot.state.configHash,
      configStatus: snapshot.state.configStatus,
      failedConfigHash: snapshot.state.failedConfigHash,
      configError: snapshot.state.configError,
      isHealthy: snapshot.state.isHealthy,
      healthError: snapshot.state.healthError,
    };
  }

  public static snapshotFromJSON(
    json: JSONObject,
  ): HostCollectorSnapshot | null {
    const text: (value: unknown) => string | null = (
      value: unknown,
    ): string | null => {
      return typeof value === "string" && value ? value : null;
    };

    const hostId: string | null = text(json["hostId"]);
    if (!hostId) {
      return null;
    }

    const labelIds: Array<string> = Array.isArray(json["labelIds"])
      ? (json["labelIds"] as Array<unknown>).filter(
          (item: unknown): item is string => {
            return typeof item === "string";
          },
        )
      : [];

    const configStatus: unknown = json["configStatus"];
    const isHealthy: unknown = json["isHealthy"];
    const lastContactAt: unknown = json["lastContactAt"];

    return {
      hostId: hostId,
      osType: getHostCollectorOsType(text(json["osType"])),
      hostArch: text(json["hostArch"]),
      agentVersion: text(json["agentVersion"]),
      labelIds: labelIds,
      hostFeatures:
        typeof json["hostFeatures"] === "string"
          ? (json["hostFeatures"] as string)
          : null,
      instanceUid: text(json["instanceUid"]),
      configId: text(json["configId"]),
      isConfigPinned: json["isConfigPinned"] === true,
      versionId: text(json["versionId"]),
      lastContactAt: typeof lastContactAt === "number" ? lastContactAt : null,
      state: {
        configHash: text(json["configHash"]),
        configStatus: isHostCollectorConfigStatus(configStatus)
          ? (configStatus as HostCollectorConfigStatus)
          : null,
        failedConfigHash: text(json["failedConfigHash"]),
        configError: text(json["configError"]),
        isHealthy: typeof isHealthy === "boolean" ? isHealthy : null,
        healthError: text(json["healthError"]),
      },
    };
  }
}
