import AutoRemediationRuleService from "./AutoRemediationRuleService";
import DatabaseService from "./DatabaseService";
import KubernetesClusterAiAccessService from "./KubernetesClusterAiAccessService";
import KubernetesClusterFeedService from "./KubernetesClusterFeedService";
import KubernetesClusterService from "./KubernetesClusterService";
import RunnerService, { Service as RunnerServiceClass } from "./RunnerService";
import UserService from "./UserService";
import Model from "../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import { KubernetesClusterFeedEventType } from "../../Models/DatabaseModels/KubernetesClusterFeed";
import Runner from "../../Models/DatabaseModels/Runner";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Select from "../Types/Database/Select";
import ColumnLength from "../../Types/Database/ColumnLength";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import { Blue500, Green500 } from "../../Types/BrandColors";
import { JSONObject } from "../../Types/JSON";
import {
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
  KubernetesAgentPosture,
  KubernetesAiAgentConnectionStatus,
  KubernetesAiAgentRegistrationRefusalReason,
  KubernetesAiAgentSummary,
  KubernetesAiRemediationMode,
  parseKubernetesAgentPosture,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../Types/ObjectID";
import {
  AGENT_AI_FIXES_LABELS,
  AgentAiSettings,
  AgentAiSettingsSource,
  getAgentAiSettingsSource,
  isAgentAiSettingsSourceAgent,
  isSameAgentAiSettings,
} from "../../Types/AI/AgentAiSettings";
import crypto from "crypto";

/*
 * Every column of a KubernetesAiAgent row a reader may need — everything
 * except keyHash. The key hash is read only by the agent authentication
 * path, which selects it explicitly; nothing that builds a status, a list
 * or a response ever loads it, so it cannot leak into one by accident.
 */
export const KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY: Select<Model> = {
  _id: true,
  createdAt: true,
  updatedAt: true,
  projectId: true,
  kubernetesClusterId: true,
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

/*
 * The subset of a row isOnline / toSummary read. Dates may arrive as Date
 * objects (a hydrated model) or ISO strings (a JSON payload).
 */
export interface KubernetesAiAgentPresenceRow {
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

function toIsoString(value: DateLike): string | undefined {
  const date: Date | null = toDate(value);

  return date ? OneUptimeDate.toString(date) : undefined;
}

/*
 * Ceiling on agent rows one project may hold, and on how many new ones may
 * be created per hour. Registration is authenticated by the project's
 * telemetry ingestion key — a credential every collector and CI job holds —
 * and every distinct clusterName creates a row that is handed kubectl jobs,
 * so the rows are bounded like anything else an ingestion key can create.
 * The same numbers as the in-cluster Runner's brakes: a fleet-wide install
 * that trips the hourly one is only delayed, the agent keeps retrying.
 */
export const MAX_KUBERNETES_AI_AGENTS_PER_PROJECT: number = 250;
export const MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR: number = 30;

/*
 * When a transient refusal (previous_instance_online, legacy_runner_online)
 * tells the agent to try again. Both clear within seconds on a helm upgrade
 * or a pod restart, and an agent that is refused for longer just keeps
 * asking at this pace.
 */
export const KUBERNETES_AI_AGENT_REGISTRATION_RETRY_AFTER_SECONDS: number = 20;

/*
 * The longest cluster name registration accepts: KubernetesCluster's
 * clusterIdentifier is a ShortText column, so a longer name could never
 * become a cluster row.
 */
export const MAX_KUBERNETES_AI_AGENT_CLUSTER_NAME_LENGTH: number =
  ColumnLength.ShortText;

/*
 * A 403 from POST /kubernetes-ai-agent-ingest/register that says WHICH
 * refusal it is, so the agent can tell a wait that clears on its own (the
 * transient reasons, which also carry retryAfterSeconds) from one that
 * needs an operator. The ingress sends { message, reason,
 * retryAfterSeconds? } and a Retry-After header for the transient ones.
 */
export class KubernetesAiAgentRegistrationRefusedException extends ForbiddenException {
  public readonly reason: KubernetesAiAgentRegistrationRefusalReason;
  // Set only for a refusal that clears on its own: when to try again.
  public readonly retryAfterSeconds: number | undefined;

  public constructor(data: {
    message: string;
    reason: KubernetesAiAgentRegistrationRefusalReason;
    retryAfterSeconds?: number | undefined;
  }) {
    super(data.message);
    this.reason = data.reason;
    this.retryAfterSeconds = data.retryAfterSeconds;
  }
}

/*
 * How a registration came to hold the cluster's agent key.
 *
 * created:     the cluster had no agent row; this registration created it.
 * continuity:  it presented the row's current key — the same agent.
 * reset:       an admin reset the agent (no key is valid), so the first
 *              registration after that takes the row.
 * signed_off:  the previous instance signed off (/disconnect), as a pod
 *              does on a clean shutdown.
 * offline:     the previous instance stopped heartbeating.
 *
 * Only "continuity" is proof. The rest are what a restarted pod looks like —
 * and also what anyone holding the ingestion key looks like, which is why
 * none of them can take a row whose agent is online.
 */
export type KubernetesAiAgentRegistrationAdmission =
  | "created"
  | "continuity"
  | "reset"
  | "signed_off"
  | "offline";

export interface KubernetesAiAgentRegistrationResult {
  agentId: ObjectID;
  // The new agent key. Returned once, here; only its hash is stored.
  agentKey: string;
  clusterId: ObjectID;
  admission: KubernetesAiAgentRegistrationAdmission;
}

/*
 * What the server changed on the cluster when it applied the agent's
 * first-connection defaults. Empty when nothing needed changing.
 */
export interface KubernetesAiAgentDefaultsApplied {
  turnedOnInvestigation: boolean;
  remediationMode?: KubernetesAiRemediationMode | undefined;
}

/*
 * What the agent's reported settings changed on its cluster: where the
 * settings are set (see AgentAiSettingsSource), and each setting that
 * moved, from and to. Nothing moved when neither is set — the cluster
 * already had them, or they are set in OneUptime.
 */
export interface KubernetesAiAgentSettingsApplied {
  source: AgentAiSettingsSource;
  investigation?: { from: boolean; to: boolean } | undefined;
  remediationMode?:
    | {
        from: KubernetesAiRemediationMode;
        to: KubernetesAiRemediationMode;
      }
    | undefined;
}

/*
 * How often a heartbeat re-checks that the cluster still holds the
 * settings its agent reports (per agent, per process). The settings change
 * only when the agent restarts with a new configuration, which registers
 * again and applies them at once; this catches what moved them meanwhile —
 * a Runner binding cleared by deleting the Runner, a write a server older
 * than this check accepted during a rolling deploy.
 */
export const KUBERNETES_AI_AGENT_SETTINGS_CHECK_INTERVAL_MS: number =
  10 * 60 * 1000;
const MAX_AI_SETTINGS_CHECKS_REMEMBERED: number = 10_000;

// What registration and heartbeat read off the agent's cluster.
const CLUSTER_SELECT: Select<KubernetesCluster> = {
  _id: true,
  projectId: true,
  clusterIdentifier: true,
  isAiInvestigationEnabled: true,
  aiRemediationMode: true,
  aiAccessConfiguredAt: true,
  aiAccessRunnerId: true,
};

// What deciding "is this binding a Runner an operator chose?" reads.
const BOUND_RUNNER_SELECT: Select<Runner> = {
  _id: true,
  name: true,
  hostInfo: true,
};

/*
 * A key hash that no key can have (its preimage is unknown), compared
 * against when the presented agent id matches no row, so an unknown id and
 * a wrong key cost the same.
 */
const UNMATCHABLE_KEY_HASH: string = "0".repeat(64);

/*
 * When the previous in-cluster Runner of a cluster may be retired (see
 * retireLegacyRunnerIfUnused): the agent has existed for a day, the Runner
 * has been silent for a week, and this is checked at most hourly.
 */
export const LEGACY_RUNNER_RETIREMENT_AGENT_AGE_HOURS: number = 24;
export const LEGACY_RUNNER_RETIREMENT_OFFLINE_DAYS: number = 7;
export const LEGACY_RUNNER_RETIREMENT_CHECK_INTERVAL_MS: number =
  60 * 60 * 1000;
const MAX_LEGACY_RUNNER_RETIREMENT_CHECKS_REMEMBERED: number = 10_000;

// What retireLegacyRunnerIfUnused decided.
export type LegacyRunnerRetirementOutcome =
  | "not_due"
  | "agent_too_new"
  | "no_legacy_runner"
  | "legacy_runner_recently_online"
  | "legacy_runner_holds_more"
  | "legacy_runner_in_rule"
  | "retired"
  | "failed";

/*
 * The Kubernetes AI agent of a cluster (see the model): its identity, and
 * everything the server does about it.
 *
 * - Shared helpers every caller needs: key minting and hashing, the one
 *   online rule, the summary the dashboard sees and the reads the status
 *   builder uses.
 * - The identity lifecycle behind /kubernetes-ai-agent-ingest: register
 *   (with the project's telemetry ingestion key; hands out an agent key),
 *   authenticate (every later request, by agent id and key), heartbeat and
 *   sign-off — plus the admin reset on the cluster's AI agent page.
 *
 * Registration never deletes or unbinds anything: the cluster's settings,
 * its Runner binding and the previous in-cluster Runner are left as they
 * are. The only cluster setting it ever writes is the first-connection
 * defaults, and only on a cluster nobody configured. The previous
 * in-cluster Runner is removed only later, lazily, once it is certainly
 * unused (retireLegacyRunnerIfUnused).
 */
export class Service extends DatabaseService<Model> {
  // Agent id → when this process last checked its previous Runner (ms).
  private legacyRunnerRetirementCheckedAt: Map<string, number> = new Map<
    string,
    number
  >();

  // Agent id → when a heartbeat last re-checked its cluster's settings (ms).
  private aiSettingsCheckedAt: Map<string, number> = new Map<string, number>();

  public constructor() {
    super(Model);
  }

  /*
   * sha256 (hex) of an agent key: what KubernetesAiAgent.keyHash stores.
   * The key itself is never stored.
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

  /*
   * The one "is the agent online?" rule: it says it is connected (it
   * registered or heartbeated and has not signed off or been reset) AND it
   * was heard from within KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES. A
   * heartbeat stamped slightly in the future (another server's clock) still
   * counts as recent.
   */
  public isOnline(row: KubernetesAiAgentPresenceRow, now?: Date): boolean {
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
      KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60 * 1000
    );
  }

  /*
   * The row as the dashboard and the status builder see it. Never carries
   * the key hash; the posture is re-validated on the way out, so a stored
   * value of the wrong shape is dropped rather than trusted.
   */
  public toSummary(
    row: Pick<
      Model,
      | "id"
      | "agentVersion"
      | "posture"
      | "lastRegisteredAt"
      | "lastRefusedRegistrationAt"
      | "lastRefusedRegistrationReason"
    > &
      KubernetesAiAgentPresenceRow,
    now?: Date,
  ): KubernetesAiAgentSummary {
    const connectionStatus: KubernetesAiAgentConnectionStatus =
      row.connectionStatus === "connected" ? "connected" : "disconnected";

    const posture: KubernetesAgentPosture | undefined =
      parseKubernetesAgentPosture(row.posture);

    return {
      id: row.id ? row.id.toString() : "",
      isOnline: this.isOnline(row, now),
      connectionStatus,
      lastAliveAt: toIsoString(row.lastAliveAt),
      lastRegisteredAt: toIsoString(row.lastRegisteredAt),
      agentVersion: row.agentVersion || undefined,
      posture,
      lastRefusedRegistrationAt: toIsoString(row.lastRefusedRegistrationAt),
      lastRefusedRegistrationReason:
        row.lastRefusedRegistrationReason || undefined,
    };
  }

  // The cluster's agent row (as root, without the key hash), or null.
  @CaptureSpan()
  public async findForCluster(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: data.kubernetesClusterId,
      },
      select: KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The agent rows of several clusters of one project in one query, keyed
   * by cluster id (string). Clusters without an agent are simply absent.
   */
  @CaptureSpan()
  public async findForClusters(data: {
    projectId: ObjectID;
    kubernetesClusterIds: Array<ObjectID>;
  }): Promise<Map<string, Model>> {
    const byClusterId: Map<string, Model> = new Map<string, Model>();

    const clusterIds: Array<string> = Array.from(
      new Set(
        data.kubernetesClusterIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ),
    );

    if (clusterIds.length === 0) {
      return byClusterId;
    }

    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: QueryHelper.any(clusterIds),
      },
      select: KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const row of rows) {
      const clusterId: string | undefined = row.kubernetesClusterId?.toString();

      if (clusterId && clusterIds.includes(clusterId)) {
        byClusterId.set(clusterId, row);
      }
    }

    return byClusterId;
  }

  /*
   * ------------------------------------------------------------------
   * Registration
   * ------------------------------------------------------------------
   */

  /*
   * The agent registering for its cluster (POST
   * /kubernetes-ai-agent-ingest/register, authenticated by the project's
   * telemetry ingestion key). Hands out a fresh agent key; only its hash is
   * kept.
   *
   * Refused (KubernetesAiAgentRegistrationRefusedException, a 403 with the
   * reason) when:
   *  - the cluster name is empty or too long (cluster_name_invalid);
   *  - this cluster's previous in-cluster Runner is still online
   *    (legacy_runner_online) — a helm upgrade stops it within seconds, and
   *    an ingestion key alone must never take a cluster away from a live
   *    Runner;
   *  - the cluster's agent is online and the request did not present its
   *    current key (previous_instance_online) — recorded on the row so the
   *    AI agent page can say another agent tried;
   *  - a new row would pass the project's caps (agent_cap_reached).
   *
   * An existing row is re-keyed when the request proves continuity (its
   * current key as previousAgentKey), or when the row was reset, or its
   * agent signed off or went quiet: what a restarted pod looks like.
   *
   * On a cluster nobody configured it applies the first-connection defaults
   * (applyFirstConnectionDefaults). It never deletes, unbinds or rebinds
   * anything, and writes ONE feed item when a cluster's agent first
   * connects.
   */
  @CaptureSpan()
  public async register(data: {
    projectId: ObjectID;
    clusterName: unknown;
    agentVersion?: string | undefined;
    // The key the agent currently holds, when it still has one.
    previousAgentKey?: string | undefined;
    // The bare posture the body reports; parsed here, never trusted as is.
    posture?: unknown;
    // The TelemetryIngestionKey the request was admitted with, when known.
    ingestionKeyId?: ObjectID | undefined;
  }): Promise<KubernetesAiAgentRegistrationResult> {
    const clusterName: string = this.getValidClusterName(data.clusterName);

    const cluster: KubernetesCluster = await this.findOrCreateCluster({
      projectId: data.projectId,
      clusterName,
    });

    // The cluster row's own spelling of its name, whatever the chart sent.
    const clusterIdentifier: string =
      cluster.clusterIdentifier?.trim() || clusterName;

    await this.assertLegacyRunnerIsNotOnline({
      projectId: data.projectId,
      cluster,
      clusterIdentifier,
    });

    const posture: KubernetesAgentPosture = this.buildStoredPosture({
      reported: data.posture,
      clusterIdentifier,
    });

    const agentVersion: string | undefined = Service.normalizeAgentVersion(
      data.agentVersion,
    );

    const agentKey: string = Service.generateKey();
    const now: Date = OneUptimeDate.getCurrentDate();

    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: cluster.id!,
      },
      select: { ...KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY, keyHash: true },
      props: { isRoot: true },
    });

    let agentId: ObjectID;
    let admission: KubernetesAiAgentRegistrationAdmission;

    if (existing && existing.id) {
      admission = await this.admitReRegistration({
        agent: existing,
        previousAgentKey: data.previousAgentKey,
        clusterIdentifier,
        projectId: data.projectId,
      });

      await this.updateOneById({
        id: existing.id,
        data: {
          keyHash: Service.hashKey(agentKey),
          posture: posture as JSONObject,
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
        clusterIdentifier,
      });

      const row: Model = new Model();
      row.projectId = data.projectId;
      row.kubernetesClusterId = cluster.id!;
      row.keyHash = Service.hashKey(agentKey);
      row.posture = posture as JSONObject;
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
        clusterIdentifier,
      });

      agentId = created.id!;
      admission = "created";
    }

    logger.info(
      `KubernetesAiAgent: the Kubernetes AI agent of cluster "${clusterIdentifier}" in project ${data.projectId.toString()} registered (${admission}).`,
    );

    /*
     * The new key's hash is stored: from here on nothing may fail the
     * registration, or the agent never receives a key the row now demands
     * (see applyFirstConnectionDefaultsSafely). The feed items are safe
     * already — KubernetesClusterFeedService never throws.
     *
     * What AI may do: the agent's own settings when they decide here, else
     * — an agent too old to report them, a cluster an operator configured
     * or bound to a Runner — the first-connection defaults, which leave a
     * configured cluster alone.
     */
    const settingsApplied: KubernetesAiAgentSettingsApplied | null =
      await this.applyReportedAiSettingsSafely({
        cluster,
        reported: posture.aiSettings,
      });

    const defaultsApplied: KubernetesAiAgentDefaultsApplied =
      settingsApplied && isAgentAiSettingsSourceAgent(settingsApplied.source)
        ? { turnedOnInvestigation: false }
        : await this.applyFirstConnectionDefaultsSafely({
            cluster,
            allowWrites: posture.allowWrites === true,
          });

    if (admission === "created") {
      await this.writeConnectedFeedItem({
        cluster,
        agentId,
        posture,
        agentVersion,
        defaultsApplied,
        settingsApplied,
      });
    } else if (Service.didApplyAiSettings(settingsApplied)) {
      await this.writeAiSettingsFeedItem({
        cluster,
        applied: settingsApplied!,
      });
    } else if (Service.didApplyDefaults(defaultsApplied)) {
      await this.writeDefaultsFeedItem({ cluster, posture, defaultsApplied });
    }

    return {
      agentId,
      agentKey,
      clusterId: cluster.id!,
      admission,
    };
  }

  /*
   * How a registration for a cluster that already has an agent row is
   * admitted, or null when it must be refused (the row's agent is online
   * and the request did not prove it is that agent). A reset row admits
   * anyone: no key is valid for it, and the admin reset is exactly the
   * "let the real pod back in" action.
   */
  public getReRegistrationAdmission(data: {
    agent: {
      keyHash?: string | null | undefined;
    } & KubernetesAiAgentPresenceRow;
    previousAgentKey?: string | undefined;
    now?: Date | undefined;
  }): KubernetesAiAgentRegistrationAdmission | null {
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
   * The first-connection defaults, applied ONLY to a cluster nobody
   * configured (aiAccessConfiguredAt is null — an operator's write of any AI
   * setting stamps it): investigating with kubectl on, and, when the chart
   * granted the agent write RBAC, fixes "Ask for approval" instead of Off.
   * The chart's write RBAC is the cluster operator's consent for that; a
   * human still approves every fix. Never sets aiAccessConfiguredAt, so
   * these stay defaults — and never touches a mode an operator chose.
   *
   * Registration applies them every time; a heartbeat applies them when the
   * agent's write access appears (the chart was upgraded to allow writes).
   * The update is conditioned on the cluster still being unconfigured, so
   * an operator's choice made a moment earlier is never overwritten.
   */
  @CaptureSpan()
  public async applyFirstConnectionDefaults(data: {
    cluster: KubernetesCluster;
    allowWrites: boolean;
  }): Promise<KubernetesAiAgentDefaultsApplied> {
    const defaults: KubernetesAiAgentDefaultsApplied =
      this.getFirstConnectionDefaults(data);

    if (!Service.didApplyDefaults(defaults) || !data.cluster.id) {
      return { turnedOnInvestigation: false };
    }

    const updated: number = await KubernetesClusterService.updateOneBy({
      query: {
        _id: data.cluster.id.toString(),
        aiAccessConfiguredAt: QueryHelper.isNull(),
        ...(data.cluster.projectId
          ? { projectId: data.cluster.projectId }
          : {}),
      },
      data: {
        ...(defaults.turnedOnInvestigation
          ? { isAiInvestigationEnabled: true }
          : {}),
        ...(defaults.remediationMode
          ? { aiRemediationMode: defaults.remediationMode }
          : {}),
      } as never,
      props: { isRoot: true },
    });

    if (updated === 0) {
      return { turnedOnInvestigation: false };
    }

    logger.info(
      `KubernetesAiAgent: applied the first-connection defaults to cluster ${data.cluster.id.toString()} (${[
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
    cluster: KubernetesCluster;
    allowWrites: boolean;
  }): Promise<KubernetesAiAgentDefaultsApplied> {
    try {
      return await this.applyFirstConnectionDefaults(data);
    } catch (error) {
      logger.error(
        `KubernetesAiAgent: could not apply the first-connection defaults to cluster ${data.cluster.id?.toString()}; the next registration tries again: ${error}`,
      );
      return { turnedOnInvestigation: false };
    }
  }

  // What applyFirstConnectionDefaults would change, without writing it.
  public getFirstConnectionDefaults(data: {
    cluster: Pick<
      KubernetesCluster,
      "aiAccessConfiguredAt" | "isAiInvestigationEnabled" | "aiRemediationMode"
    >;
    allowWrites: boolean;
  }): KubernetesAiAgentDefaultsApplied {
    if (data.cluster.aiAccessConfiguredAt) {
      return { turnedOnInvestigation: false };
    }

    const isRemediationOff: boolean =
      KubernetesClusterAiAccessService.normalizeRemediationMode(
        data.cluster.aiRemediationMode,
      ) === KubernetesAiRemediationMode.Disabled;

    return {
      turnedOnInvestigation: data.cluster.isAiInvestigationEnabled !== true,
      ...(data.allowWrites && isRemediationOff
        ? { remediationMode: KubernetesAiRemediationMode.RequireApproval }
        : {}),
    };
  }

  public static didApplyDefaults(
    defaults: KubernetesAiAgentDefaultsApplied,
  ): boolean {
    return defaults.turnedOnInvestigation || Boolean(defaults.remediationMode);
  }

  /*
   * ------------------------------------------------------------------
   * What AI may do, as the agent's configuration sets it
   * ------------------------------------------------------------------
   *
   * The agent reports aiSettings (investigation, fixes, and whether its
   * configuration names them) on registration and every heartbeat. When
   * they decide (getAiSettingsSource), OneUptime writes them to the
   * cluster's isAiInvestigationEnabled and aiRemediationMode — the columns
   * every enforcement point already reads, from the enqueue chokepoint to
   * the remediation toolkit — so what OneUptime allows is exactly what the
   * agent's configuration allows, never more. KubernetesClusterService
   * refuses an operator's change to either column while they decide.
   */

  /*
   * Is the cluster bound to a Runner an operator chose — one that is not a
   * kubernetes-agent row? AI then reaches the cluster through that Runner,
   * not the agent, so the agent's configuration does not decide what AI may
   * do there. A binding whose Runner is gone is none (the foreign key nulls
   * it).
   */
  @CaptureSpan()
  public async isBoundToAdvancedRunner(
    cluster: Pick<KubernetesCluster, "aiAccessRunnerId" | "projectId">,
  ): Promise<boolean> {
    if (!cluster.aiAccessRunnerId) {
      return false;
    }

    const runner: Runner | null = await RunnerService.findOneBy({
      query: {
        _id: cluster.aiAccessRunnerId.toString(),
        ...(cluster.projectId ? { projectId: cluster.projectId } : {}),
      },
      select: BOUND_RUNNER_SELECT,
      props: { isRoot: true },
    });

    return (
      Boolean(runner) && !RunnerServiceClass.isKubernetesAgentRunnerRow(runner)
    );
  }

  /*
   * Where a cluster's investigation and fixes are set: by its agent's
   * configuration, by its agent's defaults (only while nobody chose them on
   * the AI agent page), or in OneUptime. See getAgentAiSettingsSource.
   */
  public getAiSettingsSource(data: {
    // The agent's reported settings; undefined: no agent, or one too old.
    reported: AgentAiSettings | undefined;
    cluster: Pick<KubernetesCluster, "aiAccessConfiguredAt">;
    isBoundToAdvancedRunner: boolean;
  }): AgentAiSettingsSource {
    return getAgentAiSettingsSource({
      reported: data.reported,
      isChosenInOneUptime: Boolean(data.cluster.aiAccessConfiguredAt),
      isAgentTheExecutor: !data.isBoundToAdvancedRunner,
    });
  }

  // What writing `reported` to the cluster would change, without writing it.
  public getAiSettingsChanges(data: {
    reported: AgentAiSettings;
    cluster: Pick<
      KubernetesCluster,
      "isAiInvestigationEnabled" | "aiRemediationMode"
    >;
  }): Omit<KubernetesAiAgentSettingsApplied, "source"> {
    const currentInvestigation: boolean =
      data.cluster.isAiInvestigationEnabled === true;
    const currentMode: KubernetesAiRemediationMode =
      KubernetesClusterAiAccessService.normalizeRemediationMode(
        data.cluster.aiRemediationMode,
      );
    const reportedMode: KubernetesAiRemediationMode =
      KubernetesClusterAiAccessService.normalizeRemediationMode(
        data.reported.fixes,
      );

    return {
      ...(currentInvestigation !== data.reported.investigation
        ? {
            investigation: {
              from: currentInvestigation,
              to: data.reported.investigation,
            },
          }
        : {}),
      ...(currentMode !== reportedMode
        ? { remediationMode: { from: currentMode, to: reportedMode } }
        : {}),
    };
  }

  public static didApplyAiSettings(
    applied: KubernetesAiAgentSettingsApplied | null,
  ): boolean {
    return Boolean(applied?.investigation || applied?.remediationMode);
  }

  /*
   * Write the agent's reported settings to its cluster when they decide
   * there. A root write, so none of the operator gates or markers apply:
   * aiAccessConfiguredAt stays as it is, because nobody chose these on the
   * AI agent page. The agent's defaults are written only while the cluster
   * is still unconfigured, in the same statement, so an operator's choice
   * made a moment earlier is never overwritten. Returns null when the agent
   * reported nothing.
   */
  @CaptureSpan()
  public async applyReportedAiSettings(data: {
    cluster: KubernetesCluster;
    reported: AgentAiSettings | undefined;
    // Read here when the caller has not.
    isBoundToAdvancedRunner?: boolean | undefined;
  }): Promise<KubernetesAiAgentSettingsApplied | null> {
    const { cluster, reported } = data;

    if (!reported || !cluster.id) {
      return null;
    }

    const isBoundToAdvancedRunner: boolean =
      data.isBoundToAdvancedRunner ??
      (await this.isBoundToAdvancedRunner(cluster));

    const source: AgentAiSettingsSource = this.getAiSettingsSource({
      reported,
      cluster,
      isBoundToAdvancedRunner,
    });

    if (!isAgentAiSettingsSourceAgent(source)) {
      return { source };
    }

    const changes: Omit<KubernetesAiAgentSettingsApplied, "source"> =
      this.getAiSettingsChanges({ reported, cluster });

    if (!changes.investigation && !changes.remediationMode) {
      return { source };
    }

    const updated: number = await KubernetesClusterService.updateOneBy({
      query: {
        _id: cluster.id.toString(),
        ...(cluster.projectId ? { projectId: cluster.projectId } : {}),
        ...(source === "agent_defaults"
          ? { aiAccessConfiguredAt: QueryHelper.isNull() }
          : {}),
      },
      data: {
        ...(changes.investigation
          ? { isAiInvestigationEnabled: changes.investigation.to }
          : {}),
        ...(changes.remediationMode
          ? { aiRemediationMode: changes.remediationMode.to }
          : {}),
      } as never,
      props: { isRoot: true },
    });

    /*
     * Nothing landed. For the defaults, the condition failed: an operator
     * chose the settings a moment ago, so they are OneUptime's now. For a
     * configuration, the cluster row is gone.
     */
    if (updated === 0) {
      return { source: source === "agent_defaults" ? "oneuptime" : source };
    }

    // The cluster row now holds them; later reads see the new values.
    if (changes.investigation) {
      cluster.isAiInvestigationEnabled = changes.investigation.to;
    }
    if (changes.remediationMode) {
      cluster.aiRemediationMode = changes.remediationMode.to;
    }

    logger.info(
      `KubernetesAiAgent: applied the ${
        source === "agent_configuration" ? "configured" : "default"
      } AI settings of the Kubernetes AI agent to cluster ${cluster.id.toString()} (${[
        changes.investigation
          ? `investigation ${changes.investigation.to ? "on" : "off"}`
          : "",
        changes.remediationMode ? `fixes ${changes.remediationMode.to}` : "",
      ]
        .filter(Boolean)
        .join(", ")}).`,
    );

    return { source, ...changes };
  }

  /*
   * applyReportedAiSettings for a request whose real work is already
   * written (see applyFirstConnectionDefaultsSafely for why it must never
   * fail that request). A failure is logged and reported as "nothing
   * applied", so no feed item claims a change that did not happen; the
   * next registration, or the heartbeat's periodic check, applies them.
   */
  private async applyReportedAiSettingsSafely(data: {
    cluster: KubernetesCluster;
    reported: AgentAiSettings | undefined;
  }): Promise<KubernetesAiAgentSettingsApplied | null> {
    try {
      return await this.applyReportedAiSettings(data);
    } catch (error) {
      logger.error(
        `KubernetesAiAgent: could not apply the Kubernetes AI agent's AI settings to cluster ${data.cluster.id?.toString()}; the next registration or check tries again: ${error}`,
      );
      return null;
    }
  }

  /*
   * Apply the settings a cluster's agent last reported, now — for a cluster
   * whose Runner binding was just cleared, which hands it back to its agent.
   * Never throws.
   */
  @CaptureSpan()
  public async applyStoredAiSettingsToCluster(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
  }): Promise<KubernetesAiAgentSettingsApplied | null> {
    try {
      const agent: Model | null = await this.findForCluster(data);

      if (!agent) {
        return null;
      }

      const reported: AgentAiSettings | undefined = parseKubernetesAgentPosture(
        agent.posture,
      )?.aiSettings;

      if (!reported) {
        return null;
      }

      const cluster: KubernetesCluster | null =
        await this.findAgentCluster(agent);

      if (!cluster) {
        return null;
      }

      const applied: KubernetesAiAgentSettingsApplied | null =
        await this.applyReportedAiSettings({ cluster, reported });

      if (applied && Service.didApplyAiSettings(applied)) {
        await this.writeAiSettingsFeedItem({ cluster, applied });
      }

      return applied;
    } catch (error) {
      logger.error(
        `KubernetesAiAgent: could not apply the Kubernetes AI agent's AI settings to cluster ${data.kubernetesClusterId.toString()}: ${error}`,
      );
      return null;
    }
  }

  /*
   * Where each of these clusters' settings are set, for the update hook
   * that refuses an operator's change while the agent decides. The agent
   * rows are read here unless the caller already read them (one query per
   * project), and a bound Runner only for a cluster whose agent reports
   * settings at all — every other cluster reads "oneuptime" whatever it is
   * bound to. Keyed by cluster id.
   */
  @CaptureSpan()
  public async getAiSettingsSourcesForClusters(data: {
    projectId: ObjectID;
    clusters: Array<
      Pick<
        KubernetesCluster,
        "id" | "_id" | "aiAccessRunnerId" | "aiAccessConfiguredAt"
      >
    >;
    // The clusters' agent rows, keyed by cluster id, when already read.
    agents?: Map<string, Model> | undefined;
  }): Promise<Map<string, AgentAiSettingsSource>> {
    const sources: Map<string, AgentAiSettingsSource> = new Map<
      string,
      AgentAiSettingsSource
    >();

    const clusterIds: Array<ObjectID> = data.clusters
      .map(
        (
          cluster: Pick<KubernetesCluster, "id" | "_id">,
        ): string | undefined => {
          return cluster.id?.toString() || cluster._id?.toString();
        },
      )
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });

    const agents: Map<string, Model> =
      data.agents ||
      (await this.findForClusters({
        projectId: data.projectId,
        kubernetesClusterIds: clusterIds,
      }));

    const runnerIds: Array<string> = Array.from(
      new Set(
        data.clusters
          .filter(
            (
              cluster: Pick<
                KubernetesCluster,
                "id" | "_id" | "aiAccessRunnerId"
              >,
            ): boolean => {
              const agent: Model | undefined = agents.get(
                cluster.id?.toString() || cluster._id?.toString() || "",
              );

              return Boolean(
                cluster.aiAccessRunnerId &&
                  agent &&
                  parseKubernetesAgentPosture(agent.posture)?.aiSettings,
              );
            },
          )
          .map(
            (cluster: Pick<KubernetesCluster, "aiAccessRunnerId">): string => {
              return cluster.aiAccessRunnerId?.toString() || "";
            },
          )
          .filter(Boolean),
      ),
    );

    const runners: Array<Runner> =
      runnerIds.length > 0
        ? await RunnerService.findBy({
            query: {
              _id: QueryHelper.any(runnerIds),
              projectId: data.projectId,
            },
            select: BOUND_RUNNER_SELECT,
            limit: LIMIT_MAX,
            skip: 0,
            props: { isRoot: true },
          })
        : [];

    const advancedRunnerIds: Set<string> = new Set<string>(
      runners
        .filter((runner: Runner): boolean => {
          return !RunnerServiceClass.isKubernetesAgentRunnerRow(runner);
        })
        .map((runner: Runner): string => {
          return runner.id?.toString() || runner._id?.toString() || "";
        }),
    );

    for (const cluster of data.clusters) {
      const clusterId: string =
        cluster.id?.toString() || cluster._id?.toString() || "";

      if (!clusterId) {
        continue;
      }

      const agent: Model | undefined = agents.get(clusterId);

      sources.set(
        clusterId,
        this.getAiSettingsSource({
          reported: agent
            ? parseKubernetesAgentPosture(agent.posture)?.aiSettings
            : undefined,
          cluster,
          isBoundToAdvancedRunner: Boolean(
            cluster.aiAccessRunnerId &&
              advancedRunnerIds.has(cluster.aiAccessRunnerId.toString()),
          ),
        }),
      );
    }

    return sources;
  }

  /*
   * Whether a heartbeat should re-check its cluster's settings: at most once
   * per KUBERNETES_AI_AGENT_SETTINGS_CHECK_INTERVAL_MS per agent in this
   * process, stamped before the check runs.
   */
  private isAiSettingsCheckDue(agentId: string, now: Date): boolean {
    const lastCheckedAt: number | undefined =
      this.aiSettingsCheckedAt.get(agentId);

    if (
      lastCheckedAt !== undefined &&
      now.getTime() - lastCheckedAt <
        KUBERNETES_AI_AGENT_SETTINGS_CHECK_INTERVAL_MS
    ) {
      return false;
    }

    if (this.aiSettingsCheckedAt.size >= MAX_AI_SETTINGS_CHECKS_REMEMBERED) {
      this.aiSettingsCheckedAt.clear();
    }

    this.aiSettingsCheckedAt.set(agentId, now.getTime());

    return true;
  }

  /*
   * The posture a row stores: what the agent reported, validated field by
   * field, with the two facts the server decides itself forced — it runs in
   * the cluster (inCluster), and WHICH cluster (the cluster row's
   * identifier). A body can never make the agent the in-cluster executor of
   * another cluster.
   */
  public buildStoredPosture(data: {
    reported: unknown;
    clusterIdentifier: string;
  }): KubernetesAgentPosture {
    const reported: KubernetesAgentPosture =
      parseKubernetesAgentPosture(data.reported) || {};

    const posture: KubernetesAgentPosture = {
      ...reported,
      clusterIdentifier: data.clusterIdentifier.trim() || undefined,
      inCluster: true,
      allowWrites: reported.allowWrites === true,
    };

    // A JSON column: store only what is known, never `undefined` keys.
    for (const key of Object.keys(posture) as Array<
      keyof KubernetesAgentPosture
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

  private getValidClusterName(raw: unknown): string {
    const clusterName: string = typeof raw === "string" ? raw.trim() : "";

    if (!clusterName) {
      throw new KubernetesAiAgentRegistrationRefusedException({
        reason: "cluster_name_invalid",
        message:
          "The Kubernetes AI agent did not send a cluster name. Set clusterName on the kubernetes-agent chart.",
      });
    }

    if (clusterName.length > MAX_KUBERNETES_AI_AGENT_CLUSTER_NAME_LENGTH) {
      throw new KubernetesAiAgentRegistrationRefusedException({
        reason: "cluster_name_invalid",
        message: `The cluster name is ${clusterName.length} characters long; the limit is ${MAX_KUBERNETES_AI_AGENT_CLUSTER_NAME_LENGTH}. Set a shorter clusterName on the kubernetes-agent chart.`,
      });
    }

    return clusterName;
  }

  /*
   * The cluster the agent names, created when OneUptime has not seen it yet
   * (the agent may register before the collector's first telemetry), then
   * re-read for the AI columns registration needs.
   */
  private async findOrCreateCluster(data: {
    projectId: ObjectID;
    clusterName: string;
  }): Promise<KubernetesCluster> {
    const found: KubernetesCluster =
      await KubernetesClusterService.findOrCreateByClusterIdentifier({
        projectId: data.projectId,
        clusterIdentifier: data.clusterName,
      });

    const cluster: KubernetesCluster | null =
      await KubernetesClusterService.findOneBy({
        query: { _id: found.id!.toString(), projectId: data.projectId },
        select: CLUSTER_SELECT,
        props: { isRoot: true },
      });

    if (!cluster || !cluster.id) {
      throw new BadDataException("Cluster could not be resolved.");
    }

    return cluster;
  }

  /*
   * The previous in-cluster Runner (the kubernetes-agent chart's ai-runner,
   * which this agent replaces) keeps its cluster while it is online. During
   * a helm upgrade the old pod stops within seconds of the new one starting,
   * so the agent is only asked to wait; an ingestion key alone can never
   * take a cluster away from a Runner that is still working.
   */
  private async assertLegacyRunnerIsNotOnline(data: {
    projectId: ObjectID;
    cluster: KubernetesCluster;
    clusterIdentifier: string;
  }): Promise<void> {
    const legacyRunner: Runner | null =
      await KubernetesClusterAiAccessService.getLegacyAgentRunnerForCluster({
        projectId: data.projectId,
        kubernetesClusterId: data.cluster.id!,
        clusterIdentifier: data.clusterIdentifier,
      });

    if (
      !legacyRunner ||
      !KubernetesClusterAiAccessService.isRunnerOnline(legacyRunner)
    ) {
      return;
    }

    logger.info(
      `KubernetesAiAgent: asked the Kubernetes AI agent of cluster "${data.clusterIdentifier}" in project ${data.projectId.toString()} to wait: its previous in-cluster Runner (${legacyRunner.id?.toString()}) is still online.`,
    );

    throw new KubernetesAiAgentRegistrationRefusedException({
      reason: "legacy_runner_online",
      retryAfterSeconds: KUBERNETES_AI_AGENT_REGISTRATION_RETRY_AFTER_SECONDS,
      message: `The previous in-cluster Runner of cluster "${data.clusterIdentifier}" is still online. This is normal for a few seconds during a helm upgrade, and the agent retries on its own. If it lasts, remove the old ai-runner pod.`,
    });
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
    clusterIdentifier: string;
    projectId: ObjectID;
  }): Promise<KubernetesAiAgentRegistrationAdmission> {
    const admission: KubernetesAiAgentRegistrationAdmission | null =
      this.getReRegistrationAdmission({
        agent: data.agent,
        previousAgentKey: data.previousAgentKey,
      });

    if (admission) {
      return admission;
    }

    logger.warn(
      `KubernetesAiAgent: refused a registration for cluster "${data.clusterIdentifier}" in project ${data.projectId.toString()}: its agent (${data.agent.id?.toString()}) is online and the request did not present its current key.`,
    );

    await this.recordRefusedRegistration({
      agentId: data.agent.id!,
      reason: "previous_instance_online",
    });

    throw this.getPreviousInstanceOnlineRefusal(data.clusterIdentifier);
  }

  private getPreviousInstanceOnlineRefusal(
    clusterIdentifier: string,
  ): KubernetesAiAgentRegistrationRefusedException {
    return new KubernetesAiAgentRegistrationRefusedException({
      reason: "previous_instance_online",
      retryAfterSeconds: KUBERNETES_AI_AGENT_REGISTRATION_RETRY_AFTER_SECONDS,
      message: `Another Kubernetes AI agent for cluster "${clusterIdentifier}" is online. This is normal for a moment while its pod restarts, and the agent retries on its own. If it lasts, make sure only one kubernetes-agent release uses clusterName "${clusterIdentifier}".`,
    });
  }

  // Best-effort: recording a refusal must never turn it into a 500.
  private async recordRefusedRegistration(data: {
    agentId: ObjectID;
    reason: KubernetesAiAgentRegistrationRefusalReason;
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
        `KubernetesAiAgent: could not record a refused registration on agent ${data.agentId.toString()}: ${error}`,
      );
    }
  }

  // Bounds what an ingestion key can create (see the caps above).
  private async assertAgentMayBeCreated(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
  }): Promise<void> {
    const total: number = (
      await this.countBy({
        query: { projectId: data.projectId },
        props: { isRoot: true },
      })
    ).toNumber();

    if (total >= MAX_KUBERNETES_AI_AGENTS_PER_PROJECT) {
      logger.warn(
        `KubernetesAiAgent: refused to create an agent for cluster "${data.clusterIdentifier}" in project ${data.projectId.toString()}: the project already has ${total} (limit ${MAX_KUBERNETES_AI_AGENTS_PER_PROJECT}).`,
      );

      throw new KubernetesAiAgentRegistrationRefusedException({
        reason: "agent_cap_reached",
        message: `This project already has ${total} Kubernetes AI agents, which is its limit (${MAX_KUBERNETES_AI_AGENTS_PER_PROJECT}). Delete the clusters you no longer use under Kubernetes; the agent then connects on its next retry.`,
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

    if (
      createdInLastHour >= MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR
    ) {
      logger.warn(
        `KubernetesAiAgent: refused to create an agent for cluster "${data.clusterIdentifier}" in project ${data.projectId.toString()}: ${createdInLastHour} were created in the last hour (limit ${MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR}).`,
      );

      throw new KubernetesAiAgentRegistrationRefusedException({
        reason: "agent_cap_reached",
        message: `${createdInLastHour} Kubernetes AI agents connected to this project in the last hour, which is its limit (${MAX_NEW_KUBERNETES_AI_AGENTS_PER_PROJECT_PER_HOUR}). The agent connects on a later retry.`,
      });
    }
  }

  /*
   * Creates the cluster's agent row. The database allows one per cluster,
   * so when two pods register for a new cluster at once one create loses;
   * that pod is told the other agent is online (it is — it just
   * registered), exactly as if it had arrived a moment later.
   */
  private async createAgentRow(data: {
    row: Model;
    clusterIdentifier: string;
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
          kubernetesClusterId: data.row.kubernetesClusterId!,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!winner) {
        throw error;
      }

      logger.info(
        `KubernetesAiAgent: two agents registered for cluster "${data.clusterIdentifier}" at once; the other one was admitted.`,
      );

      throw this.getPreviousInstanceOnlineRefusal(data.clusterIdentifier);
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
      select: { ...KUBERNETES_AI_AGENT_SELECT_WITHOUT_KEY, keyHash: true },
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
   * registration stores it (validated, with inCluster and the cluster's
   * identifier forced); a heartbeat without one keeps the stored posture.
   *
   * When the agent's write access appears (the chart was upgraded with
   * aiAgent.remediation.enabled=true) on a cluster nobody configured, the
   * first-connection defaults apply again, so fixes move from Off to "Ask
   * for approval" without anyone visiting the AI agent page. It is also
   * where the previous in-cluster Runner's retirement is checked (hourly).
   *
   * This runs every 30 seconds per cluster, so a normal heartbeat is one
   * UPDATE without hooks and no read: the cluster's identifier comes from
   * the stored posture, which registration took from the cluster row. The
   * cluster row is read only when the stored posture lacks it or write
   * access just appeared; the hourly Runner check reads it itself.
   */
  @CaptureSpan()
  public async heartbeat(data: {
    // The row authenticate returned for this request.
    agent: Model;
    agentVersion?: string | undefined;
    posture?: unknown;
  }): Promise<void> {
    const agentId: ObjectID | null = data.agent.id;

    if (!agentId) {
      throw new BadDataException("The agent is missing its id.");
    }

    const storedPosture: KubernetesAgentPosture | undefined =
      parseKubernetesAgentPosture(data.agent.posture);

    const isPostureReported: boolean = Boolean(
      data.posture && typeof data.posture === "object",
    );

    let cluster: KubernetesCluster | null = null;
    let clusterIdentifier: string =
      storedPosture?.clusterIdentifier?.trim() || "";

    if (isPostureReported && !clusterIdentifier) {
      cluster = await this.findAgentCluster(data.agent);
      clusterIdentifier = cluster?.clusterIdentifier?.trim() || "";
    }

    const posture: KubernetesAgentPosture | undefined = isPostureReported
      ? this.buildStoredPosture({
          reported: data.posture,
          clusterIdentifier,
        })
      : undefined;

    const agentVersion: string | undefined = Service.normalizeAgentVersion(
      data.agentVersion,
    );

    const update: JSONObject = {
      lastAliveAt: OneUptimeDate.getCurrentDate(),
      connectionStatus: "connected",
    };

    if (posture) {
      update["posture"] = posture as JSONObject;
    }

    if (agentVersion) {
      update["agentVersion"] = agentVersion;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: agentId,
      data: update as never,
    });

    /*
     * Off the heartbeat's path: it decides at most once an hour per agent
     * and never throws, and a heartbeat must not wait on (or fail because
     * of) housekeeping.
     */
    this.retireLegacyRunnerIfUnused({
      agent: data.agent,
      ...(cluster ? { cluster } : {}),
    }).catch((error: unknown) => {
      logger.error(
        `KubernetesAiAgent: the previous in-cluster Runner check for agent ${agentId.toString()} failed: ${error}`,
      );
    });

    /*
     * What AI may do, as the agent reports it: applied when it differs from
     * what the agent reported last (an agent upgraded under a running
     * server, a report this server could not store before), and re-checked
     * every KUBERNETES_AI_AGENT_SETTINGS_CHECK_INTERVAL_MS in case something
     * else moved the cluster's settings. A new configuration restarts the
     * agent, which registers again and applies it at once.
     */
    const reportedSettings: AgentAiSettings | undefined = posture?.aiSettings;

    if (
      reportedSettings &&
      (!isSameAgentAiSettings(reportedSettings, storedPosture?.aiSettings) ||
        this.isAiSettingsCheckDue(
          agentId.toString(),
          OneUptimeDate.getCurrentDate(),
        ))
    ) {
      cluster = cluster || (await this.findAgentClusterSafely(data.agent));

      if (cluster) {
        const settingsApplied: KubernetesAiAgentSettingsApplied | null =
          await this.applyReportedAiSettingsSafely({
            cluster,
            reported: reportedSettings,
          });

        if (Service.didApplyAiSettings(settingsApplied)) {
          await this.writeAiSettingsFeedItem({
            cluster,
            applied: settingsApplied!,
          });
        }

        // The agent decides; the first-connection defaults never apply.
        if (
          settingsApplied &&
          isAgentAiSettingsSourceAgent(settingsApplied.source)
        ) {
          return;
        }
      }
    }

    const writesAppeared: boolean =
      posture?.allowWrites === true && storedPosture?.allowWrites !== true;

    if (!writesAppeared || !posture) {
      return;
    }

    // The defaults read the cluster's current AI settings.
    cluster = cluster || (await this.findAgentCluster(data.agent));

    if (!cluster) {
      return;
    }

    // The liveness is written; a failure here must not fail the heartbeat.
    const defaultsApplied: KubernetesAiAgentDefaultsApplied =
      await this.applyFirstConnectionDefaultsSafely({
        cluster,
        allowWrites: true,
      });

    if (Service.didApplyDefaults(defaultsApplied)) {
      await this.writeDefaultsFeedItem({ cluster, posture, defaultsApplied });
    }
  }

  /*
   * findAgentCluster for the heartbeat's settings check, whose liveness is
   * already written: a failed read is logged and reads as "no cluster", so
   * the check is skipped this time rather than failing the heartbeat.
   */
  private async findAgentClusterSafely(
    agent: Pick<Model, "kubernetesClusterId" | "projectId">,
  ): Promise<KubernetesCluster | null> {
    try {
      return await this.findAgentCluster(agent);
    } catch (error) {
      logger.error(
        `KubernetesAiAgent: could not read the cluster of a Kubernetes AI agent to check its AI settings: ${error}`,
      );
      return null;
    }
  }

  // The agent's own cluster (in its project, as root), or null.
  private async findAgentCluster(
    agent: Pick<Model, "kubernetesClusterId" | "projectId">,
  ): Promise<KubernetesCluster | null> {
    if (!agent.kubernetesClusterId) {
      return null;
    }

    return await KubernetesClusterService.findOneBy({
      query: {
        _id: agent.kubernetesClusterId.toString(),
        ...(agent.projectId ? { projectId: agent.projectId } : {}),
      },
      select: CLUSTER_SELECT,
      props: { isRoot: true },
    });
  }

  /*
   * ------------------------------------------------------------------
   * Retiring the previous in-cluster Runner
   * ------------------------------------------------------------------
   */

  /*
   * The kubernetes-agent Runner row an older chart registered for this
   * cluster, deleted once it is certainly no longer needed — so the
   * Runners page stops listing a dead Runner nobody created by hand. Every
   * condition must hold, and anything else leaves it alone:
   *
   *  - this agent has existed for LEGACY_RUNNER_RETIREMENT_AGENT_AGE_HOURS
   *    and is online (it is heartbeating) — a rollback in the first day
   *    after an upgrade still finds its Runner;
   *  - the Runner has not been heard from for
   *    LEGACY_RUNNER_RETIREMENT_OFFLINE_DAYS (a Runner that never
   *    heartbeated is left alone: its age is unknown);
   *  - it holds nothing beyond an in-cluster Runner's defaults (no
   *    credentials or secrets, no runbooks or code fixes, not another
   *    cluster's Runner) — what an operator entrusted to it is theirs;
   *  - no auto-remediation rule names it: a rule scoped to only that Runner
   *    would silently widen to "any Runner" once it is gone.
   *
   * Checked at most once an hour per agent per process, from the heartbeat.
   * The agent's cluster is read (once the check is due) unless the caller
   * already has it. Never throws; says what it decided.
   */
  @CaptureSpan()
  public async retireLegacyRunnerIfUnused(data: {
    agent: Model;
    cluster?: KubernetesCluster | undefined;
    now?: Date | undefined;
  }): Promise<LegacyRunnerRetirementOutcome> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const agentId: string = data.agent.id?.toString() || "";

    if (!agentId || !this.isLegacyRunnerRetirementCheckDue(agentId, now)) {
      return "not_due";
    }

    const clusterId: string =
      data.cluster?.id?.toString() ||
      data.agent.kubernetesClusterId?.toString() ||
      "";

    try {
      if (!Service.isOldEnoughToRetireLegacyRunner(data.agent, now)) {
        return "agent_too_new";
      }

      const cluster: KubernetesCluster | null =
        data.cluster || (await this.findAgentCluster(data.agent));

      const projectId: ObjectID | undefined =
        cluster?.projectId || data.agent.projectId;

      if (!cluster || !cluster.id || !projectId) {
        return "no_legacy_runner";
      }

      const legacyRunner: Runner | null =
        await KubernetesClusterAiAccessService.getLegacyAgentRunnerForCluster({
          projectId,
          kubernetesClusterId: cluster.id,
          clusterIdentifier: cluster.clusterIdentifier,
        });

      if (!legacyRunner || !legacyRunner.id) {
        return "no_legacy_runner";
      }

      if (
        KubernetesClusterAiAccessService.isRunnerOnline(legacyRunner) ||
        !Service.hasBeenOfflineLongEnoughToRetire(legacyRunner, now)
      ) {
        return "legacy_runner_recently_online";
      }

      const holdings: Array<{ description: string }> =
        await KubernetesClusterAiAccessService.getRunnerHoldingsBeyondDefaults({
          runner: legacyRunner,
          clusterId: cluster.id,
          projectId,
        });

      if (holdings.length > 0) {
        logger.info(
          `KubernetesAiAgent: kept the previous in-cluster Runner ${legacyRunner.id.toString()} of cluster ${cluster.id.toString()}: it holds more than its defaults.`,
        );
        return "legacy_runner_holds_more";
      }

      const rulesNamingIt: number = (
        await AutoRemediationRuleService.countBy({
          query: {
            projectId,
            commandRunners: QueryHelper.inRelationArray([legacyRunner.id]),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (rulesNamingIt > 0) {
        logger.info(
          `KubernetesAiAgent: kept the previous in-cluster Runner ${legacyRunner.id.toString()} of cluster ${cluster.id.toString()}: ${rulesNamingIt} auto-remediation rule(s) name it.`,
        );
        return "legacy_runner_in_rule";
      }

      await RunnerService.deleteOneBy({
        query: { _id: legacyRunner.id.toString(), projectId },
        props: { isRoot: true },
      });

      logger.info(
        `KubernetesAiAgent: removed the previous in-cluster Runner ${legacyRunner.id.toString()} of cluster ${cluster.id.toString()}; the Kubernetes AI agent replaced it.`,
      );

      await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
        kubernetesClusterId: cluster.id,
        projectId,
        kubernetesClusterFeedEventType:
          KubernetesClusterFeedEventType.KubernetesClusterUpdated,
        displayColor: Blue500,
        feedInfoInMarkdown: `🧹 The previous in-cluster Runner **${
          legacyRunner.name || "kubernetes-agent"
        }** was removed. The ${KUBERNETES_AI_AGENT_DISPLAY_NAME} replaced it, and it had been offline for over ${LEGACY_RUNNER_RETIREMENT_OFFLINE_DAYS} days.`,
      });

      return "retired";
    } catch (error) {
      logger.error(
        `KubernetesAiAgent: could not check the previous in-cluster Runner of cluster ${clusterId}: ${error}`,
      );
      return "failed";
    }
  }

  // The agent has existed long enough that a rollback is no longer likely.
  public static isOldEnoughToRetireLegacyRunner(
    agent: Pick<Model, "createdAt">,
    now: Date,
  ): boolean {
    const createdAt: Date | null = toDate(agent.createdAt);

    return Boolean(
      createdAt &&
        now.getTime() - createdAt.getTime() >=
          LEGACY_RUNNER_RETIREMENT_AGENT_AGE_HOURS * 60 * 60 * 1000,
    );
  }

  // The Runner was last heard from long enough ago (never: not eligible).
  public static hasBeenOfflineLongEnoughToRetire(
    runner: Pick<Runner, "lastAlive">,
    now: Date,
  ): boolean {
    const lastAlive: Date | null = toDate(runner.lastAlive);

    return Boolean(
      lastAlive &&
        now.getTime() - lastAlive.getTime() >=
          LEGACY_RUNNER_RETIREMENT_OFFLINE_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  /*
   * At most one check an hour per agent in this process. Stamped before the
   * check runs, so heartbeats that overlap it do not start a second one.
   */
  private isLegacyRunnerRetirementCheckDue(
    agentId: string,
    now: Date,
  ): boolean {
    const lastCheckedAt: number | undefined =
      this.legacyRunnerRetirementCheckedAt.get(agentId);

    if (
      lastCheckedAt !== undefined &&
      now.getTime() - lastCheckedAt < LEGACY_RUNNER_RETIREMENT_CHECK_INTERVAL_MS
    ) {
      return false;
    }

    // Bounded: a long-lived process forgets old agents rather than growing.
    if (
      this.legacyRunnerRetirementCheckedAt.size >=
      MAX_LEGACY_RUNNER_RETIREMENT_CHECKS_REMEMBERED
    ) {
      this.legacyRunnerRetirementCheckedAt.clear();
    }

    this.legacyRunnerRetirementCheckedAt.set(agentId, now.getTime());

    return true;
  }

  /*
   * The agent signing off on a clean shutdown. lastAliveAt is left alone
   * (it is when the agent was last heard from); the disconnected status is
   * what lets its replacement pod register at once instead of waiting for
   * the alive window to lapse, and what makes the AI agent page say
   * "Offline" straight away. Its next heartbeat or registration flips it
   * back.
   */
  @CaptureSpan()
  public async markDisconnected(data: {
    kubernetesAiAgentId: ObjectID;
  }): Promise<void> {
    if (!data.kubernetesAiAgentId) {
      throw new BadDataException("kubernetesAiAgentId is required");
    }

    await this.updateColumnsByIdWithoutHooks({
      id: data.kubernetesAiAgentId,
      data: { connectionStatus: "disconnected" },
    });
  }

  /*
   * An admin's "Reset agent" on the cluster's AI agent page: the agent's key
   * stops working at once (keyHash null matches nothing) and the row reads
   * as disconnected. The real pod fails authentication on its next request,
   * registers again and — the row being reset — is admitted, so it comes
   * back by itself within a few minutes. Whoever else held the key (a pod
   * that registered with a leaked ingestion key) is locked out the same
   * way; rotating that ingestion key keeps it out.
   */
  @CaptureSpan()
  public async resetAgent(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const agent: Model | null = await this.findForCluster({
      projectId: data.projectId,
      kubernetesClusterId: data.kubernetesClusterId,
    });

    if (!agent || !agent.id) {
      throw new BadDataException(
        "This cluster has no Kubernetes AI agent to reset.",
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
      `KubernetesAiAgent: the Kubernetes AI agent of cluster ${data.kubernetesClusterId.toString()} in project ${data.projectId.toString()} was reset${
        data.userId ? ` by user ${data.userId.toString()}` : ""
      }.`,
    );

    const resetBy: string = data.userId
      ? await this.getUserMarkdownForFeed({
          userId: data.userId,
          projectId: data.projectId,
        })
      : "";

    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: data.kubernetesClusterId,
      projectId: data.projectId,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.KubernetesClusterUpdated,
      displayColor: Blue500,
      feedInfoInMarkdown: `🔄 The ${KUBERNETES_AI_AGENT_DISPLAY_NAME} was reset${
        resetBy ? ` by **${resetBy}**` : ""
      }. It reconnects on its own within a few minutes.`,
      moreInformationInMarkdown: `**Agent**: ${KUBERNETES_AI_AGENT_DISPLAY_NAME} (${agent.id.toString()})`,
      ...(data.userId ? { userId: data.userId } : {}),
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
        `KubernetesAiAgent: could not look up user ${data.userId.toString()} for a feed item: ${error}`,
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
  public static describeWriteAccess(posture: KubernetesAgentPosture): string {
    if (posture.allowWrites !== true) {
      return "read-only";
    }

    return `can make changes ${Service.describeWriteScope(posture)}`;
  }

  // Where a writing agent may change things: its namespaces, or everywhere.
  public static describeWriteScope(posture: KubernetesAgentPosture): string {
    const namespaces: Array<string> = posture.writeNamespaces || [];

    return namespaces.length > 0
      ? `in ${namespaces.join(", ")}`
      : "anywhere in the cluster";
  }

  // The first successful registration of a cluster's agent. Best-effort.
  private async writeConnectedFeedItem(data: {
    cluster: KubernetesCluster;
    agentId: ObjectID;
    posture: KubernetesAgentPosture;
    agentVersion?: string | undefined;
    defaultsApplied: KubernetesAiAgentDefaultsApplied;
    settingsApplied?: KubernetesAiAgentSettingsApplied | null | undefined;
  }): Promise<void> {
    const isSetByAgent: boolean = Boolean(
      data.settingsApplied &&
        isAgentAiSettingsSourceAgent(data.settingsApplied.source),
    );

    /*
     * applyReportedAiSettings already wrote the agent's settings to the
     * cluster object it was given, so this reads what is in effect now.
     */
    const isInvestigationOn: boolean =
      data.cluster.isAiInvestigationEnabled === true ||
      data.defaultsApplied.turnedOnInvestigation;

    const sentences: Array<string> = [
      `🤖 The ${KUBERNETES_AI_AGENT_DISPLAY_NAME} connected (${Service.describeWriteAccess(
        data.posture,
      )}).`,
    ];

    if (isSetByAgent) {
      sentences.push(
        `What AI may do here follows the agent's ${
          data.settingsApplied!.source === "agent_configuration"
            ? "configuration"
            : "defaults"
        }: investigation ${isInvestigationOn ? "on" : "off"}, fixes ${
          AGENT_AI_FIXES_LABELS[
            KubernetesClusterAiAccessService.normalizeRemediationMode(
              data.cluster.aiRemediationMode,
            )
          ]
        }. Change it with aiAgent.investigation and aiAgent.fixes on the Kubernetes agent chart; the cluster's AI agent page shows the command.`,
      );
    } else {
      sentences.push(
        isInvestigationOn
          ? "AI can now use it to investigate this cluster."
          : "Investigating with kubectl is off for this cluster; turn it on on the cluster's AI agent page.",
      );
    }

    if (data.defaultsApplied.remediationMode) {
      sentences.push(
        'Fixes are set to "Ask for approval", because the chart allows changes.',
      );
    }

    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: data.cluster.id!,
      projectId: data.cluster.projectId!,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.KubernetesClusterUpdated,
      displayColor: Green500,
      feedInfoInMarkdown: sentences.join(" "),
      moreInformationInMarkdown: [
        `**Agent**: ${KUBERNETES_AI_AGENT_DISPLAY_NAME} (${data.agentId.toString()})`,
        `**Cluster identifier**: \`${data.posture.clusterIdentifier || ""}\``,
        `**Agent version**: ${data.agentVersion || "unknown"}`,
        `**kubectl**: ${data.posture.kubectlVersion || "not detected"}`,
        `**Agent chart**: ${data.posture.agentChartVersion || "unknown"}`,
      ].join("\n\n"),
    });
  }

  /*
   * The agent's settings changed what AI may do on the cluster — after an
   * upgrade of the chart with new aiAgent.investigation / aiAgent.fixes, or
   * when its Runner binding was cleared. A setting never changes silently:
   * the item says what moved, from what to what, and where it is set.
   */
  public async writeAiSettingsFeedItem(data: {
    cluster: KubernetesCluster;
    applied: KubernetesAiAgentSettingsApplied;
  }): Promise<void> {
    const changes: Array<string> = [];

    if (data.applied.investigation) {
      changes.push(
        `investigation ${data.applied.investigation.from ? "on" : "off"} → ${
          data.applied.investigation.to ? "on" : "off"
        }`,
      );
    }

    if (data.applied.remediationMode) {
      changes.push(
        `fixes ${AGENT_AI_FIXES_LABELS[data.applied.remediationMode.from]} → ${
          AGENT_AI_FIXES_LABELS[data.applied.remediationMode.to]
        }`,
      );
    }

    if (changes.length === 0 || !data.cluster.id || !data.cluster.projectId) {
      return;
    }

    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: data.cluster.id,
      projectId: data.cluster.projectId,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.KubernetesClusterUpdated,
      displayColor: Blue500,
      feedInfoInMarkdown: `🤖 The ${KUBERNETES_AI_AGENT_DISPLAY_NAME}'s ${
        data.applied.source === "agent_configuration"
          ? "configuration"
          : "defaults"
      } changed what AI may do on this cluster: ${changes.join("; ")}.`,
      moreInformationInMarkdown:
        data.applied.source === "agent_configuration"
          ? "Set with **aiAgent.investigation** and **aiAgent.fixes** on the Kubernetes agent chart. The cluster's AI agent page shows them, with the command that changes them."
          : "The Kubernetes agent chart sets neither **aiAgent.investigation** nor **aiAgent.fixes**, so the agent's defaults apply: investigation on, and fixes Ask for approval when the chart allows changes, else Off. Set them on the chart to choose; the cluster's AI agent page shows the command.",
    });
  }

  /*
   * The first-connection defaults changed a setting after the first
   * connection (the agent re-registered with write access, or its write
   * access appeared on a heartbeat). A setting never changes silently.
   */
  private async writeDefaultsFeedItem(data: {
    cluster: KubernetesCluster;
    posture: KubernetesAgentPosture;
    defaultsApplied: KubernetesAiAgentDefaultsApplied;
  }): Promise<void> {
    const sentences: Array<string> = [];

    if (data.defaultsApplied.turnedOnInvestigation) {
      sentences.push(
        `AI can now use the ${KUBERNETES_AI_AGENT_DISPLAY_NAME} to investigate this cluster.`,
      );
    }

    if (data.defaultsApplied.remediationMode) {
      sentences.push(
        `The ${KUBERNETES_AI_AGENT_DISPLAY_NAME} can now make changes ${Service.describeWriteScope(
          data.posture,
        )}, so fixes are set to "Ask for approval".`,
      );
    }

    sentences.push(
      "Nobody had chosen AI settings for this cluster yet; change them on the cluster's AI agent page.",
    );

    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: data.cluster.id!,
      projectId: data.cluster.projectId!,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.KubernetesClusterUpdated,
      displayColor: Blue500,
      feedInfoInMarkdown: `🤖 ${sentences.join(" ")}`,
    });
  }
}

export default new Service();
