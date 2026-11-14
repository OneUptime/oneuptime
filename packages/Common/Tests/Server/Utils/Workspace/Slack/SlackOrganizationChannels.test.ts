import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceProjectAuthToken, {
  SlackChannelCache,
  SlackMiscData,
  SlackOrganizationWorkspace,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../../../Server/Utils/Logger";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import SlackOrganization, {
  SlackOrganizationConnection,
  SlackWorkspaceNotAddedException,
} from "../../../../../Server/Utils/Workspace/Slack/SlackOrganization";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import OneUptimeDate from "../../../../../Types/Date";
import Dictionary from "../../../../../Types/Dictionary";
import BadRequestException from "../../../../../Types/Exception/BadRequestException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceMessagePayload from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * THE CHANNELS OF A SLACK ENTERPRISE ORGANIZATION (SlackUtil, for a project
 * connected to a whole organization - SlackOrganization).
 *
 * The organization's bot token lists and creates channels per workspace,
 * told which with team_id. Every workspace OneUptime was added to is
 * listed, the default one first; a channel is looked for in the workspace a
 * rule names, or - when it names none - in the default workspace first,
 * then the others. The project's channel cache holds one channel per name:
 * the default workspace's where the workspaces' names meet.
 *
 * Slack is stood in for at the HTTP layer (API.post), answering as its Web
 * API does, per workspace (team_id); the project's connection is a stored
 * row its reads and writes go to.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000001",
);

const NOW: Date = new Date("2026-11-11T09:00:00.000Z");
const NOW_TEXT: string = OneUptimeDate.toString(NOW);

const ORGANIZATION_TOKEN: string = "xoxb-acme-organization";
const WORKSPACE_TOKEN: string = "xoxb-acme-solo";

const WEST: SlackOrganizationWorkspace = { id: "T0WEST", name: "Acme West" };
const EAST: SlackOrganizationWorkspace = { id: "T0EAST", name: "Acme East" };
const NORTH: SlackOrganizationWorkspace = { id: "T0NORTH", name: "Acme North" };
const SOUTH: SlackOrganizationWorkspace = { id: "T0SOUTH", name: "Acme South" };

// The workspace a request without team_id is for: a connection to one workspace.
const OWN_WORKSPACE: string = "";

// What a rule picking Acme East is told once OneUptime is removed from it.
const NOT_ADDED_TO_EAST: string =
  "OneUptime is no longer added to the Acme East workspace of Acme Corp. Add it again in Slack's organization settings, or pick another workspace on the rule.";

interface SlackCall {
  method: string;
  body: JSONObject;
  authorization: string;
}

let calls: Array<SlackCall>;
// Each workspace's channels, page by page (conversations.list).
let channelPages: Record<string, Array<Array<JSONObject>>>;
// What conversations.list is refused with, per workspace.
let refusals: Map<string, string>;
// What auth.teams.list lists.
let workspacesSlackLists: Array<SlackOrganizationWorkspace>;
// What conversations.create answers.
let createAnswer: JSONObject | null;
// What chat.postMessage is refused with, if anything.
let postRefusal: string | null;

// The project's connection, as stored.
let stored: WorkspaceProjectAuthToken | null;
let cacheWrites: number;

function slackChannel(id: string, name: string): JSONObject {
  return { id: id, name: name, is_archived: false };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function minutesAgo(minutes: number): string {
  return OneUptimeDate.toString(OneUptimeDate.addRemoveMinutes(NOW, -minutes));
}

function organizationRow(
  miscData: Partial<SlackMiscData> = {},
): WorkspaceProjectAuthToken {
  return {
    authToken: ORGANIZATION_TOKEN,
    workspaceProjectId: "E0ACME",
    workspaceType: WorkspaceType.Slack,
    miscData: {
      teamId: "E0ACME",
      teamName: "Acme Corp",
      botUserId: "U0BOT",
      isEnterpriseInstall: true,
      enterpriseId: "E0ACME",
      enterpriseName: "Acme Corp",
      workspaces: [EAST, NORTH, WEST],
      workspacesReadAt: minutesAgo(2),
      defaultWorkspaceId: WEST.id,
      ...miscData,
    },
  } as unknown as WorkspaceProjectAuthToken;
}

function workspaceRow(
  miscData: Partial<SlackMiscData> = {},
): WorkspaceProjectAuthToken {
  return {
    authToken: WORKSPACE_TOKEN,
    workspaceProjectId: "T0SOLO",
    workspaceType: WorkspaceType.Slack,
    miscData: {
      teamId: "T0SOLO",
      teamName: "Solo",
      botUserId: "U0BOT",
      ...miscData,
    },
  } as unknown as WorkspaceProjectAuthToken;
}

function storedCache(): SlackChannelCache {
  return (
    ((stored?.miscData as SlackMiscData | undefined)?.channelCache as
      | SlackChannelCache
      | undefined) || {}
  );
}

function organization(): SlackOrganizationConnection {
  return SlackOrganization.readConnection(stored)!;
}

function methodCalls(method: string): Array<SlackCall> {
  return calls.filter((call: SlackCall): boolean => {
    return call.method === method;
  });
}

// The workspaces conversations.list was asked for, in order - a page each.
function listedWorkspaces(): Array<string | undefined> {
  return methodCalls("conversations.list").map(
    (call: SlackCall): string | undefined => {
      return call.body["team_id"] as string | undefined;
    },
  );
}

function errorLines(): Array<string> {
  return jest
    .mocked(logger.error)
    .mock.calls.map((call: Array<unknown>): string => {
      return String(call[0]);
    });
}

function payload(
  overrides: Partial<WorkspaceMessagePayload>,
): WorkspaceMessagePayload {
  return {
    _type: "WorkspaceMessagePayload",
    workspaceType: WorkspaceType.Slack,
    channelNames: [],
    channelIds: [],
    messageBlocks: [
      {
        _type: "WorkspacePayloadMarkdown",
        text: "**Incident #12** is acknowledged.",
      },
    ],
    ...overrides,
  } as WorkspaceMessagePayload;
}

beforeEach(() => {
  calls = [];
  refusals = new Map();
  createAnswer = null;
  postRefusal = null;
  cacheWrites = 0;
  workspacesSlackLists = [EAST, NORTH, WEST];
  channelPages = {
    [WEST.id]: [
      [slackChannel("C0WGEN", "general"), slackChannel("C0WOPS", "west-ops")],
    ],
    [EAST.id]: [
      [slackChannel("C0EGEN", "general"), slackChannel("C0EONLY", "East-Only")],
    ],
    [NORTH.id]: [
      [slackChannel("C0NGEN", "general")],
      [slackChannel("C0NONLY", "north-only")],
    ],
    [SOUTH.id]: [[slackChannel("C0SONLY", "south-only")]],
    [OWN_WORKSPACE]: [
      [slackChannel("C0GEN", "general"), slackChannel("C0OPS", "Ops")],
    ],
  };
  stored = organizationRow();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  jest.spyOn(API, "post").mockImplementation((async (request: {
    url: URL;
    data: JSONObject;
    headers: Dictionary<string>;
  }): Promise<HTTPResponse<JSONObject>> => {
    const method: string = request.url.toString().split("/").pop() || "";
    const body: JSONObject = { ...(request.data || {}) };

    calls.push({
      method: method,
      body: body,
      authorization: String(request.headers?.["Authorization"] || ""),
    });

    let answer: JSONObject;

    if (method === "conversations.list") {
      const teamId: string = (body["team_id"] as string) || OWN_WORKSPACE;
      const pages: Array<Array<JSONObject>> = channelPages[teamId] || [];
      const index: number = body["cursor"] ? Number(body["cursor"]) : 0;

      answer = refusals.has(teamId)
        ? { ok: false, error: refusals.get(teamId)! }
        : {
            ok: true,
            channels: pages[index] || [],
            response_metadata: {
              next_cursor: index + 1 < pages.length ? String(index + 1) : "",
            },
          };
    } else if (method === "conversations.create") {
      answer = createAnswer || {
        ok: true,
        channel: { id: "C0NEW", name: body["name"] },
      };
    } else if (method === "auth.teams.list") {
      answer = {
        ok: true,
        teams: workspacesSlackLists.map(
          (workspace: SlackOrganizationWorkspace): JSONObject => {
            return { id: workspace.id, name: workspace.name };
          },
        ),
      };
    } else if (method === "chat.postMessage") {
      answer = postRefusal
        ? { ok: false, error: postRefusal }
        : {
            ok: true,
            ts: "1762851600.000100",
            channel: body["channel"],
          };
    } else {
      answer = { ok: false, error: "unknown_method" };
    }

    return {
      jsonData: answer,
      data: answer,
    } as unknown as HTTPResponse<JSONObject>;
  }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async () => {
      return stored ? clone(stored) : null;
    }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "refreshAuthToken")
    .mockImplementation((async (data: { miscData: SlackMiscData }) => {
      cacheWrites++;

      if (stored) {
        stored.miscData = clone(data.miscData);
      }
    }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "updateSlackOrganization")
    .mockImplementation((async (data: {
      workspaces?: Array<SlackOrganizationWorkspace> | undefined;
      workspacesReadAt?: Date | undefined;
    }) => {
      if (stored && data.workspaces) {
        const miscData: SlackMiscData = stored.miscData as SlackMiscData;
        miscData.workspaces = clone(data.workspaces);
        miscData.workspacesReadAt = OneUptimeDate.toString(
          data.workspacesReadAt || NOW,
        );
      }
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(logger.error).mockClear();
});

describe("getAllWorkspaceChannels for an organization's installation", () => {
  test("each workspace is listed with its team_id - the default first, then by name - with the organization's token", async () => {
    await SlackUtil.getAllWorkspaceChannels({
      authToken: ORGANIZATION_TOKEN,
      projectId: PROJECT_ID,
      organization: organization(),
    });

    expect(listedWorkspaces()).toEqual([WEST.id, EAST.id, NORTH.id, NORTH.id]);
    expect(
      calls.every((call: SlackCall): boolean => {
        return call.authorization === `Bearer ${ORGANIZATION_TOKEN}`;
      }),
    ).toBe(true);
    // The workspaces were listed two minutes ago: Slack is not asked again.
    expect(methodCalls("auth.teams.list")).toHaveLength(0);
  });

  test("channels are keyed by id - a name can be a channel in each workspace - and each says its workspace", async () => {
    const channels: Dictionary<WorkspaceChannel> =
      await SlackUtil.getAllWorkspaceChannels({
        authToken: ORGANIZATION_TOKEN,
        projectId: PROJECT_ID,
        organization: organization(),
      });

    expect(channels).toEqual({
      C0WGEN: {
        id: "C0WGEN",
        name: "general",
        workspaceType: WorkspaceType.Slack,
        teamId: WEST.id,
      },
      C0WOPS: {
        id: "C0WOPS",
        name: "west-ops",
        workspaceType: WorkspaceType.Slack,
        teamId: WEST.id,
      },
      C0EGEN: {
        id: "C0EGEN",
        name: "general",
        workspaceType: WorkspaceType.Slack,
        teamId: EAST.id,
      },
      C0EONLY: {
        id: "C0EONLY",
        name: "East-Only",
        workspaceType: WorkspaceType.Slack,
        teamId: EAST.id,
      },
      C0NGEN: {
        id: "C0NGEN",
        name: "general",
        workspaceType: WorkspaceType.Slack,
        teamId: NORTH.id,
      },
      C0NONLY: {
        id: "C0NONLY",
        name: "north-only",
        workspaceType: WorkspaceType.Slack,
        teamId: NORTH.id,
      },
    });
  });

  test("every page of a workspace is read, its cursor sent with its team_id", async () => {
    await SlackUtil.getAllWorkspaceChannels({
      authToken: ORGANIZATION_TOKEN,
      projectId: PROJECT_ID,
      organization: organization(),
    });

    const northPages: Array<JSONObject> = methodCalls("conversations.list")
      .filter((call: SlackCall): boolean => {
        return call.body["team_id"] === NORTH.id;
      })
      .map((call: SlackCall): JSONObject => {
        return call.body;
      });

    expect(northPages).toEqual([
      {
        limit: 999,
        types: "public_channel,private_channel",
        exclude_archived: true,
        team_id: NORTH.id,
      },
      {
        limit: 999,
        types: "public_channel,private_channel",
        exclude_archived: true,
        team_id: NORTH.id,
        cursor: "1",
      },
    ]);
  });

  test("the cache is keyed by lower-cased name; where names meet, the default workspace's channel is the one cached", async () => {
    await SlackUtil.getAllWorkspaceChannels({
      authToken: ORGANIZATION_TOKEN,
      projectId: PROJECT_ID,
      organization: organization(),
    });

    expect(storedCache()).toEqual({
      general: {
        id: "C0WGEN",
        name: "general",
        workspaceType: WorkspaceType.Slack,
        lastUpdated: NOW_TEXT,
        teamId: WEST.id,
      },
      "west-ops": {
        id: "C0WOPS",
        name: "west-ops",
        workspaceType: WorkspaceType.Slack,
        lastUpdated: NOW_TEXT,
        teamId: WEST.id,
      },
      "east-only": {
        id: "C0EONLY",
        name: "East-Only",
        workspaceType: WorkspaceType.Slack,
        lastUpdated: NOW_TEXT,
        teamId: EAST.id,
      },
      "north-only": {
        id: "C0NONLY",
        name: "north-only",
        workspaceType: WorkspaceType.Slack,
        lastUpdated: NOW_TEXT,
        teamId: NORTH.id,
      },
    });
    // The rest of the connection is carried over as it was.
    expect((stored!.miscData as SlackMiscData).defaultWorkspaceId).toBe(
      WEST.id,
    );
    expect((stored!.miscData as SlackMiscData).isEnterpriseInstall).toBe(true);
  });

  test("a workspace that refuses is logged and left out; the others are listed", async () => {
    refusals.set(EAST.id, "team_access_not_granted");

    const channels: Dictionary<WorkspaceChannel> =
      await SlackUtil.getAllWorkspaceChannels({
        authToken: ORGANIZATION_TOKEN,
        projectId: PROJECT_ID,
        organization: organization(),
      });

    expect(Object.keys(channels).sort()).toEqual([
      "C0NGEN",
      "C0NONLY",
      "C0WGEN",
      "C0WOPS",
    ]);
    expect(errorLines()).toContain(
      "Could not list the channels of Slack workspace T0EAST of an organization's installation.",
    );
    // The workspace after the one refused is still listed.
    expect(listedWorkspaces()).toEqual([WEST.id, EAST.id, NORTH.id, NORTH.id]);
  });

  test("a listing the default workspace refused does not cache another workspace's channel over the default's", async () => {
    // Cached by an earlier listing: the default workspace's #general.
    (stored!.miscData as SlackMiscData).channelCache = {
      general: {
        id: "C0WGEN",
        name: "general",
        lastUpdated: minutesAgo(60),
        teamId: WEST.id,
      },
    };
    refusals.set(WEST.id, "ratelimited");

    await SlackUtil.getAllWorkspaceChannels({
      authToken: ORGANIZATION_TOKEN,
      projectId: PROJECT_ID,
      organization: organization(),
    });

    expect(storedCache()["general"]).toEqual({
      id: "C0WGEN",
      name: "general",
      lastUpdated: minutesAgo(60),
      teamId: WEST.id,
    });
    // The other workspaces' own channels are cached.
    expect(storedCache()["east-only"]?.teamId).toBe(EAST.id);
    expect(storedCache()["north-only"]?.teamId).toBe(NORTH.id);
  });

  test("every workspace refusing: Slack's first refusal is thrown, and nothing is cached", async () => {
    refusals.set(WEST.id, "team_access_not_granted");
    refusals.set(EAST.id, "ratelimited");
    refusals.set(NORTH.id, "invalid_auth");

    const listing: Promise<Dictionary<WorkspaceChannel>> =
      SlackUtil.getAllWorkspaceChannels({
        authToken: ORGANIZATION_TOKEN,
        projectId: PROJECT_ID,
        organization: organization(),
      });

    await expect(listing).rejects.toBeInstanceOf(BadRequestException);
    await expect(listing).rejects.toThrow(
      "Error from Slack team_access_not_granted",
    );
    expect(listedWorkspaces()).toEqual([WEST.id, EAST.id, NORTH.id]);
    expect(cacheWrites).toBe(0);
  });

  test("added to no workspace yet: nothing is listed, and no channels", async () => {
    stored = organizationRow({ workspaces: [], defaultWorkspaceId: undefined });

    const channels: Dictionary<WorkspaceChannel> =
      await SlackUtil.getAllWorkspaceChannels({
        authToken: ORGANIZATION_TOKEN,
        projectId: PROJECT_ID,
        organization: organization(),
      });

    expect(channels).toEqual({});
    expect(methodCalls("conversations.list")).toHaveLength(0);
  });

  test("a default workspace Slack no longer lists is still listed first", async () => {
    stored = organizationRow({
      workspaces: [EAST, NORTH],
      defaultWorkspaceId: undefined,
    });
    const connection: SlackOrganizationConnection = {
      ...organization(),
      // Chosen before Slack listed any - kept (pickDefaultWorkspaceId).
      defaultWorkspaceId: WEST.id,
    };

    await SlackUtil.getAllWorkspaceChannels({
      authToken: ORGANIZATION_TOKEN,
      projectId: PROJECT_ID,
      organization: connection,
    });

    expect(listedWorkspaces()).toEqual([WEST.id, EAST.id, NORTH.id, NORTH.id]);
  });
});

describe("getAllWorkspaceChannels for one workspace (as before)", () => {
  test("one listing without team_id; keyed by name; no workspace on the channels or in the cache", async () => {
    stored = workspaceRow();

    const channels: Dictionary<WorkspaceChannel> =
      await SlackUtil.getAllWorkspaceChannels({
        authToken: WORKSPACE_TOKEN,
        projectId: PROJECT_ID,
      });

    expect(channels).toEqual({
      general: {
        id: "C0GEN",
        name: "general",
        workspaceType: WorkspaceType.Slack,
      },
      Ops: { id: "C0OPS", name: "Ops", workspaceType: WorkspaceType.Slack },
    });
    expect(listedWorkspaces()).toEqual([undefined]);
    expect("team_id" in methodCalls("conversations.list")[0]!.body).toBe(false);
    expect(storedCache()).toEqual({
      general: {
        id: "C0GEN",
        name: "general",
        workspaceType: WorkspaceType.Slack,
        lastUpdated: NOW_TEXT,
      },
      ops: {
        id: "C0OPS",
        name: "Ops",
        workspaceType: WorkspaceType.Slack,
        lastUpdated: NOW_TEXT,
      },
    });
  });

  test("a refusal is thrown as it was", async () => {
    stored = workspaceRow();
    refusals.set(OWN_WORKSPACE, "invalid_auth");

    await expect(
      SlackUtil.getAllWorkspaceChannels({
        authToken: WORKSPACE_TOKEN,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("Error from Slack invalid_auth");
  });

  test("an organization given as null lists as one workspace", async () => {
    stored = workspaceRow();

    await SlackUtil.getAllWorkspaceChannels({
      authToken: WORKSPACE_TOKEN,
      projectId: PROJECT_ID,
      organization: null,
    });

    expect(listedWorkspaces()).toEqual([undefined]);
  });
});

describe("getWorkspaceChannelByName for an organization's installation", () => {
  beforeEach(() => {
    (stored!.miscData as SlackMiscData).channelCache = {
      general: {
        id: "C0WGEN",
        name: "general",
        lastUpdated: minutesAgo(60),
        teamId: WEST.id,
      },
    };
  });

  test("a channel cached as the rule's workspace's is used, and Slack is not asked", async () => {
    expect(
      await SlackUtil.getWorkspaceChannelByName({
        authToken: ORGANIZATION_TOKEN,
        channelName: "#General",
        projectId: PROJECT_ID,
        teamId: WEST.id,
      }),
    ).toEqual({
      id: "C0WGEN",
      name: "general",
      workspaceType: WorkspaceType.Slack,
      teamId: WEST.id,
    });
    expect(calls).toHaveLength(0);
  });

  test("a rule naming no workspace uses the cached channel - the default's", async () => {
    expect(
      (
        await SlackUtil.getWorkspaceChannelByName({
          authToken: ORGANIZATION_TOKEN,
          channelName: "general",
          projectId: PROJECT_ID,
        })
      )?.id,
    ).toBe("C0WGEN");
    expect(calls).toHaveLength(0);
  });

  test("a rule naming another workspace: only that workspace is looked in, and its channel is found", async () => {
    expect(
      await SlackUtil.getWorkspaceChannelByName({
        authToken: ORGANIZATION_TOKEN,
        channelName: "general",
        projectId: PROJECT_ID,
        teamId: EAST.id,
      }),
    ).toEqual({
      id: "C0EGEN",
      name: "general",
      workspaceType: WorkspaceType.Slack,
      teamId: EAST.id,
    });
    expect(listedWorkspaces()).toEqual([EAST.id]);
  });

  test("... and the default workspace's channel stays cached under the name", async () => {
    await SlackUtil.getWorkspaceChannelByName({
      authToken: ORGANIZATION_TOKEN,
      channelName: "general",
      projectId: PROJECT_ID,
      teamId: EAST.id,
    });

    expect(storedCache()["general"]).toEqual({
      id: "C0WGEN",
      name: "general",
      lastUpdated: minutesAgo(60),
      teamId: WEST.id,
    });

    // So a rule naming no workspace still posts in the default's.
    calls = [];
    expect(
      (
        await SlackUtil.getWorkspaceChannelByName({
          authToken: ORGANIZATION_TOKEN,
          channelName: "general",
          projectId: PROJECT_ID,
        })
      )?.id,
    ).toBe("C0WGEN");
    expect(calls).toHaveLength(0);
  });

  test("a channel of a workspace that is not the default is cached as its own when no other has the name", async () => {
    await SlackUtil.getWorkspaceChannelByName({
      authToken: ORGANIZATION_TOKEN,
      channelName: "east-only",
      projectId: PROJECT_ID,
      teamId: EAST.id,
    });

    expect(storedCache()["east-only"]).toEqual({
      id: "C0EONLY",
      name: "East-Only",
      workspaceType: WorkspaceType.Slack,
      lastUpdated: NOW_TEXT,
      teamId: EAST.id,
    });

    // Found in the cache the next time, for that workspace.
    calls = [];
    expect(
      (
        await SlackUtil.getWorkspaceChannelByName({
          authToken: ORGANIZATION_TOKEN,
          channelName: "East-Only",
          projectId: PROJECT_ID,
          teamId: EAST.id,
        })
      )?.teamId,
    ).toBe(EAST.id);
    expect(calls).toHaveLength(0);
  });

  test("no workspace named: the default's first, then the others by name - until it is found", async () => {
    const channel: WorkspaceChannel | null =
      await SlackUtil.getWorkspaceChannelByName({
        authToken: ORGANIZATION_TOKEN,
        channelName: "north-only",
        projectId: PROJECT_ID,
      });

    expect(channel).toEqual({
      id: "C0NONLY",
      name: "north-only",
      workspaceType: WorkspaceType.Slack,
      teamId: NORTH.id,
    });
    expect(listedWorkspaces()).toEqual([WEST.id, EAST.id, NORTH.id, NORTH.id]);
  });

  test("found in the default workspace: no other workspace is asked", async () => {
    expect(
      (
        await SlackUtil.getWorkspaceChannelByName({
          authToken: ORGANIZATION_TOKEN,
          channelName: "west-ops",
          projectId: PROJECT_ID,
        })
      )?.teamId,
    ).toBe(WEST.id);
    expect(listedWorkspaces()).toEqual([WEST.id]);
  });

  test("a rule's workspace is the only one looked in: another workspace's channel is not the rule's", async () => {
    expect(
      await SlackUtil.getWorkspaceChannelByName({
        authToken: ORGANIZATION_TOKEN,
        channelName: "north-only",
        projectId: PROJECT_ID,
        teamId: EAST.id,
      }),
    ).toBeNull();
    expect(listedWorkspaces()).toEqual([EAST.id]);
  });

  test("a workspace that refuses is skipped and logged; the others are looked in", async () => {
    refusals.set(WEST.id, "team_access_not_granted");

    expect(
      (
        await SlackUtil.getWorkspaceChannelByName({
          authToken: ORGANIZATION_TOKEN,
          channelName: "east-only",
          projectId: PROJECT_ID,
        })
      )?.id,
    ).toBe("C0EONLY");
    expect(errorLines()).toContain(
      "Could not look for a channel in Slack workspace T0WEST of an organization's installation.",
    );
  });

  test("the rule's workspace refusing OneUptime (removed since Slack listed it): said plainly - no other workspace is looked in", async () => {
    refusals.set(EAST.id, "team_access_not_granted");

    const looking: Promise<WorkspaceChannel | null> =
      SlackUtil.getWorkspaceChannelByName({
        authToken: ORGANIZATION_TOKEN,
        channelName: "east-only",
        projectId: PROJECT_ID,
        teamId: EAST.id,
      });

    await expect(looking).rejects.toBeInstanceOf(
      SlackWorkspaceNotAddedException,
    );
    await expect(looking).rejects.toThrow(NOT_ADDED_TO_EAST);
    expect(listedWorkspaces()).toEqual([EAST.id]);
  });

  test("the rule's workspace refusing for another reason: no channel, and nothing thrown", async () => {
    refusals.set(EAST.id, "ratelimited");

    expect(
      await SlackUtil.getWorkspaceChannelByName({
        authToken: ORGANIZATION_TOKEN,
        channelName: "east-only",
        projectId: PROJECT_ID,
        teamId: EAST.id,
      }),
    ).toBeNull();
    expect(listedWorkspaces()).toEqual([EAST.id]);
  });

  test("a rule's workspace Slack no longer lists: refused by the name it had, before the cache or Slack is asked", async () => {
    stored = organizationRow({
      workspaces: [NORTH, WEST],
      removedWorkspaces: [EAST],
      channelCache: {
        "east-only": {
          id: "C0EONLY",
          name: "east-only",
          lastUpdated: minutesAgo(60),
          teamId: EAST.id,
        },
      },
    });

    const looking: Promise<WorkspaceChannel | null> =
      SlackUtil.getWorkspaceChannelByName({
        authToken: ORGANIZATION_TOKEN,
        channelName: "east-only",
        projectId: PROJECT_ID,
        teamId: EAST.id,
      });

    await expect(looking).rejects.toBeInstanceOf(
      SlackWorkspaceNotAddedException,
    );
    await expect(looking).rejects.toThrow(NOT_ADDED_TO_EAST);
    expect(calls).toEqual([]);
  });

  test("a rule naming no workspace, with one removed: the others are looked in as before", async () => {
    stored = organizationRow({
      workspaces: [NORTH, WEST],
      removedWorkspaces: [EAST],
    });

    expect(
      (
        await SlackUtil.getWorkspaceChannelByName({
          authToken: ORGANIZATION_TOKEN,
          channelName: "north-only",
          projectId: PROJECT_ID,
        })
      )?.id,
    ).toBe("C0NONLY");
    expect(listedWorkspaces()).not.toContain(EAST.id);
  });

  /*
   * #6784: an installation with no default stored - made before installs
   * stored one - whose default by name OneUptime was removed from. Read
   * again (Refresh on the card, Slack's team_access_revoked, or a list over
   * ten minutes old), the default moves to the first workspace left by name
   * and is stored, which drops the channels cached as the old one's. Before,
   * nothing was stored, and a rule that names no workspace kept finding its
   * channel cached in the workspace OneUptime had left.
   */
  test("REGRESSION: a default never stored that OneUptime was removed from - a rule naming no workspace finds its channel in the new default, not the one cached in the old", async () => {
    stored = organizationRow({
      workspaces: [EAST, NORTH, WEST],
      defaultWorkspaceId: undefined,
      channelCache: {
        general: {
          id: "C0EGEN",
          name: "general",
          lastUpdated: minutesAgo(60),
          teamId: EAST.id,
        },
      },
    });
    workspacesSlackLists = [NORTH, WEST];

    // The connection's own write, against the stored row.
    jest
      .mocked(WorkspaceProjectAuthTokenService.updateSlackOrganization)
      .mockRestore();
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async () => {
        return stored
          ? ({
              id: new ObjectID("c4000000-0000-4000-8000-0000000000aa"),
              miscData: clone(stored.miscData),
            } as unknown as WorkspaceProjectAuthToken)
          : null;
      }) as never);
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockImplementation((async (update: {
        data: { miscData: SlackMiscData };
      }) => {
        stored!.miscData = clone(update.data.miscData);
        return 1;
      }) as never);

    await SlackOrganization.getOfConnection({
      projectId: PROJECT_ID,
      projectAuth: clone(stored),
      refresh: true,
    });

    expect((stored.miscData as SlackMiscData).defaultWorkspaceId).toBe(
      NORTH.id,
    );
    expect(storedCache()["general"]).toBeUndefined();

    const channel: WorkspaceChannel | null =
      await SlackUtil.getWorkspaceChannelByName({
        authToken: ORGANIZATION_TOKEN,
        channelName: "general",
        projectId: PROJECT_ID,
      });

    expect(channel?.id).toBe("C0NGEN");
    expect(channel?.teamId).toBe(NORTH.id);
    expect(listedWorkspaces()).toEqual([NORTH.id]);
  });

  test("a name no workspace has: none, after every workspace was looked in - and what was read is cached", async () => {
    expect(
      await SlackUtil.getWorkspaceChannelByName({
        authToken: ORGANIZATION_TOKEN,
        channelName: "nowhere",
        projectId: PROJECT_ID,
      }),
    ).toBeNull();
    expect(listedWorkspaces()).toEqual([WEST.id, EAST.id, NORTH.id, NORTH.id]);
    expect(Object.keys(storedCache()).sort()).toEqual([
      "east-only",
      "general",
      "north-only",
      "west-ops",
    ]);
    expect(storedCache()["general"]?.id).toBe("C0WGEN");
  });

  test("a channel cached before workspaces were (no teamId) is used for any workspace", async () => {
    (stored!.miscData as SlackMiscData).channelCache = {
      general: {
        id: "C0OLDGEN",
        name: "general",
        lastUpdated: minutesAgo(600),
      },
    };

    expect(
      await SlackUtil.getWorkspaceChannelByName({
        authToken: ORGANIZATION_TOKEN,
        channelName: "general",
        projectId: PROJECT_ID,
        teamId: EAST.id,
      }),
    ).toEqual({
      id: "C0OLDGEN",
      name: "general",
      workspaceType: WorkspaceType.Slack,
    });
    expect(calls).toHaveLength(0);
  });

  test("workspaces listed over ten minutes ago are listed again first: one OneUptime was just added to is looked in", async () => {
    (stored!.miscData as SlackMiscData).workspacesReadAt = minutesAgo(30);
    workspacesSlackLists = [EAST, NORTH, SOUTH, WEST];

    expect(
      (
        await SlackUtil.getWorkspaceChannelByName({
          authToken: ORGANIZATION_TOKEN,
          channelName: "south-only",
          projectId: PROJECT_ID,
        })
      )?.teamId,
    ).toBe(SOUTH.id);
    expect(methodCalls("auth.teams.list")).toHaveLength(1);
    expect(listedWorkspaces()).toEqual([
      WEST.id,
      EAST.id,
      NORTH.id,
      NORTH.id,
      SOUTH.id,
    ]);
    // Kept for the next time.
    expect((stored!.miscData as SlackMiscData).workspaces).toEqual([
      EAST,
      NORTH,
      SOUTH,
      WEST,
    ]);
  });

  test("the project's connection unreadable: Slack is asked as for one workspace", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockRejectedValue(new Error("database unavailable") as never);

    expect(
      (
        await SlackUtil.getWorkspaceChannelByName({
          authToken: ORGANIZATION_TOKEN,
          channelName: "general",
          projectId: PROJECT_ID,
          teamId: EAST.id,
        })
      )?.id,
    ).toBe("C0GEN");
    expect(listedWorkspaces()).toEqual([undefined]);
  });
});

describe("getWorkspaceChannelByName for one workspace (as before)", () => {
  test("no team_id is sent; the channel is found and cached without a workspace", async () => {
    stored = workspaceRow();

    expect(
      await SlackUtil.getWorkspaceChannelByName({
        authToken: WORKSPACE_TOKEN,
        channelName: "#OPS",
        projectId: PROJECT_ID,
      }),
    ).toEqual({ id: "C0OPS", name: "Ops", workspaceType: WorkspaceType.Slack });
    expect(listedWorkspaces()).toEqual([undefined]);
    expect(storedCache()["ops"]).toEqual({
      id: "C0OPS",
      name: "Ops",
      workspaceType: WorkspaceType.Slack,
      lastUpdated: NOW_TEXT,
    });
  });

  test("a teamId given anyway changes nothing: no team_id is sent", async () => {
    stored = workspaceRow();

    expect(
      (
        await SlackUtil.getWorkspaceChannelByName({
          authToken: WORKSPACE_TOKEN,
          channelName: "general",
          projectId: PROJECT_ID,
          teamId: EAST.id,
        })
      )?.id,
    ).toBe("C0GEN");
    expect(listedWorkspaces()).toEqual([undefined]);
  });

  test("a refusal is thrown as it was", async () => {
    stored = workspaceRow();
    refusals.set(OWN_WORKSPACE, "invalid_auth");

    await expect(
      SlackUtil.getWorkspaceChannelByName({
        authToken: WORKSPACE_TOKEN,
        channelName: "general",
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("Error from Slack invalid_auth");
  });
});

describe("createChannel for an organization's installation", () => {
  test("in the workspace the rule names: team_id is sent, and the channel says its workspace", async () => {
    const channel: WorkspaceChannel = await SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "inc-12-db-down",
      projectId: PROJECT_ID,
      teamId: EAST.id,
    });

    expect(methodCalls("conversations.create")).toHaveLength(1);
    expect(methodCalls("conversations.create")[0]!.body).toEqual({
      name: "inc-12-db-down",
      team_id: EAST.id,
    });
    expect(methodCalls("conversations.create")[0]!.authorization).toBe(
      `Bearer ${ORGANIZATION_TOKEN}`,
    );
    expect(channel).toEqual({
      id: "C0NEW",
      name: "inc-12-db-down",
      workspaceType: WorkspaceType.Slack,
      teamId: EAST.id,
    });
    expect(storedCache()["inc-12-db-down"]).toEqual({
      id: "C0NEW",
      name: "inc-12-db-down",
      workspaceType: WorkspaceType.Slack,
      lastUpdated: NOW_TEXT,
      teamId: EAST.id,
    });
  });

  test("a rule naming no workspace: in the default one", async () => {
    const channel: WorkspaceChannel = await SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "inc-13",
      projectId: PROJECT_ID,
    });

    expect(methodCalls("conversations.create")[0]!.body["team_id"]).toBe(
      WEST.id,
    );
    expect(channel.teamId).toBe(WEST.id);
  });

  test("named as Slack names it, and private when asked", async () => {
    await SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "#Incident -INC-9",
      projectId: PROJECT_ID,
      isPrivate: true,
      teamId: NORTH.id,
    });

    expect(methodCalls("conversations.create")[0]!.body).toEqual({
      name: "incident-inc-9",
      is_private: true,
      team_id: NORTH.id,
    });
  });

  test("a channel created in another workspace is not cached over the default workspace's channel of the name", async () => {
    (stored!.miscData as SlackMiscData).channelCache = {
      "war-room": {
        id: "C0WWAR",
        name: "war-room",
        lastUpdated: minutesAgo(60),
        teamId: WEST.id,
      },
    };

    await SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "war-room",
      projectId: PROJECT_ID,
      teamId: EAST.id,
    });

    expect(storedCache()["war-room"]?.id).toBe("C0WWAR");
    expect(storedCache()["war-room"]?.teamId).toBe(WEST.id);
  });

  test("added to no workspace yet: refused before Slack is asked, naming the organization", async () => {
    stored = organizationRow({ workspaces: [], defaultWorkspaceId: undefined });

    const creating: Promise<WorkspaceChannel> = SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "inc-14",
      projectId: PROJECT_ID,
    });

    await expect(creating).rejects.toBeInstanceOf(BadRequestException);
    await expect(creating).rejects.toThrow(
      "OneUptime is installed for the Acme Corp organization but has not been added to any of its workspaces yet. Add it to a workspace in Slack's organization settings, then try again.",
    );
    expect(methodCalls("conversations.create")).toHaveLength(0);
  });

  test("added to no workspace when Slack is asked again either: refused", async () => {
    stored = organizationRow({
      workspaces: [],
      defaultWorkspaceId: undefined,
      workspacesReadAt: minutesAgo(45),
    });
    workspacesSlackLists = [];

    await expect(
      SlackUtil.createChannel({
        authToken: ORGANIZATION_TOKEN,
        channelName: "inc-14",
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("has not been added to any of its workspaces yet");
    expect(methodCalls("auth.teams.list")).toHaveLength(1);
    expect(methodCalls("conversations.create")).toHaveLength(0);
  });

  test("an organization Slack gave no name is called the Slack Enterprise organization", async () => {
    stored = organizationRow({
      workspaces: [],
      defaultWorkspaceId: undefined,
      enterpriseName: undefined,
      teamName: "",
    });

    await expect(
      SlackUtil.createChannel({
        authToken: ORGANIZATION_TOKEN,
        channelName: "inc-14",
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(
      "OneUptime is installed for the Slack Enterprise organization but has not been added to any of its workspaces yet.",
    );
  });

  test("added to a workspace since Slack listed none: created in it", async () => {
    stored = organizationRow({
      workspaces: [],
      defaultWorkspaceId: undefined,
      workspacesReadAt: minutesAgo(45),
    });
    workspacesSlackLists = [NORTH];

    const channel: WorkspaceChannel = await SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "inc-15",
      projectId: PROJECT_ID,
    });

    expect(methodCalls("conversations.create")[0]!.body["team_id"]).toBe(
      NORTH.id,
    );
    expect(channel.teamId).toBe(NORTH.id);
  });

  test("a name taken in the workspace is Slack's refusal, as before", async () => {
    createAnswer = { ok: false, error: "name_taken" };

    let refusal: unknown = null;

    try {
      await SlackUtil.createChannel({
        authToken: ORGANIZATION_TOKEN,
        channelName: "general",
        projectId: PROJECT_ID,
        teamId: EAST.id,
      });
    } catch (err) {
      refusal = err;
    }

    expect(refusal).toBeInstanceOf(BadRequestException);
    expect(SlackUtil.isChannelNameTakenError(refusal)).toBe(true);
    expect(methodCalls("conversations.create")[0]!.body["team_id"]).toBe(
      EAST.id,
    );
  });

  test("the organization its caller read is used: the project's connection is read once fewer", async () => {
    const reads: SpyInstance<
      typeof WorkspaceProjectAuthTokenService.getProjectAuth
    > = jest.mocked(WorkspaceProjectAuthTokenService.getProjectAuth);

    await SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "inc-16",
      projectId: PROJECT_ID,
      teamId: EAST.id,
    });

    const readsWhenNotGiven: number = reads.mock.calls.length;
    reads.mockClear();

    const channel: WorkspaceChannel = await SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "inc-17",
      projectId: PROJECT_ID,
      teamId: EAST.id,
      organization: organization(),
    });

    expect(reads.mock.calls.length).toBe(readsWhenNotGiven - 1);
    expect(channel.teamId).toBe(EAST.id);
    expect(methodCalls("conversations.create")[1]!.body["team_id"]).toBe(
      EAST.id,
    );
  });

  test("no organization given by its caller (null): one workspace's channel - no team_id, nothing read for it", async () => {
    const reads: SpyInstance<
      typeof WorkspaceProjectAuthTokenService.getProjectAuth
    > = jest.mocked(WorkspaceProjectAuthTokenService.getProjectAuth);

    stored = workspaceRow();
    reads.mockClear();

    const channel: WorkspaceChannel = await SlackUtil.createChannel({
      authToken: WORKSPACE_TOKEN,
      channelName: "inc-18",
      projectId: PROJECT_ID,
      organization: null,
    });

    expect(methodCalls("conversations.create")[0]!.body).toEqual({
      name: "inc-18",
    });
    expect(channel.teamId).toBeUndefined();
    // Only the channel cache's write reads it.
    expect(reads.mock.calls.length).toBeLessThanOrEqual(1);
  });

  test("a workspace the rule names that Slack no longer lists: refused by its name before Slack is asked - not created in another", async () => {
    stored = organizationRow({
      workspaces: [NORTH, WEST],
      removedWorkspaces: [EAST],
    });

    const creating: Promise<WorkspaceChannel> = SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "inc-19",
      projectId: PROJECT_ID,
      teamId: EAST.id,
    });

    await expect(creating).rejects.toBeInstanceOf(
      SlackWorkspaceNotAddedException,
    );
    await expect(creating).rejects.toThrow(NOT_ADDED_TO_EAST);
    expect(methodCalls("conversations.create")).toHaveLength(0);
  });

  test("Slack refusing the workspace at create (removed since it listed it): refused in plain words", async () => {
    createAnswer = { ok: false, error: "team_access_not_granted" };

    const creating: Promise<WorkspaceChannel> = SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "inc-20",
      projectId: PROJECT_ID,
      teamId: EAST.id,
    });

    await expect(creating).rejects.toBeInstanceOf(
      SlackWorkspaceNotAddedException,
    );
    await expect(creating).rejects.toThrow(NOT_ADDED_TO_EAST);
    expect(methodCalls("conversations.create")).toHaveLength(1);
  });

  test("a default chosen before, with Slack listing no workspace now: refused as added to none - Slack is not asked to create", async () => {
    stored = organizationRow({
      workspaces: [],
      defaultWorkspaceId: WEST.id,
      workspacesReadAt: minutesAgo(1),
    });

    await expect(
      SlackUtil.createChannel({
        authToken: ORGANIZATION_TOKEN,
        channelName: "inc-21",
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(
      "OneUptime is installed for the Acme Corp organization but has not been added to any of its workspaces yet.",
    );
    expect(methodCalls("conversations.create")).toHaveLength(0);
  });

  test("a default chosen before Slack listed any workspace: created in it - Slack decides", async () => {
    stored = organizationRow({
      workspaces: undefined,
      workspacesReadAt: undefined,
      defaultWorkspaceId: WEST.id,
    });

    const channel: WorkspaceChannel = await SlackUtil.createChannel({
      authToken: ORGANIZATION_TOKEN,
      channelName: "inc-22",
      projectId: PROJECT_ID,
      organization: SlackOrganization.readConnection(stored),
    });

    expect(methodCalls("conversations.create")[0]!.body["team_id"]).toBe(
      WEST.id,
    );
    expect(channel.teamId).toBe(WEST.id);
  });
});

describe("createChannel for one workspace (as before)", () => {
  test("no team_id is sent, and the channel says no workspace", async () => {
    stored = workspaceRow();

    const channel: WorkspaceChannel = await SlackUtil.createChannel({
      authToken: WORKSPACE_TOKEN,
      channelName: "inc-16",
      projectId: PROJECT_ID,
      teamId: EAST.id,
    });

    expect(methodCalls("conversations.create")[0]!.body).toEqual({
      name: "inc-16",
    });
    expect(channel).toEqual({
      id: "C0NEW",
      name: "inc-16",
      workspaceType: WorkspaceType.Slack,
    });
    expect(storedCache()["inc-16"]).toEqual({
      id: "C0NEW",
      name: "inc-16",
      workspaceType: WorkspaceType.Slack,
      lastUpdated: NOW_TEXT,
    });
  });
});

describe("doesChannelExist", () => {
  test("looks in the rule's workspace, for '#Name' as 'name'", async () => {
    const lookup: SpyInstance<typeof SlackUtil.getWorkspaceChannelByName> =
      jest.spyOn(SlackUtil, "getWorkspaceChannelByName");

    expect(
      await SlackUtil.doesChannelExist({
        authToken: ORGANIZATION_TOKEN,
        channelName: "#East-Only",
        projectId: PROJECT_ID,
        teamId: EAST.id,
      }),
    ).toBe(true);
    expect(lookup).toHaveBeenCalledWith({
      authToken: ORGANIZATION_TOKEN,
      channelName: "east-only",
      projectId: PROJECT_ID,
      teamId: EAST.id,
    });
    expect(listedWorkspaces()).toEqual([EAST.id]);
  });

  test("a channel only another workspace has: not the rule's", async () => {
    expect(
      await SlackUtil.doesChannelExist({
        authToken: ORGANIZATION_TOKEN,
        channelName: "north-only",
        projectId: PROJECT_ID,
        teamId: EAST.id,
      }),
    ).toBe(false);
  });

  test("a rule naming no workspace: no teamId is passed on, and any workspace's channel is found", async () => {
    const lookup: SpyInstance<typeof SlackUtil.getWorkspaceChannelByName> =
      jest.spyOn(SlackUtil, "getWorkspaceChannelByName");

    expect(
      await SlackUtil.doesChannelExist({
        authToken: ORGANIZATION_TOKEN,
        channelName: "north-only",
        projectId: PROJECT_ID,
      }),
    ).toBe(true);
    expect("teamId" in (lookup.mock.calls[0]![0] as JSONObject)).toBe(false);
  });
});

describe("sendMessage", () => {
  beforeEach(() => {
    (stored!.miscData as SlackMiscData).channelCache = {
      general: {
        id: "C0WGEN",
        name: "general",
        lastUpdated: minutesAgo(60),
        teamId: WEST.id,
      },
    };
  });

  function postedIn(): Array<unknown> {
    return methodCalls("chat.postMessage").map((call: SlackCall): unknown => {
      return call.body["channel"];
    });
  }

  test("a rule naming a workspace posts in its channel - not in the default workspace's of the same name", async () => {
    const response: WorkspaceSendMessageResponse = await SlackUtil.sendMessage({
      workspaceMessagePayload: payload({
        channelNames: ["#general"],
        teamId: EAST.id,
      }),
      authToken: ORGANIZATION_TOKEN,
      userId: "",
      projectId: PROJECT_ID,
    });

    expect(postedIn()).toEqual(["C0EGEN"]);
    expect(listedWorkspaces()).toEqual([EAST.id]);
    expect(response.errors).toEqual([]);
    expect(response.threads[0]?.channel.teamId).toBe(EAST.id);
  });

  test("a rule naming no workspace posts in the default workspace's channel", async () => {
    await SlackUtil.sendMessage({
      workspaceMessagePayload: payload({ channelNames: ["general"] }),
      authToken: ORGANIZATION_TOKEN,
      userId: "",
      projectId: PROJECT_ID,
    });

    expect(postedIn()).toEqual(["C0WGEN"]);
    expect(methodCalls("conversations.list")).toHaveLength(0);
  });

  test("each channel name is looked for with the payload's workspace", async () => {
    const lookup: SpyInstance<typeof SlackUtil.getWorkspaceChannelByName> =
      jest.spyOn(SlackUtil, "getWorkspaceChannelByName");

    const response: WorkspaceSendMessageResponse = await SlackUtil.sendMessage({
      workspaceMessagePayload: payload({
        channelNames: ["#general", "east-only", "north-only"],
        teamId: EAST.id,
      }),
      authToken: ORGANIZATION_TOKEN,
      userId: "",
      projectId: PROJECT_ID,
    });

    expect(
      lookup.mock.calls.map((call: Array<unknown>): unknown => {
        return [
          (call[0] as JSONObject)["channelName"],
          (call[0] as JSONObject)["teamId"],
        ];
      }),
    ).toEqual([
      ["general", EAST.id],
      ["east-only", EAST.id],
      ["north-only", EAST.id],
    ]);
    // North's channel is not the East rule's: not posted in.
    expect(postedIn()).toEqual(["C0EGEN", "C0EONLY"]);
    // ...and said, as a channel the rule's workspace does not have (#7115).
    expect(response.errors).toEqual([
      {
        channel: {
          id: "",
          name: "north-only",
          workspaceType: WorkspaceType.Slack,
          teamId: EAST.id,
        },
        error:
          "The Slack channel #north-only was not found. If it is a private channel, invite OneUptime's bot to it in Slack.",
      },
    ]);
  });

  test("a rule's workspace OneUptime was removed from: nothing posted - not in another workspace either - and each channel's Notification Logs row says so plainly", async () => {
    stored = organizationRow({
      workspaces: [NORTH, WEST],
      removedWorkspaces: [EAST],
      channelCache: {
        general: {
          id: "C0WGEN",
          name: "general",
          lastUpdated: minutesAgo(60),
          teamId: WEST.id,
        },
      },
    });

    const response: WorkspaceSendMessageResponse = await SlackUtil.sendMessage({
      workspaceMessagePayload: payload({
        channelNames: ["#general", "east-only"],
        teamId: EAST.id,
      }),
      authToken: ORGANIZATION_TOKEN,
      userId: "",
      projectId: PROJECT_ID,
    });

    expect(postedIn()).toEqual([]);
    expect(methodCalls("conversations.list")).toHaveLength(0);
    expect(response.threads).toEqual([]);
    expect(response.errors).toEqual([
      {
        channel: {
          id: "",
          name: "general",
          workspaceType: WorkspaceType.Slack,
          teamId: EAST.id,
        },
        error: NOT_ADDED_TO_EAST,
      },
      {
        channel: {
          id: "",
          name: "east-only",
          workspaceType: WorkspaceType.Slack,
          teamId: EAST.id,
        },
        error: NOT_ADDED_TO_EAST,
      },
    ]);
  });

  test("Slack refusing a post in the rule's workspace (removed since it was listed): the row says so plainly", async () => {
    postRefusal = "team_access_not_granted";

    const response: WorkspaceSendMessageResponse = await SlackUtil.sendMessage({
      workspaceMessagePayload: payload({
        channelNames: ["general"],
        teamId: EAST.id,
      }),
      authToken: ORGANIZATION_TOKEN,
      userId: "",
      projectId: PROJECT_ID,
    });

    expect(postedIn()).toEqual(["C0EGEN"]);
    expect(response.errors).toHaveLength(1);
    expect(response.errors![0]!.channel.id).toBe("C0EGEN");
    expect(response.errors![0]!.error).toBe(NOT_ADDED_TO_EAST);
  });

  test("any other refusal of a post is Slack's own words, as before", async () => {
    postRefusal = "is_archived";

    const response: WorkspaceSendMessageResponse = await SlackUtil.sendMessage({
      workspaceMessagePayload: payload({
        channelNames: ["general"],
        teamId: EAST.id,
      }),
      authToken: ORGANIZATION_TOKEN,
      userId: "",
      projectId: PROJECT_ID,
    });

    expect(response.errors![0]!.error).toBe("Error from Slack is_archived");
  });

  test("a project connected to one workspace refused team_access_not_granted: Slack's own words - there is no organization to name", async () => {
    stored = workspaceRow();
    postRefusal = "team_access_not_granted";

    const response: WorkspaceSendMessageResponse = await SlackUtil.sendMessage({
      workspaceMessagePayload: payload({ channelNames: ["general"] }),
      authToken: WORKSPACE_TOKEN,
      userId: "",
      projectId: PROJECT_ID,
    });

    expect(response.errors![0]!.error).toBe(
      "Error from Slack team_access_not_granted",
    );
  });
});

describe("isWorkspaceNotAddedError", () => {
  test("Slack's team_access_not_granted, as any call throws it - and nothing else", () => {
    expect(
      SlackUtil.isWorkspaceNotAddedError(
        new BadRequestException("Error from Slack team_access_not_granted"),
      ),
    ).toBe(true);

    for (const other of [
      new BadRequestException("Error from Slack channel_not_found"),
      new BadRequestException("Error from Slack team_access_not_granted_x"),
      new Error("team_access_not_granted"),
      "Error from Slack ratelimited",
      null,
      undefined,
    ]) {
      expect(SlackUtil.isWorkspaceNotAddedError(other)).toBe(false);
    }
  });
});
