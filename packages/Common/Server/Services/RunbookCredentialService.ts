import ProjectReferencesService from "./ProjectReferencesService";
import { StatementContext } from "../Utils/Database/StatementOutcome";
import RunnerService, { Service as RunnerServiceClass } from "./RunnerService";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import RunbookCredentialType from "../../Types/Runbook/RunbookCredentialType";
import RunbookCredential from "../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../Models/DatabaseModels/Runner";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RunbookCredentialReaders from "../Utils/AutoRemediation/RunbookCredentialReaders";
import AiCommandCredentialReach, {
  CredentialReachHold,
} from "../Utils/AutoRemediation/AiCommandCredentialReach";

/*
 * An SSH credential assigned to a Runner that runs OneUptime AI's commands
 * ("Runs AI Remediation Commands") is one OneUptime AI may pick for the SSH
 * commands it runs there - with nobody approving them, for a rule that runs
 * its commands without asking. Letting it is held to whoever may read
 * runbook credentials (RunbookCredentialReaders), from this side as much as
 * from the Runner's: creating an SSH credential with such a Runner, or adding
 * one to an SSH credential's Runners, needs the read, as turning the switch
 * on for a Runner that holds SSH credentials does (RunnerService).
 *
 * Both sides are checked under one lock per project (AiCommandCredentialReach),
 * taken by every create by someone who may not read runbook credentials
 * that gives an SSH credential Runners, before the Runners are read, and
 * held until the write is done: a Runner's switch turned on at the same
 * moment is either seen by this check, or sees the credential in its own.
 * One who may read them is not checked and takes no lock: their write ends
 * as it would have after a switch turned on at the same moment, and they
 * may assign the credential whatever the switch. An update is made only by
 * someone who may read them (see onBeforeUpdate), so it takes none either.
 */
export class Service extends ProjectReferencesService<RunbookCredential> {
  public constructor() {
    super(RunbookCredential);
  }

  /*
   * A credential that is missing what its type needs is not a credential —
   * it is a step that will fail at execution time, on the far side of an
   * approval, in front of somebody's incident. Reject it at creation.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<RunbookCredential>,
  ): Promise<OnCreate<RunbookCredential>> {
    await super.onBeforeCreate(createBy);

    const type: RunbookCredentialType | undefined =
      createBy.data.credentialType;

    if (!type) {
      throw new BadDataException("Credential type is required.");
    }

    if (type === RunbookCredentialType.SSH) {
      if (!createBy.data.sshHostname) {
        throw new BadDataException("SSH credentials need a hostname.");
      }

      if (!createBy.data.sshUsername) {
        throw new BadDataException("SSH credentials need a username.");
      }

      if (!createBy.data.sshPrivateKey && !createBy.data.sshPassword) {
        throw new BadDataException(
          "SSH credentials need either a private key or a password.",
        );
      }
    }

    /*
     * The column is free text, not a database enum, so an unrecognised type
     * would otherwise create a credential that skips every check below and
     * can never be executed by anything.
     */
    if (
      type !== RunbookCredentialType.SSH &&
      type !== RunbookCredentialType.Kubernetes
    ) {
      throw new BadDataException(`Unknown credential type: ${String(type)}`);
    }

    if (type === RunbookCredentialType.Kubernetes) {
      if (!createBy.data.kubernetesApiServerUrl) {
        throw new BadDataException(
          "Kubernetes credentials need an API server URL.",
        );
      }

      if (!createBy.data.kubernetesServiceAccountToken) {
        throw new BadDataException(
          "Kubernetes credentials need a service account token.",
        );
      }
    }

    await RunnerService.assertNoKubernetesAgentRunners({
      runners: createBy.data.runners,
      assignedWhat: "credential",
    });

    const runnerIds: Array<ObjectID> = RunnerServiceClass.readRunnerIds(
      createBy.data.runners,
    );

    // An SSH credential created with Runners: see the top of this file.
    if (
      createBy.props.isRoot ||
      type !== RunbookCredentialType.SSH ||
      runnerIds.length === 0
    ) {
      return { createBy, carryForward: [] };
    }

    /*
     * One who may read runbook credentials may create one with any Runners:
     * nothing the create reads decides, so it takes no lock.
     */
    if (RunbookCredentialReaders.mayRead(createBy.props)) {
      return { createBy, carryForward: [] };
    }

    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    const hold: CredentialReachHold = await AiCommandCredentialReach.take([
      projectId,
    ]);

    try {
      await Service.assertMayAssignToRunners({
        props: createBy.props,
        projectId: projectId!,
        runnerIds: runnerIds,
      });
    } catch (error) {
      await AiCommandCredentialReach.giveBack(hold);
      throw error;
    }

    return {
      createBy,
      carryForward: AiCommandCredentialReach.carryForwardOf(hold),
    };
  }

  // Right before the INSERT: the lock its check was made under is still the create's.
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<RunbookCredential>,
  ): Promise<void> {
    await super.onCreatePermitted(onCreate);

    await AiCommandCredentialReach.keepForCreate(onCreate);
  }

  // The credential is saved: the lock is given back.
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<RunbookCredential>,
    createdItem: RunbookCredential,
  ): Promise<RunbookCredential> {
    await AiCommandCredentialReach.giveBackAfterCreate(onCreate);

    return await super.onCreateSuccess(onCreate, createdItem);
  }

  /*
   * The create was refused or failed after its check: the lock is given
   * back, unless the database may still write it.
   */
  @CaptureSpan()
  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<RunbookCredential> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    await AiCommandCredentialReach.giveBackAfterFailedCreate(
      error,
      onCreate,
      failedStatement,
    );

    return await super.onCreateError(error, onCreate, failedStatement);
  }

  /*
   * A kubernetes-agent Runner is never given a credential (see
   * RunnerService.assertNoKubernetesAgentRunners). Checked on every write of
   * the Runner list, so assigning an existing credential to one is refused
   * the same way as creating it assigned.
   *
   * And an update that gives a credential Runners is made by someone who may
   * read runbook credentials, or not at all. Changing a record takes the
   * read of it (a write needs a read: TablePermission.checkTableLevelReadForWrite,
   * the same read RunbookCredentialReaders asks), so a person or an API key
   * that reaches this hook may read runbook credentials, and may assign one
   * to any Runner: nothing the update reads decides, so it takes no lock (see
   * the top of this file). A workflow's step acts as a Project Admin, who may
   * read them, but is never lent that read, and no workflow step writes a
   * runbook credential: one that does, or anyone else who reaches here
   * without the read, is refused before anything is read rather than
   * checked. Clearing a credential's Runners, or not writing them, assigns
   * nothing.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<RunbookCredential>,
  ): Promise<OnUpdate<RunbookCredential>> {
    await super.onBeforeUpdate(updateBy);

    await RunnerService.assertNoKubernetesAgentRunners({
      runners: updateBy.data.runners,
      assignedWhat: "credential",
    });

    const runnerIds: Array<ObjectID> = RunnerServiceClass.readRunnerIds(
      (updateBy.data as unknown as JSONObject)["runners"],
    );

    if (
      updateBy.props.isRoot ||
      runnerIds.length === 0 ||
      RunbookCredentialReaders.mayRead(updateBy.props)
    ) {
      return { updateBy, carryForward: null };
    }

    throw new NotAuthorizedException(
      Service.getRunnersWriteRefusal(updateBy.props),
    );
  }

  // Why a caller who may not read runbook credentials cannot give one Runners.
  public static getRunnersWriteRefusal(
    props: DatabaseCommonInteractionProps,
  ): string {
    return `Assigning a runbook credential to Runners takes permission to read runbook credentials: ${RunbookCredentialReaders.getTitles()}.${RunbookCredentialReaders.getWorkflowNote(props)}`;
  }

  /*
   * Refuses a create that assigns an SSH credential to a Runner that runs
   * OneUptime AI's commands. Asked only for a caller who may not read
   * runbook credentials - the create hook lets one who may through before
   * it takes the lock - so it asks nothing more of who the caller is.
   * `runnerIds` are the Runners of `projectId` the create assigns the
   * credential to. Read under the project's lock (AiCommandCredentialReach).
   */
  public static async assertMayAssignToRunners(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    runnerIds: Array<ObjectID>;
  }): Promise<void> {
    if (data.runnerIds.length === 0) {
      return;
    }

    const runners: Array<Runner> =
      await RunnerService.findRunnersRunningAiCommands({
        runnerIds: data.runnerIds,
        projectId: data.projectId,
      });

    if (runners.length > 0) {
      throw new NotAuthorizedException(
        Service.getAiCommandRunnerRefusal(runners[0]!, data.props),
      );
    }
  }

  // Why an SSH credential cannot be assigned to `runner`.
  public static getAiCommandRunnerRefusal(
    runner: Runner,
    props: DatabaseCommonInteractionProps,
  ): string {
    return `Runner "${runner.name || runner._id?.toString() || ""}" runs OneUptime AI's remediation commands, and OneUptime AI picks from the SSH credentials assigned to it for the commands it runs there, so assigning an SSH credential to it takes permission to read runbook credentials: ${RunbookCredentialReaders.getTitles()}.${RunbookCredentialReaders.getWorkflowNote(props)} Assign the credential to Runners that do not run AI remediation commands, or ask someone who has the permission to assign it.`;
  }
}

export default new Service();
