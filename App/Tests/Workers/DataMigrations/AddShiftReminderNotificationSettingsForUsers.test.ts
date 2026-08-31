import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import PositiveNumber from "Common/Types/PositiveNumber";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";
import OnCallShiftReminderRunner, {
  ShiftReminderSweepStats,
} from "Common/Server/Utils/OnCall/OnCallShiftReminderRunner";
import {
  DEFAULT_POLICY,
  at,
  shift,
} from "../../../../Common/Tests/Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import {
  ReminderHarness,
  emptyHarness,
  installReminderHarness,
  scheduleInfo,
} from "../../../../Common/Tests/Server/Utils/OnCall/OnCallShiftReminderTestHarness";
import AddShiftReminderNotificationSettingsForUsers from "../../../FeatureSet/Workers/DataMigrations/AddShiftReminderNotificationSettingsForUsers";
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
 * AddShiftReminderNotificationSettingsForUsers — the upgrade half of shift
 * reminders.
 *
 * UserNotificationSettingService.sendUserNotification looks up ONE row per
 * (user, project, event type) and sends nothing without it; the defaults are
 * only written when a user joins a project. So every member who joined
 * before the two reminder events existed would configure a lead time and
 * silently never hear from it. This migration walks projects x members once
 * and writes the two rows where missing.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text — an
 *      unregistered migration is a backfill that never runs), at the END of
 *      the list and after AddOnCallNotificationForUsers, the migration it is
 *      modelled on;
 *   2. the walk: every project, every member, once per (user, project),
 *      as root, through the service's idempotent helper;
 *   3. one project's or one member's failure is logged and the rest
 *      continue;
 *   4. END TO END: a user with NO settings row before the migration is
 *      warned about by the reminder runner and, after the migration has
 *      run, receives the reminder — the real UserNotificationSettingService
 *      helper writes the row the real runner then finds.
 */

const PROJECT_1: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_2: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_A: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const USER_B: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

const MIGRATION_NAME: string = "AddShiftReminderNotificationSettingsForUsers";

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

describe("AddShiftReminderNotificationSettingsForUsers", () => {
  const migration: AddShiftReminderNotificationSettingsForUsers =
    new AddShiftReminderNotificationSettingsForUsers();

  let projects: Array<JSONObject>;
  let membersByProject: Map<string, Array<JSONObject>>;
  let membersError: Map<string, Error>;
  let addCalls: Array<{ userId: string; projectId: string }>;
  let addError: ((userId: string) => Error | null) | null;
  let errorLogs: Array<string>;

  beforeEach(() => {
    projects = [];
    membersByProject = new Map<string, Array<JSONObject>>();
    membersError = new Map<string, Error>();
    addCalls = [];
    addError = null;
    errorLogs = [];

    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      errorLogs.push(String(message));
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    jest.spyOn(ProjectService, "findAllBy").mockImplementation(((): Promise<
      Array<JSONObject>
    > => {
      return Promise.resolve(projects);
    }) as never);

    jest.spyOn(TeamMemberService, "findBy").mockImplementation(((args: {
      query: { projectId: ObjectID };
    }): Promise<Array<JSONObject>> => {
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
        "addShiftReminderNotificationSettings",
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

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    test("is the LAST migration in the list (new migrations are appended, never inserted)", () => {
      const instantiations: Array<string> = Array.from(
        indexSource.matchAll(/new\s+(\w+)\(\)/g),
      ).map((match: RegExpMatchArray) => {
        return match[1]!;
      });

      expect(instantiations.length).toBeGreaterThan(1);
      expect(instantiations[instantiations.length - 1]).toBe(MIGRATION_NAME);
    });

    test("runs after AddOnCallNotificationForUsers, the migration it is modelled on", () => {
      expect(indexSource.indexOf(`new ${MIGRATION_NAME}()`)).toBeGreaterThan(
        indexSource.indexOf("new AddOnCallNotificationForUsers()"),
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);

      const source: string = fs.readFileSync(
        path.join(DATA_MIGRATIONS_DIR, `${MIGRATION_NAME}.ts`),
        "utf8",
      );

      expect(source).toContain(`super("${MIGRATION_NAME}")`);
      expect(source).toContain(
        "UserNotificationSettingService.addShiftReminderNotificationSettings(",
      );
    });
  });

  describe("the walk", () => {
    test("lists projects as root selecting only the id, and members per project as root with the project cap", async () => {
      projects = [project(PROJECT_1)];
      membersByProject.set(PROJECT_1.toString(), [member(USER_A)]);

      await migration.migrate();

      const projectArgs: JSONObject = (
        ProjectService.findAllBy as unknown as jest.Mock
      ).mock.calls[0]![0] as JSONObject;

      expect((projectArgs["props"] as JSONObject)["isRoot"]).toBe(true);
      expect(projectArgs["select"]).toEqual({ _id: true });

      const memberArgs: JSONObject = (
        TeamMemberService.findBy as unknown as jest.Mock
      ).mock.calls[0]![0] as JSONObject;

      expect(
        (
          (memberArgs["query"] as JSONObject)["projectId"] as ObjectID
        ).toString(),
      ).toBe(PROJECT_1.toString());
      expect((memberArgs["props"] as JSONObject)["isRoot"]).toBe(true);
      expect(memberArgs["limit"]).toBe(LIMIT_PER_PROJECT);
      expect(memberArgs["skip"]).toBe(0);
      expect((memberArgs["select"] as JSONObject)["userId"]).toBe(true);
    });

    test("calls the idempotent helper once per (user, project)", async () => {
      projects = [project(PROJECT_1), project(PROJECT_2)];
      // Alice is in two teams of project 1 (two TeamMember rows) and in project 2.
      membersByProject.set(PROJECT_1.toString(), [
        member(USER_A),
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

    test("skips member rows without a user and projects without an id", async () => {
      projects = [
        project(PROJECT_1),
        { _id: undefined, id: null } as unknown as JSONObject,
      ];
      membersByProject.set(PROJECT_1.toString(), [
        member(undefined),
        member(USER_A),
      ]);

      await migration.migrate();

      expect(addCalls).toEqual([
        { userId: USER_A.toString(), projectId: PROJECT_1.toString() },
      ]);
      expect(TeamMemberService.findBy).toHaveBeenCalledTimes(1);
    });

    test("a project whose members cannot be listed is logged and the next project continues", async () => {
      projects = [project(PROJECT_1), project(PROJECT_2)];
      membersError.set(PROJECT_1.toString(), new Error("connection reset"));
      membersByProject.set(PROJECT_2.toString(), [member(USER_B)]);

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(addCalls).toEqual([
        { userId: USER_B.toString(), projectId: PROJECT_2.toString() },
      ]);
      expect(
        errorLogs.some((line: string) => {
          return (
            line.includes(MIGRATION_NAME) &&
            line.includes(PROJECT_1.toString()) &&
            line.includes("connection reset")
          );
        }),
      ).toBe(true);
    });

    test("one member's failure is logged and the next member continues", async () => {
      projects = [project(PROJECT_1)];
      membersByProject.set(PROJECT_1.toString(), [
        member(USER_A),
        member(USER_B),
      ]);
      addError = (userId: string): Error | null => {
        return userId === USER_A.toString() ? new Error("boom") : null;
      };

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(addCalls).toEqual([
        { userId: USER_B.toString(), projectId: PROJECT_1.toString() },
      ]);
      expect(
        errorLogs.some((line: string) => {
          return line.includes(USER_A.toString()) && line.includes("boom");
        }),
      ).toBe(true);
    });

    test("with no projects it does nothing", async () => {
      await migration.migrate();

      expect(TeamMemberService.findBy).not.toHaveBeenCalled();
      expect(addCalls).toEqual([]);
    });

    test("running it twice issues the same idempotent calls (the service makes the second run a no-op)", async () => {
      projects = [project(PROJECT_1)];
      membersByProject.set(PROJECT_1.toString(), [member(USER_A)]);

      await migration.migrate();
      await migration.migrate();

      expect(addCalls).toHaveLength(2);
      expect(addCalls[0]).toEqual(addCalls[1]);
    });

    test("rollback is a no-op", async () => {
      await expect(migration.rollback()).resolves.toBeUndefined();
    });
  });

  describe("end to end: a user without a settings row gets the reminder after the migration", () => {
    const SCHEDULE: string = "schedule-1";
    const NOW: Date = at("2026-09-03T15:00:00Z");
    const SHIFT_START: Date = at("2026-09-03T16:00:00Z");
    const SHIFT_END: Date = at("2026-09-04T16:00:00Z");

    interface StoredSetting {
      userId: string;
      projectId: string;
      eventType: string;
      alertByEmail: boolean;
      alertByPush: boolean;
    }

    let harness: ReminderHarness;
    let store: Map<string, StoredSetting>;

    function settingKey(data: {
      userId: unknown;
      projectId: unknown;
      eventType: unknown;
    }): string {
      return `${String(data.userId)}|${String(data.projectId)}|${String(
        data.eventType,
      )}`;
    }

    beforeEach(() => {
      jest.restoreAllMocks();

      // The real helper, over an in-memory UserNotificationSetting table.
      store = new Map<string, StoredSetting>();

      harness = emptyHarness();
      harness.users = [
        {
          userId: USER_A.toString(),
          userName: "Alice Andersson",
          timezone: "Europe/Berlin",
        },
      ];
      harness.schedules.set(
        SCHEDULE,
        scheduleInfo({
          scheduleId: SCHEDULE,
          projectId: PROJECT_1.toString(),
          scheduleTimezone: "Europe/Stockholm",
          attachedPolicies: [{ ...DEFAULT_POLICY }],
        }),
      );
      harness.reminders = [
        { projectId: PROJECT_1, userId: USER_A, minutesBeforeShift: 60 },
      ];
      harness.shifts = [
        shift({
          scheduleId: SCHEDULE,
          projectId: PROJECT_1.toString(),
          userId: USER_A.toString(),
          userName: "Alice Andersson",
          start: SHIFT_START,
          end: SHIFT_END,
          scheduleTimezone: "Europe/Stockholm",
        }),
      ];

      installReminderHarness(harness);
      OnCallShiftReminderRunner.resetMissingSettingsWarnings();

      // The settings table the runner reads and the migration writes.
      jest
        .spyOn(UserNotificationSettingService, "findOneBy")
        .mockImplementation(((args: {
          query: JSONObject;
        }): Promise<JSONObject | null> => {
          return Promise.resolve(
            store.has(settingKey(args.query as never))
              ? ({ _id: "setting" } as JSONObject)
              : null,
          );
        }) as never);
      jest
        .spyOn(UserNotificationSettingService, "countBy")
        .mockImplementation(((args: {
          query: JSONObject;
        }): Promise<PositiveNumber> => {
          return Promise.resolve(
            new PositiveNumber(
              store.has(settingKey(args.query as never)) ? 1 : 0,
            ),
          );
        }) as never);
      jest
        .spyOn(UserNotificationSettingService, "create")
        .mockImplementation(((args: {
          data: UserNotificationSetting;
        }): Promise<UserNotificationSetting> => {
          const item: UserNotificationSetting = args.data;
          const stored: StoredSetting = {
            userId: String(item.userId),
            projectId: String(item.projectId),
            eventType: String(item.eventType),
            alertByEmail: Boolean(item.alertByEmail),
            alertByPush: Boolean(item.alertByPush),
          };
          store.set(settingKey(stored), stored);
          return Promise.resolve(item);
        }) as never);

      // The migration's own reads.
      jest.spyOn(ProjectService, "findAllBy").mockImplementation(((): Promise<
        Array<JSONObject>
      > => {
        return Promise.resolve([project(PROJECT_1)]);
      }) as never);
      jest.spyOn(TeamMemberService, "findBy").mockImplementation(((): Promise<
        Array<JSONObject>
      > => {
        return Promise.resolve([member(USER_A)]);
      }) as never);
    });

    test("before: the runner warns and counts the missing row; after: the row exists and the reminder is delivered", async () => {
      /*
       * Before the migration: no row, loud warning, the settings service is
       * still asked (it decides to send nothing without a row).
       */
      const before: ShiftReminderSweepStats =
        await OnCallShiftReminderRunner.runSweep({ now: NOW });

      expect(before.missingSettings).toBe(1);
      expect(
        harness.warnings.some((line: string) => {
          return (
            line.includes("has no UserNotificationSetting row") &&
            line.includes(MIGRATION_NAME)
          );
        }),
      ).toBe(true);

      // The migration runs (idempotently, twice).
      await migration.migrate();
      await migration.migrate();

      expect(store.size).toBe(2);
      expect(
        store.get(
          settingKey({
            userId: USER_A,
            projectId: PROJECT_1,
            eventType:
              NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
          }),
        ),
      ).toMatchObject({ alertByEmail: true, alertByPush: true });
      expect(
        store.get(
          settingKey({
            userId: USER_A,
            projectId: PROJECT_1,
            eventType:
              NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
          }),
        ),
      ).toMatchObject({ alertByEmail: true, alertByPush: true });

      // The next reminder for this user finds the row: no warning, delivered.
      harness.ledger = [];
      harness.cache.clear();
      harness.warnings = [];
      harness.sent = [];
      OnCallShiftReminderRunner.resetMissingSettingsWarnings();

      const after: ShiftReminderSweepStats =
        await OnCallShiftReminderRunner.runSweep({ now: NOW });

      expect(after.missingSettings).toBe(0);
      expect(after.sent).toBe(1);
      expect(harness.sent).toHaveLength(1);
      expect(harness.sent[0]!.userId).toBe(USER_A.toString());
      expect(harness.sent[0]!.eventType).toBe(
        NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
      );
      expect(
        harness.warnings.some((line: string) => {
          return line.includes("has no UserNotificationSetting row");
        }),
      ).toBe(false);
    });
  });
});
