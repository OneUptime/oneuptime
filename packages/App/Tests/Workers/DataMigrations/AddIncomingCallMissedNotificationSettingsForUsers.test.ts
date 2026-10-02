import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import PositiveNumber from "Common/Types/PositiveNumber";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";
import AddIncomingCallMissedNotificationSettingsForUsers from "../../../FeatureSet/Workers/DataMigrations/AddIncomingCallMissedNotificationSettingsForUsers";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AddIncomingCallMissedNotificationSettingsForUsers seeds the missed call
 * notification setting (email on) for everyone who was already a member when
 * the event was added, so Notification Settings shows it the way it behaves.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, and before the last slot that
 *      AddAuditLogMcpClientColumns claims for itself;
 *   2. the walk: every project, its accepted members only, once per (user,
 *      project), through the service's idempotent helper;
 *   3. one project's or one member's failure is logged and the rest continue;
 *   4. end to end with the real helper: rows are written with email on, and a
 *      row a member already has - switched off, say - is left alone.
 */

const PROJECT_1: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_2: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_A: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const USER_B: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

const MIGRATION_NAME: string =
  "AddIncomingCallMissedNotificationSettingsForUsers";

const MISSED_CALL: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION;

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

function project(id: ObjectID): JSONObject {
  return { _id: id.toString(), id } as unknown as JSONObject;
}

function member(userId: ObjectID | undefined): JSONObject {
  return { userId } as unknown as JSONObject;
}

describe("AddIncomingCallMissedNotificationSettingsForUsers", () => {
  const migration: AddIncomingCallMissedNotificationSettingsForUsers =
    new AddIncomingCallMissedNotificationSettingsForUsers();

  let projects: Array<JSONObject>;
  let membersByProject: Map<string, Array<JSONObject>>;
  let membersError: Map<string, Error>;
  let memberQueries: Array<Record<string, unknown>>;
  let addCalls: Array<{ userId: string; projectId: string }>;
  let addError: ((userId: string) => Error | null) | null;
  let errorLogs: Array<string>;

  beforeEach(() => {
    projects = [];
    membersByProject = new Map<string, Array<JSONObject>>();
    membersError = new Map<string, Error>();
    memberQueries = [];
    addCalls = [];
    addError = null;
    errorLogs = [];

    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      errorLogs.push(String(message));
      return undefined;
    });

    jest.spyOn(ProjectService, "findAllBy").mockImplementation(((): Promise<
      Array<JSONObject>
    > => {
      return Promise.resolve(projects);
    }) as never);

    jest.spyOn(TeamMemberService, "findBy").mockImplementation(((args: {
      query: Record<string, unknown> & { projectId: ObjectID };
    }): Promise<Array<JSONObject>> => {
      memberQueries.push(args.query);
      const key: string = args.query.projectId.toString();
      const failure: Error | undefined = membersError.get(key);

      if (failure) {
        return Promise.reject(failure);
      }

      return Promise.resolve(membersByProject.get(key) || []);
    }) as never);

    jest
      .spyOn(
        UserNotificationSettingService,
        "addIncomingCallNotificationSettings",
      )
      .mockImplementation(((
        userId: ObjectID,
        projectId: ObjectID,
      ): Promise<void> => {
        const failure: Error | null = addError
          ? addError(userId.toString())
          : null;

        if (failure) {
          return Promise.reject(failure);
        }

        addCalls.push({
          userId: userId.toString(),
          projectId: projectId.toString(),
        });
        return Promise.resolve();
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is named after itself, so it runs once", () => {
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("is registered once, before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const index: string = fs
      .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBe(registered.length - 2);
  });

  test("seeds the setting for every accepted member of every project", async () => {
    projects = [project(PROJECT_1), project(PROJECT_2)];
    membersByProject.set(PROJECT_1.toString(), [
      member(USER_A),
      member(USER_B),
    ]);
    membersByProject.set(PROJECT_2.toString(), [member(USER_A)]);

    await migration.migrate();

    expect(addCalls).toEqual([
      { userId: USER_A.toString(), projectId: PROJECT_1.toString() },
      { userId: USER_B.toString(), projectId: PROJECT_1.toString() },
      { userId: USER_A.toString(), projectId: PROJECT_2.toString() },
    ]);
  });

  test("reads only accepted members, as root", async () => {
    projects = [project(PROJECT_1)];

    await migration.migrate();

    expect(memberQueries).toEqual([
      { projectId: PROJECT_1, hasAcceptedInvitation: true },
    ]);
    expect(TeamMemberService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({ props: { isRoot: true } }),
    );
  });

  test("a member of several teams in a project is seeded once", async () => {
    projects = [project(PROJECT_1)];
    membersByProject.set(PROJECT_1.toString(), [
      member(USER_A),
      member(USER_A),
      member(USER_B),
    ]);

    await migration.migrate();

    expect(addCalls).toEqual([
      { userId: USER_A.toString(), projectId: PROJECT_1.toString() },
      { userId: USER_B.toString(), projectId: PROJECT_1.toString() },
    ]);
  });

  test("skips rows without a user or a project", async () => {
    projects = [{} as JSONObject, project(PROJECT_1)];
    membersByProject.set(PROJECT_1.toString(), [
      member(undefined),
      member(USER_A),
    ]);

    await migration.migrate();

    expect(addCalls).toEqual([
      { userId: USER_A.toString(), projectId: PROJECT_1.toString() },
    ]);
  });

  test("a project whose members cannot be listed is logged and skipped", async () => {
    projects = [project(PROJECT_1), project(PROJECT_2)];
    membersError.set(PROJECT_1.toString(), new Error("timeout"));
    membersByProject.set(PROJECT_2.toString(), [member(USER_A)]);

    await migration.migrate();

    expect(addCalls).toEqual([
      { userId: USER_A.toString(), projectId: PROJECT_2.toString() },
    ]);
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toContain(PROJECT_1.toString());
  });

  test("one member's failure is logged and the others are still seeded", async () => {
    projects = [project(PROJECT_1)];
    membersByProject.set(PROJECT_1.toString(), [
      member(USER_A),
      member(USER_B),
    ]);
    addError = (userId: string): Error | null => {
      return userId === USER_A.toString() ? new Error("write failed") : null;
    };

    await migration.migrate();

    expect(addCalls).toEqual([
      { userId: USER_B.toString(), projectId: PROJECT_1.toString() },
    ]);
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toContain(USER_A.toString());
  });

  test("rolling back changes nothing", async () => {
    await expect(migration.rollback()).resolves.toBeUndefined();
  });
});

describe("AddIncomingCallMissedNotificationSettingsForUsers with the real helper", () => {
  interface StoredSetting {
    alertByEmail: boolean;
    alertByPush: boolean;
  }

  let rows: Map<string, StoredSetting>;

  function key(
    userId: unknown,
    projectId: unknown,
    eventType: unknown,
  ): string {
    return `${String(userId)}|${String(projectId)}|${String(eventType)}`;
  }

  beforeEach(() => {
    rows = new Map<string, StoredSetting>();

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    jest
      .spyOn(ProjectService, "findAllBy")
      .mockResolvedValue([project(PROJECT_1)] as never);

    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([member(USER_A), member(USER_B)] as never);

    jest
      .spyOn(UserNotificationSettingService, "countBy")
      .mockImplementation(((args: {
        query: { userId: ObjectID; projectId: ObjectID; eventType: string };
      }): Promise<PositiveNumber> => {
        return Promise.resolve(
          new PositiveNumber(
            rows.has(
              key(
                args.query.userId,
                args.query.projectId,
                args.query.eventType,
              ),
            )
              ? 1
              : 0,
          ),
        );
      }) as never);

    jest
      .spyOn(UserNotificationSettingService, "create")
      .mockImplementation(((args: {
        data: UserNotificationSetting;
      }): Promise<UserNotificationSetting> => {
        rows.set(
          key(args.data.userId, args.data.projectId, args.data.eventType),
          {
            alertByEmail: Boolean(args.data.alertByEmail),
            alertByPush: Boolean(args.data.alertByPush),
          },
        );
        return Promise.resolve(args.data);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes the missed call setting with email on, and leaves an existing choice alone", async () => {
    // B already switched email off for missed calls.
    rows.set(key(USER_B, PROJECT_1, MISSED_CALL), {
      alertByEmail: false,
      alertByPush: true,
    });

    await new AddIncomingCallMissedNotificationSettingsForUsers().migrate();

    expect(rows.get(key(USER_A, PROJECT_1, MISSED_CALL))).toEqual({
      alertByEmail: true,
      alertByPush: false,
    });
    expect(rows.get(key(USER_B, PROJECT_1, MISSED_CALL))).toEqual({
      alertByEmail: false,
      alertByPush: true,
    });
  });

  test("running it twice writes nothing the second time", async () => {
    await new AddIncomingCallMissedNotificationSettingsForUsers().migrate();
    const created: number = (
      UserNotificationSettingService.create as unknown as {
        mock: { calls: Array<unknown> };
      }
    ).mock.calls.length;

    await new AddIncomingCallMissedNotificationSettingsForUsers().migrate();

    expect(created).toBe(2);
    expect(
      (
        UserNotificationSettingService.create as unknown as {
          mock: { calls: Array<unknown> };
        }
      ).mock.calls.length,
    ).toBe(2);
  });
});
