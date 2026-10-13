import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import WorkspaceConnectPromptOnce, {
  WorkspaceConnectPromptClaim,
  WorkspaceConversationPerson,
} from "../../../../Server/Utils/Workspace/WorkspaceConnectPromptOnce";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

/*
 * ONE CONNECT PROMPT A CONVERSATION (#4768).
 *
 * Somebody not connected who keeps writing to OneUptime in a thread, a
 * direct message or a chat is asked to connect once there, not under each
 * message - and asked again once the Connect button they were given has
 * expired, with a new one. A prompt that reached nobody does not count, and
 * a cache that cannot be read never silences anybody.
 */

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../API/WorkspaceOAuthTestHelpers") as Record<
        string,
        () => unknown
      >
    )["createInMemoryGlobalCache"]!(),
  };
});

const CAROL: WorkspaceConversationPerson = {
  workspaceType: WorkspaceType.Slack,
  workspaceId: "T0ACME",
  conversationId: "C0OPS:1760000001.000100",
  workspaceUserId: "U0CAROL",
};

// A key of this module's in the cache: its namespace, then a SHA-256 digest.
const PROMPT_KEY: RegExp = /^workspace-connect-prompt-[0-9a-f]{64}$/;

function store(): Map<string, { value: string; expiresAt: number }> {
  return (
    GlobalCache as unknown as {
      store: Map<string, { value: string; expiresAt: number }>;
    }
  ).store;
}

beforeEach(() => {
  store().clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceConnectPromptOnce.claim", () => {
  test("the first prompt in a conversation is claimed; the next ones there are not", async () => {
    expect(await WorkspaceConnectPromptOnce.claim(CAROL)).not.toBeNull();
    expect(await WorkspaceConnectPromptOnce.claim(CAROL)).toBeNull();
    expect(await WorkspaceConnectPromptOnce.claim(CAROL)).toBeNull();
  });

  test.each([
    ["another conversation", { conversationId: "C0OPS:1760000009.000100" }],
    ["another person", { workspaceUserId: "U0DAVE" }],
    ["another workspace", { workspaceId: "T0OTHER" }],
    ["the other chat", { workspaceType: WorkspaceType.MicrosoftTeams }],
  ])(
    "%s has a prompt of its own",
    async (_name: string, other: Partial<WorkspaceConversationPerson>) => {
      expect(await WorkspaceConnectPromptOnce.claim(CAROL)).not.toBeNull();
      expect(
        await WorkspaceConnectPromptOnce.claim({ ...CAROL, ...other }),
      ).not.toBeNull();
    },
  );

  // WorkspaceConnectRequest.test.ts holds this to the button's own lifetime.
  test("for as long as the Connect button it gives works: 30 minutes", async () => {
    expect(WorkspaceConnectPromptOnce.ASKED_FOR_SECONDS).toBe(30 * 60);

    await WorkspaceConnectPromptOnce.claim(CAROL);

    expect(GlobalCache.setStringIfNotExists).toHaveBeenCalledWith(
      "workspace-connect-prompt",
      expect.any(String),
      expect.any(String),
      { expiresInSeconds: 30 * 60 },
    );

    const now: number = Date.now();
    const clock: jest.SpyInstance = jest.spyOn(Date, "now");

    clock.mockReturnValue(now + 29 * 60 * 1000);
    expect(await WorkspaceConnectPromptOnce.claim(CAROL)).toBeNull();

    clock.mockReturnValue(now + 31 * 60 * 1000);
    expect(await WorkspaceConnectPromptOnce.claim(CAROL)).not.toBeNull();
  });

  test("a prompt that reached nobody gives its claim back: the next message is prompted", async () => {
    const claim: WorkspaceConnectPromptClaim | null =
      await WorkspaceConnectPromptOnce.claim(CAROL);

    await claim!.release();

    expect(await WorkspaceConnectPromptOnce.claim(CAROL)).not.toBeNull();
  });

  test("giving back an old claim leaves a newer one alone", async () => {
    const now: number = Date.now();
    const clock: jest.SpyInstance = jest.spyOn(Date, "now");
    const old: WorkspaceConnectPromptClaim | null =
      await WorkspaceConnectPromptOnce.claim(CAROL);

    // The old one has expired, and a newer prompt was given since.
    clock.mockReturnValue(now + 31 * 60 * 1000);
    expect(await WorkspaceConnectPromptOnce.claim(CAROL)).not.toBeNull();

    await old!.release();

    expect(await WorkspaceConnectPromptOnce.claim(CAROL)).toBeNull();
  });

  test("the cache names nobody: its key is a digest of who and where", async () => {
    await WorkspaceConnectPromptOnce.claim(CAROL);

    const keys: Array<string> = Array.from(store().keys());

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(PROMPT_KEY);
    expect(keys[0]).toBe(
      `workspace-connect-prompt-${WorkspaceConnectPromptOnce.getKey(CAROL)}`,
    );
  });

  test("ids that would run together as text are told apart", () => {
    expect(
      WorkspaceConnectPromptOnce.getKey({
        ...CAROL,
        conversationId: "C0OPS:1",
        workspaceUserId: "U2",
      }),
    ).not.toBe(
      WorkspaceConnectPromptOnce.getKey({
        ...CAROL,
        conversationId: "C0OPS:",
        workspaceUserId: "1U2",
      }),
    );
  });

  test("a cache that cannot be read never silences anybody: every message is prompted, and giving the claim back throws nothing", async () => {
    jest.spyOn(logger, "debug").mockImplementation(() => {});
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("Cache is not connected"));

    const first: WorkspaceConnectPromptClaim | null =
      await WorkspaceConnectPromptOnce.claim(CAROL);
    const second: WorkspaceConnectPromptClaim | null =
      await WorkspaceConnectPromptOnce.claim(CAROL);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    await expect(first!.release()).resolves.toBeUndefined();
  });

  test("a claim the cache will not give back throws nothing", async () => {
    jest.spyOn(logger, "debug").mockImplementation(() => {});

    const claim: WorkspaceConnectPromptClaim | null =
      await WorkspaceConnectPromptOnce.claim(CAROL);

    jest
      .spyOn(GlobalCache, "deleteKeyIfValue")
      .mockRejectedValue(new Error("Cache is not connected"));

    await expect(claim!.release()).resolves.toBeUndefined();
  });
});
