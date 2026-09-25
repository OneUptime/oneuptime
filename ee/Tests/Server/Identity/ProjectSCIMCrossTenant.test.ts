import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import ProjectSCIMRouter from "../../../Server/Identity/API/SCIM";
import ProjectSCIMAccountPolicy, {
  HOSTED_EMAIL_CHANGE_REFUSED_MESSAGE,
  ProjectSCIMAccountStanding,
  UNMANAGED_EMAIL_CHANGE_REFUSED_MESSAGE,
} from "../../../Server/Identity/Utils/ProjectSCIMAccountPolicy";
import { createProjectSCIMLog } from "../../../Server/Identity/Utils/SCIMLogger";
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
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import FakeEnterpriseModule, {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * ---------------------------------------------------------------------------
 * A PROJECT'S SCIM CANNOT TAKE OVER, OR PULL IN, ANOTHER TENANT'S ACCOUNT.
 *
 * A project's SCIM endpoint is configured by that project's admins -- on the
 * hosted service, a customer. The accounts it names are instance-wide, so a
 * hostile admin used to be able to:
 *
 *   1. take any account over: invite it (a pending membership is enough for
 *      SCIM to find it), PATCH its email to a mailbox they read, verify that
 *      address, and reset the password -- which hands them the account and
 *      every other project it belongs to;
 *   2. force any account into their project: "create" it by email, re-activate
 *      it, or name its id as a group member, and SCIM created an ACCEPTED
 *      membership the owner never agreed to. Acceptance is a permission grant
 *      (TeamMemberAutoAcceptInvitation.test.ts).
 *
 * These tests drive the real router over HTTP against an in-memory fake of the
 * user, team and membership services, and assert on the state that results:
 * whose email is what, and which memberships exist and whether they are
 * accepted. The fake records which creates asked TeamMemberService to send an
 * invitation email (miscDataProps.email); that the service then sends it is
 * TeamMemberAutoAcceptInvitation.test.ts's to prove.
 *
 * Every suite pins billing: on is the hosted service, off is self-hosted.
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

jest.mock("../../../Server/Identity/Utils/SCIMLogger", () => {
  return {
    createStatusPageSCIMLog: jest.fn().mockResolvedValue(undefined),
    createProjectSCIMLog: jest.fn().mockResolvedValue(undefined),
  };
});

/*
 * ---------------------------------------------------------------------------
 * The in-memory world the fakes below read and write.
 * ---------------------------------------------------------------------------
 */

interface FakeUser {
  id: string;
  email: string;
  name: string;
  isMasterAdmin: boolean;
}

interface FakeMembership {
  id: string;
  projectId: string;
  userId: string;
  teamId: string;
  hasAcceptedInvitation: boolean;
  // miscDataProps.email: the create asked for the invitation email.
  invitationEmailRequestedFor: string | undefined;
}

interface FakeTeam {
  id: string;
  projectId: string;
  name: string;
  isTeamDeleteable: boolean;
}

interface FakeWorld {
  users: Array<FakeUser>;
  memberships: Array<FakeMembership>;
  /*
   * Every row a TeamMemberService.deleteBy matched, in order. They are what
   * the real service hands to onDeleteSuccess, whose leave cleanups (on-call
   * and resource assignments, workspace links, notification settings) run for
   * each deleted row's account.
   */
  deletedMemberships: Array<FakeMembership>;
  teams: Array<FakeTeam>;
  consents: Array<{ userId: string; projectId: string }>;
  userUpdates: Array<{ id: string; data: JSONObject }>;
}

const world: FakeWorld = {
  users: [],
  memberships: [],
  deletedMemberships: [],
  teams: [],
  consents: [],
  userUpdates: [],
};

const idOf: (value: unknown) => string = (value: unknown): string => {
  return String(value).toLowerCase();
};

/*
 * A query value as the services receive it: an id (string or ObjectID), a
 * boolean, an Email, or QueryHelper.any(...) -- a TypeORM Raw operator whose
 * one parameter is the list of ids.
 */
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

type FakeRow = FakeUser | FakeMembership | FakeTeam;

const matchesQuery: (
  row: FakeRow,
  query: Record<string, unknown>,
) => boolean = (row: FakeRow, query: Record<string, unknown>): boolean => {
  const columns: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;

  return Object.entries(query).every(([key, expected]: [string, unknown]) => {
    const column: string = key === "_id" ? "id" : key;
    return matchesValue(columns[column], expected);
  });
};

const toUser: (fake: FakeUser) => User = (fake: FakeUser): User => {
  const user: User = new User(new ObjectID(fake.id));
  user.email = new Email(fake.email);
  user.name = new Name(fake.name);
  user.isMasterAdmin = fake.isMasterAdmin;
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
        const user: FakeUser = {
          id: idOf(ObjectID.generate()),
          email: args.email.toString(),
          name: args.name.toString(),
          isMasterAdmin: false,
        };
        world.users.push(user);
        return toUser(user);
      },
      updateOneById: async (args: {
        id: unknown;
        data: { email?: Email; name?: Name };
      }): Promise<void> => {
        const user: FakeUser | undefined = world.users.find(
          (item: FakeUser) => {
            return item.id === idOf(args.id);
          },
        );

        world.userUpdates.push({
          id: idOf(args.id),
          data: JSON.parse(JSON.stringify(args.data)) as JSONObject,
        });

        if (!user) {
          return;
        }

        if (args.data.email) {
          user.email = args.data.email.toString();
        }

        if (args.data.name) {
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
      create: async (args: {
        data: TeamMember;
        miscDataProps?: JSONObject;
      }): Promise<TeamMember> => {
        const row: FakeMembership = {
          id: idOf(ObjectID.generate()),
          projectId: idOf(args.data.projectId),
          userId: idOf(args.data.userId),
          teamId: idOf(args.data.teamId),
          hasAcceptedInvitation: Boolean(args.data.hasAcceptedInvitation),
          invitationEmailRequestedFor: args.miscDataProps?.["email"] as
            | string
            | undefined,
        };

        // TeamMemberService.onBeforeCreate's duplicate-invite guard.
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
        world.deletedMemberships.push(
          ...world.memberships.filter((item: FakeMembership) => {
            return matchesQuery(item, args.query);
          }),
        );
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
      create: async (args: { data: Team }): Promise<Team> => {
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
      hasConsent: async (args: {
        userId: unknown;
        projectId: unknown;
      }): Promise<boolean> => {
        return world.consents.some(
          (item: { userId: string; projectId: string }) => {
            return (
              item.userId === idOf(args.userId) &&
              item.projectId === idOf(args.projectId)
            );
          },
        );
      },
    },
  };
});

/*
 * ---------------------------------------------------------------------------
 * The tenants.
 * ---------------------------------------------------------------------------
 */

// The project whose (hostile) admins configured this SCIM endpoint.
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
// Somebody else's project, on the same instance.
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const SCIM_ID: string = "33333333-3333-4333-8333-333333333333";

// The SCIM configuration's default teams, and a team its groups manage.
const DEFAULT_TEAM_A: string = "44444444-4444-4444-8444-444444444444";
const DEFAULT_TEAM_B: string = "55555555-5555-4555-8555-555555555555";
const GROUP_TEAM: string = "66666666-6666-4666-8666-666666666666";
const OTHER_PROJECT_TEAM: string = "77777777-7777-4777-8777-777777777777";

const ATTACKER_MAILBOX: string = "attacker@evil.example";

const PATCH_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const BULK_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:BulkRequest";

let projectConfig: ProjectSCIM;
let httpServer: Server;
let baseUrl: string;
let enterpriseModule: FakeEnterpriseModule;

interface HttpResult {
  status: number;
  body: JSONObject;
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
    body: (text ? JSON.parse(text) : {}) as JSONObject,
  };
}

function patch(...operations: Array<JSONObject>): JSONObject {
  return { schemas: [PATCH_SCHEMA], Operations: operations };
}

function scimPath(resource: string): string {
  return `/scim/v2/${SCIM_ID}/${resource}`;
}

function member(userId: string): JSONObject {
  return { value: userId };
}

function seedUser(data: {
  email: string;
  name?: string;
  isMasterAdmin?: boolean;
}): string {
  const id: string = idOf(ObjectID.generate());
  world.users.push({
    id,
    email: data.email,
    name: data.name || data.email.split("@")[0]!,
    isMasterAdmin: Boolean(data.isMasterAdmin),
  });
  return id;
}

function seedMembership(data: {
  userId: string;
  projectId: string;
  teamId: string;
  accepted: boolean;
}): string {
  const id: string = idOf(ObjectID.generate());
  world.memberships.push({
    id,
    projectId: data.projectId,
    userId: data.userId,
    teamId: data.teamId,
    hasAcceptedInvitation: data.accepted,
    invitationEmailRequestedFor: undefined,
  });
  return id;
}

function seedTeam(id: string, projectId: string, name: string): void {
  world.teams.push({ id, projectId, name, isTeamDeleteable: true });
}

function emailOf(userId: string): string {
  return world.users.find((user: FakeUser) => {
    return user.id === userId;
  })!.email;
}

function nameOf(userId: string): string {
  return world.users.find((user: FakeUser) => {
    return user.id === userId;
  })!.name;
}

function membershipsOf(
  userId: string,
  projectId: string = PROJECT_ID,
): Array<FakeMembership> {
  return world.memberships.filter((row: FakeMembership) => {
    return row.userId === userId && row.projectId === projectId;
  });
}

function membershipIn(
  userId: string,
  teamId: string,
): FakeMembership | undefined {
  return world.memberships.find((row: FakeMembership) => {
    return row.userId === userId && row.teamId === teamId;
  });
}

// The rows of this account that a delete matched, so its leave cleanups ran.
function deletedRowsOf(userId: string): Array<FakeMembership> {
  return world.deletedMemberships.filter((row: FakeMembership) => {
    return row.userId === userId;
  });
}

function invitationEmailsFor(userId: string): Array<string> {
  return world.memberships
    .filter((row: FakeMembership) => {
      return row.userId === userId && row.invitationEmailRequestedFor;
    })
    .map((row: FakeMembership) => {
      return row.invitationEmailRequestedFor!;
    });
}

function snapshotMemberships(): Array<FakeMembership> {
  return JSON.parse(JSON.stringify(world.memberships)) as Array<FakeMembership>;
}

/*
 * The people involved. Each describes where an account stands before the
 * hostile project's SCIM touches it.
 */
interface Cast {
  // Belongs to another customer; the hostile admin has invited her (pending).
  pendingInvitee: string;
  // Invited here (pending) and in no other project at all.
  loneInvitee: string;
  // Accepted member here AND of another customer's project.
  multiProjectMember: string;
  // A master admin (e.g. support staff) whose only project is this one.
  masterAdmin: string;
  // Accepted member of this project only: an account this project manages.
  managedMember: string;
  // Exists, belongs to no project, and was never invited here.
  stranger: string;
  // Belongs to no project, but confirmed this project's SSO from her mailbox.
  ssoConsented: string;
}

let cast: Cast;

function seedWorld(): void {
  world.users = [];
  world.memberships = [];
  world.deletedMemberships = [];
  world.teams = [];
  world.consents = [];
  world.userUpdates = [];

  seedTeam(DEFAULT_TEAM_A, PROJECT_ID, "Default A");
  seedTeam(DEFAULT_TEAM_B, PROJECT_ID, "Default B");
  seedTeam(GROUP_TEAM, PROJECT_ID, "Engineering");
  seedTeam(OTHER_PROJECT_TEAM, OTHER_PROJECT_ID, "Globex Owners");

  cast = {
    pendingInvitee: seedUser({ email: "alice@globex.example" }),
    loneInvitee: seedUser({ email: "lone@example.com" }),
    multiProjectMember: seedUser({ email: "bob@example.com" }),
    masterAdmin: seedUser({
      email: "support@oneuptime.example",
      isMasterAdmin: true,
    }),
    managedMember: seedUser({ email: "carol@acme.example", name: "Carol" }),
    stranger: seedUser({ email: "dave@example.com", name: "Dave Original" }),
    ssoConsented: seedUser({ email: "erin@example.com" }),
  };

  seedMembership({
    userId: cast.pendingInvitee,
    projectId: OTHER_PROJECT_ID,
    teamId: OTHER_PROJECT_TEAM,
    accepted: true,
  });
  seedMembership({
    userId: cast.pendingInvitee,
    projectId: PROJECT_ID,
    teamId: DEFAULT_TEAM_A,
    accepted: false,
  });

  seedMembership({
    userId: cast.loneInvitee,
    projectId: PROJECT_ID,
    teamId: DEFAULT_TEAM_A,
    accepted: false,
  });

  seedMembership({
    userId: cast.multiProjectMember,
    projectId: PROJECT_ID,
    teamId: DEFAULT_TEAM_A,
    accepted: true,
  });
  seedMembership({
    userId: cast.multiProjectMember,
    projectId: OTHER_PROJECT_ID,
    teamId: OTHER_PROJECT_TEAM,
    accepted: true,
  });

  seedMembership({
    userId: cast.masterAdmin,
    projectId: PROJECT_ID,
    teamId: DEFAULT_TEAM_A,
    accepted: true,
  });

  seedMembership({
    userId: cast.managedMember,
    projectId: PROJECT_ID,
    teamId: DEFAULT_TEAM_A,
    accepted: true,
  });

  world.consents.push({ userId: cast.ssoConsented, projectId: PROJECT_ID });
}

beforeAll(async () => {
  enterpriseModule = installFakeEnterpriseModule({
    snapshot: createLicenseSnapshotWithStatus("valid"),
  });

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson({ type: ["application/json", "application/scim+json"] }));
  app.use(
    (req: ExpressRequest, _res: ExpressResponse, next: NextFunction): void => {
      (req as OneUptimeRequest).bearerTokenData = {
        projectId: new ObjectID(PROJECT_ID),
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
        .status(
          error instanceof NotFoundException
            ? 404
            : error instanceof BadRequestException
              ? 400
              : 500,
        )
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
  expect(enterpriseModule).toBeDefined();

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
  seedWorld();

  projectConfig = new ProjectSCIM(new ObjectID(SCIM_ID));
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
});

/*
 * ---------------------------------------------------------------------------
 * The shapes identity providers use to change an address.
 * ---------------------------------------------------------------------------
 */

interface EmailChangeShape {
  label: string;
  method: "PUT" | "PATCH";
  body: (newEmail: string) => JSONObject;
}

const emailChangeShapes: Array<EmailChangeShape> = [
  {
    label: "Entra ID PATCH replace userName",
    method: "PATCH",
    body: (newEmail: string): JSONObject => {
      return patch({ op: "Replace", path: "userName", value: newEmail });
    },
  },
  {
    label: "PATCH replace of the work email's value",
    method: "PATCH",
    body: (newEmail: string): JSONObject => {
      return patch({
        op: "Replace",
        path: 'emails[type eq "work"].value',
        value: newEmail,
      });
    },
  },
  {
    label: "PATCH replace of the emails array",
    method: "PATCH",
    body: (newEmail: string): JSONObject => {
      return patch({
        op: "replace",
        path: "emails",
        value: [{ type: "work", value: newEmail }],
      });
    },
  },
  {
    label: "PATCH replace without a path",
    method: "PATCH",
    body: (newEmail: string): JSONObject => {
      return patch({ op: "Replace", value: { userName: newEmail } });
    },
  },
  {
    label: "Okta full-resource PUT",
    method: "PUT",
    body: (newEmail: string): JSONObject => {
      return { userName: newEmail, active: true };
    },
  },
];

/*
 * POST /Users answers 201 and the group adds answer 200. Status codes are not
 * what these tests are about (SCIMResponseStatusCodes.test.ts pins them), so
 * they only ask for a success.
 */
function expectSuccess(result: HttpResult): void {
  expect(result.status).toBeGreaterThanOrEqual(200);
  expect(result.status).toBeLessThan(300);
}

function expectMutabilityRefusal(result: HttpResult, detail: string): void {
  expect(result.status).toBe(400);
  expect(result.body["schemas"]).toEqual([
    "urn:ietf:params:scim:api:messages:2.0:Error",
  ]);
  expect(result.body["scimType"]).toBe("mutability");
  expect(result.body["detail"]).toBe(detail);
}

async function sendBulkUserUpdate(
  method: "PUT" | "PATCH",
  userId: string,
  data: JSONObject,
): Promise<HttpResult> {
  return send("POST", scimPath("Bulk"), {
    schemas: [BULK_SCHEMA],
    Operations: [{ method, bulkId: "u1", path: `/Users/${userId}`, data }],
  });
}

const deployments: Array<{
  label: string;
  hosted: boolean;
  refusalForUnmanaged: string;
}> = [
  {
    label: "the hosted service",
    hosted: true,
    refusalForUnmanaged: HOSTED_EMAIL_CHANGE_REFUSED_MESSAGE,
  },
  {
    label: "a self-hosted install",
    hosted: false,
    refusalForUnmanaged: UNMANAGED_EMAIL_CHANGE_REFUSED_MESSAGE,
  },
];

/*
 * ---------------------------------------------------------------------------
 * Issue 1: the email rewrite.
 * ---------------------------------------------------------------------------
 */

describe.each(deployments)(
  "on $label, SCIM cannot rewrite the email of an account it does not manage",
  ({
    hosted,
    refusalForUnmanaged,
  }: {
    hosted: boolean;
    refusalForUnmanaged: string;
  }) => {
    beforeEach(() => {
      setTestBillingEnabled(hosted);
    });

    const victims: Array<{ label: string; pick: (c: Cast) => string }> = [
      {
        label: "a pending invitee who belongs to another customer",
        pick: (c: Cast): string => {
          return c.pendingInvitee;
        },
      },
      {
        label: "a pending invitee who belongs to no other project",
        pick: (c: Cast): string => {
          return c.loneInvitee;
        },
      },
      {
        label: "an accepted member who also belongs to another customer",
        pick: (c: Cast): string => {
          return c.multiProjectMember;
        },
      },
      {
        label: "a master admin whose only project is this one",
        pick: (c: Cast): string => {
          return c.masterAdmin;
        },
      },
    ];

    describe.each(victims)(
      "$label",
      ({ pick }: { pick: (c: Cast) => string }) => {
        test.each(emailChangeShapes)(
          "is refused with a SCIM mutability error for $label, and nothing changes",
          async ({ method, body }: EmailChangeShape) => {
            const victim: string = pick(cast);
            const originalEmail: string = emailOf(victim);
            const before: Array<FakeMembership> = snapshotMemberships();

            const result: HttpResult = await send(
              method,
              scimPath(`Users/${victim}`),
              body(ATTACKER_MAILBOX),
            );

            expectMutabilityRefusal(result, refusalForUnmanaged);
            expect(emailOf(victim)).toBe(originalEmail);
            expect(world.userUpdates).toEqual([]);
            // Refused before anything was written: no team was touched either.
            expect(world.memberships).toEqual(before);
          },
        );

        test("is refused inside a Bulk request, as that operation's 400", async () => {
          const victim: string = pick(cast);
          const originalEmail: string = emailOf(victim);

          for (const method of ["PUT", "PATCH"] as const) {
            const result: HttpResult = await sendBulkUserUpdate(
              method,
              victim,
              { userName: ATTACKER_MAILBOX, active: true },
            );

            expect(result.status).toBe(200);
            const operation: JSONObject = (
              result.body["Operations"] as Array<JSONObject>
            )[0]!;
            expect(operation["status"]).toBe("400");
            expect((operation["response"] as JSONObject)["scimType"]).toBe(
              "mutability",
            );
            expect((operation["response"] as JSONObject)["detail"]).toBe(
              refusalForUnmanaged,
            );
          }

          expect(emailOf(victim)).toBe(originalEmail);
          expect(world.userUpdates).toEqual([]);
        });
      },
    );

    test("the refusal is written to the project's SCIM log as an error", async () => {
      await send(
        "PATCH",
        scimPath(`Users/${cast.pendingInvitee}`),
        patch({ op: "Replace", path: "userName", value: ATTACKER_MAILBOX }),
      );

      expect(createProjectSCIMLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: "UpdateUser",
          status: "Error",
          statusMessage: refusalForUnmanaged,
          httpStatusCode: 400,
          affectedUserEmail: "alice@globex.example",
          additionalContext: expect.objectContaining({
            emailChangeRefused: true,
          }),
        }),
      );
    });

    test("a refused email change does not also deactivate: the whole request is refused", async () => {
      /*
       * All or nothing, like any other 400. The IdP retries the request; the
       * deprovisioning goes through as soon as it stops asking for the email.
       */
      const before: Array<FakeMembership> = snapshotMemberships();

      const result: HttpResult = await send(
        "PUT",
        scimPath(`Users/${cast.multiProjectMember}`),
        { userName: ATTACKER_MAILBOX, active: false },
      );

      expect(result.status).toBe(400);
      expect(world.memberships).toEqual(before);

      const retry: HttpResult = await send(
        "PUT",
        scimPath(`Users/${cast.multiProjectMember}`),
        { userName: "bob@example.com", active: false },
      );

      expect(retry.status).toBe(200);
      expect(membershipsOf(cast.multiProjectMember)).toEqual([]);
      expect(
        membershipsOf(cast.multiProjectMember, OTHER_PROJECT_ID),
      ).toHaveLength(1);
    });

    test("sending the address the account already has is not a change, in any case or spacing", async () => {
      for (const sameAddress of [
        "alice@globex.example",
        "ALICE@Globex.Example",
        "  alice@globex.example ",
      ]) {
        const result: HttpResult = await send(
          "PATCH",
          scimPath(`Users/${cast.pendingInvitee}`),
          patch({ op: "Replace", path: "userName", value: sameAddress }),
        );

        expect(result.status).toBe(200);
        expect(result.body["userName"]).toBe("alice@globex.example");
      }

      expect(world.userUpdates).toEqual([]);
    });

    test("deprovisioning a pending invitee still works: removal never needs the account's consent", async () => {
      const result: HttpResult = await send(
        "PATCH",
        scimPath(`Users/${cast.pendingInvitee}`),
        patch({ op: "Replace", path: "active", value: false }),
      );

      expect(result.status).toBe(200);
      expect(membershipsOf(cast.pendingInvitee)).toEqual([]);
      expect(membershipsOf(cast.pendingInvitee, OTHER_PROJECT_ID)).toHaveLength(
        1,
      );
    });

    test("the takeover, end to end: invite by email, then rewrite the address", async () => {
      const victim: string = seedUser({ email: "victim@othercorp.example" });
      seedMembership({
        userId: victim,
        projectId: OTHER_PROJECT_ID,
        teamId: OTHER_PROJECT_TEAM,
        accepted: true,
      });

      // Step 1: "provision" the victim, which finds the existing account.
      const created: HttpResult = await send("POST", scimPath("Users"), {
        userName: "victim@othercorp.example",
      });
      expectSuccess(created);
      expect(created.body["id"]).toBe(victim);

      // Step 2: point the account at a mailbox the admin reads.
      const rewrite: HttpResult = await send(
        "PATCH",
        scimPath(`Users/${victim}`),
        patch({ op: "Replace", path: "userName", value: ATTACKER_MAILBOX }),
      );

      expect(rewrite.status).toBe(400);
      expect(emailOf(victim)).toBe("victim@othercorp.example");
      expect(
        world.users.some((user: FakeUser) => {
          return user.email === ATTACKER_MAILBOX;
        }),
      ).toBe(false);
    });
  },
);

describe("on the hosted service, SCIM never changes an email address", () => {
  beforeEach(() => {
    setTestBillingEnabled(true);
  });

  test.each(emailChangeShapes)(
    "not even of an account this project manages, for $label",
    async ({ method, body }: EmailChangeShape) => {
      const result: HttpResult = await send(
        method,
        scimPath(`Users/${cast.managedMember}`),
        body("carol.new@acme.example"),
      );

      expectMutabilityRefusal(result, HOSTED_EMAIL_CHANGE_REFUSED_MESSAGE);
      expect(emailOf(cast.managedMember)).toBe("carol@acme.example");
      expect(world.userUpdates).toEqual([]);
    },
  );

  test("an SCIM-provisioned account is no exception: its mailbox owner may since have claimed it", async () => {
    const created: HttpResult = await send("POST", scimPath("Users"), {
      userName: "new.hire@acme.example",
    });
    const newUserId: string = created.body["id"] as string;

    const result: HttpResult = await send(
      "PATCH",
      scimPath(`Users/${newUserId}`),
      patch({ op: "Replace", path: "userName", value: ATTACKER_MAILBOX }),
    );

    expectMutabilityRefusal(result, HOSTED_EMAIL_CHANGE_REFUSED_MESSAGE);
    expect(emailOf(newUserId)).toBe("new.hire@acme.example");
  });
});

describe("on a self-hosted install, SCIM still changes the email of an account this project manages", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test.each(emailChangeShapes)(
    "for $label",
    async ({ method, body }: EmailChangeShape) => {
      const result: HttpResult = await send(
        method,
        scimPath(`Users/${cast.managedMember}`),
        body("carol.new@acme.example"),
      );

      expect(result.status).toBe(200);
      expect(result.body["userName"]).toBe("carol.new@acme.example");
      expect(emailOf(cast.managedMember)).toBe("carol.new@acme.example");
    },
  );

  test("and inside a Bulk request", async () => {
    const result: HttpResult = await sendBulkUserUpdate(
      "PATCH",
      cast.managedMember,
      { userName: "carol.new@acme.example" },
    );

    const operation: JSONObject = (
      result.body["Operations"] as Array<JSONObject>
    )[0]!;
    expect(operation["status"]).toBe("200");
    expect(emailOf(cast.managedMember)).toBe("carol.new@acme.example");
  });

  test("but not once the account has joined another project too", async () => {
    seedMembership({
      userId: cast.managedMember,
      projectId: OTHER_PROJECT_ID,
      teamId: OTHER_PROJECT_TEAM,
      accepted: false,
    });

    const result: HttpResult = await send(
      "PATCH",
      scimPath(`Users/${cast.managedMember}`),
      patch({ op: "Replace", path: "userName", value: ATTACKER_MAILBOX }),
    );

    expectMutabilityRefusal(result, UNMANAGED_EMAIL_CHANGE_REFUSED_MESSAGE);
    expect(emailOf(cast.managedMember)).toBe("carol@acme.example");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Names: not a credential, but still somebody else's account.
 * ---------------------------------------------------------------------------
 */

describe.each(deployments)(
  "on $label, SCIM renames only accounts this project manages",
  ({ hosted }: { hosted: boolean }) => {
    beforeEach(() => {
      setTestBillingEnabled(hosted);
    });

    test("a PUT naming an account that belongs to another customer leaves its name alone, and succeeds", async () => {
      const result: HttpResult = await send(
        "PUT",
        scimPath(`Users/${cast.multiProjectMember}`),
        {
          userName: "bob@example.com",
          name: { formatted: "OneUptime Support" },
          active: true,
        },
      );

      expect(result.status).toBe(200);
      expect(nameOf(cast.multiProjectMember)).toBe("bob");
      expect(world.userUpdates).toEqual([]);
      expect(createProjectSCIMLog).toHaveBeenCalledWith(
        expect.objectContaining({
          steps: expect.arrayContaining([
            expect.stringMatching(/Name change skipped/),
          ]),
        }),
      );
    });

    test("nor that of a pending invitee, or a master admin", async () => {
      for (const userId of [cast.pendingInvitee, cast.masterAdmin]) {
        const originalName: string = nameOf(userId);

        const result: HttpResult = await send(
          "PUT",
          scimPath(`Users/${userId}`),
          { userName: emailOf(userId), displayName: "Renamed" },
        );

        expect(result.status).toBe(200);
        expect(nameOf(userId)).toBe(originalName);
      }
    });

    test("an account this project manages is renamed", async () => {
      const result: HttpResult = await send(
        "PUT",
        scimPath(`Users/${cast.managedMember}`),
        {
          userName: "carol@acme.example",
          name: { givenName: "Carol", familyName: "Jones" },
        },
      );

      expect(result.status).toBe(200);
      expect(nameOf(cast.managedMember)).toBe("Carol Jones");
    });

    test("creating an existing account does not rename it either", async () => {
      const result: HttpResult = await send("POST", scimPath("Users"), {
        userName: "dave@example.com",
        name: { formatted: "Somebody Else" },
      });

      expectSuccess(result);
      expect(nameOf(cast.stranger)).toBe("Dave Original");
      expect(world.userUpdates).toEqual([]);
    });
  },
);

/*
 * ---------------------------------------------------------------------------
 * Issue 2: forced membership.
 * ---------------------------------------------------------------------------
 */

describe("on the hosted service, an existing account is invited, not added", () => {
  beforeEach(() => {
    setTestBillingEnabled(true);
  });

  test("creating a user who already exists makes pending memberships and asks for one invitation email", async () => {
    const result: HttpResult = await send("POST", scimPath("Users"), {
      userName: "dave@example.com",
    });

    expectSuccess(result);
    expect(result.body["id"]).toBe(cast.stranger);

    const rows: Array<FakeMembership> = membershipsOf(cast.stranger);
    expect(rows).toHaveLength(2);
    expect(
      rows.map((row: FakeMembership) => {
        return row.teamId;
      }),
    ).toEqual([DEFAULT_TEAM_A, DEFAULT_TEAM_B]);
    expect(
      rows.every((row: FakeMembership) => {
        return row.hasAcceptedInvitation === false;
      }),
    ).toBe(true);
    // One invitation into the project, not one per team.
    expect(invitationEmailsFor(cast.stranger)).toEqual(["dave@example.com"]);
    expect(createProjectSCIMLog).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: expect.arrayContaining([
          expect.stringMatching(/0 added as member, 2 invited/),
        ]),
      }),
    );
  });

  test("the same through a Bulk request", async () => {
    const result: HttpResult = await send("POST", scimPath("Bulk"), {
      schemas: [BULK_SCHEMA],
      Operations: [
        {
          method: "POST",
          bulkId: "u1",
          path: "/Users",
          data: { userName: "dave@example.com" },
        },
      ],
    });

    expect((result.body["Operations"] as Array<JSONObject>)[0]!["status"]).toBe(
      "201",
    );
    expect(membershipsOf(cast.stranger)).toHaveLength(2);
    expect(
      membershipsOf(cast.stranger).some((row: FakeMembership) => {
        return row.hasAcceptedInvitation;
      }),
    ).toBe(false);
  });

  test("with push groups on, the existing account's Unassigned membership is pending too", async () => {
    projectConfig.enablePushGroups = true;

    await send("POST", scimPath("Users"), { userName: "dave@example.com" });

    const rows: Array<FakeMembership> = membershipsOf(cast.stranger);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hasAcceptedInvitation).toBe(false);
    expect(
      world.teams.find((team: FakeTeam) => {
        return team.id === rows[0]!.teamId;
      })!.name,
    ).toBe("Unassigned");
    expect(invitationEmailsFor(cast.stranger)).toEqual(["dave@example.com"]);
  });

  test("an account SCIM creates is a member at once, and gets no invitation", async () => {
    const result: HttpResult = await send("POST", scimPath("Users"), {
      userName: "new.hire@acme.example",
    });

    const newUserId: string = result.body["id"] as string;
    const rows: Array<FakeMembership> = membershipsOf(newUserId);
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row: FakeMembership) => {
        return row.hasAcceptedInvitation;
      }),
    ).toBe(true);
    expect(invitationEmailsFor(newUserId)).toEqual([]);
  });

  test("so is one it creates while answering a userName filter", async () => {
    const result: HttpResult = await send(
      "GET",
      `${scimPath("Users")}?filter=${encodeURIComponent('userName eq "new.hire@acme.example"')}`,
    );

    expect(result.status).toBe(200);
    const newUser: FakeUser = world.users.find((user: FakeUser) => {
      return user.email === "new.hire@acme.example";
    })!;
    expect(
      membershipsOf(newUser.id).every((row: FakeMembership) => {
        return row.hasAcceptedInvitation;
      }),
    ).toBe(true);
    expect(membershipsOf(newUser.id)).toHaveLength(2);
  });

  test("a userName filter for an existing outsider adds nobody", async () => {
    const result: HttpResult = await send(
      "GET",
      `${scimPath("Users")}?filter=${encodeURIComponent('userName eq "dave@example.com"')}`,
    );

    expect(result.status).toBe(200);
    expect(result.body["totalResults"]).toBe(0);
    expect(membershipsOf(cast.stranger)).toEqual([]);
  });

  test("an account that has already joined the project is added to further teams as a member", async () => {
    await send("POST", scimPath("Users"), { userName: "carol@acme.example" });

    const addedRow: FakeMembership = membershipIn(
      cast.managedMember,
      DEFAULT_TEAM_B,
    )!;
    expect(addedRow.hasAcceptedInvitation).toBe(true);
    expect(invitationEmailsFor(cast.managedMember)).toEqual([]);
  });

  test("an account whose owner confirmed this project's SSO is added as a member", async () => {
    await send("POST", scimPath("Users"), { userName: "erin@example.com" });

    const rows: Array<FakeMembership> = membershipsOf(cast.ssoConsented);
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row: FakeMembership) => {
        return row.hasAcceptedInvitation;
      }),
    ).toBe(true);
  });

  test("SSO consent for ANOTHER project counts for nothing here", async () => {
    world.consents = [{ userId: cast.stranger, projectId: OTHER_PROJECT_ID }];

    await send("POST", scimPath("Users"), { userName: "dave@example.com" });

    expect(
      membershipsOf(cast.stranger).some((row: FakeMembership) => {
        return row.hasAcceptedInvitation;
      }),
    ).toBe(false);
  });

  test("re-activating a pending invitee does not accept for them, and does not mail them again", async () => {
    const result: HttpResult = await send(
      "PATCH",
      scimPath(`Users/${cast.pendingInvitee}`),
      patch({ op: "Replace", path: "active", value: true }),
    );

    expect(result.status).toBe(200);
    const rows: Array<FakeMembership> = membershipsOf(cast.pendingInvitee);
    expect(rows).toHaveLength(2);
    expect(
      rows.some((row: FakeMembership) => {
        return row.hasAcceptedInvitation;
      }),
    ).toBe(false);
    expect(invitationEmailsFor(cast.pendingInvitee)).toEqual([]);
  });

  test("re-activating through Bulk does not accept for them either", async () => {
    await sendBulkUserUpdate("PATCH", cast.pendingInvitee, {
      userName: "alice@globex.example",
      active: true,
    });

    expect(
      membershipsOf(cast.pendingInvitee).some((row: FakeMembership) => {
        return row.hasAcceptedInvitation;
      }),
    ).toBe(false);
  });

  describe("group membership", () => {
    const groupAdds: Array<{
      label: string;
      run: (userId: string) => Promise<HttpResult>;
    }> = [
      {
        label: "POST /Groups naming an existing group",
        run: (userId: string): Promise<HttpResult> => {
          return send("POST", scimPath("Groups"), {
            displayName: "Engineering",
            members: [member(userId)],
          });
        },
      },
      {
        label: "PATCH /Groups add",
        run: (userId: string): Promise<HttpResult> => {
          return send(
            "PATCH",
            scimPath(`Groups/${GROUP_TEAM}`),
            patch({ op: "add", path: "members", value: [member(userId)] }),
          );
        },
      },
      {
        label: "PATCH /Groups replace",
        run: (userId: string): Promise<HttpResult> => {
          return send(
            "PATCH",
            scimPath(`Groups/${GROUP_TEAM}`),
            patch({
              op: "replace",
              path: "members",
              value: [member(userId)],
            }),
          );
        },
      },
      {
        label: "PUT /Groups",
        run: (userId: string): Promise<HttpResult> => {
          return send("PUT", scimPath(`Groups/${GROUP_TEAM}`), {
            displayName: "Engineering",
            members: [member(userId)],
          });
        },
      },
      {
        label: "Bulk POST /Groups",
        run: (userId: string): Promise<HttpResult> => {
          return send("POST", scimPath("Bulk"), {
            schemas: [BULK_SCHEMA],
            Operations: [
              {
                method: "POST",
                path: "/Groups",
                data: { displayName: "Engineering", members: [member(userId)] },
              },
            ],
          });
        },
      },
      {
        label: "Bulk PUT /Groups",
        run: (userId: string): Promise<HttpResult> => {
          return send("POST", scimPath("Bulk"), {
            schemas: [BULK_SCHEMA],
            Operations: [
              {
                method: "PUT",
                path: `/Groups/${GROUP_TEAM}`,
                data: { members: [member(userId)] },
              },
            ],
          });
        },
      },
      {
        label: "Bulk PATCH /Groups add",
        run: (userId: string): Promise<HttpResult> => {
          return send("POST", scimPath("Bulk"), {
            schemas: [BULK_SCHEMA],
            Operations: [
              {
                method: "PATCH",
                path: `/Groups/${GROUP_TEAM}`,
                data: {
                  Operations: [
                    { op: "add", path: "members", value: [member(userId)] },
                  ],
                },
              },
            ],
          });
        },
      },
      {
        label: "Bulk PATCH /Groups replace",
        run: (userId: string): Promise<HttpResult> => {
          return send("POST", scimPath("Bulk"), {
            schemas: [BULK_SCHEMA],
            Operations: [
              {
                method: "PATCH",
                path: `/Groups/${GROUP_TEAM}`,
                data: {
                  Operations: [
                    {
                      op: "replace",
                      path: "members",
                      value: [member(userId)],
                    },
                  ],
                },
              },
            ],
          });
        },
      },
    ];

    // The adds that replace the team's members rather than add to them.
    const REPLACES_THE_TEAM: RegExp = /replace|PUT/;

    test.each(groupAdds)(
      "$label: an outsider named by bare user id is invited, with one invitation email",
      async ({ run }: { run: (userId: string) => Promise<HttpResult> }) => {
        const result: HttpResult = await run(cast.stranger);

        expectSuccess(result);
        const row: FakeMembership = membershipIn(cast.stranger, GROUP_TEAM)!;
        expect(row).toBeDefined();
        expect(row.hasAcceptedInvitation).toBe(false);
        expect(invitationEmailsFor(cast.stranger)).toEqual([
          "dave@example.com",
        ]);
      },
    );

    test.each(groupAdds)(
      "$label: another customer's user, pending here, stays pending and is not mailed again",
      async ({ run }: { run: (userId: string) => Promise<HttpResult> }) => {
        await run(cast.pendingInvitee);

        expect(membershipIn(cast.pendingInvitee, GROUP_TEAM)).toMatchObject({
          hasAcceptedInvitation: false,
        });
        expect(invitationEmailsFor(cast.pendingInvitee)).toEqual([]);
      },
    );

    test.each(groupAdds)(
      "$label: a member of the project is added as a member",
      async ({ run }: { run: (userId: string) => Promise<HttpResult> }) => {
        await run(cast.managedMember);

        expect(membershipIn(cast.managedMember, GROUP_TEAM)).toMatchObject({
          hasAcceptedInvitation: true,
        });
      },
    );

    test.each(
      groupAdds.filter((add: { label: string }) => {
        return REPLACES_THE_TEAM.test(add.label);
      }),
    )(
      "$label: a member whose only team is this one keeps her row, and stays a member",
      async ({ run }: { run: (userId: string) => Promise<HttpResult> }) => {
        const newcomer: string = seedUser({ email: "frank@acme.example" });
        const rowId: string = seedMembership({
          userId: newcomer,
          projectId: PROJECT_ID,
          teamId: GROUP_TEAM,
          accepted: true,
        });

        await run(newcomer);

        expect(membershipsOf(newcomer)).toHaveLength(1);
        expect(membershipIn(newcomer, GROUP_TEAM)).toMatchObject({
          id: rowId,
          hasAcceptedInvitation: true,
        });
        expect(deletedRowsOf(newcomer)).toEqual([]);
        expect(invitationEmailsFor(newcomer)).toEqual([]);
      },
    );

    test.each(
      groupAdds.filter((add: { label: string }) => {
        return REPLACES_THE_TEAM.test(add.label);
      }),
    )(
      "$label: an invitee whose only row is this team's keeps it, stays invited, and is not mailed again",
      async ({ run }: { run: (userId: string) => Promise<HttpResult> }) => {
        const invitee: string = seedUser({ email: "grace@example.com" });
        const rowId: string = seedMembership({
          userId: invitee,
          projectId: PROJECT_ID,
          teamId: GROUP_TEAM,
          accepted: false,
        });

        await run(invitee);

        expect(membershipIn(invitee, GROUP_TEAM)).toMatchObject({
          id: rowId,
          hasAcceptedInvitation: false,
        });
        expect(deletedRowsOf(invitee)).toEqual([]);
        expect(invitationEmailsFor(invitee)).toEqual([]);
      },
    );

    test("the member id may come back in upper case and still match its row", async () => {
      const newcomer: string = seedUser({ email: "heidi@acme.example" });
      const rowId: string = seedMembership({
        userId: newcomer,
        projectId: PROJECT_ID,
        teamId: GROUP_TEAM,
        accepted: true,
      });

      await send("PUT", scimPath(`Groups/${GROUP_TEAM}`), {
        displayName: "Engineering",
        members: [member(newcomer.toUpperCase())],
      });

      expect(membershipIn(newcomer, GROUP_TEAM)).toMatchObject({
        id: rowId,
        hasAcceptedInvitation: true,
      });
      expect(deletedRowsOf(newcomer)).toEqual([]);
    });

    test("an invitee added to a second group is not mailed a second time", async () => {
      await send(
        "PATCH",
        scimPath(`Groups/${GROUP_TEAM}`),
        patch({ op: "add", path: "members", value: [member(cast.stranger)] }),
      );
      await send(
        "PATCH",
        scimPath(`Groups/${DEFAULT_TEAM_B}`),
        patch({ op: "add", path: "members", value: [member(cast.stranger)] }),
      );

      expect(membershipsOf(cast.stranger)).toHaveLength(2);
      expect(invitationEmailsFor(cast.stranger)).toEqual(["dave@example.com"]);
    });

    test("an id that is no account at all is skipped", async () => {
      const nobody: string = idOf(ObjectID.generate());

      const result: HttpResult = await send(
        "PATCH",
        scimPath(`Groups/${GROUP_TEAM}`),
        patch({ op: "add", path: "members", value: [member(nobody)] }),
      );

      expect(result.status).toBe(200);
      expect(membershipsOf(nobody)).toEqual([]);
    });

    test("the group log reports how many of the adds were only invitations", async () => {
      await send(
        "PATCH",
        scimPath(`Groups/${GROUP_TEAM}`),
        patch({
          op: "add",
          path: "members",
          value: [member(cast.stranger), member(cast.managedMember)],
        }),
      );

      expect(createProjectSCIMLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: "UpdateGroup",
          groupInfo: expect.objectContaining({
            membersAdded: 2,
            membersInvited: 1,
          }),
        }),
      );
    });
  });
});

describe("on a self-hosted install, SCIM keeps adding existing accounts as members", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test("creating a user who already exists adds them to the default teams, accepted", async () => {
    await send("POST", scimPath("Users"), { userName: "dave@example.com" });

    const rows: Array<FakeMembership> = membershipsOf(cast.stranger);
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row: FakeMembership) => {
        return row.hasAcceptedInvitation;
      }),
    ).toBe(true);
    expect(invitationEmailsFor(cast.stranger)).toEqual([]);
  });

  test("a group add of an existing account is accepted", async () => {
    await send(
      "PATCH",
      scimPath(`Groups/${GROUP_TEAM}`),
      patch({ op: "add", path: "members", value: [member(cast.stranger)] }),
    );

    expect(membershipIn(cast.stranger, GROUP_TEAM)).toMatchObject({
      hasAcceptedInvitation: true,
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * A GROUP REPLACE WRITES ONLY THE DIFFERENCE.
 *
 * A PUT of a group, or a PATCH "replace" of its members, used to delete every
 * row of the team and re-add the list. Each deleted row runs
 * TeamMemberService's leave cleanups, so a listed member whose only team in
 * the project was this one lost their on-call assignments, incident roles and
 * owner rows, workspace links and notification settings -- and Okta's group
 * push sends a PUT with every membership change. A member the replace lists
 * again must keep their row, and no delete may match it.
 * ---------------------------------------------------------------------------
 */

interface GroupReplace {
  label: string;
  run: (userIds: Array<string>) => Promise<HttpResult>;
}

function members(userIds: Array<string>): Array<JSONObject> {
  return userIds.map((userId: string): JSONObject => {
    return member(userId);
  });
}

const groupReplaces: Array<GroupReplace> = [
  {
    label: "PUT /Groups",
    run: (userIds: Array<string>): Promise<HttpResult> => {
      return send("PUT", scimPath(`Groups/${GROUP_TEAM}`), {
        displayName: "Engineering",
        members: members(userIds),
      });
    },
  },
  {
    label: "PATCH /Groups replace",
    run: (userIds: Array<string>): Promise<HttpResult> => {
      return send(
        "PATCH",
        scimPath(`Groups/${GROUP_TEAM}`),
        patch({ op: "replace", path: "members", value: members(userIds) }),
      );
    },
  },
  {
    label: "Bulk PUT /Groups",
    run: (userIds: Array<string>): Promise<HttpResult> => {
      return send("POST", scimPath("Bulk"), {
        schemas: [BULK_SCHEMA],
        Operations: [
          {
            method: "PUT",
            path: `/Groups/${GROUP_TEAM}`,
            data: { displayName: "Engineering", members: members(userIds) },
          },
        ],
      });
    },
  },
  {
    label: "Bulk PATCH /Groups replace",
    run: (userIds: Array<string>): Promise<HttpResult> => {
      return send("POST", scimPath("Bulk"), {
        schemas: [BULK_SCHEMA],
        Operations: [
          {
            method: "PATCH",
            path: `/Groups/${GROUP_TEAM}`,
            data: {
              Operations: [
                { op: "replace", path: "members", value: members(userIds) },
              ],
            },
          },
        ],
      });
    },
  },
];

// A Bulk request answers 200 whatever its operations did; each says for itself.
function expectReplaceSucceeded(result: HttpResult): void {
  expectSuccess(result);

  for (const operation of (result.body["Operations"] as
    | Array<JSONObject>
    | undefined) || []) {
    expect(operation["status"]).toBe("200");
  }
}

function rowsIn(teamId: string): Array<FakeMembership> {
  return world.memberships.filter((row: FakeMembership) => {
    return row.teamId === teamId;
  });
}

describe.each([
  { hosting: "on the hosted service", billingEnabled: true },
  { hosting: "on a self-hosted install", billingEnabled: false },
])(
  "$hosting, a group replace writes only the difference",
  ({ billingEnabled }: { billingEnabled: boolean }) => {
    // The team as the IdP last pushed it.
    let keptMember: string;
    let keptMemberRow: string;
    let keptInvitee: string;
    let keptInviteeRow: string;
    let leaver: string;
    let leaverRow: string;

    beforeEach(() => {
      setTestBillingEnabled(billingEnabled);

      keptMember = seedUser({ email: "ivan@acme.example" });
      keptMemberRow = seedMembership({
        userId: keptMember,
        projectId: PROJECT_ID,
        teamId: GROUP_TEAM,
        accepted: true,
      });

      keptInvitee = seedUser({ email: "judy@example.com" });
      keptInviteeRow = seedMembership({
        userId: keptInvitee,
        projectId: PROJECT_ID,
        teamId: GROUP_TEAM,
        accepted: false,
      });

      leaver = seedUser({ email: "mallory@acme.example" });
      leaverRow = seedMembership({
        userId: leaver,
        projectId: PROJECT_ID,
        teamId: GROUP_TEAM,
        accepted: true,
      });
    });

    test.each(groupReplaces)(
      "$label: members listed again keep their rows, accepted or pending, and no delete matches them",
      async ({ run }: GroupReplace) => {
        expectReplaceSucceeded(await run([keptMember, keptInvitee]));

        expect(membershipIn(keptMember, GROUP_TEAM)).toMatchObject({
          id: keptMemberRow,
          hasAcceptedInvitation: true,
        });
        expect(membershipIn(keptInvitee, GROUP_TEAM)).toMatchObject({
          id: keptInviteeRow,
          hasAcceptedInvitation: false,
        });
        expect(deletedRowsOf(keptMember)).toEqual([]);
        expect(deletedRowsOf(keptInvitee)).toEqual([]);
        expect(invitationEmailsFor(keptMember)).toEqual([]);
        expect(invitationEmailsFor(keptInvitee)).toEqual([]);
      },
    );

    test.each(groupReplaces)(
      "$label: only the row of a member the list leaves out is deleted",
      async ({ run }: GroupReplace) => {
        expectReplaceSucceeded(await run([keptMember, keptInvitee]));

        expect(membershipIn(leaver, GROUP_TEAM)).toBeUndefined();
        expect(
          world.deletedMemberships.map((row: FakeMembership) => {
            return row.id;
          }),
        ).toEqual([leaverRow]);
      },
    );

    test.each(groupReplaces)(
      "$label: an account the team lacks is added through the account policy, and only that one",
      async ({ run }: GroupReplace) => {
        const addSpy: jest.SpiedFunction<
          typeof ProjectSCIMAccountPolicy.addUserToTeam
        > = jest.spyOn(ProjectSCIMAccountPolicy, "addUserToTeam");

        try {
          expectReplaceSucceeded(
            await run([keptMember, keptInvitee, cast.stranger]),
          );

          expect(
            addSpy.mock.calls.map(
              (
                call: Parameters<typeof ProjectSCIMAccountPolicy.addUserToTeam>,
              ) => {
                return idOf(call[0].userId);
              },
            ),
          ).toEqual([cast.stranger]);
        } finally {
          addSpy.mockRestore();
        }

        // Invited on the hosted service, accepted on a self-hosted install.
        expect(membershipIn(cast.stranger, GROUP_TEAM)).toMatchObject({
          hasAcceptedInvitation: !billingEnabled,
        });
        expect(invitationEmailsFor(cast.stranger)).toEqual(
          billingEnabled ? ["dave@example.com"] : [],
        );
        expect(
          world.deletedMemberships.map((row: FakeMembership) => {
            return row.id;
          }),
        ).toEqual([leaverRow]);
      },
    );

    test.each(groupReplaces)(
      "$label: re-sending the team as it is deletes and creates nothing",
      async ({ run }: GroupReplace) => {
        const before: Array<FakeMembership> = snapshotMemberships();

        expectReplaceSucceeded(await run([keptMember, keptInvitee, leaver]));

        expect(world.memberships).toEqual(before);
        expect(world.deletedMemberships).toEqual([]);
      },
    );

    test.each(groupReplaces)(
      "$label: an id listed twice, in either case, is one kept member",
      async ({ run }: GroupReplace) => {
        expectReplaceSucceeded(
          await run([keptMember, keptMember.toUpperCase(), keptInvitee]),
        );

        expect(rowsIn(GROUP_TEAM)).toHaveLength(2);
        expect(membershipIn(keptMember, GROUP_TEAM)).toMatchObject({
          id: keptMemberRow,
        });
        expect(deletedRowsOf(keptMember)).toEqual([]);
      },
    );

    test.each(groupReplaces)(
      "$label: an empty list still removes every member",
      async ({ run }: GroupReplace) => {
        expectReplaceSucceeded(await run([]));

        expect(rowsIn(GROUP_TEAM)).toEqual([]);
        expect(
          world.deletedMemberships
            .map((row: FakeMembership) => {
              return row.id;
            })
            .sort(),
        ).toEqual([keptMemberRow, keptInviteeRow, leaverRow].sort());
      },
    );

    test.each(groupReplaces)(
      "$label: a kept member still leaves the Unassigned team, as a re-add used to take them out of it",
      async ({ run }: GroupReplace) => {
        const unassignedTeam: string = idOf(ObjectID.generate());
        seedTeam(unassignedTeam, PROJECT_ID, "Unassigned");
        const unassignedRow: string = seedMembership({
          userId: keptMember,
          projectId: PROJECT_ID,
          teamId: unassignedTeam,
          accepted: true,
        });

        expectReplaceSucceeded(await run([keptMember, keptInvitee]));

        expect(membershipIn(keptMember, unassignedTeam)).toBeUndefined();
        expect(membershipIn(keptMember, GROUP_TEAM)).toMatchObject({
          id: keptMemberRow,
        });
        expect(
          deletedRowsOf(keptMember).map((row: FakeMembership) => {
            return row.id;
          }),
        ).toEqual([unassignedRow]);
      },
    );
  },
);

test("a replace of the Unassigned team's own members keeps the rows it lists", async () => {
  setTestBillingEnabled(true);

  const unassignedTeam: string = idOf(ObjectID.generate());
  seedTeam(unassignedTeam, PROJECT_ID, "Unassigned");
  const rowId: string = seedMembership({
    userId: cast.managedMember,
    projectId: PROJECT_ID,
    teamId: unassignedTeam,
    accepted: true,
  });

  expectReplaceSucceeded(
    await send("PUT", scimPath(`Groups/${unassignedTeam}`), {
      displayName: "Unassigned",
      members: [member(cast.managedMember)],
    }),
  );

  expect(membershipIn(cast.managedMember, unassignedTeam)).toMatchObject({
    id: rowId,
  });
  expect(deletedRowsOf(cast.managedMember)).toEqual([]);
});

test("the group log says how many members a replace kept and removed", async () => {
  setTestBillingEnabled(true);
  const kept: string = seedUser({ email: "niaj@acme.example" });
  seedMembership({
    userId: kept,
    projectId: PROJECT_ID,
    teamId: GROUP_TEAM,
    accepted: true,
  });
  const leaver: string = seedUser({ email: "olivia@acme.example" });
  seedMembership({
    userId: leaver,
    projectId: PROJECT_ID,
    teamId: GROUP_TEAM,
    accepted: true,
  });

  await send("PUT", scimPath(`Groups/${GROUP_TEAM}`), {
    displayName: "Engineering",
    members: [member(kept), member(cast.stranger)],
  });

  expect(createProjectSCIMLog).toHaveBeenCalledWith(
    expect.objectContaining({
      operationType: "UpdateGroup",
      groupInfo: expect.objectContaining({
        membersKept: 1,
        membersRemoved: 1,
        membersAdded: 1,
        membersInvited: 1,
      }),
    }),
  );
});

/*
 * ---------------------------------------------------------------------------
 * The policy's own small pieces.
 * ---------------------------------------------------------------------------
 */

describe("ProjectSCIMAccountPolicy", () => {
  function row(accepted: boolean): TeamMember {
    const membership: TeamMember = new TeamMember();
    membership.hasAcceptedInvitation = accepted;
    return membership;
  }

  test("standing: any accepted row makes a member; only pending rows, an invitee; none, a stranger", () => {
    expect(
      ProjectSCIMAccountPolicy.getStandingFromMemberships([
        row(false),
        row(true),
      ]),
    ).toBe(ProjectSCIMAccountStanding.Member);
    expect(
      ProjectSCIMAccountPolicy.getStandingFromMemberships([
        row(false),
        row(false),
      ]),
    ).toBe(ProjectSCIMAccountStanding.Invited);
    expect(ProjectSCIMAccountPolicy.getStandingFromMemberships([])).toBe(
      ProjectSCIMAccountStanding.None,
    );
  });

  test("an email is changing only when the stored address would differ", () => {
    expect(
      ProjectSCIMAccountPolicy.isEmailChanging({
        currentEmail: "a@example.com",
        newEmail: " A@Example.com ",
      }),
    ).toBe(false);
    expect(
      ProjectSCIMAccountPolicy.isEmailChanging({
        currentEmail: "a@example.com",
        newEmail: "b@example.com",
      }),
    ).toBe(true);
    // An address the caller could not read is treated as a change.
    expect(
      ProjectSCIMAccountPolicy.isEmailChanging({
        currentEmail: undefined,
        newEmail: "a@example.com",
      }),
    ).toBe(true);
  });

  test("the hosted switch is read live, never cached", () => {
    setTestBillingEnabled(true);
    expect(ProjectSCIMAccountPolicy.isHostedService()).toBe(true);
    setTestBillingEnabled(false);
    expect(ProjectSCIMAccountPolicy.isHostedService()).toBe(false);
  });

  test("an account that does not exist is not one this project manages", async () => {
    expect(
      await ProjectSCIMAccountPolicy.isAccountManagedByProject({
        projectId: new ObjectID(PROJECT_ID),
        userId: ObjectID.generate(),
      }),
    ).toBe(false);
  });
});
