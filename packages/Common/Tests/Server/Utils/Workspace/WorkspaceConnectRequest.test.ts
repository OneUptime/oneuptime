import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import logger from "../../../../Server/Utils/Logger";
import WorkspaceConnectRequest, {
  WorkspaceConnectButton,
  WorkspaceConnectLink,
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestData,
  WorkspaceConnectRequestRecord,
  WorkspacePendingActionKind,
} from "../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { WorkspaceEventType } from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspaceConnectPromptOnce from "../../../../Server/Utils/Workspace/WorkspaceConnectPromptOnce";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../../Types/Workspace/ConnectCallback";
import { CacheEntry } from "../../API/WorkspaceOAuthTestHelpers";

/*
 * A press in Slack or Microsoft Teams from somebody whose account is not
 * connected is recorded to be finished once it is (WorkspaceConnectRequest):
 * who pressed, in which project, what, and where to answer. These pin how it
 * is kept - behind an opaque token whose raw value is never stored, for
 * thirty minutes, read without spending it at the sign-in's start and spent
 * once at its end - and that anything not written by it, or past its time,
 * is read as nothing at all.
 */

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../API/WorkspaceOAuthTestHelpers") as any
    ).createInMemoryGlobalCache(),
  };
});

const NAMESPACE: string = "workspace-connect-request";

const store: Map<string, CacheEntry> = (GlobalCache as any).store;

const PROJECT_ID: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-000000000002",
);

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function slackAcknowledgeRequest(): Promise<string> {
  const { token } = await WorkspaceConnectRequest.create({
    workspaceType: WorkspaceType.Slack,
    projectId: PROJECT_ID,
    workspaceUserId: "U0NITIN",
    purpose: "acknowledge this incident",
    pendingAction: {
      kind: WorkspacePendingActionKind.Acknowledge,
      eventType: WorkspaceEventType.Incident,
      eventId: INCIDENT_ID,
    },
    slack: {
      teamId: "T0TEAM",
      channelId: "C0INC2",
      threadTs: "1760000000.000100",
      responseUrl: "https://hooks.slack.com/actions/T0TEAM/1/abc",
    },
  });

  return token;
}

beforeEach(() => {
  store.clear();
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceConnectRequest.create", () => {
  test("hands back an opaque 43-character token and keeps only its hash", async () => {
    const token: string = await slackAcknowledgeRequest();

    expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);
    expect(Array.from(store.keys())).toEqual([`${NAMESPACE}-${sha256(token)}`]);

    // Neither the key nor the value holds the token itself.
    for (const [key, entry] of store.entries()) {
      expect(key.includes(token)).toBe(false);
      expect(entry.value.includes(token)).toBe(false);
    }
  });

  test("lasts thirty minutes, as long as Slack takes an answer to the press", async () => {
    const before: number = Date.now();
    const token: string = await slackAcknowledgeRequest();
    const entry: CacheEntry = store.get(`${NAMESPACE}-${sha256(token)}`)!;

    expect(WorkspaceConnectRequest.EXPIRES_IN_SECONDS).toBe(30 * 60);
    expect(entry.expiresAt - before).toBeGreaterThanOrEqual(30 * 60 * 1000);
    expect(entry.expiresAt - before).toBeLessThan(30 * 60 * 1000 + 5000);
  });

  /*
   * A message to OneUptime from an account not connected is prompted once in
   * a conversation while that prompt's Connect button works (#4768): no
   * longer, or a person would be left with an expired button and no new one.
   */
  test("is as long as a conversation goes without a second Connect prompt", () => {
    expect(WorkspaceConnectPromptOnce.ASKED_FOR_SECONDS).toBe(
      WorkspaceConnectRequest.EXPIRES_IN_SECONDS,
    );
  });

  test("gives every press a token of its own", async () => {
    const first: string = await slackAcknowledgeRequest();
    const second: string = await slackAcknowledgeRequest();

    expect(first).not.toBe(second);
    expect(store.size).toBe(2);
  });
});

describe("WorkspaceConnectRequest.peek and take", () => {
  test("read back everything the press was recorded with", async () => {
    const token: string = await slackAcknowledgeRequest();
    const record: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(token);

    expect(record).not.toBeNull();
    expect(record!.workspaceType).toBe(WorkspaceType.Slack);
    expect(record!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(record!.workspaceUserId).toBe("U0NITIN");
    expect(record!.purpose).toBe("acknowledge this incident");
    expect(record!.pendingAction!.kind).toBe(
      WorkspacePendingActionKind.Acknowledge,
    );
    expect(record!.pendingAction!.eventType).toBe(WorkspaceEventType.Incident);
    expect(record!.pendingAction!.eventId.toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect(record!.again).toBeUndefined();
    expect(record!.slack).toEqual({
      teamId: "T0TEAM",
      channelId: "C0INC2",
      threadTs: "1760000000.000100",
      responseUrl: "https://hooks.slack.com/actions/T0TEAM/1/abc",
    });
    expect(record!.teams).toBeUndefined();
  });

  test("peek leaves the press in place: the sign-in may be started again", async () => {
    const token: string = await slackAcknowledgeRequest();

    expect(await WorkspaceConnectRequest.peek(token)).not.toBeNull();
    expect(await WorkspaceConnectRequest.peek(token)).not.toBeNull();
    expect(store.size).toBe(1);
  });

  test("take spends the press: a second take, or a peek after it, reads nothing", async () => {
    const token: string = await slackAcknowledgeRequest();

    expect(await WorkspaceConnectRequest.take(token)).not.toBeNull();
    expect(await WorkspaceConnectRequest.take(token)).toBeNull();
    expect(await WorkspaceConnectRequest.peek(token)).toBeNull();
    expect(store.size).toBe(0);
  });

  test("a press to press again, and a Microsoft Teams place, round-trip", async () => {
    const { token } = await WorkspaceConnectRequest.create({
      workspaceType: WorkspaceType.MicrosoftTeams,
      projectId: PROJECT_ID,
      workspaceUserId: "4c2a1d3e-0000-4000-8000-00000000aaaa",
      purpose: "add a note to this alert",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Button,
        label: "Add Note",
      },
      teams: {
        serviceUrl: "https://smba.trafficmanager.net/amer/",
        conversationId: "19:abc@thread.tacv2;messageid=1760000000000",
        conversationType: "channel",
        tenantId: "11111111-2222-3333-4444-555555555555",
        userTeamsId: "29:1nitin",
        userName: "Nitin",
      },
    });

    const record: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.take(token);

    expect(record!.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(record!.pendingAction).toBeUndefined();
    expect(record!.again).toEqual({
      kind: WorkspaceConnectRequestAgainKind.Button,
      label: "Add Note",
    });
    expect(record!.teams).toEqual({
      serviceUrl: "https://smba.trafficmanager.net/amer/",
      conversationId: "19:abc@thread.tacv2;messageid=1760000000000",
      conversationType: "channel",
      tenantId: "11111111-2222-3333-4444-555555555555",
      userTeamsId: "29:1nitin",
      userName: "Nitin",
    });
    expect(record!.slack).toBeUndefined();
  });

  /*
   * A question asked in the app's direct messages: there is no channel to
   * answer in (the app's own message answers there), and the direct
   * messages are kept as where the settings page's "Back to Slack" goes.
   */
  test("a question asked in the app's direct messages round-trips with the direct messages to come back to, and no channel to answer in", async () => {
    const { token } = await WorkspaceConnectRequest.create({
      workspaceType: WorkspaceType.Slack,
      projectId: PROJECT_ID,
      workspaceUserId: "U0ERIN",
      purpose: "ask OneUptime AI",
      again: { kind: WorkspaceConnectRequestAgainKind.Question },
      slack: { teamId: "T0TEAM", directMessageChannelId: "D0ERIN" },
    });

    const record: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.take(token);

    expect(record!.again).toEqual({
      kind: WorkspaceConnectRequestAgainKind.Question,
    });
    expect(record!.slack).toEqual({
      teamId: "T0TEAM",
      directMessageChannelId: "D0ERIN",
    });
    expect(record!.slack!.channelId).toBeUndefined();
  });

  test.each([
    ["nothing", undefined],
    ["an empty string", ""],
    ["a number", 42],
    ["an object", { token: "x" }],
    ["a token one character short", "a".repeat(42)],
    ["a token one character long", "a".repeat(44)],
    ["a token with a character no token has", `${"a".repeat(42)}?`],
    ["a token with a slash", `${"a".repeat(42)}/`],
  ])(
    "%s is not a token, and the cache is not even read",
    async (_name: string, value: unknown) => {
      (GlobalCache.getString as jest.Mock).mockClear();
      (GlobalCache.getAndDeleteString as jest.Mock).mockClear();

      expect(await WorkspaceConnectRequest.peek(value)).toBeNull();
      expect(await WorkspaceConnectRequest.take(value)).toBeNull();
      expect(GlobalCache.getString).not.toHaveBeenCalled();
      expect(GlobalCache.getAndDeleteString).not.toHaveBeenCalled();
    },
  );

  test("a token nobody was given reads nothing", async () => {
    await slackAcknowledgeRequest();

    const stranger: string = crypto.randomBytes(32).toString("base64url");

    expect(await WorkspaceConnectRequest.peek(stranger)).toBeNull();
    expect(await WorkspaceConnectRequest.take(stranger)).toBeNull();
    // The real press is still there.
    expect(store.size).toBe(1);
  });

  test("a press past its thirty minutes reads nothing, even where the cache still holds it", async () => {
    const token: string = await slackAcknowledgeRequest();
    const key: string = `${NAMESPACE}-${sha256(token)}`;
    const entry: CacheEntry = store.get(key)!;

    // The record says when it ends, whatever the cache's own timer does.
    const record: { expiresAt: string } = JSON.parse(entry.value);
    record.expiresAt = new Date(Date.now() - 1000).toISOString();
    store.set(key, {
      value: JSON.stringify(record),
      expiresAt: entry.expiresAt,
    });

    expect(await WorkspaceConnectRequest.peek(token)).toBeNull();
  });
});

describe("a stored press that is not what create writes reads as nothing", () => {
  async function storeRaw(value: string): Promise<string> {
    const token: string = crypto.randomBytes(32).toString("base64url");
    store.set(`${NAMESPACE}-${sha256(token)}`, {
      value: value,
      expiresAt: Date.now() + 60_000,
    });
    return token;
  }

  function valid(): Record<string, unknown> {
    return {
      workspaceType: WorkspaceType.Slack,
      projectId: PROJECT_ID.toString(),
      workspaceUserId: "U0NITIN",
      purpose: "acknowledge this incident",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  test("text that is not JSON", async () => {
    expect(
      await WorkspaceConnectRequest.peek(await storeRaw("{nope")),
    ).toBeNull();
  });

  test("JSON that is not an object", async () => {
    expect(
      await WorkspaceConnectRequest.peek(await storeRaw("[1, 2, 3]")),
    ).toBeNull();
  });

  test.each([
    [
      "a workspace OneUptime does not answer presses in",
      { workspaceType: "Discord" },
    ],
    ["no project", { projectId: "" }],
    ["no account that pressed", { workspaceUserId: "" }],
    ["no purpose", { purpose: "" }],
    ["no end", { expiresAt: "whenever" }],
  ])("%s", async (_name: string, change: Record<string, unknown>) => {
    expect(
      await WorkspaceConnectRequest.peek(
        await storeRaw(JSON.stringify({ ...valid(), ...change })),
      ),
    ).toBeNull();
  });

  test("a press to finish of a kind OneUptime does not finish is kept without it", async () => {
    const record: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(
        await storeRaw(
          JSON.stringify({
            ...valid(),
            pendingAction: {
              kind: "DeleteEverything",
              eventType: WorkspaceEventType.Incident,
              eventId: INCIDENT_ID.toString(),
            },
          }),
        ),
      );

    expect(record).not.toBeNull();
    expect(record!.pendingAction).toBeUndefined();
  });

  test("a press to finish on a record of no kind OneUptime knows is kept without it", async () => {
    const record: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(
        await storeRaw(
          JSON.stringify({
            ...valid(),
            pendingAction: {
              kind: WorkspacePendingActionKind.Acknowledge,
              eventType: "Project",
              eventId: INCIDENT_ID.toString(),
            },
          }),
        ),
      );

    expect(record!.pendingAction).toBeUndefined();
  });

  test("a Slack place's direct messages that are not text are dropped, and the rest of the place kept", async () => {
    const record: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(
        await storeRaw(
          JSON.stringify({
            ...valid(),
            slack: {
              teamId: "T0TEAM",
              directMessageChannelId: { id: "D0ERIN" },
            },
          }),
        ),
      );

    expect(record!.slack).toEqual({ teamId: "T0TEAM" });
  });

  test("a Microsoft Teams place without the Bot Connector or the conversation is dropped", async () => {
    const record: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(
        await storeRaw(
          JSON.stringify({
            ...valid(),
            teams: { conversationId: "19:abc@thread.tacv2" },
          }),
        ),
      );

    expect(record!.teams).toBeUndefined();
  });
});

describe("WorkspaceConnectRequest links", () => {
  test("a Slack press opens the person's own Slack settings page in the project, with the token", async () => {
    const url: URL = await WorkspaceConnectRequest.getConnectUrl({
      workspaceType: WorkspaceType.Slack,
      projectId: PROJECT_ID,
      token: "a".repeat(43),
    });

    expect(url.toString()).toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/user-settings/slack-integration?connect=${"a".repeat(43)}`,
    );
  });

  test("a Microsoft Teams press opens the Microsoft Teams settings page", async () => {
    const url: URL = await WorkspaceConnectRequest.getConnectUrl({
      workspaceType: WorkspaceType.MicrosoftTeams,
      projectId: PROJECT_ID,
      token: "b".repeat(43),
    });

    expect(url.toString()).toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/user-settings/microsoft-teams-integration?connect=${"b".repeat(43)}`,
    );
  });

  test("the settings page alone, for when no press could be recorded", async () => {
    const url: URL = await WorkspaceConnectRequest.getSettingsUrl({
      workspaceType: WorkspaceType.Slack,
      projectId: PROJECT_ID,
    });

    expect(url.toString()).toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/user-settings/slack-integration`,
    );
  });
});

describe("WorkspaceConnectRequest.getConnectLink", () => {
  function teamsAcknowledge(): WorkspaceConnectRequestData {
    return {
      workspaceType: WorkspaceType.MicrosoftTeams,
      projectId: PROJECT_ID,
      workspaceUserId: "e3f4a5b6-c7d8-4e9f-8a1b-2c3d4e5f6a7b",
      purpose: "acknowledge this incident",
      pendingAction: {
        kind: WorkspacePendingActionKind.Acknowledge,
        eventType: WorkspaceEventType.Incident,
        eventId: INCIDENT_ID,
      },
    };
  }

  test("records the press, and links to the settings page with its token: one click", async () => {
    const link: WorkspaceConnectLink =
      await WorkspaceConnectRequest.getConnectLink(teamsAcknowledge());

    expect(link.button).toBe(WorkspaceConnectButton.OneClick);

    const url: globalThis.URL = new globalThis.URL(link.url!.toString());
    const token: string = url.searchParams.get("connect")!;

    expect(`${url.origin}${url.pathname}`).toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/user-settings/microsoft-teams-integration`,
    );
    expect(Array.from(url.searchParams.keys())).toEqual(["connect"]);
    expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

    const record: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(token);

    expect(record).toMatchObject({
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: "e3f4a5b6-c7d8-4e9f-8a1b-2c3d4e5f6a7b",
      purpose: "acknowledge this incident",
    });
    expect(record!.pendingAction!.eventId.toString()).toBe(
      INCIDENT_ID.toString(),
    );
  });

  test("a press that cannot be recorded links to the settings page alone, and says so in the log", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValueOnce(new Error("Redis is down"));
    const errorLog: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    const link: WorkspaceConnectLink =
      await WorkspaceConnectRequest.getConnectLink(teamsAcknowledge());

    expect(link.button).toBe(WorkspaceConnectButton.SettingsPage);
    expect(link.url!.toString()).toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/user-settings/microsoft-teams-integration`,
    );
    expect(store.size).toBe(0);
    expect(errorLog).toHaveBeenCalledWith(
      "Could not record a press to finish once the account is connected.",
      {
        projectId: PROJECT_ID.toString(),
        workspaceType: WorkspaceType.MicrosoftTeams,
      },
    );
  });

  test("with no address of the server's own, there is no button, nothing is recorded, and nothing is logged as an error", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockRejectedValue(new Error("No host is configured."));
    // The in-memory cache's own mock: it counts every test's writes.
    (GlobalCache.setString as jest.Mock).mockClear();
    const errorLog: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    const link: WorkspaceConnectLink =
      await WorkspaceConnectRequest.getConnectLink(teamsAcknowledge());

    expect(link).toEqual({ button: WorkspaceConnectButton.None });
    expect(store.size).toBe(0);
    expect(GlobalCache.setString).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });
});
