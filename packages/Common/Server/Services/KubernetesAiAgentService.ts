import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/KubernetesAiAgent";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Select from "../Types/Database/Select";
import OneUptimeDate from "../../Types/Date";
import {
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KubernetesAgentPosture,
  KubernetesAiAgentConnectionStatus,
  KubernetesAiAgentSummary,
  parseKubernetesAgentPosture,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../Types/ObjectID";
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
 * The Kubernetes AI agent of a cluster (see the model). This file holds the
 * shared helpers every caller needs — key minting and hashing, the one
 * online rule, the summary the dashboard sees and the reads the status
 * builder uses. Registration, heartbeat, authentication and reset build on
 * them.
 */
export class Service extends DatabaseService<Model> {
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
}

export default new Service();
