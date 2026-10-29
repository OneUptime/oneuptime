import FeedWorkspaceNotificationUtil, {
  FeedWorkspaceAuthor,
  FeedWorkspaceNotification,
} from "../../../../Server/Utils/Feed/FeedWorkspaceNotification";
import { UNNAMED_API_KEY_NAME } from "../../../../Server/Utils/Feed/FeedApiKeyActor";
import ObjectID from "../../../../Types/ObjectID";
import SavedChatMessage from "../../../../Types/Workspace/SavedChatMessage";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO A FEED ENTRY'S SLACK AND TEAMS MESSAGE OPENS WITH: THE ENTRY'S OWN
 * AUTHOR, OR NOBODY (Server/Utils/Feed/FeedWorkspaceNotification).
 *
 * The message once took a person of its own, and the role and owner
 * entries handed it the person they were about, so a channel read "Deane
 * Looi Added Deane Looi as Responder" when somebody else had added him.
 * Now an entry only says whether its message opens with its author, and
 * the author is the entry's own userId - or the API key that made the
 * change - which is what the Dashboard's feed shows in front of it.
 */

const PERSON: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000001");
const KEY: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000002");

const LED: FeedWorkspaceNotification = {
  sendWorkspaceNotification: true,
  leadWithAuthor: true,
};

const SAVED: SavedChatMessage = {
  workspaceType: WorkspaceType.Slack,
  authorName: "Aidil Rahman",
  postedAt: "2026-10-29T09:00:00.000Z",
};

describe("FeedWorkspaceNotificationUtil.getAuthor", () => {
  test("a person's entry opens with the person", () => {
    expect(
      FeedWorkspaceNotificationUtil.getAuthor({
        workspaceNotification: LED,
        userId: PERSON,
      }),
    ).toEqual({ authorUserId: PERSON });
  });

  test("a person wins over a key, as on the feed", () => {
    expect(
      FeedWorkspaceNotificationUtil.getAuthor({
        workspaceNotification: LED,
        userId: PERSON,
        apiKeyActor: { apiKeyId: KEY, apiKeyName: "Jira Automation" },
      }),
    ).toEqual({ authorUserId: PERSON });
  });

  test("an API key's entry opens with the key's name", () => {
    expect(
      FeedWorkspaceNotificationUtil.getAuthor({
        workspaceNotification: LED,
        apiKeyActor: { apiKeyId: KEY, apiKeyName: "  Jira Automation  " },
      }),
    ).toEqual({ authorApiKeyName: "Jira Automation" });
  });

  test.each([undefined, "", "   "])(
    "a key with no name (%p) is called what a key is",
    (name: string | undefined) => {
      expect(
        FeedWorkspaceNotificationUtil.getAuthor({
          workspaceNotification: LED,
          apiKeyActor: { apiKeyId: KEY, apiKeyName: name },
        }),
      ).toEqual({ authorApiKeyName: UNNAMED_API_KEY_NAME });
    },
  );

  test("a key with no id is no key", () => {
    expect(
      FeedWorkspaceNotificationUtil.getAuthor({
        workspaceNotification: LED,
        apiKeyActor: { apiKeyName: "orphan" },
      }),
    ).toEqual({});
  });

  test("an entry nobody made opens with no name", () => {
    expect(
      FeedWorkspaceNotificationUtil.getAuthor({ workspaceNotification: LED }),
    ).toEqual({});
  });

  test.each<[string, FeedWorkspaceNotification]>([
    [
      "an entry that does not ask for it (a created message's heading)",
      { sendWorkspaceNotification: true },
    ],
    [
      "an entry that says no",
      { sendWorkspaceNotification: true, leadWithAuthor: false },
    ],
  ])(
    "%s opens with no name, even with a person",
    (_label: string, workspaceNotification: FeedWorkspaceNotification) => {
      expect(
        FeedWorkspaceNotificationUtil.getAuthor({
          workspaceNotification: workspaceNotification,
          userId: PERSON,
          apiKeyActor: { apiKeyId: KEY, apiKeyName: "Jira Automation" },
        }),
      ).toEqual({});
    },
  );

  test("a note saved from a chat message never opens with a name: it names its people itself", () => {
    expect(
      FeedWorkspaceNotificationUtil.getAuthor({
        workspaceNotification: LED,
        userId: PERSON,
        savedFromChatMessage: SAVED,
      }),
    ).toEqual({});
  });
});

describe("FeedWorkspaceNotificationUtil.toWorkspaceNotification", () => {
  test("carries the entry's options with the author it opens with", () => {
    const author: FeedWorkspaceAuthor = { authorUserId: PERSON };

    expect(
      FeedWorkspaceNotificationUtil.toWorkspaceNotification({
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
          appendMessageBlocks: [],
          exceptChannel: {
            workspaceType: WorkspaceType.Slack,
            channelId: "C0INC",
          },
          notificationText: "Valeria added Deane Looi as Responder",
        },
        author: author,
      }),
    ).toEqual({
      sendWorkspaceNotification: true,
      appendMessageBlocks: [],
      exceptChannel: { workspaceType: WorkspaceType.Slack, channelId: "C0INC" },
      authorUserId: PERSON,
      authorApiKeyName: undefined,
    });
  });

  test("without an author, nobody leads", () => {
    const sent: ReturnType<
      typeof FeedWorkspaceNotificationUtil.toWorkspaceNotification
    > = FeedWorkspaceNotificationUtil.toWorkspaceNotification({
      workspaceNotification: { sendWorkspaceNotification: false },
    });

    expect(sent.sendWorkspaceNotification).toBe(false);
    expect(sent.authorUserId).toBeUndefined();
    expect(sent.authorApiKeyName).toBeUndefined();
  });

  test("an API key leads by its name", () => {
    expect(
      FeedWorkspaceNotificationUtil.toWorkspaceNotification({
        workspaceNotification: LED,
        author: { authorApiKeyName: "Jira Automation" },
      }).authorApiKeyName,
    ).toBe("Jira Automation");
  });
});
