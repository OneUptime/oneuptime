import RunbookCredentialService, {
  Service as RunbookCredentialServiceClass,
} from "../../../Server/Services/RunbookCredentialService";
import RunnerService from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import AiCommandCredentialReach, {
  CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE,
} from "../../../Server/Utils/AutoRemediation/AiCommandCredentialReach";
import RunbookCredentialReaders from "../../../Server/Utils/AutoRemediation/RunbookCredentialReaders";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  stubGenericReferenceCheck,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";

/*
 * ASSIGNING AN SSH CREDENTIAL TO A RUNNER THAT RUNS ONEUPTIME AI'S COMMANDS
 * TAKES THE READ OF RUNBOOK CREDENTIALS.
 *
 * OneUptime AI runs an SSH command with one of the SSH credentials of the
 * Runner it runs on - unattended, for a rule that runs its commands without
 * asking. Turning on "Runs AI Remediation Commands" for a Runner that holds
 * SSH credentials already takes the read of runbook credentials
 * (RunnerService); this is the other side of the same rule
 * (RunbookCredentialService):
 *
 *   - creating an SSH credential with a Runner that runs AI commands is
 *     refused to someone who may not read credentials, with the Runner and
 *     who may named;
 *   - Runners that do not run AI commands, a Kubernetes credential and no
 *     Runners at all ask nothing more;
 *   - whoever may read credentials, and OneUptime itself, are let through
 *     without a look-up of the Runners, and without the lock;
 *   - every such create by anyone else holds its project's lock from before
 *     the Runners are read until it is written or has failed, keeps it
 *     right before the write, and is refused, to be saved again, when the
 *     lock cannot be had or was lost;
 *   - giving a credential Runners afterwards is an update, which only
 *     someone who may read credentials can make (changing a record takes
 *     the read of it): it takes no lock, and anyone else who reaches the
 *     hook - a workflow's step - is refused before anything is read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "ce000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "ce000000-0000-4000-8000-000000000002",
);
const AI_RUNNER: string = "ce000000-0000-4000-8000-000000000011";
const PLAIN_RUNNER: string = "ce000000-0000-4000-8000-000000000012";
const CREDENTIAL_ID: string = "ce000000-0000-4000-8000-000000000021";
const OTHER_CREDENTIAL_ID: string = "ce000000-0000-4000-8000-000000000022";

const LOCK_NAMESPACE: string = "AiCommandCredentialReach";

const PRIVATE_KEY: string =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n-----END OPENSSH PRIVATE KEY-----";

interface CredentialHookAccess {
  onBeforeCreate(
    createBy: CreateBy<RunbookCredential>,
  ): Promise<OnCreate<RunbookCredential>>;
  onCreatePermitted(onCreate: OnCreate<RunbookCredential>): Promise<void>;
  onCreateSuccess(
    onCreate: OnCreate<RunbookCredential>,
    createdItem: RunbookCredential,
  ): Promise<RunbookCredential>;
  onCreateError(
    error: Exception,
    onCreate?: OnCreate<RunbookCredential> | undefined,
  ): Promise<Exception>;
  onBeforeUpdate(
    updateBy: UpdateBy<RunbookCredential>,
  ): Promise<OnUpdate<RunbookCredential>>;
  onUpdatePermitted(updateBy: UpdateBy<RunbookCredential>): Promise<void>;
  onUpdateSuccess(
    onUpdate: OnUpdate<RunbookCredential>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<RunbookCredential>>;
  onUpdateError(
    error: Exception,
    onUpdate?: OnUpdate<RunbookCredential> | undefined,
  ): Promise<Exception>;
}

const hooks: CredentialHookAccess =
  RunbookCredentialService as unknown as CredentialHookAccess;

function caller(data: {
  permissions: Array<Permission>;
  blocked?: Array<Permission> | undefined;
  projectId?: ObjectID | undefined;
}): DatabaseCommonInteractionProps {
  const projectId: ObjectID = data.projectId || PROJECT_ID;

  return {
    tenantId: projectId,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: [
          ...data.permissions.map((permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
            };
          }),
          ...(data.blocked || []).map(
            (permission: Permission): UserPermission => {
              return {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
                isBlockPermission: true,
              };
            },
          ),
        ],
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

// May create and edit credentials; may not read them.
const CREDENTIAL_WRITER: DatabaseCommonInteractionProps = caller({
  permissions: [
    Permission.CreateRunbookCredential,
    Permission.EditRunbookCredential,
  ],
});

interface RunnerRow {
  _id: string;
  name: string;
  projectId: ObjectID;
  canRunAiCommands: boolean;
}

interface CredentialRow {
  _id: string;
  projectId: ObjectID;
  credentialType: RunbookCredentialType;
  runners: Array<string>;
}

// The ids a query names: a plain id, an ObjectID, or an "any of".
function idsNamedBy(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value.toLowerCase()];
  }

  if (value instanceof ObjectID) {
    return [value.toString().toLowerCase()];
  }

  return (
    Object.values(
      (value as { objectLiteralParameters: JSONObject })
        .objectLiteralParameters,
    ).flat() as Array<unknown>
  ).map((id: unknown): string => {
    return String(id).toLowerCase();
  });
}

function sshCredential(runners: Array<string>): CreateBy<RunbookCredential> {
  const model: RunbookCredential = new RunbookCredential();
  model.name = "web-hosts";
  model.credentialType = RunbookCredentialType.SSH;
  model.sshHostname = "10.0.4.21";
  model.sshUsername = "deploy";
  model.sshPrivateKey = PRIVATE_KEY;
  model.runners = runners.map((id: string): Runner => {
    return { _id: id } as unknown as Runner;
  });

  return {
    data: model,
    props: CREDENTIAL_WRITER,
  } as CreateBy<RunbookCredential>;
}

function kubernetesCredential(
  runners: Array<string>,
): CreateBy<RunbookCredential> {
  const model: RunbookCredential = new RunbookCredential();
  model.name = "prod-cluster";
  model.credentialType = RunbookCredentialType.Kubernetes;
  model.kubernetesApiServerUrl = "https://10.0.0.1:6443";
  model.kubernetesServiceAccountToken = "eyJhbGciOiJSUzI1NiJ9.token";
  model.runners = runners.map((id: string): Runner => {
    return { _id: id } as unknown as Runner;
  });

  return {
    data: model,
    props: CREDENTIAL_WRITER,
  } as CreateBy<RunbookCredential>;
}

function as(
  createBy: CreateBy<RunbookCredential>,
  props: DatabaseCommonInteractionProps,
): CreateBy<RunbookCredential> {
  return { ...createBy, props: props } as CreateBy<RunbookCredential>;
}

function update(
  runners: Array<string> | undefined,
  props: DatabaseCommonInteractionProps = CREDENTIAL_WRITER,
  query: JSONObject = { _id: CREDENTIAL_ID },
): UpdateBy<RunbookCredential> {
  const data: JSONObject = {};

  if (runners !== undefined) {
    data["runners"] = runners.map((id: string): JSONObject => {
      return { _id: id };
    });
  }

  return {
    query: query,
    data: data as unknown as RunbookCredential,
    skip: 0,
    limit: 1,
    props: props,
  } as unknown as UpdateBy<RunbookCredential>;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(NotAuthorizedException);
    return (error as Error).message;
  }

  throw new Error("expected the write to be refused");
}

describe("RunbookCredentialService - assigning SSH credentials to Runners that run AI commands", () => {
  let locks: InMemoryLocks;
  let runners: Array<RunnerRow>;
  let credentials: Array<CredentialRow>;
  let runnerFindBy: jest.SpyInstance;
  let credentialFindBy: jest.SpyInstance;

  const lockKey: string = PROJECT_ID.toString().toLowerCase();

  beforeEach(() => {
    stubProjectDirectory({});
    stubGenericReferenceCheck();

    locks = new InMemoryLocks();
    locks.install();

    runners = [
      {
        _id: AI_RUNNER,
        name: "office-runner",
        projectId: PROJECT_ID,
        canRunAiCommands: true,
      },
      {
        _id: PLAIN_RUNNER,
        name: "lab-runner",
        projectId: PROJECT_ID,
        canRunAiCommands: false,
      },
    ];

    credentials = [
      {
        _id: CREDENTIAL_ID,
        projectId: PROJECT_ID,
        credentialType: RunbookCredentialType.SSH,
        runners: [PLAIN_RUNNER],
      },
    ];

    /*
     * The Runners table, as the database answers the two reads a write
     * makes of it: which Runners are kubernetes-agent Runners (none here),
     * and which of them run AI commands in the project.
     */
    runnerFindBy = jest
      .spyOn(RunnerService, "findBy")
      .mockImplementation(
        async (findBy: FindBy<Runner>): Promise<Array<Runner>> => {
          const query: JSONObject = findBy.query as unknown as JSONObject;
          const ids: Array<string> = idsNamedBy(query["_id"]);

          return runners
            .filter((row: RunnerRow): boolean => {
              return (
                ids.includes(row._id.toLowerCase()) &&
                (query["canRunAiCommands"] === undefined ||
                  row.canRunAiCommands === query["canRunAiCommands"]) &&
                (query["projectId"] === undefined ||
                  String(query["projectId"]).toLowerCase() ===
                    row.projectId.toString().toLowerCase())
              );
            })
            .map((row: RunnerRow): Runner => {
              return {
                _id: row._id,
                id: new ObjectID(row._id),
                name: row.name,
                hostInfo: {},
              } as unknown as Runner;
            });
        },
      );

    // The credentials an update writes, as stored.
    const storedCredentials: () => Array<RunbookCredential> =
      (): Array<RunbookCredential> => {
        return credentials.map((row: CredentialRow): RunbookCredential => {
          return {
            _id: row._id,
            id: new ObjectID(row._id),
            projectId: row.projectId,
            credentialType: row.credentialType,
            runners: row.runners.map((id: string): Runner => {
              return { _id: id } as unknown as Runner;
            }),
          } as unknown as RunbookCredential;
        });
      };

    stubRowsCallerMayWrite(RunbookCredentialService, storedCredentials);

    credentialFindBy = jest
      .spyOn(RunbookCredentialService, "findBy")
      .mockImplementation(async (): Promise<Array<RunbookCredential>> => {
        return storedCredentials();
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // What the AI-command lookup asked, if it was asked.
  function aiRunnerLookUps(): Array<FindBy<Runner>> {
    return runnerFindBy.mock.calls
      .map((call: Array<unknown>): FindBy<Runner> => {
        return call[0] as FindBy<Runner>;
      })
      .filter((findBy: FindBy<Runner>): boolean => {
        return (
          (findBy.query as unknown as JSONObject)["canRunAiCommands"] === true
        );
      });
  }

  describe("creating an SSH credential with Runners", () => {
    it("refuses someone who may not read credentials, for a Runner that runs AI commands", async () => {
      const message: string = await refusal(
        hooks.onBeforeCreate(sshCredential([AI_RUNNER])),
      );

      expect(message).toContain('Runner "office-runner"');
      expect(message).toContain("runs OneUptime AI's remediation commands");
      expect(message).toContain(
        `takes permission to read runbook credentials: ${RunbookCredentialReaders.getTitles()}.`,
      );
      expect(RunbookCredentialReaders.getTitles()).toContain(
        "Read Runbook Credential",
      );
    });

    it("names the Runner that runs AI commands when the credential names several", async () => {
      const message: string = await refusal(
        hooks.onBeforeCreate(sshCredential([PLAIN_RUNNER, AI_RUNNER])),
      );

      expect(message).toContain('Runner "office-runner"');
      expect(message).not.toContain("lab-runner");
    });

    it("asks OneUptime which of the named Runners run AI commands, in the credential's project", async () => {
      await refusal(hooks.onBeforeCreate(sshCredential([AI_RUNNER])));

      const lookUps: Array<FindBy<Runner>> = aiRunnerLookUps();
      expect(lookUps).toHaveLength(1);

      const query: JSONObject = lookUps[0]!.query as unknown as JSONObject;
      expect(idsNamedBy(query["_id"])).toEqual([AI_RUNNER]);
      expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
      expect(lookUps[0]!.props).toEqual({ isRoot: true });
    });

    it("lets it through for Runners that do not run AI commands", async () => {
      const onCreate: OnCreate<RunbookCredential> = await hooks.onBeforeCreate(
        sshCredential([PLAIN_RUNNER]),
      );

      expect(onCreate.createBy.data.runners).toHaveLength(1);
    });

    it.each([
      [
        "Read Runbook Credential",
        [Permission.CreateRunbookCredential, Permission.ReadRunbookCredential],
      ],
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Admin", [Permission.ProjectAdmin]],
    ])(
      "lets someone with %s through, without a look-up of the Runners",
      async (_label: string, permissions: Array<Permission>) => {
        await expect(
          hooks.onBeforeCreate(
            as(sshCredential([AI_RUNNER]), caller({ permissions })),
          ),
        ).resolves.toBeDefined();

        expect(aiRunnerLookUps()).toHaveLength(0);
      },
    );

    it("a block on Read Runbook Credential takes it away, even from an admin", async () => {
      await refusal(
        hooks.onBeforeCreate(
          as(
            sshCredential([AI_RUNNER]),
            caller({
              permissions: [Permission.ProjectAdmin],
              blocked: [Permission.ReadRunbookCredential],
            }),
          ),
        ),
      );
    });

    it("asks nothing for a Kubernetes credential: OneUptime AI picks SSH credentials only", async () => {
      await expect(
        hooks.onBeforeCreate(kubernetesCredential([AI_RUNNER])),
      ).resolves.toBeDefined();

      expect(aiRunnerLookUps()).toHaveLength(0);
      expect(locks.eventsOf("lock")).toEqual([]);
    });

    it("asks nothing, and takes no lock, for an SSH credential with no Runners", async () => {
      await expect(
        hooks.onBeforeCreate(sshCredential([])),
      ).resolves.toBeDefined();

      expect(aiRunnerLookUps()).toHaveLength(0);
      expect(locks.eventsOf("lock")).toEqual([]);
    });

    it("lets OneUptime itself through, without a lock", async () => {
      await expect(
        hooks.onBeforeCreate(
          as(sshCredential([AI_RUNNER]), {
            isRoot: true,
          } as DatabaseCommonInteractionProps),
        ),
      ).resolves.toBeDefined();

      expect(aiRunnerLookUps()).toHaveLength(0);
      expect(locks.eventsOf("lock")).toEqual([]);
    });

    it("holds the project's lock from before the Runners are read until the credential is saved", async () => {
      const onCreate: OnCreate<RunbookCredential> = await hooks.onBeforeCreate(
        sshCredential([PLAIN_RUNNER]),
      );

      expect(locks.eventsOf("lock")).toEqual([
        `lock:${LOCK_NAMESPACE}/${lockKey}`,
      ]);
      expect(locks.isHeld(lockKey, LOCK_NAMESPACE)).toBe(true);
      expect(
        AiCommandCredentialReach.carriedForward(onCreate.carryForward),
      ).not.toBeNull();

      // Kept right before the INSERT...
      await hooks.onCreatePermitted(onCreate);
      expect(locks.eventsOf("keep")).toEqual([
        `keep:${LOCK_NAMESPACE}/${lockKey}`,
      ]);
      expect(locks.isHeld(lockKey, LOCK_NAMESPACE)).toBe(true);

      // ...and given back once the credential is saved.
      await hooks.onCreateSuccess(onCreate, onCreate.createBy.data);
      expect(locks.isHeld(lockKey, LOCK_NAMESPACE)).toBe(false);
    });

    it("takes no lock for someone who may read credentials: they may assign one to any Runner", async () => {
      const onCreate: OnCreate<RunbookCredential> = await hooks.onBeforeCreate(
        as(
          sshCredential([AI_RUNNER]),
          caller({ permissions: [Permission.ProjectAdmin] }),
        ),
      );

      expect(aiRunnerLookUps()).toHaveLength(0);
      expect(
        AiCommandCredentialReach.carriedForward(onCreate.carryForward),
      ).toBeNull();

      await hooks.onCreatePermitted(onCreate);
      await hooks.onCreateSuccess(onCreate, onCreate.createBy.data);
      expect(locks.events).toEqual([]);
    });

    it("lets someone who may read credentials create one when the lock cannot be reached", async () => {
      locks.unreachable = true;

      await expect(
        hooks.onBeforeCreate(
          as(
            sshCredential([AI_RUNNER]),
            caller({
              permissions: [
                Permission.CreateRunbookCredential,
                Permission.ReadRunbookCredential,
              ],
            }),
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("gives the lock back when it refuses", async () => {
      await refusal(hooks.onBeforeCreate(sshCredential([AI_RUNNER])));

      expect(locks.eventsOf("lock")).toHaveLength(1);
      expect(locks.isHeld(lockKey, LOCK_NAMESPACE)).toBe(false);
    });

    it("gives the lock back when the create fails after its check", async () => {
      const onCreate: OnCreate<RunbookCredential> = await hooks.onBeforeCreate(
        sshCredential([PLAIN_RUNNER]),
      );

      const error: Exception = new BadDataException("The INSERT failed.");
      await expect(hooks.onCreateError(error, onCreate)).resolves.toBe(error);

      expect(locks.isHeld(lockKey, LOCK_NAMESPACE)).toBe(false);
    });

    it("an error before the check gives back nothing, as nothing was taken", async () => {
      const error: Exception = new BadDataException("Refused earlier.");

      await expect(hooks.onCreateError(error, undefined)).resolves.toBe(error);
      expect(locks.eventsOf("release")).toEqual([]);
    });

    it("refuses, to be saved again, when another change holds the lock for longer than a write waits", async () => {
      locks.busy.add(lockKey);

      await expect(
        hooks.onBeforeCreate(sshCredential([PLAIN_RUNNER])),
      ).rejects.toThrow(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);

      expect(aiRunnerLookUps()).toHaveLength(0);
    });

    it("refuses, to be saved again, when the lock cannot be reached at all", async () => {
      locks.unreachable = true;

      await expect(
        hooks.onBeforeCreate(sshCredential([PLAIN_RUNNER])),
      ).rejects.toThrow(BadDataException);

      await expect(
        hooks.onBeforeCreate(sshCredential([PLAIN_RUNNER])),
      ).rejects.toThrow(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);
    });

    it("refuses the INSERT when the lock was lost after the check", async () => {
      const onCreate: OnCreate<RunbookCredential> = await hooks.onBeforeCreate(
        sshCredential([PLAIN_RUNNER]),
      );

      locks.lose(lockKey, LOCK_NAMESPACE);

      await expect(hooks.onCreatePermitted(onCreate)).rejects.toThrow(
        CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE,
      );
    });

    it("locks the project the request is made in, not one the credential names", async () => {
      const createBy: CreateBy<RunbookCredential> = sshCredential([
        PLAIN_RUNNER,
      ]);
      createBy.data.projectId = OTHER_PROJECT_ID;

      const onCreate: OnCreate<RunbookCredential> =
        await hooks.onBeforeCreate(createBy);

      expect(locks.isHeld(lockKey, LOCK_NAMESPACE)).toBe(true);
      expect(
        locks.isHeld(OTHER_PROJECT_ID.toString().toLowerCase(), LOCK_NAMESPACE),
      ).toBe(false);

      await hooks.onCreateSuccess(onCreate, onCreate.createBy.data);
    });
  });

  describe("giving a credential Runners afterwards (an update)", () => {
    it("refuses someone who may not read credentials before anything is read, and takes no lock", async () => {
      const message: string = await refusal(
        hooks.onBeforeUpdate(update([PLAIN_RUNNER, AI_RUNNER])),
      );

      expect(message).toBe(
        RunbookCredentialServiceClass.getRunnersWriteRefusal(CREDENTIAL_WRITER),
      );
      expect(message).toBe(
        `Assigning a runbook credential to Runners takes permission to read runbook credentials: ${RunbookCredentialReaders.getTitles()}.`,
      );
      expect(aiRunnerLookUps()).toHaveLength(0);
      expect(credentialFindBy).not.toHaveBeenCalled();
      expect(locks.events).toEqual([]);
    });

    it("refuses it whichever Runners are posted: one that runs no AI commands, or the ones the credential has", async () => {
      for (const posted of [[PLAIN_RUNNER], [AI_RUNNER, PLAIN_RUNNER]]) {
        await refusal(hooks.onBeforeUpdate(update(posted)));
      }

      expect(locks.events).toEqual([]);
    });

    it("refuses a workflow's step, though it acts as a Project Admin, and says a person has to assign them", async () => {
      const step: DatabaseCommonInteractionProps =
        WorkflowPrincipal.getPropsWithoutPlan({
          projectId: PROJECT_ID,
          workflowId: new ObjectID("ce000000-0000-4000-8000-000000000031"),
          workflowName: "Hand the web hosts key to the new Runner",
        });

      const message: string = await refusal(
        hooks.onBeforeUpdate(update([PLAIN_RUNNER], step)),
      );

      expect(message).toContain(
        "Assigning a runbook credential to Runners takes permission to read runbook credentials",
      );
      expect(message).toContain(
        "Workflow steps never have this permission, so a person who has it has to make this change.",
      );
      expect(aiRunnerLookUps()).toHaveLength(0);
      expect(locks.events).toEqual([]);
    });

    it.each([
      ["Read Runbook Credential", [Permission.ReadRunbookCredential]],
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Admin", [Permission.ProjectAdmin]],
    ])(
      "lets someone with %s give one any Runners, with no look-up and no lock",
      async (_label: string, permissions: Array<Permission>) => {
        const props: DatabaseCommonInteractionProps = caller({
          permissions: [Permission.EditRunbookCredential, ...permissions],
        });

        const onUpdate: OnUpdate<RunbookCredential> =
          await hooks.onBeforeUpdate(update([PLAIN_RUNNER, AI_RUNNER], props));

        expect(onUpdate.carryForward).toBeNull();
        expect(aiRunnerLookUps()).toHaveLength(0);
        expect(credentialFindBy).not.toHaveBeenCalled();
        expect(locks.events).toEqual([]);
      },
    );

    it("lets someone who may read credentials save while Valkey cannot be reached, or another change holds the lock", async () => {
      const props: DatabaseCommonInteractionProps = caller({
        permissions: [Permission.ProjectAdmin],
      });

      locks.unreachable = true;

      await expect(
        hooks.onBeforeUpdate(update([AI_RUNNER], props)),
      ).resolves.toBeDefined();

      locks.unreachable = false;
      locks.busy.add(lockKey);

      await expect(
        hooks.onBeforeUpdate(update([AI_RUNNER], props)),
      ).resolves.toBeDefined();
    });

    it("clearing a credential's Runners, or not writing them, asks nothing of anyone", async () => {
      for (const posted of [[], undefined]) {
        await expect(
          hooks.onBeforeUpdate(update(posted)),
        ).resolves.toBeDefined();
      }

      expect(aiRunnerLookUps()).toHaveLength(0);
      expect(locks.events).toEqual([]);
    });

    it("lets OneUptime itself through", async () => {
      await expect(
        hooks.onBeforeUpdate(
          update([AI_RUNNER], { isRoot: true } as DatabaseCommonInteractionProps),
        ),
      ).resolves.toBeDefined();
    });

    it("keeps nothing right before the write and gives nothing back after it", async () => {
      const onUpdate: OnUpdate<RunbookCredential> = await hooks.onBeforeUpdate(
        update([AI_RUNNER], caller({ permissions: [Permission.ProjectAdmin] })),
      );

      await hooks.onUpdatePermitted(onUpdate.updateBy);
      await hooks.onUpdateSuccess(onUpdate, [new ObjectID(CREDENTIAL_ID)]);

      const error: Exception = new BadDataException("The UPDATE failed.");
      await expect(hooks.onUpdateError(error, onUpdate)).resolves.toBe(error);

      expect(locks.events).toEqual([]);
    });
  });

  /*
   * A WRITE NEEDS A READ. Changing a runbook credential reaches its update
   * hook only for a caller who may read runbook credentials
   * (TablePermission.checkTableLevelReadForWrite refuses everyone else
   * first), by the same read RunbookCredentialReaders asks. So the hook's
   * refusal is only ever met by a workflow's step - which acts as a Project
   * Admin, is never lent the read, and has no workflow component that
   * writes a runbook credential.
   */
  describe("who reaches the update hook", () => {
    function canUpdate(props: DatabaseCommonInteractionProps): boolean {
      try {
        TablePermission.checkTableLevelReadForWrite(
          RunbookCredential,
          props,
          DatabaseRequestType.Update,
        );
        return true;
      } catch {
        return false;
      }
    }

    it("is, for every permission a person or an API key holds, someone who may read runbook credentials", () => {
      const wrong: Array<string> = [];

      for (const permission of Object.values(Permission) as Array<Permission>) {
        for (const props of [
          caller({ permissions: [permission] }),
          caller({ permissions: [Permission.EditRunbookCredential, permission] }),
          caller({
            permissions: [Permission.ProjectAdmin, permission],
            blocked: [Permission.ReadRunbookCredential],
          }),
        ]) {
          if (canUpdate(props) && !RunbookCredentialReaders.mayRead(props)) {
            wrong.push(permission);
          }
        }
      }

      expect(wrong).toEqual([]);
    });

    it("refuses an editor who may not read credentials before the hook, as a write needs a read", () => {
      expect(canUpdate(CREDENTIAL_WRITER)).toBe(false);
      expect(RunbookCredentialReaders.mayRead(CREDENTIAL_WRITER)).toBe(false);
    });

    it("lets a workflow's step past the read, which is why the hook refuses it itself - and no workflow step writes a runbook credential", () => {
      const step: DatabaseCommonInteractionProps =
        WorkflowPrincipal.getPropsWithoutPlan({
          projectId: PROJECT_ID,
          workflowId: new ObjectID("ce000000-0000-4000-8000-000000000032"),
        });

      expect(canUpdate(step)).toBe(true);
      expect(RunbookCredentialReaders.mayRead(step)).toBe(false);
      expect(new RunbookCredential().enableWorkflowOn).toBeUndefined();
    });
  });
});
