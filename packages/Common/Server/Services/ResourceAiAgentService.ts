import CephClusterFeedService from "./CephClusterFeedService";
import CephClusterService from "./CephClusterService";
import DatabaseServerFeedService from "./DatabaseServerFeedService";
import DatabaseServerService from "./DatabaseServerService";
import DatabaseService from "./DatabaseService";
import DockerHostFeedService from "./DockerHostFeedService";
import DockerHostService from "./DockerHostService";
import DockerSwarmClusterFeedService from "./DockerSwarmClusterFeedService";
import DockerSwarmClusterService from "./DockerSwarmClusterService";
import HostFeedService from "./HostFeedService";
import HostService from "./HostService";
import PodmanHostFeedService from "./PodmanHostFeedService";
import PodmanHostService from "./PodmanHostService";
import ProxmoxClusterFeedService from "./ProxmoxClusterFeedService";
import ProxmoxClusterService from "./ProxmoxClusterService";
import UserService from "./UserService";
import VMwareVCenterFeedService from "./VMwareVCenterFeedService";
import VMwareVCenterService from "./VMwareVCenterService";
import { CephClusterFeedEventType } from "../../Models/DatabaseModels/CephClusterFeed";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../Models/DatabaseModels/DatabaseServer";
import { DatabaseServerFeedEventType } from "../../Models/DatabaseModels/DatabaseServerFeed";
import { DockerHostFeedEventType } from "../../Models/DatabaseModels/DockerHostFeed";
import { DockerSwarmClusterFeedEventType } from "../../Models/DatabaseModels/DockerSwarmClusterFeed";
import { HostFeedEventType } from "../../Models/DatabaseModels/HostFeed";
import { PodmanHostFeedEventType } from "../../Models/DatabaseModels/PodmanHostFeed";
import { ProxmoxClusterFeedEventType } from "../../Models/DatabaseModels/ProxmoxClusterFeed";
import Model from "../../Models/DatabaseModels/ResourceAiAgent";
import { VMwareVCenterFeedEventType } from "../../Models/DatabaseModels/VMwareVCenterFeed";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { Blue500, Green500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import {
  DatabaseEndpoint,
  formatDatabaseEndpoint,
} from "../../Types/DatabaseServer/DatabaseEndpoint";
import DatabaseServerDiscoverySource from "../../Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  DATABASE_AGENT_ATTRIBUTE,
  resolveDatabaseFromResourceAttributes,
} from "../../Types/DatabaseServer/DatabaseTelemetryResolver";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  AiResourceTypeInfo,
  isAiResourceType,
  parseAiResourceType,
} from "../../Types/ResourceAiAgent/AiResourceType";
import {
  MAX_POSTURE_STRING_LENGTH,
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
  RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  ResourceAiAgentConnectionStatus,
  ResourceAiAgentPosture,
  ResourceAiAgentRegistrationRefusalReason,
  ResourceAiAgentSummary,
  ResourceAiRemediationMode,
  parseResourceAiAgentPosture,
  parseResourceAiRemediationMode,
} from "../../Types/ResourceAiAgent/ResourceAiAccess";
import crypto from "crypto";

/*
 * Every column of a ResourceAiAgent row a reader may need — everything
 * except keyHash. The key hash is read only by the agent authentication
 * path (and registration), which select it explicitly; nothing that builds
 * a status, a list or a response ever loads it, so it cannot leak into one
 * by accident.
 */
export const RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY: Select<Model> = {
  _id: true,
  createdAt: true,
  updatedAt: true,
  projectId: true,
  resourceType: true,
  resourceId: true,
  resourceIdentifier: true,
  agentVersion: true,
  posture: true,
  lastAliveAt: true,
  connectionStatus: true,
  lastRegisteredAt: true,
  registeredWithIngestionKeyId: true,
  lastRefusedRegistrationAt: true,
  lastRefusedRegistrationReason: true,
};

// 32 random bytes, hex: 64 characters, 256 bits.
const AGENT_KEY_BYTES: number = 32;

// What a stored key hash looks like: sha256, hex.
const SHA256_HEX_PATTERN: RegExp = /^[0-9a-f]{64}$/i;

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * The subset of a row isOnline / getAgentSummary read. Dates may arrive as
 * Date objects (a hydrated model) or ISO strings (a JSON payload).
 */
export interface ResourceAiAgentPresenceRow {
  connectionStatus?: string | null | undefined;
  lastAliveAt?: Date | string | null | undefined;
}

type DateLike = Date | string | null | undefined;

function toDate(value: DateLike): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoString(value: DateLike): string | null {
  const date: Date | null = toDate(value);

  return date ? OneUptimeDate.toString(date) : null;
}

/*
 * Ceiling on agent rows one project may hold, and on how many new ones may
 * be created per hour. Registration is authenticated by the project's
 * telemetry ingestion key — a credential every collector and CI job holds —
 * and every distinct resource identity creates a row that is handed
 * commands, so the rows are bounded like anything else an ingestion key can
 * create. The same numbers as the Kubernetes AI agent's: a fleet-wide
 * install that trips the hourly one is only delayed, the agent keeps
 * retrying.
 */
export const MAX_RESOURCE_AI_AGENTS_PER_PROJECT: number = 250;
export const MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR: number = 30;

/*
 * An agent row not heard from in this long is removed when the project's
 * cap would otherwise refuse a new agent. Unlike a Kubernetes cluster, a
 * Docker, Podman or Linux host runs one agent per machine, and machines
 * come and go (an autoscaled fleet names every instance anew) while their
 * resources, and so their agent rows, stay: without this, 250 machines
 * that ever registered would lock every later one out for good. The rows
 * still never pass the cap, and a row holds only the agent's connection
 * (the resource keeps its AI settings); an agent that comes back simply
 * registers again.
 */
export const RESOURCE_AI_AGENT_RECLAIM_AFTER_DAYS: number = 7;

/*
 * When a transient refusal (previous_instance_online) tells the agent to
 * try again. It clears within seconds when a container is replaced, and an
 * agent that is refused for longer just keeps asking at this pace.
 */
export const RESOURCE_AI_AGENT_REGISTRATION_RETRY_AFTER_SECONDS: number = 20;

/*
 * The longest identity registration accepts for a resource found by its
 * name or host identifier: those columns are ShortText, so a longer
 * identity could never become a resource row.
 */
export const MAX_RESOURCE_AI_AGENT_IDENTIFIER_LENGTH: number =
  ColumnLength.ShortText;

/*
 * A database registers by its endpoint ("<system>|<host>[:<port>]", a host
 * name may be 253 characters) or its id, never by a ShortText name, so its
 * limit is the posture's: the identity is stored in the posture too.
 */
export const MAX_DATABASE_AI_AGENT_IDENTIFIER_LENGTH: number =
  MAX_POSTURE_STRING_LENGTH;

/*
 * How often, per agent and per server process, a heartbeat checks that the
 * agent's resource still exists. The resource has no foreign key to the
 * agent row (ResourceAiAgent.resourceId is polymorphic), so a deleted
 * resource leaves its agent heartbeating a row nothing can reach — and a
 * collector that re-creates the resource under a new id would show "no
 * agent connected" forever. A gone resource retires the agent row, and the
 * agent's next registration attaches it to whatever row its identity
 * resolves to now.
 */
export const RESOURCE_AI_AGENT_RESOURCE_CHECK_INTERVAL_MS: number =
  5 * 60 * 1000;
const MAX_RESOURCE_CHECKS_REMEMBERED: number = 10_000;

/*
 * A 403 from POST /resource-ai-agent-ingest/register that says WHICH
 * refusal it is, so the agent can tell a wait that clears on its own (the
 * transient reason, which also carries retryAfterSeconds) from one that
 * needs an operator. The ingress sends { message, reason,
 * retryAfterSeconds? } and a Retry-After header for the transient one.
 */
export class ResourceAiAgentRegistrationRefusedException extends ForbiddenException {
  public readonly reason: ResourceAiAgentRegistrationRefusalReason;
  // Set only for a refusal that clears on its own: when to try again.
  public readonly retryAfterSeconds: number | undefined;

  public constructor(data: {
    message: string;
    reason: ResourceAiAgentRegistrationRefusalReason;
    retryAfterSeconds?: number | undefined;
  }) {
    super(data.message);
    this.reason = data.reason;
    this.retryAfterSeconds = data.retryAfterSeconds;
  }
}

/*
 * How a registration came to hold the resource's agent key.
 *
 * created:     the resource had no agent row; this registration created it.
 * continuity:  it presented the row's current key — the same agent.
 * reset:       an admin reset the agent (no key is valid), so the first
 *              registration after that takes the row.
 * signed_off:  the previous instance signed off (/disconnect), as a
 *              container does on a clean shutdown.
 * offline:     the previous instance stopped heartbeating.
 *
 * Only "continuity" is proof. The rest are what a restarted container looks
 * like — and also what anyone holding the ingestion key looks like, which
 * is why none of them can take a row whose agent is online.
 */
export type ResourceAiAgentRegistrationAdmission =
  | "created"
  | "continuity"
  | "reset"
  | "signed_off"
  | "offline";

export interface ResourceAiAgentRegistrationResult {
  agentId: ObjectID;
  // The new agent key. Returned once, here; only its hash is stored.
  agentKey: string;
  resourceType: AiResourceType;
  resourceId: ObjectID;
  // The resource's name in OneUptime (its row's name, else its identity).
  resourceName: string;
  admission: ResourceAiAgentRegistrationAdmission;
}

/*
 * What the server changed on the resource when it applied the agent's
 * first-connection defaults. Empty when nothing needed changing.
 */
export interface ResourceAiAgentDefaultsApplied {
  turnedOnInvestigation: boolean;
  remediationMode?: ResourceAiRemediationMode | undefined;
}

/*
 * The resource row an agent serves, as registration, the heartbeat and the
 * defaults read it: its identity and its AI settings, read as root from the
 * table its type names.
 */
export interface ResourceAiAgentResource {
  resourceType: AiResourceType;
  id: ObjectID;
  projectId: ObjectID;
  // The row's name, else the identity the agent registered with.
  name: string;
  isAiInvestigationEnabled?: boolean | undefined;
  aiRemediationMode?: string | undefined;
  aiAccessConfiguredAt?: Date | string | null | undefined;
}

// A feed item on the resource's own feed.
export interface ResourceAiAgentFeedItem {
  resourceId: ObjectID;
  projectId: ObjectID;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string | undefined;
  displayColor: Color;
  userId?: ObjectID | undefined;
}

/*
 * How the server reaches one resource type: its model's service (reads and
 * the first-connection defaults, always as root), how the collector's
 * identity finds or creates its row, and its feed. Every service is looked
 * up when used, never when this module loads: Common's services import
 * each other in cycles, and an entry read too early would be undefined.
 */
export interface ResourceAiAgentResourceBinding {
  resourceType: AiResourceType;
  getService: () => DatabaseService<DatabaseBaseModel>;
  /*
   * The row the collector's identity (a host identifier or a name) names,
   * created when OneUptime has not seen it yet. Null for DatabaseServer,
   * which is resolved by id or endpoint instead. `fresh` skips any
   * in-process memo of the answer (HostService keeps one), for a caller
   * that found the memoed row deleted.
   */
  findOrCreateByIdentity:
    | ((data: {
        projectId: ObjectID;
        identifier: string;
        fresh?: boolean | undefined;
      }) => Promise<DatabaseBaseModel>)
    | null;
  // Never throws: every resource feed service swallows its own errors.
  writeFeedItem: (item: ResourceAiAgentFeedItem) => Promise<void>;
}

// The AI columns every resource model carries, as a read row holds them.
interface ResourceAiColumns {
  _id?: string | undefined;
  projectId?: ObjectID | undefined;
  name?: string | undefined;
  isAiInvestigationEnabled?: boolean | undefined;
  aiRemediationMode?: string | undefined;
  aiAccessConfiguredAt?: Date | undefined;
}

// What registration, the heartbeat and the defaults read off a resource row.
export const RESOURCE_AI_AGENT_RESOURCE_SELECT: JSONObject = {
  _id: true,
  projectId: true,
  name: true,
  isAiInvestigationEnabled: true,
  aiRemediationMode: true,
  aiAccessConfiguredAt: true,
};

function asService<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
): DatabaseService<DatabaseBaseModel> {
  return service as unknown as DatabaseService<DatabaseBaseModel>;
}

/*
 * The binding of one resource type (see ResourceAiAgentResourceBinding).
 * Total over AiResourceType: adding a type without a binding fails to
 * compile.
 */
export function getResourceAiAgentResourceBinding(
  resourceType: AiResourceType,
): ResourceAiAgentResourceBinding {
  switch (resourceType) {
    case AiResourceType.DockerHost:
      return {
        resourceType,
        getService: (): DatabaseService<DatabaseBaseModel> => {
          return asService(DockerHostService);
        },
        findOrCreateByIdentity: async (data: {
          projectId: ObjectID;
          identifier: string;
        }): Promise<DatabaseBaseModel> => {
          return await DockerHostService.findOrCreateByHostIdentifier({
            projectId: data.projectId,
            hostIdentifier: data.identifier,
          });
        },
        writeFeedItem: async (item: ResourceAiAgentFeedItem): Promise<void> => {
          await DockerHostFeedService.createDockerHostFeedItem({
            dockerHostId: item.resourceId,
            projectId: item.projectId,
            dockerHostFeedEventType: DockerHostFeedEventType.DockerHostUpdated,
            feedInfoInMarkdown: item.feedInfoInMarkdown,
            moreInformationInMarkdown: item.moreInformationInMarkdown,
            displayColor: item.displayColor,
            userId: item.userId,
          });
        },
      };
    case AiResourceType.PodmanHost:
      return {
        resourceType,
        getService: (): DatabaseService<DatabaseBaseModel> => {
          return asService(PodmanHostService);
        },
        findOrCreateByIdentity: async (data: {
          projectId: ObjectID;
          identifier: string;
        }): Promise<DatabaseBaseModel> => {
          return await PodmanHostService.findOrCreateByHostIdentifier({
            projectId: data.projectId,
            hostIdentifier: data.identifier,
          });
        },
        writeFeedItem: async (item: ResourceAiAgentFeedItem): Promise<void> => {
          await PodmanHostFeedService.createPodmanHostFeedItem({
            podmanHostId: item.resourceId,
            projectId: item.projectId,
            podmanHostFeedEventType: PodmanHostFeedEventType.PodmanHostUpdated,
            feedInfoInMarkdown: item.feedInfoInMarkdown,
            moreInformationInMarkdown: item.moreInformationInMarkdown,
            displayColor: item.displayColor,
            userId: item.userId,
          });
        },
      };
    case AiResourceType.DockerSwarmCluster:
      return {
        resourceType,
        getService: (): DatabaseService<DatabaseBaseModel> => {
          return asService(DockerSwarmClusterService);
        },
        findOrCreateByIdentity: async (data: {
          projectId: ObjectID;
          identifier: string;
        }): Promise<DatabaseBaseModel> => {
          return await DockerSwarmClusterService.findOrCreateByName({
            projectId: data.projectId,
            name: data.identifier,
          });
        },
        writeFeedItem: async (item: ResourceAiAgentFeedItem): Promise<void> => {
          await DockerSwarmClusterFeedService.createDockerSwarmClusterFeedItem({
            dockerSwarmClusterId: item.resourceId,
            projectId: item.projectId,
            dockerSwarmClusterFeedEventType:
              DockerSwarmClusterFeedEventType.DockerSwarmClusterUpdated,
            feedInfoInMarkdown: item.feedInfoInMarkdown,
            moreInformationInMarkdown: item.moreInformationInMarkdown,
            displayColor: item.displayColor,
            userId: item.userId,
          });
        },
      };
    case AiResourceType.ProxmoxCluster:
      return {
        resourceType,
        getService: (): DatabaseService<DatabaseBaseModel> => {
          return asService(ProxmoxClusterService);
        },
        findOrCreateByIdentity: async (data: {
          projectId: ObjectID;
          identifier: string;
        }): Promise<DatabaseBaseModel> => {
          return await ProxmoxClusterService.findOrCreateByName({
            projectId: data.projectId,
            name: data.identifier,
          });
        },
        writeFeedItem: async (item: ResourceAiAgentFeedItem): Promise<void> => {
          await ProxmoxClusterFeedService.createProxmoxClusterFeedItem({
            proxmoxClusterId: item.resourceId,
            projectId: item.projectId,
            proxmoxClusterFeedEventType:
              ProxmoxClusterFeedEventType.ProxmoxClusterUpdated,
            feedInfoInMarkdown: item.feedInfoInMarkdown,
            moreInformationInMarkdown: item.moreInformationInMarkdown,
            displayColor: item.displayColor,
            userId: item.userId,
          });
        },
      };
    case AiResourceType.VMwareVCenter:
      return {
        resourceType,
        getService: (): DatabaseService<DatabaseBaseModel> => {
          return asService(VMwareVCenterService);
        },
        findOrCreateByIdentity: async (data: {
          projectId: ObjectID;
          identifier: string;
        }): Promise<DatabaseBaseModel> => {
          return await VMwareVCenterService.findOrCreateByName({
            projectId: data.projectId,
            name: data.identifier,
          });
        },
        writeFeedItem: async (item: ResourceAiAgentFeedItem): Promise<void> => {
          await VMwareVCenterFeedService.createVMwareVCenterFeedItem({
            vmwareVCenterId: item.resourceId,
            projectId: item.projectId,
            vmwareVCenterFeedEventType:
              VMwareVCenterFeedEventType.VMwareVCenterUpdated,
            feedInfoInMarkdown: item.feedInfoInMarkdown,
            moreInformationInMarkdown: item.moreInformationInMarkdown,
            displayColor: item.displayColor,
            userId: item.userId,
          });
        },
      };
    case AiResourceType.CephCluster:
      return {
        resourceType,
        getService: (): DatabaseService<DatabaseBaseModel> => {
          return asService(CephClusterService);
        },
        findOrCreateByIdentity: async (data: {
          projectId: ObjectID;
          identifier: string;
        }): Promise<DatabaseBaseModel> => {
          return await CephClusterService.findOrCreateByName({
            projectId: data.projectId,
            name: data.identifier,
          });
        },
        writeFeedItem: async (item: ResourceAiAgentFeedItem): Promise<void> => {
          await CephClusterFeedService.createCephClusterFeedItem({
            cephClusterId: item.resourceId,
            projectId: item.projectId,
            cephClusterFeedEventType:
              CephClusterFeedEventType.CephClusterUpdated,
            feedInfoInMarkdown: item.feedInfoInMarkdown,
            moreInformationInMarkdown: item.moreInformationInMarkdown,
            displayColor: item.displayColor,
            userId: item.userId,
          });
        },
      };
    case AiResourceType.DatabaseServer:
      return {
        resourceType,
        getService: (): DatabaseService<DatabaseBaseModel> => {
          return asService(DatabaseServerService);
        },
        findOrCreateByIdentity: null,
        writeFeedItem: async (item: ResourceAiAgentFeedItem): Promise<void> => {
          await DatabaseServerFeedService.createDatabaseServerFeedItem({
            databaseServerId: item.resourceId,
            projectId: item.projectId,
            databaseServerFeedEventType:
              DatabaseServerFeedEventType.DatabaseServerUpdated,
            feedInfoInMarkdown: item.feedInfoInMarkdown,
            moreInformationInMarkdown: item.moreInformationInMarkdown,
            displayColor: item.displayColor,
            userId: item.userId,
          });
        },
      };
    case AiResourceType.Host:
      return {
        resourceType,
        getService: (): DatabaseService<DatabaseBaseModel> => {
          return asService(HostService);
        },
        findOrCreateByIdentity: async (data: {
          projectId: ObjectID;
          identifier: string;
          fresh?: boolean | undefined;
        }): Promise<DatabaseBaseModel> => {
          return await HostService.findOrCreateByHostIdentifier({
            projectId: data.projectId,
            hostIdentifier: data.identifier,
            ...(data.fresh ? { bypassMemo: true } : {}),
          });
        },
        writeFeedItem: async (item: ResourceAiAgentFeedItem): Promise<void> => {
          await HostFeedService.createHostFeedItem({
            hostId: item.resourceId,
            projectId: item.projectId,
            hostFeedEventType: HostFeedEventType.HostUpdated,
            feedInfoInMarkdown: item.feedInfoInMarkdown,
            moreInformationInMarkdown: item.moreInformationInMarkdown,
            displayColor: item.displayColor,
            userId: item.userId,
          });
        },
      };
  }
}

/*
 * How the resource is named mid-sentence: "Docker host", "Ceph cluster",
 * but "host" and "database server" (common nouns, not product names).
 */
const COMMON_NOUN_DISPLAY_NAME_PATTERN: RegExp = /^(Host|Database)\b/;

export function describeResourceInSentence(
  resourceType: AiResourceType,
): string {
  const displayName: string = AI_RESOURCE_TYPE_INFO[resourceType].displayName;

  return COMMON_NOUN_DISPLAY_NAME_PATTERN.test(displayName)
    ? `${displayName.charAt(0).toLowerCase()}${displayName.slice(1)}`
    : displayName;
}

// Where a database endpoint identity came from, for DB registration.
interface DatabaseEndpointIdentity {
  system: string;
  address: string;
  port: number | null;
}

/*
 * A key hash that no key can have (its preimage is unknown), compared
 * against when the presented agent id matches no row, so an unknown id and
 * a wrong key cost the same.
 */
const UNMATCHABLE_KEY_HASH: string = "0".repeat(64);

/*
 * The resource AI agent of one infrastructure resource (see the model): its
 * identity, and everything the server does about it.
 *
 * - Shared helpers every caller needs: key minting and hashing, the one
 *   online rule, the summary the dashboard sees, and the reads the access
 *   status and the enqueue chokepoint use (findAgentForResource,
 *   findOnlineAgentForResource, findAgentsForResources).
 * - The identity lifecycle behind /resource-ai-agent-ingest: register
 *   (with the project's telemetry ingestion key; hands out an agent key),
 *   authenticate (every later request, by agent id and key), heartbeat and
 *   sign-off — plus the admin reset on the resource's AI agent page.
 *
 * Registration never deletes or unbinds anything: the resource's settings
 * are left as they are. The only resource setting it ever writes is the
 * first-connection defaults, and only on a resource nobody configured.
 */
export class Service extends DatabaseService<Model> {
  // Agent id → when this process last checked the agent's resource (ms).
  private resourceCheckedAt: Map<string, number> = new Map<string, number>();

  public constructor() {
    super(Model);
  }

  /*
   * sha256 (hex) of an agent key: what ResourceAiAgent.keyHash stores. The
   * key itself is never stored.
   */
  public static hashKey(key: string): string {
    return crypto.createHash("sha256").update(key, "utf8").digest("hex");
  }

  // A fresh agent key: 32 cryptographically random bytes, hex encoded.
  public static generateKey(): string {
    return crypto.randomBytes(AGENT_KEY_BYTES).toString("hex");
  }

  /*
   * Does this presented key match the stored hash? Timing-safe, and false —
   * never a throw — for anything that is not a non-empty key and a stored
   * sha256 hex hash (a reset row's hash is null, which nothing matches).
   */
  public static doesKeyMatchHash(key: unknown, keyHash: unknown): boolean {
    if (typeof key !== "string" || key.length === 0) {
      return false;
    }

    if (typeof keyHash !== "string" || !SHA256_HEX_PATTERN.test(keyHash)) {
      return false;
    }

    const presented: Buffer = Buffer.from(Service.hashKey(key), "hex");
    const stored: Buffer = Buffer.from(keyHash.toLowerCase(), "hex");

    return (
      presented.length === stored.length &&
      crypto.timingSafeEqual(presented, stored)
    );
  }

  // Instance forms of the static helpers, for callers holding the default export.
  public hashKey(key: string): string {
    return Service.hashKey(key);
  }

  public generateKey(): string {
    return Service.generateKey();
  }

  public doesKeyMatchHash(key: unknown, keyHash: unknown): boolean {
    return Service.doesKeyMatchHash(key, keyHash);
  }

  // The binding of a resource type (see getResourceAiAgentResourceBinding).
  public static getResourceBinding(
    resourceType: AiResourceType,
  ): ResourceAiAgentResourceBinding {
    return getResourceAiAgentResourceBinding(resourceType);
  }

  /*
   * The one "is the agent online?" rule: it says it is connected (it
   * registered or heartbeated and has not signed off or been reset) AND it
   * was heard from within RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES. A
   * heartbeat stamped slightly in the future (another server's clock) still
   * counts as recent.
   */
  public isOnline(row: ResourceAiAgentPresenceRow, now?: Date): boolean {
    if (row.connectionStatus !== "connected") {
      return false;
    }

    const lastAliveAt: Date | null = toDate(row.lastAliveAt);

    if (!lastAliveAt) {
      return false;
    }

    const nowTime: number = (now || OneUptimeDate.getCurrentDate()).getTime();

    return (
      nowTime - lastAliveAt.getTime() <=
      RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60 * 1000
    );
  }

  /*
   * The row as the dashboard and the access status see it. Never carries
   * the key hash; the posture is re-validated on the way out, so a stored
   * value of the wrong shape is dropped (null) rather than trusted. Values
   * that were never set are null.
   */
  public getAgentSummary(
    row: Pick<
      Model,
      | "id"
      | "agentVersion"
      | "posture"
      | "lastRegisteredAt"
      | "lastRefusedRegistrationAt"
      | "lastRefusedRegistrationReason"
    > &
      ResourceAiAgentPresenceRow,
    now?: Date,
  ): ResourceAiAgentSummary {
    const connectionStatus: ResourceAiAgentConnectionStatus =
      row.connectionStatus === "connected" ? "connected" : "disconnected";

    return {
      agentId: row.id ? row.id.toString() : "",
      connectionStatus,
      isOnline: this.isOnline(row, now),
      agentVersion: row.agentVersion || null,
      lastAliveAt: toIsoString(row.lastAliveAt),
      lastRegisteredAt: toIsoString(row.lastRegisteredAt),
      posture: parseResourceAiAgentPosture(row.posture),
      lastRefusedRegistrationAt: toIsoString(row.lastRefusedRegistrationAt),
      lastRefusedRegistrationReason: row.lastRefusedRegistrationReason || null,
    };
  }

  // The resource's agent row (as root, without the key hash), or null.
  @CaptureSpan()
  public async findAgentForResource(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    resourceId: ObjectID;
  }): Promise<Model | null> {
    if (!isAiResourceType(data.resourceType)) {
      return null;
    }

    return await this.findOneBy({
      query: {
        projectId: data.projectId,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
      },
      select: RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The resource's agent row when it is online right now (isOnline), else
   * null — what the enqueue chokepoint and the access status route a
   * command to.
   */
  @CaptureSpan()
  public async findOnlineAgentForResource(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    resourceId: ObjectID;
    now?: Date | undefined;
  }): Promise<Model | null> {
    const agent: Model | null = await this.findAgentForResource(data);

    if (!agent || !this.isOnline(agent, data.now)) {
      return null;
    }

    return agent;
  }

  /*
   * The agent rows of several resources of one type in one project, in one
   * query, keyed by resource id (lowercase string). Resources without an
   * agent are simply absent.
   */
  @CaptureSpan()
  public async findAgentsForResources(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    resourceIds: Array<ObjectID>;
  }): Promise<Map<string, Model>> {
    const byResourceId: Map<string, Model> = new Map<string, Model>();

    const resourceIds: Array<string> = Array.from(
      new Set(
        data.resourceIds.map((id: ObjectID): string => {
          return id.toString().toLowerCase();
        }),
      ),
    );

    if (resourceIds.length === 0 || !isAiResourceType(data.resourceType)) {
      return byResourceId;
    }

    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        resourceType: data.resourceType,
        resourceId: QueryHelper.any(resourceIds),
      },
      select: RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const row of rows) {
      const resourceId: string | undefined = row.resourceId
        ?.toString()
        .toLowerCase();

      if (
        resourceId &&
        resourceIds.includes(resourceId) &&
        row.resourceType === data.resourceType
      ) {
        byResourceId.set(resourceId, row);
      }
    }

    return byResourceId;
  }

  /*
   * One resource row of a type, in its project, as root, with the columns
   * registration and the defaults need; null when it does not exist.
   */
  @CaptureSpan()
  public async findResource(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    resourceId: ObjectID;
  }): Promise<ResourceAiAgentResource | null> {
    if (!isAiResourceType(data.resourceType) || !data.resourceId) {
      return null;
    }

    const row: DatabaseBaseModel | null = await Service.getResourceBinding(
      data.resourceType,
    )
      .getService()
      .findOneBy({
        query: {
          _id: data.resourceId.toString(),
          projectId: data.projectId,
        },
        select: RESOURCE_AI_AGENT_RESOURCE_SELECT,
        props: { isRoot: true },
      } as never);

    if (!row || !row.id) {
      return null;
    }

    const columns: ResourceAiColumns = row as unknown as ResourceAiColumns;

    return {
      resourceType: data.resourceType,
      id: row.id,
      projectId: columns.projectId || data.projectId,
      name: columns.name?.trim() || "",
      isAiInvestigationEnabled: columns.isAiInvestigationEnabled,
      aiRemediationMode: columns.aiRemediationMode,
      aiAccessConfiguredAt: columns.aiAccessConfiguredAt,
    };
  }

  /*
   * ------------------------------------------------------------------
   * Registration
   * ------------------------------------------------------------------
   */

  /*
   * The agent registering for its resource (POST
   * /resource-ai-agent-ingest/register, authenticated by the project's
   * telemetry ingestion key). Hands out a fresh agent key; only its hash is
   * kept.
   *
   * Refused (ResourceAiAgentRegistrationRefusedException, a 403 with the
   * reason) when:
   *  - the resource type is not one OneUptime knows (resource_type_invalid);
   *  - the identity is empty or too long (resource_identifier_invalid), or
   *    a database identity names no endpoint;
   *  - the resource cannot be resolved (resource_not_found): a
   *    DATABASE_SERVER_ID that is not this project's, or a database
   *    endpoint no row owns and none may be created for;
   *  - the resource's agent is online and the request did not present its
   *    current key (previous_instance_online) — recorded on the row so the
   *    AI agent page can say another agent tried;
   *  - a new row would pass the project's caps (agent_cap_reached).
   *
   * An existing row is re-keyed when the request proves continuity (its
   * current key as previousAgentKey), or when the row was reset, or its
   * agent signed off or went quiet: what a restarted container looks like.
   *
   * On a resource nobody configured it applies the first-connection
   * defaults (applyFirstConnectionDefaults). It never deletes, unbinds or
   * rebinds anything, and writes ONE feed item when a resource's agent
   * first connects.
   */
  @CaptureSpan()
  public async register(data: {
    projectId: ObjectID;
    resourceType: unknown;
    resourceIdentifier: unknown;
    // Set when the operator pinned the row (DATABASE_SERVER_ID).
    resourceId?: unknown;
    agentVersion?: string | undefined;
    // The key the agent currently holds, when it still has one.
    previousAgentKey?: string | undefined;
    // The posture the body reports; parsed here, never trusted as is.
    posture?: unknown;
    // The TelemetryIngestionKey the request was admitted with, when known.
    ingestionKeyId?: ObjectID | undefined;
  }): Promise<ResourceAiAgentRegistrationResult> {
    const resourceType: AiResourceType = this.getValidResourceType(
      data.resourceType,
    );

    const identifier: string = this.getValidResourceIdentifier({
      resourceType,
      raw: data.resourceIdentifier,
    });

    const agentVersion: string | undefined = Service.normalizeAgentVersion(
      data.agentVersion,
    );

    const posture: ResourceAiAgentPosture = this.buildStoredPosture({
      reported: data.posture,
      resourceType,
      resourceIdentifier: identifier,
    });

    const resource: ResourceAiAgentResource = await this.resolveResource({
      projectId: data.projectId,
      resourceType,
      identifier,
      resourceId: data.resourceId,
      posture,
    });

    const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[resourceType];
    const agentKey: string = Service.generateKey();
    const now: Date = OneUptimeDate.getCurrentDate();

    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        resourceType,
        resourceId: resource.id,
      },
      select: { ...RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY, keyHash: true },
      props: { isRoot: true },
    });

    let agentId: ObjectID;
    let admission: ResourceAiAgentRegistrationAdmission;

    if (existing && existing.id) {
      admission = await this.admitReRegistration({
        agent: existing,
        previousAgentKey: data.previousAgentKey,
        resourceType,
        identifier,
        projectId: data.projectId,
      });

      await this.updateOneById({
        id: existing.id,
        data: {
          keyHash: Service.hashKey(agentKey),
          resourceIdentifier: identifier,
          posture: posture as unknown as JSONObject,
          lastAliveAt: now,
          connectionStatus: "connected",
          lastRegisteredAt: now,
          registeredWithIngestionKeyId: data.ingestionKeyId || null,
          ...(agentVersion ? { agentVersion } : {}),
        } as never,
        props: { isRoot: true },
      });

      agentId = existing.id;
    } else {
      await this.assertAgentMayBeCreated({
        projectId: data.projectId,
        resourceType,
        identifier,
      });

      const row: Model = new Model();
      row.projectId = data.projectId;
      row.resourceType = resourceType;
      row.resourceId = resource.id;
      row.resourceIdentifier = identifier;
      row.keyHash = Service.hashKey(agentKey);
      row.posture = posture as unknown as JSONObject;
      row.lastAliveAt = now;
      row.connectionStatus = "connected";
      row.lastRegisteredAt = now;
      if (agentVersion) {
        row.agentVersion = agentVersion;
      }
      if (data.ingestionKeyId) {
        row.registeredWithIngestionKeyId = data.ingestionKeyId;
      }

      const created: Model = await this.createAgentRow({
        row,
        resourceType,
        identifier,
      });

      agentId = created.id!;
      admission = "created";
    }

    logger.info(
      `ResourceAiAgent: the ${info.agentDisplayName} of ${info.displayName} "${identifier}" (${resource.id.toString()}) in project ${data.projectId.toString()} registered (${admission}).`,
    );

    /*
     * The new key's hash is stored: from here on nothing may fail the
     * registration, or the agent never receives a key the row now demands
     * (see applyFirstConnectionDefaultsSafely). The feed items are safe
     * already — the resource feed services never throw.
     */
    const defaultsApplied: ResourceAiAgentDefaultsApplied =
      await this.applyFirstConnectionDefaultsSafely({
        resource,
        allowWrites: posture.allowWrites === true,
      });

    if (admission === "created") {
      await this.writeConnectedFeedItem({
        resource,
        agentId,
        posture,
        agentVersion,
        defaultsApplied,
      });
    } else if (Service.didApplyDefaults(defaultsApplied)) {
      await this.writeDefaultsFeedItem({ resource, posture, defaultsApplied });
    }

    return {
      agentId,
      agentKey,
      resourceType,
      resourceId: resource.id,
      resourceName: resource.name || identifier,
      admission,
    };
  }

  /*
   * How a registration for a resource that already has an agent row is
   * admitted, or null when it must be refused (the row's agent is online
   * and the request did not prove it is that agent). A reset row admits
   * anyone: no key is valid for it, and the admin reset is exactly the
   * "let the real agent back in" action.
   */
  public getReRegistrationAdmission(data: {
    agent: {
      keyHash?: string | null | undefined;
    } & ResourceAiAgentPresenceRow;
    previousAgentKey?: string | undefined;
    now?: Date | undefined;
  }): ResourceAiAgentRegistrationAdmission | null {
    if (!data.agent.keyHash) {
      return "reset";
    }

    if (Service.doesKeyMatchHash(data.previousAgentKey, data.agent.keyHash)) {
      return "continuity";
    }

    if (data.agent.connectionStatus !== "connected") {
      return "signed_off";
    }

    if (!this.isOnline(data.agent, data.now)) {
      return "offline";
    }

    return null;
  }

  /*
   * The first-connection defaults, applied ONLY to a resource nobody
   * configured (aiAccessConfiguredAt is null — an operator's write of any
   * AI setting stamps it): investigating through the agent on, and, when
   * the agent allows writes (ONEUPTIME_AI_ALLOW_WRITES=true on the agent),
   * fixes "Ask for approval" instead of Off. Allowing writes on the agent is
   * the operator's consent for that; a human still approves every fix.
   * Never sets aiAccessConfiguredAt, so these stay defaults — and never
   * touches a mode an operator chose.
   *
   * Registration applies them every time; a heartbeat applies them when the
   * agent's write access appears (the agent was restarted with writes
   * allowed). The update is conditioned on the resource still being
   * unconfigured, so an operator's choice made a moment earlier is never
   * overwritten. It is a root write: the resource services neither gate nor
   * mark root writes of AI settings (they are the server's own).
   */
  @CaptureSpan()
  public async applyFirstConnectionDefaults(data: {
    resource: ResourceAiAgentResource;
    allowWrites: boolean;
  }): Promise<ResourceAiAgentDefaultsApplied> {
    const defaults: ResourceAiAgentDefaultsApplied =
      this.getFirstConnectionDefaults(data);

    if (!Service.didApplyDefaults(defaults) || !data.resource.id) {
      return { turnedOnInvestigation: false };
    }

    const updated: number = await Service.getResourceBinding(
      data.resource.resourceType,
    )
      .getService()
      .updateOneBy({
        query: {
          _id: data.resource.id.toString(),
          aiAccessConfiguredAt: QueryHelper.isNull(),
          ...(data.resource.projectId
            ? { projectId: data.resource.projectId }
            : {}),
        },
        data: {
          ...(defaults.turnedOnInvestigation
            ? { isAiInvestigationEnabled: true }
            : {}),
          ...(defaults.remediationMode
            ? { aiRemediationMode: defaults.remediationMode }
            : {}),
        },
        props: { isRoot: true },
      } as never);

    if (updated === 0) {
      return { turnedOnInvestigation: false };
    }

    logger.info(
      `ResourceAiAgent: applied the first-connection defaults to ${
        AI_RESOURCE_TYPE_INFO[data.resource.resourceType].displayName
      } ${data.resource.id.toString()} (${[
        defaults.turnedOnInvestigation ? "investigation on" : "",
        defaults.remediationMode
          ? `remediation ${defaults.remediationMode}`
          : "",
      ]
        .filter(Boolean)
        .join(", ")}).`,
    );

    return defaults;
  }

  /*
   * applyFirstConnectionDefaults for a request whose real work is already
   * written — registration stored the new key's hash and marked the row
   * connected, a heartbeat stored the liveness. A failure here must not
   * fail that request: a registration that answered 500 after storing the
   * hash would leave a row that reads online and holds a key nobody
   * received, so every retry would be refused as previous_instance_online
   * (and recorded as another agent's attempt) until the alive window
   * lapsed. Nothing is lost by skipping the defaults: the next
   * registration applies them again. Logged, and reported as "nothing
   * changed", so no feed item claims a change that did not happen.
   */
  private async applyFirstConnectionDefaultsSafely(data: {
    resource: ResourceAiAgentResource;
    allowWrites: boolean;
  }): Promise<ResourceAiAgentDefaultsApplied> {
    try {
      return await this.applyFirstConnectionDefaults(data);
    } catch (error) {
      logger.error(
        `ResourceAiAgent: could not apply the first-connection defaults to ${
          data.resource.resourceType
        } ${data.resource.id?.toString()}; the next registration tries again: ${error}`,
      );
      return { turnedOnInvestigation: false };
    }
  }

  // What applyFirstConnectionDefaults would change, without writing it.
  public getFirstConnectionDefaults(data: {
    resource: Pick<
      ResourceAiAgentResource,
      "aiAccessConfiguredAt" | "isAiInvestigationEnabled" | "aiRemediationMode"
    >;
    allowWrites: boolean;
  }): ResourceAiAgentDefaultsApplied {
    if (data.resource.aiAccessConfiguredAt) {
      return { turnedOnInvestigation: false };
    }

    const isRemediationOff: boolean =
      parseResourceAiRemediationMode(data.resource.aiRemediationMode) ===
      ResourceAiRemediationMode.Disabled;

    return {
      turnedOnInvestigation: data.resource.isAiInvestigationEnabled !== true,
      ...(data.allowWrites && isRemediationOff
        ? { remediationMode: ResourceAiRemediationMode.RequireApproval }
        : {}),
    };
  }

  public static didApplyDefaults(
    defaults: ResourceAiAgentDefaultsApplied,
  ): boolean {
    return defaults.turnedOnInvestigation || Boolean(defaults.remediationMode);
  }

  /*
   * The posture a row stores: what the agent reported, validated field by
   * field (parseResourceAiAgentPosture: allowWrites only for a literal true,
   * malformed target lists force it off, strings capped), with the two
   * facts the server decides itself forced — WHICH kind of resource, and
   * WHICH identity (the one the agent registered with). A body can never
   * make the agent the executor of another resource.
   */
  public buildStoredPosture(data: {
    reported: unknown;
    resourceType: AiResourceType;
    resourceIdentifier: string;
  }): ResourceAiAgentPosture {
    const reported: Record<string, unknown> =
      data.reported &&
      typeof data.reported === "object" &&
      !Array.isArray(data.reported)
        ? (data.reported as Record<string, unknown>)
        : {};

    const parsed: ResourceAiAgentPosture | null = parseResourceAiAgentPosture({
      ...reported,
      resourceType: data.resourceType,
      resourceIdentifier: data.resourceIdentifier,
    });

    const posture: ResourceAiAgentPosture = parsed || {
      resourceType: data.resourceType,
      resourceIdentifier: data.resourceIdentifier.trim(),
      allowWrites: false,
      writeTargets: [],
      protectedTargets: [],
      reachable: false,
    };

    // A JSON column: store only what is known, never `undefined` keys.
    for (const key of Object.keys(posture) as Array<
      keyof ResourceAiAgentPosture
    >) {
      if (posture[key] === undefined) {
        delete posture[key];
      }
    }

    return posture;
  }

  /*
   * The version string the agent reports, bounded to its ShortText column
   * (an over-long value would fail the whole write); undefined when absent.
   */
  public static normalizeAgentVersion(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed: string = value.trim();

    return trimmed ? trimmed.substring(0, ColumnLength.ShortText) : undefined;
  }

  // The longest identity registration accepts for a type.
  public static getMaxIdentifierLength(resourceType: AiResourceType): number {
    return resourceType === AiResourceType.DatabaseServer
      ? MAX_DATABASE_AI_AGENT_IDENTIFIER_LENGTH
      : MAX_RESOURCE_AI_AGENT_IDENTIFIER_LENGTH;
  }

  private getValidResourceType(raw: unknown): AiResourceType {
    const resourceType: AiResourceType | null = parseAiResourceType(raw);

    if (!resourceType) {
      const aliases: string = ALL_AI_RESOURCE_TYPES.map(
        (type: AiResourceType): string => {
          return AI_RESOURCE_TYPE_INFO[type].agentAlias;
        },
      ).join(", ");

      throw new ResourceAiAgentRegistrationRefusedException({
        reason: "resource_type_invalid",
        message: `The agent did not say which kind of resource it serves${
          typeof raw === "string" && raw.trim()
            ? ` ("${raw.trim().substring(0, 64)}" is not one OneUptime knows)`
            : ""
        }. Set ${RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV} on the agent to one of: ${aliases}.`,
      });
    }

    return resourceType;
  }

  private getValidResourceIdentifier(data: {
    resourceType: AiResourceType;
    raw: unknown;
  }): string {
    const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[data.resourceType];
    const identifier: string =
      typeof data.raw === "string" ? data.raw.trim() : "";
    const variables: string = `${info.identityEnvVars.join(" / ")} (or ${RESOURCE_AI_AGENT_RESOURCE_NAME_ENV})`;

    if (!identifier) {
      throw new ResourceAiAgentRegistrationRefusedException({
        reason: "resource_identifier_invalid",
        message: `The ${info.agentDisplayName} did not say which ${describeResourceInSentence(
          data.resourceType,
        )} it serves. Set ${variables} on the agent.`,
      });
    }

    const limit: number = Service.getMaxIdentifierLength(data.resourceType);

    if (identifier.length > limit) {
      throw new ResourceAiAgentRegistrationRefusedException({
        reason: "resource_identifier_invalid",
        message: `The ${describeResourceInSentence(
          data.resourceType,
        )} identity is ${identifier.length} characters long; the limit is ${limit}. Set a shorter ${variables} on the agent.`,
      });
    }

    return identifier;
  }

  /*
   * The resource the agent names, created when OneUptime has not seen it
   * yet (the agent may register before the collector's first telemetry),
   * then re-read for the AI columns registration needs.
   */
  private async resolveResource(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    identifier: string;
    resourceId: unknown;
    posture: ResourceAiAgentPosture;
  }): Promise<ResourceAiAgentResource> {
    const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[data.resourceType];

    if (data.resourceType === AiResourceType.DatabaseServer) {
      const databaseServerId: ObjectID =
        await this.resolveDatabaseServerId(data);

      const databaseServer: ResourceAiAgentResource | null =
        await this.findResource({
          projectId: data.projectId,
          resourceType: data.resourceType,
          resourceId: databaseServerId,
        });

      if (!databaseServer) {
        throw new BadDataException(
          `The ${info.displayName} could not be resolved.`,
        );
      }

      return databaseServer;
    }

    const resourceId: ObjectID = await this.findOrCreateResourceId({
      ...data,
      fresh: false,
    });

    let resource: ResourceAiAgentResource | null = await this.findResource({
      projectId: data.projectId,
      resourceType: data.resourceType,
      resourceId,
    });

    /*
     * The id can come from an in-process memo (HostService keeps a host's
     * id for a minute, and a delete does not clear it) and name a resource
     * deleted since: an operator deleted it while its agent ran, and the
     * agent registers again within seconds. Resolve it once more past the
     * memo, which creates the resource anew, as a first registration does.
     */
    if (!resource) {
      const freshId: ObjectID = await this.findOrCreateResourceId({
        ...data,
        fresh: true,
      });

      if (freshId.toString() !== resourceId.toString()) {
        resource = await this.findResource({
          projectId: data.projectId,
          resourceType: data.resourceType,
          resourceId: freshId,
        });
      }
    }

    if (!resource) {
      throw new BadDataException(
        `The ${info.displayName} could not be resolved.`,
      );
    }

    return resource;
  }

  // The id of the row a named type's identity finds or creates.
  private async findOrCreateResourceId(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    identifier: string;
    fresh: boolean;
  }): Promise<ObjectID> {
    const binding: ResourceAiAgentResourceBinding = Service.getResourceBinding(
      data.resourceType,
    );

    const found: DatabaseBaseModel | null = binding.findOrCreateByIdentity
      ? await binding.findOrCreateByIdentity({
          projectId: data.projectId,
          identifier: data.identifier,
          ...(data.fresh ? { fresh: true } : {}),
        })
      : null;

    if (!found || !found.id) {
      throw new BadDataException(
        `The ${
          AI_RESOURCE_TYPE_INFO[data.resourceType].displayName
        } could not be resolved.`,
      );
    }

    return found.id;
  }

  /*
   * The DatabaseServer a Database AI agent serves:
   *
   *  1. a pinned id (DATABASE_SERVER_ID, sent as resourceId — or an identity
   *     that is itself a database id): that row, if it is in this project,
   *     else resource_not_found. Never a fallback to the endpoint: the
   *     operator pinned THAT database.
   *  2. otherwise the endpoint, read from "<system>|<address>[:<port>]"
   *     (the identity the agent sends), else from the posture's details
   *     (databaseSystem, serverAddress, serverPort), and canonicalized
   *     exactly as the Database Agent collector's telemetry is (engine
   *     family, default port, the same stability rules): the row that owns
   *     it, or a new one when the endpoint may create one.
   */
  private async resolveDatabaseServerId(data: {
    projectId: ObjectID;
    identifier: string;
    resourceId: unknown;
    posture: ResourceAiAgentPosture;
  }): Promise<ObjectID> {
    const pinned: string | null = Service.readPinnedDatabaseServerId({
      resourceId: data.resourceId,
      identifier: data.identifier,
    });

    if (pinned !== null) {
      const row: DatabaseServer | null = UUID_PATTERN.test(pinned)
        ? await DatabaseServerService.findByIdInProject(
            data.projectId,
            new ObjectID(pinned),
          )
        : null;

      if (!row || !row.id) {
        throw new ResourceAiAgentRegistrationRefusedException({
          reason: "resource_not_found",
          message: `DATABASE_SERVER_ID "${pinned.substring(
            0,
            64,
          )}" is not a database in this project. Copy the id from the database's page in OneUptime, or unset DATABASE_SERVER_ID to register the database by its endpoint.`,
        });
      }

      return row.id;
    }

    const endpointIdentity: DatabaseEndpointIdentity | null =
      Service.parseDatabaseEndpointIdentity(data.identifier) ||
      Service.readDatabaseEndpointFromPosture(data.posture);

    if (!endpointIdentity) {
      throw new ResourceAiAgentRegistrationRefusedException({
        reason: "resource_identifier_invalid",
        message: `The Database AI agent's identity "${data.identifier.substring(
          0,
          64,
        )}" names neither a database id nor an endpoint. Set DATABASE_SERVER_ID to the database's id in OneUptime, or DATABASE_SYSTEM, DATABASE_SERVER_ADDRESS and DATABASE_SERVER_PORT to its endpoint.`,
      });
    }

    const attributes: Record<string, unknown> = {
      "db.system.name": endpointIdentity.system,
      "server.address": endpointIdentity.address,
      [DATABASE_AGENT_ATTRIBUTE]: "true",
    };

    if (endpointIdentity.port !== null) {
      attributes["server.port"] = String(endpointIdentity.port);
    }

    const resolved: ReturnType<typeof resolveDatabaseFromResourceAttributes> =
      resolveDatabaseFromResourceAttributes({ attributes });

    const endpoint: DatabaseEndpoint | null = resolved?.endpoint || null;

    if (!resolved || !endpoint) {
      throw new ResourceAiAgentRegistrationRefusedException({
        reason: "resource_not_found",
        message: `"${endpointIdentity.address.substring(
          0,
          128,
        )}" is not an address OneUptime can identify a database server by (a loopback or unreadable address). Set DATABASE_SERVER_ADDRESS to the host name your applications use for this database, or DATABASE_SERVER_ID to its id in OneUptime.`,
      });
    }

    const row: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: data.projectId,
        dbSystem: resolved.system,
        endpoint,
        discoverySource: DatabaseServerDiscoverySource.Collector,
        displayName: resolved.displayName || undefined,
        allowCreate: resolved.allowCreate,
        /*
         * An agent registering (every restart, and every refused retry of
         * a duplicate) is no sign the database is in use: it must not
         * restore a database discovery archived for going quiet, nor move
         * its endpoint's last match or weigh its engine.
         */
        isSighting: false,
      });

    if (!row || !row.id) {
      throw new ResourceAiAgentRegistrationRefusedException({
        reason: "resource_not_found",
        message: `No database in this project owns ${formatDatabaseEndpoint(
          endpoint,
        )}, and OneUptime could not add one for it (a private or single-label address, an engine it does not add automatically, or the project's automatic-add budget). Add the database in OneUptime (or wait for its collector to report it), then set DATABASE_SERVER_ID to its id.`,
      });
    }

    return row.id;
  }

  /*
   * The database id an agent pinned: its resourceId, else an identity that
   * is itself an id (ONEUPTIME_AI_AGENT_RESOURCE_NAME set to one). Null
   * when neither pins a row; a pinned value that is not a UUID is returned
   * as is, so the caller refuses it rather than silently using the
   * endpoint.
   */
  public static readPinnedDatabaseServerId(data: {
    resourceId: unknown;
    identifier: string;
  }): string | null {
    if (typeof data.resourceId === "string" && data.resourceId.trim()) {
      return data.resourceId.trim().toLowerCase();
    }

    if (UUID_PATTERN.test(data.identifier.trim())) {
      return data.identifier.trim().toLowerCase();
    }

    return null;
  }

  /*
   * "<system>|<address>[:<port>]" (the agent's endpoint identity, the form
   * DatabaseServer.databaseIdentifier takes) as its parts; the address
   * keeps its port (parsed with the rest when it is canonicalized). Null
   * when the value has no system or no address.
   */
  public static parseDatabaseEndpointIdentity(
    identifier: string,
  ): DatabaseEndpointIdentity | null {
    const separator: number = identifier.indexOf("|");

    if (separator <= 0) {
      return null;
    }

    const system: string = identifier.substring(0, separator).trim();
    const address: string = identifier.substring(separator + 1).trim();

    if (!system || !address || address.includes("|")) {
      return null;
    }

    return { system: system.toLowerCase(), address, port: null };
  }

  // The endpoint the agent's posture details describe, or null.
  public static readDatabaseEndpointFromPosture(
    posture: ResourceAiAgentPosture | null | undefined,
  ): DatabaseEndpointIdentity | null {
    const details: Record<string, string | number | boolean | null> =
      posture?.details || {};

    const system: unknown = details["databaseSystem"];
    const address: unknown = details["serverAddress"];
    const port: unknown = details["serverPort"];

    if (
      typeof system !== "string" ||
      !system.trim() ||
      typeof address !== "string" ||
      !address.trim()
    ) {
      return null;
    }

    return {
      system: system.trim().toLowerCase(),
      address: address.trim(),
      port:
        typeof port === "number" &&
        Number.isInteger(port) &&
        port >= 1 &&
        port <= 65535
          ? port
          : null,
    };
  }

  /*
   * An existing row: admitted per getReRegistrationAdmission, or refused
   * with previous_instance_online — which is recorded on the row (when, and
   * why) so the AI agent page can warn that another agent tried to register
   * while this one was online. Nothing about the current key is disclosed.
   */
  private async admitReRegistration(data: {
    agent: Model;
    previousAgentKey?: string | undefined;
    resourceType: AiResourceType;
    identifier: string;
    projectId: ObjectID;
  }): Promise<ResourceAiAgentRegistrationAdmission> {
    const admission: ResourceAiAgentRegistrationAdmission | null =
      this.getReRegistrationAdmission({
        agent: data.agent,
        previousAgentKey: data.previousAgentKey,
      });

    if (admission) {
      return admission;
    }

    logger.warn(
      `ResourceAiAgent: refused a registration for ${
        AI_RESOURCE_TYPE_INFO[data.resourceType].displayName
      } "${data.identifier}" in project ${data.projectId.toString()}: its agent (${data.agent.id?.toString()}) is online and the request did not present its current key.`,
    );

    await this.recordRefusedRegistration({
      agentId: data.agent.id!,
      reason: "previous_instance_online",
    });

    throw this.getPreviousInstanceOnlineRefusal({
      resourceType: data.resourceType,
      identifier: data.identifier,
    });
  }

  private getPreviousInstanceOnlineRefusal(data: {
    resourceType: AiResourceType;
    identifier: string;
  }): ResourceAiAgentRegistrationRefusedException {
    const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[data.resourceType];

    return new ResourceAiAgentRegistrationRefusedException({
      reason: "previous_instance_online",
      retryAfterSeconds: RESOURCE_AI_AGENT_REGISTRATION_RETRY_AFTER_SECONDS,
      message: `Another ${info.agentDisplayName} for ${describeResourceInSentence(
        data.resourceType,
      )} "${data.identifier}" is online. This is normal for a moment while its container restarts, and the agent retries on its own. If it lasts, make sure only one ${info.agentDisplayName} is installed for "${data.identifier}".`,
    });
  }

  // Best-effort: recording a refusal must never turn it into a 500.
  private async recordRefusedRegistration(data: {
    agentId: ObjectID;
    reason: ResourceAiAgentRegistrationRefusalReason;
  }): Promise<void> {
    try {
      await this.updateColumnsByIdWithoutHooks({
        id: data.agentId,
        data: {
          lastRefusedRegistrationAt: OneUptimeDate.getCurrentDate(),
          lastRefusedRegistrationReason: data.reason,
        },
      });
    } catch (error) {
      logger.error(
        `ResourceAiAgent: could not record a refused registration on agent ${data.agentId.toString()}: ${error}`,
      );
    }
  }

  /*
   * Bounds what an ingestion key can create (see the caps above). One
   * table serves every resource type, so the caps count every type's
   * agents together. At the cap, agents not heard from in
   * RESOURCE_AI_AGENT_RECLAIM_AFTER_DAYS make room first.
   */
  private async assertAgentMayBeCreated(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    identifier: string;
  }): Promise<void> {
    const displayName: string =
      AI_RESOURCE_TYPE_INFO[data.resourceType].displayName;

    let total: number = await this.countAgentsInProject(data.projectId);

    if (
      total >= MAX_RESOURCE_AI_AGENTS_PER_PROJECT &&
      (await this.reclaimLongOfflineAgents(data.projectId)) > 0
    ) {
      total = await this.countAgentsInProject(data.projectId);
    }

    if (total >= MAX_RESOURCE_AI_AGENTS_PER_PROJECT) {
      logger.warn(
        `ResourceAiAgent: refused to create an agent for ${displayName} "${data.identifier}" in project ${data.projectId.toString()}: the project already has ${total} (limit ${MAX_RESOURCE_AI_AGENTS_PER_PROJECT}).`,
      );

      throw new ResourceAiAgentRegistrationRefusedException({
        reason: "agent_cap_reached",
        message: `This project already has ${total} resource AI agents, which is its limit (${MAX_RESOURCE_AI_AGENTS_PER_PROJECT}). An agent not heard from in ${RESOURCE_AI_AGENT_RECLAIM_AFTER_DAYS} days makes room for a new one; to make room now, delete the resources you no longer use in OneUptime. The agent connects on its next retry.`,
      });
    }

    const createdInLastHour: number = (
      await this.countBy({
        query: {
          projectId: data.projectId,
          createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeHoursAgo(1)),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (createdInLastHour >= MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR) {
      logger.warn(
        `ResourceAiAgent: refused to create an agent for ${displayName} "${data.identifier}" in project ${data.projectId.toString()}: ${createdInLastHour} were created in the last hour (limit ${MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR}).`,
      );

      throw new ResourceAiAgentRegistrationRefusedException({
        reason: "agent_cap_reached",
        message: `${createdInLastHour} resource AI agents connected to this project in the last hour, which is its limit (${MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR}). The agent connects on a later retry.`,
      });
    }
  }

  private async countAgentsInProject(projectId: ObjectID): Promise<number> {
    return (
      await this.countBy({
        query: { projectId },
        props: { isRoot: true },
      })
    ).toNumber();
  }

  /*
   * Removes the project's agent rows not heard from in
   * RESOURCE_AI_AGENT_RECLAIM_AFTER_DAYS; how many. Best-effort: a failure
   * leaves the cap to refuse as before.
   */
  private async reclaimLongOfflineAgents(projectId: ObjectID): Promise<number> {
    try {
      const reclaimed: number = await this.deleteBy({
        query: {
          projectId,
          lastAliveAt: QueryHelper.lessThanOrNull(
            OneUptimeDate.getSomeDaysAgo(RESOURCE_AI_AGENT_RECLAIM_AFTER_DAYS),
          ),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      if (reclaimed > 0) {
        logger.info(
          `ResourceAiAgent: removed ${reclaimed} agent(s) of project ${projectId.toString()} not heard from in ${RESOURCE_AI_AGENT_RECLAIM_AFTER_DAYS} days, to make room for a new one.`,
        );
      }

      return reclaimed;
    } catch (error) {
      logger.error(
        `ResourceAiAgent: could not remove the long-offline agents of project ${projectId.toString()}: ${error}`,
      );
      return 0;
    }
  }

  /*
   * Creates the resource's agent row. The database allows one per live
   * resource, so when two agents register for a new resource at once one
   * create loses; that agent is told the other agent is online (it is — it
   * just registered), exactly as if it had arrived a moment later.
   */
  private async createAgentRow(data: {
    row: Model;
    resourceType: AiResourceType;
    identifier: string;
  }): Promise<Model> {
    try {
      return await this.create({
        data: data.row,
        props: { isRoot: true },
      });
    } catch (error) {
      const winner: Model | null = await this.findOneBy({
        query: {
          projectId: data.row.projectId!,
          resourceType: data.resourceType,
          resourceId: data.row.resourceId!,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!winner) {
        throw error;
      }

      logger.info(
        `ResourceAiAgent: two agents registered for ${
          AI_RESOURCE_TYPE_INFO[data.resourceType].displayName
        } "${data.identifier}" at once; the other one was admitted.`,
      );

      throw this.getPreviousInstanceOnlineRefusal({
        resourceType: data.resourceType,
        identifier: data.identifier,
      });
    }
  }

  /*
   * ------------------------------------------------------------------
   * The registered agent
   * ------------------------------------------------------------------
   */

  /*
   * The agent a request's id and key belong to, or null. Every request
   * after registration is authenticated here: the key's sha256 must match
   * the row's hash (timing-safe). A reset row (null hash) matches nothing,
   * and an unknown id costs the same comparison as a wrong key. The row is
   * returned without its key hash.
   */
  @CaptureSpan()
  public async authenticate(data: {
    agentId: ObjectID | string;
    agentKey: string;
  }): Promise<Model | null> {
    const agentId: string =
      typeof data.agentId === "string"
        ? data.agentId
        : data.agentId?.toString() || "";

    if (
      !agentId ||
      !ObjectID.isValidUUID(agentId) ||
      typeof data.agentKey !== "string" ||
      !data.agentKey
    ) {
      return null;
    }

    const agent: Model | null = await this.findOneBy({
      query: { _id: agentId },
      select: { ...RESOURCE_AI_AGENT_SELECT_WITHOUT_KEY, keyHash: true },
      props: { isRoot: true },
    });

    const matches: boolean = Service.doesKeyMatchHash(
      data.agentKey,
      agent?.keyHash || UNMATCHABLE_KEY_HASH,
    );

    if (!agent || !matches) {
      return null;
    }

    delete agent.keyHash;

    return agent;
  }

  /*
   * A heartbeat from the authenticated agent: it is alive and connected,
   * and this is what it can do now. The posture is stored the way
   * registration stores it (validated, with the resource type and the
   * identity the agent registered with forced); a heartbeat without one
   * keeps the stored posture.
   *
   * When the agent's write access appears (it was restarted with
   * ONEUPTIME_AI_ALLOW_WRITES=true) on a resource nobody configured, the
   * first-connection defaults apply again, so fixes move from Off to "Ask
   * for approval" without anyone visiting the AI agent page.
   *
   * This runs every 30 seconds per resource, so a normal heartbeat is one
   * UPDATE without hooks and no read: the agent row holds the identity it
   * registered with. The resource row is read only every
   * RESOURCE_AI_AGENT_RESOURCE_CHECK_INTERVAL_MS (is it still there?) and
   * when write access just appeared. An agent whose resource is gone is
   * retired: its row is deleted and the heartbeat answered 401, so the
   * agent registers again and is attached to whatever row its identity
   * resolves to now.
   */
  @CaptureSpan()
  public async heartbeat(data: {
    // The row authenticate returned for this request.
    agent: Model;
    agentVersion?: string | undefined;
    posture?: unknown;
    now?: Date | undefined;
  }): Promise<void> {
    const agentId: ObjectID | null = data.agent.id;

    if (!agentId) {
      throw new BadDataException("The agent is missing its id.");
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    let resource: ResourceAiAgentResource | null | undefined = undefined;

    if (this.isResourceCheckDue(agentId.toString(), now)) {
      resource = await this.findAgentResourceSafely(data.agent);

      if (resource === null) {
        await this.retireAgentOfGoneResource(data.agent);

        throw new NotAuthenticatedException(
          `This agent's ${
            isAiResourceType(data.agent.resourceType)
              ? describeResourceInSentence(data.agent.resourceType)
              : "resource"
          } no longer exists in OneUptime. Register again.`,
        );
      }
    }

    const storedPosture: ResourceAiAgentPosture | null =
      parseResourceAiAgentPosture(data.agent.posture);

    const isPostureReported: boolean = Boolean(
      data.posture &&
        typeof data.posture === "object" &&
        !Array.isArray(data.posture),
    );

    const resourceType: AiResourceType | null = isAiResourceType(
      data.agent.resourceType,
    )
      ? data.agent.resourceType
      : null;

    const identifier: string =
      data.agent.resourceIdentifier?.trim() ||
      storedPosture?.resourceIdentifier?.trim() ||
      "";

    /*
     * The identity is the registered one, never the body's; a row that
     * somehow lacks it keeps its stored posture rather than trusting one.
     */
    const posture: ResourceAiAgentPosture | undefined =
      isPostureReported && resourceType && identifier
        ? this.buildStoredPosture({
            reported: data.posture,
            resourceType,
            resourceIdentifier: identifier,
          })
        : undefined;

    const agentVersion: string | undefined = Service.normalizeAgentVersion(
      data.agentVersion,
    );

    const update: JSONObject = {
      lastAliveAt: now,
      connectionStatus: "connected",
    };

    if (posture) {
      update["posture"] = posture as unknown as JSONObject;
    }

    if (agentVersion) {
      update["agentVersion"] = agentVersion;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: agentId,
      data: update as never,
    });

    const writesAppeared: boolean =
      posture?.allowWrites === true && storedPosture?.allowWrites !== true;

    if (!writesAppeared || !posture) {
      return;
    }

    // The defaults read the resource's current AI settings.
    resource = resource || (await this.findAgentResource(data.agent));

    if (!resource) {
      return;
    }

    // The liveness is written; a failure here must not fail the heartbeat.
    const defaultsApplied: ResourceAiAgentDefaultsApplied =
      await this.applyFirstConnectionDefaultsSafely({
        resource,
        allowWrites: true,
      });

    if (Service.didApplyDefaults(defaultsApplied)) {
      await this.writeDefaultsFeedItem({ resource, posture, defaultsApplied });
    }
  }

  // The agent's own resource (in its project, as root), or null.
  public async findAgentResource(
    agent: Pick<Model, "resourceType" | "resourceId" | "projectId">,
  ): Promise<ResourceAiAgentResource | null> {
    if (
      !isAiResourceType(agent.resourceType) ||
      !agent.resourceId ||
      !agent.projectId
    ) {
      return null;
    }

    return await this.findResource({
      projectId: agent.projectId,
      resourceType: agent.resourceType,
      resourceId: agent.resourceId,
    });
  }

  /*
   * findAgentResource for the heartbeat's periodic check: a failed read is
   * "not known" (undefined), never "gone" — only a read that found nothing
   * retires an agent.
   */
  private async findAgentResourceSafely(
    agent: Model,
  ): Promise<ResourceAiAgentResource | null | undefined> {
    try {
      return await this.findAgentResource(agent);
    } catch (error) {
      logger.error(
        `ResourceAiAgent: could not check the resource of agent ${agent.id?.toString()}; the next check tries again: ${error}`,
      );
      return undefined;
    }
  }

  /*
   * The resource of this agent is gone: the agent row goes too (the agent
   * registers again and gets a row for whatever its identity resolves to
   * now). Jobs still targeted at the row lose their target (the foreign key
   * sets it null) and time out unclaimed. Best-effort: a failed delete is
   * logged, and the next check tries again.
   */
  private async retireAgentOfGoneResource(agent: Model): Promise<void> {
    logger.info(
      `ResourceAiAgent: agent ${agent.id?.toString()} serves ${String(
        agent.resourceType,
      )} ${agent.resourceId?.toString()}, which no longer exists; removing the agent row so the agent registers again.`,
    );

    try {
      await this.deleteOneBy({
        query: {
          _id: agent.id!.toString(),
          ...(agent.projectId ? { projectId: agent.projectId } : {}),
        },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `ResourceAiAgent: could not remove agent ${agent.id?.toString()} of a deleted resource: ${error}`,
      );
    }
  }

  /*
   * At most one resource check per interval per agent in this process.
   * Stamped before the check runs, so heartbeats that overlap it do not
   * start a second one.
   */
  private isResourceCheckDue(agentId: string, now: Date): boolean {
    const lastCheckedAt: number | undefined =
      this.resourceCheckedAt.get(agentId);

    if (
      lastCheckedAt !== undefined &&
      now.getTime() - lastCheckedAt <
        RESOURCE_AI_AGENT_RESOURCE_CHECK_INTERVAL_MS
    ) {
      return false;
    }

    // Bounded: a long-lived process forgets old agents rather than growing.
    if (this.resourceCheckedAt.size >= MAX_RESOURCE_CHECKS_REMEMBERED) {
      this.resourceCheckedAt.clear();
    }

    this.resourceCheckedAt.set(agentId, now.getTime());

    return true;
  }

  /*
   * The agent signing off on a clean shutdown. lastAliveAt is left alone
   * (it is when the agent was last heard from); the disconnected status is
   * what lets its replacement container register at once instead of
   * waiting for the alive window to lapse, and what makes the AI agent page
   * say "Offline" straight away. Its next heartbeat or registration flips
   * it back.
   */
  @CaptureSpan()
  public async markDisconnected(data: {
    resourceAiAgentId: ObjectID;
  }): Promise<void> {
    if (!data.resourceAiAgentId) {
      throw new BadDataException("resourceAiAgentId is required");
    }

    await this.updateColumnsByIdWithoutHooks({
      id: data.resourceAiAgentId,
      data: { connectionStatus: "disconnected" },
    });
  }

  /*
   * An admin's "Reset agent" on the resource's AI agent page: the agent's
   * key stops working at once (keyHash null matches nothing) and the row
   * reads as disconnected. The real agent fails authentication on its next
   * request, registers again and — the row being reset — is admitted, so it
   * comes back by itself within a few minutes. Whoever else held the key
   * (an agent that registered with a leaked ingestion key) is locked out
   * the same way; rotating that ingestion key keeps it out. The caller
   * checks the user may do this (see the resource AI access API).
   */
  @CaptureSpan()
  public async resetAgent(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    resourceId: ObjectID;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const info: AiResourceTypeInfo | undefined = isAiResourceType(
      data.resourceType,
    )
      ? AI_RESOURCE_TYPE_INFO[data.resourceType]
      : undefined;

    if (!info) {
      throw new BadDataException("This is not a resource type with AI agents.");
    }

    const agent: Model | null = await this.findAgentForResource({
      projectId: data.projectId,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
    });

    if (!agent || !agent.id) {
      throw new BadDataException(
        `This ${describeResourceInSentence(data.resourceType)} has no ${
          info.agentDisplayName
        } to reset.`,
      );
    }

    await this.updateOneById({
      id: agent.id,
      data: {
        keyHash: null,
        connectionStatus: "disconnected",
      } as never,
      props: { isRoot: true },
    });

    logger.info(
      `ResourceAiAgent: the ${info.agentDisplayName} of ${info.displayName} ${data.resourceId.toString()} in project ${data.projectId.toString()} was reset${
        data.userId ? ` by user ${data.userId.toString()}` : ""
      }.`,
    );

    const resetBy: string = data.userId
      ? await this.getUserMarkdownForFeed({
          userId: data.userId,
          projectId: data.projectId,
        })
      : "";

    await Service.getResourceBinding(data.resourceType).writeFeedItem({
      resourceId: data.resourceId,
      projectId: data.projectId,
      displayColor: Blue500,
      feedInfoInMarkdown: `🔄 The ${info.agentDisplayName} was reset${
        resetBy ? ` by **${resetBy}**` : ""
      }. It reconnects on its own within a few minutes.`,
      moreInformationInMarkdown: `**Agent**: ${info.agentDisplayName} (${agent.id.toString()})`,
      ...(data.userId ? { userId: data.userId } : {}),
    });
  }

  /*
   * The agent rows of a resource, removed — for a resource's delete path:
   * ResourceAiAgent.resourceId has no foreign key, so nothing else removes
   * them. Jobs still targeted at them lose their target (SET NULL). Returns
   * how many rows went.
   */
  @CaptureSpan()
  public async deleteAgentsForResources(data: {
    resourceType: AiResourceType;
    resourceIds: Array<ObjectID>;
    projectId?: ObjectID | undefined;
  }): Promise<number> {
    if (!isAiResourceType(data.resourceType) || data.resourceIds.length === 0) {
      return 0;
    }

    return await this.deleteBy({
      query: {
        resourceType: data.resourceType,
        resourceId: QueryHelper.any(
          data.resourceIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        ),
        ...(data.projectId ? { projectId: data.projectId } : {}),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * The user's name as a feed link, or "" when it cannot be had (no such
   * user, or the lookup failed). Only ever wording: the action it describes
   * is already done, so a failed lookup must not fail it.
   */
  private async getUserMarkdownForFeed(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<string> {
    try {
      return await UserService.getUserMarkdownString(data);
    } catch (error) {
      logger.error(
        `ResourceAiAgent: could not look up user ${data.userId.toString()} for a feed item: ${error}`,
      );
      return "";
    }
  }

  /*
   * ------------------------------------------------------------------
   * Feed
   * ------------------------------------------------------------------
   */

  // What the agent may change, in the feed's words.
  public static describeWriteAccess(
    posture: Pick<ResourceAiAgentPosture, "allowWrites" | "writeTargets">,
  ): string {
    if (posture.allowWrites !== true) {
      return "read-only";
    }

    return `can make changes ${Service.describeWriteScope(posture)}`;
  }

  // Which targets a writing agent may change: its globs, or any.
  public static describeWriteScope(
    posture: Pick<ResourceAiAgentPosture, "writeTargets">,
  ): string {
    const targets: Array<string> = posture.writeTargets || [];

    return targets.length > 0
      ? `to ${targets.join(", ")}`
      : "to anything but its protected targets";
  }

  // The first successful registration of a resource's agent. Best-effort.
  private async writeConnectedFeedItem(data: {
    resource: ResourceAiAgentResource;
    agentId: ObjectID;
    posture: ResourceAiAgentPosture;
    agentVersion?: string | undefined;
    defaultsApplied: ResourceAiAgentDefaultsApplied;
  }): Promise<void> {
    const info: AiResourceTypeInfo =
      AI_RESOURCE_TYPE_INFO[data.resource.resourceType];
    const noun: string = describeResourceInSentence(data.resource.resourceType);

    const isInvestigationOn: boolean =
      data.resource.isAiInvestigationEnabled === true ||
      data.defaultsApplied.turnedOnInvestigation;

    const sentences: Array<string> = [
      `🤖 The ${info.agentDisplayName} connected (${Service.describeWriteAccess(
        data.posture,
      )}).`,
      isInvestigationOn
        ? `AI can now use it to investigate this ${noun}.`
        : `Investigating through the agent is off for this ${noun}; turn it on on the ${noun}'s AI agent page.`,
    ];

    if (data.defaultsApplied.remediationMode) {
      sentences.push(
        `Fixes are set to "Ask for approval", because the agent allows changes (${RESOURCE_AI_ALLOW_WRITES_ENV}=true).`,
      );
    }

    const reachability: string = data.posture.reachable
      ? "yes"
      : `no${data.posture.reachError ? ` (${data.posture.reachError})` : ""}`;

    await Service.getResourceBinding(data.resource.resourceType).writeFeedItem({
      resourceId: data.resource.id,
      projectId: data.resource.projectId,
      displayColor: Green500,
      feedInfoInMarkdown: sentences.join(" "),
      moreInformationInMarkdown: [
        `**Agent**: ${info.agentDisplayName} (${data.agentId.toString()})`,
        `**Identity**: \`${data.posture.resourceIdentifier}\``,
        `**Agent version**: ${data.agentVersion || "unknown"}`,
        `**Version**: ${data.posture.toolVersion || "not detected"}`,
        `**Reachable**: ${reachability}`,
      ].join("\n\n"),
    });
  }

  /*
   * The first-connection defaults changed a setting after the first
   * connection (the agent re-registered with write access, or its write
   * access appeared on a heartbeat). A setting never changes silently.
   */
  private async writeDefaultsFeedItem(data: {
    resource: ResourceAiAgentResource;
    posture: ResourceAiAgentPosture;
    defaultsApplied: ResourceAiAgentDefaultsApplied;
  }): Promise<void> {
    const info: AiResourceTypeInfo =
      AI_RESOURCE_TYPE_INFO[data.resource.resourceType];
    const noun: string = describeResourceInSentence(data.resource.resourceType);
    const sentences: Array<string> = [];

    if (data.defaultsApplied.turnedOnInvestigation) {
      sentences.push(
        `AI can now use the ${info.agentDisplayName} to investigate this ${noun}.`,
      );
    }

    if (data.defaultsApplied.remediationMode) {
      sentences.push(
        `The ${info.agentDisplayName} can now make changes ${Service.describeWriteScope(
          data.posture,
        )}, so fixes are set to "Ask for approval".`,
      );
    }

    sentences.push(
      `Nobody had chosen AI settings for this ${noun} yet; change them on the ${noun}'s AI agent page.`,
    );

    await Service.getResourceBinding(data.resource.resourceType).writeFeedItem({
      resourceId: data.resource.id,
      projectId: data.resource.projectId,
      displayColor: Blue500,
      feedInfoInMarkdown: `🤖 ${sentences.join(" ")}`,
    });
  }
}

export default new Service();
