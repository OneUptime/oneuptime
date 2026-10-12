import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import User from "../../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import UserService from "../../../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import ChannelMembersNotAddedNotice from "../../../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceUtil from "../../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import URL from "../../../../../Types/API/URL";
import Email from "../../../../../Types/Email";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceLiveMessageKey from "../../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import InMemoryLiveMessages from "./InMemoryLiveMessages";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * "NB User 3 cannot be invited to the channel because the account is not
 * connected to Slack" was posted for every person, every time OneUptime
 * tried to add them - at channel creation, and again each time an on-call
 * rule paged them (the maintainer's screenshots show it three times in one
 * incident channel). Now a channel gets ONE note naming everybody OneUptime
 * could not add, with how to fix it; a new name edits that note, a name it
 * has already says nothing. Slack only: OneUptime adds nobody to a
 * Microsoft Teams channel, so there is nothing to fix there.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const NB_USER_3: ObjectID = ObjectID.generate();
const JANE: ObjectID = ObjectID.generate();
const NO_NAME: ObjectID = ObjectID.generate();
const CHANNEL: { id: string; name: string } = {
  id: "C0INC8",
  name: "inc-inc-8",
};
const SETTINGS_LINK: string =
  "https://oneuptime.test/dashboard/" +
  PROJECT_ID.toString() +
  "/user-settings/slack-integration";

function person(id: ObjectID, name?: string, email?: string): User {
  const user: User = new User();
  user.id = id;

  if (name) {
    user.name = name as never;
  }

  if (email) {
    user.email = new Email(email);
  }

  return user;
}

// An escaped character: what is left without them is Markdown syntax.
const ESCAPED_CHARACTER: RegExp = /\\./gu;

let store: InMemoryLiveMessages;
let postSpy: SpyInstance<
  typeof WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot
>;
let updateSpy: SpyInstance<typeof SlackUtil.updateMessage>;
let nextTs: number;

function postedText(call: number): string {
  const payload: WorkspaceMessagePayload =
    postSpy.mock.calls[call]![0].messagePayloadsByWorkspace[0]!;
  return (payload.messageBlocks[0] as WorkspacePayloadMarkdown).text;
}

function updatedText(call: number): string {
  return (
    updateSpy.mock.calls[call]![0].messageBlocks[0] as WorkspacePayloadMarkdown
  ).text;
}

beforeEach(() => {
  store = new InMemoryLiveMessages();
  store.install();
  nextTs = 1;

  jest
    .spyOn(Semaphore, "lock")
    .mockRejectedValue(new Error("Redis client is not connected"));

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));

  jest.spyOn(UserService, "findBy").mockResolvedValue([
    person(NB_USER_3, "NB User 3"),
    person(JANE, "Jane Doe"),
    person(NO_NAME, undefined, "noname@example.com"),
  ]);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (): Promise<WorkspaceProjectAuthToken> => {
      const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      token.authToken = "xoxb-token";
      token.workspaceType = WorkspaceType.Slack;
      return token;
    }) as never);

  postSpy = jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockImplementation((async (data: {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    }): Promise<Array<WorkspaceSendMessageResponse>> => {
      const payload: WorkspaceMessagePayload =
        data.messagePayloadsByWorkspace[0]!;
      return [
        {
          workspaceType: payload.workspaceType,
          threads: [
            {
              channel: {
                id: payload.channelIds[0]!,
                name: CHANNEL.name,
                workspaceType: payload.workspaceType,
              },
              threadId: `17000000${nextTs++}.0001`,
            },
          ],
        },
      ];
    }) as never);

  updateSpy = jest.spyOn(SlackUtil, "updateMessage").mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function note(
  userIds: Array<ObjectID>,
  channels: Array<{ id: string; name?: string }> = [CHANNEL],
  workspaceType: WorkspaceType = WorkspaceType.Slack,
): Promise<void> {
  return ChannelMembersNotAddedNotice.noteMembersNotAdded({
    projectId: PROJECT_ID,
    workspaceType: workspaceType,
    channels: channels,
    userIds: userIds,
  });
}

describe("ChannelMembersNotAddedNotice", () => {
  test("the first person who could not be added: one note, naming them and how to fix it", async () => {
    await note([NB_USER_3]);

    expect(postSpy).toHaveBeenCalledTimes(1);
    const payload: WorkspaceMessagePayload =
      postSpy.mock.calls[0]![0].messagePayloadsByWorkspace[0]!;
    expect(payload.workspaceType).toBe(WorkspaceType.Slack);
    expect(payload.channelIds).toEqual([CHANNEL.id]);
    expect(postedText(0)).toBe(
      `👥 **Not everyone could be added to this channel.** **NB User 3** has not connected a Slack account to OneUptime, so OneUptime could not add them.\n\nTo fix it, they connect Slack in [OneUptime → User Settings → Slack](${SETTINGS_LINK}), then join this channel or ask someone here to add them.`,
    );

    const kept: Array<unknown> = store.forKey(
      WorkspaceLiveMessageKey.forChannelMembersNotAdded(),
    );
    expect(kept).toHaveLength(1);
    expect(store.rows[0]!.messageData).toEqual({
      userIds: [NB_USER_3.toString()],
    });
  });

  test("REGRESSION: the same person again - paged again, or an owner again - says nothing more", async () => {
    await note([NB_USER_3]);
    await note([NB_USER_3]);
    await note([NB_USER_3, NB_USER_3]);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("somebody new is added to the same note, edited in place, naming everybody", async () => {
    await note([NB_USER_3]);
    await note([JANE]);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].messageId).toBe(
      store.rows[0]!.messageId,
    );
    expect(updateSpy.mock.calls[0]![0].location).toEqual({
      channelId: CHANNEL.id,
      teamId: undefined,
      isChat: false,
    });
    expect(updatedText(0)).toBe(
      `👥 **Not everyone could be added to this channel.** **NB User 3**, **Jane Doe** have not connected their Slack accounts to OneUptime, so OneUptime could not add them.\n\nTo fix it, they connect Slack in [OneUptime → User Settings → Slack](${SETTINGS_LINK}), then join this channel or ask someone here to add them.`,
    );
    expect(store.rows[0]!.messageData).toEqual({
      userIds: [NB_USER_3.toString(), JANE.toString()],
    });
  });

  test("several people at once: one note naming them all; a person without a name by their email", async () => {
    await note([NB_USER_3, JANE, NO_NAME]);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postedText(0)).toContain(
      "**NB User 3**, **Jane Doe**, **noname@example.com** have not connected their Slack accounts",
    );
  });

  test("each channel gets its own note, once each", async () => {
    await note([NB_USER_3], [CHANNEL, { id: "C0OTHER", name: "other" }]);
    await note([NB_USER_3], [CHANNEL, { id: "C0OTHER", name: "other" }]);

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(
      postSpy.mock.calls.map(
        (
          call: Array<{
            messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
          }>,
        ): string => {
          return call[0]!.messagePayloadsByWorkspace[0]!.channelIds[0]!;
        },
      ),
    ).toEqual([CHANNEL.id, "C0OTHER"]);
  });

  test("a channel listed twice in one call gets one note", async () => {
    await note([NB_USER_3], [CHANNEL, CHANNEL]);

    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  test("nobody to name: nothing is posted or read", async () => {
    await note([]);

    expect(postSpy).not.toHaveBeenCalled();
    expect(UserService.findBy).not.toHaveBeenCalled();
  });

  test("Microsoft Teams: no note - OneUptime adds nobody to a Teams channel, so connecting would change nothing", async () => {
    await note(
      [NB_USER_3],
      [{ id: "19:inc8@thread.tacv2", name: "inc-8" }],
      WorkspaceType.MicrosoftTeams,
    );

    expect(postSpy).not.toHaveBeenCalled();
    expect(store.rows).toEqual([]);
  });

  test("a note that cannot be posted in one channel does not stop the next", async () => {
    postSpy.mockRejectedValueOnce(new Error("channel_not_found"));

    await note([NB_USER_3], [{ id: "C0GONE" }, CHANNEL]);

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.channelId).toBe(CHANNEL.id);
  });

  test("names are text: a name cannot become a link or a mention", async () => {
    jest
      .spyOn(UserService, "findBy")
      .mockResolvedValue([person(NB_USER_3, "<!channel> [x](evil-target)")]);

    await note([NB_USER_3]);

    const text: string = postedText(0).replace(ESCAPED_CHARACTER, "");
    expect(text).not.toContain("<!channel>");
    expect(text).not.toContain("](evil-target)");
  });
});
