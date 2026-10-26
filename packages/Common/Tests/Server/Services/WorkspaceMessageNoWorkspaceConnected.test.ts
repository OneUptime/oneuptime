import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../Server/Utils/Workspace/WorkspaceBase";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * A FEED ENTRY IN A PROJECT WITH NO SLACK OR TEAMS CONNECTED FINDS NOTHING
 * TO POST, AT ONCE (issue #5299).
 *
 * Every feed entry of every record - each alert's "Changed state to
 * Resolved", one per alert in a bulk Resolve of thousands - asks
 * sendWorkspaceMarkdownNotification what to post where. Without a workspace
 * connected the answer is nothing, but the question took about fifteen
 * reads: the rules that might open a channel, the author's name in each
 * workspace, the rules and channels and chats of each workspace. It now asks
 * once whether a workspace is connected and stops there when none is.
 *
 * With one connected, it does everything it did. When the question cannot
 * be answered (the database is out of reach), it carries on as before and
 * lets the steps below decide.
 */

const projectId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();

function connection(data: {
  workspaceType?: WorkspaceType | undefined;
  authToken?: string | undefined;
}): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();

  if (data.workspaceType) {
    auth.workspaceType = data.workspaceType;
  }

  if (data.authToken !== undefined) {
    auth.authToken = data.authToken;
  }

  return auth;
}

let readsAfterTheQuestion: Array<string> = [];
let posted: Array<WorkspaceMessagePayload> = [];

function send(): Promise<void> {
  return WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
    projectId: projectId,
    notificationFor: { alertId: alertId },
    feedInfoInMarkdown: "✅ Changed **Alert ALT-7 State** to **Resolved**",
    workspaceNotification: {
      sendWorkspaceNotification: true,
    },
  });
}

beforeEach((): void => {
  readsAfterTheQuestion = [];
  posted = [];

  jest
    .spyOn(WorkspaceNotificationRuleService, "createChannelsForRulesThatNowMatch")
    .mockImplementation((async () => {
      readsAfterTheQuestion.push("rules that open a channel");
      return [];
    }) as never);

  jest
    .spyOn(WorkspaceUtil, "getMessageBlocksByMarkdown")
    .mockImplementation((async () => {
      readsAfterTheQuestion.push("author names");
      return [
        {
          workspaceType: WorkspaceType.Slack,
          messageBlocks: [
            { _type: "WorkspacePayloadMarkdown", text: "Changed" },
          ],
        },
      ];
    }) as never);

  jest
    .spyOn(WorkspaceNotificationRuleService, "getMessageDestinations")
    .mockImplementation((async () => {
      readsAfterTheQuestion.push("destinations");
      return [
        {
          _type: "WorkspaceMessagePayload",
          workspaceType: WorkspaceType.Slack,
          channelNames: ["alerts"],
          channelIds: [],
          messageBlocks: [],
        },
      ];
    }) as never);

  jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockImplementation((async (data: {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    }): Promise<Array<WorkspaceSendMessageResponse>> => {
      posted.push(...data.messagePayloadsByWorkspace);
      return [];
    }) as never);

  jest
    .spyOn(WorkspaceNotificationLogService, "create")
    .mockResolvedValue(undefined as never);
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("WorkspaceNotificationRuleService.hasConnectedWorkspace", () => {
  test.each([
    ["no connection at all", [], false],
    [
      "a Slack connection without a token",
      [connection({ workspaceType: WorkspaceType.Slack, authToken: "" })],
      false,
    ],
    [
      "a token without a workspace",
      [connection({ authToken: "xoxb-1" })],
      false,
    ],
    [
      "a Slack connection",
      [connection({ workspaceType: WorkspaceType.Slack, authToken: "xoxb-1" })],
      true,
    ],
    [
      "a Teams connection beside a broken one",
      [
        connection({ workspaceType: WorkspaceType.Slack, authToken: "" }),
        connection({
          workspaceType: WorkspaceType.MicrosoftTeams,
          authToken: "teams-token",
        }),
      ],
      true,
    ],
  ])(
    "%s: %p",
    async (
      _name: string,
      auths: Array<WorkspaceProjectAuthToken>,
      expected: boolean,
    ) => {
      jest
        .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
        .mockResolvedValue(auths as never);

      await expect(
        WorkspaceNotificationRuleService.hasConnectedWorkspace(projectId),
      ).resolves.toBe(expected);
    },
  );
});

describe("WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification", () => {
  test("with no workspace connected, reads nothing more and posts nothing", async () => {
    const getProjectAuths: ReturnType<typeof jest.spyOn> = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([] as never);

    await send();

    expect(getProjectAuths).toHaveBeenCalledTimes(1);
    expect(readsAfterTheQuestion).toEqual([]);
    expect(posted).toEqual([]);
  });

  test("with a connection that holds no token, the same: nothing could be posted", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([
        connection({ workspaceType: WorkspaceType.Slack, authToken: "" }),
      ] as never);

    await send();

    expect(readsAfterTheQuestion).toEqual([]);
    expect(posted).toEqual([]);
  });

  test("with a workspace connected, finds the rules, the names and the destinations, and posts, as it always did", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([
        connection({ workspaceType: WorkspaceType.Slack, authToken: "xoxb-1" }),
      ] as never);

    await send();

    expect(readsAfterTheQuestion).toEqual([
      "rules that open a channel",
      "author names",
      "destinations",
    ]);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.channelNames).toEqual(["alerts"]);
  });

  test("when whether one is connected cannot be read, carries on as before and lets the steps below decide", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockRejectedValue(new Error("The database went away.") as never);

    await send();

    expect(readsAfterTheQuestion).toEqual([
      "rules that open a channel",
      "author names",
      "destinations",
    ]);
    expect(posted).toHaveLength(1);
  });
});
