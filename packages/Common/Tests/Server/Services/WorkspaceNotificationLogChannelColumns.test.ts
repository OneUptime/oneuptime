import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationLogService, {
  Service as WorkspaceNotificationLogServiceClass,
} from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import { WorkspaceSendMessageResponse } from "../../../Server/Utils/Workspace/WorkspaceBase";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import { WorkspacePayloadMarkdown } from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

jest.mock("../../../Server/Utils/Logger");

/*
 * WHERE A MESSAGE WENT, AS NOTIFICATION LOGS KEEP IT (issue #9284).
 *
 * A log's channel id is read back: to find what a message in a channel is
 * about (a reaction's note), and which project posted in a channel (a
 * message to the bot). Every writer cut it to 100 characters, so a
 * Microsoft Teams personal chat's id - 130 characters and more - was kept as
 * an id of no chat, and the log matched nothing: the log of the very
 * failure in the report named a chat nobody has. The log keeps the ids
 * whole now, or leaves them out, and cuts only the name, which is shown.
 */

// A personal chat's id as the Bot Framework gives it: 131 characters.
const PERSONAL_CHAT_ID: string =
  "a:1BfcDQQeKz2oG1CPSFyD5ZD1flTYm2IoCY23DqeeVgq6wyCCFf9P43FAqqDYNLI-pephf2ltim4CcrRj_ti04mQkhsHSJDCY_Wsu7XBF4qh8qmhl2nGt9cSEa704tfJxn";

// An activity id as Teams answers a post in a personal chat.
const ACTIVITY_ID: string = "1:1Q4ARiJ0KxfMzYm9CwhUKHtTo8OHT1cD82gUb4vg6ccE";

// Longer than any column keeps whole.
const TOO_LONG_ID: string = `a:1${"x".repeat(ColumnLength.LongText)}`;

const PROJECT_ID: ObjectID = ObjectID.generate();

function log(data: {
  channelId?: string;
  channelName?: string;
  threadId?: string;
}): WorkspaceNotificationLog {
  const row: WorkspaceNotificationLog = new WorkspaceNotificationLog();
  row.projectId = PROJECT_ID;
  row.workspaceType = WorkspaceType.MicrosoftTeams;
  row.actionType = WorkspaceNotificationActionType.SendMessage;
  row.status = WorkspaceNotificationStatus.Success;

  if (data.channelId !== undefined) {
    row.channelId = data.channelId;
  }

  if (data.channelName !== undefined) {
    row.channelName = data.channelName;
  }

  if (data.threadId !== undefined) {
    row.threadId = data.threadId;
  }

  return row;
}

describe("WorkspaceNotificationLogService.fitChannelColumns", () => {
  test("REGRESSION #9284: a personal chat's id and its activity id are kept whole", () => {
    const row: WorkspaceNotificationLog =
      WorkspaceNotificationLogServiceClass.fitChannelColumns(
        log({
          channelId: PERSONAL_CHAT_ID,
          channelName: "Amit Rajput",
          threadId: ACTIVITY_ID,
        }),
      );

    expect(row.channelId).toBe(PERSONAL_CHAT_ID);
    expect(row.channelId).toHaveLength(131);
    expect(row.threadId).toBe(ACTIVITY_ID);
    expect(row.channelName).toBe("Amit Rajput");
  });

  test("an id longer than its column is left out, never cut: a part of an id is another id", () => {
    const row: WorkspaceNotificationLog =
      WorkspaceNotificationLogServiceClass.fitChannelColumns(
        log({ channelId: TOO_LONG_ID, threadId: TOO_LONG_ID }),
      );

    expect(row.channelId).toBeUndefined();
    expect(row.threadId).toBeUndefined();
  });

  test("a name longer than its column is cut to fit: it is only shown, and must not fail the log", () => {
    const name: string = "Amit, Jane, Nitin and the on-call ".repeat(20);
    const row: WorkspaceNotificationLog =
      WorkspaceNotificationLogServiceClass.fitChannelColumns(
        log({ channelName: name }),
      );

    expect(name.length).toBeGreaterThan(ColumnLength.LongText);
    expect(row.channelName).toBe(name.substring(0, ColumnLength.LongText));
  });

  test("what fits is kept as it is - Slack's ids, an empty channel - and what is not there stays not there", () => {
    const slack: WorkspaceNotificationLog =
      WorkspaceNotificationLogServiceClass.fitChannelColumns(
        log({
          channelId: "C0OPS",
          channelName: "ops",
          threadId: "1700000000.000100",
        }),
      );

    expect([slack.channelId, slack.channelName, slack.threadId]).toEqual([
      "C0OPS",
      "ops",
      "1700000000.000100",
    ]);

    const empty: WorkspaceNotificationLog =
      WorkspaceNotificationLogServiceClass.fitChannelColumns(
        log({ channelId: "", channelName: "" }),
      );

    expect(empty.channelId).toBe("");
    expect(empty.channelName).toBe("");

    const none: WorkspaceNotificationLog =
      WorkspaceNotificationLogServiceClass.fitChannelColumns(log({}));

    expect(none.channelId).toBeUndefined();
    expect(none.channelName).toBeUndefined();
    expect(none.threadId).toBeUndefined();
  });

  test("whatever it keeps passes the table's own length check", () => {
    const row: WorkspaceNotificationLog =
      WorkspaceNotificationLogServiceClass.fitChannelColumns(
        log({
          channelId: TOO_LONG_ID,
          channelName: TOO_LONG_ID,
          threadId: TOO_LONG_ID,
        }),
      );

    expect(() => {
      return WorkspaceNotificationLogService["checkMaxLengthOfFields"](row);
    }).not.toThrow();
  });
});

describe("Every log is written through it", () => {
  test("the create hook fits the log's channel columns, whoever wrote the log", async () => {
    const row: WorkspaceNotificationLog = log({
      channelId: PERSONAL_CHAT_ID,
      channelName: "n".repeat(ColumnLength.LongText + 20),
      threadId: TOO_LONG_ID,
    });

    const onCreate: OnCreate<WorkspaceNotificationLog> =
      await WorkspaceNotificationLogService["onBeforeCreate"]({
        data: row,
        props: { isRoot: true },
      });

    expect(onCreate.createBy.data.channelId).toBe(PERSONAL_CHAT_ID);
    expect(onCreate.createBy.data.channelName).toHaveLength(
      ColumnLength.LongText,
    );
    expect(onCreate.createBy.data.threadId).toBeUndefined();
  });
});

describe("WorkspaceNotificationRuleService.logSendResponses, for a personal chat", () => {
  let logRows: Array<WorkspaceNotificationLog>;

  beforeEach(() => {
    logRows = [];

    jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockImplementation((async (data: {
        data: WorkspaceNotificationLog;
      }): Promise<WorkspaceNotificationLog> => {
        logRows.push(data.data);
        return data.data;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function response(): WorkspaceSendMessageResponse {
    return {
      workspaceType: WorkspaceType.MicrosoftTeams,
      threads: [
        {
          channel: {
            id: PERSONAL_CHAT_ID,
            name: "Amit Rajput",
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          threadId: ACTIVITY_ID,
        },
      ],
      errors: [
        {
          channel: {
            id: PERSONAL_CHAT_ID,
            // A chat the send could not name is named by its id.
            name: PERSONAL_CHAT_ID,
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          error:
            "This chat is not connected to OneUptime. Please add the OneUptime app to the chat in Microsoft Teams and try again.",
        },
      ],
    };
  }

  test("REGRESSION #9284: the chat a message reached, and the one it did not, are logged by the chat's whole id", async () => {
    const alertId: ObjectID = ObjectID.generate();

    await WorkspaceNotificationRuleService.logSendResponses({
      projectId: PROJECT_ID,
      notificationFor: { alertId: alertId },
      responses: [response()],
      messageBlocksByWorkspaceTypes: [
        {
          workspaceType: WorkspaceType.MicrosoftTeams,
          messageBlocks: [
            {
              _type: "WorkspacePayloadMarkdown",
              text: "Nitin acknowledged",
            } as WorkspacePayloadMarkdown,
          ],
        },
      ],
    });

    expect(
      logRows.map((row: WorkspaceNotificationLog): Array<unknown> => {
        return [row.status, row.channelId, row.channelName, row.threadId];
      }),
    ).toEqual([
      [
        WorkspaceNotificationStatus.Success,
        PERSONAL_CHAT_ID,
        "Amit Rajput",
        ACTIVITY_ID,
      ],
      [
        WorkspaceNotificationStatus.Error,
        PERSONAL_CHAT_ID,
        PERSONAL_CHAT_ID,
        undefined,
      ],
    ]);

    for (const row of logRows) {
      // Never the first 100 characters the report found in its logs.
      expect(row.channelId).toHaveLength(131);
      expect(row.alertId?.toString()).toBe(alertId.toString());
    }
  });
});
