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
 * statuses, the same answers and the same log, apart from ids and times -
 * and to the same password-hash work. The payloads are what Okta and
 * Microsoft Entra ID send.
 *
 * What still differs, and is pinned here as the known residual: on OneUptime
 * Cloud an existing account is invited where a new one is added
 * (ProjectSCIMAccountPolicy), which the project's Users list shows; and an
 * account this project does not manage keeps its own name and address, which
 * the Users list shows of its members.
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
}

const createPayloads: Array<CreatePayload> = [
  { label: "Okta, with a password", body: oktaCreate, sendsName: true },
  {
    label: "Okta, without a password",
    body: oktaCreateWithoutPassword,
    sendsName: true,
  },
  { label: "Microsoft Entra ID", body: entraCreate, sendsName: true },
  {
    label: "Microsoft Entra ID's validator (a userName that is no address)",
    body: entraValidatorCreate,
    sendsName: true,
  },
  { label: "a provider that maps no name", body: nameless, sendsName: false },
  {
    label: "a userName and nothing else",
    body: userNameOnly,
    sendsName: false,
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

  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as JSONObject,
    location: response.headers.get("location"),
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

function membershipsOf(userId: string): Array<WorldMembership> {
  return scimWorld.memberships.filter((row: WorldMembership): boolean => {
    return row.userId === idOf(userId) && row.projectId === PROJECT_ID;
  });
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
    ({ body, sendsName }: CreatePayload) => {
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
   * The membership is the one thing that differs, and the project's Users
   * list shows it: on OneUptime Cloud an account that existed is invited,
   * one SCIM creates is added (ProjectSCIMAccountPolicy, unchanged by
   * #9825). A self-hosted install adds both.
   */
  test("the residual: how the account joins the project's teams", async () => {
    // The teams the account was put in, by name, as the world it ran in has them.
    const teamsOf: (rows: Array<WorldMembership>) => Array<string> = (
      rows: Array<WorldMembership>,
    ): Array<string> => {
      return rows
        .map((row: WorldMembership): string => {
          return row.teamId === membersTeamId
            ? "Members"
            : row.teamId === respondersTeamId
              ? "Responders"
              : row.teamId;
        })
        .sort();
    };

    await runIn(
      AddressHistory.NoAccount,
      async (): Promise<Array<HttpResult>> => {
        return [await send("POST", "/Users", oktaCreate(ADDRESS))];
      },
    );
    const freshRows: Array<WorldMembership> = membershipsOf(userAt(ADDRESS).id);
    expect(teamsOf(freshRows)).toEqual(["Members", "Responders"]);

    await runIn(
      AddressHistory.AccountElsewhere,
      async (): Promise<Array<HttpResult>> => {
        return [await send("POST", "/Users", oktaCreate(ADDRESS))];
      },
    );
    const existingRows: Array<WorldMembership> = membershipsOf(
      userAt(ADDRESS).id,
    );
    expect(teamsOf(existingRows)).toEqual(["Members", "Responders"]);

    expect(
      freshRows.every((row: WorldMembership): boolean => {
        return row.hasAcceptedInvitation;
      }),
    ).toBe(true);
    expect(
      existingRows.every((row: WorldMembership): boolean => {
        return row.hasAcceptedInvitation === !hosted;
      }),
    ).toBe(true);
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

    /*
     * The residual: an account this project manages takes the name, one in
     * another customer's project keeps its own - which the project's Users
     * list shows of its members, and its answers and log do not.
     */
    await runIn(AddressHistory.NoAccount, renamed);
    expect(userAt(ADDRESS).name).toBe("Samuel Rivera");

    await runIn(AddressHistory.AccountElsewhere, renamed);
    expect(userAt(ADDRESS).name).toBe(OWN_NAME);
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

        return [created, await change(created.body["id"] as string)];
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
