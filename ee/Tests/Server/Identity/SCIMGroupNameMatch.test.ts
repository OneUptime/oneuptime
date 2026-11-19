import ProjectSCIMRouter from "../../../Server/Identity/API/SCIM";
import {
  getTeamsOfPushedGroup,
  isTeamOfPushedGroup,
  ScimGroupCandidate,
} from "../../../Server/Identity/Utils/SCIMGroupMatch";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamService from "Common/Server/Services/TeamService";
import UserService from "Common/Server/Services/UserService";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import { isSameName } from "Common/Types/Database/UniqueName";
import { JSONObject } from "Common/Types/JSON";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { fakeProjectSCIMUserService } from "./FakeProjectSCIMUserService";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * A PUSHED GROUP TAKES THE TEAM WHOSE NAME READS AS ITS OWN (#9743).
 *
 * A team's name is one team's in its project, compared as it reads (#9674):
 * "engineering", "Engineering " and "Engineering" are one name. SCIM looked
 * a pushed group's team up by the name exactly as written, so an identity
 * provider that pushed "Engineering" into a project that had "engineering"
 * made a twin that every picker drew alike. Now (Utils/SCIMGroupMatch):
 *
 *   - a push takes the team whose name reads as the group's, and renames
 *     it to the group's spelling, so the provider's next push finds it by
 *     its exact name;
 *   - spelled exactly as the group, a team is the group: a push again (after
 *     a timeout, or a provider that lost the ids it kept) finds it;
 *   - spelled another way, a team a provider already holds as a group is
 *     another of its groups: Microsoft Entra ID lets two groups be called
 *     "Engineering" and "ENGINEERING", and each gets a team - two groups of
 *     a provider are never made one team;
 *   - OneUptime's own teams (Owners, Admin, Members, Unassigned) are taken
 *     by their exact name only, as before, and never renamed;
 *   - every other flow finds a group by its id: a rename, even onto a name
 *     that reads like another team's, renames that team and takes no other;
 *   - the displayName filter Okta and Entra look a group up with before they
 *     push it answers by the same rule, the team a push takes first, so the
 *     id a provider keeps is the same either way;
 *   - a read or a change by id notes that the provider holds the team, and
 *     a failure to note it never fails the provider's request.
 *
 * The payloads are what Okta and Microsoft Entra ID send. The real router is
 * driven over HTTP; teams live in memory, and a name is matched as Postgres
 * matches it (QueryHelper.findWithSameName, read as isSameName reads it).
 * The license gate runs as a self-hosted Enterprise install whose license
 * covers SCIM, as SCIMResponseStatusCodes does.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("../../../Server/Identity/Middleware/SCIMAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedSCIMRequest: (
        _req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction,
      ): void => {
        next();
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
      createByEmail: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
      create: jest.fn(),
      deleteBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      create: jest.fn(),
      updateOneById: jest.fn(),
      deleteBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectSCIMUserService", () => {
  const fake: typeof import("./FakeProjectSCIMUserService") =
    jest.requireActual(
      "./FakeProjectSCIMUserService",
    ) as typeof import("./FakeProjectSCIMUserService");

  return { __esModule: true, default: fake.fakeProjectSCIMUserService };
});

jest.mock("../../../Server/Identity/Utils/SCIMLogger", () => {
  return {
    createStatusPageSCIMLog: jest.fn().mockResolvedValue(undefined),
    createProjectSCIMLog: jest.fn().mockResolvedValue(undefined),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SCIM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const GROUP_SCHEMA: string = "urn:ietf:params:scim:schemas:core:2.0:Group";
const PATCH_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const BULK_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:BulkRequest";
// Microsoft Entra ID's own group extension, sent with every group it creates.
const ENTRA_GROUP_SCHEMA: string =
  "http://schemas.microsoft.com/2006/11/ResourceManagement/ADSCIM/2.0/Group";
// A no-break space, as a document pastes one.
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

// A team of the world: what TeamService keeps of one.
interface FakeTeam {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  isTeamEditable: boolean;
  isTeamDeleteable: boolean;
  scimGroupLinkedAt?: Date | undefined;
}

interface World {
  teams: Array<FakeTeam>;
  // Every team update, as it was asked: renames and marks alike.
  updates: Array<{ id: string; data: JSONObject; ignoreHooks: boolean }>;
  // Makes a mark (an update of scimGroupLinkedAt alone) fail.
  failMarks: boolean;
}

const world: World = { teams: [], updates: [], failMarks: false };

let clock: number = Date.parse("2026-01-01T00:00:00Z");

function addTeam(
  name: string,
  options?: {
    projectId?: ObjectID;
    isTeamEditable?: boolean;
    isHeldByProvider?: boolean;
  },
): string {
  clock += 60_000;
  const id: string = ObjectID.generate().toString();

  world.teams.push({
    id: id,
    projectId: (options?.projectId || PROJECT_ID).toString(),
    name: name,
    createdAt: new Date(clock),
    isTeamEditable: options?.isTeamEditable !== false,
    isTeamDeleteable: options?.isTeamEditable !== false,
    scimGroupLinkedAt: options?.isHeldByProvider ? new Date(clock) : undefined,
  });

  return id;
}

function teamOf(id: string): FakeTeam {
  const team: FakeTeam | undefined = world.teams.find((item: FakeTeam) => {
    return item.id === id.toLowerCase();
  });

  if (!team) {
    throw new Error(`No team ${id}`);
  }

  return team;
}

function toModel(fake: FakeTeam): Team {
  const team: Team = new Team(new ObjectID(fake.id));
  team.projectId = new ObjectID(fake.projectId);
  team.name = fake.name;
  team.createdAt = fake.createdAt;
  team.updatedAt = fake.createdAt;
  team.isTeamEditable = fake.isTeamEditable;
  team.isTeamDeleteable = fake.isTeamDeleteable;

  if (fake.scimGroupLinkedAt) {
    team.scimGroupLinkedAt = fake.scimGroupLinkedAt;
  }

  return team;
}

// A value of a query, as Postgres would read it for this team's column.
function matchesValue(
  column: string,
  actual: unknown,
  expected: unknown,
): boolean {
  const operator: { objectLiteralParameters?: Record<string, unknown> } =
    expected as { objectLiteralParameters?: Record<string, unknown> };

  if (
    operator &&
    typeof operator === "object" &&
    operator.objectLiteralParameters
  ) {
    const parameter: unknown = Object.values(
      operator.objectLiteralParameters,
    )[0];

    // findWithSameName's name, read as getNameKey reads both sides.
    if (column === "name") {
      return isSameName(actual, parameter);
    }

    // QueryHelper.any's list of ids.
    const values: Array<unknown> = Array.isArray(parameter)
      ? parameter
      : [parameter];

    return values
      .map((value: unknown): string => {
        return String(value).toLowerCase();
      })
      .includes(String(actual).toLowerCase());
  }

  return String(actual).toLowerCase() === String(expected).toLowerCase();
}

function findTeams(query: Record<string, unknown>): Array<FakeTeam> {
  return world.teams.filter((team: FakeTeam): boolean => {
    return Object.entries(query).every(
      ([key, expected]: [string, unknown]): boolean => {
        const column: string = key === "_id" ? "id" : key;
        return matchesValue(
          column,
          (team as unknown as Record<string, unknown>)[column],
          expected,
        );
      },
    );
  });
}

const teamService: Record<string, jest.Mock> = TeamService as unknown as Record<
  string,
  jest.Mock
>;
const teamMemberService: Record<string, jest.Mock> =
  TeamMemberService as unknown as Record<string, jest.Mock>;
const userService: Record<string, jest.Mock> = UserService as unknown as Record<
  string,
  jest.Mock
>;

let projectConfig: ProjectSCIM;
let httpServer: Server;
let baseUrl: string;

interface HttpResult {
  status: number;
  body: JSONObject;
}

function scimPath(resource: string): string {
  return `/scim/v2/${SCIM_ID}/${resource}`;
}

async function send(
  method: string,
  path: string,
  body?: JSONObject,
): Promise<HttpResult> {
  const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/scim+json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text: string = await response.text();

  return {
    status: response.status,
    body: text ? (JSON.parse(text) as JSONObject) : {},
  };
}

// The ids of the groups a list answered, in its order.
function idsOf(result: HttpResult): Array<string> {
  return ((result.body["Resources"] as Array<JSONObject>) || []).map(
    (resource: JSONObject): string => {
      return String(resource["id"]);
    },
  );
}

function namesOfProject(): Array<string> {
  return world.teams
    .filter((team: FakeTeam): boolean => {
      return team.projectId === PROJECT_ID.toString();
    })
    .map((team: FakeTeam): string => {
      return team.name;
    });
}

beforeAll(async () => {
  setTestBillingEnabled(false);
  installFakeEnterpriseModule({
    snapshot: createLicenseSnapshotWithStatus("valid"),
  });

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson({ type: ["application/json", "application/scim+json"] }));
  app.use(
    (req: ExpressRequest, _res: ExpressResponse, next: NextFunction): void => {
      (req as OneUptimeRequest).bearerTokenData = {
        projectId: PROJECT_ID,
        scimConfig: projectConfig,
      };
      next();
    },
  );
  app.use(ProjectSCIMRouter);
  app.use(
    (
      error: Error,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      res
        .status(error instanceof NotFoundException ? 404 : 500)
        .json({ error: error.message });
    },
  );
  httpServer = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  uninstallEnterpriseModule();

  if (httpServer) {
    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        httpServer.close((error?: Error): void => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      },
    );
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  fakeProjectSCIMUserService.reset();
  world.teams = [];
  world.updates = [];
  world.failMarks = false;

  projectConfig = new ProjectSCIM(SCIM_ID);
  projectConfig.autoProvisionUsers = true;
  projectConfig.autoDeprovisionUsers = true;
  projectConfig.enablePushGroups = true;
  projectConfig.teams = [];

  teamService["findBy"]!.mockImplementation(
    async (args: { query: Record<string, unknown> }): Promise<Array<Team>> => {
      return findTeams(args.query)
        .sort((left: FakeTeam, right: FakeTeam): number => {
          return left.createdAt.getTime() - right.createdAt.getTime();
        })
        .map(toModel);
    },
  );
  teamService["findOneBy"]!.mockImplementation(
    async (args: { query: Record<string, unknown> }): Promise<Team | null> => {
      const found: FakeTeam | undefined = findTeams(args.query)[0];
      return found ? toModel(found) : null;
    },
  );
  teamService["findOneById"]!.mockImplementation(
    async (args: { id: unknown }): Promise<Team | null> => {
      const found: FakeTeam | undefined = world.teams.find(
        (team: FakeTeam): boolean => {
          return team.id === String(args.id).toLowerCase();
        },
      );
      return found ? toModel(found) : null;
    },
  );
  teamService["create"]!.mockImplementation(
    async (args: { data: Team }): Promise<Team> => {
      clock += 60_000;
      const created: FakeTeam = {
        id: ObjectID.generate().toString(),
        projectId: args.data.projectId!.toString(),
        name: args.data.name!,
        createdAt: new Date(clock),
        isTeamEditable: args.data.isTeamEditable !== false,
        isTeamDeleteable: args.data.isTeamDeleteable !== false,
        scimGroupLinkedAt: args.data.scimGroupLinkedAt,
      };
      world.teams.push(created);
      return toModel(created);
    },
  );
  teamService["updateOneById"]!.mockImplementation(
    async (args: {
      id: unknown;
      data: JSONObject;
      props: { ignoreHooks?: boolean };
    }): Promise<void> => {
      world.updates.push({
        id: String(args.id).toLowerCase(),
        data: args.data,
        ignoreHooks: Boolean(args.props.ignoreHooks),
      });

      if (world.failMarks && args.data["scimGroupLinkedAt"]) {
        throw new Error("The database is busy.");
      }

      const team: FakeTeam = teamOf(String(args.id));

      if (typeof args.data["name"] === "string") {
        team.name = args.data["name"];
      }

      if (args.data["scimGroupLinkedAt"]) {
        team.scimGroupLinkedAt = args.data["scimGroupLinkedAt"] as Date;
      }
    },
  );
  teamService["deleteBy"]!.mockResolvedValue(undefined);

  teamMemberService["findOneBy"]!.mockResolvedValue(null);
  teamMemberService["findBy"]!.mockResolvedValue([]);
  teamMemberService["create"]!.mockResolvedValue(undefined);
  teamMemberService["deleteBy"]!.mockResolvedValue(undefined);

  userService["findOneBy"]!.mockResolvedValue(null);
  userService["findOneById"]!.mockResolvedValue(null);
  userService["createByEmail"]!.mockResolvedValue(null);
});

describe("which team a pushed group is: the rule", () => {
  function candidate(
    name: string,
    options?: { held?: boolean; builtIn?: boolean; createdAt?: string },
  ): ScimGroupCandidate {
    return {
      name: name,
      createdAt: new Date(options?.createdAt || "2026-01-01T00:00:00Z"),
      isTeamEditable: !options?.builtIn,
      scimGroupLinkedAt: options?.held
        ? new Date("2026-01-02T00:00:00Z")
        : undefined,
    };
  }

  test.each([
    ["the same spelling", true, "Engineering", {}],
    ["another case", true, "engineering", {}],
    ["spaces around it", true, " Engineering  ", {}],
    ["another name altogether", false, `Platform${NO_BREAK_SPACE}Team`, {}],
    ["a name that only starts the same", false, "Engineering Ops", {}],
    [
      "the same spelling, held by a provider",
      true,
      "Engineering",
      { held: true },
    ],
    ["another case, held by a provider", false, "ENGINEERING", { held: true }],
    ["a built-in team's exact name", true, "Engineering", { builtIn: true }],
    [
      "a built-in team's name in another case",
      false,
      "engineering",
      { builtIn: true },
    ],
  ])(
    "a team with %s is the group Engineering: %s",
    (
      _label: string,
      expected: boolean,
      teamName: string,
      options: { held?: boolean; builtIn?: boolean },
    ) => {
      expect(
        isTeamOfPushedGroup({
          team: candidate(teamName, options),
          displayName: "Engineering",
        }),
      ).toBe(expected);
    },
  );

  test("a non-breaking space reads as a space", () => {
    expect(
      isTeamOfPushedGroup({
        team: candidate(`Platform${NO_BREAK_SPACE}Team`),
        displayName: "Platform Team",
      }),
    ).toBe(true);
  });

  test("no name is no group", () => {
    expect(isTeamOfPushedGroup({ team: candidate(""), displayName: "" })).toBe(
      false,
    );
    expect(
      isTeamOfPushedGroup({
        team: { isTeamEditable: true },
        displayName: "Engineering",
      }),
    ).toBe(false);
  });

  test("of several, the exact spelling first, then the oldest; the others are left", () => {
    const oldest: ScimGroupCandidate = candidate("engineering", {
      createdAt: "2026-01-01T00:00:00Z",
    });
    const exact: ScimGroupCandidate = candidate("Engineering", {
      createdAt: "2026-03-01T00:00:00Z",
    });
    const newer: ScimGroupCandidate = candidate("ENGINEERING ", {
      createdAt: "2026-02-01T00:00:00Z",
    });
    const held: ScimGroupCandidate = candidate("EngineerinG", {
      held: true,
      createdAt: "2025-01-01T00:00:00Z",
    });

    expect(
      getTeamsOfPushedGroup({
        teams: [newer, held, exact, oldest],
        displayName: "Engineering",
      }),
    ).toEqual([exact, oldest, newer]);
    expect(
      getTeamsOfPushedGroup({
        teams: [newer, held, oldest],
        displayName: "Engineering",
      }),
    ).toEqual([oldest, newer]);
  });
});

describe("Okta's Push Groups", () => {
  test("pushing Engineering takes the project's engineering team, renamed to Okta's spelling: no twin", async () => {
    const engineering: string = addTeam("engineering");
    addTeam("Engineering", { projectId: OTHER_PROJECT_ID });

    // Okta's create: the group, with its members pushed after.
    const result: HttpResult = await send("POST", scimPath("Groups"), {
      schemas: [GROUP_SCHEMA],
      displayName: "Engineering",
      members: [],
    });

    expect(result.status).toBe(200);
    expect(result.body["id"]).toBe(engineering);
    expect(result.body["displayName"]).toBe("Engineering");
    expect(teamService["create"]).not.toHaveBeenCalled();
    expect(namesOfProject()).toEqual(["Engineering"]);
    expect(teamOf(engineering).scimGroupLinkedAt).toBeInstanceOf(Date);
    // Renamed as a provider's rename is; noted without the team's hooks.
    expect(world.updates).toEqual([
      { id: engineering, data: { name: "Engineering" }, ignoreHooks: false },
      {
        id: engineering,
        data: { scimGroupLinkedAt: expect.any(Date) },
        ignoreHooks: true,
      },
    ]);
  });

  test("pushed again after Okta lost the id it kept, it finds the same team by its exact name", async () => {
    const engineering: string = addTeam("engineering");

    const first: HttpResult = await send("POST", scimPath("Groups"), {
      schemas: [GROUP_SCHEMA],
      displayName: "Engineering",
      members: [],
    });
    const again: HttpResult = await send("POST", scimPath("Groups"), {
      schemas: [GROUP_SCHEMA],
      displayName: "Engineering",
      members: [],
    });

    expect(first.body["id"]).toBe(engineering);
    expect(again.status).toBe(200);
    expect(again.body["id"]).toBe(engineering);
    expect(namesOfProject()).toEqual(["Engineering"]);
  });

  test("a new group with no team named alike makes one, held by the provider from the start", async () => {
    addTeam("Platform");

    const result: HttpResult = await send("POST", scimPath("Groups"), {
      schemas: [GROUP_SCHEMA],
      displayName: "Engineering",
      members: [],
    });

    expect(result.status).toBe(201);
    expect(namesOfProject()).toEqual(["Platform", "Engineering"]);
    expect(teamOf(String(result.body["id"])).scimGroupLinkedAt).toBeInstanceOf(
      Date,
    );
  });

  test("renaming the group (Okta's PUT) renames its team by id, even onto a name another team reads as: never that other team", async () => {
    const engineering: string = addTeam("Engineering", {
      isHeldByProvider: true,
    });
    const platform: string = addTeam("platform engineering");

    const result: HttpResult = await send(
      "PUT",
      scimPath(`Groups/${engineering}`),
      {
        schemas: [GROUP_SCHEMA],
        id: engineering,
        displayName: "Platform Engineering",
        members: [],
      },
    );

    expect(result.status).toBe(200);
    expect(result.body["id"]).toBe(engineering);
    expect(teamOf(engineering).name).toBe("Platform Engineering");
    // The other team is as it was: nothing merged, nothing renamed.
    expect(teamOf(platform).name).toBe("platform engineering");
    expect(teamOf(platform).scimGroupLinkedAt).toBeUndefined();
    expect(namesOfProject()).toEqual([
      "Platform Engineering",
      "platform engineering",
    ]);
  });

  test("OneUptime's own teams are taken by their exact name only, and never renamed", async () => {
    const owners: string = addTeam("Owners", { isTeamEditable: false });

    const lower: HttpResult = await send("POST", scimPath("Groups"), {
      schemas: [GROUP_SCHEMA],
      displayName: "owners",
      members: [],
    });

    expect(lower.status).toBe(201);
    expect(lower.body["id"]).not.toBe(owners);
    expect(teamOf(owners).name).toBe("Owners");

    const exact: HttpResult = await send("POST", scimPath("Groups"), {
      schemas: [GROUP_SCHEMA],
      displayName: "Owners",
      members: [],
    });

    expect(exact.status).toBe(200);
    expect(exact.body["id"]).toBe(owners);
    // Noted as the provider's without the hooks that refuse to change Owners.
    expect(
      world.updates.filter((update: { id: string }): boolean => {
        return update.id === owners;
      }),
    ).toEqual([
      {
        id: owners,
        data: { scimGroupLinkedAt: expect.any(Date) },
        ignoreHooks: true,
      },
    ]);
  });
});

describe("Microsoft Entra ID's provisioning", () => {
  test("its lookup before a push finds the team a push would take, and a PATCH renames it by id", async () => {
    const engineering: string = addTeam("Engineering ");

    // Entra looks the group up by its displayName first, without members.
    const lookup: HttpResult = await send(
      "GET",
      `${scimPath("Groups")}?filter=${encodeURIComponent(
        'displayName eq "Engineering"',
      )}&excludedAttributes=members`,
    );

    expect(lookup.status).toBe(200);
    expect(idsOf(lookup)).toEqual([engineering]);

    // Then reads it by the id it keeps, and replaces what differs.
    const read: HttpResult = await send(
      "GET",
      scimPath(`Groups/${engineering}`),
    );

    expect(read.status).toBe(200);
    expect(teamOf(engineering).scimGroupLinkedAt).toBeInstanceOf(Date);

    const patch: HttpResult = await send(
      "PATCH",
      scimPath(`Groups/${engineering}`),
      {
        schemas: [PATCH_SCHEMA],
        Operations: [
          { op: "Replace", path: "displayName", value: "Engineering" },
        ],
      },
    );

    expect([200, 204]).toContain(patch.status);
    expect(teamOf(engineering).name).toBe("Engineering");
    expect(namesOfProject()).toEqual(["Engineering"]);
  });

  test("its create, with its extension schema and externalId, takes the team whose name reads alike", async () => {
    const engineering: string = addTeam("ENGINEERING");

    const result: HttpResult = await send("POST", scimPath("Groups"), {
      schemas: [GROUP_SCHEMA, ENTRA_GROUP_SCHEMA],
      externalId: "8aa1a0c0-c4c3-4bc0-b4a5-2ef676900159",
      displayName: "Engineering",
      meta: { resourceType: "Group" },
    });

    expect(result.status).toBe(200);
    expect(result.body["id"]).toBe(engineering);
    expect(namesOfProject()).toEqual(["Engineering"]);
  });

  test("two groups named Engineering and ENGINEERING get a team each: the second never takes the first's", async () => {
    // The first group's team, which Entra has read by its id since.
    const first: string = addTeam("Engineering");
    await send("GET", scimPath(`Groups/${first}`));
    expect(teamOf(first).scimGroupLinkedAt).toBeInstanceOf(Date);

    // The second group's lookup finds no team of its own...
    const lookup: HttpResult = await send(
      "GET",
      `${scimPath("Groups")}?filter=${encodeURIComponent(
        'displayName eq "ENGINEERING"',
      )}&excludedAttributes=members`,
    );

    expect(lookup.status).toBe(200);
    expect(idsOf(lookup)).toEqual([]);

    // ...so Entra creates it, and it gets a team of its own.
    const created: HttpResult = await send("POST", scimPath("Groups"), {
      schemas: [GROUP_SCHEMA, ENTRA_GROUP_SCHEMA],
      externalId: "4f2bcfd5-5c4b-4d5a-9a7e-c7d0d9b2d001",
      displayName: "ENGINEERING",
      meta: { resourceType: "Group" },
    });

    expect(created.status).toBe(201);
    expect(created.body["id"]).not.toBe(first);
    expect(teamOf(first).name).toBe("Engineering");
    expect(namesOfProject()).toEqual(["Engineering", "ENGINEERING"]);

    // The first group's own lookup still finds the first team.
    const firstLookup: HttpResult = await send(
      "GET",
      `${scimPath("Groups")}?filter=${encodeURIComponent(
        'displayName eq "Engineering"',
      )}`,
    );

    expect(idsOf(firstLookup)).toEqual([first]);
  });

  test("a group renamed by PATCH onto a name another team reads as stays its own team", async () => {
    const operations: string = addTeam("Operations", {
      isHeldByProvider: true,
    });
    const engineering: string = addTeam("Engineering", {
      isHeldByProvider: true,
    });

    const result: HttpResult = await send(
      "PATCH",
      scimPath(`Groups/${operations}`),
      {
        schemas: [PATCH_SCHEMA],
        Operations: [
          { op: "Replace", path: "displayName", value: "engineering" },
        ],
      },
    );

    expect([200, 204]).toContain(result.status);
    expect(teamOf(operations).name).toBe("engineering");
    expect(teamOf(engineering).name).toBe("Engineering");
    expect(world.teams).toHaveLength(2);
  });
});

describe("teams that already share a name", () => {
  test("a push takes the one spelled exactly as the group, else the oldest, and leaves the others as they are", async () => {
    const older: string = addTeam("engineering");
    const exact: string = addTeam("Engineering");
    const newer: string = addTeam(" ENGINEERING");

    const exactPush: HttpResult = await send("POST", scimPath("Groups"), {
      schemas: [GROUP_SCHEMA],
      displayName: "Engineering",
      members: [],
    });

    expect(exactPush.body["id"]).toBe(exact);

    const otherPush: HttpResult = await send("POST", scimPath("Groups"), {
      schemas: [GROUP_SCHEMA],
      displayName: "EngineerinG",
      members: [],
    });

    expect(otherPush.body["id"]).toBe(older);
    expect(teamOf(older).name).toBe("EngineerinG");
    expect(teamOf(newer).name).toBe(" ENGINEERING");
    expect(world.teams).toHaveLength(3);
  });

  test("the displayName lookup answers them in the order a push takes them", async () => {
    const older: string = addTeam("engineering");
    const exact: string = addTeam("Engineering");
    addTeam("Engineering", { projectId: OTHER_PROJECT_ID });

    const lookup: HttpResult = await send(
      "GET",
      `${scimPath("Groups")}?filter=${encodeURIComponent(
        'displayName eq "Engineering"',
      )}`,
    );

    expect(idsOf(lookup)).toEqual([exact, older]);
  });
});

describe("a Bulk request's group create", () => {
  test("takes the team whose name reads alike, as POST /Groups does", async () => {
    const engineering: string = addTeam("engineering");

    const result: HttpResult = await send("POST", scimPath("Bulk"), {
      schemas: [BULK_SCHEMA],
      Operations: [
        {
          method: "POST",
          path: "/Groups",
          bulkId: "engineering",
          data: { schemas: [GROUP_SCHEMA], displayName: "Engineering" },
        },
      ],
    });

    expect(result.status).toBe(200);

    const operation: JSONObject = (
      result.body["Operations"] as Array<JSONObject>
    )[0]!;

    expect(operation["status"]).toBe("200");
    expect(String(operation["location"])).toContain(engineering);
    expect(namesOfProject()).toEqual(["Engineering"]);
    expect(teamService["create"]).not.toHaveBeenCalled();
  });
});

describe("noting that the provider holds a team", () => {
  test("never fails the provider's request", async () => {
    const engineering: string = addTeam("Engineering");
    world.failMarks = true;

    const read: HttpResult = await send(
      "GET",
      scimPath(`Groups/${engineering}`),
    );

    expect(read.status).toBe(200);
    expect(read.body["id"]).toBe(engineering);
    expect(teamOf(engineering).scimGroupLinkedAt).toBeUndefined();
  });

  test("is written once: a team held already is not written again", async () => {
    const engineering: string = addTeam("Engineering", {
      isHeldByProvider: true,
    });

    await send("GET", scimPath(`Groups/${engineering}`));
    await send("GET", scimPath(`Groups/${engineering}`));

    expect(world.updates).toEqual([]);
  });

  test("a list of the groups notes nothing: it is not asked by id", async () => {
    addTeam("Engineering");

    const list: HttpResult = await send("GET", scimPath("Groups"));

    expect(list.status).toBe(200);
    expect(world.updates).toEqual([]);
  });
});
