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
  HOSTED_EMAIL_CHANGE_STEP,
  NAME_CHANGE_STEP,
  SELF_HOSTED_EMAIL_CHANGE_STEP,
} from "../../../Server/Identity/Utils/ProjectSCIMAccountPolicy";
import { createProjectSCIMLog } from "../../../Server/Identity/Utils/SCIMLogger";
import { fakeProjectSCIMUserService } from "./FakeProjectSCIMUserService";
import {
  fakeTeamMemberService,
  fakeUserService,
  idOf,
  scimWorld,
  WorldMembership,
  WorldUser,
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
import PasswordHash from "Common/Server/Utils/PasswordHash";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import { JSONObject } from "Common/Types/JSON";
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
 * SCIM SAYS NOTHING OF WHETHER AN ADDRESS ALREADY HAD AN ACCOUNT (#9825).
 *
 * A project's SCIM connection can name any address. When an account already
 * uses it - anywhere on the server, in another customer's project on
 * OneUptime Cloud - SCIM links that account instead of creating one. Whoever
 * holds the connection's token, and every member and viewer of the project
 * (who read its SCIM log), must not be able to tell which happened: not from
 * an answer, not from how long it took, not from the log.
 *
 * So every flow here runs twice, in two worlds that differ only in whether
 * the address had an account before, and the two runs are held to the same
 * statuses, the same answers - every header too - and the same log, apart
 * from ids and times; to the same password-hash work; to the same reads and
 * writes, in the same order, but for the one write that making an account
 * is; and to what the project reads afterwards (#9899): the same teams, the
 * same standing - invited on OneUptime Cloud, a member on a self-hosted
 * install - and the same name, the one the identity provider sent. The
 * payloads are what Okta and Microsoft Entra ID send.
 *
 * What still differs, and is pinned here as the known residual: on a
 * self-hosted install, where SCIM adds both as members, an account this
 * project does not manage keeps its own name and address - and is not
 * written - which the Users list shows of its members.
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

jest.mock("Common/Server/Services/TeamMemberService", () => {
  const world: typeof import("./InMemorySCIMWorld") = jest.requireActual(
    "./InMemorySCIMWorld",
  ) as typeof import("./InMemorySCIMWorld");

  return { __esModule: true, default: world.fakeTeamMemberService };
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

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
// Another customer's project, on the same server.
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const SCIM_ID: string = "33333333-3333-4333-8333-333333333333";

const USER_SCHEMA: string = "urn:ietf:params:scim:schemas:core:2.0:User";
const ENTERPRISE_SCHEMA: string =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const PATCH_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const BULK_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:BulkRequest";
const GROUP_SCHEMA: string = "urn:ietf:params:scim:schemas:core:2.0:Group";
// The extension Microsoft Entra ID names on every group it creates.
const ENTRA_GROUP_SCHEMA: string =
  "http://schemas.microsoft.com/2006/11/ResourceManagement/ADSCIM/2.0/Group";

// The address every flow provisions.
const ADDRESS: string = "sam.rivera@acme.example";

// What the account that already has the address calls itself.
const OWN_NAME: string = "Samantha Original-Owner";

/*
 * ---------------------------------------------------------------------------
 * What Okta and Microsoft Entra ID send.
 * ---------------------------------------------------------------------------
 */

// Okta's create (its SCIM 2.0 guide and spec test), with a password it pushes.
function oktaCreate(address: string): JSONObject {
  return {
    schemas: [USER_SCHEMA],
    userName: address,
    name: { givenName: "Sam", familyName: "Rivera" },
    emails: [{ primary: true, value: address, type: "work" }],
    displayName: "Sam Rivera",
    locale: "en-US",
    externalId: "00ujl29u0le5T6Aj10h7",
    groups: [],
    password: "1mz050nq",
    active: true,
  };
}

// Okta's create from an app that does not push passwords.
function oktaCreateWithoutPassword(address: string): JSONObject {
  const body: JSONObject = oktaCreate(address);
  delete body["password"];
  return body;
}

// Okta's PUT of the whole user, as it sends a profile update.
function oktaPut(
  address: string,
  name: { givenName: string; familyName: string },
): JSONObject {
  return {
    schemas: [USER_SCHEMA],
    userName: address,
    name: name,
    emails: [{ primary: true, value: address, type: "work" }],
    displayName: `${name.givenName} ${name.familyName}`,
    locale: "en-US",
    externalId: "00ujl29u0le5T6Aj10h7",
    groups: [],
    active: true,
  };
}

// Microsoft Entra ID's create, with its default attribute mappings.
function entraCreate(address: string): JSONObject {
  return {
    schemas: [USER_SCHEMA, ENTERPRISE_SCHEMA],
    externalId: "4b1c6a2e-0f3d-4c8b-9a7e-2d5f1e6c3b90",
    userName: address,
    active: true,
    displayName: "Sam Rivera",
    emails: [{ primary: true, type: "work", value: address }],
    meta: { resourceType: "User" },
    name: { formatted: "Sam Rivera", familyName: "Rivera", givenName: "Sam" },
    title: "Site Reliability Engineer",
    roles: [],
    [ENTERPRISE_SCHEMA]: {
      employeeNumber: "701984",
      department: "Operations",
      manager: { value: "26118915-6090-4610-87e4-49d8ca9f808d" },
    },
  };
}

/*
 * Entra ID's gallery validator: a userName that is no address, the person's
 * address in the work email.
 */
function entraValidatorCreate(address: string): JSONObject {
  return {
    schemas: [USER_SCHEMA, ENTERPRISE_SCHEMA],
    externalId: "0a21f0f2-8d2a-4f8e-bf98-7363c4aed4ef",
    userName: "Test_User_ab6490ee-1e48-479e-a20b-2d77186b5dd1",
    active: true,
    emails: [{ primary: true, type: "work", value: address }],
    meta: { resourceType: "User" },
    name: {
      formatted: "givenName familyName",
      familyName: "familyName",
      givenName: "givenName",
    },
    roles: [],
  };
}

// An identity provider that maps no name: the address and the switch.
function nameless(address: string): JSONObject {
  return {
    schemas: [USER_SCHEMA],
    userName: address,
    emails: [{ primary: true, type: "work", value: address }],
    active: true,
  };
}

// The least a create can be: a userName that is an address.
function userNameOnly(address: string): JSONObject {
  return { schemas: [USER_SCHEMA], userName: address };
}

function patch(...operations: Array<JSONObject>): JSONObject {
  return { schemas: [PATCH_SCHEMA], Operations: operations };
}

interface CreatePayload {
  label: string;
  body: (address: string) => JSONObject;
  // The name the answer carries: the one sent, or none.
  sendsName: boolean;
  // The name an invitation shows the person by: the one sent, as a whole (#9899).
  providerName: string | null;
}

const createPayloads: Array<CreatePayload> = [
  {
    label: "Okta, with a password",
    body: oktaCreate,
    sendsName: true,
    providerName: "Sam Rivera",
  },
  {
    label: "Okta, without a password",
    body: oktaCreateWithoutPassword,
    sendsName: true,
    providerName: "Sam Rivera",
  },
  {
    label: "Microsoft Entra ID",
    body: entraCreate,
    sendsName: true,
    providerName: "Sam Rivera",
  },
  {
    label: "Microsoft Entra ID's validator (a userName that is no address)",
    body: entraValidatorCreate,
    sendsName: true,
    providerName: "givenName familyName",
  },
  {
    label: "a provider that maps no name",
    body: nameless,
    sendsName: false,
    providerName: null,
  },
  {
    label: "a userName and nothing else",
    body: userNameOnly,
    sendsName: false,
    providerName: null,
  },
];

/*
 * ---------------------------------------------------------------------------
 * The two worlds.
 * ---------------------------------------------------------------------------
 */

enum AddressHistory {
  // Nobody has the address: SCIM creates the account.
  NoAccount = "no account",
  // An account in another customer's project has it, under its own name.
  AccountElsewhere = "an account in another project",
  // The same, with no name of its own.
  NamelessAccountElsewhere = "a nameless account in another project",
  // A OneUptime administrator's account, in no project.
  AdministratorAccount = "a OneUptime administrator's account",
}

const EXISTING: Array<AddressHistory> = [
  AddressHistory.AccountElsewhere,
  AddressHistory.NamelessAccountElsewhere,
  AddressHistory.AdministratorAccount,
];

let membersTeamId: string;
let respondersTeamId: string;
let projectConfig: ProjectSCIM;
let httpServer: Server;
let baseUrl: string;

function seedWorld(history: AddressHistory): void {
  scimWorld.reset();
  fakeProjectSCIMUserService.reset();

  membersTeamId = scimWorld.seedTeam({
    projectId: PROJECT_ID,
    name: "Members",
  });
  respondersTeamId = scimWorld.seedTeam({
    projectId: PROJECT_ID,
    name: "Responders",
  });
  const otherTeamId: string = scimWorld.seedTeam({
    projectId: OTHER_PROJECT_ID,
    name: "Globex Owners",
  });

  if (
    history === AddressHistory.AccountElsewhere ||
    history === AddressHistory.NamelessAccountElsewhere
  ) {
    const owner: string = scimWorld.seedUser({
      email: ADDRESS,
      name: history === AddressHistory.AccountElsewhere ? OWN_NAME : null,
    });
    scimWorld.seedMembership({
      userId: owner,
      projectId: OTHER_PROJECT_ID,
      teamId: otherTeamId,
    });
  }

  if (history === AddressHistory.AdministratorAccount) {
    scimWorld.seedUser({
      email: ADDRESS,
      name: OWN_NAME,
      isMasterAdmin: true,
    });
  }

  projectConfig = new ProjectSCIM(new ObjectID(SCIM_ID));
  projectConfig.projectId = new ObjectID(PROJECT_ID);
  projectConfig.autoProvisionUsers = true;
  projectConfig.autoDeprovisionUsers = true;
  projectConfig.enablePushGroups = false;
  projectConfig.teams = [
    [membersTeamId, "Members"],
    [respondersTeamId, "Responders"],
  ].map(([id, name]: Array<string>): Team => {
    const team: Team = new Team(new ObjectID(id!));
    team.name = name!;
    return team;
  });
}

/*
 * ---------------------------------------------------------------------------
 * Requests, and what a run of them leaves.
 * ---------------------------------------------------------------------------
 */

interface HttpResult {
  status: number;
  body: JSONObject;
  // The Location header: a create's URI (RFC 7644, section 3.3).
  location: string | null;
  /*
   * Every other header the answer carries, by its name in lower case, but
   * those that are the request's own: its date, the connection's, and the
   * ETag - a hash of a body that names ids of its own.
   */
  headers: JSONObject;
}

const PER_REQUEST_HEADERS: ReadonlyArray<string> = [
  "date",
  "etag",
  "connection",
  "keep-alive",
];

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
  const headers: JSONObject = {};

  response.headers.forEach((value: string, name: string): void => {
    if (!PER_REQUEST_HEADERS.includes(name.toLowerCase())) {
      headers[name.toLowerCase()] = value;
    }
  });

  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as JSONObject,
    location: response.headers.get("location"),
    headers: headers,
  };
}

function filterByUserName(userName: string): string {
  return `/Users?filter=${encodeURIComponent(`userName eq "${userName}"`)}`;
}

// The scrypt derivations a request spends: a new account's hash, or one spent in its place.
type Derive = (data: unknown) => Promise<string>;

let derive: jest.SpiedFunction<Derive>;
let spendVerificationTime: jest.SpiedFunction<
  typeof PasswordHash.spendVerificationTime
>;
let createByEmail: jest.SpiedFunction<(args: unknown) => Promise<unknown>>;

interface Run {
  results: Array<HttpResult>;
  // Everything the connection's SCIM log was written with.
  logs: Array<JSONObject>;
  derivations: number;
  verificationTimeSpent: number;
  accountsCreated: Array<JSONObject>;
  // Every read and write of the accounts, teams and memberships, in order.
  calls: Array<string>;
  // Every read and write of the connection's records of its users, in order.
  recordCalls: Array<string>;
  // What the project's Users list reads afterwards (projectSees).
  projectSees: Array<JSONObject>;
}

/*
 * The project's memberships, as its Users list reads them: which team,
 * whether the person has joined or is invited, the name an invitation
 * shows them by, and whether OneUptime was asked to email them the
 * invitation - with no ids, which are each world's own.
 */
function projectSees(): Array<JSONObject> {
  return scimWorld.memberships
    .filter((row: WorldMembership): boolean => {
      return row.projectId === PROJECT_ID;
    })
    .map((row: WorldMembership): JSONObject => {
      return {
        team:
          scimWorld.teams.find((team: { id: string; name: string }) => {
            return team.id === row.teamId;
          })?.name || "<no team>",
        hasAcceptedInvitation: row.hasAcceptedInvitation,
        inviteeName: row.inviteeName,
        invitationEmailRequestedFor: row.invitationEmailRequestedFor,
      };
    })
    .sort((a: JSONObject, b: JSONObject): number => {
      return JSON.stringify(a).localeCompare(JSON.stringify(b));
    });
}

/*
 * A run's reads and writes, but for those the two worlds may differ by: the
 * one write making an account is (UserService.createByEmail, whose time a
 * create of an existing account spends hashing instead); and, on a
 * self-hosted install, an account's own new name or address - the residual
 * the top of this file names - which only an account this project manages
 * takes, read back once written.
 */
function workOf(run: Run): JSONObject {
  const calls: Array<string> = run.calls.filter((call: string): boolean => {
    return call !== "UserService.createByEmail";
  });

  if (ProjectSCIMAccountPolicy.isHostedService()) {
    return { calls: calls, recordCalls: run.recordCalls };
  }

  const kept: Array<string> = [];

  for (let at: number = 0; at < calls.length; at++) {
    if (calls[at] === "UserService.updateOneById") {
      // The account read back after its own write (updateProjectScimUser).
      if (calls[at + 1] === "UserService.findOneById") {
        at++;
      }
      continue;
    }

    kept.push(calls[at]!);
  }

  return { calls: kept, recordCalls: run.recordCalls };
}

// Runs `flow` in a world where the address has `history`, and keeps what it left.
async function runIn(
  history: AddressHistory,
  flow: () => Promise<Array<HttpResult>>,
): Promise<Run> {
  seedWorld(history);
  derive.mockClear();
  spendVerificationTime.mockClear();
  createByEmail.mockClear();
  (createProjectSCIMLog as jest.Mock).mockClear();

  const results: Array<HttpResult> = await flow();

  return {
    results: results,
    logs: (createProjectSCIMLog as jest.Mock).mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return JSON.parse(JSON.stringify(call[0])) as JSONObject;
      },
    ),
    derivations: derive.mock.calls.length,
    verificationTimeSpent: spendVerificationTime.mock.calls.length,
    accountsCreated: createByEmail.mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      },
    ),
    calls: [...scimWorld.calls],
    recordCalls: fakeProjectSCIMUserService.calls.map(
      (call: { method: string }): string => {
        return `ProjectSCIMUserService.${call.method}`;
      },
    ),
    projectSees: projectSees(),
  };
}

const UUID: RegExp =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIMESTAMP: RegExp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;

// What a party outside the server can see of a run: ids and times aside.
function visible(run: Run): JSONObject {
  return JSON.parse(
    JSON.stringify({ results: run.results, logs: run.logs })
      .replace(UUID, "<id>")
      .replace(TIMESTAMP, "<time>"),
  ) as JSONObject;
}

/*
 * The same flow, for a new address and for each kind of address that had an
 * account: every one of them must look like the first.
 */
async function expectAlike(
  flow: () => Promise<Array<HttpResult>>,
  histories: Array<AddressHistory> = EXISTING,
): Promise<{ fresh: Run; existing: Array<Run> }> {
  const fresh: Run = await runIn(AddressHistory.NoAccount, flow);
  const existing: Array<Run> = [];

  for (const history of histories) {
    const run: Run = await runIn(history, flow);

    expect({ history: history, seen: visible(run) }).toEqual({
      history: history,
      seen: visible(fresh),
    });

    // What the project's Users list reads afterwards (#9899).
    expect({ history: history, projectSees: run.projectSees }).toEqual({
      history: history,
      projectSees: fresh.projectSees,
    });

    // The same reads and writes, in the same order: how long it takes.
    expect({ history: history, work: workOf(run) }).toEqual({
      history: history,
      work: workOf(fresh),
    });

    existing.push(run);
  }

  return { fresh: fresh, existing: existing };
}

// Nothing of the account that had the address - its name - in an answer or the log.
function expectNothingOfTheOwner(run: Run): void {
  const seen: string = JSON.stringify({ results: run.results, logs: run.logs });

  expect(seen).not.toContain(OWN_NAME);
  expect(seen).not.toContain("Original-Owner");
}

// Words that would say the account existed, where it is, or what it is.
const TELLING_WORDS: RegExp =
  /already exist|does not exist|will link|wasNewlyCreated|userWasCreated|"Unknown|invited|pending|another project|other project|administrator|has not joined|in use|taken|creating new user|Name not updated|skipped/i;

function expectNoTellingWords(run: Run): void {
  expect(JSON.stringify(run.logs)).not.toMatch(TELLING_WORDS);
}

function userAt(address: string): WorldUser {
  const user: WorldUser | undefined = scimWorld.userByEmail(address);
  expect(user).toBeDefined();
  return user!;
}

beforeAll(async () => {
  installFakeEnterpriseModule({
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
  httpServer = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  derive = jest.spyOn(PasswordHash as unknown as { derive: Derive }, "derive");
  spendVerificationTime = jest.spyOn(PasswordHash, "spendVerificationTime");
  createByEmail = jest.spyOn(
    fakeUserService as unknown as {
      createByEmail: (args: unknown) => Promise<unknown>;
    },
    "createByEmail",
  );
});

afterAll(async () => {
  derive.mockRestore();
  spendVerificationTime.mockRestore();
  createByEmail.mockRestore();
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

const deployments: Array<{ label: string; hosted: boolean }> = [
  { label: "OneUptime Cloud", hosted: true },
  { label: "a self-hosted install", hosted: false },
];

describe.each(deployments)("on $label", ({ hosted }: { hosted: boolean }) => {
  beforeEach(() => {
    setTestBillingEnabled(hosted);
  });

  /*
   * -------------------------------------------------------------------------
   * Creating the user.
   * -------------------------------------------------------------------------
   */

  describe.each(createPayloads)(
    "a create from $label",
    ({ body, sendsName, providerName }: CreatePayload) => {
      const create: () => Promise<Array<HttpResult>> = async (): Promise<
        Array<HttpResult>
      > => {
        return [await send("POST", "/Users", body(ADDRESS))];
      };

      test("is answered alike, and logged alike, whether or not the address had an account", async () => {
        const { fresh, existing } = await expectAlike(create);

        expect(fresh.results[0]!.status).toBe(201);

        // RFC 7644, section 3.3: the new user's URI, in the header and in meta.location.
        expect(fresh.results[0]!.location).toBe(
          (fresh.results[0]!.body["meta"] as JSONObject)["location"],
        );
        expect(fresh.results[0]!.location).toMatch(
          new RegExp(`/Users/${fresh.results[0]!.body["id"]}$`),
        );

        for (const run of [fresh, ...existing]) {
          expectNothingOfTheOwner(run);
          expectNoTellingWords(run);
        }
      });

      /*
       * What the project reads afterwards (#9899): on OneUptime Cloud
       * everybody the connection names who has not joined the project is
       * invited, whether the connection just made the account or it
       * existed, each invitation showing the name the identity provider
       * sent - the Users list reads the same either way. A self-hosted
       * install adds both. expectAlike holds every world to the new
       * address's; this says what that is.
       */
      test("the project reads the same afterwards: the same teams, the same standing, the name the identity provider sent", async () => {
        const { fresh } = await expectAlike(create);

        expect(fresh.projectSees).toEqual([
          {
            team: "Members",
            hasAcceptedInvitation: !hosted,
            inviteeName: providerName,
            // One invitation into the project, with its first team.
            invitationEmailRequestedFor: hosted ? ADDRESS : null,
          },
          {
            team: "Responders",
            hasAcceptedInvitation: !hosted,
            inviteeName: providerName,
            invitationEmailRequestedFor: null,
          },
        ]);
      });

      test("costs one password derivation either way: a new account's hash, or one spent in its place", async () => {
        const { fresh, existing } = await expectAlike(create);

        // A new account: its random password hashed, nothing spent beside it.
        expect(fresh.accountsCreated).toHaveLength(1);
        expect(fresh.accountsCreated[0]).toMatchObject({
          generateRandomPassword: true,
        });
        expect(fresh.verificationTimeSpent).toBe(0);
        expect(fresh.derivations).toBe(1);

        // An existing account: no account made, and the same work spent.
        for (const run of existing) {
          expect(run.accountsCreated).toEqual([]);
          expect(run.verificationTimeSpent).toBe(1);
          expect(run.derivations).toBe(1);
        }
      });

      test(
        sendsName
          ? "answers with the name sent, never the account's own"
          : "answers with no name at all, whether or not the account has one",
        async () => {
          const { fresh, existing } = await expectAlike(create);

          for (const run of [fresh, ...existing]) {
            const answer: JSONObject = run.results[0]!.body;

            if (sendsName) {
              const sent: JSONObject = body(ADDRESS);

              // Every part sent, as sent; a formatted name made of them when none was.
              expect(answer["name"]).toEqual(
                expect.objectContaining(sent["name"] as JSONObject),
              );
              expect(answer["displayName"]).toEqual(sent["displayName"]);
              expect(JSON.stringify(answer)).not.toContain(OWN_NAME);
            } else {
              expect("name" in answer).toBe(false);
              expect("displayName" in answer).toBe(false);
            }
          }
        },
      );

      test("the user's log details are what was sent: no word of a new or an existing account", async () => {
        const { fresh, existing } = await expectAlike(create);

        for (const run of [fresh, ...existing]) {
          const log: JSONObject = run.logs.find((entry: JSONObject) => {
            return entry["operationType"] === "CreateUser";
          })!;

          expect(Object.keys(log["userInfo"] as JSONObject).sort()).toEqual([
            "email",
            "name",
            "userId",
          ]);
          expect((log["userInfo"] as JSONObject)["name"]).toEqual(
            sendsName ? expect.any(String) : null,
          );
        }
      });

      test("a Bulk create is answered and logged alike too", async () => {
        const { fresh, existing } = await expectAlike(
          async (): Promise<Array<HttpResult>> => {
            return [
              await send("POST", "/Bulk", {
                schemas: [BULK_SCHEMA],
                Operations: [
                  {
                    method: "POST",
                    bulkId: "u1",
                    path: "/Users",
                    data: body(ADDRESS),
                  },
                ],
              }),
            ];
          },
        );

        const operation: JSONObject = (
          fresh.results[0]!.body["Operations"] as Array<JSONObject>
        )[0]!;
        expect(operation["status"]).toBe("201");

        for (const run of [fresh, ...existing]) {
          expectNothingOfTheOwner(run);
          expectNoTellingWords(run);
          expect(run.derivations).toBe(1);
        }
      });
    },
  );

  test('a create the identity provider sends with no name makes an account with no name - never "Unknown"', async () => {
    await runIn(
      AddressHistory.NoAccount,
      async (): Promise<Array<HttpResult>> => {
        return [await send("POST", "/Users", nameless(ADDRESS))];
      },
    );

    expect(userAt(ADDRESS).name).toBe("");
  });

  test("a create links the existing account under its id, and leaves its own name and memberships elsewhere alone", async () => {
    const run: Run = await runIn(
      AddressHistory.AccountElsewhere,
      async (): Promise<Array<HttpResult>> => {
        return [await send("POST", "/Users", oktaCreate(ADDRESS))];
      },
    );

    const owner: WorldUser = userAt(ADDRESS);
    expect(run.results[0]!.body["id"]).toBe(owner.id);
    expect(owner.name).toBe(OWN_NAME);
    expect(
      scimWorld.memberships.some((row: WorldMembership): boolean => {
        return row.userId === owner.id && row.projectId === OTHER_PROJECT_ID;
      }),
    ).toBe(true);
  });

  /*
   * How the account joins the project's teams is the same whether or not
   * the address had an account (#9899): on OneUptime Cloud both are invited -
   * the Users list shows two invitations, each named by the name the
   * identity provider sent - and on a self-hosted install both are added.
   * It used to differ: on Cloud an account SCIM created was added at once,
   * and one that existed invited, so the Users list said which addresses
   * already had an account.
   */
  test("with push groups on, the Unassigned team's membership is the same either way", async () => {
    const { fresh } = await expectAlike(
      async (): Promise<Array<HttpResult>> => {
        projectConfig.enablePushGroups = true;
        return [await send("POST", "/Users", oktaCreate(ADDRESS))];
      },
    );

    expect(fresh.projectSees).toEqual([
      {
        team: "Unassigned",
        hasAcceptedInvitation: !hosted,
        inviteeName: "Sam Rivera",
        invitationEmailRequestedFor: hosted ? ADDRESS : null,
      },
    ]);
  });

  /*
   * Someone who has joined the project already is no stranger to it: SCIM
   * adds them to its teams as a member, on Cloud too, and emails nobody.
   */
  test("an account that has joined the project already is added to the connection's teams as a member, and not emailed", async () => {
    for (const history of [
      AddressHistory.AccountElsewhere,
      AddressHistory.NamelessAccountElsewhere,
    ]) {
      await runIn(history, async (): Promise<Array<HttpResult>> => {
        scimWorld.seedMembership({
          userId: userAt(ADDRESS).id,
          projectId: PROJECT_ID,
          teamId: scimWorld.seedTeam({
            projectId: PROJECT_ID,
            name: "On-Call",
          }),
          accepted: true,
        });
        return [await send("POST", "/Users", oktaCreate(ADDRESS))];
      });

      expect({ history: history, projectSees: projectSees() }).toEqual({
        history: history,
        projectSees: [
          {
            team: "Members",
            hasAcceptedInvitation: true,
            inviteeName: "Sam Rivera",
            invitationEmailRequestedFor: null,
          },
          {
            team: "On-Call",
            hasAcceptedInvitation: true,
            inviteeName: null,
            invitationEmailRequestedFor: null,
          },
          {
            team: "Responders",
            hasAcceptedInvitation: true,
            inviteeName: "Sam Rivera",
            invitationEmailRequestedFor: null,
          },
        ],
      });
    }
  });

  test("an account invited to the project already is invited to the connection's teams too, and not emailed a second time", async () => {
    await runIn(
      AddressHistory.AccountElsewhere,
      async (): Promise<Array<HttpResult>> => {
        scimWorld.seedMembership({
          userId: userAt(ADDRESS).id,
          projectId: PROJECT_ID,
          teamId: scimWorld.seedTeam({
            projectId: PROJECT_ID,
            name: "On-Call",
          }),
          accepted: false,
          inviteeName: "Sam, as typed",
        });
        return [await send("POST", "/Users", oktaCreate(ADDRESS))];
      },
    );

    expect(projectSees()).toEqual([
      {
        team: "Members",
        hasAcceptedInvitation: !hosted,
        inviteeName: "Sam Rivera",
        invitationEmailRequestedFor: null,
      },
      {
        team: "On-Call",
        hasAcceptedInvitation: false,
        inviteeName: "Sam, as typed",
        invitationEmailRequestedFor: null,
      },
      {
        team: "Responders",
        hasAcceptedInvitation: !hosted,
        inviteeName: "Sam Rivera",
        invitationEmailRequestedFor: null,
      },
    ]);
  });

  /*
   * An identity provider that creates, deletes and creates the user again -
   * a mapping fixed, a user unassigned and assigned back - meets an account
   * the second time either way: the two worlds read alike throughout, and
   * on Cloud the second invitation is emailed as the first was, the
   * deletion having taken the first away.
   */
  test("a create, a deletion and a create again are answered, logged and read alike", async () => {
    const { fresh, existing } = await expectAlike(
      async (): Promise<Array<HttpResult>> => {
        const first: HttpResult = await send(
          "POST",
          "/Users",
          entraCreate(ADDRESS),
        );
        const deleted: HttpResult = await send(
          "DELETE",
          `/Users/${first.body["id"]}`,
        );
        const second: HttpResult = await send(
          "POST",
          "/Users",
          entraCreate(ADDRESS),
        );

        return [first, deleted, second];
      },
    );

    expect(
      fresh.results.map((result: HttpResult): number => {
        return result.status;
      }),
    ).toEqual([201, 204, 201]);
    expect(fresh.projectSees).toEqual([
      {
        team: "Members",
        hasAcceptedInvitation: !hosted,
        inviteeName: "Sam Rivera",
        invitationEmailRequestedFor: hosted ? ADDRESS : null,
      },
      {
        team: "Responders",
        hasAcceptedInvitation: !hosted,
        inviteeName: "Sam Rivera",
        invitationEmailRequestedFor: null,
      },
    ]);

    // A derivation for each create: the account's hash, then one spent in its place.
    for (const run of [fresh, ...existing]) {
      expect(run.derivations).toBe(2);
    }
  });

  /*
   * -------------------------------------------------------------------------
   * Groups: with push groups on, the identity provider puts the user in its
   * groups after the create, as Okta Push Groups and Microsoft Entra ID's
   * group provisioning send it. Each group's team invites the person by the
   * name the connection's record keeps of them - what the provider sent,
   * never the account's own (#9899) - and only the first invitation into
   * the project, the Unassigned team's, was emailed.
   * -------------------------------------------------------------------------
   */

  interface GroupFlow {
    label: string;
    create: (address: string) => JSONObject;
    groups: (userId: string) => Promise<Array<HttpResult>>;
  }

  const groupFlows: Array<GroupFlow> = [
    {
      label:
        "Okta Push Groups: the group made, then a PATCH that adds the user",
      create: oktaCreate,
      groups: async (userId: string): Promise<Array<HttpResult>> => {
        const group: HttpResult = await send("POST", "/Groups", {
          schemas: [GROUP_SCHEMA],
          displayName: "Engineering",
          members: [],
        });

        return [
          group,
          await send(
            "PATCH",
            `/Groups/${group.body["id"]}`,
            patch({
              op: "add",
              path: "members",
              value: [{ value: userId, display: ADDRESS }],
            }),
          ),
        ];
      },
    },
    {
      label: "Okta Push Groups: a PUT of the group with its members",
      create: oktaCreate,
      groups: async (userId: string): Promise<Array<HttpResult>> => {
        const group: HttpResult = await send("POST", "/Groups", {
          schemas: [GROUP_SCHEMA],
          displayName: "Engineering",
          members: [],
        });

        return [
          group,
          await send("PUT", `/Groups/${group.body["id"]}`, {
            schemas: [GROUP_SCHEMA],
            id: group.body["id"] as string,
            displayName: "Engineering",
            members: [{ value: userId, display: ADDRESS }],
          }),
        ];
      },
    },
    {
      label: "Okta: a group made with its members",
      create: oktaCreate,
      groups: async (userId: string): Promise<Array<HttpResult>> => {
        return [
          await send("POST", "/Groups", {
            schemas: [GROUP_SCHEMA],
            displayName: "Engineering",
            members: [{ value: userId, display: ADDRESS }],
          }),
        ];
      },
    },
    {
      label: "Microsoft Entra ID: the group made, then an Add of its member",
      create: entraCreate,
      groups: async (userId: string): Promise<Array<HttpResult>> => {
        const group: HttpResult = await send("POST", "/Groups", {
          schemas: [GROUP_SCHEMA, ENTRA_GROUP_SCHEMA],
          externalId: "8aa1a0c0-c4c3-4bc0-b4a5-2ef676900159",
          displayName: "Engineering",
          meta: { resourceType: "Group" },
        });

        return [
          group,
          await send(
            "PATCH",
            `/Groups/${group.body["id"]}`,
            patch({
              op: "Add",
              path: "members",
              value: [{ value: userId }],
            }),
          ),
        ];
      },
    },
  ];

  describe.each(groupFlows)("$label", (flow: GroupFlow) => {
    const run: () => Promise<Array<HttpResult>> = async (): Promise<
      Array<HttpResult>
    > => {
      projectConfig.enablePushGroups = true;

      const created: HttpResult = await send(
        "POST",
        "/Users",
        flow.create(ADDRESS),
      );

      return [created, ...(await flow.groups(created.body["id"] as string))];
    };

    test("is answered, logged and read alike, and the project sees the same invitation", async () => {
      const { fresh, existing } = await expectAlike(run);

      for (const result of fresh.results) {
        expect([200, 201, 204]).toContain(result.status);
      }

      for (const each of [fresh, ...existing]) {
        expectNothingOfTheOwner(each);

        /*
         * The user's own log says nothing telling. The group's speaks of the
         * group - a team newly made, members skipped - in the same words in
         * every world (expectAlike).
         */
        expect(
          JSON.stringify(
            each.logs.filter((entry: JSONObject): boolean => {
              return String(entry["operationType"]).endsWith("User");
            }),
          ),
        ).not.toMatch(TELLING_WORDS);
      }

      // Out of the Unassigned team, into the group's: named by the provider, not emailed again.
      expect(fresh.projectSees).toEqual([
        {
          team: "Engineering",
          hasAcceptedInvitation: !hosted,
          inviteeName: "Sam Rivera",
          invitationEmailRequestedFor: null,
        },
      ]);
    });
  });

  /*
   * -------------------------------------------------------------------------
   * A group names only users of this connection.
   *
   * Whoever holds the connection's token may come by another account's id -
   * a link, an export, a log. A group add used to take any account's id: on
   * OneUptime Cloud it invited that account, so the project's Users list
   * showed the address behind the id, and its owner was emailed; on a
   * self-hosted install it made the account a member outright. A member may
   * now be only a user of this connection: one it provisioned, or a member
   * of the project it has not written yet, which GET /Users finds for an
   * identity provider to link. Any other id - an account elsewhere on the
   * server, or none at all - is skipped alike: the same answers, headers,
   * log and reads, and nothing written. Each request below is what Okta or
   * Microsoft Entra ID sends.
   * -------------------------------------------------------------------------
   */

  // The account elsewhere on the server whose id the token holder came by.
  const OUTSIDER_ADDRESS: string = "nadia.okafor@globex.example";

  // What each kind of member id names.
  enum NamedMember {
    // An account of another project, which this connection never provisioned.
    AccountElsewhere = "an account elsewhere on the server",
    // An id no account has.
    NoAccount = "an id no account has",
  }

  interface ForeignMemberFlow {
    label: string;
    groups: (memberId: string) => Promise<Array<HttpResult>>;
  }

  const groupWith: () => Promise<HttpResult> = (): Promise<HttpResult> => {
    return send("POST", "/Groups", {
      schemas: [GROUP_SCHEMA],
      displayName: "Engineering",
      members: [],
    });
  };

  const foreignMemberFlows: Array<ForeignMemberFlow> = [
    {
      label: "Okta: a PATCH that adds the member",
      groups: async (memberId: string): Promise<Array<HttpResult>> => {
        const group: HttpResult = await groupWith();

        return [
          group,
          await send(
            "PATCH",
            `/Groups/${group.body["id"]}`,
            patch({
              op: "add",
              path: "members",
              value: [{ value: memberId, display: OUTSIDER_ADDRESS }],
            }),
          ),
          await send("GET", `/Groups/${group.body["id"]}`),
        ];
      },
    },
    {
      label: "Okta: a PUT of the group that lists the member",
      groups: async (memberId: string): Promise<Array<HttpResult>> => {
        const group: HttpResult = await groupWith();

        return [
          group,
          await send("PUT", `/Groups/${group.body["id"]}`, {
            schemas: [GROUP_SCHEMA],
            id: group.body["id"] as string,
            displayName: "Engineering",
            members: [{ value: memberId, display: OUTSIDER_ADDRESS }],
          }),
          await send("GET", `/Groups/${group.body["id"]}`),
        ];
      },
    },
    {
      label: "Okta: a group made with the member",
      groups: async (memberId: string): Promise<Array<HttpResult>> => {
        const group: HttpResult = await send("POST", "/Groups", {
          schemas: [GROUP_SCHEMA],
          displayName: "Engineering",
          members: [{ value: memberId, display: OUTSIDER_ADDRESS }],
        });

        return [group, await send("GET", `/Groups/${group.body["id"]}`)];
      },
    },
    {
      label: "Microsoft Entra ID: an Add of the member",
      groups: async (memberId: string): Promise<Array<HttpResult>> => {
        const group: HttpResult = await send("POST", "/Groups", {
          schemas: [GROUP_SCHEMA, ENTRA_GROUP_SCHEMA],
          externalId: "8aa1a0c0-c4c3-4bc0-b4a5-2ef676900159",
          displayName: "Engineering",
          meta: { resourceType: "Group" },
        });

        return [
          group,
          await send(
            "PATCH",
            `/Groups/${group.body["id"]}`,
            patch({
              op: "Add",
              path: "members",
              value: [{ value: memberId }],
            }),
          ),
          // How Entra ID asks whether the member is in the group now.
          await send(
            "GET",
            `/Groups?filter=${encodeURIComponent(
              `id eq "${group.body["id"]}" and members[value eq "${memberId}"]`,
            )}&excludedAttributes=members`,
          ),
        ];
      },
    },
    {
      label: "Bulk: a PATCH of the group that adds the member",
      groups: async (memberId: string): Promise<Array<HttpResult>> => {
        const group: HttpResult = await groupWith();

        return [
          group,
          await send("POST", "/Bulk", {
            schemas: [BULK_SCHEMA],
            Operations: [
              {
                method: "PATCH",
                bulkId: "g1",
                path: `/Groups/${group.body["id"]}`,
                data: patch({
                  op: "add",
                  path: "members",
                  value: [{ value: memberId }],
                }),
              },
            ],
          }),
          await send(
            "GET",
            `/Groups?filter=${encodeURIComponent(
              `members.value eq "${memberId}"`,
            )}`,
          ),
        ];
      },
    },
  ];

  /*
   * The connection provisions its own user, then names `named` in a group:
   * an account of another project, seeded with an address of its own, or an
   * id no account has. Push groups on, as an identity provider that sends
   * groups has them.
   */
  async function nameInAGroup(
    named: NamedMember,
    flow: ForeignMemberFlow,
  ): Promise<{ run: Run; memberId: string }> {
    let memberId: string = "";

    const run: Run = await runIn(
      AddressHistory.NoAccount,
      async (): Promise<Array<HttpResult>> => {
        projectConfig.enablePushGroups = true;

        if (named === NamedMember.AccountElsewhere) {
          memberId = scimWorld.seedUser({
            email: OUTSIDER_ADDRESS,
            name: "Nadia Okafor",
          });
          scimWorld.seedMembership({
            userId: memberId,
            projectId: OTHER_PROJECT_ID,
            teamId: scimWorld.seedTeam({
              projectId: OTHER_PROJECT_ID,
              name: "Globex SRE",
            }),
          });
        } else {
          memberId = idOf(ObjectID.generate());
        }

        const created: HttpResult = await send(
          "POST",
          "/Users",
          oktaCreate(ADDRESS),
        );

        return [created, ...(await flow.groups(memberId))];
      },
    );

    return { run: run, memberId: memberId };
  }

  describe.each(foreignMemberFlows)(
    "a group that names an id this connection never provisioned - $label",
    (flow: ForeignMemberFlow) => {
      test("is answered, logged and read alike for an account elsewhere and an id no account has, and writes nothing", async () => {
        const noAccount: { run: Run; memberId: string } = await nameInAGroup(
          NamedMember.NoAccount,
          flow,
        );
        const elsewhere: { run: Run; memberId: string } = await nameInAGroup(
          NamedMember.AccountElsewhere,
          flow,
        );

        // The same statuses, bodies, headers and log, ids aside.
        expect(visible(elsewhere.run)).toEqual(visible(noAccount.run));
        // The same reads and writes, in the same order.
        expect(workOf(elsewhere.run)).toEqual(workOf(noAccount.run));
        // The project reads the same afterwards: its own user only.
        expect(elsewhere.run.projectSees).toEqual(noAccount.run.projectSees);

        for (const result of elsewhere.run.results) {
          expect([200, 201, 204]).toContain(result.status);
        }

        // Nothing written for the account elsewhere: no membership, no invitation.
        expect(
          scimWorld.memberships.filter((row: WorldMembership): boolean => {
            return row.userId === elsewhere.memberId;
          }),
        ).toHaveLength(1);
        expect(
          scimWorld.memberships.some((row: WorldMembership): boolean => {
            return (
              row.userId === elsewhere.memberId && row.projectId === PROJECT_ID
            );
          }),
        ).toBe(false);
        expect(
          scimWorld.memberships
            .map((row: WorldMembership): string | null => {
              return row.invitationEmailRequestedFor;
            })
            .filter(Boolean),
        ).toEqual(hosted ? [ADDRESS] : []);

        // Its address appears in no answer and no log but what the request itself sent.
        const answers: string = JSON.stringify(
          elsewhere.run.results.map((result: HttpResult): JSONObject => {
            return result.body;
          }),
        );
        expect(answers).not.toContain(OUTSIDER_ADDRESS);
        expect(answers).not.toContain("Nadia");
        expect(
          JSON.stringify(
            elsewhere.run.logs.map((entry: JSONObject): unknown => {
              return [entry["responseBody"], entry["steps"]];
            }),
          ),
        ).not.toContain(OUTSIDER_ADDRESS);
      });
    },
  );

  test("a user the connection provisioned is still added, as the provider names them", async () => {
    await runIn(
      AddressHistory.NoAccount,
      async (): Promise<Array<HttpResult>> => {
        projectConfig.enablePushGroups = true;

        const created: HttpResult = await send(
          "POST",
          "/Users",
          entraCreate(ADDRESS),
        );
        const group: HttpResult = await groupWith();

        return [
          created,
          group,
          await send(
            "PATCH",
            `/Groups/${group.body["id"]}`,
            patch({
              op: "Add",
              path: "members",
              value: [{ value: created.body["id"] as string }],
            }),
          ),
        ];
      },
    );

    expect(projectSees()).toEqual([
      {
        team: "Engineering",
        hasAcceptedInvitation: !hosted,
        inviteeName: "Sam Rivera",
        invitationEmailRequestedFor: null,
      },
    ]);
  });

  /*
   * An identity provider that finds a member of the project with a
   * userName lookup links them rather than creating them, and names them
   * in its groups by the id the lookup answered: they are a user of this
   * connection too, the project's own, and are added. Nothing of theirs is
   * the provider's to name the invitation by.
   */
  test("a member of the project the connection has not written yet is added when a group names them", async () => {
    await runIn(
      AddressHistory.NoAccount,
      async (): Promise<Array<HttpResult>> => {
        projectConfig.enablePushGroups = true;

        const colleague: string = scimWorld.seedUser({
          email: "carol.danvers@acme.example",
          name: "Carol Danvers",
        });
        scimWorld.seedMembership({
          userId: colleague,
          projectId: PROJECT_ID,
          teamId: membersTeamId,
          accepted: true,
        });

        const lookedUp: HttpResult = await send(
          "GET",
          filterByUserName("carol.danvers@acme.example"),
        );
        const linkedId: string = (
          (lookedUp.body["Resources"] as Array<JSONObject>)[0] as JSONObject
        )["id"] as string;
        expect(linkedId).toBe(colleague);

        const group: HttpResult = await groupWith();

        return [
          lookedUp,
          group,
          await send(
            "PATCH",
            `/Groups/${group.body["id"]}`,
            patch({
              op: "Add",
              path: "members",
              value: [{ value: linkedId }],
            }),
          ),
        ];
      },
    );

    expect(projectSees()).toEqual([
      {
        team: "Engineering",
        hasAcceptedInvitation: true,
        inviteeName: null,
        invitationEmailRequestedFor: null,
      },
      {
        team: "Members",
        hasAcceptedInvitation: true,
        inviteeName: null,
        invitationEmailRequestedFor: null,
      },
    ]);
  });

  /*
   * How long a create takes, with every read the database answers slowed
   * down: as long whether or not the address had an account. A read more
   * for one of them would show as a whole read's time; what is left is the
   * one write making an account is, beside the hash an existing account's
   * create spends in its place. The fastest of three runs each, so a busy
   * machine's pauses do not decide it.
   */
  test("takes as long whether or not the address had an account, with every read slowed down", async () => {
    const READ_DELAY_MS: number = 80;

    const fastestIn: (history: AddressHistory) => Promise<number> = async (
      history: AddressHistory,
    ): Promise<number> => {
      const durations: Array<number> = [];

      for (let attempt: number = 0; attempt < 3; attempt++) {
        const timed: { ms: number } = { ms: Number.POSITIVE_INFINITY };

        await runIn(history, async (): Promise<Array<HttpResult>> => {
          scimWorld.readDelayMs = READ_DELAY_MS;
          fakeProjectSCIMUserService.readDelayMs = READ_DELAY_MS;

          const started: number = performance.now();
          const result: HttpResult = await send(
            "POST",
            "/Users",
            oktaCreate(ADDRESS),
          );
          timed.ms = performance.now() - started;

          return [result];
        });

        durations.push(timed.ms);
      }

      return Math.min(...durations);
    };

    const fresh: number = await fastestIn(AddressHistory.NoAccount);

    // Each create reads the database several times: the delay is felt.
    expect(fresh).toBeGreaterThan(READ_DELAY_MS * 5);

    for (const history of EXISTING) {
      const existing: number = await fastestIn(history);

      expect({
        history: history,
        withinHalfARead: Math.abs(existing - fresh) < READ_DELAY_MS / 2,
      }).toEqual({ history: history, withinHalfARead: true });
    }
  });

  /*
   * -------------------------------------------------------------------------
   * Looking the user up.
   * -------------------------------------------------------------------------
   */

  test("a userName lookup before the create finds no one either way, after the same reads", async () => {
    const findOneBy: jest.SpiedFunction<(args: unknown) => Promise<unknown>> =
      jest.spyOn(
        fakeTeamMemberService as unknown as {
          findOneBy: (args: unknown) => Promise<unknown>;
        },
        "findOneBy",
      );

    try {
      const reads: Array<{ records: number; memberships: number }> = [];

      const lookUp: () => Promise<Array<HttpResult>> = async (): Promise<
        Array<HttpResult>
      > => {
        findOneBy.mockClear();
        const result: HttpResult = await send("GET", filterByUserName(ADDRESS));

        reads.push({
          records: fakeProjectSCIMUserService.calls.filter(
            (call: { method: string }): boolean => {
              return call.method === "findRecord";
            },
          ).length,
          memberships: findOneBy.mock.calls.length,
        });

        return [result];
      };

      const { fresh } = await expectAlike(lookUp);

      expect(fresh.results[0]!.status).toBe(200);
      expect(fresh.results[0]!.body["totalResults"]).toBe(0);

      // The project was asked the same questions for every address.
      expect(
        new Set(
          reads.map(
            (read: { records: number; memberships: number }): string => {
              return JSON.stringify(read);
            },
          ),
        ).size,
      ).toBe(1);
      expect(reads[0]!.records).toBeGreaterThan(0);
      expect(reads[0]!.memberships).toBeGreaterThan(0);
    } finally {
      findOneBy.mockRestore();
    }
  });

  test("after the create, the user reads back alike: by id, by userName, and in the list", async () => {
    await expectAlike(async (): Promise<Array<HttpResult>> => {
      const created: HttpResult = await send(
        "POST",
        "/Users",
        entraCreate(ADDRESS),
      );
      const id: string = created.body["id"] as string;

      return [
        created,
        await send("GET", `/Users/${id}`),
        await send("GET", filterByUserName(ADDRESS)),
        await send("GET", "/Users?startIndex=1&count=10"),
      ];
    });
  });

  /*
   * -------------------------------------------------------------------------
   * Updating the user: what Okta and Entra ID send after a create.
   * -------------------------------------------------------------------------
   */

  interface UpdateFlow {
    label: string;
    create: (address: string) => JSONObject;
    updates: (id: string) => Array<[string, string, JSONObject]>;
  }

  const updateFlows: Array<UpdateFlow> = [
    {
      label: "Okta: a PUT of the whole user under a new name",
      create: oktaCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          [
            "PUT",
            `/Users/${id}`,
            oktaPut(ADDRESS, { givenName: "Samuel", familyName: "Rivera" }),
          ],
        ];
      },
    },
    {
      label: "Okta: a PUT of the whole user as it is",
      create: oktaCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          [
            "PUT",
            `/Users/${id}`,
            oktaPut(ADDRESS, { givenName: "Sam", familyName: "Rivera" }),
          ],
        ];
      },
    },
    {
      label: "Okta: a deactivation and a reactivation, PATCHes with no path",
      create: oktaCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          [
            "PATCH",
            `/Users/${id}`,
            patch({ op: "replace", value: { active: false } }),
          ],
          [
            "PATCH",
            `/Users/${id}`,
            patch({ op: "replace", value: { active: true } }),
          ],
        ];
      },
    },
    {
      label:
        'Entra ID: disable and enable, with the strings "False" and "True"',
      create: entraCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          [
            "PATCH",
            `/Users/${id}`,
            patch({ op: "Replace", path: "active", value: "False" }),
          ],
          [
            "PATCH",
            `/Users/${id}`,
            patch({ op: "Replace", path: "active", value: "True" }),
          ],
        ];
      },
    },
    {
      label: "Entra ID: a new display name and family name, Add and Replace",
      create: entraCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          [
            "PATCH",
            `/Users/${id}`,
            patch(
              { op: "Add", path: "displayName", value: "Sam Rivera-Lopez" },
              {
                op: "Replace",
                path: "name.familyName",
                value: "Rivera-Lopez",
              },
              {
                op: "Replace",
                path: "name.formatted",
                value: "Sam Rivera-Lopez",
              },
            ),
          ],
        ];
      },
    },
    {
      label: "Entra ID: a new work email beside the same userName",
      create: entraCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          [
            "PATCH",
            `/Users/${id}`,
            patch({
              op: "Replace",
              path: 'emails[type eq "work"].value',
              value: "sam.rivera-lopez@acme.example",
            }),
          ],
        ];
      },
    },
    {
      label: "Entra ID: a new user principal name",
      create: entraCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          [
            "PATCH",
            `/Users/${id}`,
            patch(
              {
                op: "Replace",
                path: "userName",
                value: "sam.rivera-lopez@acme.example",
              },
              {
                op: "Replace",
                path: 'emails[type eq "work"].value',
                value: "sam.rivera-lopez@acme.example",
              },
            ),
          ],
        ];
      },
    },
    {
      /*
       * A group shows its members by the address the identity provider gave
       * them, not by the one the account signs in with - which an account in
       * another project would not have changed.
       */
      label: "Entra ID: a new user principal name, then the groups read back",
      create: entraCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          [
            "PATCH",
            `/Users/${id}`,
            patch({
              op: "Replace",
              path: "userName",
              value: "sam.rivera-lopez@acme.example",
            }),
          ],
          ["GET", "/Groups", {}],
          [
            "GET",
            `/Groups?filter=${encodeURIComponent('displayName eq "Members"')}`,
            {},
          ],
        ];
      },
    },
    {
      label: "Entra ID: a name that is cleared",
      create: entraCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          [
            "PATCH",
            `/Users/${id}`,
            patch(
              { op: "Replace", path: "displayName", value: null },
              { op: "Remove", path: "name" },
            ),
          ],
        ];
      },
    },
    {
      label: "a deletion",
      create: entraCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          ["DELETE", `/Users/${id}`, {}],
          ["GET", `/Users/${id}`, {}],
        ];
      },
    },
    {
      label: "Bulk: a PATCH and a PUT",
      create: oktaCreate,
      updates: (id: string): Array<[string, string, JSONObject]> => {
        return [
          [
            "POST",
            "/Bulk",
            {
              schemas: [BULK_SCHEMA],
              Operations: [
                {
                  method: "PATCH",
                  bulkId: "u1",
                  path: `/Users/${id}`,
                  data: patch({
                    op: "replace",
                    path: "displayName",
                    value: "Sam R.",
                  }),
                },
                {
                  method: "PUT",
                  bulkId: "u2",
                  path: `/Users/${id}`,
                  data: oktaPut(ADDRESS, {
                    givenName: "Samuel",
                    familyName: "Rivera",
                  }),
                },
              ],
            },
          ],
        ];
      },
    },
  ];

  describe.each(updateFlows)("$label", (flow: UpdateFlow) => {
    const run: () => Promise<Array<HttpResult>> = async (): Promise<
      Array<HttpResult>
    > => {
      const created: HttpResult = await send(
        "POST",
        "/Users",
        flow.create(ADDRESS),
      );
      const results: Array<HttpResult> = [created];

      for (const [method, path, body] of flow.updates(
        created.body["id"] as string,
      )) {
        results.push(
          await send(
            method,
            path,
            method === "GET" || method === "DELETE" ? undefined : body,
          ),
        );
      }

      return results;
    };

    test("is answered alike, and logged alike, whether or not the address had an account", async () => {
      const { fresh, existing } = await expectAlike(run);

      for (const result of fresh.results.slice(1)) {
        expect([200, 204, 404]).toContain(result.status);
      }

      for (const each of [fresh, ...existing]) {
        expectNothingOfTheOwner(each);
        expectNoTellingWords(each);
        // An update hashes nothing: the create's one derivation is all there is.
        expect(each.derivations).toBe(1);
      }
    });
  });

  test("a new name from the identity provider is logged in the same words whether or not the account takes it", async () => {
    const renamed: () => Promise<Array<HttpResult>> = async (): Promise<
      Array<HttpResult>
    > => {
      const created: HttpResult = await send(
        "POST",
        "/Users",
        oktaCreate(ADDRESS),
      );

      return [
        created,
        await send(
          "PUT",
          `/Users/${created.body["id"]}`,
          oktaPut(ADDRESS, { givenName: "Samuel", familyName: "Rivera" }),
        ),
      ];
    };

    const { fresh } = await expectAlike(renamed, [
      AddressHistory.AccountElsewhere,
    ]);

    expect(
      fresh.logs.find((entry: JSONObject) => {
        return entry["operationType"] === "UpdateUser";
      })!["steps"],
    ).toEqual(expect.arrayContaining([NAME_CHANGE_STEP]));

    // The invitations SCIM made, by the name each shows.
    const invitationNames: () => Array<string | null> = (): Array<
      string | null
    > => {
      return projectSees().map((row: JSONObject): string | null => {
        return row["inviteeName"] as string | null;
      });
    };

    if (hosted) {
      /*
       * On OneUptime Cloud neither account takes it: neither has joined the
       * project, so this project manages neither (#9899). Their invitations
       * take it instead - what the Users list shows of them, alike.
       */
      await runIn(AddressHistory.NoAccount, renamed);
      expect(userAt(ADDRESS).name).toBe("Sam Rivera");
      expect(invitationNames()).toEqual(["Samuel Rivera", "Samuel Rivera"]);

      await runIn(AddressHistory.AccountElsewhere, renamed);
      expect(userAt(ADDRESS).name).toBe(OWN_NAME);
      expect(invitationNames()).toEqual(["Samuel Rivera", "Samuel Rivera"]);
      return;
    }

    /*
     * The residual, on a self-hosted install, where both are members: an
     * account this project manages takes the name, one in another
     * customer's project keeps its own - which the project's Users list
     * shows of its members, and its answers and log do not. Neither
     * membership is an invitation, so neither name moves there.
     */
    await runIn(AddressHistory.NoAccount, renamed);
    expect(userAt(ADDRESS).name).toBe("Samuel Rivera");
    expect(invitationNames()).toEqual(["Sam Rivera", "Sam Rivera"]);

    await runIn(AddressHistory.AccountElsewhere, renamed);
    expect(userAt(ADDRESS).name).toBe(OWN_NAME);
    expect(invitationNames()).toEqual(["Sam Rivera", "Sam Rivera"]);
  });

  test("a new user principal name is logged in the same words whether or not the account takes it", async () => {
    const readdressed: () => Promise<Array<HttpResult>> = async (): Promise<
      Array<HttpResult>
    > => {
      const created: HttpResult = await send(
        "POST",
        "/Users",
        entraCreate(ADDRESS),
      );

      return [
        created,
        await send(
          "PATCH",
          `/Users/${created.body["id"]}`,
          patch({
            op: "Replace",
            path: "userName",
            value: "sam.rivera-lopez@acme.example",
          }),
        ),
      ];
    };

    const { fresh } = await expectAlike(readdressed);

    expect(
      fresh.logs.find((entry: JSONObject) => {
        return entry["operationType"] === "UpdateUser";
      })!["steps"],
    ).toEqual(
      expect.arrayContaining([
        hosted ? HOSTED_EMAIL_CHANGE_STEP : SELF_HOSTED_EMAIL_CHANGE_STEP,
      ]),
    );
    expect(fresh.results[1]!.body["userName"]).toBe(
      "sam.rivera-lopez@acme.example",
    );

    // On a self-hosted install an account this project manages takes it; one elsewhere keeps its own.
    await runIn(AddressHistory.NoAccount, readdressed);
    expect(
      scimWorld.userByEmail("sam.rivera-lopez@acme.example") !== undefined,
    ).toBe(!hosted);

    await runIn(AddressHistory.AccountElsewhere, readdressed);
    expect(userAt(ADDRESS).name).toBe(OWN_NAME);
    expect(scimWorld.userByEmail("sam.rivera-lopez@acme.example")).toBe(
      undefined,
    );
  });

  /*
   * -------------------------------------------------------------------------
   * Conflicts within the connection: RFC 7644, section 3.3.
   * -------------------------------------------------------------------------
   */

  test("the same create again is 409 uniqueness, for a new address and one that had an account alike", async () => {
    const { fresh } = await expectAlike(
      async (): Promise<Array<HttpResult>> => {
        return [
          await send("POST", "/Users", oktaCreate(ADDRESS)),
          await send("POST", "/Users", oktaCreate(ADDRESS)),
        ];
      },
    );

    expect(fresh.results[1]!.status).toBe(409);
    expect(fresh.results[1]!.body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "409",
      scimType: "uniqueness",
      detail: `A user with the userName "${ADDRESS}" is already provisioned by this SCIM connection.`,
    });
  });

  test("another userName for an address the connection already provisioned is 409 uniqueness too", async () => {
    const { fresh } = await expectAlike(
      async (): Promise<Array<HttpResult>> => {
        return [
          await send("POST", "/Users", entraCreate(ADDRESS)),
          await send("POST", "/Users", {
            ...entraValidatorCreate(ADDRESS),
            userName: "srivera",
          }),
        ];
      },
    );

    expect(fresh.results[1]!.status).toBe(409);
    expect(fresh.results[1]!.body["scimType"]).toBe("uniqueness");
  });

  test("an account elsewhere on the server is never a conflict", async () => {
    for (const history of EXISTING) {
      const run: Run = await runIn(
        history,
        async (): Promise<Array<HttpResult>> => {
          return [await send("POST", "/Users", entraCreate(ADDRESS))];
        },
      );

      expect(run.results[0]!.status).toBe(201);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * A new address another account signs in with (self-hosted: OneUptime Cloud
 * never changes an address).
 * ---------------------------------------------------------------------------
 */

describe("on a self-hosted install, an address another account signs in with", () => {
  const NEW_ADDRESS: string = "sam.rivera-lopez@acme.example";

  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  // The new address: free, or the sign-in address of an account in another project.
  async function readdressIn(
    taken: boolean,
    change: (id: string) => Promise<HttpResult>,
  ): Promise<Run> {
    return await runIn(
      AddressHistory.NoAccount,
      async (): Promise<Array<HttpResult>> => {
        if (taken) {
          const holder: string = scimWorld.seedUser({
            email: NEW_ADDRESS,
            name: "Someone Else",
          });
          scimWorld.seedMembership({
            userId: holder,
            projectId: OTHER_PROJECT_ID,
            teamId: scimWorld.seedTeam({
              projectId: OTHER_PROJECT_ID,
              name: "Globex",
            }),
          });
        }

        const created: HttpResult = await send(
          "POST",
          "/Users",
          oktaCreate(ADDRESS),
        );

        return [
          created,
          await change(created.body["id"] as string),
          // The groups show the user by the address the identity provider gave.
          await send("GET", "/Groups"),
        ];
      },
    );
  }

  const changes: Array<{
    label: string;
    change: (id: string) => Promise<HttpResult>;
  }> = [
    {
      label: "Entra ID's PATCH of the user principal name",
      change: (id: string): Promise<HttpResult> => {
        return send(
          "PATCH",
          `/Users/${id}`,
          patch({ op: "Replace", path: "userName", value: NEW_ADDRESS }),
        );
      },
    },
    {
      label: "Okta's PUT of the whole user",
      change: (id: string): Promise<HttpResult> => {
        return send("PUT", `/Users/${id}`, {
          ...oktaPut(NEW_ADDRESS, { givenName: "Sam", familyName: "Rivera" }),
        });
      },
    },
    {
      label: "a PATCH replace with no path",
      change: (id: string): Promise<HttpResult> => {
        return send(
          "PATCH",
          `/Users/${id}`,
          patch({
            op: "replace",
            value: {
              userName: NEW_ADDRESS,
              emails: [{ primary: true, type: "work", value: NEW_ADDRESS }],
            },
          }),
        );
      },
    },
    {
      label: "a Bulk PATCH",
      change: (id: string): Promise<HttpResult> => {
        return send("POST", "/Bulk", {
          schemas: [BULK_SCHEMA],
          Operations: [
            {
              method: "PATCH",
              bulkId: "u1",
              path: `/Users/${id}`,
              data: patch({
                op: "Replace",
                path: "userName",
                value: NEW_ADDRESS,
              }),
            },
          ],
        });
      },
    },
  ];

  test.each(changes)(
    "is answered as a free one is, for $label - the account keeps its own, and the log never says why",
    async ({ change }: { change: (id: string) => Promise<HttpResult> }) => {
      const free: Run = await readdressIn(false, change);

      // A free address moves the account this project manages ...
      expect(userAt(NEW_ADDRESS).name).toBe("Sam Rivera");
      expect(scimWorld.userByEmail(ADDRESS)).toBeUndefined();

      const taken: Run = await readdressIn(true, change);

      // ... one another account signs in with does not: each keeps its own.
      expect(userAt(ADDRESS).name).toBe("Sam Rivera");
      expect(userAt(NEW_ADDRESS).name).toBe("Someone Else");

      // The same status, answer and log, whoever has the address.
      expect(visible(taken)).toEqual(visible(free));
      expect(free.results[1]!.status).toBe(200);

      expectNoTellingWords(taken);
      expect(JSON.stringify(taken)).not.toMatch(/exists/i);
      expect(
        taken.logs.flatMap((entry: JSONObject): Array<string> => {
          return (entry["steps"] as Array<string>) || [];
        }),
      ).toEqual(expect.arrayContaining([SELF_HOSTED_EMAIL_CHANGE_STEP]));
    },
  );

  test("the account reads back with the identity provider's address either way, and signs in with its own", async () => {
    const taken: Run = await readdressIn(true, (id: string) => {
      return send(
        "PATCH",
        `/Users/${id}`,
        patch({ op: "Replace", path: "userName", value: NEW_ADDRESS }),
      );
    });

    const id: string = taken.results[0]!.body["id"] as string;
    const readBack: HttpResult = await send("GET", `/Users/${id}`);

    expect(readBack.body["userName"]).toBe(NEW_ADDRESS);
    expect(userAt(ADDRESS).id).toBe(id);
  });

  test("an address another account takes between the check and the write is kept from the account the same way, and a new name still goes through", async () => {
    const check: jest.SpiedFunction<
      typeof ProjectSCIMAccountPolicy.isAddressOfAnotherAccount
    > = jest
      .spyOn(ProjectSCIMAccountPolicy, "isAddressOfAnotherAccount")
      .mockResolvedValue(false);

    try {
      const raced: Run = await readdressIn(true, (id: string) => {
        return send(
          "PUT",
          `/Users/${id}`,
          oktaPut(NEW_ADDRESS, { givenName: "Samuel", familyName: "Rivera" }),
        );
      });

      expect(raced.results[1]!.status).toBe(200);
      expect(raced.results[1]!.body["userName"]).toBe(NEW_ADDRESS);
      expect(userAt(ADDRESS).name).toBe("Samuel Rivera");
      expect(userAt(NEW_ADDRESS).name).toBe("Someone Else");
      expectNoTellingWords(raced);
      expect(JSON.stringify(raced)).not.toMatch(/exists/i);
      expect(check).toHaveBeenCalled();
    } finally {
      check.mockRestore();
    }
  });

  test("an account this project does not manage is logged in the same words as an address that is taken", async () => {
    const elsewhere: Run = await runIn(
      AddressHistory.AccountElsewhere,
      async (): Promise<Array<HttpResult>> => {
        const created: HttpResult = await send(
          "POST",
          "/Users",
          oktaCreate(ADDRESS),
        );

        return [
          created,
          await send(
            "PATCH",
            `/Users/${created.body["id"]}`,
            patch({ op: "Replace", path: "userName", value: NEW_ADDRESS }),
          ),
          await send("GET", "/Groups"),
        ];
      },
    );

    const taken: Run = await readdressIn(true, (id: string) => {
      return send(
        "PATCH",
        `/Users/${id}`,
        patch({ op: "Replace", path: "userName", value: NEW_ADDRESS }),
      );
    });

    expect(visible(elsewhere)).toEqual(visible(taken));
    expect(userAt(ADDRESS).name).toBe("Sam Rivera");
  });
});
