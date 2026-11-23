import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import PositiveNumber from "Common/Types/PositiveNumber";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService, {
  SECURITY_CASE_NOTIFICATION_EVENT_TYPES,
} from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";
import AddSecurityCaseAiHandOffNotificationSettingsForUsers from "../../../FeatureSet/Workers/DataMigrations/AddSecurityCaseAiHandOffNotificationSettingsForUsers";
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
 * AddSecurityCaseAiHandOffNotificationSettingsForUsers seeds the security
 * case notification setting that came with OneUptime AI working cases end
 * to end (#10352) - OneUptime AI hands a case I am on to people - for every
 * member from before it, so Notification Settings shows it as it behaves:
 * on. Pinned here: its name and its one registration, before the two slots
 * kept last, and end to end with the real helper - a member with the older
 * settings, one of them switched off, gets the new one with email and push
 * on, nothing they had changes, and running it again writes nothing.
 */

const PROJECT_1: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_A: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const MIGRATION_NAME: string =
  "AddSecurityCaseAiHandOffNotificationSettingsForUsers";
const NEW_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_SECURITY_CASE_AI_HANDED_OFF_NOTIFICATION;

interface StoredSetting {
  alertByEmail: boolean;
  alertByPush: boolean;
}

let rows: Map<string, StoredSetting>;
let creates: number;

function key(userId: unknown, projectId: unknown, eventType: unknown): string {
  return `${String(userId)}|${String(projectId)}|${String(eventType)}`;
}

beforeEach(() => {
  rows = new Map<string, StoredSetting>();
  creates = 0;

  // A, a member from before: every older setting, the approval one off.
  for (const eventType of SECURITY_CASE_NOTIFICATION_EVENT_TYPES) {
    if (eventType === NEW_EVENT) {
      continue;
    }

    const isOn: boolean =
      eventType !==
      NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION;
    rows.set(key(USER_A, PROJECT_1, eventType), {
      alertByEmail: isOn,
      alertByPush: isOn,
    });
  }

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(ProjectService, "findAllBy")
    .mockResolvedValue([
      { _id: PROJECT_1.toString(), id: PROJECT_1 } as unknown as JSONObject,
    ] as never);
  jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([{ userId: USER_A } as unknown as JSONObject] as never);
  jest
    .spyOn(UserNotificationSettingService, "countBy")
    .mockImplementation(((args: {
      query: { userId: ObjectID; projectId: ObjectID; eventType: string };
    }): Promise<PositiveNumber> => {
      return Promise.resolve(
        new PositiveNumber(
          rows.has(
            key(args.query.userId, args.query.projectId, args.query.eventType),
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddSecurityCaseAiHandOffNotificationSettingsForUsers", () => {
  test("is named after itself, so it runs once more, and is registered once", () => {
    const index: string = fs
      .readFileSync(
        path.resolve(
          __dirname,
          "../../../FeatureSet/Workers/DataMigrations/Index.ts",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ");

    expect(
      new AddSecurityCaseAiHandOffNotificationSettingsForUsers().name,
    ).toBe(MIGRATION_NAME);
    expect(
      Array.from(index.matchAll(/new ([A-Za-z0-9]+)\(\)/g)).filter(
        (match: RegExpMatchArray): boolean => {
          return match[1] === MIGRATION_NAME;
        },
      ),
    ).toHaveLength(1);

    // Before the two slots kept last (AddAuditLogMcpClientColumns asserts them).
    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(registered.slice(-2)).toEqual([
      "BackfillIncidentCallTranscriptSignInAccount",
      "AddAuditLogMcpClientColumns",
    ]);
  });

  test("a member from before gets the new setting, email and push on, and keeps the rest as they were", async () => {
    await new AddSecurityCaseAiHandOffNotificationSettingsForUsers().migrate();

    expect(creates).toBe(1);
    expect(rows.get(key(USER_A, PROJECT_1, NEW_EVENT))).toEqual({
      alertByEmail: true,
      alertByPush: true,
    });
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
    await new AddSecurityCaseAiHandOffNotificationSettingsForUsers().migrate();
    await new AddSecurityCaseAiHandOffNotificationSettingsForUsers().migrate();

    expect(creates).toBe(1);
  });

  test("rolling back changes nothing", async () => {
    await expect(
      new AddSecurityCaseAiHandOffNotificationSettingsForUsers().rollback(),
    ).resolves.toBeUndefined();
  });
});
