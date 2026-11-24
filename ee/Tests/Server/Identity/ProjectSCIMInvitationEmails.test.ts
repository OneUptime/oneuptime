import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import ProjectSCIMRouter from "../../../Server/Identity/API/SCIM";
import { fakeProjectSCIMUserService } from "./FakeProjectSCIMUserService";
import {
  fakeTeamMemberService,
  idOf,
  scimWorld,
  WorldMembership,
} from "./InMemorySCIMWorld";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import Redis from "Common/Server/Infrastructure/Redis";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import MailService from "Common/Server/Services/MailService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService, {
  TeamMemberService as TeamMemberServiceClass,
} from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import DeleteBy from "Common/Server/Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "Common/Server/Types/Database/Hooks";
import ProductAnalytics from "Common/Server/Utils/ProductAnalytics";
import PublicMessageRateLimit, {
  TeamMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import { stubProjectDirectory } from "Common/Tests/Server/TestingUtils/ProjectDirectory";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * ---------------------------------------------------------------------------
 * SCIM'S INVITATIONS, THROUGH THE REAL INVITATION PATH (#10179, #10180).
 *
 * The SCIM suites stand in for TeamMemberService. This one does not: the
 * SCIM router runs over HTTP, and every membership it creates or deletes
 * goes through TeamMemberService's own hooks - onBeforeCreate, the INSERT,
 * onCreateSuccess, onDeleteSuccess - with the memberships, accounts and
 * teams in memory (InMemorySCIMWorld), and the invitation limits and the
 * project's invitation email window counted for real, on a stand-in for
 * Valkey.
 *
 *   - An identity provider that creates a user, deletes or deactivates them
 *     and creates them again - Okta's create and DELETE, Microsoft Entra
 *     ID's create, "active" False and True - invites them every time, and
 *     emails them once an hour (InvitationEmailWindow): not every create.
 *   - Its answers and what the project reads are the same whether or not
 *     the address had an account, and so is what TeamMemberService does
 *     before the SCIM answer: an account nobody has claimed (an earlier
 *     invitation made it) gets its registration token after the answer,
 *     like the email, not in the request (#10180).
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

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
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

jest.mock("Common/Server/Services/ProjectSCIMUserService", () => {
  const fake: typeof import("./FakeProjectSCIMUserService") =
    jest.requireActual(
      "./FakeProjectSCIMUserService",
    ) as typeof import("./FakeProjectSCIMUserService");

  return { __esModule: true, default: fake.fakeProjectSCIMUserService };
});

jest.mock("Common/Server/Services/UserService", () => {
  const world: typeof import("./InMemorySCIMWorld") = jest.requireActual(
    "./InMemorySCIMWorld",
  ) as typeof import("./InMemorySCIMWorld");

  return { __esModule: true, default: world.fakeUserService };
});

jest.mock("Common/Server/Services/TeamService", () => {
  const world: typeof import("./InMemorySCIMWorld") = jest.requireActual(
    "./InMemorySCIMWorld",
  ) as typeof import("./InMemorySCIMWorld");

  return { __esModule: true, default: world.fakeTeamService };
});

jest.mock("Common/Server/Services/UserProjectSsoConsentService", () => {
  const world: typeof import("./InMemorySCIMWorld") = jest.requireActual(
    "./InMemorySCIMWorld",
  ) as typeof import("./InMemorySCIMWorld");

  return { __esModule: true, default: world.fakeUserProjectSsoConsentService };
});

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: string = "10179ccc-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "10179ccc-2222-4222-8222-222222222222";
const SCIM_ID: string = "10179ccc-3333-4333-8333-333333333333";

const USER_SCHEMA: string = "urn:ietf:params:scim:schemas:core:2.0:User";
const ENTERPRISE_SCHEMA: string =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const PATCH_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

const ADDRESS: string = "sam.rivera@acme.example";

// The mark where a SCIM request answers, in scimWorld.calls.
const ANSWERED: string = "-- the SCIM request answers --";

const HOUR_IN_MS: number = 60 * 60 * 1000;

// Okta's create (its SCIM 2.0 guide and spec test).
function oktaCreate(): JSONObject {
  return {
    schemas: [USER_SCHEMA],
    userName: ADDRESS,
    name: { givenName: "Sam", familyName: "Rivera" },
    emails: [{ primary: true, value: ADDRESS, type: "work" }],
    displayName: "Sam Rivera",
    locale: "en-US",
    externalId: "00ujl29u0le5T6Aj10h7",
    groups: [],
    password: "1mz050nq",
    active: true,
  };
}

// Microsoft Entra ID's create, with its default attribute mappings.
function entraCreate(): JSONObject {
  return {
    schemas: [USER_SCHEMA, ENTERPRISE_SCHEMA],
    externalId: "4b1c6a2e-0f3d-4c8b-9a7e-2d5f1e6c3b90",
    userName: ADDRESS,
    active: true,
    displayName: "Sam Rivera",
    emails: [{ primary: true, type: "work", value: ADDRESS }],
    meta: { resourceType: "User" },
    name: { formatted: "Sam Rivera", familyName: "Rivera", givenName: "Sam" },
    roles: [],
  };
}

// Entra ID turning a user off or on: "active" as the text "False" or "True".
function entraActive(value: "False" | "True"): JSONObject {
  return {
    schemas: [PATCH_SCHEMA],
    Operations: [{ op: "Replace", path: "active", value: value }],
  };
}

interface HttpResult {
  status: number;
  body: JSONObject;
}

enum AddressHistory {
  // Nobody has the address: SCIM creates the account.
  NoAccount = "an address with no account",
  // An account in another project, its person signed up.
  SignedUpElsewhere = "an account in another project that has signed up",
  // An account another project's invitation made, nobody has claimed.
  UnclaimedElsewhere = "an account another project invited, nobody has claimed",
}

let httpServer: Server;
let baseUrl: string;
let projectConfig: ProjectSCIM;
let redis: FakeCounterRedis;
let now: number;
let mails: Array<EmailMessage>;
let tokensMinted: Array<EmailVerificationToken>;

function seedWorld(history: AddressHistory): void {
  scimWorld.reset();
  fakeProjectSCIMUserService.reset();
  redis.reset();
  mails = [];
  tokensMinted = [];

  const membersTeamId: string = scimWorld.seedTeam({
    projectId: PROJECT_ID,
    name: "Members",
  });
  const otherTeamId: string = scimWorld.seedTeam({
    projectId: OTHER_PROJECT_ID,
    name: "Globex Owners",
  });

  if (history !== AddressHistory.NoAccount) {
    const owner: string = scimWorld.seedUser({
      email: ADDRESS,
      name: null,
      hasPassword: history === AddressHistory.SignedUpElsewhere,
    });
    scimWorld.seedMembership({
      userId: owner,
      projectId: OTHER_PROJECT_ID,
      teamId: otherTeamId,
      accepted: history === AddressHistory.SignedUpElsewhere,
    });
  }

  projectConfig = new ProjectSCIM(new ObjectID(SCIM_ID));
  projectConfig.projectId = new ObjectID(PROJECT_ID);
  projectConfig.autoProvisionUsers = true;
  projectConfig.autoDeprovisionUsers = true;
  projectConfig.enablePushGroups = false;
  const team: Team = new Team(new ObjectID(membersTeamId));
  team.name = "Members";
  projectConfig.teams = [team];
}

async function send(
  method: string,
  path: string,
  body?: JSONObject,
): Promise<HttpResult> {
  const response: globalThis.Response = await fetch(
    `${baseUrl}/scim/v2/${SCIM_ID}${path}`,
    {
      method,
      headers: { "Content-Type": "application/scim+json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const text: string = await response.text();

  // What the request started after its answer: its invitation's email.
  await TeamMemberService.whenInvitationsSent();

  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as JSONObject,
  };
}

function invitationEmails(): Array<EmailMessage> {
  return mails.filter((mail: EmailMessage): boolean => {
    return mail.templateType === EmailTemplateType.InviteMember;
  });
}

function projectCount(): number {
  return redis.count(
    PublicMessageRateLimit.getProjectContactCounterKey({
      counterName: TeamMessageKind.Invitation,
      projectId: new ObjectID(PROJECT_ID),
      contact: PublicMessageRateLimit.forEmail(ADDRESS),
    }),
  );
}

function pendingInProject(): Array<WorldMembership> {
  return scimWorld.memberships.filter((row: WorldMembership): boolean => {
    return row.projectId === idOf(PROJECT_ID) && !row.hasAcceptedInvitation;
  });
}

beforeAll(async () => {
  installFakeEnterpriseModule({
    snapshot: createLicenseSnapshotWithStatus("valid"),
  });

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson({ type: ["application/json", "application/scim+json"] }));
  app.use(
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
      (req as OneUptimeRequest).bearerTokenData = {
        projectId: new ObjectID(PROJECT_ID),
        scimConfig: projectConfig,
      };

      // Marks, among the calls, where the request answers.
      const end: (...args: Array<unknown>) => unknown = res.end.bind(res) as (
        ...args: Array<unknown>
      ) => unknown;
      (res as unknown as { end: (...args: Array<unknown>) => unknown }).end = (
        ...args: Array<unknown>
      ): unknown => {
        scimWorld.calls.push(ANSWERED);
        return end(...args);
      };

      next();
    },
  );
  app.use(ProjectSCIMRouter);
  httpServer = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  uninstallEnterpriseModule();
  await new Promise<void>((resolve: () => void) => {
    httpServer.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  setTestBillingEnabled(true);
  stubProjectDirectory({});

  redis = new FakeCounterRedis();
  (Redis.getClient as unknown as MockedFn).mockReturnValue(redis);
  (Redis.isConnected as unknown as MockedFn).mockReturnValue(true);

  now = Date.UTC(2037, 0, 1, 9, 0, 0);
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  // The real TeamMemberService, its rows in memory.
  const service: Record<string, unknown> =
    TeamMemberService as unknown as Record<string, unknown>;

  for (const method of ["findBy", "findOneBy", "countBy", "updateBy"]) {
    jest.spyOn(service as never, method as never).mockImplementation((async (
      args: unknown,
    ) => {
      if (method === "countBy") {
        const rows: Array<TeamMember> = (await (
          fakeTeamMemberService["findBy"] as (
            a: unknown,
          ) => Promise<Array<TeamMember>>
        )(args)) as Array<TeamMember>;
        const { default: PositiveNumber } = (await import(
          "Common/Types/PositiveNumber"
        )) as { default: new (n: number) => unknown };
        return new PositiveNumber(rows.length);
      }

      return await (
        fakeTeamMemberService[method] as (a: unknown) => Promise<unknown>
      )(args);
    }) as never);
  }

  // A create runs the service's own hooks around the INSERT, as DatabaseService does.
  jest
    .spyOn(TeamMemberService, "create")
    .mockImplementation(async (createBy: CreateBy<TeamMember>) => {
      const hooks: {
        onBeforeCreate: (
          c: CreateBy<TeamMember>,
        ) => Promise<OnCreate<TeamMember>>;
        onCreateSuccess: (
          o: OnCreate<TeamMember>,
          row: TeamMember,
        ) => Promise<TeamMember>;
        onCreateError: (
          e: Exception,
          o?: OnCreate<TeamMember>,
        ) => Promise<Exception>;
      } = TeamMemberService as unknown as {
        onBeforeCreate: (
          c: CreateBy<TeamMember>,
        ) => Promise<OnCreate<TeamMember>>;
        onCreateSuccess: (
          o: OnCreate<TeamMember>,
          row: TeamMember,
        ) => Promise<TeamMember>;
        onCreateError: (
          e: Exception,
          o?: OnCreate<TeamMember>,
        ) => Promise<Exception>;
      };

      let onCreate: OnCreate<TeamMember> | undefined = undefined;

      try {
        onCreate = await hooks.onBeforeCreate(createBy);

        const row: TeamMember = (await (
          fakeTeamMemberService["create"] as (a: unknown) => Promise<TeamMember>
        )({ data: onCreate.createBy.data })) as TeamMember;

        return await hooks.onCreateSuccess(onCreate, row);
      } catch (error) {
        await hooks.onCreateError(error as Exception, onCreate);
        throw error;
      }
    });

  // A delete removes the rows and runs the service's own onDeleteSuccess.
  jest
    .spyOn(TeamMemberService, "deleteBy")
    .mockImplementation(async (deleteBy: DeleteBy<TeamMember>) => {
      const removed: Array<TeamMember> = (await (
        fakeTeamMemberService["findBy"] as (
          a: unknown,
        ) => Promise<Array<TeamMember>>
      )({ query: deleteBy.query })) as Array<TeamMember>;

      await (
        fakeTeamMemberService["deleteBy"] as (a: unknown) => Promise<number>
      )({ query: deleteBy.query });

      await (
        TeamMemberService as unknown as {
          onDeleteSuccess: (
            d: OnDelete<TeamMember>,
            ids: Array<ObjectID>,
          ) => Promise<OnDelete<TeamMember>>;
        }
      ).onDeleteSuccess({ deleteBy: deleteBy, carryForward: removed }, [
        ...removed.map((row: TeamMember): ObjectID => {
          return row.id!;
        }),
      ]);

      return removed.length;
    });

  // What the rest of a create and a removal do.
  for (const method of [
    "acceptPendingInvitationsInProject",
    "refreshTokens",
    "syncSubscriptionSeatsAfterMembershipChange",
    "addDefaultNotificationSettingsAndRules",
    "followUpWaitingPublicNotes",
    "noteSecondMemberJoined",
    "endOnCallTimeLogsOfRemovedMembers",
    "removeProjectAccessIfUserLeftProject",
    "cleanupOnCallAssignmentsIfUserLeftProject",
    "cleanupResourceAssignmentsIfUserLeftProject",
    "removeWorkspaceAccountLinksIfUserLeftProject",
    "removePersonalNotificationSettingsIfUserLeftProject",
    "readPeopleLimits",
  ]) {
    jest
      .spyOn(service as never, method as never)
      .mockImplementation((async () => {
        return method === "readPeopleLimits" ? null : 0;
      }) as never);
  }

  jest
    .spyOn(
      UserNotificationSettingService,
      "removeDefaultNotificationSettingsForUser",
    )
    .mockResolvedValue(undefined as never);
  jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);

  // What the invitation email is made of, after the answer.
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ name: "Acme Production" } as Project);
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest
    .spyOn(TeamMemberServiceClass, "readInvitationSsoManagedBy")
    .mockResolvedValue(null);
  jest
    .spyOn(EmailVerificationTokenService, "create")
    .mockImplementation(async (args: unknown) => {
      const token: EmailVerificationToken = (
        args as { data: EmailVerificationToken }
      ).data;
      scimWorld.calls.push("EmailVerificationTokenService.create");
      tokensMinted.push(token);
      return token;
    });
  jest
    .spyOn(MailService, "sendMail")
    .mockImplementation(async (mail: unknown) => {
      scimWorld.calls.push("MailService.sendMail");
      mails.push(mail as EmailMessage);
      return undefined as never;
    });
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

/*
 * Okta: a create, then a DELETE when the user is unassigned, then a create
 * when they are assigned again - every few minutes, as a misconfigured
 * assignment rule or a retrying script would.
 */
async function oktaLoop(rounds: number): Promise<Array<HttpResult>> {
  const results: Array<HttpResult> = [];

  for (let round: number = 0; round < rounds; round++) {
    const created: HttpResult = await send("POST", "/Users", oktaCreate());
    results.push(created);
    results.push(await send("DELETE", `/Users/${created.body["id"]}`));
    now += 4 * 60 * 1000;
  }

  return results;
}

/*
 * Microsoft Entra ID: a create, then "active" False when the user is out of
 * scope, then "active" True when they are back in.
 */
async function entraLoop(rounds: number): Promise<Array<HttpResult>> {
  const results: Array<HttpResult> = [];
  const created: HttpResult = await send("POST", "/Users", entraCreate());
  results.push(created);

  for (let round: number = 0; round < rounds; round++) {
    results.push(
      await send("PATCH", `/Users/${created.body["id"]}`, entraActive("False")),
    );
    now += 2 * 60 * 1000;
    results.push(
      await send("PATCH", `/Users/${created.body["id"]}`, entraActive("True")),
    );
    now += 2 * 60 * 1000;
  }

  return results;
}

// A run's answers with no ids, which are each world's own.
function answersOf(results: Array<HttpResult>): Array<JSONObject> {
  return results.map((result: HttpResult): JSONObject => {
    const body: JSONObject = { ...result.body };
    delete body["id"];
    delete body["meta"];
    return { status: result.status, body: body };
  });
}

describe.each([
  AddressHistory.NoAccount,
  AddressHistory.SignedUpElsewhere,
  AddressHistory.UnclaimedElsewhere,
])("%s", (history: AddressHistory) => {
  test("an Okta create, DELETE, create loop invites them each time and emails them once an hour", async () => {
    seedWorld(history);

    const results: Array<HttpResult> = await oktaLoop(10);

    // Every create invited them; every DELETE removed the invitation.
    expect(
      results.map((result: HttpResult): number => {
        return result.status;
      }),
    ).toEqual(
      Array.from({ length: 10 }).flatMap((): Array<number> => {
        return [201, 204];
      }),
    );

    // Forty minutes of it: one email, counted once.
    expect(invitationEmails()).toHaveLength(1);
    expect(invitationEmails()[0]!.toEmail.toString()).toBe(ADDRESS);
    expect(projectCount()).toBe(1);

    // An hour after the first, the next create emails them again.
    now += HOUR_IN_MS;
    expect((await send("POST", "/Users", oktaCreate())).status).toBe(201);
    expect(invitationEmails()).toHaveLength(2);
  });

  test("an Entra ID create, active False, active True loop invites them each time and emails them once an hour", async () => {
    seedWorld(history);

    const results: Array<HttpResult> = await entraLoop(8);

    expect(
      results.map((result: HttpResult): number => {
        return result.status;
      }),
    ).toEqual([
      201,
      ...Array.from({ length: 8 }).flatMap((): Array<number> => {
        return [200, 200];
      }),
    ]);

    // Back in scope at the end: invited, and emailed once in all.
    expect(pendingInProject()).toHaveLength(1);
    expect(invitationEmails()).toHaveLength(1);
    expect(projectCount()).toBe(1);
  });
});

describe("alike, whether or not the address had an account", () => {
  async function runOkta(history: AddressHistory): Promise<JSONObject> {
    seedWorld(history);

    const results: Array<HttpResult> = await oktaLoop(4);

    return {
      answers: answersOf(results),
      emails: invitationEmails().length,
      counted: projectCount(),
      pending: pendingInProject().map((row: WorldMembership): JSONObject => {
        return { inviteeName: row.inviteeName };
      }),
    };
  }

  async function runEntra(history: AddressHistory): Promise<JSONObject> {
    seedWorld(history);

    const results: Array<HttpResult> = await entraLoop(4);

    return {
      answers: answersOf(results),
      emails: invitationEmails().length,
      counted: projectCount(),
      pending: pendingInProject().map((row: WorldMembership): JSONObject => {
        return { inviteeName: row.inviteeName };
      }),
    };
  }

  test.each([
    AddressHistory.SignedUpElsewhere,
    AddressHistory.UnclaimedElsewhere,
  ])(
    "Okta's loop: answers, emails and the project's invitations are the new address's (%s)",
    async (history: AddressHistory) => {
      expect(await runOkta(history)).toEqual(
        await runOkta(AddressHistory.NoAccount),
      );
    },
  );

  test.each([
    AddressHistory.SignedUpElsewhere,
    AddressHistory.UnclaimedElsewhere,
  ])(
    "Entra ID's loop: answers, emails and the project's invitations are the new address's (%s)",
    async (history: AddressHistory) => {
      expect(await runEntra(history)).toEqual(
        await runEntra(AddressHistory.NoAccount),
      );
    },
  );
});

/*
 * The invitation's own work before the SCIM answer (#10180): an account
 * nobody has claimed is minted its token after the answer, as the email is
 * sent, so the request does what one for an account that has signed up
 * does - and, bar making the account, what one for a new address does.
 */
describe("before the SCIM answer, the invitation does the same work for every account", () => {
  function callsBeforeAnswer(): Array<string> {
    const at: number = scimWorld.calls.indexOf(ANSWERED);
    return scimWorld.calls.slice(0, at);
  }

  function callsAfterAnswer(): Array<string> {
    const at: number = scimWorld.calls.indexOf(ANSWERED);
    return scimWorld.calls.slice(at + 1);
  }

  async function createIn(history: AddressHistory): Promise<{
    before: Array<string>;
    after: Array<string>;
  }> {
    seedWorld(history);
    scimWorld.calls = [];

    expect((await send("POST", "/Users", entraCreate())).status).toBe(201);

    return { before: callsBeforeAnswer(), after: callsAfterAnswer() };
  }

  test("an account nobody has claimed and one that has signed up: the same reads and writes, in order", async () => {
    const signedUp: Array<string> = (
      await createIn(AddressHistory.SignedUpElsewhere)
    ).before;
    const unclaimed: Array<string> = (
      await createIn(AddressHistory.UnclaimedElsewhere)
    ).before;

    expect(unclaimed).toEqual(signedUp);
    expect(unclaimed).not.toContain("EmailVerificationTokenService.create");
    expect(unclaimed).not.toContain("MailService.sendMail");
  });

  test("a new address: the same, bar making its account", async () => {
    const signedUp: Array<string> = (
      await createIn(AddressHistory.SignedUpElsewhere)
    ).before;
    const fresh: Array<string> = (await createIn(AddressHistory.NoAccount))
      .before;

    expect(
      fresh.filter((call: string): boolean => {
        return call !== "UserService.createByEmail";
      }),
    ).toEqual(signedUp);
  });

  test("after the answer, an account nobody has claimed is minted its token, and each is emailed", async () => {
    const unclaimed: { after: Array<string> } = await createIn(
      AddressHistory.UnclaimedElsewhere,
    );

    expect(unclaimed.after).toContain("EmailVerificationTokenService.create");
    expect(unclaimed.after).toContain("MailService.sendMail");
    expect(tokensMinted).toHaveLength(1);

    const signedUp: { after: Array<string> } = await createIn(
      AddressHistory.SignedUpElsewhere,
    );

    expect(signedUp.after).not.toContain(
      "EmailVerificationTokenService.create",
    );
    expect(signedUp.after).toContain("MailService.sendMail");
  });
});
