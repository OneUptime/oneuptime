import { describe, expect, test } from "@jest/globals";
import SavedChatMessage, {
  SAVED_CHAT_MESSAGE_AUTHOR_NAME_MAX_LENGTH,
  SavedChatMessageUtil,
} from "../../../Types/Workspace/SavedChatMessage";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * WHERE A NOTE SAVED FROM A CHAT MESSAGE CAME FROM (SavedChatMessage).
 *
 * Written by OneUptime on the note, and copied on its timeline entry - a
 * feed row a workflow can write too - so it is read back keeping only what
 * it should hold: a known chat, a name on one line, a user id that is one,
 * a time that is one.
 */

const USER_ID: string = "a0000000-0000-4000-8000-0000000000aa";

describe("SavedChatMessageUtil.read", () => {
  test("keeps what it should hold", () => {
    expect(
      SavedChatMessageUtil.read({
        workspaceType: WorkspaceType.Slack,
        authorName: "Aidil Rahman",
        authorUserId: USER_ID.toUpperCase(),
        postedAt: "2026-10-08T10:17:00Z",
      }),
    ).toEqual({
      workspaceType: WorkspaceType.Slack,
      authorName: "Aidil Rahman",
      authorUserId: USER_ID,
      postedAt: "2026-10-08T10:17:00.000Z",
    });

    expect(
      SavedChatMessageUtil.read({
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toEqual({ workspaceType: WorkspaceType.MicrosoftTeams });
  });

  test.each([
    ["nothing", null],
    ["text", "Slack"],
    ["a list", [WorkspaceType.Slack]],
    ["no chat", { authorName: "Aidil" }],
    ["a chat OneUptime does not save from", { workspaceType: "Telegram" }],
  ])("%s is no chat message", (_case: string, value: unknown) => {
    expect(SavedChatMessageUtil.read(value)).toBeNull();
  });

  test("leaves out a user id that is none, a time that is none, and a name that is not text", () => {
    expect(
      SavedChatMessageUtil.read({
        workspaceType: WorkspaceType.Slack,
        authorName: { first: "Aidil" },
        authorUserId: "'; DROP TABLE users; --",
        postedAt: "yesterday",
      }),
    ).toEqual({ workspaceType: WorkspaceType.Slack });

    expect(
      SavedChatMessageUtil.read({
        workspaceType: WorkspaceType.Slack,
        authorUserId: 42,
        postedAt: 1791454620,
      }),
    ).toEqual({ workspaceType: WorkspaceType.Slack });
  });

  test("a name is one line, without control characters, at most a hundred characters", () => {
    expect(
      SavedChatMessageUtil.read({
        workspaceType: WorkspaceType.Slack,
        authorName: "  Aidil\n\tRahman\u0000 ",
      })!.authorName,
    ).toBe("Aidil Rahman");

    const long: string = "🔥".repeat(150);
    const name: string = SavedChatMessageUtil.read({
      workspaceType: WorkspaceType.Slack,
      authorName: long,
    })!.authorName!;

    // Cut at a whole character: no half of an emoji.
    expect(Array.from(name)).toHaveLength(
      SAVED_CHAT_MESSAGE_AUTHOR_NAME_MAX_LENGTH,
    );
    expect(name).toBe("🔥".repeat(SAVED_CHAT_MESSAGE_AUTHOR_NAME_MAX_LENGTH));

    expect(
      SavedChatMessageUtil.read({
        workspaceType: WorkspaceType.Slack,
        authorName: " \n ",
      }),
    ).toEqual({ workspaceType: WorkspaceType.Slack });
  });
});

describe("SavedChatMessageUtil.toJSON", () => {
  test("stores the fields that have a value, as read reads them", () => {
    const saved: SavedChatMessage = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      authorName: "Aidil\nRahman",
      authorUserId: USER_ID,
      postedAt: "2026-10-08T10:17:00.123Z",
    };

    expect(SavedChatMessageUtil.toJSON(saved)).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      authorName: "Aidil Rahman",
      authorUserId: USER_ID,
      postedAt: "2026-10-08T10:17:00.123Z",
    });
    expect(
      SavedChatMessageUtil.read(SavedChatMessageUtil.toJSON(saved)),
    ).toEqual(SavedChatMessageUtil.toJSON(saved));

    expect(
      SavedChatMessageUtil.toJSON({
        workspaceType: WorkspaceType.Slack,
        authorName: "",
        authorUserId: "not-a-user",
        postedAt: "never",
      }),
    ).toEqual({ workspaceType: WorkspaceType.Slack });
  });
});

describe("SavedChatMessageUtil: the chat, the time", () => {
  test("names the chat as the product does", () => {
    expect(SavedChatMessageUtil.getWorkspaceName(WorkspaceType.Slack)).toBe(
      "Slack",
    );
    expect(
      SavedChatMessageUtil.getWorkspaceName(WorkspaceType.MicrosoftTeams),
    ).toBe("Microsoft Teams");
  });

  test("a note saved before the column existed tells its chat by its message key", () => {
    expect(
      SavedChatMessageUtil.getWorkspaceTypeOfMessageKey(
        "C0INCIDENT:1791454620.000200",
      ),
    ).toBe(WorkspaceType.Slack);
    expect(
      SavedChatMessageUtil.getWorkspaceTypeOfMessageKey(
        "19:inc-8@thread.tacv2:1700000000200",
      ),
    ).toBe(WorkspaceType.MicrosoftTeams);
    expect(SavedChatMessageUtil.getWorkspaceTypeOfMessageKey("")).toBeNull();
    expect(SavedChatMessageUtil.getWorkspaceTypeOfMessageKey(null)).toBeNull();
    expect(
      SavedChatMessageUtil.getWorkspaceTypeOfMessageKey(undefined),
    ).toBeNull();
  });

  test("the posted time, or none", () => {
    expect(
      SavedChatMessageUtil.getPostedAt({
        workspaceType: WorkspaceType.Slack,
        postedAt: "2026-10-08T10:17:00.000Z",
      })!.toISOString(),
    ).toBe("2026-10-08T10:17:00.000Z");
    expect(
      SavedChatMessageUtil.getPostedAt({ workspaceType: WorkspaceType.Slack }),
    ).toBeNull();
    expect(SavedChatMessageUtil.getPostedAt(null)).toBeNull();
  });
});
