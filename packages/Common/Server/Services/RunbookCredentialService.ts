import ProjectReferencesService from "./ProjectReferencesService";
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
import { normalizeReferenceId } from "../Utils/Database/ProjectScopedReferenceRefusal";
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
 * taken by every create or update by someone who may not read runbook
 * credentials that assigns an SSH credential to Runners, before the Runners
 * are read and held until the write is done: a Runner's switch turned on at
 * the same moment is either seen by this check, or sees the credential in its
 * own. One who may read them is not checked and takes no lock: their write
 * ends as it would have after a switch turned on at the same moment, and
 * they may assign the credential whatever the switch.
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
    if (await RunbookCredentialReaders.mayRead(createBy.props)) {
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
        assigned: [{ projectId: projectId!, runnerIds: runnerIds }],
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
  ): Promise<Exception> {
    await AiCommandCredentialReach.giveBackAfterFailedCreate(error, onCreate);

    return await super.onCreateError(error, onCreate);
  }

  /*
   * A kubernetes-agent Runner is never given a credential (see
   * RunnerService.assertNoKubernetesAgentRunners). Checked on every write of
   * the Runner list, so assigning an existing credential to one is refused
   * the same way as creating it assigned.
   *
   * And an update that gives an SSH credential Runners holds the project's
   * lock, and adding a Runner that runs OneUptime AI's commands needs the
   * read of runbook credentials (see the top of this file). The credentials
   * are the ones the update writes - the ones its caller may write - and the
   * update is held to them (findRowsAndHoldUpdateToThem); the Runners each
   * one holds are read under the lock. A Runner a credential has when the
   * lock is taken is not asked about again: the form posts the whole list
   * back.
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

    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;

    const runnerIds: Array<ObjectID> = RunnerServiceClass.readRunnerIds(
      data["runners"],
    );

    // Clearing a credential's Runners, or not writing them, assigns nothing.
    if (updateBy.props.isRoot || runnerIds.length === 0) {
      return { updateBy, carryForward: null };
    }

    /*
     * One who may read runbook credentials may assign an SSH credential to
     * any Runner: nothing the update reads decides, so it takes no lock (see
     * the top of this file).
     */
    if (await RunbookCredentialReaders.mayRead(updateBy.props)) {
      return { updateBy, carryForward: null };
    }

    // A credential's type and project never change: these tell which locks.
    const credentials: Array<RunbookCredential> =
      await this.findRowsAndHoldUpdateToThem(updateBy, {
        _id: true,
        projectId: true,
        credentialType: true,
      });

    const sshCredentials: Array<RunbookCredential> =
      Service.getSshCredentials(credentials);

    if (sshCredentials.length === 0) {
      return { updateBy, carryForward: null };
    }

    /*
     * Held until the update is written, whichever Runners it adds - the
     * Runners a credential holds are the lock's to read: they are read
     * again under it, as they are now, not as they were before it was
     * taken. Another update may have taken a Runner off the credential
     * since, and this one, which writes it back, then adds it.
     */
    const hold: CredentialReachHold = await AiCommandCredentialReach.take(
      sshCredentials.map(
        (credential: RunbookCredential): ObjectID | undefined => {
          return credential.projectId || updateBy.props.tenantId;
        },
      ),
    );

    try {
      const current: Array<RunbookCredential> = Service.getSshCredentials(
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          _id: true,
          projectId: true,
          credentialType: true,
          runners: {
            _id: true,
          },
        }),
      );

      await Service.assertMayAssignToRunners({
        props: updateBy.props,
        assigned: current.map(
          (
            credential: RunbookCredential,
          ): { projectId: ObjectID; runnerIds: Array<ObjectID> } => {
            return {
              projectId: (credential.projectId || updateBy.props.tenantId)!,
              runnerIds: Service.getRunnersAdded({
                held: credential.runners,
                written: runnerIds,
              }),
            };
          },
        ),
      });
    } catch (error) {
      await AiCommandCredentialReach.giveBack(hold);
      throw error;
    }

    return AiCommandCredentialReach.heldUpdate(updateBy, hold);
  }

  // Right before the write: the lock its check was made under is still the update's.
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<RunbookCredential>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    await AiCommandCredentialReach.keepForUpdate(updateBy);
  }

  // The update is written: its lock is given back.
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<RunbookCredential>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<RunbookCredential>> {
    await AiCommandCredentialReach.giveBackAfterUpdate(onUpdate);

    return await super.onUpdateSuccess(onUpdate, updatedItemIds);
  }

  /*
   * The update was refused or failed after its check: its lock is given
   * back, unless the database may still write it.
   */
  @CaptureSpan()
  protected override async onUpdateError(
    error: Exception,
    onUpdate?: OnUpdate<RunbookCredential> | undefined,
  ): Promise<Exception> {
    await AiCommandCredentialReach.giveBackAfterFailedUpdate(error, onUpdate);

    return await super.onUpdateError(error, onUpdate);
  }

  // The SSH credentials of `credentials`.
  private static getSshCredentials(
    credentials: Array<RunbookCredential>,
  ): Array<RunbookCredential> {
    return credentials.filter((credential: RunbookCredential): boolean => {
      return credential.credentialType === RunbookCredentialType.SSH;
    });
  }

  /*
   * Of the Runners a write gives a credential (`written`), the ones it did
   * not have (`held`, as stored), compared as the other reference checks
   * compare ids (normalizeReferenceId).
   */
  public static getRunnersAdded(data: {
    held: unknown;
    written: Array<ObjectID>;
  }): Array<ObjectID> {
    const held: Set<string> = new Set<string>(
      RunnerServiceClass.readRunnerIds(data.held).map(
        (id: ObjectID): string => {
          return normalizeReferenceId(id.toString());
        },
      ),
    );

    return data.written.filter((id: ObjectID): boolean => {
      return !held.has(normalizeReferenceId(id.toString()));
    });
  }

  /*
   * Refuses a write that assigns an SSH credential to a Runner that runs
   * OneUptime AI's commands. Asked only for a caller who may not read
   * runbook credentials - both hooks let one who may through before they
   * take the lock - so it asks nothing more of who the caller is. `assigned`
   * names, per project, the Runners the write assigns the credential to that
   * it was not assigned to already. Read under the project's lock
   * (AiCommandCredentialReach).
   */
  public static async assertMayAssignToRunners(data: {
    props: DatabaseCommonInteractionProps;
    assigned: Array<{ projectId: ObjectID; runnerIds: Array<ObjectID> }>;
  }): Promise<void> {
    const asked: Array<{ projectId: ObjectID; runnerIds: Array<ObjectID> }> =
      data.assigned.filter(
        (entry: {
          projectId: ObjectID;
          runnerIds: Array<ObjectID>;
        }): boolean => {
          return entry.runnerIds.length > 0;
        },
      );

    for (const entry of asked) {
      const runners: Array<Runner> =
        await RunnerService.findRunnersRunningAiCommands({
          runnerIds: entry.runnerIds,
          projectId: entry.projectId,
        });

      if (runners.length > 0) {
        throw new NotAuthorizedException(
          Service.getAiCommandRunnerRefusal(runners[0]!, data.props),
        );
      }
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
