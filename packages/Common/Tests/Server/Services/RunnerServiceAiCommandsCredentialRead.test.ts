import RunnerService, {
  Service as RunnerServiceClass,
} from "../../../Server/Services/RunnerService";
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
import {
  readsOfRowsCallerMayWrite,
  stubRowsCallerMayWrite,
} from "../TestingUtils/RowsCallerMayWrite";
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
 *   Admin) and OneUptime itself are let through without a look-up, and
 *   without the lock;
 * - a block on Read Runbook Credential takes it away, even from an admin;
 * - for anyone else, a save that posts the switch as it is stored, with
 *   anything else, leaves the switch out of the write: no lock, no Valkey,
 *   and a form opened before the switch was turned off cannot turn it back
 *   on - a description edit saves even while Valkey cannot be reached;
 * - turning it on - or posting nothing but the switch, on already - holds
 *   the project's lock from before the Runners' switches and credentials
 *   are read until the update is written (AiCommandCredentialReach), keeps
 *   it right before the write, and is refused, to be saved again, when the
 *   lock cannot be had or was lost;
 * - a workflow's step is never lent the read: it acts as a Project Admin,
 *   but is answered as one who may not read credentials, whoever saved the
 *   workflow, and nobody is looked up.
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

    // The Runners the caller may write, found in their project...
    const mayWrite: JSONObject = readsOfRowsCallerMayWrite(RunnerService)[0]!
      .query as unknown as JSONObject;

    expect(mayWrite["name"]).toBe("runner");
    expect(mayWrite["projectId"]).toBe(PROJECT_ID);

    // ... read again by the update's query, among them alone.
    const read: FindBy<Runner> = runnerFindBy.mock
      .calls[0]![0] as FindBy<Runner>;
    const readQuery: JSONObject = read.query as unknown as JSONObject;

    expect(readQuery["name"]).toBe("runner");
    expect(idsNamedBy(readQuery["_id"]).sort()).toEqual(
      [LAB_RUNNER, OFFICE_RUNNER].sort(),
    );

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

    const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
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
    );

    expect(credentialFindBy).not.toHaveBeenCalled();
    // The switch is left out of the write; everything else is written.
    expect(onUpdate.updateBy.data).toEqual({
      name: "office-runner",
      description: "In the office rack",
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
    });
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

    const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
      update(
        { canRunAiCommands: true, description: "In the office rack" },
        RUNNER_EDITOR,
        {
          name: "runner",
        },
      ),
    );

    // It turns the switch on for lab-runner: written, under the lock.
    expect(onUpdate.updateBy.data).toEqual({
      canRunAiCommands: true,
      description: "In the office rack",
    });
    expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(true);

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

    it("is not taken by someone who may read credentials: they may turn the switch on whatever the Runners hold", async () => {
      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update(
          { canRunAiCommands: true },
          caller({ permissions: [Permission.ProjectAdmin] }),
        ),
      );

      expect(locks.eventsOf("lock")).toEqual([]);
      expect(credentialFindBy).not.toHaveBeenCalled();
      expect(
        AiCommandCredentialReach.carriedForward(onUpdate.carryForward),
      ).toBeNull();

      await hooks.onUpdatePermitted(onUpdate.updateBy);
      await hooks.onUpdateSuccess(onUpdate, [new ObjectID(OFFICE_RUNNER)]);
      expect(locks.events).toEqual([]);
    });

    it("is not asked for by someone who may read credentials, so their save goes through when the lock cannot be reached", async () => {
      locks.unreachable = true;

      // The Runner form posts the switch back with every other field.
      runners = [runner(OFFICE_RUNNER, "office-runner", true)];

      for (const permission of [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ReadRunbookCredential,
      ]) {
        await expect(
          hooks.onBeforeUpdate(
            update(
              { canRunAiCommands: true, description: "In the office rack" },
              caller({ permissions: [Permission.EditRunner, permission] }),
            ),
          ),
        ).resolves.toBeDefined();
      }
    });

    it("is taken by a save that posts nothing but the switch, on already: leaving it out would leave the save nothing to write", async () => {
      runners = [runner(OFFICE_RUNNER, "office-runner", true)];

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, RUNNER_EDITOR),
      );

      expect(onUpdate.updateBy.data).toEqual({ canRunAiCommands: true });
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(true);
      // The Runner takes them already: nothing is asked of its credentials.
      expect(credentialFindBy).not.toHaveBeenCalled();

      await hooks.onUpdatePermitted(onUpdate.updateBy);
      expect(locks.eventsOf("keep")).toHaveLength(1);

      await hooks.onUpdateSuccess(onUpdate, [new ObjectID(OFFICE_RUNNER)]);
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });

    it("is not taken when the switch is not written on, or by OneUptime", async () => {
      for (const data of [
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

    it("reads whether the switch is on again under it: a Runner turned off since the update first read it is asked about", async () => {
      // As the update first reads it: still taking them.
      runnerFindBy.mockImplementationOnce(async (): Promise<Array<Runner>> => {
        return [runner(OFFICE_RUNNER, "office-runner", true)];
      });

      // As it is once the lock is held: turned off in the meantime, and it holds an SSH credential.
      runners = [runner(OFFICE_RUNNER, "office-runner", false)];

      const message: string = await refusal(
        hooks.onBeforeUpdate(update({ canRunAiCommands: true }, RUNNER_EDITOR)),
      );

      expect(message).toContain('Runner "office-runner"');
      expect(credentialFindBy).toHaveBeenCalledTimes(1);
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });

    it("is given back when the switch is refused", async () => {
      await refusal(
        hooks.onBeforeUpdate(update({ canRunAiCommands: true }, RUNNER_EDITOR)),
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
        hooks.onBeforeUpdate(update({ canRunAiCommands: true }, RUNNER_EDITOR)),
      ).rejects.toThrow(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);

      expect(credentialFindBy).not.toHaveBeenCalled();
    });

    it("refuses the switch, to be saved again, when the lock cannot be reached", async () => {
      locks.unreachable = true;

      await expect(
        hooks.onBeforeUpdate(update({ canRunAiCommands: true }, RUNNER_EDITOR)),
      ).rejects.toThrow(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);

      expect(credentialFindBy).not.toHaveBeenCalled();
    });

    it("refuses the write when the lock was lost after the check", async () => {
      credentials = [];

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, RUNNER_EDITOR),
      );

      locks.lose(LOCK_KEY, LOCK_NAMESPACE);

      await expect(hooks.onUpdatePermitted(onUpdate.updateBy)).rejects.toThrow(
        CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE,
      );
    });

    it("lets an update that holds no lock through its last check", async () => {
      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update({ description: "In the office rack" }, RUNNER_EDITOR),
      );

      await expect(
        hooks.onUpdatePermitted(onUpdate.updateBy),
      ).resolves.toBeUndefined();
      expect(locks.eventsOf("keep")).toEqual([]);
    });
  });

  describe("a save that leaves the switch as it is stored", () => {
    beforeEach(() => {
      runners = [runner(OFFICE_RUNNER, "office-runner", true)];
    });

    it("leaves the switch out of the write, and takes no lock", async () => {
      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update(
          { canRunAiCommands: true, description: "In the office rack" },
          RUNNER_EDITOR,
        ),
      );

      expect(onUpdate.updateBy.data).toEqual({
        description: "In the office rack",
      });
      expect(locks.events).toEqual([]);
      expect(credentialFindBy).not.toHaveBeenCalled();
      expect(
        AiCommandCredentialReach.carriedForward(onUpdate.carryForward),
      ).toBeNull();

      // Nothing to keep right before the write, nothing to give back after it.
      await hooks.onUpdatePermitted(onUpdate.updateBy);
      await hooks.onUpdateSuccess(onUpdate, [new ObjectID(OFFICE_RUNNER)]);
      expect(locks.events).toEqual([]);
    });

    it("is saved while Valkey cannot be reached", async () => {
      locks.unreachable = true;

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update(
          {
            name: "office-runner",
            description: "Moved to the lab rack",
            canRunAiCommands: true,
          },
          RUNNER_EDITOR,
        ),
      );

      expect(onUpdate.updateBy.data).toEqual({
        name: "office-runner",
        description: "Moved to the lab rack",
      });

      await expect(
        hooks.onUpdatePermitted(onUpdate.updateBy),
      ).resolves.toBeUndefined();
    });

    it("is saved while another change holds the project's lock, without waiting for it", async () => {
      locks.busy.add(LOCK_KEY);

      await expect(
        hooks.onBeforeUpdate(
          update(
            { canRunAiCommands: true, description: "In the office rack" },
            RUNNER_EDITOR,
          ),
        ),
      ).resolves.toBeDefined();

      expect(locks.eventsOf("lock")).toEqual([]);
    });

    it("cannot turn the switch back on: what it does not write stays as whoever last wrote it left it", async () => {
      // The form was opened while the switch was on, and is saved later.
      const updateBy: UpdateBy<Runner> = update(
        {
          name: "office-runner",
          description: "In the office rack",
          canRunAiCommands: true,
        },
        RUNNER_EDITOR,
      );

      await hooks.onBeforeUpdate(updateBy);

      // Turned off by someone else after the save read it: not in the write, so off it stays.
      expect("canRunAiCommands" in (updateBy.data as object)).toBe(false);
    });

    it("is left as posted for someone who may read credentials: they may write the switch whatever it holds", async () => {
      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update(
          { canRunAiCommands: true, description: "In the office rack" },
          caller({ permissions: [Permission.ProjectAdmin] }),
        ),
      );

      expect(onUpdate.updateBy.data).toEqual({
        canRunAiCommands: true,
        description: "In the office rack",
      });
      expect(locks.events).toEqual([]);
    });

    it("is left as posted for OneUptime's own writes", async () => {
      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update({ canRunAiCommands: true, description: "x" }, {
          isRoot: true,
        } as DatabaseCommonInteractionProps),
      );

      expect(onUpdate.updateBy.data).toEqual({
        canRunAiCommands: true,
        description: "x",
      });
    });

    it("turns the switch on, under the lock and checked, when the Runner is off after all", async () => {
      runners = [runner(OFFICE_RUNNER, "office-runner", false)];

      const message: string = await refusal(
        hooks.onBeforeUpdate(
          update(
            { canRunAiCommands: true, description: "In the office rack" },
            RUNNER_EDITOR,
          ),
        ),
      );

      expect(message).toContain('Runner "office-runner" holds SSH credentials');
      expect(locks.eventsOf("lock")).toHaveLength(1);
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });
  });

  describe("postsAiCommandsAsStored", () => {
    const on: Runner = runner(OFFICE_RUNNER, "office-runner", true);
    const off: Runner = runner(LAB_RUNNER, "lab-runner", false);

    it("is true when every Runner written has it on and the save writes something else", () => {
      expect(
        RunnerServiceClass.postsAiCommandsAsStored(
          { canRunAiCommands: true, description: "x" },
          [on],
        ),
      ).toBe(true);
    });

    it("is false when one Runner written has it off: the save turns it on", () => {
      expect(
        RunnerServiceClass.postsAiCommandsAsStored(
          { canRunAiCommands: true, description: "x" },
          [on, off],
        ),
      ).toBe(false);
    });

    it("is false when the save writes nothing but the switch", () => {
      expect(
        RunnerServiceClass.postsAiCommandsAsStored({ canRunAiCommands: true }, [
          on,
        ]),
      ).toBe(false);
    });

    it("is false when the switch is not posted on, or no Runner is written", () => {
      expect(
        RunnerServiceClass.postsAiCommandsAsStored(
          { canRunAiCommands: false, description: "x" },
          [on],
        ),
      ).toBe(false);
      expect(
        RunnerServiceClass.postsAiCommandsAsStored({ description: "x" }, [on]),
      ).toBe(false);
      expect(
        RunnerServiceClass.postsAiCommandsAsStored(
          { canRunAiCommands: true, description: "x" },
          [],
        ),
      ).toBe(false);
    });
  });

  /*
   * A workflow's step acts as a Project Admin, who may read runbook
   * credentials, but is never lent that read: it is answered like any
   * editor who may not read them, whoever saved the workflow, and nobody is
   * looked up.
   */
  describe("a workflow's step", () => {
    function stepProps(): DatabaseCommonInteractionProps {
      return WorkflowPrincipal.getPropsWithoutPlan({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
        workflowName: "Turn on AI commands",
      });
    }

    it("is refused for a Runner holding an SSH credential, though the step acts as a Project Admin, and is told a person has to turn it on", async () => {
      const lookUp: jest.SpyInstance = jest.spyOn(
        AccessTokenService,
        "getDatabaseCommonInteractionPropsByUserAndProject",
      );

      const props: DatabaseCommonInteractionProps = stepProps();

      // The step's own permissions would let it read credentials.
      expect(
        props.userTenantAccessPermission![
          PROJECT_ID.toString()
        ]!.permissions.map((permission: UserPermission): Permission => {
          return permission.permission;
        }),
      ).toContain(Permission.ProjectAdmin);

      const message: string = await refusal(
        hooks.onBeforeUpdate(update({ canRunAiCommands: true }, props)),
      );

      expect(message).toContain('Runner "office-runner" holds SSH credentials');
      expect(message).toContain(
        "Workflow steps never have this permission, so a person who has it has to make this change.",
      );
      expect(message).not.toContain("saved");
      expect(lookUp).not.toHaveBeenCalled();
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });

    it("is let through for a Runner holding no SSH credential, under the lock like any editor who may not read credentials", async () => {
      credentials = [];

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update({ canRunAiCommands: true }, stepProps()),
      );

      expect(onUpdate.updateBy.data).toEqual({ canRunAiCommands: true });
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(true);

      await hooks.onUpdateSuccess(onUpdate, [new ObjectID(OFFICE_RUNNER)]);
      expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    });

    it("leaves the switch out of a save that posts it as stored, with no lock", async () => {
      runners = [runner(OFFICE_RUNNER, "office-runner", true)];

      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update(
          { canRunAiCommands: true, description: "In the office rack" },
          stepProps(),
        ),
      );

      expect(onUpdate.updateBy.data).toEqual({
        description: "In the office rack",
      });
      expect(locks.events).toEqual([]);
    });
  });
});
