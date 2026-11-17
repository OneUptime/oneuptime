import { describe, expect, test } from "@jest/globals";
import WorkspaceStoredValue, {
  WORKSPACE_STORED_ID_MAX_LENGTH,
  WORKSPACE_STORED_NAME_MAX_LENGTH,
} from "../../../../Server/Utils/Workspace/WorkspaceStoredValue";
import ColumnLength from "../../../../Types/Database/ColumnLength";

/*
 * WHAT ONEUPTIME STORES OF A WORKSPACE'S IDS AND NAMES (issue #9284).
 *
 * A Microsoft Teams personal chat's id ("a:1...") is 130 characters and
 * more. OneUptime cut every id it kept of a message's place to 100
 * characters, which made it another id - of no chat - and every update it
 * posted there failed with "This chat is not connected to OneUptime".
 * WorkspaceStoredValue holds the rule now: an id whole or not at all, a
 * name cut to fit.
 */

// A personal chat's id as the Bot Framework gives it: 131 characters.
const PERSONAL_CHAT_ID: string =
  "a:1BfcDQQeKz2oG1CPSFyD5ZD1flTYm2IoCY23DqeeVgq6wyCCFf9P43FAqqDYNLI-pephf2ltim4CcrRj_ti04mQkhsHSJDCY_Wsu7XBF4qh8qmhl2nGt9cSEa704tfJxn";

describe("WorkspaceStoredValue.id", () => {
  test("the fixture is a personal chat id as long as the one in the report", () => {
    expect(PERSONAL_CHAT_ID).toHaveLength(131);
    expect(PERSONAL_CHAT_ID.startsWith("a:1")).toBe(true);
  });

  test("REGRESSION #9284: a Microsoft Teams personal chat id of 131 characters is kept whole", () => {
    expect(WorkspaceStoredValue.id(PERSONAL_CHAT_ID)).toBe(PERSONAL_CHAT_ID);
    expect(WorkspaceStoredValue.isStorableId(PERSONAL_CHAT_ID)).toBe(true);
  });

  test.each([
    ["a Slack channel", "C0123ABCDEF"],
    ["a Slack message ts", "1700000000.000100"],
    ["a Microsoft Teams channel", "19:abc123def456@thread.tacv2"],
    ["a Microsoft Teams group chat", "19:9f2b1c0a7e5d4c3b@thread.v2"],
    [
      "a Microsoft Teams one-to-one chat, as Graph names it",
      "19:4f1c0b2e-6a7d-4e3f-9c8b-1a2d3e4f5a6b_7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e@unq.gbl.spaces",
    ],
    [
      "a Microsoft Teams activity id",
      "1:1Q4ARiJ0KxfMzYm9CwhUKHtTo8OHT1cD82gUb4vg6ccE",
    ],
    ["a Mattermost channel", "4xp9fdt77pncbef59f4k1qe83o"],
    ["an id exactly as long as a column keeps", "x".repeat(500)],
  ])("%s is kept as it is", (_label: string, id: string) => {
    expect(WorkspaceStoredValue.id(id)).toBe(id);
    expect(WorkspaceStoredValue.isStorableId(id)).toBe(true);
  });

  test("an id longer than a column keeps is not kept at all - never a part of it", () => {
    const tooLong: string = `a:1${"q".repeat(WORKSPACE_STORED_ID_MAX_LENGTH)}`;

    expect(WorkspaceStoredValue.id(tooLong)).toBeUndefined();
    expect(WorkspaceStoredValue.isStorableId(tooLong)).toBe(false);
  });

  test("no id is no id; an empty one is kept as the empty value it is, but is no id to keep a place by", () => {
    expect(WorkspaceStoredValue.id(undefined)).toBeUndefined();
    expect(WorkspaceStoredValue.id(null)).toBeUndefined();
    expect(WorkspaceStoredValue.isStorableId(undefined)).toBe(false);
    expect(WorkspaceStoredValue.isStorableId(null)).toBe(false);

    expect(WorkspaceStoredValue.id("")).toBe("");
    expect(WorkspaceStoredValue.isStorableId("")).toBe(false);
  });

  test("never cuts: whatever it answers is the id given, or nothing", () => {
    for (const length of [1, 99, 100, 101, 131, 499, 500, 501, 1000]) {
      const id: string = "i".repeat(length);
      const kept: string | undefined = WorkspaceStoredValue.id(id);

      expect(kept === undefined || kept === id).toBe(true);
    }
  });
});

describe("WorkspaceStoredValue.channelName", () => {
  test("a name that fits is kept as it is", () => {
    expect(WorkspaceStoredValue.channelName("Chat with Amit Rajput")).toBe(
      "Chat with Amit Rajput",
    );
    expect(WorkspaceStoredValue.channelName("n".repeat(500))).toBe(
      "n".repeat(500),
    );
  });

  test("a name longer than its column is cut to fit: it is only shown", () => {
    const long: string = "Payments, Checkout and Search on-call ".repeat(20);

    expect(long.length).toBeGreaterThan(WORKSPACE_STORED_NAME_MAX_LENGTH);
    expect(WorkspaceStoredValue.channelName(long)).toBe(
      long.substring(0, WORKSPACE_STORED_NAME_MAX_LENGTH),
    );
  });

  test("a cut never ends in half an emoji", () => {
    const name: string = `${"a".repeat(WORKSPACE_STORED_NAME_MAX_LENGTH - 1)}🚀🚀`;
    const kept: string = WorkspaceStoredValue.channelName(name)!;

    expect(kept).toBe("a".repeat(WORKSPACE_STORED_NAME_MAX_LENGTH - 1));
    expect(kept.length).toBeLessThanOrEqual(WORKSPACE_STORED_NAME_MAX_LENGTH);
  });

  test("no name is no name; an empty one stays empty", () => {
    expect(WorkspaceStoredValue.channelName(undefined)).toBeUndefined();
    expect(WorkspaceStoredValue.channelName(null)).toBeUndefined();
    expect(WorkspaceStoredValue.channelName("")).toBe("");
  });
});

describe("The widths it keeps to", () => {
  test("are the LongText columns' 500 characters, wider than any id the workspaces give", () => {
    expect(WORKSPACE_STORED_ID_MAX_LENGTH).toBe(ColumnLength.LongText);
    expect(WORKSPACE_STORED_NAME_MAX_LENGTH).toBe(ColumnLength.LongText);
    expect(WORKSPACE_STORED_ID_MAX_LENGTH).toBe(500);
    expect(WORKSPACE_STORED_ID_MAX_LENGTH).toBeGreaterThan(
      PERSONAL_CHAT_ID.length,
    );
  });

  test("are wider than the 100 characters the ids used to be cut to", () => {
    expect(WORKSPACE_STORED_ID_MAX_LENGTH).toBeGreaterThan(
      ColumnLength.ShortText,
    );
    expect(PERSONAL_CHAT_ID.length).toBeGreaterThan(ColumnLength.ShortText);
  });
});
