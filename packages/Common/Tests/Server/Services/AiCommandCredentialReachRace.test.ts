import Semaphore from "../../../Server/Infrastructure/Semaphore";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
import { getJestSpyOn } from "../../Spy";

/*
 * AN SSH CREDENTIAL ASSIGNED AND A RUNNER'S SWITCH TURNED ON AT THE SAME
 * MOMENT CANNOT BOTH PASS ON WHAT EACH READ BEFORE THE OTHER.
 *
 * Turning on "Runs AI Remediation Commands" is checked against the Runner's
 * SSH credentials (RunnerService), and assigning an SSH credential to a
 * Runner against the Runner's switch (RunbookCredentialService). Each reads
 * what the other writes, so two such writes at once could each read the
 * other's side before it is written. Both hold their project's lock
 * (AiCommandCredentialReach) from before their check reads until they are
 * written, so the second waits and reads what the first wrote.
 *
 * These run the two services' real hooks against one Runner and its
 * credentials held in memory - "written" when a hook passes, the way the
 * update and create paths write them between onUpdatePermitted /
 * onCreatePermitted and the success hooks - with the lock held in memory as
 * Valkey holds it (InMemoryLocks): a write that asks for the held lock waits.
 * Each check is paused while it reads, so the other write starts in the
 * middle of it. A last case takes the lock away to show both would pass
 * without it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "cf000000-0000-4000-8000-000000000001",
);
const RUNNER_ID: string = "cf000000-0000-4000-8000-000000000011";
const LOCK_NAMESPACE: string = "AiCommandCredentialReach";
const LOCK_KEY: string = PROJECT_ID.toString().toLowerCase();

const PRIVATE_KEY: string =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n-----END OPENSSH PRIVATE KEY-----";

interface RunnerHookAccess {
  onBeforeUpdate(updateBy: UpdateBy<Runner>): Promise<OnUpdate<Runner>>;
  onUpdatePermitted(updateBy: UpdateBy<Runner>): Promise<void>;
  onUpdateSuccess(
    onUpdate: OnUpdate<Runner>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Runner>>;
}

interface CredentialHookAccess {
  onBeforeCreate(
    createBy: CreateBy<RunbookCredential>,
  ): Promise<OnCreate<RunbookCredential>>;
  onCreatePermitted(onCreate: OnCreate<RunbookCredential>): Promise<void>;
  onCreateSuccess(
    onCreate: OnCreate<RunbookCredential>,
    createdItem: RunbookCredential,
  ): Promise<RunbookCredential>;
}

const runnerHooks: RunnerHookAccess =
  RunnerService as unknown as RunnerHookAccess;
const credentialHooks: CredentialHookAccess =
  RunbookCredentialService as unknown as CredentialHookAccess;

function caller(permissions: Array<Permission>): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
            };
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

// May turn the switch on; may not read credentials.
const RUNNER_EDITOR: DatabaseCommonInteractionProps = caller([
  Permission.ReadRunner,
  Permission.EditRunner,
]);

// May create credentials with Runners; may not read credentials.
const CREDENTIAL_WRITER: DatabaseCommonInteractionProps = caller([
  Permission.CreateRunbookCredential,
]);

// May do either, and may read credentials.
const ADMIN: DatabaseCommonInteractionProps = caller([Permission.ProjectAdmin]);

// A promise the test resolves when it lets a paused read go on.
interface Gate {
  reached: Promise<void>;
  open: () => void;
  wait: () => Promise<void>;
}

function gate(): Gate {
  let reach: () => void = (): void => {
    return undefined;
  };
  let open: () => void = (): void => {
    return undefined;
  };

  const reached: Promise<void> = new Promise<void>((resolve: () => void) => {
    reach = resolve;
  });
  const opened: Promise<void> = new Promise<void>((resolve: () => void) => {
    open = resolve;
  });

  return {
    reached: reached,
    open: open,
    wait: async (): Promise<void> => {
      reach();
      await opened;
    },
  };
}

// Resolves once a write waits for the lock.
function lockWaited(locks: InMemoryLocks): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    locks.onWait = (): void => {
      resolve();
    };
  });
}

function sshCredential(
  props: DatabaseCommonInteractionProps,
): CreateBy<RunbookCredential> {
  const model: RunbookCredential = new RunbookCredential();
  model.name = "web-hosts";
  model.credentialType = RunbookCredentialType.SSH;
  model.sshHostname = "10.0.4.21";
  model.sshUsername = "deploy";
  model.sshPrivateKey = PRIVATE_KEY;
  model.runners = [{ _id: RUNNER_ID } as unknown as Runner];

  return { data: model, props: props } as CreateBy<RunbookCredential>;
}

function switchOn(props: DatabaseCommonInteractionProps): UpdateBy<Runner> {
  return {
    query: { _id: RUNNER_ID },
    data: { canRunAiCommands: true } as unknown as Runner,
    skip: 0,
    limit: 1,
    props: props,
  } as unknown as UpdateBy<Runner>;
}

describe("an SSH credential assigned while the Runner's switch is turned on", () => {
  let locks: InMemoryLocks;

  // The Runner and its credentials, as written so far.
  let runnerOn: boolean;
  let sshCredentialsOfRunner: number;

  // Pauses the next read of each side's check, when set.
  let credentialReadGate: Gate | null;
  let runnerReadGate: Gate | null;

  beforeEach(() => {
    stubProjectDirectory({});
    stubGenericReferenceCheck();

    locks = new InMemoryLocks();
    locks.install();

    runnerOn = false;
    sshCredentialsOfRunner = 0;
    credentialReadGate = null;
    runnerReadGate = null;

    const runnerRow: () => Runner = (): Runner => {
      return {
        _id: RUNNER_ID,
        id: new ObjectID(RUNNER_ID),
        projectId: PROJECT_ID,
        name: "office-runner",
        hostInfo: {},
        canRunAiCommands: runnerOn,
      } as unknown as Runner;
    };

    stubRowsCallerMayWrite(RunnerService, () => {
      return [runnerRow()];
    });

    jest
      .spyOn(RunnerService, "findBy")
      .mockImplementation(
        async (findBy: FindBy<Runner>): Promise<Array<Runner>> => {
          const query: JSONObject = findBy.query as unknown as JSONObject;

          // The credential's check: which named Runners run AI commands.
          if (query["canRunAiCommands"] === true) {
            // Read now; the check goes on with it when the gate opens.
            const read: Array<Runner> = runnerOn ? [runnerRow()] : [];
            const paused: Gate | null = runnerReadGate;
            runnerReadGate = null;

            if (paused) {
              await paused.wait();
            }

            return read;
          }

          return [runnerRow()];
        },
      );

    // The switch's check: the Runner's SSH credentials.
    jest
      .spyOn(
        ProjectScopedReferenceValidator.getLookupService(RunbookCredential),
        "findBy",
      )
      .mockImplementation(async (): Promise<Array<RunbookCredential>> => {
        // Read now; the check goes on with it when the gate opens.
        const read: Array<RunbookCredential> = Array.from({
          length: sshCredentialsOfRunner,
        }).map((): RunbookCredential => {
          return {
            _id: ObjectID.generate().toString(),
            runners: [{ _id: RUNNER_ID } as unknown as Runner],
          } as unknown as RunbookCredential;
        });
        const paused: Gate | null = credentialReadGate;
        credentialReadGate = null;

        if (paused) {
          await paused.wait();
        }

        return read;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The Runner's switch, through its hooks, written when they pass.
  async function turnOnSwitch(
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    const onUpdate: OnUpdate<Runner> = await runnerHooks.onBeforeUpdate(
      switchOn(props),
    );
    await runnerHooks.onUpdatePermitted(onUpdate.updateBy);
    runnerOn = true;
    await runnerHooks.onUpdateSuccess(onUpdate, [new ObjectID(RUNNER_ID)]);
  }

  // An SSH credential created with the Runner, saved when its hooks pass.
  async function assignCredential(
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    const onCreate: OnCreate<RunbookCredential> =
      await credentialHooks.onBeforeCreate(sshCredential(props));
    await credentialHooks.onCreatePermitted(onCreate);
    sshCredentialsOfRunner += 1;
    await credentialHooks.onCreateSuccess(onCreate, onCreate.createBy.data);
  }

  it("the switch first: the credential waits, reads the switch on and is refused", async () => {
    credentialReadGate = gate();
    const switchReading: Promise<void> = credentialReadGate.reached;
    const switchGate: Gate = credentialReadGate;

    const switched: Promise<void> = turnOnSwitch(RUNNER_EDITOR);
    await switchReading;

    // The switch holds the lock while it reads; the credential waits for it.
    expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(true);
    const waited: Promise<void> = lockWaited(locks);
    const assigned: Promise<void> = assignCredential(CREDENTIAL_WRITER);
    await waited;
    expect(locks.waitingFor(LOCK_KEY, LOCK_NAMESPACE)).toBe(1);

    // The switch reads no credential, passes and is written.
    switchGate.open();
    await expect(switched).resolves.toBeUndefined();

    await expect(assigned).rejects.toThrow(NotAuthorizedException);
    await expect(assigned).rejects.toThrow('Runner "office-runner"');

    expect(runnerOn).toBe(true);
    expect(sshCredentialsOfRunner).toBe(0);
    expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
    expect(locks.events).toEqual([
      `lock:${LOCK_NAMESPACE}/${LOCK_KEY}`,
      `wait:${LOCK_NAMESPACE}/${LOCK_KEY}`,
      `keep:${LOCK_NAMESPACE}/${LOCK_KEY}`,
      `release:${LOCK_NAMESPACE}/${LOCK_KEY}`,
      `lock:${LOCK_NAMESPACE}/${LOCK_KEY}`,
      `release:${LOCK_NAMESPACE}/${LOCK_KEY}`,
    ]);
  });

  it("the credential first: the switch waits, reads the credential and is refused", async () => {
    runnerReadGate = gate();
    const credentialReading: Promise<void> = runnerReadGate.reached;
    const credentialGate: Gate = runnerReadGate;

    const assigned: Promise<void> = assignCredential(CREDENTIAL_WRITER);
    await credentialReading;

    expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(true);
    const waited: Promise<void> = lockWaited(locks);
    const switched: Promise<void> = turnOnSwitch(RUNNER_EDITOR);
    await waited;

    // The credential reads the switch off, passes and is saved.
    credentialGate.open();
    await expect(assigned).resolves.toBeUndefined();

    await expect(switched).rejects.toThrow(NotAuthorizedException);
    await expect(switched).rejects.toThrow(
      'Runner "office-runner" holds SSH credentials',
    );

    expect(sshCredentialsOfRunner).toBe(1);
    expect(runnerOn).toBe(false);
    expect(locks.isHeld(LOCK_KEY, LOCK_NAMESPACE)).toBe(false);
  });

  it("someone who may read credentials turns the switch on: their write holds the lock, and the credential assigned meanwhile is refused", async () => {
    const onUpdate: OnUpdate<Runner> = await runnerHooks.onBeforeUpdate(
      switchOn(ADMIN),
    );

    // Checked, not yet written: the credential waits for it.
    const waited: Promise<void> = lockWaited(locks);
    const assigned: Promise<void> = assignCredential(CREDENTIAL_WRITER);
    await waited;

    await runnerHooks.onUpdatePermitted(onUpdate.updateBy);
    runnerOn = true;
    await runnerHooks.onUpdateSuccess(onUpdate, [new ObjectID(RUNNER_ID)]);

    await expect(assigned).rejects.toThrow(NotAuthorizedException);
    expect(sshCredentialsOfRunner).toBe(0);
  });

  it("someone who may read credentials assigns one: their write holds the lock, and the switch turned on meanwhile is refused", async () => {
    const onCreate: OnCreate<RunbookCredential> =
      await credentialHooks.onBeforeCreate(sshCredential(ADMIN));

    const waited: Promise<void> = lockWaited(locks);
    const switched: Promise<void> = turnOnSwitch(RUNNER_EDITOR);
    await waited;

    await credentialHooks.onCreatePermitted(onCreate);
    sshCredentialsOfRunner += 1;
    await credentialHooks.onCreateSuccess(onCreate, onCreate.createBy.data);

    await expect(switched).rejects.toThrow(NotAuthorizedException);
    expect(runnerOn).toBe(false);
  });

  it("two writes by people who may read credentials both pass, one after the other", async () => {
    const onCreate: OnCreate<RunbookCredential> =
      await credentialHooks.onBeforeCreate(sshCredential(ADMIN));

    const waited: Promise<void> = lockWaited(locks);
    const switched: Promise<void> = turnOnSwitch(ADMIN);
    await waited;

    await credentialHooks.onCreatePermitted(onCreate);
    sshCredentialsOfRunner += 1;
    await credentialHooks.onCreateSuccess(onCreate, onCreate.createBy.data);

    await expect(switched).resolves.toBeUndefined();
    expect(runnerOn).toBe(true);
    expect(sshCredentialsOfRunner).toBe(1);
  });

  it("without the lock both would pass, each on what it read before the other was written", async () => {
    // Every write gets a lock of its own at once, as if there were none.
    getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
      key: string;
      namespace: string;
    }): Promise<unknown> => {
      return { key: data.key, namespace: data.namespace };
    }) as never);
    getJestSpyOn(Semaphore, "keepLock").mockResolvedValue(true as never);
    getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined as never);

    credentialReadGate = gate();
    const switchReading: Promise<void> = credentialReadGate.reached;
    const switchGate: Gate = credentialReadGate;

    const switched: Promise<void> = turnOnSwitch(RUNNER_EDITOR);
    await switchReading;

    // The credential reads the switch still off and is saved.
    await expect(
      assignCredential(CREDENTIAL_WRITER),
    ).resolves.toBeUndefined();

    // The switch had read no credential, and is written too.
    switchGate.open();
    await expect(switched).resolves.toBeUndefined();

    expect(runnerOn).toBe(true);
    expect(sshCredentialsOfRunner).toBe(1);
  });
});
