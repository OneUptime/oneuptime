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
  SlackOrganizationWorkspace,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import logger from "../../../../../Server/Utils/Logger";
import SlackOrganization from "../../../../../Server/Utils/Workspace/Slack/SlackOrganization";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import { SLACK_ID_PATTERN } from "../../../../../Types/Workspace/ConnectCallback";
import API from "../../../../../Utils/API";
import { seededRandom, SeededRandom } from "../../../../Helpers/SeededRandom";

/*
 * WHICH WORKSPACE "BACK TO SLACK" OPENS A CHANNEL OF AN ORGANIZATION IN
 * (SlackOrganization.getWorkspaceIdToOpenChannelIn).
 *
 * Somebody who has not connected their Slack account presses a OneUptime
 * button in a channel, connects, and the settings page offers Back to Slack:
 * Slack's app_redirect link to the channel, in a workspace. Slack's press of
 * a whole Enterprise organization's installation names no workspace for the
 * channel (team is null), only the person's own (user.team_id). OneUptime
 * knows the workspace of the channels in its channel cache; for any other
 * channel it asks Slack once, with conversations.info - which takes no
 * team_id with an organization's token - and takes only a workspace it is
 * added to, else keeps the person's own.
 *
 * Slack is stood in for at the HTTP layer (API.post), answering as its Web
 * API documents: https://docs.slack.dev/reference/methods/conversations.info
 * and https://docs.slack.dev/reference/objects/conversation-object.
 */

const ORG_ID: string = "E0ACME";
// Long and plain, so a log line that carried it would be found.
const ORG_TOKEN: string = "xoxb-acme-organization-secret-0123456789";

// Workspaces OneUptime is added to.
const EAST: SlackOrganizationWorkspace = { id: "T0EAST", name: "Acme East" };
const WEST: SlackOrganizationWorkspace = { id: "T0WEST", name: "Acme West" };
// A workspace of the organization OneUptime is not added to.
const LAB: string = "T0LAB";

// A channel OneUptime does not know: no rule created it or looked it up.
const CHANNEL_ID: string = "C0CHECKOUT";

interface SlackCall {
  url: string;
  data: JSONObject;
  headers: JSONObject;
  options: JSONObject;
}

let calls: Array<SlackCall>;
// What Slack answers conversations.info; unset, it is not expected to be asked.
let slackAnswer:
  | ((call: SlackCall) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>)
  | null;
// Every line written to the log, as text.
let logLines: Array<string>;

function channelInfo(channel: unknown): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    { ok: true, channel: channel } as JSONObject,
    {},
  );
}

function refused(error: string): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, { ok: false, error: error }, {});
}

// Slack never answering: a request that never settles.
function neverAnswered(): Promise<HTTPResponse<JSONObject>> {
  return new Promise<HTTPResponse<JSONObject>>((): void => {});
}

// A channel of one workspace, as Slack's conversations.info example has it.
function channelOf(teamId: string): JSONObject {
  return {
    id: CHANNEL_ID,
    name: "checkout",
    is_channel: true,
    is_private: false,
    is_shared: false,
    is_org_shared: false,
    is_ext_shared: false,
    context_team_id: teamId,
    shared_team_ids: [teamId],
    pending_shared: [],
    pending_connected_team_ids: [],
  };
}

// A project's connection to the whole organization, as stored.
function organizationAuth(
  miscData: Partial<SlackMiscData> = {},
  row: { [field: string]: unknown } = {},
): WorkspaceProjectAuthToken {
  return {
    authToken: ORG_TOKEN,
    workspaceProjectId: ORG_ID,
    miscData: {
      teamId: ORG_ID,
      teamName: "Acme Corp",
      botUserId: "U0BOT",
      isEnterpriseInstall: true,
      enterpriseId: ORG_ID,
      enterpriseName: "Acme Corp",
      workspaces: [EAST, WEST],
      workspacesReadAt: new Date().toISOString(),
      defaultWorkspaceId: EAST.id,
      ...miscData,
    },
    ...row,
  } as unknown as WorkspaceProjectAuthToken;
}

// A project's connection to one workspace of the organization, as stored.
function workspaceAuth(): WorkspaceProjectAuthToken {
  return {
    authToken: "xoxb-east",
    workspaceProjectId: EAST.id,
    miscData: {
      teamId: EAST.id,
      teamName: EAST.name,
      botUserId: "U0BOT",
      enterpriseId: ORG_ID,
    },
  } as unknown as WorkspaceProjectAuthToken;
}

// The workspace Back to Slack opens CHANNEL_ID in, the press having kept WEST.
function openIn(
  projectAuth: WorkspaceProjectAuthToken | null = organizationAuth(),
  more: {
    channelId?: string | undefined;
    keptTeamId?: string | undefined;
  } = {},
): Promise<string | undefined> {
  return SlackOrganization.getWorkspaceIdToOpenChannelIn({
    projectAuth: projectAuth,
    channelId: "channelId" in more ? more.channelId : CHANNEL_ID,
    keptTeamId: "keptTeamId" in more ? more.keptTeamId : WEST.id,
  });
}

beforeEach(() => {
  calls = [];
  slackAnswer = null;
  logLines = [];

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data?: JSONObject;
    headers?: JSONObject;
    options?: JSONObject;
  }) => {
    const call: SlackCall = {
      url: options.url.toString(),
      data: { ...(options.data || {}) },
      headers: { ...(options.headers || {}) },
      options: { ...(options.options || {}) },
    };

    calls.push(call);

    if (!slackAnswer) {
      throw new Error(`Slack was not expected to be asked ${call.url}.`);
    }

    return await slackAnswer(call);
  }) as never);

  const writeLine: (...args: Array<unknown>) => void = (
    ...args: Array<unknown>
  ): void => {
    logLines.push(
      args
        .map((arg: unknown): string => {
          if (arg instanceof Error) {
            return `${arg.name}: ${arg.message} ${arg.stack || ""}`;
          }

          try {
            return typeof arg === "string" ? arg : JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(" "),
    );
  };

  for (const level of ["debug", "info", "warn", "error", "trace"] as const) {
    jest.spyOn(logger, level).mockImplementation(writeLine as never);
  }
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("readWorkspaceIdsOfChannel: the workspaces conversations.info names for a channel", () => {
  test("Slack's own example of a public channel: the workspace it is within, once", () => {
    // The response documented for conversations.info, as Slack prints it.
    const documented: JSONObject = {
      id: "C012AB3CD",
      name: "general",
      is_channel: true,
      is_group: false,
      is_im: false,
      is_mpim: false,
      is_private: false,
      created: 1654868334,
      is_archived: false,
      is_general: true,
      unlinked: 0,
      name_normalized: "general",
      is_shared: false,
      is_frozen: false,
      is_org_shared: false,
      is_pending_ext_shared: false,
      pending_shared: [],
      context_team_id: "T123ABC456",
      updated: 1723130875818,
      parent_conversation: null,
      creator: "U123ABC456",
      is_ext_shared: false,
      shared_team_ids: ["T123ABC456"],
      pending_connected_team_ids: [],
      previous_names: [],
    };

    expect(SlackOrganization.readWorkspaceIdsOfChannel(documented)).toEqual([
      "T123ABC456",
    ]);
  });

  test("Slack's own example of a direct message: no workspace", () => {
    const documented: JSONObject = {
      id: "C012AB3CD",
      created: 1507235627,
      is_im: true,
      is_org_shared: false,
      user: "U27FFLNF4",
      last_read: "1513718191.000038",
      unread_count: 0,
      unread_count_display: 0,
      is_open: true,
      locale: "en-US",
      priority: 0.043016851216706,
    };

    expect(SlackOrganization.readWorkspaceIdsOfChannel(documented)).toEqual([]);
  });

  test("a channel shared between the organization's workspaces: the one it is seen from, its host - the organization itself here - then the workspaces it is in, each once, in that order", () => {
    expect(
      SlackOrganization.readWorkspaceIdsOfChannel({
        id: CHANNEL_ID,
        is_shared: true,
        is_org_shared: true,
        context_team_id: EAST.id,
        conversation_host_id: ORG_ID,
        internal_team_ids: [WEST.id, EAST.id, LAB],
        shared_team_ids: [EAST.id, WEST.id, LAB],
      }),
    ).toEqual([EAST.id, ORG_ID, WEST.id, LAB]);

    // Each field is read even when the ones before it name nothing.
    expect(
      SlackOrganization.readWorkspaceIdsOfChannel({
        conversation_host_id: WEST.id,
      }),
    ).toEqual([WEST.id]);
    expect(
      SlackOrganization.readWorkspaceIdsOfChannel({
        internal_team_ids: [LAB],
      }),
    ).toEqual([LAB]);
    expect(
      SlackOrganization.readWorkspaceIdsOfChannel({
        shared_team_ids: [EAST.id],
      }),
    ).toEqual([EAST.id]);
  });

  test("only values shaped like Slack's ids, and lists only where Slack writes lists", () => {
    expect(
      SlackOrganization.readWorkspaceIdsOfChannel({
        context_team_id: " T0EAST ",
        conversation_host_id: ["T0HOST"],
        internal_team_ids: "T0WEST",
        shared_team_ids: [
          "t0lower",
          "",
          "T",
          "T0EAST&team=T9EVIL",
          "T0 SPACE",
          42,
          null,
          { id: "T0OBJECT" },
          ["T0NESTED"],
          `T${"0".repeat(32)}`,
          "T0LAB",
        ],
      }),
    ).toEqual([EAST.id, LAB]);
  });

  test("anything but an object names nothing", () => {
    for (const notAChannel of [
      undefined,
      null,
      "",
      CHANNEL_ID,
      42,
      true,
      [channelOf(EAST.id)],
    ]) {
      expect(SlackOrganization.readWorkspaceIdsOfChannel(notAChannel)).toEqual(
        [],
      );
    }
  });

  test("a seeded sweep of channel objects: every id read is shaped like Slack's, read once, from one of the four fields", () => {
    const random: SeededRandom = seededRandom(6772);
    const pieces: Array<unknown> = [
      EAST.id,
      WEST.id,
      LAB,
      ORG_ID,
      "T0EAST ",
      "t0east",
      "",
      "D0DIRECT",
      "T0EAST&team=T9",
      7,
      null,
      undefined,
      false,
      {},
      [EAST.id],
    ];
    const fields: Array<string> = [
      "context_team_id",
      "conversation_host_id",
      "internal_team_ids",
      "shared_team_ids",
      "enterprise_id",
      "team_id",
    ];

    function draw(): unknown {
      return pieces[random(pieces.length)];
    }

    for (let round: number = 0; round < 2000; round++) {
      const channel: JSONObject = {};

      for (const field of fields) {
        if (random(3) === 0) {
          continue;
        }

        const isList: boolean = random(2) === 0;

        channel[field] = (
          isList
            ? Array.from({ length: random(5) }, (): unknown => {
                return draw();
              })
            : draw()
        ) as JSONObject;
      }

      const ids: Array<string> =
        SlackOrganization.readWorkspaceIdsOfChannel(channel);

      // Only the four fields that name a channel's workspaces are read.
      const written: Array<string> = [
        channel["context_team_id"],
        channel["conversation_host_id"],
        ...(Array.isArray(channel["internal_team_ids"])
          ? (channel["internal_team_ids"] as Array<unknown>)
          : []),
        ...(Array.isArray(channel["shared_team_ids"])
          ? (channel["shared_team_ids"] as Array<unknown>)
          : []),
      ]
        .filter((value: unknown): value is string => {
          return typeof value === "string";
        })
        .map((value: string): string => {
          return value.trim();
        });

      expect(new Set(ids).size).toBe(ids.length);

      for (const id of ids) {
        expect(SLACK_ID_PATTERN.test(id)).toBe(true);
        expect(written).toContain(id);
      }

      // And every such id written there is read.
      for (const value of written) {
        if (SLACK_ID_PATTERN.test(value)) {
          expect(ids).toContain(value);
        }
      }
    }
  });
});

describe("pickWorkspaceOfChannel: the one Back to Slack opens", () => {
  test("the workspace the press kept, when the channel is in it too - a channel shared with the person's own workspace", () => {
    expect(
      SlackOrganization.pickWorkspaceOfChannel({
        channelWorkspaceIds: [EAST.id, ORG_ID, WEST.id],
        addedWorkspaceIds: [EAST.id, WEST.id],
        keptTeamId: WEST.id,
      }),
    ).toBe(WEST.id);

    // Even a workspace OneUptime is not added to: it is the person's own, and the channel is in it.
    expect(
      SlackOrganization.pickWorkspaceOfChannel({
        channelWorkspaceIds: [EAST.id, LAB],
        addedWorkspaceIds: [EAST.id, WEST.id],
        keptTeamId: LAB,
      }),
    ).toBe(LAB);
  });

  test("else the first workspace OneUptime is added to, in Slack's order", () => {
    expect(
      SlackOrganization.pickWorkspaceOfChannel({
        channelWorkspaceIds: [EAST.id],
        addedWorkspaceIds: [EAST.id, WEST.id],
        keptTeamId: WEST.id,
      }),
    ).toBe(EAST.id);

    expect(
      SlackOrganization.pickWorkspaceOfChannel({
        channelWorkspaceIds: [ORG_ID, LAB, WEST.id, EAST.id],
        addedWorkspaceIds: [EAST.id, WEST.id],
        keptTeamId: "T0NORTH",
      }),
    ).toBe(WEST.id);
  });

  test("none OneUptime is added to - the organization's own id included: none, and the link stays where the press kept it", () => {
    for (const channelWorkspaceIds of [[], [LAB], [ORG_ID], [ORG_ID, LAB]]) {
      expect(
        SlackOrganization.pickWorkspaceOfChannel({
          channelWorkspaceIds: channelWorkspaceIds,
          addedWorkspaceIds: [EAST.id, WEST.id],
          keptTeamId: WEST.id,
        }),
      ).toBeUndefined();
    }

    expect(
      SlackOrganization.pickWorkspaceOfChannel({
        channelWorkspaceIds: [EAST.id],
        addedWorkspaceIds: [],
        keptTeamId: WEST.id,
      }),
    ).toBeUndefined();
  });

  test("no workspace kept: the first OneUptime is added to", () => {
    expect(
      SlackOrganization.pickWorkspaceOfChannel({
        channelWorkspaceIds: [LAB, EAST.id],
        addedWorkspaceIds: [EAST.id, WEST.id],
        keptTeamId: undefined,
      }),
    ).toBe(EAST.id);
  });
});

describe("getWorkspaceIdToOpenChannelIn: the workspace Back to Slack opens a press's channel in", () => {
  test("a channel OneUptime does not know: the workspace Slack names for it - asked once, with the organization's token and the channel, without a team_id, waited for at most CHANNEL_WORKSPACE_TIMEOUT_IN_MS", async () => {
    slackAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
      return channelInfo(channelOf(EAST.id));
    };

    expect(await openIn()).toBe(EAST.id);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://slack.com/api/conversations.info");
    expect(calls[0]!.data).toEqual({ channel: CHANNEL_ID });
    expect(calls[0]!.headers["Authorization"]).toBe(`Bearer ${ORG_TOKEN}`);
    // One try: the person waits on the page.
    expect(calls[0]!.options).toEqual({
      timeout: SlackOrganization.CHANNEL_WORKSPACE_TIMEOUT_IN_MS,
    });
    expect(SlackOrganization.CHANNEL_WORKSPACE_TIMEOUT_IN_MS).toBe(2000);
  });

  test("a channel shared between the organization's workspaces that the person's own workspace has too: their own", async () => {
    slackAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
      return channelInfo({
        id: CHANNEL_ID,
        is_shared: true,
        is_org_shared: true,
        context_team_id: EAST.id,
        conversation_host_id: ORG_ID,
        internal_team_ids: [EAST.id, WEST.id],
        shared_team_ids: [EAST.id, WEST.id],
      });
    };

    expect(await openIn()).toBe(WEST.id);
    expect(calls).toHaveLength(1);
  });

  test("one the person's own workspace does not have: the first OneUptime is added to - past the organization's id and a workspace it is not added to", async () => {
    slackAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
      return channelInfo({
        id: CHANNEL_ID,
        is_shared: true,
        is_org_shared: true,
        context_team_id: ORG_ID,
        conversation_host_id: LAB,
        internal_team_ids: [LAB, EAST.id],
      });
    };

    expect(await openIn(organizationAuth(), { keptTeamId: "T0NORTH" })).toBe(
      EAST.id,
    );
  });

  test("a press kept without a workspace still gets the channel's", async () => {
    slackAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
      return channelInfo(channelOf(EAST.id));
    };

    expect(await openIn(organizationAuth(), { keptTeamId: undefined })).toBe(
      EAST.id,
    );
  });

  test.each([
    ["channel_not_found", "a private channel OneUptime is not in"],
    ["team_access_not_granted", "a workspace OneUptime is not added to"],
    ["missing_scope", "a token without channels:read or groups:read"],
    ["invalid_auth", "a token Slack no longer takes"],
    ["ratelimited", "too many calls"],
    ["", "no reason at all"],
  ])(
    "Slack refusing (%s: %s): the workspace the press kept - asked once, not again",
    async (error: string) => {
      slackAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
        return refused(error);
      };

      expect(await openIn()).toBe(WEST.id);
      expect(calls).toHaveLength(1);
    },
  );

  test("Slack answering with an HTTP error, or not at all: the workspace the press kept", async () => {
    for (const failure of [
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(503, { ok: false }, {});
      },
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(429, {}, { "retry-after": "30" });
      },
      async (): Promise<HTTPResponse<JSONObject>> => {
        throw new Error("socket hang up");
      },
    ]) {
      calls = [];
      slackAnswer = failure as never;

      expect(await openIn()).toBe(WEST.id);
      expect(calls).toHaveLength(1);
    }
  });

  test("Slack answering late: the workspace the press kept, as soon as the wait is over", async () => {
    // Slack never answers: what the request under it still waits for does not hold the link.
    slackAnswer = (): Promise<HTTPResponse<JSONObject>> => {
      return neverAnswered();
    };

    const startedAt: number = Date.now();

    expect(
      await SlackOrganization.getWorkspaceIdToOpenChannelIn({
        projectAuth: organizationAuth(),
        channelId: CHANNEL_ID,
        keptTeamId: WEST.id,
        timeoutInMs: 40,
      }),
    ).toBe(WEST.id);

    expect(Date.now() - startedAt).toBeLessThan(1500);
    expect(calls[0]!.options).toEqual({ timeout: 40 });
  });

  test("by default the wait is CHANNEL_WORKSPACE_TIMEOUT_IN_MS: not over a moment before, over at it", async () => {
    jest.useFakeTimers();

    slackAnswer = (): Promise<HTTPResponse<JSONObject>> => {
      return neverAnswered();
    };

    let answered: string | undefined | null = null;

    const pending: Promise<void> = openIn().then(
      (teamId: string | undefined) => {
        answered = teamId;
      },
    );

    for (let tick: number = 0; tick < 10; tick++) {
      await Promise.resolve();
    }

    expect(calls).toHaveLength(1);

    jest.advanceTimersByTime(
      SlackOrganization.CHANNEL_WORKSPACE_TIMEOUT_IN_MS - 1,
    );

    for (let tick: number = 0; tick < 10; tick++) {
      await Promise.resolve();
    }

    expect(answered).toBeNull();

    jest.advanceTimersByTime(1);
    await pending;

    expect(answered).toBe(WEST.id);
  });

  test("Slack answering in time after a while: its workspace", async () => {
    slackAnswer = (): Promise<HTTPResponse<JSONObject>> => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          setTimeout(() => {
            resolve(channelInfo(channelOf(EAST.id)));
          }, 20);
        },
      );
    };

    expect(
      await SlackOrganization.getWorkspaceIdToOpenChannelIn({
        projectAuth: organizationAuth(),
        channelId: CHANNEL_ID,
        keptTeamId: WEST.id,
        timeoutInMs: 1000,
      }),
    ).toBe(EAST.id);
  });

  test("Slack naming no workspace, or none OneUptime is added to: the workspace the press kept", async () => {
    for (const channel of [
      // A direct message, as Slack's example has it.
      { id: CHANNEL_ID, is_im: true, user: "U27FFLNF4" },
      {},
      undefined,
      "C0CHECKOUT",
      channelOf(LAB),
      { context_team_id: ORG_ID, conversation_host_id: ORG_ID },
    ]) {
      calls = [];
      slackAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
        return channelInfo(channel);
      };

      expect(await openIn()).toBe(WEST.id);
      expect(calls).toHaveLength(1);
    }

    // An answer that says nothing at all.
    slackAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(200, {} as JSONObject, {});
    };

    expect(await openIn()).toBe(WEST.id);
  });

  test("a channel the project's channel cache knows: its workspace there - Slack is not asked", async () => {
    const channelCache: SlackChannelCache = {
      checkout: {
        id: CHANNEL_ID,
        name: "checkout",
        lastUpdated: new Date().toISOString(),
        teamId: EAST.id,
      },
    };

    expect(await openIn(organizationAuth({ channelCache: channelCache }))).toBe(
      EAST.id,
    );
    expect(calls).toEqual([]);
  });

  test("a project connected to one workspace: the workspace the press kept, its own - Slack is not asked", async () => {
    expect(await openIn(workspaceAuth(), { keptTeamId: EAST.id })).toBe(
      EAST.id,
    );
    expect(await openIn(null)).toBe(WEST.id);
    expect(
      await SlackOrganization.getWorkspaceIdToOpenChannelIn({
        projectAuth: undefined,
        channelId: CHANNEL_ID,
        keptTeamId: WEST.id,
      }),
    ).toBe(WEST.id);
    expect(calls).toEqual([]);
  });

  test("a direct message (D...) is the person's own: their workspace - Slack is not asked", async () => {
    expect(await openIn(organizationAuth(), { channelId: "D0PRIYA" })).toBe(
      WEST.id,
    );
    expect(calls).toEqual([]);
  });

  test("a channel id not shaped like Slack's is never sent to Slack", async () => {
    for (const channelId of [
      undefined,
      "",
      "c0lower",
      "C0CHECKOUT&team=T9EVIL",
      "C0 CHECKOUT",
      `C${"0".repeat(40)}`,
    ]) {
      expect(await openIn(organizationAuth(), { channelId: channelId })).toBe(
        WEST.id,
      );
    }

    expect(calls).toEqual([]);
  });

  test("a connection Slack has listed no workspaces of yet, or with no token: the workspace the press kept - Slack is not asked", async () => {
    expect(
      await openIn(
        organizationAuth({ workspaces: [], workspacesReadAt: undefined }),
      ),
    ).toBe(WEST.id);
    expect(await openIn(organizationAuth({}, { authToken: "" }))).toBe(WEST.id);
    expect(await openIn(organizationAuth({}, { authToken: undefined }))).toBe(
      WEST.id,
    );
    expect(calls).toEqual([]);
  });

  test("a connection OneUptime cannot read: the workspace the press kept - it never throws, as the sign-in's page waits on it", async () => {
    // Not a date: reading the connection throws.
    const unreadable: WorkspaceProjectAuthToken = organizationAuth({
      workspacesReadAt: 1762900000 as unknown as string,
    });

    expect(() => {
      return SlackOrganization.readConnection(unreadable);
    }).toThrow();

    await expect(openIn(unreadable)).resolves.toBe(WEST.id);
    expect(calls).toEqual([]);
  });

  test("a workspace Slack names that OneUptime was removed from is not taken", async () => {
    slackAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
      return channelInfo(channelOf(EAST.id));
    };

    // OneUptime is added to West alone now; East was removed.
    expect(
      await openIn(
        organizationAuth({
          workspaces: [WEST],
          removedWorkspaces: [EAST],
          defaultWorkspaceId: WEST.id,
        }),
        { keptTeamId: "T0NORTH" },
      ),
    ).toBe("T0NORTH");
  });

  test("the organization's token is never written to the log, nor what Slack's client failed with", async () => {
    const failures: Array<
      () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>
    > = [
      async (): Promise<HTTPResponse<JSONObject>> => {
        return refused("channel_not_found");
      },
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(
          500,
          { ok: false, echo: `Bearer ${ORG_TOKEN}` },
          {},
        );
      },
      async (): Promise<HTTPResponse<JSONObject>> => {
        // A client error that repeats what it was sent.
        throw new Error(`Request failed: Authorization: Bearer ${ORG_TOKEN}`);
      },
      (): Promise<HTTPResponse<JSONObject>> => {
        return neverAnswered();
      },
    ];

    for (const failure of failures) {
      slackAnswer = failure;

      expect(
        await SlackOrganization.getWorkspaceIdToOpenChannelIn({
          projectAuth: organizationAuth(),
          channelId: CHANNEL_ID,
          keptTeamId: WEST.id,
          timeoutInMs: 30,
        }),
      ).toBe(WEST.id);
    }

    // Each failure said why, in a line of its own.
    expect(logLines.length).toBeGreaterThanOrEqual(failures.length);

    for (const line of logLines) {
      expect(line).not.toContain(ORG_TOKEN);
      expect(line).not.toContain("Bearer");
    }
  });
});

describe("askWorkspaceIdsOfChannel: conversations.info, once", () => {
  test("the workspaces Slack names for the channel", async () => {
    slackAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
      return channelInfo({
        context_team_id: WEST.id,
        shared_team_ids: [WEST.id, EAST.id],
      });
    };

    expect(
      await SlackOrganization.askWorkspaceIdsOfChannel({
        authToken: ORG_TOKEN,
        channelId: CHANNEL_ID,
        timeoutInMs: 500,
      }),
    ).toEqual([WEST.id, EAST.id]);
  });

  test("a refusal throws Slack's reason; a failure throws no_answer - neither carries what the request was sent with", async () => {
    const cases: Array<{
      answer: () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;
      message: string;
    }> = [
      {
        answer: async (): Promise<HTTPResponse<JSONObject>> => {
          return refused("team_access_not_granted");
        },
        message: "Error from Slack team_access_not_granted",
      },
      {
        answer: async (): Promise<HTTPResponse<JSONObject>> => {
          return new HTTPResponse<JSONObject>(200, { ok: false }, {});
        },
        message: "Error from Slack unknown_error",
      },
      {
        answer: async (): Promise<HTTPErrorResponse> => {
          return new HTTPErrorResponse(502, {}, {});
        },
        message: "Error from Slack http_502",
      },
      {
        answer: async (): Promise<HTTPResponse<JSONObject>> => {
          throw new Error(`timeout; headers: Bearer ${ORG_TOKEN}`);
        },
        message: "Error from Slack no_answer",
      },
      {
        answer: (): Promise<HTTPResponse<JSONObject>> => {
          return neverAnswered();
        },
        message: "Error from Slack no_answer",
      },
    ];

    for (const each of cases) {
      slackAnswer = each.answer;

      let thrown: unknown = null;

      try {
        await SlackOrganization.askWorkspaceIdsOfChannel({
          authToken: ORG_TOKEN,
          channelId: CHANNEL_ID,
          timeoutInMs: 30,
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(each.message);
      expect(JSON.stringify(thrown)).not.toContain(ORG_TOKEN);
      expect(String((thrown as Error).stack)).not.toContain(ORG_TOKEN);
    }
  });
});
