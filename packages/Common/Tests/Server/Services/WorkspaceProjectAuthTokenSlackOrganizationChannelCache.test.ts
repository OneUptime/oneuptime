import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceProjectAuthToken, {
  SlackChannelCache,
  SlackMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE CHANNEL LIST EDITOR AND A SLACK ENTERPRISE ORGANIZATION'S CHANNELS
 * (WorkspaceProjectAuthTokenService.replaceSlackChannelCache).
 *
 * A project connected to a whole Slack Enterprise organization caches each
 * channel with its workspace (teamId): a channel cached without one is
 * taken for a channel of any of the organization's workspaces. The editor
 * (PUT /slack/channel-cache) saves names and ids only - so a channel it
 * keeps keeps the workspace it is stored as in, found by its id: a channel
 * id is one channel, in one workspace.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-000000000001",
);
const ROW_ID: ObjectID = new ObjectID("c5000000-0000-4000-8000-000000000002");

const SAVED_AT: string = "2026-11-11T09:00:00.000Z";

let storedMiscData: SlackMiscData | undefined;
let written: Array<JSONObject>;

function organizationMiscData(channelCache: SlackChannelCache): SlackMiscData {
  return {
    teamId: "E0ACME",
    teamName: "Acme Corp",
    botUserId: "U0BOT",
    isEnterpriseInstall: true,
    enterpriseId: "E0ACME",
    enterpriseName: "Acme Corp",
    workspaces: [
      { id: "T0EAST", name: "Acme East" },
      { id: "T0WEST", name: "Acme West" },
    ],
    defaultWorkspaceId: "T0WEST",
    workspacesReadAt: "2026-11-11T08:58:00.000Z",
    channelCache: channelCache,
  };
}

// What the editor sends, as the route builds it: names and ids.
function edited(channels: Record<string, string>): SlackChannelCache {
  const cache: SlackChannelCache = {};

  for (const [name, id] of Object.entries(channels)) {
    cache[name.toLowerCase()] = { id: id, name: name, lastUpdated: SAVED_AT };
  }

  return cache;
}

async function save(
  channelCache: SlackChannelCache,
): Promise<SlackChannelCache> {
  await WorkspaceProjectAuthTokenService.replaceSlackChannelCache({
    projectId: PROJECT_ID,
    channelCache: channelCache,
  });

  expect(written).toHaveLength(1);

  return (
    (written[0]!["data"] as JSONObject)["miscData"] as unknown as SlackMiscData
  ).channelCache as SlackChannelCache;
}

beforeEach(() => {
  written = [];
  storedMiscData = organizationMiscData({
    general: {
      id: "C0WGEN",
      name: "general",
      lastUpdated: "2026-11-10T09:00:00.000Z",
      teamId: "T0WEST",
    },
    "east-only": {
      id: "C0EONLY",
      name: "east-only",
      lastUpdated: "2026-11-10T09:00:00.000Z",
      teamId: "T0EAST",
    },
  });

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockImplementation((async () => {
      return {
        id: ROW_ID,
        miscData: storedMiscData,
      } as unknown as WorkspaceProjectAuthToken;
    }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
    .mockImplementation((async (data: JSONObject) => {
      written.push(data);
      return 1;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("replaceSlackChannelCache for an organization's installation", () => {
  test("a channel the editor keeps keeps its workspace", async () => {
    expect(
      await save(edited({ general: "C0WGEN", "east-only": "C0EONLY" })),
    ).toEqual({
      general: {
        id: "C0WGEN",
        name: "general",
        lastUpdated: SAVED_AT,
        teamId: "T0WEST",
      },
      "east-only": {
        id: "C0EONLY",
        name: "east-only",
        lastUpdated: SAVED_AT,
        teamId: "T0EAST",
      },
    });
  });

  test("a channel renamed in the editor keeps its workspace: found by its id", async () => {
    expect(await save(edited({ "east-alerts": "C0EONLY" }))).toEqual({
      "east-alerts": {
        id: "C0EONLY",
        name: "east-alerts",
        lastUpdated: SAVED_AT,
        teamId: "T0EAST",
      },
    });
  });

  test("a name pointed at another channel takes that channel's workspace, not the name's", async () => {
    expect((await save(edited({ general: "C0EONLY" })))["general"]).toEqual({
      id: "C0EONLY",
      name: "general",
      lastUpdated: SAVED_AT,
      teamId: "T0EAST",
    });
  });

  test("a channel added by hand, by an id never listed, has no workspace", async () => {
    expect((await save(edited({ "war-room": "C0HAND" })))["war-room"]).toEqual({
      id: "C0HAND",
      name: "war-room",
      lastUpdated: SAVED_AT,
    });
  });

  test("a workspace given with the channel is kept", async () => {
    expect(
      (
        await save({
          general: {
            id: "C0WGEN",
            name: "general",
            lastUpdated: SAVED_AT,
            teamId: "T0EAST",
          },
        })
      )["general"]?.teamId,
    ).toBe("T0EAST");
  });

  test("every other field of the connection is carried over", async () => {
    await save(edited({ general: "C0WGEN" }));

    const miscData: SlackMiscData = (written[0]!["data"] as JSONObject)[
      "miscData"
    ] as unknown as SlackMiscData;

    expect(miscData.isEnterpriseInstall).toBe(true);
    expect(miscData.defaultWorkspaceId).toBe("T0WEST");
    expect(miscData.workspaces).toEqual([
      { id: "T0EAST", name: "Acme East" },
      { id: "T0WEST", name: "Acme West" },
    ]);
    expect(miscData.workspacesReadAt).toBe("2026-11-11T08:58:00.000Z");
    expect(written[0]!["id"]).toBe(ROW_ID);
  });

  test("a stored entry that is not a channel is passed over", async () => {
    storedMiscData = organizationMiscData({
      broken: null as unknown as SlackChannelCache[string],
      nameless: {
        name: "nameless",
        teamId: "T0EAST",
      } as unknown as SlackChannelCache[string],
      general: {
        id: "C0WGEN",
        name: "general",
        lastUpdated: "2026-11-10T09:00:00.000Z",
        teamId: "T0WEST",
      },
    });

    expect(await save(edited({ general: "C0WGEN", other: "C0OTHER" }))).toEqual(
      {
        general: {
          id: "C0WGEN",
          name: "general",
          lastUpdated: SAVED_AT,
          teamId: "T0WEST",
        },
        other: { id: "C0OTHER", name: "other", lastUpdated: SAVED_AT },
      },
    );
  });
});

describe("updateSlackOrganization: another default workspace", () => {
  // A channel typed into the channel list by hand: no workspace.
  const TYPED: SlackChannelCache = {
    "ops-typed": {
      id: "C0TYPED",
      name: "ops-typed",
      lastUpdated: "2026-11-10T09:00:00.000Z",
    },
  };

  async function update(data: {
    defaultWorkspaceId?: string;
  }): Promise<SlackMiscData> {
    await WorkspaceProjectAuthTokenService.updateSlackOrganization({
      projectId: PROJECT_ID,
      workspaceProjectId: "E0ACME",
      ...data,
    });

    expect(written).toHaveLength(1);

    return (written[0]!["data"] as JSONObject)[
      "miscData"
    ] as unknown as SlackMiscData;
  }

  test("REGRESSION: the old default's cached channels are looked up again; the new default's and those typed by hand stay", async () => {
    storedMiscData = {
      ...storedMiscData!,
      channelCache: { ...storedMiscData!.channelCache, ...TYPED },
    };

    const miscData: SlackMiscData = await update({
      defaultWorkspaceId: "T0EAST",
    });

    expect(miscData.defaultWorkspaceId).toBe("T0EAST");
    // West's #general was the default's: a rule naming no workspace finds East's now.
    expect(Object.keys(miscData.channelCache || {}).sort()).toEqual([
      "east-only",
      "ops-typed",
    ]);
    expect(miscData.channelCache?.["east-only"]?.teamId).toBe("T0EAST");
  });

  test("the same default again leaves the cache as it is", async () => {
    const before: SlackChannelCache = { ...storedMiscData!.channelCache };

    const miscData: SlackMiscData = await update({
      defaultWorkspaceId: "T0WEST",
    });

    expect(miscData.channelCache).toEqual(before);
  });

  test("reading the workspaces, with no default given, leaves the cache as it is", async () => {
    const before: SlackChannelCache = { ...storedMiscData!.channelCache };

    await WorkspaceProjectAuthTokenService.updateSlackOrganization({
      projectId: PROJECT_ID,
      workspaceProjectId: "E0ACME",
      workspaces: [
        { id: "T0EAST", name: "Acme East" },
        { id: "T0WEST", name: "Acme West" },
      ],
    });

    const miscData: SlackMiscData = (written[0]!["data"] as JSONObject)[
      "miscData"
    ] as unknown as SlackMiscData;

    expect(miscData.channelCache).toEqual(before);
    expect(miscData.defaultWorkspaceId).toBe("T0WEST");
  });
});

describe("replaceSlackChannelCache for one workspace (as before)", () => {
  test("the channels are saved as the editor sent them", async () => {
    storedMiscData = {
      teamId: "T0SOLO",
      teamName: "Solo",
      botUserId: "U0BOT",
      channelCache: {
        general: {
          id: "C0GEN",
          name: "general",
          lastUpdated: "2026-11-10T09:00:00.000Z",
        },
      },
    };

    const channelCache: SlackChannelCache = edited({
      general: "C0GEN",
      Ops: "C0OPS",
    });

    expect(await save(channelCache)).toEqual(channelCache);
  });

  test("a connection with no channels cached yet saves the editor's", async () => {
    storedMiscData = {
      teamId: "T0SOLO",
      teamName: "Solo",
      botUserId: "U0BOT",
    };

    expect(await save(edited({ general: "C0GEN" }))).toEqual(
      edited({ general: "C0GEN" }),
    );
  });

  test("a connection with no miscData saves the editor's", async () => {
    storedMiscData = undefined;

    expect(await save(edited({ general: "C0GEN" }))).toEqual(
      edited({ general: "C0GEN" }),
    );
  });
});
