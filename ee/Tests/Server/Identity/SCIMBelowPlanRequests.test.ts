import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import ProjectSCIMRouter from "../../../Server/Identity/API/SCIM";
import StatusPageSCIMRouter from "../../../Server/Identity/API/StatusPageSCIM";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { getScimStoppedMessage } from "Common/Types/Billing/PlanCutoffCredentials";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * ---------------------------------------------------------------------------
 * BELOW THE PLAN, SCIM STILL TAKES ACCESS AWAY - AND ONLY THAT.
 *
 * A project below Scale - a trial ended, a downgrade - keeps its SCIM
 * connections, and they keep removing people (Utils/SCIMBelowPlan): a person
 * deactivated or removed in the identity provider loses their access to
 * OneUptime too, whatever the plan. Everything that gives or changes access
 * is refused with 402 in the SCIM error format, whole: nothing of a refused
 * request is applied.
 *
 * The real routers and the real SCIM middleware - bearer token, plan, the
 * door's reading of each route - over HTTP, against an in-memory world of
 * accounts, teams, memberships and status page users. Each test sends what
 * an identity provider sends - Okta's shapes and Entra ID's - and asserts on
 * the state that results.
 * ---------------------------------------------------------------------------
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

jest.mock("../../../Server/Identity/Utils/SCIMLogger", () => {
  return {
    createStatusPageSCIMLog: jest.fn().mockResolvedValue(undefined),
    createProjectSCIMLog: jest.fn().mockResolvedValue(undefined),
  };
});

/*
 * ---------------------------------------------------------------------------
 * The world the fakes below read and write.
 * ---------------------------------------------------------------------------
 */

interface FakeUser {
  id: string;
  email: string;
  name: string;
}

interface FakeMembership {
  id: string;
  projectId: string;
  userId: string;
  teamId: string;
  hasAcceptedInvitation: boolean;
}

interface FakeTeam {
  id: string;
  projectId: string;
  name: string;
  isTeamDeleteable: boolean;
}

interface FakePrivateUser {
  id: string;
  statusPageId: string;
  projectId: string;
  email: string;
}

interface FakeWorld {
  users: Array<FakeUser>;
  memberships: Array<FakeMembership>;
  deletedMemberships: Array<FakeMembership>;
  teams: Array<FakeTeam>;
  privateUsers: Array<FakePrivateUser>;
  // Every write a request made, by kind: what a refused request must not have.
  writes: Array<string>;
  // The plan the project is on, as ProjectService.getCurrentPlan answers it.
  plan: PlanType | null;
}

const world: FakeWorld = {
  users: [],
  memberships: [],
  deletedMemberships: [],
  teams: [],
  privateUsers: [],
  writes: [],
  plan: PlanType.Free,
};

const idOf: (value: unknown) => string = (value: unknown): string => {
  return String(value).toLowerCase();
};

// An id, a boolean, an Email, or QueryHelper.any(...) - a Raw operator listing ids.
const matchesValue: (actual: unknown, expected: unknown) => boolean = (
  actual: unknown,
  expected: unknown,
): boolean => {
  const operator: { objectLiteralParameters?: Record<string, unknown> } =
    expected as { objectLiteralParameters?: Record<string, unknown> };

  if (
    operator &&
    typeof operator === "object" &&
    operator.objectLiteralParameters
  ) {
    const values: Array<unknown> = (Object.values(
      operator.objectLiteralParameters,
    )[0] || []) as Array<unknown>;

    return values.map(idOf).includes(idOf(actual));
  }

  if (typeof expected === "boolean") {
    return Boolean(actual) === expected;
  }

  return idOf(actual) === idOf(expected);
};

const matchesQuery: (row: object, query: Record<string, unknown>) => boolean = (
  row: object,
  query: Record<string, unknown>,
): boolean => {
  const columns: Record<string, unknown> = row as Record<string, unknown>;

  return Object.entries(query).every(([key, expected]: [string, unknown]) => {
    const column: string = key === "_id" ? "id" : key;
    return matchesValue(columns[column], expected);
  });
};

const toUser: (fake: FakeUser) => User = (fake: FakeUser): User => {
  const user: User = new User(new ObjectID(fake.id));
  user.email = new Email(fake.email);
  user.name = new Name(fake.name);
  user.isMasterAdmin = false;
  return user;
};

const toMember: (row: FakeMembership) => TeamMember = (
  row: FakeMembership,
): TeamMember => {
  const member: TeamMember = new TeamMember(new ObjectID(row.id));
  member.projectId = new ObjectID(row.projectId);
  member.userId = new ObjectID(row.userId);
  member.teamId = new ObjectID(row.teamId);
  member.hasAcceptedInvitation = row.hasAcceptedInvitation;

  const user: FakeUser | undefined = world.users.find((item: FakeUser) => {
    return item.id === row.userId;
  });

  if (user) {
    member.user = toUser(user);
  }

  return member;
};

const toTeam: (fake: FakeTeam) => Team = (fake: FakeTeam): Team => {
  const team: Team = new Team(new ObjectID(fake.id));
  team.projectId = new ObjectID(fake.projectId);
  team.name = fake.name;
  team.isTeamDeleteable = fake.isTeamDeleteable;
  return team;
};

const toPrivateUser: (fake: FakePrivateUser) => StatusPagePrivateUser = (
  fake: FakePrivateUser,
): StatusPagePrivateUser => {
  const user: StatusPagePrivateUser = new StatusPagePrivateUser(
    new ObjectID(fake.id),
  );
  user.statusPageId = new ObjectID(fake.statusPageId);
  user.projectId = new ObjectID(fake.projectId);
  user.email = new Email(fake.email);
  return user;
};

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: async (): Promise<{
        plan: PlanType | null;
        isSubscriptionUnpaid: boolean;
      }> => {
        return { plan: world.plan, isSubscriptionUnpaid: false };
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectSCIMService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<ProjectSCIM | null> => {
        return idOf(args.query["_id"]) === PROJECT_SCIM_ID &&
          args.query["bearerToken"] === TOKEN
          ? projectConfig
          : null;
      },
    },
  };
});

jest.mock("Common/Server/Services/StatusPageSCIMService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<StatusPageSCIM | null> => {
        return idOf(args.query["_id"]) === STATUS_PAGE_SCIM_ID &&
          args.query["bearerToken"] === TOKEN
          ? statusPageConfig
          : null;
      },
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<User | null> => {
        const user: FakeUser | undefined = world.users.find(
          (item: FakeUser) => {
            return matchesQuery(item, args.query);
          },
        );
        return user ? toUser(user) : null;
      },
      findOneById: async (args: { id: unknown }): Promise<User | null> => {
        const user: FakeUser | undefined = world.users.find(
          (item: FakeUser) => {
            return item.id === idOf(args.id);
          },
        );
        return user ? toUser(user) : null;
      },
      createByEmail: async (args: {
        email: Email;
        name: Name;
      }): Promise<User> => {
        world.writes.push("user created");
        const user: FakeUser = {
          id: idOf(ObjectID.generate()),
          email: args.email.toString(),
          name: args.name.toString(),
        };
        world.users.push(user);
        return toUser(user);
      },
      updateOneById: async (args: {
        id: unknown;
        data: { email?: Email; name?: Name };
      }): Promise<void> => {
        world.writes.push("user updated");
        const user: FakeUser | undefined = world.users.find(
          (item: FakeUser) => {
            return item.id === idOf(args.id);
          },
        );

        if (user && args.data.email) {
          user.email = args.data.email.toString();
        }

        if (user && args.data.name) {
          user.name = args.data.name.toString();
        }
      },
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<TeamMember | null> => {
        const row: FakeMembership | undefined = world.memberships.find(
          (item: FakeMembership) => {
            return matchesQuery(item, args.query);
          },
        );
        return row ? toMember(row) : null;
      },
      findBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<TeamMember>> => {
        return world.memberships
          .filter((item: FakeMembership) => {
            return matchesQuery(item, args.query);
          })
          .map(toMember);
      },
      create: async (args: { data: TeamMember }): Promise<TeamMember> => {
        world.writes.push("membership created");
        const row: FakeMembership = {
          id: idOf(ObjectID.generate()),
          projectId: idOf(args.data.projectId),
          userId: idOf(args.data.userId),
          teamId: idOf(args.data.teamId),
          hasAcceptedInvitation: Boolean(args.data.hasAcceptedInvitation),
        };

        if (
          world.memberships.some((item: FakeMembership) => {
            return item.userId === row.userId && item.teamId === row.teamId;
          })
        ) {
          throw new BadRequestException("Already invited");
        }

        world.memberships.push(row);
        return toMember(row);
      },
      deleteBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<void> => {
        const matched: Array<FakeMembership> = world.memberships.filter(
          (item: FakeMembership) => {
            return matchesQuery(item, args.query);
          },
        );

        if (matched.length > 0) {
          world.writes.push("membership deleted");
        }

        world.deletedMemberships.push(...matched);
        world.memberships = world.memberships.filter((item: FakeMembership) => {
          return !matchesQuery(item, args.query);
        });
      },
    },
  };
});

jest.mock("Common/Server/Services/TeamService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<Team | null> => {
        const team: FakeTeam | undefined = world.teams.find(
          (item: FakeTeam) => {
            return matchesQuery(item, args.query);
          },
        );
        return team ? toTeam(team) : null;
      },
      findOneById: async (args: { id: unknown }): Promise<Team | null> => {
        const team: FakeTeam | undefined = world.teams.find(
          (item: FakeTeam) => {
            return item.id === idOf(args.id);
          },
        );
        return team ? toTeam(team) : null;
      },
      findBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<Team>> => {
        return world.teams
          .filter((item: FakeTeam) => {
            return matchesQuery(item, args.query);
          })
          .map(toTeam);
      },
      create: async (args: { data: Team }): Promise<Team> => {
        world.writes.push("team created");
        const team: FakeTeam = {
          id: idOf(ObjectID.generate()),
          projectId: idOf(args.data.projectId),
          name: args.data.name!,
          isTeamDeleteable: Boolean(args.data.isTeamDeleteable),
        };
        world.teams.push(team);
        return toTeam(team);
      },
      updateOneById: async (args: {
        id: unknown;
        data: { name?: string };
      }): Promise<void> => {
        world.writes.push("team renamed");
        const team: FakeTeam | undefined = world.teams.find(
          (item: FakeTeam) => {
            return item.id === idOf(args.id);
          },
        );

        if (team && args.data.name) {
          team.name = args.data.name;
        }
      },
      deleteBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<void> => {
        world.writes.push("team deleted");
        world.teams = world.teams.filter((item: FakeTeam) => {
          return !matchesQuery(item, args.query);
        });
      },
    },
  };
});

jest.mock("Common/Server/Services/UserProjectSsoConsentService", () => {
  return {
    __esModule: true,
    default: {
      hasConsent: async (): Promise<boolean> => {
        return false;
      },
    },
  };
});

jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<StatusPagePrivateUser | null> => {
        const user: FakePrivateUser | undefined = world.privateUsers.find(
          (item: FakePrivateUser) => {
            return matchesQuery(item, args.query);
          },
        );
        return user ? toPrivateUser(user) : null;
      },
      findOneById: async (args: {
        id: unknown;
      }): Promise<StatusPagePrivateUser | null> => {
        const user: FakePrivateUser | undefined = world.privateUsers.find(
          (item: FakePrivateUser) => {
            return item.id === idOf(args.id);
          },
        );
        return user ? toPrivateUser(user) : null;
      },
      findBy: async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<StatusPagePrivateUser>> => {
        return world.privateUsers
          .filter((item: FakePrivateUser) => {
            return matchesQuery(item, args.query);
          })
          .map(toPrivateUser);
      },
      create: async (args: {
        data: StatusPagePrivateUser;
      }): Promise<StatusPagePrivateUser> => {
        world.writes.push("private user created");
        const user: FakePrivateUser = {
          id: idOf(ObjectID.generate()),
          statusPageId: idOf(args.data.statusPageId),
          projectId: idOf(args.data.projectId),
          email: args.data.email!.toString(),
        };
        world.privateUsers.push(user);
        return toPrivateUser(user);
      },
      updateOneById: async (args: {
        id: unknown;
        data: { email?: Email };
      }): Promise<void> => {
        world.writes.push("private user updated");
        const user: FakePrivateUser | undefined = world.privateUsers.find(
          (item: FakePrivateUser) => {
            return item.id === idOf(args.id);
          },
        );

        if (user && args.data.email) {
          user.email = args.data.email.toString();
        }
      },
      deleteOneById: async (args: { id: unknown }): Promise<void> => {
        world.writes.push("private user deleted");
        world.privateUsers = world.privateUsers.filter(
          (item: FakePrivateUser) => {
            return item.id !== idOf(args.id);
          },
        );
      },
    },
  };
});

/*
 * ---------------------------------------------------------------------------
 * The project, its connections, and the people in it.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: string = "aa000000-0000-4000-8000-000000000001";
const PROJECT_SCIM_ID: string = "aa000000-0000-4000-8000-000000000002";
const STATUS_PAGE_SCIM_ID: string = "aa000000-0000-4000-8000-000000000003";
const STATUS_PAGE_ID: string = "aa000000-0000-4000-8000-000000000004";
const TOKEN: string = "the-identity-provider-secret";

// The connection's default teams, and a team its groups manage.
const DEFAULT_TEAM_A: string = "aa000000-0000-4000-8000-0000000000a1";
const DEFAULT_TEAM_B: string = "aa000000-0000-4000-8000-0000000000b1";
const ENGINEERING: string = "aa000000-0000-4000-8000-0000000000e1";

const PATCH_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const BULK_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:BulkRequest";
const ENTERPRISE_USER_SCHEMA: string =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";

let projectConfig: ProjectSCIM;
let statusPageConfig: StatusPageSCIM;
let httpServer: Server;
let baseUrl: string;

interface People {
  // In both default teams: someone who leaves.
  alice: string;
  // In Engineering only.
  bob: string;
  // In Engineering only.
  carol: string;
  // Known to OneUptime, in no team of this project.
  outsider: string;
  // A status page's private user.
  viewer: string;
}

let people: People;

const seedUser: (email: string, name: string) => string = (
  email: string,
  name: string,
): string => {
  const id: string = idOf(ObjectID.generate());
  world.users.push({ id, email, name });
  return id;
};

const seedMembership: (userId: string, teamId: string) => void = (
  userId: string,
  teamId: string,
): void => {
  world.memberships.push({
    id: idOf(ObjectID.generate()),
    projectId: PROJECT_ID,
    userId,
    teamId,
    hasAcceptedInvitation: true,
  });
};

const seedWorld: () => void = (): void => {
  world.users = [];
  world.memberships = [];
  world.deletedMemberships = [];
  world.privateUsers = [];
  world.writes = [];
  world.teams = [
    {
      id: DEFAULT_TEAM_A,
      projectId: PROJECT_ID,
      name: "Default A",
      isTeamDeleteable: false,
    },
    {
      id: DEFAULT_TEAM_B,
      projectId: PROJECT_ID,
      name: "Default B",
      isTeamDeleteable: false,
    },
    {
      id: ENGINEERING,
      projectId: PROJECT_ID,
      name: "Engineering",
      isTeamDeleteable: true,
    },
  ];

  people = {
    alice: seedUser("alice@acme.example", "Alice Leaving"),
    bob: seedUser("bob@acme.example", "Bob Builder"),
    carol: seedUser("carol@acme.example", "Carol Coder"),
    outsider: seedUser("olga@elsewhere.example", "Olga Outside"),
    viewer: idOf(ObjectID.generate()),
  };

  seedMembership(people.alice, DEFAULT_TEAM_A);
  seedMembership(people.alice, DEFAULT_TEAM_B);
  seedMembership(people.bob, ENGINEERING);
  seedMembership(people.carol, ENGINEERING);

  world.privateUsers.push({
    id: people.viewer,
    statusPageId: STATUS_PAGE_ID,
    projectId: PROJECT_ID,
    email: "viewer@customer.example",
  });
};

interface HttpResult {
  status: number;
  body: JSONObject;
}

const send: (
  method: string,
  path: string,
  body?: JSONObject,
) => Promise<HttpResult> = async (
  method: string,
  path: string,
  body?: JSONObject,
): Promise<HttpResult> => {
  const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body ? { "content-type": "application/scim+json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text: string = await response.text();

  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as JSONObject,
  };
};

const patch: (...operations: Array<JSONObject>) => JSONObject = (
  ...operations: Array<JSONObject>
): JSONObject => {
  return { schemas: [PATCH_SCHEMA], Operations: operations };
};

const project: (resource: string) => string = (resource: string): string => {
  return `/scim/v2/${PROJECT_SCIM_ID}/${resource}`;
};

const statusPage: (resource: string) => string = (resource: string): string => {
  return `/status-page-scim/v2/${STATUS_PAGE_SCIM_ID}/${resource}`;
};

const teamsOf: (userId: string) => Array<string> = (
  userId: string,
): Array<string> => {
  return world.memberships
    .filter((row: FakeMembership) => {
      return row.userId === userId;
    })
    .map((row: FakeMembership) => {
      return row.teamId;
    })
    .sort();
};

const membersOf: (teamId: string) => Array<string> = (
  teamId: string,
): Array<string> => {
  return world.memberships
    .filter((row: FakeMembership) => {
      return row.teamId === teamId;
    })
    .map((row: FakeMembership) => {
      return row.userId;
    })
    .sort();
};

const userOf: (userId: string) => FakeUser = (userId: string): FakeUser => {
  return world.users.find((user: FakeUser) => {
    return user.id === userId;
  })!;
};

const expectRefusedBelowPlan: (result: HttpResult) => void = (
  result: HttpResult,
): void => {
  expect(result.status).toBe(402);
  expect(result.body).toEqual({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: "402",
    detail: getScimStoppedMessage(PlanType.Scale),
  });
};

// The plans OneUptime Cloud sells, as config.env names them.
const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const savedPlanEnvironment: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);
});

afterAll(() => {
  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

beforeAll(async () => {
  installFakeEnterpriseModule({
    snapshot: createLicenseSnapshotWithStatus("valid"),
  });

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson({ type: ["application/json", "application/scim+json"] }));
  app.use(ProjectSCIMRouter);
  app.use(StatusPageSCIMRouter);
  app.use(
    (
      error: Error,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      const status: number =
        error instanceof NotFoundException
          ? 404
          : error instanceof BadRequestException
            ? 400
            : 500;
      res.status(status).json({ error: error.message });
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
  setTestBillingEnabled(false);

  await new Promise<void>((resolve: () => void) => {
    httpServer.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  setTestBillingEnabled(true);
  world.plan = PlanType.Free;
  seedWorld();

  projectConfig = new ProjectSCIM(new ObjectID(PROJECT_SCIM_ID));
  projectConfig.projectId = new ObjectID(PROJECT_ID);
  projectConfig.autoProvisionUsers = true;
  projectConfig.autoDeprovisionUsers = true;
  projectConfig.enablePushGroups = false;
  projectConfig.teams = [DEFAULT_TEAM_A, DEFAULT_TEAM_B].map(
    (id: string): Team => {
      const team: Team = new Team(new ObjectID(id));
      team.name = id === DEFAULT_TEAM_A ? "Default A" : "Default B";
      return team;
    },
  );

  statusPageConfig = new StatusPageSCIM(new ObjectID(STATUS_PAGE_SCIM_ID));
  statusPageConfig.projectId = new ObjectID(PROJECT_ID);
  statusPageConfig.statusPageId = new ObjectID(STATUS_PAGE_ID);
  statusPageConfig.autoProvisionUsers = true;
  statusPageConfig.autoDeprovisionUsers = true;
});

describe.each([PlanType.Free, PlanType.Growth])(
  "a project on %s (below Scale), billing on",
  (plan: PlanType) => {
    beforeEach(() => {
      world.plan = plan;
    });

    describe("lookups are answered, so identity providers can find whom to remove", () => {
      test("the project's people, listed and one by one", async () => {
        const list: HttpResult = await send("GET", project("Users"));

        expect(list.status).toBe(200);
        expect(list.body["totalResults"]).toBe(3);

        const one: HttpResult = await send(
          "GET",
          project(`Users/${people.alice}`),
        );

        expect(one.status).toBe(200);
        expect(one.body["userName"]).toBe("alice@acme.example");
      });

      test("Entra ID's userName filter finds a person, as it does before every deactivation", async () => {
        const result: HttpResult = await send(
          "GET",
          project(
            `Users?filter=${encodeURIComponent('userName eq "alice@acme.example"')}`,
          ),
        );

        expect(result.status).toBe(200);
        expect(result.body["totalResults"]).toBe(1);
        expect(
          (result.body["Resources"] as Array<JSONObject>)[0]!["id"],
        ).toBe(people.alice);
      });

      test("a filter for someone OneUptime does not know creates no one, though auto-provisioning is on", async () => {
        const result: HttpResult = await send(
          "GET",
          project(
            `Users?filter=${encodeURIComponent('userName eq "new.hire@acme.example"')}`,
          ),
        );

        expect(result.status).toBe(200);
        expect(result.body["totalResults"]).toBe(0);
        expect(
          world.users.some((user: FakeUser) => {
            return user.email === "new.hire@acme.example";
          }),
        ).toBe(false);
        expect(world.writes).toEqual([]);
      });

      test("groups, listed and one with its members", async () => {
        expect((await send("GET", project("Groups"))).status).toBe(200);

        const group: HttpResult = await send(
          "GET",
          project(`Groups/${ENGINEERING}`),
        );

        expect(group.status).toBe(200);
        expect(
          (group.body["members"] as Array<JSONObject>)
            .map((member: JSONObject) => {
              return member["value"];
            })
            .sort(),
        ).toEqual([people.bob, people.carol].sort());
      });

      test("a status page's private users", async () => {
        expect((await send("GET", statusPage("Users"))).status).toBe(200);
        expect(
          (await send("GET", statusPage(`Users/${people.viewer}`))).status,
        ).toBe(200);
      });

      test("the discovery documents", async () => {
        for (const path of [
          project("ServiceProviderConfig"),
          project("Schemas"),
          project("ResourceTypes"),
          statusPage("ServiceProviderConfig"),
        ]) {
          expect([path, (await send("GET", path)).status]).toEqual([path, 200]);
        }
      });
    });

    describe("removing people goes through", () => {
      test("DELETE of a user removes them from the connection's teams", async () => {
        const result: HttpResult = await send(
          "DELETE",
          project(`Users/${people.alice}`),
        );

        expect(result.status).toBe(204);
        expect(teamsOf(people.alice)).toEqual([]);
        // Through TeamMemberService, so their leave cleanups run.
        expect(
          world.deletedMemberships
            .filter((row: FakeMembership) => {
              return row.userId === people.alice;
            })
            .map((row: FakeMembership) => {
              return row.teamId;
            })
            .sort(),
        ).toEqual([DEFAULT_TEAM_A, DEFAULT_TEAM_B].sort());
      });

      test.each([
        [
          "Okta's replace of the whole resource",
          patch({ op: "replace", value: { active: false } }),
        ],
        [
          "Entra ID's Replace on active, as the string False",
          patch({ op: "Replace", path: "active", value: "False" }),
        ],
        [
          "Entra ID's Replace on active, as a boolean",
          patch({ op: "Replace", path: "active", value: false }),
        ],
        [
          "Entra ID's deactivation with attributes OneUptime does not keep",
          patch(
            { op: "Replace", path: "active", value: false },
            { op: "Replace", path: "title", value: "Former employee" },
            {
              op: "Remove",
              path: `${ENTERPRISE_USER_SCHEMA}:manager`,
            },
            { op: "Replace", path: "name.givenName", value: "Someone" },
          ),
        ],
      ])(
        "PATCH that deactivates - %s - removes them",
        async (_label: string, body: JSONObject) => {
          const result: HttpResult = await send(
            "PATCH",
            project(`Users/${people.alice}`),
            body,
          );

          expect(result.status).toBe(200);
          expect(teamsOf(people.alice)).toEqual([]);
          expect(userOf(people.alice).name).toBe("Alice Leaving");
          expect(world.writes).not.toContain("user updated");
          expect(world.writes).not.toContain("membership created");
        },
      );

      test("PUT of the whole user as it is, with active false, removes them", async () => {
        const result: HttpResult = await send(
          "PUT",
          project(`Users/${people.alice}`),
          {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: "alice@acme.example",
            name: { formatted: "Alice Leaving" },
            emails: [{ value: "alice@acme.example", primary: true }],
            active: false,
          },
        );

        expect(result.status).toBe(200);
        expect(teamsOf(people.alice)).toEqual([]);
        expect(world.writes).not.toContain("user updated");
      });

      test("DELETE of a group removes its members and the team", async () => {
        const result: HttpResult = await send(
          "DELETE",
          project(`Groups/${ENGINEERING}`),
        );

        expect(result.status).toBe(204);
        expect(membersOf(ENGINEERING)).toEqual([]);
        expect(
          world.teams.some((team: FakeTeam) => {
            return team.id === ENGINEERING;
          }),
        ).toBe(false);
      });

      test("Entra ID's Remove on members, with the members as its value", async () => {
        const result: HttpResult = await send(
          "PATCH",
          project(`Groups/${ENGINEERING}`),
          patch({
            op: "Remove",
            path: "members",
            value: [{ value: people.bob }],
          }),
        );

        expect(result.status).toBe(200);
        expect(membersOf(ENGINEERING)).toEqual([people.carol]);
        expect(world.writes).not.toContain("membership created");
      });

      test("Okta's remove on members[value eq ...]", async () => {
        const result: HttpResult = await send(
          "PATCH",
          project(`Groups/${ENGINEERING}`),
          patch({
            op: "remove",
            path: `members[value eq "${people.bob}"]`,
          }),
        );

        expect(result.status).toBe(200);
        expect(membersOf(ENGINEERING)).toEqual([people.carol]);
      });

      test("a replace of the members with some of the ones it has removes the others", async () => {
        const result: HttpResult = await send(
          "PATCH",
          project(`Groups/${ENGINEERING}`),
          patch({
            op: "replace",
            path: "members",
            value: [{ value: people.carol }],
          }),
        );

        expect(result.status).toBe(200);
        expect(membersOf(ENGINEERING)).toEqual([people.carol]);
        expect(world.writes).not.toContain("membership created");
      });

      test("a member id echoed back in upper case still matches its member", async () => {
        const result: HttpResult = await send(
          "PATCH",
          project(`Groups/${ENGINEERING}`),
          patch({
            op: "replace",
            path: "members",
            value: [{ value: people.carol.toUpperCase() }],
          }),
        );

        expect(result.status).toBe(200);
        expect(membersOf(ENGINEERING)).toEqual([people.carol]);
      });

      test("a removal alongside the group's own name, sent as it is", async () => {
        const result: HttpResult = await send(
          "PATCH",
          project(`Groups/${ENGINEERING}`),
          patch(
            { op: "replace", path: "displayName", value: "Engineering" },
            { op: "remove", path: `members[value eq "${people.bob}"]` },
          ),
        );

        expect(result.status).toBe(200);
        expect(membersOf(ENGINEERING)).toEqual([people.carol]);
      });

      test("PUT of a group under its own name, listing some of its members", async () => {
        const result: HttpResult = await send(
          "PUT",
          project(`Groups/${ENGINEERING}`),
          {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "Engineering",
            members: [{ value: people.carol }],
          },
        );

        expect(result.status).toBe(200);
        expect(membersOf(ENGINEERING)).toEqual([people.carol]);
        expect(world.writes).not.toContain("team renamed");
      });

      test("a Bulk request of deletes only", async () => {
        const result: HttpResult = await send("POST", project("Bulk"), {
          schemas: [BULK_SCHEMA],
          Operations: [
            { method: "DELETE", path: `/Users/${people.alice}` },
            { method: "DELETE", path: `/Groups/${ENGINEERING}` },
          ],
        });

        expect(result.status).toBe(200);
        expect(teamsOf(people.alice)).toEqual([]);
        expect(membersOf(ENGINEERING)).toEqual([]);
      });

      test("a status page's private user: DELETE", async () => {
        expect(
          (await send("DELETE", statusPage(`Users/${people.viewer}`))).status,
        ).toBe(204);
        expect(world.privateUsers).toEqual([]);
      });

      test.each([
        ["Okta's form", patch({ op: "replace", value: { active: false } })],
        [
          "Entra ID's form",
          patch({ op: "Replace", path: "active", value: "False" }),
        ],
      ])(
        "a status page's private user: PATCH that deactivates, %s",
        async (_label: string, body: JSONObject) => {
          const result: HttpResult = await send(
            "PATCH",
            statusPage(`Users/${people.viewer}`),
            body,
          );

          expect(result.status).toBe(200);
          expect(world.privateUsers).toEqual([]);
        },
      );

      test("a status page's private user: PUT as it is, with active false", async () => {
        const result: HttpResult = await send(
          "PUT",
          statusPage(`Users/${people.viewer}`),
          { userName: "viewer@customer.example", active: false },
        );

        expect(result.status).toBe(200);
        expect(world.privateUsers).toEqual([]);
      });

      test("a status page's Bulk request of deletes only", async () => {
        const result: HttpResult = await send("POST", statusPage("Bulk"), {
          schemas: [BULK_SCHEMA],
          Operations: [{ method: "DELETE", path: `/Users/${people.viewer}` }],
        });

        expect(result.status).toBe(200);
        expect(world.privateUsers).toEqual([]);
      });
    });

    describe("anything that gives or changes access is refused, whole", () => {
      test("creating a user", async () => {
        expectRefusedBelowPlan(
          await send("POST", project("Users"), {
            userName: "new.hire@acme.example",
            name: { givenName: "New", familyName: "Hire" },
          }),
        );
        expect(world.writes).toEqual([]);
      });

      test("creating a user who already exists", async () => {
        expectRefusedBelowPlan(
          await send("POST", project("Users"), {
            userName: "olga@elsewhere.example",
          }),
        );
        expect(teamsOf(people.outsider)).toEqual([]);
        expect(world.writes).toEqual([]);
      });

      test("creating a group, with members", async () => {
        expectRefusedBelowPlan(
          await send("POST", project("Groups"), {
            displayName: "Platform",
            members: [{ value: people.bob }],
          }),
        );
        expect(world.writes).toEqual([]);
      });

      test.each([
        [
          "Okta's form",
          patch({ op: "replace", value: { active: true } }),
        ],
        [
          "Entra ID's form",
          patch({ op: "Replace", path: "active", value: "True" }),
        ],
      ])(
        "reactivating a user, %s",
        async (_label: string, body: JSONObject) => {
          expectRefusedBelowPlan(
            await send("PATCH", project(`Users/${people.bob}`), body),
          );
          expect(teamsOf(people.bob)).toEqual([ENGINEERING]);
          expect(world.writes).toEqual([]);
        },
      );

      test("changing a user's email", async () => {
        expectRefusedBelowPlan(
          await send(
            "PATCH",
            project(`Users/${people.alice}`),
            patch({
              op: "Replace",
              path: 'emails[type eq "work"].value',
              value: "alice@new.example",
            }),
          ),
        );
        expect(userOf(people.alice).email).toBe("alice@acme.example");
        expect(world.writes).toEqual([]);
      });

      test("a deactivation that also changes the email: nothing of it is applied", async () => {
        expectRefusedBelowPlan(
          await send(
            "PATCH",
            project(`Users/${people.alice}`),
            patch(
              { op: "Replace", path: "active", value: false },
              { op: "Replace", path: "userName", value: "alice@new.example" },
            ),
          ),
        );
        expect(teamsOf(people.alice)).toEqual(
          [DEFAULT_TEAM_A, DEFAULT_TEAM_B].sort(),
        );
        expect(userOf(people.alice).email).toBe("alice@acme.example");
        expect(world.writes).toEqual([]);
      });

      test("a PUT that deactivates and renames: nothing of it is applied", async () => {
        expectRefusedBelowPlan(
          await send("PUT", project(`Users/${people.alice}`), {
            userName: "alice@acme.example",
            name: { formatted: "Alice Renamed" },
            active: false,
          }),
        );
        expect(teamsOf(people.alice)).toEqual(
          [DEFAULT_TEAM_A, DEFAULT_TEAM_B].sort(),
        );
        expect(userOf(people.alice).name).toBe("Alice Leaving");
      });

      // The people are seeded per test, so each body is built from them.
      test.each([
        [
          "Okta's add on members",
          (who: People): JSONObject => {
            return patch({
              op: "add",
              path: "members",
              value: [{ value: who.alice, display: "alice@acme.example" }],
            });
          },
        ],
        [
          "Entra ID's Add on members",
          (who: People): JSONObject => {
            return patch({
              op: "Add",
              path: "members",
              value: [{ value: who.alice }],
            });
          },
        ],
      ])(
        "adding a member to a group, %s",
        async (_label: string, body: (who: People) => JSONObject) => {
          expectRefusedBelowPlan(
            await send("PATCH", project(`Groups/${ENGINEERING}`), body(people)),
          );
          expect(membersOf(ENGINEERING)).toEqual(
            [people.bob, people.carol].sort(),
          );
          expect(world.writes).toEqual([]);
        },
      );

      test("a removal and an addition in one PATCH: the removal is not applied either", async () => {
        expectRefusedBelowPlan(
          await send(
            "PATCH",
            project(`Groups/${ENGINEERING}`),
            patch(
              { op: "remove", path: `members[value eq "${people.bob}"]` },
              {
                op: "add",
                path: "members",
                value: [{ value: people.alice }],
              },
            ),
          ),
        );
        expect(membersOf(ENGINEERING)).toEqual(
          [people.bob, people.carol].sort(),
        );
        expect(world.writes).toEqual([]);
      });

      test("a replace of the members that names someone new", async () => {
        expectRefusedBelowPlan(
          await send(
            "PATCH",
            project(`Groups/${ENGINEERING}`),
            patch({
              op: "replace",
              path: "members",
              value: [{ value: people.carol }, { value: people.alice }],
            }),
          ),
        );
        expect(membersOf(ENGINEERING)).toEqual(
          [people.bob, people.carol].sort(),
        );
        expect(world.writes).toEqual([]);
      });

      test("a removal followed by a replace that puts the same person back", async () => {
        expectRefusedBelowPlan(
          await send(
            "PATCH",
            project(`Groups/${ENGINEERING}`),
            patch(
              { op: "remove", path: `members[value eq "${people.bob}"]` },
              {
                op: "replace",
                path: "members",
                value: [{ value: people.bob }, { value: people.carol }],
              },
            ),
          ),
        );
        expect(membersOf(ENGINEERING)).toEqual(
          [people.bob, people.carol].sort(),
        );
      });

      test("renaming a group", async () => {
        expectRefusedBelowPlan(
          await send(
            "PATCH",
            project(`Groups/${ENGINEERING}`),
            patch({ op: "replace", path: "displayName", value: "Platform" }),
          ),
        );
        expect(
          world.teams.find((team: FakeTeam) => {
            return team.id === ENGINEERING;
          })!.name,
        ).toBe("Engineering");
        expect(world.writes).toEqual([]);
      });

      test("a PUT of a group that adds a member", async () => {
        expectRefusedBelowPlan(
          await send("PUT", project(`Groups/${ENGINEERING}`), {
            displayName: "Engineering",
            members: [{ value: people.carol }, { value: people.alice }],
          }),
        );
        expect(membersOf(ENGINEERING)).toEqual(
          [people.bob, people.carol].sort(),
        );
        expect(world.writes).toEqual([]);
      });

      test("a PUT of a group under a new name, even one that only removes members", async () => {
        expectRefusedBelowPlan(
          await send("PUT", project(`Groups/${ENGINEERING}`), {
            displayName: "Platform",
            members: [{ value: people.carol }],
          }),
        );
        expect(membersOf(ENGINEERING)).toEqual(
          [people.bob, people.carol].sort(),
        );
        expect(world.writes).toEqual([]);
      });

      test("a Bulk request with a create among its deletes: the deletes do not run", async () => {
        expectRefusedBelowPlan(
          await send("POST", project("Bulk"), {
            schemas: [BULK_SCHEMA],
            Operations: [
              { method: "DELETE", path: `/Users/${people.alice}` },
              {
                method: "POST",
                path: "/Users",
                bulkId: "new",
                data: { userName: "new.hire@acme.example" },
              },
            ],
          }),
        );
        expect(teamsOf(people.alice)).toEqual(
          [DEFAULT_TEAM_A, DEFAULT_TEAM_B].sort(),
        );
        expect(world.writes).toEqual([]);
      });

      test("a status page: creating a private user", async () => {
        expectRefusedBelowPlan(
          await send("POST", statusPage("Users"), {
            userName: "another@customer.example",
          }),
        );
        expect(world.privateUsers).toHaveLength(1);
        expect(world.writes).toEqual([]);
      });

      test("a status page: changing a private user's email", async () => {
        expectRefusedBelowPlan(
          await send(
            "PATCH",
            statusPage(`Users/${people.viewer}`),
            patch({
              op: "replace",
              path: "userName",
              value: "renamed@customer.example",
            }),
          ),
        );
        expect(world.privateUsers[0]!.email).toBe("viewer@customer.example");
        expect(world.writes).toEqual([]);
      });

      test("a status page: a deactivation that also changes the email keeps the user", async () => {
        expectRefusedBelowPlan(
          await send(
            "PATCH",
            statusPage(`Users/${people.viewer}`),
            patch(
              { op: "Replace", path: "active", value: false },
              {
                op: "Replace",
                path: "userName",
                value: "renamed@customer.example",
              },
            ),
          ),
        );
        expect(world.privateUsers).toHaveLength(1);
        expect(world.writes).toEqual([]);
      });

      test("a status page: reactivating a private user", async () => {
        expectRefusedBelowPlan(
          await send(
            "PATCH",
            statusPage(`Users/${people.viewer}`),
            patch({ op: "replace", value: { active: true } }),
          ),
        );
      });

      test("a status page: a Bulk request with an update among its deletes", async () => {
        expectRefusedBelowPlan(
          await send("POST", statusPage("Bulk"), {
            schemas: [BULK_SCHEMA],
            Operations: [
              { method: "DELETE", path: `/Users/${people.viewer}` },
              {
                method: "PATCH",
                path: `/Users/${people.viewer}`,
                data: { active: false },
              },
            ],
          }),
        );
        expect(world.privateUsers).toHaveLength(1);
      });
    });
  },
);

describe("on the plan (Scale), SCIM does what it always did", () => {
  beforeEach(() => {
    world.plan = PlanType.Scale;
  });

  test("a userName filter for someone new provisions them", async () => {
    const result: HttpResult = await send(
      "GET",
      project(
        `Users?filter=${encodeURIComponent('userName eq "new.hire@acme.example"')}`,
      ),
    );

    expect(result.status).toBe(200);
    expect(result.body["totalResults"]).toBe(1);
    expect(world.writes).toContain("user created");
  });

  test("creating a user", async () => {
    const result: HttpResult = await send("POST", project("Users"), {
      userName: "new.hire@acme.example",
    });

    expect(result.status).toBe(201);
  });

  test("adding a member to a group, and renaming it", async () => {
    const result: HttpResult = await send(
      "PATCH",
      project(`Groups/${ENGINEERING}`),
      patch(
        { op: "add", path: "members", value: [{ value: people.alice }] },
        { op: "replace", path: "displayName", value: "Platform" },
      ),
    );

    expect(result.status).toBe(200);
    expect(membersOf(ENGINEERING)).toContain(people.alice);
    expect(
      world.teams.find((team: FakeTeam) => {
        return team.id === ENGINEERING;
      })!.name,
    ).toBe("Platform");
  });

  test("Okta's members[value eq ...] removal works on the plan too", async () => {
    const result: HttpResult = await send(
      "PATCH",
      project(`Groups/${ENGINEERING}`),
      patch({ op: "remove", path: `members[value eq "${people.bob}"]` }),
    );

    expect(result.status).toBe(200);
    expect(membersOf(ENGINEERING)).toEqual([people.carol]);
  });

  test("a Bulk request that creates a status page user", async () => {
    const result: HttpResult = await send("POST", statusPage("Bulk"), {
      schemas: [BULK_SCHEMA],
      Operations: [
        {
          method: "POST",
          path: "/Users",
          bulkId: "new",
          data: { userName: "another@customer.example" },
        },
      ],
    });

    expect(result.status).toBe(200);
    expect(world.privateUsers).toHaveLength(2);
  });
});

describe("billing off (self-hosted): no plans, nothing refused", () => {
  test.each([[PlanType.Free], [PlanType.Growth]])(
    "with %s stored, creating a user and adding a member go through",
    async (plan: PlanType) => {
      setTestBillingEnabled(false);
      world.plan = plan;

      expect(
        (
          await send("POST", project("Users"), {
            userName: "new.hire@acme.example",
          })
        ).status,
      ).toBe(201);

      expect(
        (
          await send(
            "PATCH",
            project(`Groups/${ENGINEERING}`),
            patch({
              op: "add",
              path: "members",
              value: [{ value: people.alice }],
            }),
          )
        ).status,
      ).toBe(200);
      expect(membersOf(ENGINEERING)).toContain(people.alice);
    },
  );
});
