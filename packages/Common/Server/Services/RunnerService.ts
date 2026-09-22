import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import Version from "../../Types/Version";
import BadDataException from "../../Types/Exception/BadDataException";
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
  isKubernetesAgentRunnerName,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
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
   * the limit, and again on the rows, with the server-owned name marker.
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
      return !isKubernetesAgentRunnerName(runner.name);
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
   * Refuses to assign credential material (a RunbookCredential or a
   * RunbookSecret) to a kubernetes-agent Runner. Such a Runner row is minted
   * and re-keyed with the project's telemetry ingestion key — a credential
   * every collector and CI job holds — so whatever is assigned to it is
   * reachable by anyone holding that key. It runs kubectl with its own
   * ServiceAccount only and never needs a credential; the claim path would
   * refuse to hand one over anyway, so the assignment is refused where it is
   * made, with a message that says what to do instead.
   */
  @CaptureSpan()
  public async assertNoKubernetesAgentRunners(data: {
    runners: unknown;
    // What is being assigned, for the message: "credential" or "secret".
    assignedWhat: string;
  }): Promise<void> {
    const ids: Array<ObjectID> = Service.readRunnerIds(data.runners);

    if (ids.length === 0) {
      return;
    }

    const runners: Array<Model> = await this.findBy({
      query: { _id: QueryHelper.any(ids) },
      select: { _id: true, name: true },
      limit: ids.length,
      skip: 0,
      props: { isRoot: true },
    });

    const agentRunner: Model | undefined = runners.find((runner: Model) => {
      return isKubernetesAgentRunnerName(runner.name);
    });

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
     */
    const runners: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
        canRunCodeFixTasks: true,
        lastAlive: QueryHelper.greaterThan(
          OneUptimeDate.getSomeMinutesAgo(RUNNER_ALIVE_WINDOW_IN_MINUTES),
        ),
      },
      select: {
        _id: true,
        name: true,
        lastAlive: true,
      },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return runners[0] || null;
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
