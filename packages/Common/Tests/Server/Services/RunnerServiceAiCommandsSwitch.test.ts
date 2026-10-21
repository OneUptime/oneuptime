import RunnerService from "../../../Server/Services/RunnerService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  stubGenericReferenceCheck,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import fs from "fs";
import path from "path";

/*
 * TURNING ON "RUNS AI REMEDIATION COMMANDS" ASKS NOTHING OF RUNBOOK
 * CREDENTIALS ANY MORE.
 *
 * It used to. An SSH command OneUptime AI composed ran with an SSH runbook
 * credential assigned to its Runner, so letting a Runner that held one take
 * OneUptime AI's commands took the read of runbook credentials, under a
 * project lock (AiCommandCredentialReach). Runbook credentials are gone
 * (Runbooks > Runners > AI Access, removed), and OneUptime AI composes only
 * Bash commands for a Runner - a host or a Kubernetes cluster is fixed
 * through its own AI agent. So:
 *
 * - an editor of Runners turns the switch on, and the update goes through
 *   as posted: no credential is looked up and no lock is taken;
 * - turning it off, or a save that leaves it as stored, is just as plain;
 * - a global Runner is still refused the switch: AI commands act in one
 *   project's own systems (RunnerServiceGlobalRunner.test.ts pins why).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "ce000000-0000-4000-8000-000000000001",
);
const OFFICE_RUNNER: string = "ce000000-0000-4000-8000-000000000011";

interface RunnerHookAccess {
  onBeforeUpdate(updateBy: UpdateBy<Runner>): Promise<OnUpdate<Runner>>;
}

const hooks: RunnerHookAccess = RunnerService as unknown as RunnerHookAccess;

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

// May edit Runners, and nothing else.
const RUNNER_EDITOR: DatabaseCommonInteractionProps = caller([
  Permission.ReadRunner,
  Permission.EditRunner,
]);

function runner(data: {
  canRunAiCommands: boolean;
  isGlobalRunner?: boolean;
}): Runner {
  return {
    _id: OFFICE_RUNNER,
    id: new ObjectID(OFFICE_RUNNER),
    projectId: data.isGlobalRunner ? undefined : PROJECT_ID,
    name: "office-runner",
    canRunAiCommands: data.canRunAiCommands,
    isGlobalRunner: data.isGlobalRunner === true,
    hostInfo: {},
  } as unknown as Runner;
}

function update(
  data: JSONObject,
  props: DatabaseCommonInteractionProps,
): UpdateBy<Runner> {
  return {
    query: { _id: OFFICE_RUNNER },
    data: data as unknown as Runner,
    skip: 0,
    limit: 1,
    props: props,
  } as unknown as UpdateBy<Runner>;
}

describe('RunnerService - "Runs AI Remediation Commands" without runbook credentials', () => {
  let stored: Array<Runner>;
  let locks: InMemoryLocks;

  beforeEach(() => {
    stubProjectDirectory({});
    stubGenericReferenceCheck();

    locks = new InMemoryLocks();
    locks.install();

    stored = [runner({ canRunAiCommands: false })];
    jest
      .spyOn(RunnerService, "findBy")
      .mockImplementation(async (): Promise<Array<Runner>> => {
        return stored;
      });
    stubRowsCallerMayWrite(RunnerService, () => {
      return stored;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lets an editor of Runners turn it on, writing it as posted, with no lock taken", async () => {
    const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
      update({ canRunAiCommands: true }, RUNNER_EDITOR),
    );

    expect(
      (onUpdate.updateBy.data as unknown as JSONObject)["canRunAiCommands"],
    ).toBe(true);
    expect(onUpdate.carryForward).toBeNull();
    expect(locks.events).toEqual([]);
  });

  it("lets a save that posts it as stored, with other fields, through as posted", async () => {
    stored = [runner({ canRunAiCommands: true })];

    const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
      update(
        { canRunAiCommands: true, description: "the office rack" },
        RUNNER_EDITOR,
      ),
    );

    expect(onUpdate.updateBy.data as unknown as JSONObject).toEqual({
      canRunAiCommands: true,
      description: "the office rack",
    });
    expect(locks.events).toEqual([]);
  });

  it("lets it be turned off, and asks nothing for a save that leaves it out", async () => {
    stored = [runner({ canRunAiCommands: true })];

    for (const data of [
      { canRunAiCommands: false },
      { description: "the office rack" },
    ] as Array<JSONObject>) {
      const onUpdate: OnUpdate<Runner> = await hooks.onBeforeUpdate(
        update(data, RUNNER_EDITOR),
      );

      expect(onUpdate.updateBy.data as unknown as JSONObject).toEqual(data);
    }

    expect(locks.events).toEqual([]);
  });

  it("still refuses it on a global Runner", async () => {
    stored = [runner({ canRunAiCommands: false, isGlobalRunner: true })];

    await expect(
      hooks.onBeforeUpdate(update({ canRunAiCommands: true }, RUNNER_EDITOR)),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * The credential lock's hooks are gone from the service, with the module
   * that held the lock: a Runner update is written by DatabaseService's own
   * update path, with nothing held across it.
   */
  it("keeps no lock across the update: the credential lock's hooks and module are gone", () => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../../Server/Services/RunnerService.ts"),
      "utf8",
    );

    for (const gone of [
      "onUpdatePermitted",
      "onUpdateSuccess",
      "onUpdateError",
      "AiCommandCredentialReach",
      "RunbookCredential",
    ]) {
      expect({ gone, found: source.includes(gone) }).toEqual({
        gone,
        found: false,
      });
    }

    expect(
      fs.existsSync(
        path.resolve(
          __dirname,
          "../../../Server/Utils/AutoRemediation/AiCommandCredentialReach.ts",
        ),
      ),
    ).toBe(false);
  });
});
