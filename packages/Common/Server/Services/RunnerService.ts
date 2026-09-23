import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import Version from "../../Types/Version";
import BadDataException from "../../Types/Exception/BadDataException";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Model, {
  RunnerConnectionStatus,
} from "../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { RUNNER_ALIVE_WINDOW_IN_MINUTES } from "../../Types/Runner/RunnerLiveStatus";
import {
  KUBERNETES_AGENT_RUNNER_NAME_PREFIX,
  KubernetesRunnerPosture,
  getKubernetesAgentRunnerName,
  isInClusterPostureForCluster,
  isKubernetesAgentRunnerName,
  isKubernetesAgentRunnerPosture,
  isSameKubernetesClusterIdentifier,
  normalizeKubernetesClusterIdentifier,
  parseKubernetesRunnerPosture,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import crypto from "crypto";

/*
 * Runner.name is a ShortText column, so the agent Runner row's name is
 * bounded to it (see getKubernetesAgentRunnerNameForCluster).
 */
export const MAX_KUBERNETES_AGENT_RUNNER_NAME_LENGTH: number =
  ColumnLength.ShortText;

// Hex characters of the identifier's hash a shortened Runner name ends with.
const AGENT_RUNNER_NAME_HASH_LENGTH: number = 8;

/*
 * The name of the agent Runner row for a cluster, bounded to the Runner
 * name column. "kubernetes-agent/<clusterIdentifier>" as long as it fits —
 * so every existing row keeps matching — and otherwise the identifier cut
 * short plus a hash of the WHOLE identifier, so any cluster name the chart
 * accepts gets a Runner row, and two long names that share a prefix still
 * get different rows.
 *
 * The hash is taken over the normalized (lowercased) identifier because the
 * row is looked up case-insensitively, like the cluster row itself: "Prod-…"
 * and "prod-…" must keep landing on the same row. The name always keeps the
 * kubernetes-agent/ prefix, the marker every guard keys on, which only the
 * server may write (RunnerService's create and update hooks refuse it to
 * everyone else).
 *
 * Lives here rather than in KubernetesClusterAiAccessService (which
 * re-exports it) so KubernetesClusterService can decide "is this THIS
 * cluster's agent Runner?" without an import cycle.
 */
export function getKubernetesAgentRunnerNameForCluster(
  clusterIdentifier: string,
): string {
  const fullName: string = getKubernetesAgentRunnerName(clusterIdentifier);

  if (fullName.length <= MAX_KUBERNETES_AGENT_RUNNER_NAME_LENGTH) {
    return fullName;
  }

  const hash: string = crypto
    .createHash("sha256")
    .update(normalizeKubernetesClusterIdentifier(clusterIdentifier))
    .digest("hex")
    .slice(0, AGENT_RUNNER_NAME_HASH_LENGTH);

  const prefix: string = getKubernetesAgentRunnerName("");
  const room: number =
    MAX_KUBERNETES_AGENT_RUNNER_NAME_LENGTH -
    prefix.length -
    1 -
    AGENT_RUNNER_NAME_HASH_LENGTH;

  let head: string = clusterIdentifier.slice(0, room);

  // Never end on half of a surrogate pair.
  const lastCharCode: number = head.charCodeAt(head.length - 1);
  if (lastCharCode >= 0xd800 && lastCharCode <= 0xdbff) {
    head = head.slice(0, -1);
  }

  return `${prefix}${head}-${hash}`;
}

// What the "is this a kubernetes-agent Runner row?" rule reads off a row.
export interface KubernetesAgentRunnerMarkers {
  name?: unknown;
  hostInfo?: unknown;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The kubernetes-agent name marker, compared the way the database compares
   * it: the registration lookup (findWithSameText) and the query-side
   * exclusions (NOT ILIKE / ILIKE) are case-insensitive, so the in-code
   * check must be too — otherwise renaming "kubernetes-agent/prod" to
   * "Kubernetes-Agent/prod" would escape every guard while registration
   * still found (and re-keyed) the row by that name.
   */
  public static isKubernetesAgentName(name: unknown): boolean {
    return (
      typeof name === "string" &&
      isKubernetesAgentRunnerName(name.trim().toLowerCase())
    );
  }

  /*
   * Is this Runner row a kubernetes-agent Runner — one the telemetry
   * ingestion key can mint and, while it is offline, re-key? The ONE rule
   * every "an agent row never holds a credential / never runs shell work"
   * guard applies, failing closed on either fact:
   *
   * - the server-owned name marker (kubernetes-agent/...): only
   *   registration writes it — a non-root create or rename into or out of
   *   the prefix is refused by this service's hooks — and it survives a
   *   heartbeat that drops the posture; or
   * - an agent posture (in-cluster AND naming a cluster), which only the
   *   kubernetes-agent Runner binary reports.
   */
  public static isKubernetesAgentRunnerRow(
    runner: KubernetesAgentRunnerMarkers | null | undefined,
  ): boolean {
    if (!runner) {
      return false;
    }

    return (
      Service.isKubernetesAgentName(runner.name) ||
      isKubernetesAgentRunnerPosture(
        parseKubernetesRunnerPosture(runner.hostInfo),
      )
    );
  }

  /*
   * Is this Runner row THE agent Runner of the cluster named by
   * `clusterIdentifier`? By name, it must be exactly that cluster's agent
   * name (case-insensitively) and its posture must not name another
   * cluster; a row without the name marker qualifies only through a posture
   * that names this cluster. A cluster without an identifier has no agent.
   */
  public static isKubernetesAgentRunnerOfCluster(
    runner: KubernetesAgentRunnerMarkers | null | undefined,
    clusterIdentifier: unknown,
  ): boolean {
    const identifier: string =
      typeof clusterIdentifier === "string" ? clusterIdentifier.trim() : "";

    if (!runner || !identifier) {
      return false;
    }

    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture(runner.hostInfo);

    if (Service.isKubernetesAgentName(runner.name)) {
      const reportedCluster: string = posture?.clusterIdentifier?.trim() || "";

      return (
        (runner.name as string).trim().toLowerCase() ===
          getKubernetesAgentRunnerNameForCluster(identifier).toLowerCase() &&
        (reportedCluster.length === 0 ||
          isSameKubernetesClusterIdentifier(reportedCluster, identifier))
      );
    }

    return isInClusterPostureForCluster(posture, identifier);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * The kubernetes-agent/ name prefix is the server-owned marker of a
     * Runner the ingestion key can mint. Only registration (root) may
     * create a row under it: a user-created "kubernetes-agent/x" would count
     * against the agent quotas and be adopted by the next registration for
     * cluster "x".
     */
    if (
      !createBy.props.isRoot &&
      Service.isKubernetesAgentName(createBy.data.name)
    ) {
      throw new BadDataException(Service.getReservedAgentNameRefusal());
    }

    if (!createBy.data.key) {
      createBy.data.key = ObjectID.generate().toString();
    }

    if (!createBy.data.agentVersion) {
      createBy.data.agentVersion = new Version("1.0.0");
    }

    if (!createBy.data.connectionStatus) {
      createBy.data.connectionStatus = RunnerConnectionStatus.Disconnected;
    }

    return { createBy, carryForward: [] };
  }

  /*
   * What a non-root write may not do to the kubernetes-agent marker and to
   * an agent row:
   *
   * - rename a row whose current name carries the marker (it would drop out
   *   of every name-keyed guard while registration keeps re-keying it), or
   *   rename any row INTO the prefix (it would be adopted by the next
   *   registration and counted against the agent quotas) — compared
   *   case-insensitively, like the database compares the marker;
   * - turn on "Runs Runbooks" or "Runs AI Code Fixes" on an agent row. It
   *   runs kubectl only, and either capability is a holding that refuses
   *   every registration that cannot present the row's current key — which
   *   is every pod restart, since the pod keeps its key in memory only.
   *
   * Root writes (registration, heartbeats, sign-off) are the server's own.
   * CardModelDetail posts every field of the Runner form, so a re-posted
   * unchanged name and a capability posted as false always pass: editing an
   * agent row's description or labels must still save.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.props.isRoot) {
      return { updateBy, carryForward: null };
    }

    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;
    const newName: unknown = data["name"];
    const isNameWritten: boolean = newName !== undefined && newName !== null;
    const turnsOnCapabilities: Array<string> = [];

    if (data["canRunRunbooks"] === true) {
      turnsOnCapabilities.push('"Runs Runbooks"');
    }

    if (data["canRunCodeFixTasks"] === true) {
      turnsOnCapabilities.push('"Runs AI Code Fixes"');
    }

    if (!isNameWritten && turnsOnCapabilities.length === 0) {
      return { updateBy, carryForward: null };
    }

    /*
     * onBeforeUpdate runs before the framework scopes the query to the
     * caller's project, so scope the read here: a caller is never judged
     * against, or told about, another project's Runner.
     */
    const runners: Array<Model> = await this.findBy({
      query: {
        ...updateBy.query,
        ...(updateBy.props.tenantId
          ? { projectId: updateBy.props.tenantId }
          : {}),
      },
      select: { _id: true, name: true, hostInfo: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    for (const runner of runners) {
      /*
       * Any change to the stored text is a rename, surrounding whitespace
       * included: registration finds its row by the exact (lowercased) name,
       * so even a padded agent name would lose the row its cluster's next
       * registration looks for. The form re-posts an unchanged name exactly.
       */
      const renames: boolean =
        isNameWritten && String(newName) !== (runner.name || "");

      if (renames && Service.isKubernetesAgentName(runner.name)) {
        throw new BadDataException(
          `Runner "${runner.name}" is the in-cluster Runner the Kubernetes agent chart registered, and its name is how OneUptime recognises it (and keeps credentials, secrets and shell work away from it), so it cannot be renamed. Use its description instead, or delete the Runner and let the agent register a fresh one.`,
        );
      }

      if (renames && Service.isKubernetesAgentName(newName)) {
        throw new BadDataException(Service.getReservedAgentNameRefusal());
      }

      if (
        turnsOnCapabilities.length > 0 &&
        Service.isKubernetesAgentRunnerRow(runner)
      ) {
        throw new BadDataException(
          `Runner "${runner.name}" is the in-cluster Runner the Kubernetes agent chart installed: it runs kubectl for its cluster only, so ${turnsOnCapabilities.join(
            " and ",
          )} cannot be turned on for it — and doing so would stop it re-registering after its pod restarts. Create a Runner under Project Settings → Runners for runbooks or code fixes instead.`,
        );
      }
    }

    return { updateBy, carryForward: null };
  }

  private static getReservedAgentNameRefusal(): string {
    return `Runner names starting with "${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/" are reserved for the in-cluster Runners the Kubernetes agent chart registers (with --set aiAccess.enabled=true). Choose another name.`;
  }

  @CaptureSpan()
  public async findByIdAndKey(data: {
    agentId: ObjectID;
    agentKey: string;
  }): Promise<Model | null> {
    if (!data.agentId || !data.agentKey) {
      return null;
    }

    return this.findOneBy({
      query: {
        _id: data.agentId.toString(),
        key: data.agentKey,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        canRunRunbooks: true,
        canRunCodeFixTasks: true,
        canRunAiCommands: true,
        /*
         * The claim path reads the Kubernetes posture (in-cluster or not) to
         * decide whether a credential-less kubectl job may be served.
         */
        hostInfo: true,
      },
      props: { isRoot: true },
    });
  }

  /*
   * Runners in this project that have opted into AI-composed commands and
   * heartbeated recently — the hosts an AI remediation run may target with
   * Bash or SSH. Same liveness semantics as the code-fix lookup: lastAlive
   * as a query predicate, never a sort over possibly-NULL rows.
   *
   * The in-cluster Runners the kubernetes-agent chart registers are left
   * out. They have canRunAiCommands on (for kubectl through their cluster),
   * but they only ever run policy-tiered kubectl with their own
   * ServiceAccount: offered as a shell host, a plan aimed at one could never
   * be claimed (the ingress serves such a Runner kubectl only), and a Runner
   * an ingestion key can mint must never be handed AI-composed shell work.
   * Excluded in the query, so agent rows can never crowd real hosts out of
   * the limit, and again on the rows, with the one "is an agent row" rule
   * (the server-owned name marker, or an agent posture).
   */
  @CaptureSpan()
  public async getOnlineAiCommandRunnersForProject(data: {
    projectId: ObjectID;
    limit?: number | undefined;
  }): Promise<Array<Model>> {
    const runners: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        canRunAiCommands: true,
        lastAlive: QueryHelper.greaterThan(
          OneUptimeDate.getSomeMinutesAgo(RUNNER_ALIVE_WINDOW_IN_MINUTES),
        ),
        name: QueryHelper.notWildcard(
          `${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/*`,
        ),
      },
      select: {
        _id: true,
        name: true,
        description: true,
        lastAlive: true,
        hostInfo: true,
      },
      limit: data.limit ?? 25,
      skip: 0,
      props: { isRoot: true },
    });

    return runners.filter((runner: Model) => {
      return !Service.isKubernetesAgentRunnerRow(runner);
    });
  }

  /*
   * The ids an EntityArray payload of Runners names. A service hook sees
   * that column in whatever shape the caller wrote it: model instances or
   * serialised relations from the dashboard (`{ _id }`), ObjectIDs or plain
   * id strings from server-side callers.
   */
  public static readRunnerIds(value: unknown): Array<ObjectID> {
    if (!Array.isArray(value)) {
      return [];
    }

    const ids: Array<ObjectID> = [];

    for (const item of value) {
      let id: string | undefined = undefined;

      if (item instanceof ObjectID) {
        id = item.toString();
      } else if (typeof item === "string") {
        id = item;
      } else if (item && typeof item === "object") {
        const relation: { _id?: unknown; id?: unknown } = item as {
          _id?: unknown;
          id?: unknown;
        };
        const relationId: unknown = relation._id || relation.id;
        id = relationId ? relationId.toString() : undefined;
      }

      if (id && ObjectID.isValidUUID(id)) {
        ids.push(new ObjectID(id));
      }
    }

    return ids;
  }

  /*
   * The kubernetes-agent Runner rows (isKubernetesAgentRunnerRow) among the
   * Runners an EntityArray payload names, in whatever shape it arrived
   * (readRunnerIds). Read as root, so the rule holds for an id of any
   * project: a guard built on this fails closed.
   */
  @CaptureSpan()
  public async findKubernetesAgentRunners(
    runners: unknown,
  ): Promise<Array<Model>> {
    const ids: Array<ObjectID> = Service.readRunnerIds(runners);

    if (ids.length === 0) {
      return [];
    }

    const rows: Array<Model> = await this.findBy({
      query: { _id: QueryHelper.any(ids) },
      select: { _id: true, name: true, hostInfo: true },
      limit: ids.length,
      skip: 0,
      props: { isRoot: true },
    });

    return rows.filter((runner: Model) => {
      return Service.isKubernetesAgentRunnerRow(runner);
    });
  }

  /*
   * Refuses to assign credential material (a RunbookCredential or a
   * RunbookSecret) to a kubernetes-agent Runner. Such a Runner row is minted
   * and re-keyed with the project's telemetry ingestion key — a credential
   * every collector and CI job holds — so whatever is assigned to it is
   * reachable by anyone holding that key. It runs kubectl with its own
   * ServiceAccount only and never needs a credential; the claim path would
   * refuse to hand one over anyway, so the assignment is refused where it is
   * made, with a message that says what to do instead. "Agent" is the one
   * rule (isKubernetesAgentRunnerRow): the name marker or an agent posture.
   */
  @CaptureSpan()
  public async assertNoKubernetesAgentRunners(data: {
    runners: unknown;
    // What is being assigned, for the message: "credential" or "secret".
    assignedWhat: string;
  }): Promise<void> {
    const agentRunner: Model | undefined = (
      await this.findKubernetesAgentRunners(data.runners)
    )[0];

    if (agentRunner) {
      throw new BadDataException(
        `Runner "${agentRunner.name}" is the in-cluster Runner the Kubernetes agent chart installed. It runs kubectl with its own ServiceAccount only and is never given a ${data.assignedWhat}, because its identity is issued with the project's telemetry ingestion key. Assign this ${data.assignedWhat} to a Runner you created under Project Settings → Runners instead.`,
      );
    }
  }

  /*
   * A Runner in this project that is allowed to take code-fix work and has
   * heartbeated recently. Liveness is judged on lastAlive alone: unlike
   * AIAgent, nothing ever flips a Runner's connectionStatus back to
   * Disconnected, so a row that once connected would look Connected forever.
   */
  @CaptureSpan()
  public async getOnlineCodeFixRunnerForProject(
    projectId: ObjectID,
  ): Promise<Model | null> {
    /*
     * The recency window is a QUERY predicate, not a post-filter on a sorted
     * row: `ORDER BY "lastAlive" DESC` in Postgres puts NULLs FIRST, so a
     * Runner row that was created but never started would be picked ahead of
     * one that is heartbeating right now, and the project would read as
     * having no agent.
     *
     * A kubernetes-agent Runner never takes code-fix work (its binary never
     * starts that loop), so it must not make the project read as having a
     * code-fix Runner and have runs queued that nothing will ever claim —
     * even one whose "Runs AI Code Fixes" was turned on before the update
     * hook refused that. Left out in the query and again on the rows.
     */
    const runners: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
        canRunCodeFixTasks: true,
        lastAlive: QueryHelper.greaterThan(
          OneUptimeDate.getSomeMinutesAgo(RUNNER_ALIVE_WINDOW_IN_MINUTES),
        ),
        name: QueryHelper.notWildcard(
          `${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/*`,
        ),
      },
      select: {
        _id: true,
        name: true,
        lastAlive: true,
        hostInfo: true,
      },
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    return (
      runners.find((runner: Model) => {
        return !Service.isKubernetesAgentRunnerRow(runner);
      }) || null
    );
  }

  @CaptureSpan()
  public async heartbeat(data: {
    agentId: ObjectID;
    agentVersion?: Version | undefined;
    hostInfo?: JSONObject | undefined;
  }): Promise<void> {
    if (!data.agentId) {
      throw new BadDataException("agentId is required");
    }

    const update: JSONObject = {
      lastAlive: OneUptimeDate.getCurrentDate(),
      connectionStatus: RunnerConnectionStatus.Connected,
    };

    if (data.agentVersion) {
      update["agentVersion"] = data.agentVersion;
    }

    if (data.hostInfo) {
      update["hostInfo"] = data.hostInfo;
    }

    await this.updateOneById({
      id: data.agentId,
      data: update as never,
      props: { isRoot: true },
    });
  }

  /*
   * A Runner signing off on a clean shutdown. lastAlive is left alone (it
   * is the truth about the last heartbeat and what the dashboard shows);
   * the explicit Disconnected status is what a kubernetes-agent
   * registration reads to admit a replacement pod immediately instead of
   * waiting for the alive window to lapse, and what a cluster's AI access
   * status reads to call the Runner offline at once (an uninstalled agent
   * must not read as Connected until its last heartbeat ages out). The
   * next heartbeat or registration flips it back to Connected.
   */
  @CaptureSpan()
  public async markDisconnected(data: { agentId: ObjectID }): Promise<void> {
    if (!data.agentId) {
      throw new BadDataException("agentId is required");
    }

    await this.updateOneById({
      id: data.agentId,
      data: {
        connectionStatus: RunnerConnectionStatus.Disconnected,
      } as never,
      props: { isRoot: true },
    });
  }
}

export default new Service();
