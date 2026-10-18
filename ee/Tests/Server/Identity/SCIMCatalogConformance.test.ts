import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import ProjectSCIMRouter from "../../../Server/Identity/API/SCIM";
import { fakeProjectSCIMUserService } from "./FakeProjectSCIMUserService";
import { idOf, scimWorld } from "./InMemorySCIMWorld";
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
 * WHAT THE CATALOGS' TEST SUITES SEND, AND WHAT THEY CHECK.
 *
 * Listing OneUptime in the Okta Integration Network and the Microsoft Entra
 * ID application gallery means passing their SCIM test suites, run against
 * OneUptime Cloud:
 *
 *   - Okta's SCIM 2.0 spec test (Runscope): a page of users, a user by id,
 *     a userName filter for someone who does not exist (none) and for one who
 *     does in upper case (found), a 404 for an unknown id, a 201 create, a
 *     409 for the same create again - all errors in the SCIM error format.
 *     Then Okta itself: a PUT of a profile, a PATCH of active false and true,
 *     and group push - create, add, rename with a replace that has no path,
 *     remove with members[value eq "<id>"].
 *   - Microsoft Entra ID's gallery validation (an Azure Logic Apps
 *     template): the provisioning engine creates, updates, disables
 *     (the user must still come back from a userName filter, active false),
 *     restores and deletes users; groups are found by displayName with their
 *     members; direct requests write every mapped attribute - including ""
 *     and null - and read it back exactly, and page through users five at a
 *     time.
 *
 * This suite replays those requests against the real router, over HTTP, with
 * the database in memory (InMemorySCIMWorld, FakeProjectSCIMUserService), as
 * OneUptime Cloud: billing on.
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
const SCIM_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_SCHEMA: string = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA: string = "urn:ietf:params:scim:schemas:core:2.0:Group";
const ERROR_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:Error";
const LIST_SCHEMA: string =
  "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const PATCH_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

let projectConfig: ProjectSCIM;
let defaultTeamId: string;
let httpServer: Server;
let baseUrl: string;

interface HttpResult {
  status: number;
  contentType: string;
  body: JSONObject;
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
    contentType: response.headers.get("content-type") || "",
    body: (text ? JSON.parse(text) : {}) as JSONObject,
  };
}

function filterPath(resource: string, filter: string, extra?: string): string {
  return `/${resource}?filter=${encodeURIComponent(filter)}${extra ? `&${extra}` : ""}`;
}

function patch(...operations: Array<JSONObject>): JSONObject {
  return { schemas: [PATCH_SCHEMA], Operations: operations };
}

function resources(result: HttpResult): Array<JSONObject> {
  return result.body["Resources"] as Array<JSONObject>;
}

function expectScimError(result: HttpResult, status: number): void {
  expect(result.status).toBe(status);
  expect(result.contentType).toContain("application/scim+json");
  expect(result.body["schemas"]).toEqual([ERROR_SCHEMA]);
  expect(result.body["status"]).toBe(String(status));
  expect(typeof result.body["detail"]).toBe("string");
}

// A user as Okta creates one: its spec test's "realistic values".
function oktaUser(userName: string): JSONObject {
  return {
    schemas: [USER_SCHEMA],
    userName: userName,
    name: { givenName: "Fox", familyName: "Mulder" },
    emails: [{ primary: true, value: userName, type: "work" }],
    displayName: "Fox Mulder",
    locale: "en-US",
    externalId: "00u1okta2fox3mulder4",
    groups: [],
    password: "1mz050nq",
    active: true,
  };
}

// A user as Microsoft Entra ID creates one, with its default mappings.
function entraUser(userName: string, externalId: string): JSONObject {
  return {
    schemas: [
      USER_SCHEMA,
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
    ],
    externalId: externalId,
    userName: userName,
    active: true,
    displayName: "Dana Scully",
    name: { givenName: "Dana", familyName: "Scully", formatted: "Dana Scully" },
    emails: [{ primary: true, type: "work", value: userName }],
    title: "Special Agent",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
      department: "X-Files",
    },
  };
}

beforeAll(async () => {
  setTestBillingEnabled(true);
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
  scimWorld.reset();
  fakeProjectSCIMUserService.reset();

  defaultTeamId = scimWorld.seedTeam({
    projectId: PROJECT_ID,
    name: "Members",
  });

  // The account the spec test reads the first page of users with.
  const existing: string = scimWorld.seedUser({
    email: "existing.member@acme.example",
    name: "Existing Member",
  });
  scimWorld.seedMembership({
    userId: existing,
    projectId: PROJECT_ID,
    teamId: defaultTeamId,
  });

  projectConfig = new ProjectSCIM(new ObjectID(SCIM_ID));
  projectConfig.projectId = new ObjectID(PROJECT_ID);
  projectConfig.autoProvisionUsers = true;
  projectConfig.autoDeprovisionUsers = true;
  projectConfig.enablePushGroups = false;
  projectConfig.teams = [new Team(new ObjectID(defaultTeamId))];
});

describe("Okta's SCIM 2.0 spec test", () => {
  test("a page of one user, with the attributes Okta reads", async () => {
    const page: HttpResult = await send("GET", "/Users?count=1&startIndex=1");

    expect(page.status).toBe(200);
    expect(page.contentType).toContain("application/scim+json");
    expect(page.body["schemas"]).toEqual([LIST_SCHEMA]);
    expect(page.body["startIndex"]).toBe(1);
    expect(page.body["itemsPerPage"]).toBe(1);
    expect(page.body["totalResults"]).toBe(1);

    const user: JSONObject = resources(page)[0]!;
    expect(user["id"]).toBeTruthy();
    expect(user["userName"]).toBe("existing.member@acme.example");
    expect(user["name"]).toEqual(
      expect.objectContaining({ givenName: "Existing", familyName: "Member" }),
    );
    expect(user["emails"]).toEqual([
      { value: "existing.member@acme.example", type: "work", primary: true },
    ]);
    expect(user["active"]).toBe(true);

    const byId: HttpResult = await send("GET", `/Users/${user["id"]}`);

    expect(byId.status).toBe(200);
    expect(byId.body["id"]).toBe(user["id"]);
  });

  test("a userName filter for someone who does not exist finds no one, and creates no one", async () => {
    const result: HttpResult = await send(
      "GET",
      filterPath("Users", 'userName eq "random.4kx9q2@example.com"'),
    );

    expect(result.status).toBe(200);
    expect(result.body["totalResults"]).toBe(0);
    expect(resources(result)).toEqual([]);
    expect(scimWorld.userByEmail("random.4kx9q2@example.com")).toBeUndefined();
  });

  test("an unknown id is 404 in the SCIM error format", async () => {
    expectScimError(
      await send("GET", `/Users/${ObjectID.generate().toString()}`),
      404,
    );
  });

  test("create, read back, create again (409), and find in upper case", async () => {
    const created: HttpResult = await send(
      "POST",
      "/Users",
      oktaUser("Fox.Mulder@acme.example"),
    );

    expect(created.status).toBe(201);
    expect(created.body["id"]).toBeTruthy();
    expect(created.body["active"]).toBe(true);
    expect(created.body["userName"]).toBe("Fox.Mulder@acme.example");

    const readBack: HttpResult = await send(
      "GET",
      `/Users/${created.body["id"]}`,
    );

    expect(readBack.body["userName"]).toBe("Fox.Mulder@acme.example");
    expect(readBack.body["name"]).toEqual(
      expect.objectContaining({ givenName: "Fox", familyName: "Mulder" }),
    );

    const again: HttpResult = await send(
      "POST",
      "/Users",
      oktaUser("Fox.Mulder@acme.example"),
    );

    expectScimError(again, 409);
    expect(again.body["scimType"]).toBe("uniqueness");

    const upperCase: HttpResult = await send(
      "GET",
      filterPath("Users", 'userName eq "FOX.MULDER@ACME.EXAMPLE"'),
    );

    expect(upperCase.body["totalResults"]).toBe(1);
    expect(resources(upperCase)[0]!["id"]).toBe(created.body["id"]);
  });

  test("the Groups endpoint answers a list", async () => {
    const groups: HttpResult = await send("GET", "/Groups");

    expect(groups.status).toBe(200);
    expect(groups.body["schemas"]).toEqual([LIST_SCHEMA]);
    expect(groups.body["totalResults"]).toBe(1);
  });
});

describe("Okta's provisioning", () => {
  test("a profile update (PUT), a deactivation and a reactivation (PATCH)", async () => {
    const created: HttpResult = await send(
      "POST",
      "/Users",
      oktaUser("fox.mulder@acme.example"),
    );
    const id: string = created.body["id"] as string;

    const updated: HttpResult = await send("PUT", `/Users/${id}`, {
      ...oktaUser("fox.mulder@acme.example"),
      name: { givenName: "Fox William", familyName: "Mulder" },
    });

    expect(updated.status).toBe(200);
    expect(updated.body["name"]).toEqual(
      expect.objectContaining({ givenName: "Fox William" }),
    );
    // An account SCIM created here and nowhere else takes the new name.
    expect(scimWorld.userByEmail("fox.mulder@acme.example")!.name).toBe(
      "Fox William Mulder",
    );

    const deactivated: HttpResult = await send(
      "PATCH",
      `/Users/${id}`,
      patch({ op: "replace", value: { active: false } }),
    );

    expect(deactivated.status).toBe(200);
    expect(deactivated.body["active"]).toBe(false);
    expect(scimWorld.teamIdsOf(id, PROJECT_ID)).toEqual([]);
    expect((await send("GET", `/Users/${id}`)).body["active"]).toBe(false);

    const reactivated: HttpResult = await send(
      "PATCH",
      `/Users/${id}`,
      patch({ op: "replace", value: { active: true } }),
    );

    expect(reactivated.body["active"]).toBe(true);
    expect(scimWorld.teamIdsOf(id, PROJECT_ID)).toEqual([defaultTeamId]);
  });

  test("group push: create, add, rename with no path, remove by filter", async () => {
    const user: HttpResult = await send(
      "POST",
      "/Users",
      oktaUser("fox.mulder@acme.example"),
    );
    const userId: string = user.body["id"] as string;

    const group: HttpResult = await send("POST", "/Groups", {
      schemas: [GROUP_SCHEMA],
      displayName: "X-Files",
      members: [],
    });

    expect(group.status).toBe(201);
    const groupId: string = group.body["id"] as string;

    const added: HttpResult = await send(
      "PATCH",
      `/Groups/${groupId}`,
      patch({
        op: "add",
        path: "members",
        value: [{ value: userId, display: "fox.mulder@acme.example" }],
      }),
    );

    expect(added.status).toBeLessThan(300);

    const read: HttpResult = await send("GET", `/Groups/${groupId}`);

    expect(read.body["members"]).toEqual([
      expect.objectContaining({ value: userId }),
    ]);

    const renamed: HttpResult = await send(
      "PATCH",
      `/Groups/${groupId}`,
      patch({
        op: "replace",
        value: { id: groupId, displayName: "X-Files Unit" },
      }),
    );

    expect(renamed.status).toBeLessThan(300);
    expect((await send("GET", `/Groups/${groupId}`)).body["displayName"]).toBe(
      "X-Files Unit",
    );

    const removed: HttpResult = await send(
      "PATCH",
      `/Groups/${groupId}`,
      patch({ op: "remove", path: `members[value eq "${userId}"]` }),
    );

    expect(removed.status).toBeLessThan(300);
    expect((await send("GET", `/Groups/${groupId}`)).body["members"]).toEqual(
      [],
    );
  });
});

describe("Microsoft Entra ID's gallery validation", () => {
  test("create, find by userName and by externalId", async () => {
    const created: HttpResult = await send(
      "POST",
      "/Users",
      entraUser("dana.scully@contoso.example", "4b1c-entra-object-id"),
    );

    expect(created.status).toBe(201);
    expect(created.body["externalId"]).toBe("4b1c-entra-object-id");

    for (const filter of [
      'userName eq "dana.scully@contoso.example"',
      'externalId eq "4b1c-entra-object-id"',
      'userName eq "dana.scully@contoso.example" and externalId eq "4b1c-entra-object-id"',
    ]) {
      const found: HttpResult = await send("GET", filterPath("Users", filter));

      expect(found.body["totalResults"]).toBe(1);
      expect(resources(found)[0]!["id"]).toBe(created.body["id"]);
    }

    const otherCase: HttpResult = await send(
      "GET",
      filterPath("Users", 'externalId eq "4B1C-ENTRA-OBJECT-ID"'),
    );

    // externalId is case-exact.
    expect(otherCase.body["totalResults"]).toBe(0);
  });

  test("every mapped attribute written is read back exactly, the userName too", async () => {
    const created: HttpResult = await send(
      "POST",
      "/Users",
      entraUser("dana.scully@contoso.example", "dana-1"),
    );
    const id: string = created.body["id"] as string;

    const updated: HttpResult = await send(
      "PATCH",
      `/Users/${id}`,
      patch(
        {
          op: "Replace",
          path: "userName",
          value: "updated-dana@contoso.example",
        },
        { op: "Replace", path: "displayName", value: "Dana Scully - Updated" },
        { op: "Replace", path: "name.givenName", value: "upd-3a4b5c6d" },
        { op: "Replace", path: "name.familyName", value: "upd-7e8f9a0b" },
        { op: "Replace", path: "externalId", value: "upd-1c2d3e4f" },
        {
          op: "Replace",
          path: 'emails[type eq "work"].value',
          value: "updated-dana@contoso.example",
        },
      ),
    );

    expect(updated.status).toBe(200);

    const readBack: HttpResult = await send("GET", `/Users/${id}`);

    expect(readBack.body).toEqual(
      expect.objectContaining({
        userName: "updated-dana@contoso.example",
        displayName: "Dana Scully - Updated",
        externalId: "upd-1c2d3e4f",
        name: expect.objectContaining({
          givenName: "upd-3a4b5c6d",
          familyName: "upd-7e8f9a0b",
        }),
        emails: [
          expect.objectContaining({
            type: "work",
            value: "updated-dana@contoso.example",
          }),
        ],
      }),
    );

    // On OneUptime Cloud the account keeps the address it signs in with.
    expect(scimWorld.userByEmail("dana.scully@contoso.example")).toBeDefined();
    expect(
      scimWorld.userByEmail("updated-dana@contoso.example"),
    ).toBeUndefined();
  });

  test("a null update clears each attribute: empty, or left out", async () => {
    const created: HttpResult = await send(
      "POST",
      "/Users",
      entraUser("dana.scully@contoso.example", "dana-1"),
    );
    const id: string = created.body["id"] as string;

    expect(
      (
        await send(
          "PATCH",
          `/Users/${id}`,
          patch(
            { op: "Replace", path: "displayName", value: "" },
            { op: "Replace", path: "name.givenName", value: "" },
          ),
        )
      ).status,
    ).toBe(200);

    const emptied: HttpResult = await send("GET", `/Users/${id}`);

    expect(emptied.body["displayName"]).toBe("");
    expect((emptied.body["name"] as JSONObject)["givenName"]).toBe("");

    expect(
      (
        await send(
          "PATCH",
          `/Users/${id}`,
          patch(
            { op: "Replace", path: "displayName", value: null },
            { op: "Replace", path: "name.givenName", value: null },
            { op: "Replace", path: "externalId", value: null },
          ),
        )
      ).status,
    ).toBe(200);

    const nulled: HttpResult = await send("GET", `/Users/${id}`);

    expect("displayName" in nulled.body).toBe(false);
    expect("givenName" in (nulled.body["name"] as JSONObject)).toBe(false);
    expect("externalId" in nulled.body).toBe(false);
  });

  test("a disabled user is still found by userName, active false; restored, active true", async () => {
    const created: HttpResult = await send(
      "POST",
      "/Users",
      entraUser("dana.scully@contoso.example", "dana-1"),
    );
    const id: string = created.body["id"] as string;

    expect(
      (
        await send(
          "PATCH",
          `/Users/${id}`,
          patch({ op: "Replace", path: "active", value: "False" }),
        )
      ).status,
    ).toBe(200);

    const disabled: HttpResult = await send(
      "GET",
      filterPath("Users", 'userName eq "dana.scully@contoso.example"'),
    );

    expect(disabled.body["totalResults"]).toBe(1);
    expect(resources(disabled)[0]!["active"]).toBe(false);
    expect(scimWorld.teamIdsOf(id, PROJECT_ID)).toEqual([]);

    await send(
      "PATCH",
      `/Users/${id}`,
      patch({ op: "Replace", path: "active", value: "True" }),
    );

    const restored: HttpResult = await send(
      "GET",
      filterPath("Users", 'userName eq "dana.scully@contoso.example"'),
    );

    expect(resources(restored)[0]!["active"]).toBe(true);
    expect(scimWorld.teamIdsOf(id, PROJECT_ID)).toEqual([defaultTeamId]);
  });

  test("a deleted user is 404 by id and gone from the userName filter", async () => {
    const created: HttpResult = await send(
      "POST",
      "/Users",
      entraUser("dana.scully@contoso.example", "dana-1"),
    );
    const id: string = created.body["id"] as string;

    const deleted: HttpResult = await send("DELETE", `/Users/${id}`);

    expect(deleted.status).toBe(204);
    expectScimError(await send("GET", `/Users/${id}`), 404);
    expect(
      (
        await send(
          "GET",
          filterPath("Users", 'userName eq "dana.scully@contoso.example"'),
        )
      ).body["totalResults"],
    ).toBe(0);
  });

  test("users page five at a time, with startIndex and totalResults", async () => {
    for (let i: number = 0; i < 11; i++) {
      expect(
        (
          await send(
            "POST",
            "/Users",
            entraUser(`user${i}@contoso.example`, `object-${i}`),
          )
        ).status,
      ).toBe(201);
    }

    const seen: Set<string> = new Set<string>();

    for (const [startIndex, expected] of [
      [1, 5],
      [6, 5],
      [11, 2],
    ] as Array<[number, number]>) {
      const page: HttpResult = await send(
        "GET",
        `/Users?startIndex=${startIndex}&count=5`,
      );

      expect(page.body["startIndex"]).toBe(startIndex);
      expect(page.body["totalResults"]).toBe(12);
      expect(resources(page)).toHaveLength(expected);

      for (const user of resources(page)) {
        seen.add(user["id"] as string);
      }
    }

    // Every user once: the order holds from one page to the next.
    expect(seen.size).toBe(12);
  });

  test("groups: found by displayName with their members, which follow Add and Remove", async () => {
    const user: HttpResult = await send(
      "POST",
      "/Users",
      entraUser("dana.scully@contoso.example", "dana-1"),
    );
    const userId: string = user.body["id"] as string;

    const group: HttpResult = await send("POST", "/Groups", {
      schemas: [GROUP_SCHEMA],
      displayName: "Agents",
    });
    const groupId: string = group.body["id"] as string;

    await send(
      "PATCH",
      `/Groups/${groupId}`,
      patch({ op: "Add", path: "members", value: [{ value: userId }] }),
    );

    const withMember: HttpResult = await send(
      "GET",
      filterPath("Groups", 'displayName eq "agents"'),
    );

    expect(withMember.body["totalResults"]).toBe(1);
    expect(resources(withMember)[0]!["members"]).toEqual([
      expect.objectContaining({ value: userId }),
    ]);

    const withoutMembers: HttpResult = await send(
      "GET",
      filterPath(
        "Groups",
        'displayName eq "Agents"',
        "excludedAttributes=members",
      ),
    );

    expect("members" in resources(withoutMembers)[0]!).toBe(false);

    await send(
      "PATCH",
      `/Groups/${groupId}`,
      patch({ op: "Remove", path: "members", value: [{ value: userId }] }),
    );

    const afterRemove: HttpResult = await send(
      "GET",
      filterPath("Groups", 'displayName eq "Agents"'),
    );

    expect(resources(afterRemove)[0]!["members"]).toEqual([]);

    await send(
      "PATCH",
      `/Groups/${groupId}`,
      patch({ op: "Replace", path: "displayName", value: "Agents-Modified" }),
    );

    expect(
      (
        await send(
          "GET",
          filterPath("Groups", 'displayName eq "Agents-Modified"'),
        )
      ).body["totalResults"],
    ).toBe(1);

    expect((await send("DELETE", `/Groups/${groupId}`)).status).toBe(204);
    expect(
      (
        await send(
          "GET",
          filterPath("Groups", 'displayName eq "Agents-Modified"'),
        )
      ).body["totalResults"],
    ).toBe(0);
  });

  test("a group's members are listed for the groups a user is in", async () => {
    const user: HttpResult = await send(
      "POST",
      "/Users",
      entraUser("dana.scully@contoso.example", "dana-1"),
    );
    const userId: string = user.body["id"] as string;

    const group: HttpResult = await send("POST", "/Groups", {
      displayName: "Agents",
      members: [{ value: userId }],
    });

    const found: HttpResult = await send(
      "GET",
      filterPath(
        "Groups",
        `id eq "${group.body["id"]}" and members[value eq "${userId}"]`,
        "excludedAttributes=members",
      ),
    );

    expect(found.body["totalResults"]).toBe(1);

    const notAMember: HttpResult = await send(
      "GET",
      filterPath(
        "Groups",
        `id eq "${group.body["id"]}" and members[value eq "${ObjectID.generate().toString()}"]`,
      ),
    );

    expect(notAMember.body["totalResults"]).toBe(0);
  });

  test("the schemas name every attribute the gallery app maps", async () => {
    const schemas: HttpResult = await send("GET", "/Schemas");

    expect(schemas.status).toBe(200);

    const user: JSONObject = resources(schemas).find((schema: JSONObject) => {
      return schema["id"] === USER_SCHEMA;
    })!;
    const group: JSONObject | undefined = resources(schemas).find(
      (schema: JSONObject) => {
        return schema["id"] === GROUP_SCHEMA;
      },
    );

    expect(group).toBeDefined();

    const attributes: Array<JSONObject> = user[
      "attributes"
    ] as Array<JSONObject>;
    const names: Array<string> = attributes.map((attribute: JSONObject) => {
      return attribute["name"] as string;
    });

    expect(names).toEqual(
      expect.arrayContaining([
        "userName",
        "name",
        "displayName",
        "emails",
        "active",
      ]),
    );

    const emails: JSONObject = attributes.find((attribute: JSONObject) => {
      return attribute["name"] === "emails";
    })!;
    const type: JSONObject = (
      emails["subAttributes"] as Array<JSONObject>
    ).find((attribute: JSONObject) => {
      return attribute["name"] === "type";
    })!;

    expect(type["canonicalValues"]).toEqual(expect.arrayContaining(["work"]));

    const name: JSONObject = attributes.find((attribute: JSONObject) => {
      return attribute["name"] === "name";
    })!;

    expect(
      (name["subAttributes"] as Array<JSONObject>).map(
        (attribute: JSONObject) => {
          return attribute["name"];
        },
      ),
    ).toEqual(expect.arrayContaining(["givenName", "familyName"]));
  });
});

describe("what neither catalog sends, OneUptime refuses rather than guesses", () => {
  test("a filter on an attribute OneUptime does not keep is 400 invalidFilter, never every user", async () => {
    const result: HttpResult = await send(
      "GET",
      filterPath("Users", 'title eq "Special Agent"'),
    );

    expectScimError(result, 400);
    expect(result.body["scimType"]).toBe("invalidFilter");
  });

  test("a filter that is not equalities joined by and is 400 invalidFilter", async () => {
    const result: HttpResult = await send(
      "GET",
      filterPath("Users", 'userName sw "dana"'),
    );

    expectScimError(result, 400);
    expect(result.body["scimType"]).toBe("invalidFilter");
  });

  test("a count of 0 answers totalResults alone", async () => {
    const result: HttpResult = await send("GET", "/Users?count=0");

    expect(result.body["totalResults"]).toBe(1);
    expect(resources(result)).toEqual([]);
  });

  test("ServiceProviderConfig says what OneUptime does: no sorting", async () => {
    const config: HttpResult = await send("GET", "/ServiceProviderConfig");

    expect((config.body["sort"] as JSONObject)["supported"]).toBe(false);
    expect((config.body["filter"] as JSONObject)["supported"]).toBe(true);
    expect((config.body["patch"] as JSONObject)["supported"]).toBe(true);
  });

  test("a group member's $ref and a group's location are under the SCIM base URL", async () => {
    const group: HttpResult = await send("POST", "/Groups", {
      displayName: "Agents",
    });

    expect((group.body["meta"] as JSONObject)["location"] as string).toContain(
      `/identity/scim/v2/${SCIM_ID}/Groups/${group.body["id"]}`,
    );
    expect(idOf(group.body["id"])).toBeTruthy();
  });
});
