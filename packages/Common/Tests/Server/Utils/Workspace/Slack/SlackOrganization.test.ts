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
import SlackOrganization, {
  SlackInstallation,
  SlackOrganizationConnection,
  SlackWorkspaceNotAddedException,
} from "../../../../../Server/Utils/Workspace/Slack/SlackOrganization";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import OneUptimeDate from "../../../../../Types/Date";
import BadRequestException from "../../../../../Types/Exception/BadRequestException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import {
  seededRandom,
  SeededRandom,
  shuffled,
} from "../../../../Helpers/SeededRandom";

/*
 * ONEUPTIME INSTALLED FOR A WHOLE SLACK ENTERPRISE ORGANIZATION
 * (SlackOrganization): what an install says it was for, what a project's
 * connection says of the organization, the workspaces Slack lists
 * (auth.teams.list) - read again only when those read last are stale -
 * whether a project may move between one workspace and its organization's
 * installation, and which workspace each per-workspace call is made in.
 *
 * Slack is stood in for at the HTTP layer (API.post), answering as its Web
 * API does; the connection's row is stood in for by the service's reads.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);

const NOW: Date = new Date("2026-11-11T09:00:00.000Z");

const EAST: SlackOrganizationWorkspace = { id: "T0EAST", name: "Acme East" };
const WEST: SlackOrganizationWorkspace = { id: "T0WEST", name: "Acme West" };
const LABS: SlackOrganizationWorkspace = { id: "T0LABS", name: "Acme Labs" };

interface SlackCall {
  method: string;
  body: JSONObject;
  headers: JSONObject;
}

let calls: Array<SlackCall>;
// Each Slack method's answers, in order; the last one repeats.
let answers: Map<
  string,
  Array<HTTPResponse<JSONObject> | HTTPErrorResponse | Error>
>;
let updateSpy: SpyInstance<
  typeof WorkspaceProjectAuthTokenService.updateSlackOrganization
>;

function ok(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, { ok: true, ...body }, {});
}

function refused(error: string): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, { ok: false, error: error }, {});
}

function answer(
  method: string,
  ...responses: Array<HTTPResponse<JSONObject> | HTTPErrorResponse | Error>
): void {
  answers.set(method, responses);
}

function teamsPage(
  teams: Array<JSONObject>,
  nextCursor?: string | undefined,
): HTTPResponse<JSONObject> {
  return ok({
    teams: teams,
    ...(nextCursor !== undefined
      ? { response_metadata: { next_cursor: nextCursor } }
      : {}),
  });
}

function methodCalls(method: string): Array<SlackCall> {
  return calls.filter((call: SlackCall): boolean => {
    return call.method === method;
  });
}

function minutesAgo(minutes: number): string {
  return OneUptimeDate.toString(OneUptimeDate.addRemoveMinutes(NOW, -minutes));
}

// A project's connection to the whole organization, as stored.
function organizationAuth(
  miscData: Partial<SlackMiscData> = {},
  row: { [field: string]: unknown } = {},
): WorkspaceProjectAuthToken {
  return {
    projectId: PROJECT_ID,
    authToken: "xoxb-organization",
    workspaceProjectId: "E0ACME",
    miscData: {
      teamId: "E0ACME",
      teamName: "Acme Corp",
      botUserId: "U0BOT",
      isEnterpriseInstall: true,
      enterpriseId: "E0ACME",
      enterpriseName: "Acme Corp",
      workspaces: [WEST, EAST],
      workspacesReadAt: minutesAgo(2),
      defaultWorkspaceId: EAST.id,
      ...miscData,
    },
    ...row,
  } as unknown as WorkspaceProjectAuthToken;
}

// A project's connection to one workspace, as stored.
function workspaceAuth(
  miscData: Partial<SlackMiscData> = {},
  row: { [field: string]: unknown } = {},
): WorkspaceProjectAuthToken {
  return {
    projectId: PROJECT_ID,
    authToken: "xoxb-east",
    workspaceProjectId: EAST.id,
    miscData: {
      teamId: EAST.id,
      teamName: EAST.name,
      botUserId: "U0BOT",
      ...miscData,
    },
    ...row,
  } as unknown as WorkspaceProjectAuthToken;
}

function idsOf(workspaces: Array<SlackOrganizationWorkspace>): Array<string> {
  return workspaces.map((workspace: SlackOrganizationWorkspace): string => {
    return workspace.id;
  });
}

beforeEach(() => {
  calls = [];
  answers = new Map();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(NOW.getTime());
  });

  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data: JSONObject;
    headers: JSONObject;
  }) => {
    const url: string = options.url.toString();
    const method: string = url.substring("https://slack.com/api/".length);

    calls.push({
      method: method,
      body: { ...(options.data || {}) },
      headers: { ...(options.headers || {}) },
    });

    const queue:
      | Array<HTTPResponse<JSONObject> | HTTPErrorResponse | Error>
      | undefined = answers.get(method);

    if (!queue || queue.length === 0) {
      throw new Error(`Slack was not expected to be asked ${method}.`);
    }

    const next: HTTPResponse<JSONObject> | HTTPErrorResponse | Error =
      queue.length > 1 ? queue.shift()! : queue[0]!;

    if (next instanceof Error) {
      throw next;
    }

    return next;
  }) as never);

  updateSpy = jest
    .spyOn(WorkspaceProjectAuthTokenService, "updateSlackOrganization")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("readInstallation: what a finished install says it was for", () => {
  test("one workspace: its id and name, stored under the workspace", () => {
    expect(
      SlackOrganization.readInstallation({
        ok: true,
        team: { id: "T0EAST", name: "Acme East" },
        enterprise: null,
        is_enterprise_install: false,
      }),
    ).toEqual({
      workspaceProjectId: "T0EAST",
      isEnterpriseInstall: false,
      teamId: "T0EAST",
      teamName: "Acme East",
    } as SlackInstallation);
  });

  test("one workspace of an Enterprise organization: the workspace, and the organization it is part of", () => {
    expect(
      SlackOrganization.readInstallation({
        team: { id: "T0EAST", name: "Acme East" },
        enterprise: { id: "E0ACME", name: "Acme Corp" },
        is_enterprise_install: false,
      }),
    ).toEqual({
      workspaceProjectId: "T0EAST",
      isEnterpriseInstall: false,
      teamId: "T0EAST",
      teamName: "Acme East",
      enterpriseId: "E0ACME",
      enterpriseName: "Acme Corp",
    } as SlackInstallation);
  });

  test("the whole organization: Slack names no team, and the connection is stored under the organization", () => {
    expect(
      SlackOrganization.readInstallation({
        team: null,
        enterprise: { id: "E0ACME", name: "Acme Corp" },
        is_enterprise_install: true,
      }),
    ).toEqual({
      workspaceProjectId: "E0ACME",
      isEnterpriseInstall: true,
      teamId: "E0ACME",
      teamName: "Acme Corp",
      enterpriseId: "E0ACME",
      enterpriseName: "Acme Corp",
    } as SlackInstallation);
  });

  test('is_enterprise_install as the text "true" is the organization\'s installation too', () => {
    const installation: SlackInstallation | null =
      SlackOrganization.readInstallation({
        enterprise: { id: "E0ACME", name: "Acme Corp" },
        is_enterprise_install: "true",
      });

    expect(installation?.isEnterpriseInstall).toBe(true);
    expect(installation?.workspaceProjectId).toBe("E0ACME");
  });

  test("an organization's installation that names no organization is read as the workspace it names", () => {
    expect(
      SlackOrganization.readInstallation({
        team: { id: "T0EAST", name: "Acme East" },
        enterprise: { name: "Nameless" },
        is_enterprise_install: true,
      }),
    ).toEqual({
      workspaceProjectId: "T0EAST",
      isEnterpriseInstall: false,
      teamId: "T0EAST",
      teamName: "Acme East",
    } as SlackInstallation);
  });

  test("ids and names are trimmed", () => {
    expect(
      SlackOrganization.readInstallation({
        team: { id: "  T0EAST ", name: " Acme East " },
        enterprise: { id: " E0ACME ", name: " Acme Corp " },
      }),
    ).toEqual({
      workspaceProjectId: "T0EAST",
      isEnterpriseInstall: false,
      teamId: "T0EAST",
      teamName: "Acme East",
      enterpriseId: "E0ACME",
      enterpriseName: "Acme Corp",
    } as SlackInstallation);
  });

  test.each([
    ["nothing at all", {}],
    ["no team and no enterprise", { team: null, enterprise: null }],
    ["a team without an id", { team: { name: "Acme East" } }],
    ["a blank team id", { team: { id: "   ", name: "Acme East" } }],
    ["a team that is not an object", { team: "T0EAST" }],
    ["a team id that is not text", { team: { id: 42 } }],
    ["a team given as a list", { team: [{ id: "T0EAST" }] }],
    [
      "an enterprise install without the enterprise",
      { is_enterprise_install: true, enterprise: null },
    ],
  ])(
    "%s: null - nothing to store a connection under",
    (_: string, body: unknown) => {
      expect(SlackOrganization.readInstallation(body as JSONObject)).toBeNull();
    },
  );
});

describe("isOrganization", () => {
  test("only a connection stored as the organization's installation", () => {
    expect(
      SlackOrganization.isOrganization({ isEnterpriseInstall: true }),
    ).toBe(true);
    expect(
      SlackOrganization.isOrganization({ isEnterpriseInstall: false }),
    ).toBe(false);
    expect(
      SlackOrganization.isOrganization({ isEnterpriseInstall: "true" }),
    ).toBe(false);
    expect(SlackOrganization.isOrganization({ enterpriseId: "E0ACME" })).toBe(
      false,
    );
    expect(SlackOrganization.isOrganization(null)).toBe(false);
    expect(SlackOrganization.isOrganization(undefined)).toBe(false);
    expect(SlackOrganization.isOrganization("isEnterpriseInstall")).toBe(false);
  });
});

describe("readConnection: what a project's connection says of its organization", () => {
  test("a connection to one workspace - or none - is no organization's", () => {
    expect(SlackOrganization.readConnection(workspaceAuth())).toBeNull();
    expect(
      SlackOrganization.readConnection(
        workspaceAuth({ enterpriseId: "E0ACME", enterpriseName: "Acme Corp" }),
      ),
    ).toBeNull();
    expect(SlackOrganization.readConnection(null)).toBeNull();
    expect(SlackOrganization.readConnection(undefined)).toBeNull();
    expect(
      SlackOrganization.readConnection({
        workspaceProjectId: "E0ACME",
      } as WorkspaceProjectAuthToken),
    ).toBeNull();
  });

  test("the organization, its workspaces - the default first, then by name - and when Slack listed them", () => {
    const connection: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(
        organizationAuth({
          workspaces: [WEST, LABS, EAST],
          defaultWorkspaceId: WEST.id,
          workspacesReadAt: minutesAgo(3),
        }),
      );

    expect(connection).toEqual({
      enterpriseId: "E0ACME",
      enterpriseName: "Acme Corp",
      workspaces: [WEST, EAST, LABS],
      defaultWorkspaceId: WEST.id,
      workspacesReadAt: OneUptimeDate.addRemoveMinutes(NOW, -3),
      removedWorkspaces: [],
    } as SlackOrganizationConnection);
  });

  test("a workspace stored twice is one; one without an id is none; one without a name is named by its id", () => {
    const connection: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(
        organizationAuth({
          workspaces: [
            EAST,
            { id: "T0EAST", name: "Acme East again" },
            { id: "", name: "Nobody" },
            { name: "No id" } as unknown as SlackOrganizationWorkspace,
            "T0JUNK" as unknown as SlackOrganizationWorkspace,
            null as unknown as SlackOrganizationWorkspace,
            { id: " T0NONAME " } as unknown as SlackOrganizationWorkspace,
          ],
          defaultWorkspaceId: EAST.id,
        }),
      );

    expect(connection?.workspaces).toEqual([
      EAST,
      { id: "T0NONAME", name: "T0NONAME" },
    ]);
  });

  test("workspaces that are not a list read as none", () => {
    const connection: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(
        organizationAuth({
          workspaces: {
            T0EAST: EAST,
          } as unknown as Array<SlackOrganizationWorkspace>,
          defaultWorkspaceId: undefined,
        }),
      );

    expect(connection?.workspaces).toEqual([]);
    expect(connection?.defaultWorkspaceId).toBeUndefined();
  });

  test("a default OneUptime is no longer added to gives way to the first workspace by name", () => {
    const connection: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(
        organizationAuth({
          workspaces: [WEST, EAST, LABS],
          defaultWorkspaceId: "T0GONE",
        }),
      );

    expect(connection?.defaultWorkspaceId).toBe(EAST.id);
    expect(idsOf(connection!.workspaces)).toEqual([EAST.id, LABS.id, WEST.id]);
  });

  test("before Slack has listed any workspace, the default chosen stays - a project that moved keeps its workspace", () => {
    const connection: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(
        organizationAuth({
          workspaces: undefined,
          workspacesReadAt: undefined,
          defaultWorkspaceId: EAST.id,
        }),
      );

    expect(connection?.workspaces).toEqual([]);
    expect(connection?.defaultWorkspaceId).toBe(EAST.id);
    expect(connection?.workspacesReadAt).toBeUndefined();
  });

  test("an installation added to no workspace and with no default has none", () => {
    const connection: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(
        organizationAuth({ workspaces: [], defaultWorkspaceId: undefined }),
      );

    expect(connection?.defaultWorkspaceId).toBeUndefined();
    expect(connection?.workspaces).toEqual([]);
  });

  test("the organization's id and name fall back to the row's and the installation's", () => {
    const connection: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(
        organizationAuth({
          enterpriseId: undefined,
          enterpriseName: undefined,
          teamName: "Acme from the install",
        }),
      );

    expect(connection?.enterpriseId).toBe("E0ACME");
    expect(connection?.enterpriseName).toBe("Acme from the install");

    const fromTeamId: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(
        organizationAuth(
          { enterpriseId: undefined, teamId: "E0FROMTEAM" },
          { workspaceProjectId: undefined },
        ),
      );

    expect(fromTeamId?.enterpriseId).toBe("E0FROMTEAM");
  });

  test("a time the workspaces were listed at that is not one reads as never", () => {
    const connection: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(
        organizationAuth({ workspacesReadAt: "not a date" }),
      );

    expect(connection?.workspacesReadAt).toBeUndefined();
  });

  test("whatever order the workspaces were stored in, they read the same: the default first, then by name", () => {
    const random: SeededRandom = seededRandom(6725);
    const workspaces: Array<SlackOrganizationWorkspace> = [];

    for (let index: number = 0; index < 30; index++) {
      workspaces.push({
        id: `T0W${String(index).padStart(3, "0")}`,
        // Some names shared, so ties are broken by id.
        name: `Workspace ${String.fromCharCode(65 + random(12))}`,
      });
    }

    const expected: Array<string> = idsOf(
      SlackOrganization.readConnection(
        organizationAuth({
          workspaces: workspaces,
          defaultWorkspaceId: "T0W017",
        }),
      )!.workspaces,
    );

    expect(expected[0]).toBe("T0W017");

    for (let round: number = 0; round < 25; round++) {
      const connection: SlackOrganizationConnection | null =
        SlackOrganization.readConnection(
          organizationAuth({
            workspaces: shuffled(workspaces, random),
            defaultWorkspaceId: "T0W017",
          }),
        );

      expect(idsOf(connection!.workspaces)).toEqual(expected);
    }

    // After the default: by name, then by id.
    const rest: Array<SlackOrganizationWorkspace> =
      SlackOrganization.readConnection(
        organizationAuth({
          workspaces: workspaces,
          defaultWorkspaceId: "T0W017",
        }),
      )!.workspaces.slice(1);

    for (let index: number = 1; index < rest.length; index++) {
      const before: SlackOrganizationWorkspace = rest[index - 1]!;
      const after: SlackOrganizationWorkspace = rest[index]!;

      expect(
        before.name.localeCompare(after.name) < 0 ||
          (before.name === after.name && before.id < after.id),
      ).toBe(true);
    }
  });
});

describe("isFresh: whether the workspaces listed last are used as they are", () => {
  function connectionReadAt(
    readAt: Date | undefined,
  ): SlackOrganizationConnection {
    return {
      enterpriseId: "E0ACME",
      enterpriseName: "Acme Corp",
      workspaces: [EAST],
      defaultWorkspaceId: EAST.id,
      workspacesReadAt: readAt,
      removedWorkspaces: [],
    };
  }

  test("listed a few minutes ago: fresh", () => {
    expect(
      SlackOrganization.isFresh(
        connectionReadAt(OneUptimeDate.addRemoveMinutes(NOW, -9)),
      ),
    ).toBe(true);
    expect(SlackOrganization.isFresh(connectionReadAt(NOW))).toBe(true);
  });

  test("listed ten minutes ago or longer: stale", () => {
    expect(
      SlackOrganization.isFresh(
        connectionReadAt(
          OneUptimeDate.addRemoveSeconds(
            NOW,
            -SlackOrganization.WORKSPACES_FRESH_FOR_SECONDS,
          ),
        ),
      ),
    ).toBe(false);
    expect(
      SlackOrganization.isFresh(
        connectionReadAt(OneUptimeDate.addRemoveMinutes(NOW, -60)),
      ),
    ).toBe(false);
  });

  test("never listed, or listed in the future (another server's clock): stale", () => {
    expect(SlackOrganization.isFresh(connectionReadAt(undefined))).toBe(false);
    expect(
      SlackOrganization.isFresh(
        connectionReadAt(OneUptimeDate.addRemoveMinutes(NOW, 5)),
      ),
    ).toBe(false);
  });
});

describe("listWorkspaces: auth.teams.list, every page", () => {
  test("asks with the organization's token, 200 a page, and follows the cursor to the last page", async () => {
    answer(
      "auth.teams.list",
      teamsPage(
        [
          { id: "T0EAST", name: "Acme East" },
          { id: "T0WEST", name: "Acme West" },
        ],
        "page-2",
      ),
      teamsPage([{ id: "T0LABS", name: "Acme Labs" }], ""),
    );

    expect(await SlackOrganization.listWorkspaces("xoxb-organization")).toEqual(
      [EAST, WEST, LABS],
    );

    expect(methodCalls("auth.teams.list")).toEqual([
      {
        method: "auth.teams.list",
        body: { limit: 200 },
        headers: {
          Authorization: "Bearer xoxb-organization",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
      {
        method: "auth.teams.list",
        body: { limit: 200, cursor: "page-2" },
        headers: {
          Authorization: "Bearer xoxb-organization",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    ]);
  });

  test("a workspace listed twice is one; one without an id is none; one without a name is named by its id", async () => {
    answer(
      "auth.teams.list",
      teamsPage(
        [
          { id: "T0EAST", name: "Acme East" },
          { name: "No id" },
          { id: "T0NONAME" },
          "T0JUNK" as unknown as JSONObject,
        ],
        "page-2",
      ),
      teamsPage([{ id: "T0EAST", name: "Acme East, listed again" }]),
    );

    expect(await SlackOrganization.listWorkspaces("xoxb-organization")).toEqual(
      [EAST, { id: "T0NONAME", name: "T0NONAME" }],
    );
  });

  test("no teams in the answer: none; no response_metadata: the last page", async () => {
    answer("auth.teams.list", ok({}));

    expect(await SlackOrganization.listWorkspaces("xoxb-organization")).toEqual(
      [],
    );
    expect(methodCalls("auth.teams.list")).toHaveLength(1);
  });

  test("a refusal throws, saying what Slack said", async () => {
    answer("auth.teams.list", refused("missing_scope"));

    await expect(
      SlackOrganization.listWorkspaces("xoxb-organization"),
    ).rejects.toThrow(
      new BadRequestException("Error from Slack missing_scope"),
    );
  });

  test("a refusal on a later page throws too: no partial list", async () => {
    answer(
      "auth.teams.list",
      teamsPage([{ id: "T0EAST", name: "Acme East" }], "page-2"),
      refused("ratelimited"),
    );

    await expect(
      SlackOrganization.listWorkspaces("xoxb-organization"),
    ).rejects.toThrow("Error from Slack ratelimited");
  });

  test("an HTTP error is thrown as it is", async () => {
    const error: HTTPErrorResponse = new HTTPErrorResponse(
      500,
      { ok: false },
      {},
    );
    answer("auth.teams.list", error);

    await expect(
      SlackOrganization.listWorkspaces("xoxb-organization"),
    ).rejects.toBe(error);
  });

  test("a cursor that never ends stops after 50 pages", async () => {
    let page: number = 0;

    (API.post as unknown as SpyInstance<typeof API.post>).mockImplementation(
      (async () => {
        page++;
        return teamsPage([{ id: `T0P${page}`, name: `Page ${page}` }], "more");
      }) as never,
    );

    const workspaces: Array<SlackOrganizationWorkspace> =
      await SlackOrganization.listWorkspaces("xoxb-organization");

    expect(page).toBe(50);
    expect(workspaces).toHaveLength(50);
  });
});

describe("getOfConnection: the organization, its workspaces read again when stale", () => {
  test("a connection to one workspace is no organization's, and Slack is not asked", async () => {
    expect(
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: workspaceAuth(),
      }),
    ).toBeNull();
    expect(
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: null,
        refresh: true,
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  test("workspaces listed a few minutes ago are used as they are", async () => {
    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({ workspacesReadAt: minutesAgo(4) }),
      });

    expect(idsOf(connection!.workspaces)).toEqual([EAST.id, WEST.id]);
    expect(connection!.defaultWorkspaceId).toBe(EAST.id);
    expect(calls).toEqual([]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("stale: Slack lists them again, and they are kept for the next time", async () => {
    answer(
      "auth.teams.list",
      teamsPage(
        [
          { id: "T0WEST", name: "Acme West" },
          { id: "T0LABS", name: "Acme Labs" },
        ],
        "next",
      ),
      teamsPage([{ id: "T0EAST", name: "Acme East" }]),
    );

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({ workspacesReadAt: minutesAgo(30) }),
      });

    expect(connection).toEqual({
      enterpriseId: "E0ACME",
      enterpriseName: "Acme Corp",
      workspaces: [EAST, LABS, WEST],
      defaultWorkspaceId: EAST.id,
      workspacesReadAt: NOW,
      removedWorkspaces: [],
    } as SlackOrganizationConnection);

    expect(methodCalls("auth.teams.list")).toHaveLength(2);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceProjectId: "E0ACME",
      workspaces: [WEST, LABS, EAST],
      workspacesReadAt: NOW,
      removedWorkspaces: [],
    });
  });

  test("never listed: Slack is asked", async () => {
    answer("auth.teams.list", teamsPage([{ id: "T0EAST", name: "Acme East" }]));

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({ workspacesReadAt: undefined }),
      });

    expect(connection?.workspaces).toEqual([EAST]);
    expect(methodCalls("auth.teams.list")).toHaveLength(1);
  });

  test("refresh: Slack is asked even when the list is fresh", async () => {
    answer(
      "auth.teams.list",
      teamsPage([
        { id: "T0EAST", name: "Acme East" },
        { id: "T0WEST", name: "Acme West" },
        { id: "T0LABS", name: "Acme Labs" },
      ]),
    );

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({ workspacesReadAt: minutesAgo(1) }),
        refresh: true,
      });

    expect(idsOf(connection!.workspaces)).toEqual([EAST.id, LABS.id, WEST.id]);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  test("the default OneUptime was removed from gives way to the first workspace by name", async () => {
    answer(
      "auth.teams.list",
      teamsPage([
        { id: "T0WEST", name: "Acme West" },
        { id: "T0LABS", name: "Acme Labs" },
      ]),
    );

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({ workspacesReadAt: minutesAgo(30) }),
      });

    expect(connection?.defaultWorkspaceId).toBe(LABS.id);
    expect(idsOf(connection!.workspaces)).toEqual([LABS.id, WEST.id]);
  });

  /*
   * #6748: the default moves for good. Stored where it moved, OneUptime
   * added to the old one again later does not move it back, and the
   * channels cached as other workspaces' are looked up again
   * (updateSlackOrganization).
   */
  test("the default OneUptime was removed from is stored where it moved - with the list it moved by", async () => {
    answer(
      "auth.teams.list",
      teamsPage([
        { id: "T0WEST", name: "Acme West" },
        { id: "T0LABS", name: "Acme Labs" },
      ]),
    );

    await SlackOrganization.getOfConnection({
      projectId: PROJECT_ID,
      projectAuth: organizationAuth({ workspacesReadAt: minutesAgo(30) }),
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceProjectId: "E0ACME",
      workspaces: [WEST, LABS],
      workspacesReadAt: NOW,
      removedWorkspaces: [EAST],
      defaultWorkspaceId: LABS.id,
    });
  });

  test("a default Slack still lists, or one kept while Slack lists none: not stored again", async () => {
    // Still listed - even with one that comes first by name: stays, and is not written.
    answer(
      "auth.teams.list",
      teamsPage([WEST, LABS, EAST] as unknown as Array<JSONObject>),
    );

    const listed: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({ defaultWorkspaceId: LABS.id }),
        refresh: true,
      });

    // Listed none: nowhere to move to.
    answer("auth.teams.list", teamsPage([]));

    const none: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth(),
        refresh: true,
      });

    expect(listed?.defaultWorkspaceId).toBe(LABS.id);
    expect(none?.defaultWorkspaceId).toBe(EAST.id);
    expect(updateSpy).toHaveBeenCalledTimes(2);

    for (const call of updateSpy.mock.calls) {
      expect(Object.keys(call[0]!)).not.toContain("defaultWorkspaceId");
    }
  });

  /*
   * #6784: an installation with no default stored - made before installs
   * stored the first workspace by name - has it stored once Slack lists
   * them. Left to be read each time, OneUptime added to a workspace that
   * comes first by name took it over, and OneUptime removed from it moved it
   * without dropping its cached channels: a rule that names no workspace
   * kept finding its channel in the workspace OneUptime left.
   */
  test("a default never stored: the first workspace by name is stored", async () => {
    answer(
      "auth.teams.list",
      teamsPage([WEST, EAST] as unknown as Array<JSONObject>),
    );

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({ defaultWorkspaceId: undefined }),
        refresh: true,
      });

    expect(connection?.defaultWorkspaceId).toBe(EAST.id);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceProjectId: "E0ACME",
      workspaces: [WEST, EAST],
      workspacesReadAt: NOW,
      removedWorkspaces: [],
      defaultWorkspaceId: EAST.id,
    });
  });

  test("a default never stored that OneUptime was removed from: the first workspace left by name is stored, with the one it left", async () => {
    // Listed before: East and West, so East was the default, read by name.
    answer(
      "auth.teams.list",
      teamsPage([WEST, LABS] as unknown as Array<JSONObject>),
    );

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({
          defaultWorkspaceId: undefined,
          workspacesReadAt: minutesAgo(30),
        }),
      });

    expect(connection?.defaultWorkspaceId).toBe(LABS.id);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceProjectId: "E0ACME",
      workspaces: [WEST, LABS],
      workspacesReadAt: NOW,
      removedWorkspaces: [EAST],
      defaultWorkspaceId: LABS.id,
    });
  });

  test("a default stored where it moved stays there when OneUptime is added to the old one again", async () => {
    // Removed from East: the default moves to Labs, and is stored there.
    answer(
      "auth.teams.list",
      teamsPage([WEST, LABS] as unknown as Array<JSONObject>),
    );

    await SlackOrganization.getOfConnection({
      projectId: PROJECT_ID,
      projectAuth: organizationAuth({ defaultWorkspaceId: undefined }),
      refresh: true,
    });

    const moved: string | undefined = (
      updateSpy.mock.calls[0]![0] as { defaultWorkspaceId?: string }
    ).defaultWorkspaceId;

    expect(moved).toBe(LABS.id);

    // Added to East again, which comes first by name: Labs stays the default.
    answer(
      "auth.teams.list",
      teamsPage([WEST, LABS, EAST] as unknown as Array<JSONObject>),
    );

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({
          workspaces: [WEST, LABS],
          removedWorkspaces: [EAST],
          defaultWorkspaceId: moved,
        }),
        refresh: true,
      });

    expect(connection?.defaultWorkspaceId).toBe(LABS.id);
    expect(idsOf(connection!.workspaces)).toEqual([LABS.id, EAST.id, WEST.id]);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(Object.keys(updateSpy.mock.calls[1]![0]!)).not.toContain(
      "defaultWorkspaceId",
    );
  });

  test.each([
    ["refuses", refused("invalid_auth")],
    ["answers with an HTTP error", new HTTPErrorResponse(503, {}, {})],
    ["cannot be reached", new Error("getaddrinfo ENOTFOUND slack.com")],
  ])(
    "Slack %s: the workspaces listed last, never a throw, nothing stored",
    async (
      _: string,
      response: HTTPResponse<JSONObject> | HTTPErrorResponse | Error,
    ) => {
      answer("auth.teams.list", response);

      const connection: SlackOrganizationConnection | null =
        await SlackOrganization.getOfConnection({
          projectId: PROJECT_ID,
          projectAuth: organizationAuth({ workspacesReadAt: minutesAgo(30) }),
        });

      expect(idsOf(connection!.workspaces)).toEqual([EAST.id, WEST.id]);
      expect(connection!.workspacesReadAt).toEqual(
        OneUptimeDate.addRemoveMinutes(NOW, -30),
      );
      expect(updateSpy).not.toHaveBeenCalled();
    },
  );

  test("the list cannot be stored: the one Slack gave is used all the same", async () => {
    answer("auth.teams.list", teamsPage([LABS as unknown as JSONObject]));
    updateSpy.mockRejectedValue(new Error("database is down"));

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({ workspacesReadAt: minutesAgo(30) }),
      });

    expect(connection?.workspaces).toEqual([LABS]);
    expect(connection?.defaultWorkspaceId).toBe(LABS.id);
  });

  test("a connection without a token is read as stored: Slack cannot be asked", async () => {
    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth(
          { workspacesReadAt: minutesAgo(30) },
          { authToken: undefined },
        ),
        refresh: true,
      });

    expect(idsOf(connection!.workspaces)).toEqual([EAST.id, WEST.id]);
    expect(calls).toEqual([]);
  });
});

describe("getOfProject", () => {
  test("reads the project's Slack connection, then the organization", async () => {
    const getProjectAuth: SpyInstance<
      typeof WorkspaceProjectAuthTokenService.getProjectAuth
    > = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(organizationAuth());

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfProject({ projectId: PROJECT_ID });

    expect(connection?.enterpriseId).toBe("E0ACME");
    expect(getProjectAuth).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
    });
  });

  test("a connection that cannot be read: none, never a throw", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockRejectedValue(new Error("database is down"));

    expect(
      await SlackOrganization.getOfProject({ projectId: PROJECT_ID }),
    ).toBeNull();
  });

  test("no connection, or one workspace's: none", async () => {
    const getProjectAuth: SpyInstance<
      typeof WorkspaceProjectAuthTokenService.getProjectAuth
    > = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);

    expect(
      await SlackOrganization.getOfProject({ projectId: PROJECT_ID }),
    ).toBeNull();

    getProjectAuth.mockResolvedValue(workspaceAuth());

    expect(
      await SlackOrganization.getOfProject({ projectId: PROJECT_ID }),
    ).toBeNull();
  });
});

/*
 * #6748: Slack telling the organization's installation that an admin added
 * it to workspaces or removed it (team_access_granted, team_access_revoked).
 * Each project connected to the organization reads its workspaces again at
 * once, however fresh they are.
 */
describe("refreshOrganization: the projects connected to an organization read its workspaces again", () => {
  const STAGING_ID: ObjectID = new ObjectID(
    "5a000000-0000-4000-8000-000000000002",
  );
  const EAST_OPS_ID: ObjectID = new ObjectID(
    "5a000000-0000-4000-8000-000000000003",
  );

  test("each one connected under the organization's id, with its own token - even with a list read a minute ago; a workspace's own connection stored under it is left alone", async () => {
    const findBy: SpyInstance<typeof WorkspaceProjectAuthTokenService.findBy> =
      jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
        organizationAuth({ workspacesReadAt: minutesAgo(1) }),
        organizationAuth(
          { workspacesReadAt: minutesAgo(1) },
          { projectId: STAGING_ID, authToken: "xoxb-organization-staging" },
        ),
        // Not the organization's installation: it lists no workspaces.
        workspaceAuth(
          {},
          { projectId: EAST_OPS_ID, workspaceProjectId: "E0ACME" },
        ),
      ]);

    answer(
      "auth.teams.list",
      teamsPage([EAST, WEST, LABS] as unknown as Array<JSONObject>),
    );

    const refreshed: Array<ObjectID> =
      await SlackOrganization.refreshOrganization({ enterpriseId: " E0ACME " });

    expect(
      refreshed.map((projectId: ObjectID): string => {
        return projectId.toString();
      }),
    ).toEqual([PROJECT_ID.toString(), STAGING_ID.toString()]);

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: {
        workspaceType: WorkspaceType.Slack,
        workspaceProjectId: "E0ACME",
      },
      select: {
        projectId: true,
        authToken: true,
        workspaceProjectId: true,
        miscData: true,
      },
      props: { isRoot: true },
    });

    expect(
      methodCalls("auth.teams.list").map((call: SlackCall): unknown => {
        return call.headers["Authorization"];
      }),
    ).toEqual(["Bearer xoxb-organization", "Bearer xoxb-organization-staging"]);

    expect(
      updateSpy.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { projectId: ObjectID }).projectId.toString();
      }),
    ).toEqual([PROJECT_ID.toString(), STAGING_ID.toString()]);
  });

  test("no organization named: nothing is read", async () => {
    const findBy: SpyInstance<typeof WorkspaceProjectAuthTokenService.findBy> =
      jest.spyOn(WorkspaceProjectAuthTokenService, "findBy");

    for (const enterpriseId of [undefined, "", "   "]) {
      expect(
        await SlackOrganization.refreshOrganization({
          enterpriseId: enterpriseId,
        }),
      ).toEqual([]);
    }

    expect(findBy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  test("no project connected to it, or the connections cannot be read: none read, never a throw", async () => {
    const error: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    const findBy: SpyInstance<typeof WorkspaceProjectAuthTokenService.findBy> =
      jest
        .spyOn(WorkspaceProjectAuthTokenService, "findBy")
        .mockResolvedValue([]);

    expect(
      await SlackOrganization.refreshOrganization({ enterpriseId: "E0ACME" }),
    ).toEqual([]);

    findBy.mockRejectedValue(new Error("database is down"));

    expect(
      await SlackOrganization.refreshOrganization({ enterpriseId: "E0ACME" }),
    ).toEqual([]);

    expect(error).toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("getEnterpriseIdOfWorkspace: the organization a workspace connection is part of", () => {
  test("recorded at install: read as recorded, Slack not asked - an empty record means none", async () => {
    expect(
      await SlackOrganization.getEnterpriseIdOfWorkspace({
        projectId: PROJECT_ID,
        projectAuth: workspaceAuth({ enterpriseId: "E0ACME" }),
      }),
    ).toBe("E0ACME");
    expect(
      await SlackOrganization.getEnterpriseIdOfWorkspace({
        projectId: PROJECT_ID,
        projectAuth: workspaceAuth({ enterpriseId: "" }),
      }),
    ).toBe("");
    expect(calls).toEqual([]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("not recorded: Slack says (auth.test, with the connection's token), and it is kept", async () => {
    answer(
      "auth.test",
      ok({ team_id: "T0EAST", enterprise_id: "E0ACME", user_id: "U0BOT" }),
    );

    expect(
      await SlackOrganization.getEnterpriseIdOfWorkspace({
        projectId: PROJECT_ID,
        projectAuth: workspaceAuth(),
      }),
    ).toBe("E0ACME");

    expect(methodCalls("auth.test")).toEqual([
      {
        method: "auth.test",
        body: {},
        headers: {
          Authorization: "Bearer xoxb-east",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    ]);
    expect(updateSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceProjectId: "T0EAST",
      enterpriseId: "E0ACME",
    });
  });

  test("Slack says it is part of none: kept as empty, so it is not asked again", async () => {
    answer("auth.test", ok({ team_id: "T0EAST" }));

    expect(
      await SlackOrganization.getEnterpriseIdOfWorkspace({
        projectId: PROJECT_ID,
        projectAuth: workspaceAuth(),
      }),
    ).toBe("");
    expect(updateSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceProjectId: "T0EAST",
      enterpriseId: "",
    });
  });

  test.each([
    ["refuses", refused("invalid_auth")],
    ["answers with an HTTP error", new HTTPErrorResponse(500, {}, {})],
    ["cannot be reached", new Error("socket hang up")],
  ])(
    "Slack %s: none for now, and nothing kept - it is asked again next time",
    async (
      _: string,
      response: HTTPResponse<JSONObject> | HTTPErrorResponse | Error,
    ) => {
      answer("auth.test", response);

      expect(
        await SlackOrganization.getEnterpriseIdOfWorkspace({
          projectId: PROJECT_ID,
          projectAuth: workspaceAuth(),
        }),
      ).toBe("");
      expect(updateSpy).not.toHaveBeenCalled();
    },
  );

  test("no token or no workspace: none, and Slack is not asked", async () => {
    expect(
      await SlackOrganization.getEnterpriseIdOfWorkspace({
        projectId: PROJECT_ID,
        projectAuth: workspaceAuth({}, { authToken: undefined }),
      }),
    ).toBe("");
    expect(
      await SlackOrganization.getEnterpriseIdOfWorkspace({
        projectId: PROJECT_ID,
        projectAuth: workspaceAuth({}, { workspaceProjectId: undefined }),
      }),
    ).toBe("");
    expect(
      await SlackOrganization.getEnterpriseIdOfWorkspace({
        projectId: PROJECT_ID,
        projectAuth: null,
      }),
    ).toBe("");
    expect(calls).toEqual([]);
  });

  test("what Slack said cannot be kept: it is answered all the same", async () => {
    answer("auth.test", ok({ team_id: "T0EAST", enterprise_id: "E0ACME" }));
    updateSpy.mockRejectedValue(new Error("database is down"));

    expect(
      await SlackOrganization.getEnterpriseIdOfWorkspace({
        projectId: PROJECT_ID,
        projectAuth: workspaceAuth(),
      }),
    ).toBe("E0ACME");
  });
});

describe("isSameOrganization: whether a project may move without being disconnected first", () => {
  const ORGANIZATION_INSTALL: SlackInstallation = {
    workspaceProjectId: "E0ACME",
    isEnterpriseInstall: true,
    teamId: "E0ACME",
    teamName: "Acme Corp",
    enterpriseId: "E0ACME",
    enterpriseName: "Acme Corp",
  };

  const EAST_INSTALL: SlackInstallation = {
    workspaceProjectId: "T0EAST",
    isEnterpriseInstall: false,
    teamId: "T0EAST",
    teamName: "Acme East",
    enterpriseId: "E0ACME",
    enterpriseName: "Acme Corp",
  };

  test("the same installation connected again: nothing moves", async () => {
    expect(
      await SlackOrganization.isSameOrganization({
        existing: organizationAuth(),
        installation: ORGANIZATION_INSTALL,
      }),
    ).toBe(true);
    expect(
      await SlackOrganization.isSameOrganization({
        existing: workspaceAuth(),
        installation: EAST_INSTALL,
      }),
    ).toBe(true);
    expect(calls).toEqual([]);
  });

  test("the organization's installation, replaced by one of its own workspaces': allowed", async () => {
    expect(
      await SlackOrganization.isSameOrganization({
        existing: organizationAuth(),
        installation: {
          ...EAST_INSTALL,
          teamId: "T0WEST",
          workspaceProjectId: "T0WEST",
        },
      }),
    ).toBe(true);
    expect(calls).toEqual([]);
  });

  test("the organization's installation, replaced by a workspace of another organization: refused", async () => {
    expect(
      await SlackOrganization.isSameOrganization({
        existing: organizationAuth(),
        installation: {
          ...EAST_INSTALL,
          enterpriseId: "E0OTHER",
          enterpriseName: "Other Corp",
        },
      }),
    ).toBe(false);
  });

  test("an organization's id stored without the flag (E...) is read as the organization's", async () => {
    const legacy: WorkspaceProjectAuthToken = organizationAuth({
      isEnterpriseInstall: undefined,
    });

    expect(
      await SlackOrganization.isSameOrganization({
        existing: legacy,
        installation: EAST_INSTALL,
      }),
    ).toBe(true);
    expect(
      await SlackOrganization.isSameOrganization({
        existing: legacy,
        installation: { ...EAST_INSTALL, enterpriseId: "E0OTHER" },
      }),
    ).toBe(false);
  });

  test("a workspace, replaced by its organization's installation, told by the organization recorded at install", async () => {
    expect(
      await SlackOrganization.isSameOrganization({
        existing: workspaceAuth({ enterpriseId: "E0ACME" }),
        installation: ORGANIZATION_INSTALL,
      }),
    ).toBe(true);
    expect(calls).toEqual([]);
  });

  test("a workspace, replaced by its organization's installation, told by the workspaces it was added to", async () => {
    expect(
      await SlackOrganization.isSameOrganization({
        existing: workspaceAuth(),
        installation: ORGANIZATION_INSTALL,
        workspaces: [WEST, EAST],
      }),
    ).toBe(true);
    expect(calls).toEqual([]);
  });

  test("a workspace connected before installs recorded the organization: Slack is asked with the OLD connection's token", async () => {
    answer("auth.test", ok({ team_id: "T0EAST", enterprise_id: "E0ACME" }));

    expect(
      await SlackOrganization.isSameOrganization({
        existing: workspaceAuth(),
        installation: ORGANIZATION_INSTALL,
        workspaces: [WEST],
      }),
    ).toBe(true);
    expect(methodCalls("auth.test")[0]!.headers).toMatchObject({
      Authorization: "Bearer xoxb-east",
    });
  });

  test.each([
    [
      "another organization",
      ok({ team_id: "T0EAST", enterprise_id: "E0OTHER" }),
    ],
    ["no organization", ok({ team_id: "T0EAST" })],
    [
      "another workspace altogether",
      ok({ team_id: "T0ELSEWHERE", enterprise_id: "E0ACME" }),
    ],
    ["a refusal", refused("token_revoked")],
    ["an HTTP error", new HTTPErrorResponse(500, {}, {})],
    ["no answer", new Error("socket hang up")],
  ])(
    "Slack says %s for the old workspace: refused",
    async (
      _: string,
      response: HTTPResponse<JSONObject> | HTTPErrorResponse | Error,
    ) => {
      answer("auth.test", response);

      expect(
        await SlackOrganization.isSameOrganization({
          existing: workspaceAuth(),
          installation: ORGANIZATION_INSTALL,
        }),
      ).toBe(false);
    },
  );

  test("the workspace recorded as another organization's is not taken on the record's word: Slack decides", async () => {
    answer("auth.test", ok({ team_id: "T0EAST", enterprise_id: "E0OTHER" }));

    expect(
      await SlackOrganization.isSameOrganization({
        existing: workspaceAuth({ enterpriseId: "E0OTHER" }),
        installation: ORGANIZATION_INSTALL,
      }),
    ).toBe(false);
  });

  test("a workspace replaced by another workspace - even of the same organization - is refused, without asking Slack", async () => {
    expect(
      await SlackOrganization.isSameOrganization({
        existing: workspaceAuth({ enterpriseId: "E0ACME" }),
        installation: {
          ...EAST_INSTALL,
          teamId: "T0WEST",
          workspaceProjectId: "T0WEST",
        },
      }),
    ).toBe(false);
    expect(calls).toEqual([]);
  });

  test("an old workspace connection without a token cannot be asked about: refused", async () => {
    expect(
      await SlackOrganization.isSameOrganization({
        existing: workspaceAuth({}, { authToken: undefined }),
        installation: ORGANIZATION_INSTALL,
      }),
    ).toBe(false);
    expect(calls).toEqual([]);
  });

  test("nothing connected, or an installation of no organization: refused", async () => {
    expect(
      await SlackOrganization.isSameOrganization({
        existing: workspaceAuth({}, { workspaceProjectId: undefined }),
        installation: ORGANIZATION_INSTALL,
      }),
    ).toBe(false);
    expect(
      await SlackOrganization.isSameOrganization({
        existing: workspaceAuth(),
        installation: {
          workspaceProjectId: "T0WEST",
          isEnterpriseInstall: false,
          teamId: "T0WEST",
          teamName: "Acme West",
        },
      }),
    ).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("which workspace each call is made in", () => {
  const organization: SlackOrganizationConnection = {
    enterpriseId: "E0ACME",
    enterpriseName: "Acme Corp",
    workspaces: [EAST, LABS, WEST],
    defaultWorkspaceId: EAST.id,
    workspacesReadAt: NOW,
    removedWorkspaces: [],
  };

  test("getWorkspaceIdsToSearch: the default first and then the others; the rule's workspace first when it names one", () => {
    expect(
      SlackOrganization.getWorkspaceIdsToSearch({ organization: organization }),
    ).toEqual([EAST.id, LABS.id, WEST.id]);
    expect(
      SlackOrganization.getWorkspaceIdsToSearch({
        organization: organization,
        teamId: WEST.id,
      }),
    ).toEqual([WEST.id, EAST.id, LABS.id]);
    expect(
      SlackOrganization.getWorkspaceIdsToSearch({
        organization: organization,
        teamId: " ",
      }),
    ).toEqual([EAST.id, LABS.id, WEST.id]);
  });

  test("getWorkspaceIdsToSearch: a workspace not listed yet is still searched - the rule's, or the default", () => {
    expect(
      SlackOrganization.getWorkspaceIdsToSearch({
        organization: organization,
        teamId: "T0NEW",
      }),
    ).toEqual(["T0NEW", EAST.id, LABS.id, WEST.id]);
    expect(
      SlackOrganization.getWorkspaceIdsToSearch({
        organization: {
          ...organization,
          workspaces: [WEST],
          defaultWorkspaceId: EAST.id,
        },
      }),
    ).toEqual([EAST.id, WEST.id]);
    expect(
      SlackOrganization.getWorkspaceIdsToSearch({
        organization: {
          ...organization,
          workspaces: [],
          defaultWorkspaceId: undefined,
        },
      }),
    ).toEqual([]);
  });

  test("getWorkspaceIdForCalls: a workspace's own; an organization's default; empty while added to none", () => {
    expect(SlackOrganization.getWorkspaceIdForCalls(workspaceAuth())).toBe(
      EAST.id,
    );
    expect(
      SlackOrganization.getWorkspaceIdForCalls(
        organizationAuth({ defaultWorkspaceId: WEST.id }),
      ),
    ).toBe(WEST.id);
    expect(
      SlackOrganization.getWorkspaceIdForCalls(
        organizationAuth({ workspaces: [], defaultWorkspaceId: undefined }),
      ),
    ).toBe("");
    expect(SlackOrganization.getWorkspaceIdForCalls(null)).toBe("");
    expect(SlackOrganization.getWorkspaceIdForCalls(undefined)).toBe("");
    // Never the organization's own id, which no workspace call takes.
    expect(
      SlackOrganization.getWorkspaceIdForCalls(organizationAuth()),
    ).not.toBe("E0ACME");
  });

  test("getWorkspaceIdToCreateIn: the rule's workspace, else the default, else none", () => {
    expect(
      SlackOrganization.getWorkspaceIdToCreateIn({
        organization: organization,
        teamId: WEST.id,
      }),
    ).toBe(WEST.id);
    expect(
      SlackOrganization.getWorkspaceIdToCreateIn({
        organization: organization,
      }),
    ).toBe(EAST.id);
    expect(
      SlackOrganization.getWorkspaceIdToCreateIn({
        organization: organization,
        teamId: "  ",
      }),
    ).toBe(EAST.id);
    expect(
      SlackOrganization.getWorkspaceIdToCreateIn({
        organization: {
          ...organization,
          workspaces: [],
          defaultWorkspaceId: undefined,
        },
      }),
    ).toBeUndefined();
  });

  test("getWorkspaceIdOfChannel: for an organization, the rule's workspace, else the default", () => {
    expect(
      SlackOrganization.getWorkspaceIdOfChannel({
        projectAuth: organizationAuth(),
        teamId: WEST.id,
      }),
    ).toBe(WEST.id);
    expect(
      SlackOrganization.getWorkspaceIdOfChannel({
        projectAuth: organizationAuth(),
        teamId: undefined,
      }),
    ).toBe(EAST.id);
    expect(
      SlackOrganization.getWorkspaceIdOfChannel({
        projectAuth: organizationAuth(),
        teamId: "  ",
      }),
    ).toBe(EAST.id);
    // Added to no workspace yet: none to tell channels apart by.
    expect(
      SlackOrganization.getWorkspaceIdOfChannel({
        projectAuth: organizationAuth({
          workspaces: [],
          defaultWorkspaceId: undefined,
        }),
        teamId: undefined,
      }),
    ).toBeUndefined();
  });

  test("getWorkspaceIdOfChannel: none for a project connected to one workspace, or to none, whatever a rule names", () => {
    expect(
      SlackOrganization.getWorkspaceIdOfChannel({
        projectAuth: workspaceAuth(),
        teamId: WEST.id,
      }),
    ).toBeUndefined();
    expect(
      SlackOrganization.getWorkspaceIdOfChannel({
        projectAuth: workspaceAuth(),
        teamId: undefined,
      }),
    ).toBeUndefined();
    expect(
      SlackOrganization.getWorkspaceIdOfChannel({
        projectAuth: null,
        teamId: WEST.id,
      }),
    ).toBeUndefined();
  });

  test("getWorkspaceName: by its id, or the id when it is not listed", () => {
    expect(
      SlackOrganization.getWorkspaceName({
        organization: organization,
        teamId: LABS.id,
      }),
    ).toBe("Acme Labs");
    expect(
      SlackOrganization.getWorkspaceName({
        organization: organization,
        teamId: "T0UNLISTED",
      }),
    ).toBe("T0UNLISTED");
  });

  test("pickDefaultWorkspaceId: the one chosen while still listed - or before any is - else the first by name", () => {
    expect(
      SlackOrganization.pickDefaultWorkspaceId({
        workspaces: [WEST, EAST],
        defaultWorkspaceId: WEST.id,
      }),
    ).toBe(WEST.id);
    expect(
      SlackOrganization.pickDefaultWorkspaceId({
        workspaces: [WEST, EAST],
        defaultWorkspaceId: "T0GONE",
      }),
    ).toBe(EAST.id);
    expect(
      SlackOrganization.pickDefaultWorkspaceId({
        workspaces: [],
        defaultWorkspaceId: "T0MOVED",
      }),
    ).toBe("T0MOVED");
    expect(
      SlackOrganization.pickDefaultWorkspaceId({
        workspaces: [WEST, LABS],
      }),
    ).toBe(LABS.id);
    expect(
      SlackOrganization.pickDefaultWorkspaceId({ workspaces: [] }),
    ).toBeUndefined();
  });

  test("orderWorkspaces: the default first, then by name, ties by id - and the list given is left as it was", () => {
    const given: Array<SlackOrganizationWorkspace> = [
      { id: "T0B", name: "Same" },
      WEST,
      { id: "T0A", name: "Same" },
      EAST,
    ];
    const copy: Array<SlackOrganizationWorkspace> = [...given];

    expect(
      idsOf(
        SlackOrganization.orderWorkspaces({
          workspaces: given,
          defaultWorkspaceId: WEST.id,
        }),
      ),
    ).toEqual([WEST.id, EAST.id, "T0A", "T0B"]);
    expect(given).toEqual(copy);
  });
});

/*
 * A WORKSPACE ONEUPTIME WAS REMOVED FROM (#6749): Slack lists it no more,
 * and a rule that still picks it is told so by the name it had - never
 * posted in another workspace instead.
 */
describe("workspaces OneUptime was removed from", () => {
  const OLD: SlackOrganizationWorkspace = { id: "T0OLD", name: "Acme Old" };

  test("readConnection: as stored, by the names they had - one listed again is not removed; junk is none", () => {
    const connection: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(
        organizationAuth({
          workspaces: [WEST, EAST],
          removedWorkspaces: [
            LABS,
            { id: EAST.id, name: "Acme East, as it was" },
            { id: "", name: "Nobody" },
            null as unknown as SlackOrganizationWorkspace,
            LABS,
            { id: " T0NONAME " } as unknown as SlackOrganizationWorkspace,
          ],
        }),
      );

    expect(connection?.removedWorkspaces).toEqual([
      LABS,
      { id: "T0NONAME", name: "T0NONAME" },
    ]);
  });

  test("readConnection: none stored, or not a list - none", () => {
    expect(
      SlackOrganization.readConnection(organizationAuth())?.removedWorkspaces,
    ).toEqual([]);
    expect(
      SlackOrganization.readConnection(
        organizationAuth({
          removedWorkspaces: {
            T0LABS: LABS,
          } as unknown as Array<SlackOrganizationWorkspace>,
        }),
      )?.removedWorkspaces,
    ).toEqual([]);
  });

  test("getOfConnection: one Slack lists no more is kept by the name it had - the latest first - and stored with the list", async () => {
    // Listed before: West and East; Old was removed earlier. Now: West only.
    answer("auth.teams.list", teamsPage([{ id: "T0WEST", name: "Acme West" }]));

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({
          workspacesReadAt: minutesAgo(30),
          removedWorkspaces: [OLD],
        }),
      });

    expect(connection?.workspaces).toEqual([WEST]);
    expect(connection?.removedWorkspaces).toEqual([EAST, OLD]);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceProjectId: "E0ACME",
      workspaces: [WEST],
      workspacesReadAt: NOW,
      removedWorkspaces: [EAST, OLD],
      // East was the default: it moved to West, the one left (#6748).
      defaultWorkspaceId: WEST.id,
    });
  });

  test("getOfConnection: one OneUptime is added to again leaves the list - by the name Slack gives it now", async () => {
    answer(
      "auth.teams.list",
      teamsPage([
        { id: "T0WEST", name: "Acme West" },
        { id: "T0EAST", name: "Acme East" },
        { id: "T0OLD", name: "Acme Old, renamed" },
      ]),
    );

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({
          workspacesReadAt: minutesAgo(30),
          removedWorkspaces: [OLD],
        }),
      });

    expect(connection?.removedWorkspaces).toEqual([]);
    expect(updateSpy.mock.calls[0]![0].removedWorkspaces).toEqual([]);
    expect(
      SlackOrganization.getWorkspaceName({
        organization: connection!,
        teamId: OLD.id,
      }),
    ).toBe("Acme Old, renamed");
  });

  test("getOfConnection: Slack cannot list them - the removed ones read as stored, nothing stored", async () => {
    answer("auth.teams.list", refused("ratelimited"));

    const connection: SlackOrganizationConnection | null =
      await SlackOrganization.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: organizationAuth({
          workspacesReadAt: minutesAgo(30),
          removedWorkspaces: [OLD],
        }),
      });

    expect(connection?.removedWorkspaces).toEqual([OLD]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("getRemovedWorkspaces: those listed before and not now first, then those removed before - each once, by the name it had, none listed now", () => {
    expect(
      SlackOrganization.getRemovedWorkspaces({
        listedBefore: [WEST, EAST, { id: "", name: "Nobody" }],
        removedBefore: [OLD, EAST, LABS],
        listedNow: [WEST, { id: LABS.id, name: "Acme Labs, back" }],
      }),
    ).toEqual([EAST, OLD]);

    // A name never known: named by its id.
    expect(
      SlackOrganization.getRemovedWorkspaces({
        listedBefore: [{ id: "T0BARE", name: "" }],
        removedBefore: [],
        listedNow: [],
      }),
    ).toEqual([{ id: "T0BARE", name: "T0BARE" }]);

    // Nothing listed before, nothing removed: none.
    expect(
      SlackOrganization.getRemovedWorkspaces({
        listedBefore: [],
        removedBefore: [],
        listedNow: [WEST],
      }),
    ).toEqual([]);
  });

  test("getRemovedWorkspaces: at most 50 are kept - the latest removed, in order - whatever is listed", () => {
    const random: SeededRandom = seededRandom(6749);
    // Rounds with more than 50 to keep: the cap is reached.
    let capped: number = 0;

    for (let round: number = 0; round < 20; round++) {
      const listedBefore: Array<SlackOrganizationWorkspace> = [];
      const removedBefore: Array<SlackOrganizationWorkspace> = [];
      const listedCount: number = 10 + random(50);
      const removedCount: number = 10 + random(50);

      for (let index: number = 0; index < listedCount; index++) {
        listedBefore.push({ id: `T0L${index}`, name: `Listed ${index}` });
      }

      for (let index: number = 0; index < removedCount; index++) {
        removedBefore.push({ id: `T0R${index}`, name: `Removed ${index}` });
      }

      // Some of those listed before are listed still.
      const listedNow: Array<SlackOrganizationWorkspace> = listedBefore.filter(
        (): boolean => {
          return random(3) === 0;
        },
      );

      const candidates: Array<SlackOrganizationWorkspace> = [
        ...listedBefore.filter((workspace: SlackOrganizationWorkspace) => {
          return !listedNow.includes(workspace);
        }),
        ...removedBefore,
      ];

      if (candidates.length > 50) {
        capped++;
      }

      const expected: Array<SlackOrganizationWorkspace> = candidates.slice(
        0,
        SlackOrganization.MAX_REMOVED_WORKSPACES,
      );

      const removed: Array<SlackOrganizationWorkspace> =
        SlackOrganization.getRemovedWorkspaces({
          listedBefore: listedBefore,
          removedBefore: removedBefore,
          listedNow: listedNow,
        });

      expect(removed).toEqual(expected);
      expect(removed.length).toBeLessThanOrEqual(50);
    }

    expect(capped).toBeGreaterThan(0);
  });

  test("isWorkspaceAdded: one Slack listed is; one it did not list is not; before Slack listed any, each is taken as added", () => {
    const organization: SlackOrganizationConnection =
      SlackOrganization.readConnection(organizationAuth())!;

    expect(
      SlackOrganization.isWorkspaceAdded({
        organization: organization,
        teamId: EAST.id,
      }),
    ).toBe(true);
    expect(
      SlackOrganization.isWorkspaceAdded({
        organization: organization,
        teamId: LABS.id,
      }),
    ).toBe(false);

    // Listed, and added to none.
    expect(
      SlackOrganization.isWorkspaceAdded({
        organization: SlackOrganization.readConnection(
          organizationAuth({ workspaces: [], defaultWorkspaceId: undefined }),
        )!,
        teamId: EAST.id,
      }),
    ).toBe(false);

    // Never listed: Slack is the one to say.
    expect(
      SlackOrganization.isWorkspaceAdded({
        organization: SlackOrganization.readConnection(
          organizationAuth({ workspaces: [], workspacesReadAt: undefined }),
        )!,
        teamId: LABS.id,
      }),
    ).toBe(true);
  });

  test("getNotAddedMessage: the workspace by the name it had and the organization's name, and what to do - nothing about another workspace taking over", () => {
    const organization: SlackOrganizationConnection =
      SlackOrganization.readConnection(
        organizationAuth({ workspaces: [WEST], removedWorkspaces: [EAST] }),
      )!;

    expect(
      SlackOrganization.getNotAddedMessage({
        organization: organization,
        teamId: EAST.id,
      }),
    ).toBe(
      "OneUptime is no longer added to the Acme East workspace of Acme Corp. Add it again in Slack's organization settings, or pick another workspace on the rule.",
    );

    // A workspace never named: by its id. An organization never named: said so.
    expect(
      SlackOrganization.getNotAddedMessage({
        organization: { ...organization, enterpriseName: "" },
        teamId: "T0UNKNOWN",
      }),
    ).toBe(
      "OneUptime is no longer added to the T0UNKNOWN workspace of your Slack Enterprise organization. Add it again in Slack's organization settings, or pick another workspace on the rule.",
    );
  });

  test("getNotAddedException: a bad request carrying the workspace and the plain message", () => {
    const organization: SlackOrganizationConnection =
      SlackOrganization.readConnection(
        organizationAuth({ workspaces: [WEST], removedWorkspaces: [EAST] }),
      )!;

    const exception: SlackWorkspaceNotAddedException =
      SlackOrganization.getNotAddedException({
        organization: organization,
        teamId: EAST.id,
      });

    expect(exception).toBeInstanceOf(SlackWorkspaceNotAddedException);
    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.teamId).toBe(EAST.id);
    expect(exception.message).toBe(
      SlackOrganization.getNotAddedMessage({
        organization: organization,
        teamId: EAST.id,
      }),
    );
  });

  test("getWorkspaceName: a removed workspace by the name it had; one listed by its name now", () => {
    const organization: SlackOrganizationConnection =
      SlackOrganization.readConnection(
        organizationAuth({
          workspaces: [WEST, EAST],
          removedWorkspaces: [OLD],
        }),
      )!;

    expect(
      SlackOrganization.getWorkspaceName({
        organization: organization,
        teamId: OLD.id,
      }),
    ).toBe("Acme Old");
    expect(
      SlackOrganization.getWorkspaceName({
        organization: organization,
        teamId: WEST.id,
      }),
    ).toBe("Acme West");
  });

  test("getWorkspaceIdOfKnownChannel: the workspace a channel OneUptime knows is in - by its id; none for one it does not know, or a workspace's own connection", () => {
    const channelCache: SlackChannelCache = {
      "inc-1-checkout": {
        id: "C0INC1",
        name: "inc-1-checkout",
        lastUpdated: NOW.toISOString(),
        teamId: WEST.id,
      },
      oncall: {
        id: "C0ONCALL",
        name: "oncall",
        lastUpdated: NOW.toISOString(),
        teamId: EAST.id,
      },
      // Cached before the organization's installation: no workspace.
      general: {
        id: "C0GENERAL",
        name: "general",
        lastUpdated: NOW.toISOString(),
      },
    };

    const projectAuth: WorkspaceProjectAuthToken = organizationAuth({
      channelCache: channelCache,
    });

    expect(
      SlackOrganization.getWorkspaceIdOfKnownChannel({
        projectAuth: projectAuth,
        channelId: "C0INC1",
      }),
    ).toBe(WEST.id);
    expect(
      SlackOrganization.getWorkspaceIdOfKnownChannel({
        projectAuth: projectAuth,
        channelId: " C0ONCALL ",
      }),
    ).toBe(EAST.id);

    for (const channelId of ["C0GENERAL", "C0UNKNOWN", "", undefined]) {
      expect(
        SlackOrganization.getWorkspaceIdOfKnownChannel({
          projectAuth: projectAuth,
          channelId: channelId,
        }),
      ).toBeUndefined();
    }

    // A workspace's own connection: its channels are all in it.
    expect(
      SlackOrganization.getWorkspaceIdOfKnownChannel({
        projectAuth: workspaceAuth({
          channelCache: channelCache,
        }),
        channelId: "C0INC1",
      }),
    ).toBeUndefined();

    for (const missing of [null, undefined, organizationAuth()]) {
      expect(
        SlackOrganization.getWorkspaceIdOfKnownChannel({
          projectAuth: missing,
          channelId: "C0INC1",
        }),
      ).toBeUndefined();
    }
  });
});
