import RunnerService from "../../../Server/Services/RunnerService";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
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
import RunbookCredentialReaders from "../../../Server/Utils/AutoRemediation/RunbookCredentialReaders";
import AiCommandCredentialReach, {
  CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE,
} from "../../../Server/Utils/AutoRemediation/AiCommandCredentialReach";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import Exception from "../../../Types/Exception/Exception";
import BadDataException from "../../../Types/Exception/BadDataException";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";

/*
 * TURNING ON "RUNS AI REMEDIATION COMMANDS" FOR A RUNNER THAT HOLDS SSH
 * CREDENTIALS TAKES THE READ OF RUNBOOK CREDENTIALS.
 *
 * An SSH command OneUptime AI composes runs with one of the SSH credentials
 * assigned to its Runner, the one OneUptime AI picks - with nobody
 * approving it, for a rule set to fix without asking that names no Runners
 * (any Runner that takes OneUptime AI's commands). Approving such a plan,
 * and saving such a rule, are held to whoever may read runbook credentials;
 * so is letting a Runner that holds SSH credentials take OneUptime AI's
 * commands:
 *
 * - an editor of Runners who may not read credentials is refused, with the
 *   Runner and who may do it named;
 * - a Runner holding no SSH credential (none, or Kubernetes ones only)
 *   asks nothing more;
 * - a Runner already taking them asks nothing (the Runner form posts every
 *   field back), and neither does turning it off;
 * - whoever may read credentials (the permission, Project Owner, Project
 *   Admin) and OneUptime itself are let through without a look-up;
 * - a block on Read Runbook Credential takes it away, even from an admin;
 * - turning it on - whoever does it - holds the project's lock from before
 *   the Runners' credentials are read until the update is written
 *   (AiCommandCredentialReach), keeps it right before the write, and is
 *   refused, to be saved again, when the lock cannot be had or was lost;
 * - a workflow's step is held to the person who last saved the workflow,
 *   never to the Project Admin permissions the step acts with.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "cd000000-0000-4000-8000-000000000001",
);
const OFFICE_RUNNER: string = "cd000000-0000-4000-8000-000000000011";
const LAB_RUNNER: string = "cd000000-0000-4000-8000-000000000012";

interface RunnerHookAccess {
  onBeforeUpdate(updateBy: UpdateBy<Runner>): Promise<OnUpdate<Runner>>;
  onUpdatePermitted(updateBy: UpdateBy<Runner>): Promise<void>;
  onUpdateSuccess(
    onUpdate: OnUpdate<Runner>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Runner>>;
  onUpdateError(
    error: Exception,
    onUpdate?: OnUpdate<Runner> | undefined,
  ): Promise<Exception>;
}

const LOCK_NAMESPACE: string = "AiCommandCredentialReach";
const LOCK_KEY: string = "cd000000-0000-4000-8000-000000000001";
const WORKFLOW_ID: ObjectID = new ObjectID(
  "cd000000-0000-4000-8000-000000000031",
);
const SAVER_ID: ObjectID = new ObjectID(
  "cd000000-0000-4000-8000-000000000041",
);

const hooks: RunnerHookAccess = RunnerService as unknown as RunnerHookAccess;

function caller(data: {
  permissions: Array<Permission>;
  blocked?: Array<Permission> | undefined;
}): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
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

// May edit Runners; may not read runbook credentials.
const RUNNER_EDITOR: DatabaseCommonInteractionProps = caller({
  permissions: [Permission.ReadRunner, Permission.EditRunner],
});

function runner(id: string, name: string, canRunAiCommands: boolean): Runner {
  return {
    _id: id,
    id: new ObjectID(id),
    projectId: PROJECT_ID,
    name: name,
    canRunAiCommands: canRunAiCommands,
    hostInfo: {},
  } as unknown as Runner;
}

interface CredentialRow {
  type: RunbookCredentialType;
  runners: Array<string>;
}

function update(
  data: JSONObject,
  props: DatabaseCommonInteractionProps,
  query: JSONObject = { _id: OFFICE_RUNNER },
  limit: number = 1,
): UpdateBy<Runner> {
  return {
    query: query,
    data: data as unknown as Runner,
    skip: 0,
    limit: limit,
    props: props,
  } as unknown as UpdateBy<Runner>;
}

// The ids a query's _id names: a plain id, or an "any of".
function idsNamedBy(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  return Object.values(
    (value as { objectLiteralParameters: JSONObject }).objectLiteralParameters,
  ).flat() as Array<string>;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(NotAuthorizedException);
    return (error as Error).message;
  }

  throw new Error("expected the update to be refused");
}

describe('RunnerService - turning on "Runs AI Remediation Commands"', () => {
  let runners: Array<Runner>;
  let credentials: Array<CredentialRow>;
  let runnerFindBy: jest.SpyInstance;
  let credentialFindBy: jest.SpyInstance;
  let locks: InMemoryLocks;

  beforeEach(() => {
    stubProjectDirectory({});
    stubGenericReferenceCheck();

    locks = new InMemoryLocks();
    locks.install();

    runners = [runner(OFFICE_RUNNER, "office-runner", false)];
    credentials = [
      { type: RunbookCredentialType.SSH, runners: [OFFICE_RUNNER] },
    ];

    runnerFindBy = jest
      .spyOn(RunnerService, "findBy")
      .mockImplementation(async (): Promise<Array<Runner>> => {
        return runners;
      });

    // The editor may write the Runners stored.
    stubRowsCallerMayWrite(RunnerService, () => {
      return runners;
    });

    /*
     * The credentials assigned to the Runners asked about, of the type
     * asked about (any type when none is) - what the database answers the
     * look-up with.
     */
    credentialFindBy = jest
      .spyOn(
        ProjectScopedReferenceValidator.getLookupService(RunbookCredential),
        "findBy",
      )
      .mockImplementation(
        async (
          findBy: FindBy<RunbookCredential>,
        ): Promise<Array<RunbookCredential>> => {
          const query: JSONObject = findBy.query as unknown as JSONObject;
          const askedRunners: Array<string> = (
            query["runners"] as Array<ObjectID>
          ).map((id: ObjectID): string => {
            return id.toString();
          });

          return credentials
            .filter((credential: CredentialRow): boolean => {
              return (
                (query["credentialType"] === undefined ||
                  credential.type === query["credentialType"]) &&
                credential.runners.some((id: string): boolean => {
                  return askedRunners.includes(id);
                })
              );
            })
            .map((credential: CredentialRow): RunbookCredential => {
              return {
                _id: ObjectID.generate().toString(),
                runners: credential.runners.map((id: string): Runner => {
                  return { _id: id } as unknown as Runner;
                }),
              } as unknown as RunbookCredential;
            });
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses an editor of Runners who may not read credentials, for a Runner holding an SSH credential", async () => {
    const message: string = await refusal(
      hooks.onBeforeUpdate(update({ canRunAiCommands: true }, RUNNER_EDITOR)),
    );

    expect(message).toContain('Runner "office-runner" holds SSH credentials');
    expect(message).toContain('"Runs AI Remediation Commands"');
    // Who may, named as approving such a plan names them.
    expect(message).toContain(
      `takes permission to read runbook credentials: ${RunbookCredentialReaders.getTitles()}.`,
    );
    expect(RunbookCredentialReaders.getTitles()).toContain(
      "Read Runbook Credential",
    );
  });

  it("asks OneUptime which SSH credentials the Runners it turns on hold", async () => {
    await refusal(
      hooks.onBeforeUpdate(update({ canRunAiCommands: true }, RUNNER_EDITOR)),
    );

    expect(credentialFindBy).toHaveBeenCalledTimes(1);

    const lookUp: FindBy<RunbookCredential> = credentialFindBy.mock
      .calls[0]![0] as FindBy<RunbookCredential>;
    const query: JSONObject = lookUp.query as unknown as JSONObject;

    expect(
      (query["runners"] as Array<ObjectID>).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([OFFICE_RUNNER]);
    expect(query["credentialType"]).toBe(RunbookCredentialType.SSH);
    expect(lookUp.props).toEqual({ isRoot: true });
  });

  it("reads the Runners the update writes, in the caller's project, and holds the update to them", async () => {
    credentials = [];
    runners = [
      runner(LAB_RUNNER, "lab-runner", false),
      runner(OFFICE_RUNNER, "office-runner", false),
    ];

    const updateBy: UpdateBy<Runner> = update(
      { canRunAiCommands: true },
      RUNNER_EDITOR,
      { name: "runner" },
      LIMIT_MAX,
    );

    await hooks.onBeforeUpdate(updateBy);

    const read: FindBy<Runner> = runnerFindBy.mock
      .calls[0]![0] as FindBy<Runner>;
    const readQuery: JSONObject = read.query as unknown as JSONObject;

    expect(readQuery["name"]).toBe("runner");
    expect(readQuery["projectId"]).toBe(PROJECT_ID);

    // The write covers the Runners checked, and no others.
    const held: JSONObject = updateBy.query as unknown as JSONObject;

    expect(idsNamedBy(held["_id"]).sort()).toEqual(
      [LAB_RUNNER, OFFICE_RUNNER].sort(),
    );
    expect(updateBy.skip).toBe(0);
    expect(updateBy.limit).toBe(2);
  });

  it.each([
    ["no credential", []],
    [
      "Kubernetes credentials only",
      [{ type: RunbookCredentialType.Kubernetes, runners: [OFFICE_RUNNER] }],
    ],
    [
      "an SSH credential of another Runner only",
      [{ type: RunbookCredentialType.SSH, runners: [LAB_RUNNER] }],
    ],
  ])(
    "lets it through for a Runner holding %s",
    async (_label: string, held: Array<CredentialRow>) => {
      credentials = held;

      await expect(
        hooks.onBeforeUpdate(update({ canRunAiCommands: true }, RUNNER_EDITOR)),
      ).resolves.toBeDefined();
    },
  );

  it("asks nothing for a Runner already taking them - the Runner form posts every field back", async () => {
    runners = [runner(OFFICE_RUNNER, "office-runner", true)];

    await expect(
      hooks.onBeforeUpdate(
        update(
          {
            name: "office-runner",
            description: "In the office rack",
            canRunRunbooks: false,
            canRunCodeFixTasks: false,
            canRunAiCommands: true,
          },
          RUNNER_EDITOR,
        ),
      ),
    ).resolves.toBeDefined();

    expect(credentialFindBy).not.toHaveBeenCalled();
  });

  it("asks nothing when it is turned off, or not written at all", async () => {
    for (const data of [
      { canRunAiCommands: false },
      { description: "In the office rack" },
    ]) {
      await expect(
        hooks.onBeforeUpdate(update(data, RUNNER_EDITOR)),
      ).resolves.toBeDefined();
    }

    expect(runnerFindBy).not.toHaveBeenCalled();
    expect(credentialFindBy).not.toHaveBeenCalled();
  });

  it("refuses an update over several Runners when one it turns on holds an SSH credential", async () => {
    runners = [
      runner(LAB_RUNNER, "lab-runner", false),
      runner(OFFICE_RUNNER, "office-runner", false),
    ];

    const message: string = await refusal(
      hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, RUNNER_EDITOR, {
          name: "runner",
        }),
      ),
    );

    expect(message).toContain('Runner "office-runner"');
    expect(message).not.toContain("lab-runner");
  });

  it("lets an update over several Runners through when the one holding an SSH credential already takes them", async () => {
    runners = [
      runner(LAB_RUNNER, "lab-runner", false),
      runner(OFFICE_RUNNER, "office-runner", true),
    ];

    await expect(
      hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, RUNNER_EDITOR, {
          name: "runner",
        }),
      ),
    ).resolves.toBeDefined();

    const lookUp: FindBy<RunbookCredential> = credentialFindBy.mock
      .calls[0]![0] as FindBy<RunbookCredential>;

    expect(
      (
        (lookUp.query as unknown as JSONObject)["runners"] as Array<ObjectID>
      ).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([LAB_RUNNER]);
  });

  it.each([
    [
      "Read Runbook Credential",
      [Permission.EditRunner, Permission.ReadRunbookCredential],
    ],
    ["Project Owner", [Permission.ProjectOwner]],
    ["Project Admin", [Permission.ProjectAdmin]],
  ])(
    "lets someone with %s through, without a look-up",
    async (_label: string, permissions: Array<Permission>) => {
      await expect(
        hooks.onBeforeUpdate(
          update({ canRunAiCommands: true }, caller({ permissions })),
        ),
      ).resolves.toBeDefined();

      expect(credentialFindBy).not.toHaveBeenCalled();
    },
  );

  it("lets OneUptime itself through (registration and the server's own writes)", async () => {
    await expect(
      hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, {
          isRoot: true,
        } as DatabaseCommonInteractionProps),
      ),
    ).resolves.toBeDefined();

    expect(credentialFindBy).not.toHaveBeenCalled();
  });

  it("a block on Read Runbook Credential takes it away, even from an admin", async () => {
    await refusal(
      hooks.onBeforeUpdate(
        update(
          { canRunAiCommands: true },
          caller({
            permissions: [Permission.ProjectAdmin],
            blocked: [Permission.ReadRunbookCredential],
          }),
        ),
      ),
    );
  });

  describe("the project's lock", () => {
    it("is taken before the Runner's credentials are read, and held until the update is written", async () => {
      credentials = [];

      const updateBy: UpdateBy<Runner> = update(
        { canRunAiCommands: true },
        RUNNER_EDITOR,
      );

      let heldWhileReading: boolean = false;
      credentialFindBy.mockImplementation(
        async (): Promise<Array<RunbookCredential>> => {
          heldWhileReading = locks.isHeld(LOCK_KEY, LOCK_NAMESPACE);
          return [];
        },
      );

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(updateBy);

      expect(heldWhileReading).toBe(true);
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(true);
      expect(
        AiCommandCredentialReach.carriedForward(onUpdate.carryForward),
      ).not.toBeNull();

      await hooks.onUpdatePermitted(onUpdate.updateBy);
      expect(locks.eventsOf("keep")).toEqual([
        `keep:${LOCK_NAMESPACE}/${LOCK_KEY}`,
      ]);

      await hooks.onUpdateSuccess(onUpdate, [new ObjectID(OFFICE_RUNNER)]);
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });

    it("is taken for someone who may read credentials too: an SSH credential assigned at the same moment must see the switch", async () => {
      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update(
          { canRunAiCommands: true },
          caller({ permissions: [Permission.ProjectAdmin] }),
        ),
      );

      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(true);
      expect(credentialFindBy).not.toHaveBeenCalled();

      await hooks.onUpdateSuccess(onUpdate, [new ObjectID(OFFICE_RUNNER)]);
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });

    it("is not taken when nothing is turned on", async () => {
      runners = [runner(OFFICE_RUNNER, "office-runner", true)];

      for (const data of [
        { canRunAiCommands: true },
        { canRunAiCommands: false },
        { description: "In the office rack" },
        { name: "office-runner" },
      ]) {
        await hooks.onBeforeUpdate(update(data, RUNNER_EDITOR));
      }

      await hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, {
          isRoot: true,
        } as DatabaseCommonInteractionProps),
      );

      expect(locks.eventsOf("lock")).toEqual([]);
    });

    it("is given back when the switch is refused", async () => {
      await refusal(
        hooks.onBeforeUpdate(
          update({ canRunAiCommands: true }, RUNNER_EDITOR),
        ),
      );

      expect(locks.eventsOf("lock")).toHaveLength(1);
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });

    it("is given back when the update fails after its check", async () => {
      credentials = [];

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, RUNNER_EDITOR),
      );

      const error: Exception = new BadDataException("The UPDATE failed.");
      await expect(hooks.onUpdateError(error, onUpdate)).resolves.toBe(error);

      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });

    it("an error before the check gives back nothing, as nothing was taken", async () => {
      const error: Exception = new BadDataException("Refused earlier.");

      await expect(hooks.onUpdateError(error, undefined)).resolves.toBe(error);
      expect(locks.eventsOf("release")).toEqual([]);
    });

    it("refuses the switch, to be saved again, when another change holds the lock for longer than a write waits", async () => {
      locks.busy.add(LOCK_KEY);

      await expect(
        hooks.onBeforeUpdate(
          update({ canRunAiCommands: true }, RUNNER_EDITOR),
        ),
      ).rejects.toThrow(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);

      expect(credentialFindBy).not.toHaveBeenCalled();
    });

    it("refuses the switch, to be saved again, when the lock cannot be reached", async () => {
      locks.unreachable = true;

      await expect(
        hooks.onBeforeUpdate(
          update(
            { canRunAiCommands: true },
            caller({ permissions: [Permission.ProjectOwner] }),
          ),
        ),
      ).rejects.toThrow(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);
    });

    it("refuses the write when the lock was lost after the check", async () => {
      credentials = [];

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, RUNNER_EDITOR),
      );

      locks.lose(LOCK_KEY, LOCK_NAMESPACE);

      await expect(
        hooks.onUpdatePermitted(onUpdate.updateBy),
      ).rejects.toThrow(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);
    });

    it("lets an update that holds no lock through its last check", async () => {
      runners = [runner(OFFICE_RUNNER, "office-runner", true)];

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, RUNNER_EDITOR),
      );

      await expect(
        hooks.onUpdatePermitted(onUpdate.updateBy),
      ).resolves.toBeUndefined();
      expect(locks.eventsOf("keep")).toEqual([]);
    });
  });

  describe("a workflow's step", () => {
    // What the person who last saved the workflow holds in the project.
    let saverPermissions: Array<Permission> | null;
    let saverLookUp: jest.SpyInstance;

    beforeEach(() => {
      saverPermissions = [Permission.WorkflowAdmin];

      saverLookUp = jest
        .spyOn(
          AccessTokenService,
          "getDatabaseCommonInteractionPropsByUserAndProject",
        )
        .mockImplementation(
          async (data: {
            userId: ObjectID;
            projectId: ObjectID;
          }): Promise<DatabaseCommonInteractionProps> => {
            if (saverPermissions === null) {
              // No longer a member of the project.
              return {
                userId: data.userId,
                tenantId: data.projectId,
                userTenantAccessPermission: {
                  [data.projectId.toString()]: null,
                },
              } as unknown as DatabaseCommonInteractionProps;
            }

            return {
              ...caller({ permissions: saverPermissions }),
              userId: data.userId,
            };
          },
        );
    });

    function stepProps(
      savedBy: ObjectID | null = SAVER_ID,
    ): DatabaseCommonInteractionProps {
      return WorkflowPrincipal.getPropsWithoutPlan({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
        workflowName: "Turn on AI commands",
        savedByUserId: savedBy,
      });
    }

    it("is refused when the person who last saved the workflow may not read credentials, though the step acts as a Project Admin", async () => {
      const props: DatabaseCommonInteractionProps = stepProps();

      // The step's own permissions would let it read credentials.
      expect(
        props.userTenantAccessPermission![PROJECT_ID.toString()]!.permissions.map(
          (permission: UserPermission): Permission => {
            return permission.permission;
          },
        ),
      ).toContain(Permission.ProjectAdmin);

      const message: string = await refusal(
        hooks.onBeforeUpdate(update({ canRunAiCommands: true }, props)),
      );

      expect(message).toContain('Runner "office-runner" holds SSH credentials');
      expect(message).toContain(
        "the person who last saved the workflow has it",
      );
      expect(saverLookUp).toHaveBeenCalledTimes(1);
      expect(String(saverLookUp.mock.calls[0]![0].userId)).toBe(
        SAVER_ID.toString(),
      );
      expect(String(saverLookUp.mock.calls[0]![0].projectId)).toBe(
        PROJECT_ID.toString(),
      );
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });

    it("is let through when the person who last saved the workflow may read credentials", async () => {
      saverPermissions = [Permission.ReadRunbookCredential];

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, stepProps()),
      );

      expect(credentialFindBy).not.toHaveBeenCalled();

      await hooks.onUpdateSuccess(onUpdate, [new ObjectID(OFFICE_RUNNER)]);
    });

    it("is refused when the workflow names nobody as its last saver, without a look-up", async () => {
      await refusal(
        hooks.onBeforeUpdate(update({ canRunAiCommands: true }, stepProps(null))),
      );

      expect(saverLookUp).not.toHaveBeenCalled();
    });

    it("is refused when the person who last saved it has left the project", async () => {
      saverPermissions = null;

      await refusal(
        hooks.onBeforeUpdate(update({ canRunAiCommands: true }, stepProps())),
      );
    });

    it("is refused when a block takes the read away from the person who last saved it", async () => {
      saverPermissions = [Permission.ProjectAdmin];
      saverLookUp.mockImplementation(
        async (): Promise<DatabaseCommonInteractionProps> => {
          return caller({
            permissions: [Permission.ProjectAdmin],
            blocked: [Permission.ReadRunbookCredential],
          });
        },
      );

      await refusal(
        hooks.onBeforeUpdate(update({ canRunAiCommands: true }, stepProps())),
      );
    });

    it("is let through for a Runner holding no SSH credential, whoever saved the workflow", async () => {
      credentials = [];

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, stepProps()),
      );

      expect(onUpdate.updateBy.data).toEqual({ canRunAiCommands: true });

      await hooks.onUpdateSuccess(onUpdate, [new ObjectID(OFFICE_RUNNER)]);
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });
  });
});
