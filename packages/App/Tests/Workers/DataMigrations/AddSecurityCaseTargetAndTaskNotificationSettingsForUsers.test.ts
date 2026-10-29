import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import PositiveNumber from "Common/Types/PositiveNumber";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";
import AddSecurityCaseTargetAndTaskNotificationSettingsForUsers from "../../../FeatureSet/Workers/DataMigrations/AddSecurityCaseTargetAndTaskNotificationSettingsForUsers";
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
 * AddSecurityCaseTargetAndTaskNotificationSettingsForUsers seeds the two
 * security case notification settings that came with response targets and
 * case tasks - a case I am on about to miss, or missing, a response target;
 * a task on a case assigned to me - for everyone who was already a member,
 * whom AddSecurityCaseNotificationSettingsForUsers seeded before the events
 * existed. Notification Settings then shows them as they behave: on.
 *
 * Pinned here:
 *   1. it carries its own name and is registered once, after the earlier
 *      security case backfill and before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it walks every project's accepted members, once each, and a failure
 *      is logged under its own name while the rest continue;
 *   3. end to end with the real helper: a member with the three older
 *      settings - one of them switched off - gets the two new ones with email
 *      and push on, and nothing they had changes; running it again writes
 *      nothing.
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
  "AddSecurityCaseTargetAndTaskNotificationSettingsForUsers";

const OLDER_EVENTS: Array<NotificationSettingEventType> = [
  NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
  NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
  NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
];

const NEW_EVENTS: Array<NotificationSettingEventType> = [
  NotificationSettingEventType.SEND_SECURITY_CASE_TARGET_NOTIFICATION,
  NotificationSettingEventType.SEND_SECURITY_CASE_TASK_ASSIGNED_NOTIFICATION,
];

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

function project(id: ObjectID): JSONObject {
  return { _id: id.toString(), id } as unknown as JSONObject;
}

function member(userId: ObjectID): JSONObject {
  return { userId } as unknown as JSONObject;
}

function registeredMigrations(): Array<string> {
  const index: string = fs
    .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  expect(index).toContain(
    `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
  );

  return Array.from(index.matchAll(/new ([A-Za-z0-9]+)\(\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddSecurityCaseTargetAndTaskNotificationSettingsForUsers", () => {
  const migration: AddSecurityCaseTargetAndTaskNotificationSettingsForUsers =
    new AddSecurityCaseTargetAndTaskNotificationSettingsForUsers();

  test("is named after itself, so it runs once - apart from the earlier backfill", () => {
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("is registered once, after the earlier security case backfill and before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("AddSecurityCaseNotificationSettingsForUsers"),
    );
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });

  test("walks every project's accepted members once each; a failure is logged under its name and the rest continue", async () => {
    const calls: Array<string> = [];
    const errors: Array<string> = [];

    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      errors.push(String(message));
    });
    jest
      .spyOn(ProjectService, "findAllBy")
      .mockResolvedValue([project(PROJECT_1), project(PROJECT_2)] as never);
    jest.spyOn(TeamMemberService, "findBy").mockImplementation(((args: {
      query: { projectId: ObjectID; hasAcceptedInvitation: boolean };
    }): Promise<Array<JSONObject>> => {
      expect(args.query.hasAcceptedInvitation).toBe(true);

      return Promise.resolve(
        args.query.projectId.toString() === PROJECT_1.toString()
          ? [member(USER_A), member(USER_A), member(USER_B)]
          : [member(USER_A)],
      );
    }) as never);
    jest
      .spyOn(
        UserNotificationSettingService,
        "addSecurityCaseNotificationSettings",
      )
      .mockImplementation(((
        userId: ObjectID,
        projectId: ObjectID,
      ): Promise<void> => {
        if (
          userId.toString() === USER_B.toString() &&
          projectId.toString() === PROJECT_1.toString()
        ) {
          return Promise.reject(new Error("write failed"));
        }

        calls.push(`${userId.toString()}|${projectId.toString()}`);
        return Promise.resolve();
      }) as never);

    await migration.migrate();

    expect(calls).toEqual([
      `${USER_A.toString()}|${PROJECT_1.toString()}`,
      `${USER_A.toString()}|${PROJECT_2.toString()}`,
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(MIGRATION_NAME);
    expect(errors[0]).toContain(USER_B.toString());
  });

  test("rolling back changes nothing", async () => {
    await expect(migration.rollback()).resolves.toBeUndefined();
  });
});

describe("AddSecurityCaseTargetAndTaskNotificationSettingsForUsers with the real helper", () => {
  interface StoredSetting {
    alertByEmail: boolean;
    alertByPush: boolean;
  }

  let rows: Map<string, StoredSetting>;
  let creates: number;

  function key(
    userId: unknown,
    projectId: unknown,
    eventType: unknown,
  ): string {
    return `${String(userId)}|${String(projectId)}|${String(eventType)}`;
  }

  beforeEach(() => {
    rows = new Map<string, StoredSetting>();
    creates = 0;

    // A, a member from before: the three older settings, the approval one off.
    for (const eventType of OLDER_EVENTS) {
      rows.set(key(USER_A, PROJECT_1, eventType), {
        alertByEmail:
          eventType !==
          NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
        alertByPush:
          eventType !==
          NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
      });
    }

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(ProjectService, "findAllBy")
      .mockResolvedValue([project(PROJECT_1)] as never);
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([member(USER_A)] as never);
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
        creates++;
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

  test("a member from before gets the two new settings, email and push on, and keeps the rest as they were", async () => {
    await new AddSecurityCaseTargetAndTaskNotificationSettingsForUsers().migrate();

    expect(creates).toBe(2);

    for (const eventType of NEW_EVENTS) {
      expect(rows.get(key(USER_A, PROJECT_1, eventType))).toEqual({
        alertByEmail: true,
        alertByPush: true,
      });
    }

    expect(
      rows.get(
        key(
          USER_A,
          PROJECT_1,
          NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
        ),
      ),
    ).toEqual({ alertByEmail: false, alertByPush: false });
  });

  test("running it twice writes nothing the second time", async () => {
    await new AddSecurityCaseTargetAndTaskNotificationSettingsForUsers().migrate();
    await new AddSecurityCaseTargetAndTaskNotificationSettingsForUsers().migrate();

    expect(creates).toBe(2);
  });
});
