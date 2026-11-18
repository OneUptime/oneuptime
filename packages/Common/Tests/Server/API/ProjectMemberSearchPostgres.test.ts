import { mockRouter } from "./Helpers";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import CacheGenerations from "../../../Server/Infrastructure/CacheGenerations";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Response from "../../../Server/Utils/Response";
import Entities from "../../../Models/DatabaseModels/Index";
import User from "../../../Models/DatabaseModels/User";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  PROJECT_MEMBER_SEARCH_ROUTE,
  ProjectMemberSearchMatch,
} from "../../../Types/Team/ProjectMemberSearch";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * SEARCH'S PEOPLE, against a migrated Postgres (#7036).
 *
 * Cmd/Ctrl+K finds a project's people by name or email through POST
 * /team-member/search-members. Here the request goes through the real user
 * middleware - which reads the member's team and its permission rows from
 * the tables below - the route, the permission pipeline, the query
 * serializer and TypeORM, so each search runs as the SQL Postgres runs: a
 * filter through each membership to its user, by name and by email, in the
 * request's project, with the caller's own permissions. It holds:
 *
 *   - a teammate found by part of their name, and by their email; an invited
 *     person with no name yet, by their email; a person on two teams, once;
 *   - nothing found for words nobody has;
 *   - nobody outside the project: someone who is only in another project is
 *     found neither by name nor by email, and the answer is the one an
 *     address nobody has gets, so it never says whether an email exists
 *     elsewhere; a removed membership is no membership;
 *   - what was typed matched literally (a % or _ is no wildcard);
 *   - a few people at most;
 *   - a member who may not see the project's people refused, a team's block
 *     too, and a viewer answered;
 *   - emails neither searched nor answered for a reader the Users page would
 *     not show them to;
 *   - one letter refused rather than answered with everyone.
 *
 * Opt in with RUN_POSTGRES_PROJECT_MEMBER_SEARCH_TESTS=true against a
 * database the registered migrations have been applied to, e.g. from
 * packages/Common:
 *
 *   RUN_POSTGRES_PROJECT_MEMBER_SEARCH_TESTS=true \
 *   PROJECT_MEMBER_SEARCH_TEST_DATABASE_HOST=127.0.0.1 \
 *   PROJECT_MEMBER_SEARCH_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/API/ProjectMemberSearchPostgres.test.ts --forceExit
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is dropped
 * afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROJECT_MEMBER_SEARCH_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// The tables a member's request reads: who they are, their teams, their grants.
const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "CustomRole",
  "CustomRolePermission",
  "CustomRolePermissionLabel",
  "TeamCustomRole",
];

interface Searched {
  error?: unknown;
  members?: Array<ProjectMemberSearchMatch>;
}

describePostgres("Search's people, on migrated Postgres (#7036)", () => {
  const schema: string = `member_search_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;

  let database: DataSource;

  // The team member routes, as the app registers them.
  mockRouter.routes.length = 0;
  new TeamMemberAPI();

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  // The member every request is made as, and the people they look for.
  const memberId: ObjectID = ObjectID.generate();
  const adaId: ObjectID = ObjectID.generate();
  const bobId: ObjectID = ObjectID.generate();
  const eveId: ObjectID = ObjectID.generate();
  const carolId: ObjectID = ObjectID.generate();
  const frankId: ObjectID = ObjectID.generate();
  const percentId: ObjectID = ObjectID.generate();
  const adamIds: Array<ObjectID> = [1, 2, 3, 4, 5].map((): ObjectID => {
    return ObjectID.generate();
  });

  const readersTeamId: ObjectID = ObjectID.generate();
  const sreTeamId: ObjectID = ObjectID.generate();
  const paymentsTeamId: ObjectID = ObjectID.generate();
  const otherTeamId: ObjectID = ObjectID.generate();

  const insert: (
    table: string,
    row: Dictionary<unknown>,
  ) => Promise<void> = async (
    table: string,
    row: Dictionary<unknown>,
  ): Promise<void> => {
    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        const value: unknown = row[column];

        return value instanceof ObjectID ? value.toString() : value;
      }),
    );
  };

  // The member's team's own permission rows, replaced.
  const setGrants: (
    rows: Array<{ permission: Permission; isBlock?: boolean }>,
  ) => Promise<void> = async (
    rows: Array<{ permission: Permission; isBlock?: boolean }>,
  ): Promise<void> => {
    await database.query(
      `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
      [readersTeamId.toString()],
    );

    for (const row of rows) {
      await insert("TeamPermission", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: readersTeamId,
        permission: row.permission,
        isBlockPermission: Boolean(row.isBlock),
        scope: PermissionScope.All,
        version: 1,
      });
    }
  };

  const responseStub: () => ExpressResponse = (): ExpressResponse => {
    return {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as unknown as ExpressResponse;
  };

  // A search, through the route, as the Dashboard's Search sends it.
  const search: (text: unknown) => Promise<Searched> = async (
    text: unknown,
  ): Promise<Searched> => {
    jest.mocked(Response.sendJsonObjectResponse).mockClear();
    jest.mocked(Response.sendErrorResponse).mockClear();

    const req: ExpressRequest = {
      method: "POST",
      params: {},
      query: {},
      cookies: {},
      headers: {
        authorization: `Bearer ${memberId.toString()}`,
        tenantid: projectId.toString(),
      },
      body: { text: text },
    } as unknown as ExpressRequest;
    const res: ExpressResponse = responseStub();
    const route: (typeof mockRouter.routes)[number] = mockRouter.match(
      "post",
      PROJECT_MEMBER_SEARCH_ROUTE,
    );

    for (const middleware of route.middlewares) {
      let isPassed: boolean = false;

      await middleware(req, res, ((error?: unknown) => {
        if (!error) {
          isPassed = true;
        }
      }) as NextFunction);

      if (!isPassed) {
        return {
          error: jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2],
        };
      }
    }

    let forwardedError: unknown = undefined;

    await route.handlerFunction(req, res, ((error: unknown) => {
      forwardedError = error;
    }) as NextFunction);

    if (forwardedError) {
      return { error: forwardedError };
    }

    const call: Array<unknown> | undefined = jest.mocked(
      Response.sendJsonObjectResponse,
    ).mock.calls[0];

    if (!call) {
      throw new Error(`${PROJECT_MEMBER_SEARCH_ROUTE} answered nothing.`);
    }

    return {
      members: (call[2] as JSONObject)[
        "members"
      ] as unknown as Array<ProjectMemberSearchMatch>,
    };
  };

  const idsOf: (searched: Searched) => Array<string> = (
    searched: Searched,
  ): Array<string> => {
    return (searched.members || []).map(
      (member: ProjectMemberSearchMatch): string => {
        return member.userId;
      },
    );
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["PROJECT_MEMBER_SEARCH_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PROJECT_MEMBER_SEARCH_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PROJECT_MEMBER_SEARCH_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      /*
       * No schema of its own: table names stay unqualified, so the tables
       * copied into the test schema are found first, and every other table
       * a read touches is found, empty, in public.
       */
      synchronize: false,
      logging: ["error"],
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
      database,
    );

    // The session token names the member; it is not a signed token here.
    getJestSpyOn(JSONWebToken, "decode").mockImplementation(((
      token: string,
    ): JSONWebTokenData => {
      return {
        userId: new ObjectID(token),
        isMasterAdmin: false,
        isGlobalLogin: true,
      } as JSONWebTokenData;
    }) as never);

    // Permissions are read from the tables every time: nothing is cached.
    getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
    getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
    getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(RealtimeAccessChanges, "announce").mockReturnValue(
      undefined as never,
    );
    getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(
      false as never,
    );
    getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(
      false as never,
    );
    getJestSpyOn(
      GlobalConfigService,
      "getRequireSsoForLogin",
    ).mockResolvedValue(false as never);
    getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
      key: string;
      namespace: string;
    }): Promise<unknown> => {
      return { key: data.key, namespace: data.namespace };
    }) as never);
    getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    getJestSpyOn(CacheGenerations.prototype, "bump").mockResolvedValue(
      undefined as never,
    );

    for (const [id, name] of [
      [projectId, "Member search project"],
      [otherProjectId, "Another project"],
    ] as Array<[ObjectID, string]>) {
      await insert("Project", {
        _id: id,
        name: name,
        slug: id.toString(),
        version: 1,
      });
    }

    const people: Array<[ObjectID, string | null, string]> = [
      [memberId, "Synthetic Member", `member-${memberId.toString()}@acme.test`],
      [adaId, "Ada Lovelace", "ada.lovelace@acme.test"],
      [bobId, "Bob Builder", "bob@acme.test"],
      // Invited, not signed up: no name yet.
      [eveId, null, "eve@acme.test"],
      // In another project only.
      [carolId, "Carol Danvers", "carol@other.test"],
      // Was a member: the membership is marked deleted.
      [frankId, "Frank Removed", "frank@acme.test"],
      [percentId, "Percent 50% Off", "percent@acme.test"],
      ...adamIds.map(
        (id: ObjectID, index: number): [ObjectID, string, string] => {
          return [id, `Adam ${index + 1}`, `adam${index + 1}@acme.test`];
        },
      ),
    ];

    for (const [id, name, email] of people) {
      await insert("User", {
        _id: id,
        ...(name !== null ? { name: name } : {}),
        email: email,
        slug: id.toString(),
        version: 1,
      });
    }

    for (const [teamId, inProject] of [
      [readersTeamId, projectId],
      [sreTeamId, projectId],
      [paymentsTeamId, projectId],
      [otherTeamId, otherProjectId],
    ] as Array<[ObjectID, ObjectID]>) {
      await insert("Team", {
        _id: teamId,
        projectId: inProject,
        name: `Team ${teamId.toString()}`,
        slug: teamId.toString(),
        version: 1,
      });
    }

    const memberships: Array<{
      userId: ObjectID;
      teamId: ObjectID;
      inProject: ObjectID;
      hasAccepted?: boolean;
      isDeleted?: boolean;
    }> = [
      { userId: memberId, teamId: readersTeamId, inProject: projectId },
      // Ada is on two teams of the project.
      { userId: adaId, teamId: sreTeamId, inProject: projectId },
      { userId: adaId, teamId: paymentsTeamId, inProject: projectId },
      { userId: bobId, teamId: sreTeamId, inProject: projectId },
      {
        userId: eveId,
        teamId: sreTeamId,
        inProject: projectId,
        hasAccepted: false,
      },
      { userId: carolId, teamId: otherTeamId, inProject: otherProjectId },
      {
        userId: frankId,
        teamId: sreTeamId,
        inProject: projectId,
        isDeleted: true,
      },
      { userId: percentId, teamId: sreTeamId, inProject: projectId },
      ...adamIds.map((id: ObjectID) => {
        return { userId: id, teamId: sreTeamId, inProject: projectId };
      }),
    ];

    for (const membership of memberships) {
      await insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: membership.inProject,
        teamId: membership.teamId,
        userId: membership.userId,
        hasAcceptedInvitation: membership.hasAccepted !== false,
        version: 1,
        ...(membership.isDeleted ? { deletedAt: new Date() } : {}),
      });
    }

    // The member's team: an ordinary member of the project.
    await setGrants([{ permission: Permission.ProjectMember }]);
  }, 300000);

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("a teammate is found by part of their name, with their email", async () => {
    const searched: Searched = await search("lovel");

    expect(searched.error).toBeUndefined();
    expect(searched.members).toEqual([
      {
        userId: adaId.toString(),
        name: "Ada Lovelace",
        email: "ada.lovelace@acme.test",
      },
    ]);
  });

  test("…and by their email, whatever its case", async () => {
    expect(idsOf(await search("bob@acme"))).toEqual([bobId.toString()]);
    expect(idsOf(await search("BOB@ACME.TEST"))).toEqual([bobId.toString()]);
  });

  test("someone invited who has no name yet is found by their email", async () => {
    expect((await search("eve@")).members).toEqual([
      { userId: eveId.toString(), name: "", email: "eve@acme.test" },
    ]);
  });

  test("a person on two teams is one result", async () => {
    expect(idsOf(await search("ada.lovelace"))).toEqual([adaId.toString()]);
  });

  test("words nobody has find nobody", async () => {
    expect((await search("zzqx")).members).toEqual([]);
  });

  test("someone only in another project is found neither by name nor by email, and the answer is the one an address nobody has gets", async () => {
    const byName: Searched = await search("carol");
    const byEmail: Searched = await search("carol@other.test");
    const byNobodysEmail: Searched = await search("nobody@nowhere.test");

    expect(byName.error).toBeUndefined();
    expect(byName.members).toEqual([]);
    expect(byEmail.members).toEqual([]);
    expect(byEmail).toEqual(byNobodysEmail);
  });

  test("a removed membership is no membership", async () => {
    expect((await search("frank")).members).toEqual([]);
  });

  test("what was typed is matched literally: a % or _ is no wildcard", async () => {
    expect(idsOf(await search("50%"))).toEqual([percentId.toString()]);
    // As wildcards, "5_%" would match "50% Off".
    expect((await search("5_%")).members).toEqual([]);
    // "%%" is two percent signs, not everyone.
    expect((await search("%%")).members).toEqual([]);
  });

  test("a few people at most, the best match first", async () => {
    const searched: Searched = await search("ad");

    expect(searched.members).toHaveLength(5);
    expect(idsOf(searched)[0]).toBe(adaId.toString());
    expect(idsOf(searched)).not.toContain(carolId.toString());
  });

  test("one letter is refused, rather than answered with everyone", async () => {
    expect((await search("a")).error).toBeInstanceOf(BadDataException);
    expect((await search(" ")).error).toBeInstanceOf(BadDataException);
  });

  test("a viewer sees the project's people", async () => {
    await setGrants([{ permission: Permission.Viewer }]);

    try {
      expect(idsOf(await search("lovel"))).toEqual([adaId.toString()]);
    } finally {
      await setGrants([{ permission: Permission.ProjectMember }]);
    }
  });

  /*
   * Every member of a project holds Project User, which lets them see its
   * people (member profiles), as it lets them see the Users page: a member
   * whose only role reads services still finds their teammates.
   */
  test("a member whose role only reads services still sees the project's people, as on the Users page", async () => {
    await setGrants([{ permission: Permission.ReadService }]);

    try {
      expect(idsOf(await search("lovel"))).toEqual([adaId.toString()]);
    } finally {
      await setGrants([{ permission: Permission.ProjectMember }]);
    }
  });

  test("a member whose team takes the project's people away from them is refused", async () => {
    await setGrants([
      { permission: Permission.ReadService },
      { permission: Permission.ProjectUser, isBlock: true },
    ]);

    try {
      const searched: Searched = await search("lovel");

      expect(searched.error).toBeInstanceOf(NotAuthorizedException);
      expect(searched.members).toBeUndefined();
    } finally {
      await setGrants([{ permission: Permission.ProjectMember }]);
    }
  });

  test("a team's block on the permission that lets them is a refusal too", async () => {
    await setGrants([
      { permission: Permission.ProjectMember },
      { permission: Permission.ProjectMember, isBlock: true },
    ]);

    try {
      expect((await search("lovel")).error).toBeInstanceOf(
        NotAuthorizedException,
      );
    } finally {
      await setGrants([{ permission: Permission.ProjectMember }]);
    }
  });

  /*
   * Every reader of the project's people sees their emails today. Were the
   * Users page ever to keep them from a reader, a search by email would read
   * an address out one guess at a time: so the search asks the page's own
   * check, here made to refuse, and neither searches by email nor answers
   * one.
   */
  test("for a reader the Users page would not show emails to, emails are neither searched nor answered", async () => {
    const getMetadata: (key: string) => TableColumnMetadata =
      User.prototype.getTableColumnMetadata;
    const getAccess: (key: string) => ColumnAccessControl | null =
      User.prototype.getColumnAccessControlFor;

    const metadataSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      User.prototype,
      "getTableColumnMetadata",
    ).mockImplementation(function (
      this: User,
      key: string,
    ): TableColumnMetadata {
      const metadata: TableColumnMetadata = getMetadata.call(this, key);

      return key === "email"
        ? { ...metadata, canReadOnRelationQuery: false }
        : metadata;
    });
    const accessSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      User.prototype,
      "getColumnAccessControlFor",
    ).mockImplementation(function (
      this: User,
      key: string,
    ): ColumnAccessControl | null {
      const access: ColumnAccessControl | null = getAccess.call(this, key);

      return key === "email" && access ? { ...access, read: [] } : access;
    });

    try {
      // By an address only: nobody.
      expect((await search("bob@acme")).members).toEqual([]);
      // By a name: the person, without their email.
      expect((await search("lovel")).members).toEqual([
        { userId: adaId.toString(), name: "Ada Lovelace" },
      ]);
    } finally {
      metadataSpy.mockRestore();
      accessSpy.mockRestore();
    }
  });
});
