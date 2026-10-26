import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import { BUNDLED_GLOBAL_RUNNER_ID } from "../../Types/Runner/BundledGlobalRunner";
import ProjectReferencesService from "./ProjectReferencesService";
import ObjectID from "../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
import { getDeletedAgentRunnerRebindNote } from "../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import ComponentKeyWrite from "../Utils/ComponentKeyWrite";
import { isShippedSecretValue } from "../EnvironmentConfig";
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
import Select from "../Types/Database/Select";
import PositiveNumber from "../../Types/PositiveNumber";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ProjectDefaultRow from "../Utils/Database/ProjectDefaultRow";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import ColumnWriteRefusedException from "../Types/Database/Permissions/ColumnWriteRefusedException";
import CallerPermission from "../Utils/Permission/CallerPermission";
import Permission from "../../Types/Permission";
import {
  ProjectDefaultRunnerRefusal,
  canBeProjectDefaultRunner,
  describeDefaultRunnerStopsRunningRunbooks,
  describeProjectDefaultRunnerRefusal,
  getProjectDefaultRunnerRefusal,
} from "../../Types/Runner/ProjectDefaultRunner";

/*
 * What a global Runner row is, in the words every refusal about one uses.
 * A global Runner is one the OneUptime server runs for every project: no
 * project owns it (projectId is empty), only OneUptime or a master admin
 * creates it (Admin Dashboard -> Settings -> Global Runners), and it runs
 * runbook steps only - never AI remediation commands, which act in a
 * project's own systems, nor code work: a code repository picks one of its
 * own project's Runners, or none (Types/Runner/CodeRepositoryRunner).
 */
export const GLOBAL_RUNNER_IN_A_PROJECT_MESSAGE: string =
  "A global Runner belongs to no project: OneUptime runs it for every project. Create it under Admin Dashboard → Settings → Global Runners, or create a Runner of this project's own under Runbooks → Runners.";

export const RUNNER_WITHOUT_PROJECT_MESSAGE: string =
  "A Runner belongs to a project, or is a global Runner that OneUptime runs for every project. Create one under Runbooks → Runners in your project.";

export const GLOBAL_RUNNER_CHANGED_MESSAGE: string =
  "Whether a Runner is global, and which project a Runner belongs to, is set when it is created and never changed. Create a new Runner instead.";

/*
 * The bundled global Runner - the one every install runs (Helm
 * globalRunner, Docker Compose global-runner) - is kept by the server from
 * GLOBAL_RUNNER_KEY on every boot, so deleting it would only bring it back.
 * It is turned off where it runs.
 */
export const BUNDLED_GLOBAL_RUNNER_DELETE_MESSAGE: string =
  "This global Runner comes with this server, which sets it up again on its next start. To turn it off, set globalRunner.enabled to false in the Helm chart, or GLOBAL_RUNNER_REPLICAS=0 in Docker Compose's config.env.";

export const GLOBAL_RUNNER_CAPABILITY_MESSAGE: string =
  "A global Runner runs runbook steps only, never OneUptime AI's commands: they act in a project's own systems, so they run on a Runner of that project's own that an AI rule picks.";

// The global Runner columns anyone signed in may read (RunnerAPI's listing).
export const GLOBAL_RUNNER_PUBLIC_SELECT: Select<Model> = {
  _id: true,
  name: true,
  description: true,
  lastAlive: true,
  canRunRunbooks: true,
  isGlobalRunner: true,
};

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

export class Service extends ProjectReferencesService<Model> {
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
    await super.onBeforeCreate(createBy);

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

    Service.holdToGlobalRunnerShape(createBy.data, createBy.props.tenantId);

    // Created as the project's default Runner: only one that may be it.
    Service.assertMayBeProjectDefault(createBy.data);

    // And only by someone who may make a Runner the default.
    Service.assertMayCreateAsProjectDefault(createBy.data, createBy.props);

    if (!createBy.data.key) {
      createBy.data.key = ObjectID.generate().toString();
    }

    // Never a value this repository ships, whoever writes it (ComponentKeyWrite).
    ComponentKeyWrite.assertCreatedKey(createBy.data.key, "a Runner");

    if (!createBy.data.agentVersion) {
      createBy.data.agentVersion = new Version("1.0.0");
    }

    if (!createBy.data.connectionStatus) {
      createBy.data.connectionStatus = RunnerConnectionStatus.Disconnected;
    }

    return { createBy, carryForward: [] };
  }

  /*
   * A Runner created as its project's default takes the default from the
   * project's other Runners - only now that it exists, so a create that is
   * refused or fails leaves the project's default where it was.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    await ProjectDefaultRow.afterCreate({
      service: this,
      defaultColumn: "isProjectDefault",
      createdItem: createdItem,
    });

    return await super.onCreateSuccess(onCreate, createdItem);
  }

  /*
   * Refuses a Runner written as its project's default that may not be it
   * (Types/Runner/ProjectDefaultRunner): a global Runner, the in-cluster
   * Runner the Kubernetes agent chart installed, or one with "Runs
   * Runbooks" off. `data` is the row as the write leaves it.
   */
  public static assertMayBeProjectDefault(data: {
    isProjectDefault?: boolean | undefined;
    isGlobalRunner?: boolean | undefined;
    canRunRunbooks?: boolean | undefined;
    name?: unknown;
    hostInfo?: unknown;
  }): void {
    if (data.isProjectDefault !== true) {
      return;
    }

    const refusal: ProjectDefaultRunnerRefusal | null =
      getProjectDefaultRunnerRefusal(data);

    if (refusal) {
      throw new BadDataException(
        describeProjectDefaultRunnerRefusal({
          refusal,
          ...(typeof data.name === "string" && data.name
            ? { name: data.name }
            : {}),
        }),
      );
    }
  }

  /*
   * A Runner created as its project's default is created by someone who may
   * make a Runner the default: the column's update list, those who edit
   * Runners. Every creator of a Runner may give the column a value - a
   * client that sends what the API publishes sends false with every
   * create - so its create list is the table's (Runner.isProjectDefault),
   * and this refuses the one value that makes the new Runner the default,
   * in the words the column check uses. Create Runner alone, like a Project
   * Member, never makes the Runner it creates the one every runbook step
   * that picks no Runner runs on. OneUptime and a master admin may.
   */
  public static assertMayCreateAsProjectDefault(
    data: { isProjectDefault?: boolean | undefined },
    props: DatabaseCommonInteractionProps,
  ): void {
    if (data.isProjectDefault !== true || props.isRoot || props.isMasterAdmin) {
      return;
    }

    const model: Model = new Model();

    const mayMakeDefault: Array<Permission> =
      model.getColumnAccessControlFor("isProjectDefault")?.update || [];

    if (
      CallerPermission.holdsAnyOf(props, mayMakeDefault, {
        projectId: props.tenantId,
      })
    ) {
      return;
    }

    throw new ColumnWriteRefusedException({
      requestType: DatabaseRequestType.Create,
      columnName: "isProjectDefault",
      modelName: model.singularName,
      permissions: mayMakeDefault,
    });
  }

  /*
   * The project's default Runner, when it has one that may be it: what a
   * step that picks no Runner runs on (Utils/Runner/GlobalRunnerChoice).
   * Read as OneUptime. A default that may no longer be it - "Runs Runbooks"
   * turned off by an older server, say - is no default at all: the step
   * goes on by the default order rather than to a Runner that never takes
   * it.
   */
  @CaptureSpan()
  public async findProjectDefaultRunner(
    projectId: ObjectID,
  ): Promise<Model | null> {
    const runner: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        isProjectDefault: true,
      },
      select: {
        _id: true,
        name: true,
        isGlobalRunner: true,
        canRunRunbooks: true,
        hostInfo: true,
      },
      props: { isRoot: true },
    });

    if (!runner || !canBeProjectDefaultRunner(runner)) {
      return null;
    }

    return runner;
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
   * - turn on "Runs Runbooks" on an agent row. It runs kubectl only, and
   *   the capability is a holding that refuses every registration that
   *   cannot present the row's current key — which is every pod restart,
   *   since the pod keeps its key in memory only. (Nor may a code
   *   repository pick an agent row: CodeRepositoryService refuses that.)
   *
   * Nor may anyone turn on "Runs AI Remediation Commands" for a global
   * Runner. (Only OneUptime and a master admin write that column at all: a
   * Runner is picked for OneUptime AI's commands, RunnerAiCommandsPick.)
   *
   * And the project's default Runner (isProjectDefault) stays one that may
   * be it (Types/Runner/ProjectDefaultRunner): an update may not make a
   * global Runner, an agent row or one with "Runs Runbooks" off the
   * default, nor turn "Runs Runbooks" off for the default while it stays
   * the default - the steps that pick no Runner run on it.
   *
   * Root writes (registration, heartbeats, sign-off, and the default taken
   * from a project's other Runners) are the server's own.
   * CardModelDetail posts every field of the Runner form, so a re-posted
   * unchanged name and a capability posted as false always pass: editing an
   * agent row's description or labels must still save. The Runners checked
   * are the ones the update writes - the ones its caller may write - and the
   * update is held to them (findRowsAndHoldUpdateToThem).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * A key it writes is never a value this repository ships, whoever
     * writes it, root included (ComponentKeyWrite).
     */
    ComponentKeyWrite.assertUpdatedKey(updateBy.data, "a Runner");

    /*
     * Whether a Runner is global, and the project it belongs to, are set
     * when it is created and never written again - root and master admins
     * included: a project's own Runner turned global would be handed every
     * project's steps, and a global one moved into a project would keep
     * the key every project's steps were handed to.
     */
    Service.assertNotMovedInOrOutOfGlobal(updateBy.data);

    if (updateBy.props.isRoot) {
      return { updateBy, carryForward: null };
    }

    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;

    // Whether the update writes "Runs AI Remediation Commands" on.
    const writesAiCommandsOn: boolean = data["canRunAiCommands"] === true;

    const newName: unknown = data["name"];
    const isNameWritten: boolean = newName !== undefined && newName !== null;
    const turnsOnCapabilities: Array<string> = [];

    if (data["canRunRunbooks"] === true) {
      turnsOnCapabilities.push('"Runs Runbooks"');
    }

    // Whether the update makes Runners the project default.
    const makesProjectDefault: boolean = data["isProjectDefault"] === true;

    /*
     * Whether it turns "Runs Runbooks" off for Runners it leaves the
     * default - the ones it does not take the default from at once.
     */
    const stopsRunbooksOnDefault: boolean =
      data["canRunRunbooks"] === false && data["isProjectDefault"] !== false;

    if (
      !isNameWritten &&
      turnsOnCapabilities.length === 0 &&
      !writesAiCommandsOn &&
      !makesProjectDefault &&
      !stopsRunbooksOnDefault
    ) {
      return { updateBy, carryForward: null };
    }

    /*
     * The Runners the update writes, with the update held to them
     * (findRowsAndHoldUpdateToThem): for a teammate, the ones they may
     * write, so a caller is never judged against, or told about, another
     * project's Runner, nor one they may not write.
     */
    const runners: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        name: true,
        hostInfo: true,
        isGlobalRunner: true,
        canRunRunbooks: true,
        isProjectDefault: true,
      },
    );

    for (const runner of runners) {
      /*
       * Made the project default: the Runner as the update leaves it may
       * be it - a "Runs Runbooks" the same update turns on counts.
       */
      if (makesProjectDefault) {
        Service.assertMayBeProjectDefault({
          isProjectDefault: true,
          isGlobalRunner: runner.isGlobalRunner,
          canRunRunbooks:
            typeof data["canRunRunbooks"] === "boolean"
              ? (data["canRunRunbooks"] as boolean)
              : runner.canRunRunbooks,
          name: runner.name,
          hostInfo: runner.hostInfo,
        });
      }

      // The default keeps running the steps that pick no Runner.
      if (stopsRunbooksOnDefault && runner.isProjectDefault === true) {
        throw new BadDataException(
          describeDefaultRunnerStopsRunningRunbooks(runner.name || undefined),
        );
      }

      /*
       * A global Runner runs runbook steps only (a master admin may pause
       * them with "Runs Runbooks"): AI commands act in one project's own
       * systems.
       */
      if (runner.isGlobalRunner && data["canRunAiCommands"] === true) {
        throw new BadDataException(GLOBAL_RUNNER_CAPABILITY_MESSAGE);
      }

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
          `Runner "${runner.name}" is the in-cluster Runner the Kubernetes agent chart registered, and its name is how OneUptime recognises it (and keeps secrets and shell work away from it), so it cannot be renamed. Use its description instead, or upgrade the Kubernetes agent chart: the Kubernetes AI agent replaces this Runner, and the Runner can then be deleted. ${getDeletedAgentRunnerRebindNote()}`,
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
          )} cannot be turned on for it — and doing so would stop it re-registering after its pod restarts. Create a Runner under Runbooks → Runners for runbooks instead.`,
        );
      }
    }

    return { updateBy, carryForward: null };
  }

  /*
   * The bundled global Runner is never deleted through the API, a master
   * admin's included (BUNDLED_GLOBAL_RUNNER_DELETE_MESSAGE): the server's own
   * startup sync (root) is the only one that removes it. The rows the delete
   * removes are read as every delete hook reads them, and the delete is held
   * to them (findRowsAndHoldDeleteToThem), so it removes no row this did not
   * see.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.props.isRoot) {
      const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
        deleteBy,
        {
          _id: true,
        },
      );

      if (Service.includesBundledGlobalRunner(rows)) {
        throw new BadDataException(BUNDLED_GLOBAL_RUNNER_DELETE_MESSAGE);
      }
    }

    return await super.onBeforeDelete(deleteBy);
  }

  // Whether these rows include the bundled global Runner.
  public static includesBundledGlobalRunner(rows: Array<Model>): boolean {
    return rows.some((row: Model): boolean => {
      return (
        (row._id?.toString() || "").toLowerCase() ===
        BUNDLED_GLOBAL_RUNNER_ID.toLowerCase()
      );
    });
  }

  /*
   * The update is written: a Runner it made the project default takes the
   * default from the project's other Runners - only the Runners the update
   * actually wrote (ProjectDefaultRow).
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await ProjectDefaultRow.afterUpdate({
      service: this,
      defaultColumn: "isProjectDefault",
      updatedData: onUpdate.updateBy.data,
      updatedItemIds: updatedItemIds,
    });

    return await super.onUpdateSuccess(onUpdate, updatedItemIds);
  }

  /*
   * A Runner is a project's own (projectId set) or global (isGlobalRunner,
   * no project) - never both, never neither. A global one runs runbook
   * steps only: one created to run OneUptime AI's commands is refused, and
   * otherwise canRunAiCommands is left to its default, off. It is not
   * written here: the column takes no one's create permission any more (a
   * Runner is picked for those commands, RunnerAiCommandsPick), and a value
   * a create hook writes is asked of the caller as if they had sent it
   * (HookWritesCallersMayMake). Whoever creates it: a project's create
   * always carries its project (the tenant), and only OneUptime or a master
   * admin may write isGlobalRunner at all (the column takes no one's create
   * permission).
   */
  public static holdToGlobalRunnerShape(
    data: Model,
    // The project the create is made in, which the create stamps on the row.
    tenantId?: ObjectID | undefined,
  ): void {
    if (data.isGlobalRunner === true) {
      if (data.projectId || data.project || tenantId) {
        throw new BadDataException(GLOBAL_RUNNER_IN_A_PROJECT_MESSAGE);
      }

      if (data.canRunAiCommands === true) {
        throw new BadDataException(GLOBAL_RUNNER_CAPABILITY_MESSAGE);
      }

      if (data.canRunRunbooks === undefined || data.canRunRunbooks === null) {
        data.canRunRunbooks = true;
      }

      return;
    }

    if (!data.projectId && !data.project && !tenantId) {
      throw new BadDataException(RUNNER_WITHOUT_PROJECT_MESSAGE);
    }
  }

  /*
   * Refuses an update that writes isGlobalRunner or the project a Runner
   * belongs to (see onBeforeUpdate). A column it leaves out, or writes as
   * undefined, is not written.
   */
  public static assertNotMovedInOrOutOfGlobal(data: unknown): void {
    if (!data || typeof data !== "object") {
      return;
    }

    const written: Record<string, unknown> = data as Record<string, unknown>;

    for (const column of ["isGlobalRunner", "projectId", "project"]) {
      if (written[column] !== undefined) {
        throw new BadDataException(GLOBAL_RUNNER_CHANGED_MESSAGE);
      }
    }
  }

  /*
   * Whether the server has a global Runner that takes runbook steps - one
   * of the three facts the "global by default" rule reads (RunnerChoice).
   * Whether it is online right now is left to the claim timeout: a global
   * Runner that is restarting picks the step up when it is back.
   */
  @CaptureSpan()
  public async hasGlobalRunnerForRunbooks(): Promise<boolean> {
    const count: PositiveNumber = await this.countBy({
      query: {
        isGlobalRunner: true,
        canRunRunbooks: true,
      },
      props: { isRoot: true },
    });

    return count.toNumber() > 0;
  }

  /*
   * The global Runners, as anyone signed in may see them: the columns of
   * GLOBAL_RUNNER_PUBLIC_SELECT only - never a key, a host or a version.
   * Read as OneUptime: no project owns them, so no project's read reaches
   * them.
   */
  @CaptureSpan()
  public async findGlobalRunners(): Promise<Array<Model>> {
    return await this.findBy({
      query: { isGlobalRunner: true },
      select: GLOBAL_RUNNER_PUBLIC_SELECT,
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * Whether a global Runner has heartbeated within the Runner window: what
   * a repository on the Global Runner waits for, since every global Runner
   * takes those repositories' AI work (CodeFixAgentAuth). lastAlive is a
   * query predicate, as for every other Runner liveness check.
   */
  @CaptureSpan()
  public async hasOnlineGlobalRunner(): Promise<boolean> {
    const count: PositiveNumber = await this.countBy({
      query: {
        isGlobalRunner: true,
        lastAlive: QueryHelper.greaterThan(
          OneUptimeDate.getSomeMinutesAgo(RUNNER_ALIVE_WINDOW_IN_MINUTES),
        ),
      },
      props: { isRoot: true },
    });

    return count.toNumber() > 0;
  }

  private static getReservedAgentNameRefusal(): string {
    return `Runner names starting with "${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/" are reserved for the in-cluster Runners the Kubernetes agent chart registers (with --set aiAccess.enabled=true). Choose another name.`;
  }

  /*
   * Whether a Runner with this id exists. Asked only for a key that did not
   * match it, so that a wrong key is counted only for a Runner there is
   * (WrongComponentKeyLimit): an id no Runner has can never be let in,
   * whatever key comes with it.
   */
  @CaptureSpan()
  public async hasRunnerWithId(runnerId: ObjectID): Promise<boolean> {
    const runner: Model | null = await this.findOneBy({
      query: {
        _id: runnerId.toString(),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(runner);
  }

  @CaptureSpan()
  public async findByIdAndKey(data: {
    agentId: ObjectID;
    agentKey: string;
  }): Promise<Model | null> {
    if (!data.agentId || !data.agentKey) {
      return null;
    }

    /*
     * A key this repository ships never authenticates a Runner: one that is
     * blank, "secret" or a config.example.env placeholder
     * (EnvironmentConfig.isShippedSecretValue) is refused before the table is
     * read, whether or not a row holds it. This is the lookup the runbook
     * protocol authenticates every request with (RunnerAuthorization), so
     * the rule holds on every route at once. A real Runner's key is a long
     * random value the server made, which this never refuses.
     */
    if (isShippedSecretValue(data.agentKey)) {
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
        canRunAiCommands: true,
        /*
         * The claim path reads the Kubernetes posture (in-cluster or not) to
         * decide whether a credential-less kubectl job may be served.
         */
        hostInfo: true,
        // A global Runner is served the global jobs, and nothing else.
        isGlobalRunner: true,
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
   * Refuses to assign secret material (a secret RunbookVariable) to a
   * kubernetes-agent Runner. Such a Runner row is minted and re-keyed with
   * the project's telemetry ingestion key — a credential every collector and
   * CI job holds — so whatever is assigned to it is reachable by anyone
   * holding that key. It runs kubectl with its own ServiceAccount only and
   * never needs a secret; the claim path would refuse to hand one over
   * anyway, so the assignment is refused where it is made, with a message
   * that says what to do instead. "Agent" is the one rule
   * (isKubernetesAgentRunnerRow): the name marker or an agent posture.
   */
  @CaptureSpan()
  public async assertNoKubernetesAgentRunners(data: {
    runners: unknown;
    // What is being assigned, for the message: "secret".
    assignedWhat: string;
  }): Promise<void> {
    const agentRunner: Model | undefined = (
      await this.findKubernetesAgentRunners(data.runners)
    )[0];

    if (agentRunner) {
      throw new BadDataException(
        `Runner "${agentRunner.name}" is the in-cluster Runner the Kubernetes agent chart installed. It runs kubectl with its own ServiceAccount only and is never given a ${data.assignedWhat}, because its identity is issued with the project's telemetry ingestion key. Assign this ${data.assignedWhat} to a Runner you created under Runbooks → Runners instead.`,
      );
    }
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
