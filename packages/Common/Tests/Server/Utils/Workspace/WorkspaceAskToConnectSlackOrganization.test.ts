import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Project from "../../../../Models/DatabaseModels/Project";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
  SlackOrganizationWorkspace,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import ProjectService from "../../../../Server/Services/ProjectService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../../Server/Utils/Logger";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import SlackChannelMembers, {
  SlackChannelMembersError,
  SlackPersonFacts,
} from "../../../../Server/Utils/Workspace/Slack/SlackChannelMembers";
import WorkspaceAskToConnect, {
  SLACK_LOOKUP_ONE_BY_ONE_MAX,
  WorkspaceAskToConnectPerson,
} from "../../../../Server/Utils/Workspace/WorkspaceAskToConnect";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Sleep from "../../../../Types/Sleep";
import {
  WorkspaceAskToConnectRun,
  WorkspaceAskToConnectState,
} from "../../../../Types/Workspace/WorkspaceAskToConnect";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";

jest.mock("../../../../Server/Utils/Logger");

/*
 * ASKING THE MEMBERS OF A SLACK ENTERPRISE ORGANIZATION TO CONNECT.
 *
 * Above SLACK_LOOKUP_ONE_BY_ONE_MAX people, OneUptime reads the workspace's
 * people page by page (users.list) instead of looking each one up by email.
 * The organization's token reads them one workspace at a time (team_id):
 * every workspace OneUptime was added to, the default first, until
 * everybody is found. A workspace that refuses is passed over; one
 * workspace's installation reads its people as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c7000000-0000-4000-8000-000000000001",
);

const NOW: Date = new Date("2026-11-11T09:00:00.000Z");

const ORGANIZATION_TOKEN: string = "xoxb-acme-organization";

const WEST: SlackOrganizationWorkspace = { id: "T0WEST", name: "Acme West" };
const EAST: SlackOrganizationWorkspace = { id: "T0EAST", name: "Acme East" };
const LABS: SlackOrganizationWorkspace = { id: "T0LABS", name: "Acme Labs" };

// Pages are keyed by workspace; "" is a workspace's own installation (no team_id).
const OWN: string = "";

let peoplePages: Record<string, Array<Array<SlackPersonFacts>>>;
let refusals: Map<string, Array<string>>;
let pageSpy: SpyInstance<typeof SlackChannelMembers.getPeoplePage>;
let lookupSpy: SpyInstance<typeof SlackChannelMembers.findPersonByEmail>;
let dmSpy: SpyInstance<typeof SlackUtil.sendDirectMessageToUser>;
let workspacesSlackLists: Array<SlackOrganizationWorkspace>;
let slackCalls: Array<string>;

function slackPerson(
  id: string,
  email: string,
  facts: Partial<SlackPersonFacts> = {},
): SlackPersonFacts {
  return {
    id: id,
    name: id,
    email: email,
    isBot: false,
    isDeactivated: false,
    isGuest: false,
    ...facts,
  };
}

// `count` project members, person-1@acme.test and on.
function members(count: number): Array<WorkspaceAskToConnectPerson> {
  const people: Array<WorkspaceAskToConnectPerson> = [];

  for (let index: number = 1; index <= count; index++) {
    const userId: ObjectID = new ObjectID(
      `c7000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`,
    );

    people.push({
      userId: userId,
      key: userId.toString().toLowerCase(),
      name: `Person ${index}`,
      email: `person-${index}@acme.test`,
    });
  }

  return people;
}

// Slack's people for members `from`..`to`: U0P<n>.
function slackPeople(from: number, to: number): Array<SlackPersonFacts> {
  const people: Array<SlackPersonFacts> = [];

  for (let index: number = from; index <= to; index++) {
    people.push(slackPerson(`U0P${index}`, `person-${index}@acme.test`));
  }

  return people;
}

// The pages read, as [workspace, cursor].
function pagesRead(): Array<[string | undefined, string]> {
  return pageSpy.mock.calls.map(
    (call: Array<unknown>): [string | undefined, string] => {
      const data: { teamId?: string; cursor: string } = call[0] as {
        teamId?: string;
        cursor: string;
      };
      return [data.teamId, data.cursor];
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

async function findAccounts(data: {
  people: Array<WorkspaceAskToConnectPerson>;
  slackWorkspaceIds?: Array<string> | undefined;
}): Promise<Map<string, string>> {
  return await WorkspaceAskToConnect.findAccounts({
    projectId: PROJECT_ID,
    workspaceType: WorkspaceType.Slack,
    authToken: ORGANIZATION_TOKEN,
    people: data.people,
    keepLock: async (): Promise<void> => {
      return undefined;
    },
    slackWorkspaceIds: data.slackWorkspaceIds,
  });
}

function organizationRow(
  miscData: Partial<SlackMiscData> = {},
): WorkspaceProjectAuthToken {
  return {
    projectId: PROJECT_ID,
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
      workspaces: [EAST, WEST],
      workspacesReadAt: OneUptimeDate.toString(
        OneUptimeDate.addRemoveMinutes(NOW, -2),
      ),
      defaultWorkspaceId: WEST.id,
      ...miscData,
    },
  } as unknown as WorkspaceProjectAuthToken;
}

function newRun(toAskCount: number): WorkspaceAskToConnectRun {
  return {
    state: WorkspaceAskToConnectState.Asking,
    startedAt: NOW.toISOString(),
    askedByName: "Jane Admin",
    toAskCount: toAskCount,
    askedCount: 0,
    notFoundCount: 0,
    failedCount: 0,
    notFoundNames: [],
  };
}

beforeEach(() => {
  refusals = new Map();
  slackCalls = [];
  workspacesSlackLists = [EAST, WEST];
  peoplePages = {};

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);

  pageSpy = jest
    .spyOn(SlackChannelMembers, "getPeoplePage")
    .mockImplementation(
      async (data: { cursor: string; teamId?: string | undefined }) => {
        const workspace: string = data.teamId || OWN;
        const refused: Array<string> | undefined = refusals.get(workspace);

        if (refused && refused.length > 0) {
          // Each refusal once, in order; the last one stays.
          const code: string =
            refused.length > 1 ? refused.shift()! : refused[0]!;
          throw new SlackChannelMembersError(code);
        }

        const pages: Array<Array<SlackPersonFacts>> =
          peoplePages[workspace] || [];
        const index: number = data.cursor ? Number(data.cursor) : 0;

        return {
          people: pages[index] || [],
          nextCursor: index + 1 < pages.length ? String(index + 1) : "",
        };
      },
    );

  lookupSpy = jest
    .spyOn(SlackChannelMembers, "findPersonByEmail")
    .mockImplementation(async (data: { email: string }) => {
      const all: Array<SlackPersonFacts> = Object.values(peoplePages)
        .flat()
        .flat();

      return (
        all.find((person: SlackPersonFacts): boolean => {
          return person.email.toLowerCase() === data.email.toLowerCase();
        }) || null
      );
    });

  dmSpy = jest
    .spyOn(SlackUtil, "sendDirectMessageToUser")
    .mockResolvedValue(null);

  jest.spyOn(API, "post").mockImplementation((async (request: {
    url: URL;
  }): Promise<HTTPResponse<JSONObject>> => {
    const method: string = request.url.toString().split("/").pop() || "";
    slackCalls.push(method);

    const answer: JSONObject =
      method === "auth.teams.list"
        ? {
            ok: true,
            teams: workspacesSlackLists.map(
              (workspace: SlackOrganizationWorkspace): JSONObject => {
                return { id: workspace.id, name: workspace.name };
              },
            ),
          }
        : { ok: false, error: "unknown_method" };

    return {
      jsonData: answer,
      data: answer,
    } as unknown as HTTPResponse<JSONObject>;
  }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "updateSlackOrganization")
    .mockResolvedValue(undefined);

  // What ask() keeps as it goes: the run, the lock, who was asked.
  jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
  jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined as never);
  jest.spyOn(GlobalCache, "extendExpiry").mockResolvedValue(true as never);
  jest.spyOn(GlobalCache, "deleteKeyIfValue").mockResolvedValue(true as never);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const project: Project = new Project();
    project.name = "Acme Production";
    return project;
  }) as never);

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example.com/dashboard"),
    );
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(logger.error).mockClear();
});

describe("findAccounts with an organization's workspaces", () => {
  test("each workspace's people are read with its team_id - in the order given - page by page", async () => {
    const people: Array<WorkspaceAskToConnectPerson> = members(30);
    peoplePages = {
      [WEST.id]: [slackPeople(1, 10), slackPeople(11, 18)],
      [EAST.id]: [slackPeople(19, 30)],
    };

    const found: Map<string, string> = await findAccounts({
      people: people,
      slackWorkspaceIds: [WEST.id, EAST.id],
    });

    expect(pagesRead()).toEqual([
      [WEST.id, ""],
      [WEST.id, "1"],
      [EAST.id, ""],
    ]);
    expect(found.size).toBe(30);
    expect(found.get(people[0]!.key)).toBe("U0P1");
    expect(found.get(people[29]!.key)).toBe("U0P30");
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  test("everybody found: no further page, and no other workspace, is read", async () => {
    const people: Array<WorkspaceAskToConnectPerson> = members(25);
    peoplePages = {
      [WEST.id]: [slackPeople(1, 25), slackPeople(100, 120)],
      [EAST.id]: [slackPeople(1, 25)],
    };

    const found: Map<string, string> = await findAccounts({
      people: people,
      slackWorkspaceIds: [WEST.id, EAST.id],
    });

    expect(found.size).toBe(25);
    expect(pagesRead()).toEqual([[WEST.id, ""]]);
  });

  test("somebody in no workspace: every workspace is read to its last page, and they are not found", async () => {
    const people: Array<WorkspaceAskToConnectPerson> = members(22);
    peoplePages = {
      [WEST.id]: [slackPeople(1, 10)],
      [EAST.id]: [slackPeople(11, 15), slackPeople(16, 21)],
    };

    const found: Map<string, string> = await findAccounts({
      people: people,
      slackWorkspaceIds: [WEST.id, EAST.id],
    });

    expect(found.size).toBe(21);
    expect(found.has(people[21]!.key)).toBe(false);
    expect(pagesRead()).toEqual([
      [WEST.id, ""],
      [EAST.id, ""],
      [EAST.id, "1"],
    ]);
  });

  test("a person deactivated in one workspace is found in another they are active in", async () => {
    const people: Array<WorkspaceAskToConnectPerson> = members(21);
    peoplePages = {
      [WEST.id]: [
        [
          ...slackPeople(1, 20),
          slackPerson("U0P21", "person-21@acme.test", { isDeactivated: true }),
        ],
      ],
      [EAST.id]: [[slackPerson("U0P21", "Person-21@Acme.test")]],
    };

    const found: Map<string, string> = await findAccounts({
      people: people,
      slackWorkspaceIds: [WEST.id, EAST.id],
    });

    expect(found.get(people[20]!.key)).toBe("U0P21");
    expect(found.size).toBe(21);
  });

  test("a person in two workspaces is found once - in the first", async () => {
    const people: Array<WorkspaceAskToConnectPerson> = members(22);
    peoplePages = {
      [WEST.id]: [slackPeople(1, 21)],
      [EAST.id]: [
        [
          slackPerson("U0OTHER", "person-1@acme.test"),
          slackPerson("U0P22", "person-22@acme.test"),
        ],
      ],
    };

    const found: Map<string, string> = await findAccounts({
      people: people,
      slackWorkspaceIds: [WEST.id, EAST.id],
    });

    expect(found.get(people[0]!.key)).toBe("U0P1");
    expect(found.get(people[21]!.key)).toBe("U0P22");
  });

  test("a workspace that refuses is logged and passed over; the others are read", async () => {
    const people: Array<WorkspaceAskToConnectPerson> = members(21);
    peoplePages = {
      [WEST.id]: [slackPeople(1, 21)],
      [EAST.id]: [slackPeople(1, 21)],
    };
    refusals.set(WEST.id, ["team_access_not_granted"]);

    const found: Map<string, string> = await findAccounts({
      people: people,
      slackWorkspaceIds: [WEST.id, EAST.id],
    });

    expect(found.size).toBe(21);
    expect(pagesRead()).toEqual([
      [WEST.id, ""],
      [EAST.id, ""],
    ]);
    expect(errorLines()).toContain(
      "Could not read the people of Slack workspace T0WEST of an organization's installation.",
    );
  });

  test("a busy workspace is asked again before it is passed over", async () => {
    const people: Array<WorkspaceAskToConnectPerson> = members(21);
    peoplePages = { [WEST.id]: [slackPeople(1, 21)] };

    // Rate limited once; the page is asked for again, and answered.
    pageSpy.mockImplementationOnce(async () => {
      throw new SlackChannelMembersError("ratelimited");
    });

    const found: Map<string, string> = await findAccounts({
      people: people,
      slackWorkspaceIds: [WEST.id, EAST.id],
    });

    expect(found.size).toBe(21);
    expect(pagesRead()).toEqual([
      [WEST.id, ""],
      [WEST.id, ""],
    ]);
    expect(errorLines()).toEqual([]);
  });

  test("every workspace refusing: nobody can be looked up - the first refusal is thrown", async () => {
    refusals.set(WEST.id, ["team_access_not_granted"]);
    refusals.set(EAST.id, ["invalid_auth"]);

    let refusal: unknown = null;

    try {
      await findAccounts({
        people: members(21),
        slackWorkspaceIds: [WEST.id, EAST.id],
      });
    } catch (err) {
      refusal = err;
    }

    expect(SlackChannelMembersError.getCode(refusal)).toBe(
      "team_access_not_granted",
    );
  });

  test("added to no workspace of the organization: nobody is read, nobody found", async () => {
    expect(
      (await findAccounts({ people: members(21), slackWorkspaceIds: [] })).size,
    ).toBe(0);
    expect(pageSpy).not.toHaveBeenCalled();
  });

  test("at most 500 pages are read in all, across the workspaces", async () => {
    pageSpy.mockImplementation(async () => {
      return { people: [], nextCursor: "more" };
    });

    await findAccounts({
      people: members(21),
      slackWorkspaceIds: [WEST.id, EAST.id],
    });

    expect(pageSpy).toHaveBeenCalledTimes(500);
    expect(
      pagesRead().every((page: [string | undefined, string]): boolean => {
        return page[0] === WEST.id;
      }),
    ).toBe(true);
  });

  test(`${SLACK_LOOKUP_ONE_BY_ONE_MAX} people or fewer: looked up one by one by email, for an organization as for one workspace`, async () => {
    peoplePages = { [EAST.id]: [slackPeople(1, 3)] };

    const found: Map<string, string> = await findAccounts({
      people: members(3),
      slackWorkspaceIds: [WEST.id, EAST.id],
    });

    expect(found.size).toBe(3);
    expect(lookupSpy).toHaveBeenCalledTimes(3);
    expect(pageSpy).not.toHaveBeenCalled();
  });
});

describe("findAccounts for one workspace's installation (as before)", () => {
  test("its people are read without a workspace", async () => {
    peoplePages = { [OWN]: [slackPeople(1, 12), slackPeople(13, 21)] };

    const found: Map<string, string> = await findAccounts({
      people: members(21),
    });

    expect(found.size).toBe(21);
    expect(pagesRead()).toEqual([
      [undefined, ""],
      [undefined, "1"],
    ]);
    expect(
      pageSpy.mock.calls.every((call: Array<unknown>): boolean => {
        return !("teamId" in (call[0] as JSONObject));
      }),
    ).toBe(true);
  });

  test("a refusal is thrown as it was", async () => {
    refusals.set(OWN, ["invalid_auth"]);

    let refusal: unknown = null;

    try {
      await findAccounts({ people: members(21) });
    } catch (err) {
      refusal = err;
    }

    expect(SlackChannelMembersError.getCode(refusal)).toBe("invalid_auth");
    expect(errorLines()).toEqual([]);
  });
});

describe("asking an organization's members (ask)", () => {
  test("every workspace OneUptime was added to is read, the default first, and each person found is messaged", async () => {
    const people: Array<WorkspaceAskToConnectPerson> = members(24);
    peoplePages = {
      [WEST.id]: [slackPeople(1, 12)],
      [EAST.id]: [slackPeople(13, 23)],
    };
    const run: WorkspaceAskToConnectRun = newRun(24);

    await WorkspaceAskToConnect.ask({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      projectAuth: organizationRow(),
      people: people,
      run: run,
      holder: "holder-1",
    });

    expect(pagesRead()).toEqual([
      [WEST.id, ""],
      [EAST.id, ""],
    ]);
    expect(
      dmSpy.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { workspaceUserId: string }).workspaceUserId;
      }),
    ).toEqual(
      slackPeople(1, 23).map((person: SlackPersonFacts) => {
        return person.id;
      }),
    );
    expect(
      dmSpy.mock.calls.every((call: Array<unknown>): boolean => {
        return (
          (call[0] as { authToken: string }).authToken === ORGANIZATION_TOKEN
        );
      }),
    ).toBe(true);
    expect(run.askedCount).toBe(23);
    expect(run.notFoundCount).toBe(1);
    expect(run.notFoundNames).toEqual(["Person 24"]);
    expect(run.state).toBe(WorkspaceAskToConnectState.Done);
    // Listed two minutes ago: Slack is not asked for the workspaces again.
    expect(slackCalls).toEqual([]);
  });

  test("workspaces listed long ago are listed again first: one OneUptime was just added to is read", async () => {
    peoplePages = {
      [WEST.id]: [slackPeople(1, 10)],
      [EAST.id]: [slackPeople(11, 20)],
      [LABS.id]: [slackPeople(21, 22)],
    };
    workspacesSlackLists = [EAST, LABS, WEST];
    const run: WorkspaceAskToConnectRun = newRun(22);

    await WorkspaceAskToConnect.ask({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      projectAuth: organizationRow({
        workspacesReadAt: OneUptimeDate.toString(
          OneUptimeDate.addRemoveMinutes(NOW, -60),
        ),
      }),
      people: members(22),
      run: run,
      holder: "holder-1",
    });

    expect(slackCalls).toEqual(["auth.teams.list"]);
    expect(pagesRead()).toEqual([
      [WEST.id, ""],
      [EAST.id, ""],
      [LABS.id, ""],
    ]);
    expect(run.askedCount).toBe(22);
  });

  test("a project connected to one workspace: its people are read without a workspace", async () => {
    peoplePages = { [OWN]: [slackPeople(1, 21)] };
    const run: WorkspaceAskToConnectRun = newRun(21);

    await WorkspaceAskToConnect.ask({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      projectAuth: {
        projectId: PROJECT_ID,
        authToken: "xoxb-acme-solo",
        workspaceProjectId: "T0SOLO",
        miscData: { teamId: "T0SOLO", teamName: "Solo", botUserId: "U0BOT" },
      } as unknown as WorkspaceProjectAuthToken,
      people: members(21),
      run: run,
      holder: "holder-1",
    });

    expect(pagesRead()).toEqual([[undefined, ""]]);
    expect(run.askedCount).toBe(21);
  });
});

describe("SlackChannelMembers.getPeoplePage", () => {
  let sent: Array<JSONObject>;

  beforeEach(() => {
    sent = [];
    pageSpy.mockRestore();

    jest.spyOn(API, "post").mockImplementation((async (request: {
      data: JSONObject;
    }) => {
      sent.push({ ...request.data });
      return new HTTPResponse<JSONObject>(
        200,
        {
          ok: true,
          members: [
            {
              id: "U0P1",
              name: "person-1",
              profile: { email: "person-1@acme.test" },
            },
          ],
          response_metadata: { next_cursor: "dXNlcjpVMFAy" },
        },
        {},
      );
    }) as never);
  });

  test("an organization's workspace is named with team_id", async () => {
    const page: { people: Array<SlackPersonFacts>; nextCursor: string } =
      await SlackChannelMembers.getPeoplePage({
        authToken: ORGANIZATION_TOKEN,
        cursor: "",
        teamId: EAST.id,
      });

    expect(sent).toEqual([{ limit: 200, team_id: EAST.id }]);
    expect(page.nextCursor).toBe("dXNlcjpVMFAy");
    expect(
      page.people.map((person: SlackPersonFacts) => {
        return person.email;
      }),
    ).toEqual(["person-1@acme.test"]);
  });

  test("with its cursor", async () => {
    await SlackChannelMembers.getPeoplePage({
      authToken: ORGANIZATION_TOKEN,
      cursor: "dXNlcjpVMFAy",
      teamId: EAST.id,
    });

    expect(sent).toEqual([
      { limit: 200, cursor: "dXNlcjpVMFAy", team_id: EAST.id },
    ]);
  });

  test("one workspace's installation sends no team_id", async () => {
    await SlackChannelMembers.getPeoplePage({
      authToken: "xoxb-acme-solo",
      cursor: "",
    });
    await SlackChannelMembers.getPeoplePage({
      authToken: "xoxb-acme-solo",
      cursor: "",
      teamId: "",
    });

    expect(sent).toEqual([{ limit: 200 }, { limit: 200 }]);
  });
});
