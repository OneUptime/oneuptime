import { mockRouter } from "./Helpers";
import PostgresListRouteHarness from "./PostgresListRouteHarness";
import CodeTaskAPI from "../../../Server/API/CodeTaskAPI";
import CodeTaskAccess from "../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import FixPerformanceTaskTrigger from "../../../Server/Utils/AI/SRE/FixPerformanceTaskTrigger";
import Encryption from "../../../Server/Utils/Encryption";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import {
  CodeRepositoryListGroup,
  CodeRepositoryListOrder,
  MAX_CODE_REPOSITORIES_PER_PAGE,
} from "../../../Types/AI/CodeTask";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * FIX WITH AI'S REPOSITORY SEARCH, HELD TO WHAT EACH FIX ACCEPTS, THROUGH
 * THE REAL SERVER (#10921).
 *
 * Fix with AI asked for a repository from a fixed list: every repository
 * the person may ask OneUptime AI to work in, sent whole to the browser
 * (Data Security's dialog and group fix, a finding's and a profile's strip),
 * or the first 200 connected ones by name (the trace page's Fix performance
 * with AI), so a pick past them could not be made. Each searches Code's
 * repositories on the server now (CodeRepositorySearchField), and asks the
 * search to hold to exactly what its fix's route takes:
 *
 *   - askableOnly: the repositories the person may ask OneUptime AI to work
 *     in - weighed in one read a batch, as canAskInRepository weighs one;
 *   - codeReadableOnly: connected repositories whose code OneUptime reads
 *     (isCodeReadableRepository, SourceLocator's rule);
 *   - and Code's own Connected group, for the fixes that work only in a
 *     connected repository.
 *
 * On migrated Postgres, with 510 repositories named to sort before five
 * late ones, each kept from some fix for a reason of its own, as three
 * members - one who reads and changes every repository, one who may only
 * read them, and one who reads every repository but may change only those
 * with a label - through Code's own routes and the user middleware that
 * builds each member's permissions from the tables.
 *
 * Opt in with RUN_POSTGRES_PICKER_SEARCH_TESTS=true (PostgresListRouteHarness).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PICKER_SEARCH_TESTS"] === "true"
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

// The data source is the harness's; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// More than Code ever read at once, every one named to sort before "W".
const REPOSITORIES_BEFORE_W: number = MAX_CODE_REPOSITORIES_PER_PAGE + 10;
const INSTALLATION_ID: string = "10921";

describePostgres(
  "Fix with AI's repository search, held to what each fix accepts, through the real server (#10921)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "fix_with_ai_repositories",
      tables: [
        "CodeRepository",
        "CodeRepositoryLabel",
        "CodeRepositoryConnection",
        "AIRun",
      ],
    });

    // The routes, as the app registers them.
    new CodeTaskAPI();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    // Reads and changes every repository.
    const memberId: ObjectID = ObjectID.generate();
    // Reads every repository, changes none.
    const readerId: ObjectID = ObjectID.generate();
    // Reads every repository, changes only those with the label.
    const labelEditorId: ObjectID = ObjectID.generate();
    const labelId: ObjectID = ObjectID.generate();

    /*
     * Past the 500th by name, each kept from some fix:
     *
     *   Walrus ledger       on a Git server, connected with a token: OneUptime
     *                       does not read its code. Labelled.
     *   Warehouse service   on GitHub, connected: every fix works in it. Labelled.
     *   Watchtower billing  on GitHub, connected - not labelled, so the label's
     *                       editor may only read it.
     *   Wayfarer api        on GitLab, connected through a server OneUptime's
     *                       own server cannot reach: its code is not read. Labelled.
     *   Wharf api           on GitHub, never connected. Labelled.
     */
    const walrusId: ObjectID = ObjectID.generate();
    const warehouseId: ObjectID = ObjectID.generate();
    const watchtowerId: ObjectID = ObjectID.generate();
    const wayfarerId: ObjectID = ObjectID.generate();
    const wharfId: ObjectID = ObjectID.generate();
    // Another project's, named to be found by the same words.
    const westwindId: ObjectID = ObjectID.generate();
    // The 300th by name: past the 200 the trace page's suggestion lists.
    let threeHundredthId: ObjectID = ObjectID.generate();

    const gitConnectionId: ObjectID = ObjectID.generate();
    const gitLabConnectionId: ObjectID = ObjectID.generate();

    const insertConnection: (data: {
      id: ObjectID;
      provider: CodeRepositoryType;
      hostUrl: string;
      isReachableFromServer: boolean;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      provider: CodeRepositoryType;
      hostUrl: string;
      isReachableFromServer: boolean;
    }): Promise<void> => {
      await harness.insert("CodeRepositoryConnection", {
        _id: data.id,
        version: 1,
        projectId: projectId,
        provider: data.provider,
        hostUrl: data.hostUrl,
        // Encrypted at rest, as the service writes it.
        credentials: await Encryption.encrypt(
          JSON.stringify({ token: "synthetic-token-10921" }),
        ),
        isReachableFromServer: data.isReachableFromServer,
      });
    };

    const insertRepository: (data: {
      id: ObjectID;
      name: string;
      hostedAt: CodeRepositoryType;
      organizationName: string;
      repositoryName: string;
      repositoryUrl?: string | undefined;
      inProject?: ObjectID | undefined;
      gitHubAppInstallationId?: string | undefined;
      connectionId?: ObjectID | undefined;
      isLabelled?: boolean | undefined;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      name: string;
      hostedAt: CodeRepositoryType;
      organizationName: string;
      repositoryName: string;
      repositoryUrl?: string | undefined;
      inProject?: ObjectID | undefined;
      gitHubAppInstallationId?: string | undefined;
      connectionId?: ObjectID | undefined;
      isLabelled?: boolean | undefined;
    }): Promise<void> => {
      await harness.insert("CodeRepository", {
        _id: data.id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `code-repository-${data.id.toString()}`,
        repositoryHostedAt: data.hostedAt,
        organizationName: data.organizationName,
        repositoryName: data.repositoryName,
        ...(data.repositoryUrl ? { repositoryUrl: data.repositoryUrl } : {}),
        ...(data.gitHubAppInstallationId
          ? { gitHubAppInstallationId: data.gitHubAppInstallationId }
          : {}),
        ...(data.connectionId
          ? { codeRepositoryConnectionId: data.connectionId }
          : {}),
      });

      if (data.isLabelled) {
        await harness.insert("CodeRepositoryLabel", {
          codeRepositoryId: data.id,
          labelId: labelId,
        });
      }
    };

    // A request as the browser sends it, signed in as `userId`.
    const requestAs: (userId: ObjectID, body: JSONObject) => ExpressRequest = (
      userId: ObjectID,
      body: JSONObject,
    ): ExpressRequest => {
      return {
        method: "POST",
        params: {},
        query: {},
        cookies: {},
        headers: {
          authorization: `Bearer ${userId.toString()}`,
          tenantid: projectId.toString(),
        },
        body: body,
      } as unknown as ExpressRequest;
    };

    const response: () => ExpressResponse = (): ExpressResponse => {
      return {
        set: jest.fn(),
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn(),
      } as unknown as ExpressResponse;
    };

    /*
     * One of Code's routes, as the member: its middleware (the signed-in
     * user, their permissions read from the tables), then its handler.
     */
    const callAs: (data: {
      userId: ObjectID;
      path: string;
      body: JSONObject;
    }) => Promise<JSONObject> = async (data: {
      userId: ObjectID;
      path: string;
      body: JSONObject;
    }): Promise<JSONObject> => {
      jest.mocked(Response.sendJsonObjectResponse).mockClear();
      jest.mocked(Response.sendErrorResponse).mockClear();

      const req: ExpressRequest = requestAs(data.userId, data.body);
      const res: ExpressResponse = response();
      const route: (typeof mockRouter.routes)[number] = mockRouter.match(
        "post",
        data.path,
      );

      for (const middleware of route.middlewares) {
        let isPassed: boolean = false;

        await middleware(req, res, ((error?: unknown) => {
          if (!error) {
            isPassed = true;
          }
        }) as NextFunction);

        if (!isPassed) {
          throw new Error(`${data.path} was refused before it was read.`);
        }
      }

      let forwardedError: unknown = undefined;

      await route.handlerFunction(req, res, ((error: unknown) => {
        forwardedError = error;
      }) as NextFunction);

      if (forwardedError) {
        throw forwardedError;
      }

      const call: Array<unknown> | undefined = jest.mocked(
        Response.sendJsonObjectResponse,
      ).mock.calls[0];

      if (!call) {
        throw new Error(`${data.path} answered nothing.`);
      }

      return JSON.parse(JSON.stringify(call[2])) as JSONObject;
    };

    // A search of Code's repositories, as a picker sends it.
    const searchAs: (
      userId: ObjectID,
      body: JSONObject,
    ) => Promise<JSONObject> = async (
      userId: ObjectID,
      body: JSONObject,
    ): Promise<JSONObject> => {
      return await callAs({
        userId,
        path: "/code-task/repositories",
        body: { order: CodeRepositoryListOrder.Name, limit: 50, ...body },
      });
    };

    const namesOf: (answer: JSONObject) => Array<string> = (
      answer: JSONObject,
    ): Array<string> => {
      return (answer["repositories"] as Array<JSONObject>).map(
        (repository: JSONObject): string => {
          return String(repository["name"]);
        },
      );
    };

    const sortedIdsOf: (answer: JSONObject) => Array<string> = (
      answer: JSONObject,
    ): Array<string> => {
      return (answer["repositories"] as Array<JSONObject>)
        .map((repository: JSONObject): string => {
          return String(repository["id"]).toLowerCase();
        })
        .sort();
    };

    const sortedKeysOf: (ids: Array<ObjectID>) => Array<string> = (
      ids: Array<ObjectID>,
    ): Array<string> => {
      return ids
        .map((id: ObjectID): string => {
          return id.toString().toLowerCase();
        })
        .sort();
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Harbour logistics");
      await harness.insertProject(otherProjectId, "Another project");
      // The project's GitHub App: the GitHub repositories it reaches are connected.
      await harness.query(
        `UPDATE "${harness.schema}"."Project" SET "gitHubAppInstallationId" = $1 WHERE "_id" IN ($2, $3)`,
        [INSTALLATION_ID, projectId.toString(), otherProjectId.toString()],
      );

      await harness.insertLabel({
        id: labelId,
        projectId: projectId,
        name: "Harbour team",
      });

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });
      await harness.insertMember({
        userId: readerId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ReadCodeRepository,
      });
      await harness.insertMember({
        userId: labelEditorId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ReadCodeRepository,
      });
      await harness.insertTeamPermission({
        userId: labelEditorId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.EditCodeRepository,
        labelIds: [labelId],
      });

      // 510 repositories on GitHub, connected through the project's App.
      await harness.query(
        `INSERT INTO "${harness.schema}"."CodeRepository" ("_id", "version", "projectId", "name", "slug", "repositoryHostedAt", "organizationName", "repositoryName", "gitHubAppInstallationId")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), 'code-repository-' || gen_random_uuid(), 'GitHub', 'acme', 'ap-' || lpad(i::text, 6, '0'), $3
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), REPOSITORIES_BEFORE_W, INSTALLATION_ID],
      );

      const threeHundredth: Array<{ _id: string }> = (await harness.query(
        `SELECT "_id" FROM "${harness.schema}"."CodeRepository" WHERE "name" = 'AP000300'`,
      )) as Array<{ _id: string }>;
      threeHundredthId = new ObjectID(threeHundredth[0]!._id);

      await insertConnection({
        id: gitConnectionId,
        provider: CodeRepositoryType.Git,
        hostUrl: "https://git.harbour.example",
        isReachableFromServer: true,
      });
      await insertConnection({
        id: gitLabConnectionId,
        provider: CodeRepositoryType.GitLab,
        hostUrl: "https://gitlab.harbour.internal",
        isReachableFromServer: false,
      });

      await insertRepository({
        id: walrusId,
        name: "Walrus ledger",
        hostedAt: CodeRepositoryType.Git,
        organizationName: "harbour",
        repositoryName: "walrus-ledger",
        repositoryUrl: "https://git.harbour.example/harbour/walrus-ledger.git",
        connectionId: gitConnectionId,
        isLabelled: true,
      });
      await insertRepository({
        id: warehouseId,
        name: "Warehouse service",
        hostedAt: CodeRepositoryType.GitHub,
        organizationName: "acme",
        repositoryName: "warehouse-service",
        gitHubAppInstallationId: INSTALLATION_ID,
        isLabelled: true,
      });
      await insertRepository({
        id: watchtowerId,
        name: "Watchtower billing",
        hostedAt: CodeRepositoryType.GitHub,
        organizationName: "acme",
        repositoryName: "watchtower-billing",
        gitHubAppInstallationId: INSTALLATION_ID,
      });
      await insertRepository({
        id: wayfarerId,
        name: "Wayfarer api",
        hostedAt: CodeRepositoryType.GitLab,
        organizationName: "harbour",
        repositoryName: "wayfarer-api",
        connectionId: gitLabConnectionId,
        isLabelled: true,
      });
      await insertRepository({
        id: wharfId,
        name: "Wharf api",
        hostedAt: CodeRepositoryType.GitHub,
        organizationName: "harbour-works",
        repositoryName: "wharf-api",
        isLabelled: true,
      });
      await insertRepository({
        id: westwindId,
        name: "Westwind wharf",
        hostedAt: CodeRepositoryType.GitHub,
        organizationName: "acme",
        repositoryName: "westwind",
        inProject: otherProjectId,
        gitHubAppInstallationId: INSTALLATION_ID,
      });

      await harness.analyze("CodeRepository");
    }, 120000);

    afterAll(async () => {
      await harness.tearDown();
    });

    test("held to nothing, a search finds every late repository the member may read - what each fix must narrow", async () => {
      const found: JSONObject = await searchAs(memberId, { search: "w" });

      expect(namesOf(found)).toEqual([
        "Walrus ledger",
        "Warehouse service",
        "Watchtower billing",
        "Wayfarer api",
        "Wharf api",
      ]);
      expect(found["facts"]).toMatchObject({
        total: REPOSITORIES_BEFORE_W + 5,
        connected: REPOSITORIES_BEFORE_W + 4,
        notConnected: 1,
      });
    });

    test("a Data Security fix's search: past the 500th, only the connected repositories the member may ask OneUptime AI to work in", async () => {
      const asMember: JSONObject = await searchAs(memberId, {
        search: "w",
        group: CodeRepositoryListGroup.Connected,
        askableOnly: true,
      });

      // Never one not connected, nor another project's.
      expect(namesOf(asMember)).toEqual([
        "Walrus ledger",
        "Warehouse service",
        "Watchtower billing",
        "Wayfarer api",
      ]);
      expect(asMember["count"]).toBe(4);

      const asLabelEditor: JSONObject = await searchAs(labelEditorId, {
        search: "w",
        group: CodeRepositoryListGroup.Connected,
        askableOnly: true,
      });

      // Watchtower billing is theirs to read, not to ask AI in.
      expect(namesOf(asLabelEditor)).toEqual([
        "Walrus ledger",
        "Warehouse service",
        "Wayfarer api",
      ]);
      expect(asLabelEditor["count"]).toBe(3);
      // What is true of the list is true of what it is held to.
      expect(asLabelEditor["facts"]).toMatchObject({
        total: 4,
        connected: 3,
        notConnected: 1,
      });
    });

    test("a member who may only read is offered nothing to ask OneUptime AI in, however many repositories they read", async () => {
      const opened: JSONObject = await searchAs(readerId, {
        group: CodeRepositoryListGroup.Connected,
        askableOnly: true,
      });

      expect(opened["repositories"]).toEqual([]);
      expect(opened["count"]).toBe(0);
      expect(opened["facts"]).toMatchObject({ total: 0 });

      // Held to nothing, they read them all.
      expect((await searchAs(readerId, { search: "warehouse" }))["count"]).toBe(
        1,
      );
    });

    test("a finding's or a profile's fix: only connected repositories whose code OneUptime reads, that the member may ask in", async () => {
      const asMember: JSONObject = await searchAs(memberId, {
        search: "w",
        askableOnly: true,
        codeReadableOnly: true,
      });

      // Not on a Git server it does not read, not unreachable, not unconnected.
      expect(namesOf(asMember)).toEqual([
        "Warehouse service",
        "Watchtower billing",
      ]);

      const asLabelEditor: JSONObject = await searchAs(labelEditorId, {
        search: "w",
        askableOnly: true,
        codeReadableOnly: true,
      });

      expect(namesOf(asLabelEditor)).toEqual(["Warehouse service"]);
    });

    test("held, pages still run past the 500th, by name, and the count is of what the search is held to", async () => {
      const page: JSONObject = await searchAs(memberId, {
        askableOnly: true,
        codeReadableOnly: true,
        skip: 500,
        limit: 20,
      });

      expect(namesOf(page)).toEqual([
        "AP000501",
        "AP000502",
        "AP000503",
        "AP000504",
        "AP000505",
        "AP000506",
        "AP000507",
        "AP000508",
        "AP000509",
        "AP000510",
        "Warehouse service",
        "Watchtower billing",
      ]);
      expect(page["count"]).toBe(REPOSITORIES_BEFORE_W + 2);
    });

    test("who may ask is weighed in one read for every repository the member reads - never repository by repository", async () => {
      const weighed: SpyInstance<
        typeof CodeTaskAccess.listAskableRepositoryIds
      > = jest.spyOn(CodeTaskAccess, "listAskableRepositoryIds");
      const askedOne: SpyInstance<typeof CodeTaskAccess.canAskInRepository> =
        jest.spyOn(CodeTaskAccess, "canAskInRepository");

      try {
        await searchAs(labelEditorId, {
          search: "w",
          group: CodeRepositoryListGroup.Connected,
          askableOnly: true,
        });

        expect(weighed).toHaveBeenCalledTimes(1);
        expect(weighed.mock.calls[0]![0].repositoryIds).toHaveLength(
          REPOSITORIES_BEFORE_W + 5,
        );
        expect(askedOne).not.toHaveBeenCalled();

        // Held to nothing, nothing is weighed.
        weighed.mockClear();
        await searchAs(labelEditorId, { search: "w" });
        expect(weighed).not.toHaveBeenCalled();
      } finally {
        // Only these two: the harness's own spies stay as they are.
        weighed.mockRestore();
        askedOne.mockRestore();
      }
    });

    test("/code-task/repositories-by-id: what a picker holds is read by its id, held as its search is when it asks", async () => {
      const ids: Array<string> = [
        walrusId,
        warehouseId,
        watchtowerId,
        wayfarerId,
        wharfId,
        westwindId,
      ].map((id: ObjectID): string => {
        return id.toString();
      });

      // As a field reads what it holds: held to nothing.
      expect(
        sortedIdsOf(
          await callAs({
            userId: labelEditorId,
            path: "/code-task/repositories-by-id",
            body: { repositoryIds: ids },
          }),
        ),
      ).toEqual(
        sortedKeysOf([
          walrusId,
          warehouseId,
          watchtowerId,
          wayfarerId,
          wharfId,
        ]),
      );

      expect(
        sortedIdsOf(
          await callAs({
            userId: labelEditorId,
            path: "/code-task/repositories-by-id",
            body: { repositoryIds: ids, askableOnly: true },
          }),
        ),
      ).toEqual(sortedKeysOf([walrusId, warehouseId, wayfarerId, wharfId]));

      expect(
        sortedIdsOf(
          await callAs({
            userId: labelEditorId,
            path: "/code-task/repositories-by-id",
            body: {
              repositoryIds: ids,
              askableOnly: true,
              codeReadableOnly: true,
            },
          }),
        ),
      ).toEqual(sortedKeysOf([warehouseId]));

      expect(
        sortedIdsOf(
          await callAs({
            userId: readerId,
            path: "/code-task/repositories-by-id",
            body: { repositoryIds: ids, askableOnly: true },
          }),
        ),
      ).toEqual([]);

      // Only `true` holds a read: anything else is held to nothing.
      expect(
        sortedIdsOf(
          await callAs({
            userId: readerId,
            path: "/code-task/repositories-by-id",
            body: {
              repositoryIds: ids,
              askableOnly: "true",
              codeReadableOnly: 1,
            },
          }),
        ),
      ).toHaveLength(5);
    });

    test("the trace page's Fix performance with AI: its search offers every connected repository the member reads, and a pick past the first 200 is taken", async () => {
      const found: JSONObject = await searchAs(readerId, {
        search: "w",
        group: CodeRepositoryListGroup.Connected,
      });

      expect(namesOf(found)).toEqual([
        "Walrus ledger",
        "Warehouse service",
        "Watchtower billing",
        "Wayfarer api",
      ]);

      // The suggestion lists the first 200 by name: these are past them.
      for (const id of [threeHundredthId, warehouseId, walrusId]) {
        expect(
          await FixPerformanceTaskTrigger.isRepositoryChoice({
            projectId,
            pickedRepositoryId: id,
          }),
        ).toBe(true);
      }

      // Its id however it is written.
      expect(
        await FixPerformanceTaskTrigger.isRepositoryChoice({
          projectId,
          pickedRepositoryId: new ObjectID(
            warehouseId.toString().toUpperCase(),
          ),
        }),
      ).toBe(true);

      // Never one not connected, another project's, or none.
      for (const id of [wharfId, westwindId, ObjectID.generate()]) {
        expect(
          await FixPerformanceTaskTrigger.isRepositoryChoice({
            projectId,
            pickedRepositoryId: id,
          }),
        ).toBe(false);
      }
      expect(
        await FixPerformanceTaskTrigger.isRepositoryChoice({ projectId }),
      ).toBe(false);
    });
  },
);
