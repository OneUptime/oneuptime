import { describe, expect, test } from "@jest/globals";
import WorkspaceNoteReactionUtil, {
  PrivateNoteReactionNames,
  PublicNoteReactionNames,
  WorkspaceNoteType,
} from "../../../Types/Workspace/WorkspaceNoteReaction";
import {
  PrivateNoteEmojis,
  PublicNoteEmojis,
} from "../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";

/*
 * Which reactions turn a chat message into a note. Slack reports emoji names,
 * Microsoft Teams reports the emoji itself (plus a display name) — both must
 * land on the same answer.
 */
describe("WorkspaceNoteReactionUtil.getNoteType", () => {
  describe("Slack emoji names", () => {
    test.each(["pushpin", "round_pushpin", "pin"])(
      "%s is a private note",
      (name: string) => {
        expect(WorkspaceNoteReactionUtil.getNoteType(name)).toBe(
          WorkspaceNoteType.Private,
        );
      },
    );

    test.each([
      "mega",
      "loudspeaker",
      "megaphone",
      "announcement",
      "speaking_head_in_silhouette",
      "speaking_head",
    ])("%s is a public note", (name: string) => {
      expect(WorkspaceNoteReactionUtil.getNoteType(name)).toBe(
        WorkspaceNoteType.Public,
      );
    });

    test("Slack's lists are the shared lists, so both platforms agree", () => {
      expect(PrivateNoteEmojis).toEqual(PrivateNoteReactionNames);
      expect(PublicNoteEmojis).toEqual(PublicNoteReactionNames);
    });

    test("names are matched case-insensitively and with :colons:", () => {
      expect(WorkspaceNoteReactionUtil.getNoteType(":pushpin:")).toBe(
        WorkspaceNoteType.Private,
      );
      expect(WorkspaceNoteReactionUtil.getNoteType("PushPin")).toBe(
        WorkspaceNoteType.Private,
      );
      expect(WorkspaceNoteReactionUtil.getNoteType(" MEGA ")).toBe(
        WorkspaceNoteType.Public,
      );
    });
  });

  describe("Microsoft Teams emoji characters", () => {
    test.each([
      ["📌", WorkspaceNoteType.Private],
      ["📍", WorkspaceNoteType.Private],
      ["📣", WorkspaceNoteType.Public],
      ["📢", WorkspaceNoteType.Public],
      ["🗣", WorkspaceNoteType.Public],
    ])("%s", (emoji: string, expected: WorkspaceNoteType) => {
      expect(WorkspaceNoteReactionUtil.getNoteType(emoji)).toBe(expected);
      expect(
        WorkspaceNoteReactionUtil.getNoteType({ reactionType: emoji }),
      ).toBe(expected);
    });

    test("the emoji variation selector does not matter", () => {
      expect(WorkspaceNoteReactionUtil.getNoteType("📌\uFE0F")).toBe(
        WorkspaceNoteType.Private,
      );
      expect(WorkspaceNoteReactionUtil.getNoteType("🗣\uFE0F")).toBe(
        WorkspaceNoteType.Public,
      );
    });

    test("Teams emoji ids such as 1f4cc_pushpin are understood", () => {
      expect(WorkspaceNoteReactionUtil.getNoteType("1f4cc_pushpin")).toBe(
        WorkspaceNoteType.Private,
      );
      expect(WorkspaceNoteReactionUtil.getNoteType("1f4e3_megaphone")).toBe(
        WorkspaceNoteType.Public,
      );
      expect(WorkspaceNoteReactionUtil.getNoteType("1f4e2_loudspeaker")).toBe(
        WorkspaceNoteType.Public,
      );
    });

    test("the display name is used when the reaction type is not an emoji", () => {
      expect(
        WorkspaceNoteReactionUtil.getNoteType({
          reactionType: "custom",
          displayName: "Pushpin",
        }),
      ).toBe(WorkspaceNoteType.Private);

      expect(
        WorkspaceNoteReactionUtil.getNoteType({
          reactionType: "custom",
          displayName: "Round Pushpin",
        }),
      ).toBe(WorkspaceNoteType.Private);

      expect(
        WorkspaceNoteReactionUtil.getNoteType({
          reactionType: undefined,
          displayName: "Speaking head",
        }),
      ).toBe(WorkspaceNoteType.Public);
    });

    test("the reaction type wins over the display name", () => {
      expect(
        WorkspaceNoteReactionUtil.getNoteType({
          reactionType: "📣",
          displayName: "Pushpin",
        }),
      ).toBe(WorkspaceNoteType.Public);
    });
  });

  describe("anything else is not a note", () => {
    test.each([
      "like",
      "heart",
      "laugh",
      "surprised",
      "sad",
      "angry",
      "+1",
      "thumbsup",
      "white_check_mark",
      "👍",
      "❤\uFE0F",
      "custom",
      "pinned",
      "pushpins",
      "megaphones",
      "",
      "   ",
    ])("%p", (value: string) => {
      expect(WorkspaceNoteReactionUtil.getNoteType(value)).toBeNull();
      expect(WorkspaceNoteReactionUtil.isNoteReaction(value)).toBe(false);
    });

    test("null, undefined and empty objects", () => {
      expect(WorkspaceNoteReactionUtil.getNoteType(null)).toBeNull();
      expect(WorkspaceNoteReactionUtil.getNoteType(undefined)).toBeNull();
      expect(WorkspaceNoteReactionUtil.getNoteType({})).toBeNull();
      expect(
        WorkspaceNoteReactionUtil.getNoteType({
          reactionType: null,
          displayName: null,
        }),
      ).toBeNull();
    });

    test("a hex prefix alone is not stripped into a match", () => {
      // "beef_" is hex, but what follows is not a note emoji name.
      expect(WorkspaceNoteReactionUtil.getNoteType("beef_taco")).toBeNull();
    });
  });

  test("isNoteReaction mirrors getNoteType", () => {
    expect(WorkspaceNoteReactionUtil.isNoteReaction("pushpin")).toBe(true);
    expect(WorkspaceNoteReactionUtil.isNoteReaction("📢")).toBe(true);
    expect(
      WorkspaceNoteReactionUtil.isNoteReaction({ displayName: "Megaphone" }),
    ).toBe(true);
    expect(WorkspaceNoteReactionUtil.isNoteReaction("like")).toBe(false);
  });
});
