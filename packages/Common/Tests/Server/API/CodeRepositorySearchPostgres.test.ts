import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  valuesOf,
} from "./PostgresListRouteHarness";
import BaseAPI from "../../../Server/API/BaseAPI";
import CodeTaskAPI from "../../../Server/API/CodeTaskAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIRunService from "../../../Server/Services/AIRunService";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceType,
} from "../../../Server/Services/CodeRepositoryService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import CodeTaskAccess from "../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeRepositoryListGroup,
  CodeRepositoryListOrder,
  MAX_CODE_REPOSITORIES_PER_PAGE,
} from "../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { withSearchIn } from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import RecordsById from "../../../UI/Utils/RecordsById";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * CODE'S REPOSITORIES PAST THE 500TH, SEARCHED, SCOPED AND READ BY ID
 * THROUGH THE REAL SERVER (#10764).
 *
 * CodeTaskAccess read the first 500 repositories a person may read, by
 * name, and everything built on that list inherited the cap: Code's list of
 * tasks across repositories, its counts and its search left out a task in a
 * repository past the 500th; an insight's fix card did not read such a
 * task; the request box's picker and the Repositories page never offered
 * or listed one; an AI rule's field read one it held as a repository the
 * reader cannot access.
 *
 * On migrated Postgres, with 510 repositories named to sort before the late
 * ones (PostgresListRouteHarness), as three members - one who reads and
 * changes every repository, one whose team reads only the repositories with
 * a label, and one who reads every repository but may change only those -
 * through Code's own routes and the user middleware that builds each
 * member's permissions from the tables:
 *
 *   - the late repositories are listed, searched, paged to and read by id,
 *     and their tasks are in the list across repositories, its search and
 *     an insight's summaries - for whoever may read them;
 *   - a member never gets a repository they may not read, by a search, a
 *     page, a read by id or a task in it; nor another project's;
 *   - who may ask AI is weighed for many repositories in one read, as
 *     canAskInRepository weighs one;
 *   - the scope goes to the database as one array however long it is;
 *   - and the AI rule field's search and reads, through the generic list
 *     route.
 *
 * Opt in with RUN_POSTGRES_PICKER_SEARCH_TESTS=true (see the harness).
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

// More than the 500 Code read, every one named to sort before "W".
const REPOSITORIES_BEFORE_W: number = MAX_CODE_REPOSITORIES_PER_PAGE + 10;
const INSTALLATION_ID: string = "4242";

describePostgres(
  "Code's repositories past the 500th, searched, scoped and read by id through the real server (#10764)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "code_repositories",
      tables: ["CodeRepository", "CodeRepositoryLabel", "AIRun"],
    });

    // The routes, as the app registers them.
    new CodeTaskAPI();
    new BaseAPI<CodeRepository, CodeRepositoryServiceType>(
      CodeRepository,
      CodeRepositoryService,
    );

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    // Reads and changes every repository.
    const memberId: ObjectID = ObjectID.generate();
    // Reads only the repositories with the label.
    const labelReaderId: ObjectID = ObjectID.generate();
    // Reads every repository, changes only those with the label.
    const labelEditorId: ObjectID = ObjectID.generate();
    const labelId: ObjectID = ObjectID.generate();

    // Past the 500th: one with the label (connected), one without (not connected).
    const warehouseId: ObjectID = ObjectID.generate();
    const wharfId: ObjectID = ObjectID.generate();
    // Another project's, named to be found by the same words.
    const westwindId: ObjectID = ObjectID.generate();
    // Never inserted: a repository a page holds, deleted since.
    const deletedId: ObjectID = ObjectID.generate();
    let firstRepositoryId: ObjectID = ObjectID.generate();

    const warehouseTaskId: ObjectID = ObjectID.generate();
    const wharfTaskId: ObjectID = ObjectID.generate();
    const earlyTaskId: ObjectID = ObjectID.generate();
    const noRepositoryTaskId: ObjectID = ObjectID.generate();

    const insertRepository: (data: {
      id: ObjectID;
      name: string;
      organizationName: string;
      repositoryName: string;
      inProject?: ObjectID | undefined;
      isConnected: boolean;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      name: string;
      organizationName: string;
      repositoryName: string;
      inProject?: ObjectID | undefined;
      isConnected: boolean;
    }): Promise<void> => {
      await harness.insert("CodeRepository", {
        _id: data.id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `code-repository-${data.id.toString()}`,
        repositoryHostedAt: "GitHub",
        organizationName: data.organizationName,
        repositoryName: data.repositoryName,
        ...(data.isConnected
          ? { gitHubAppInstallationId: INSTALLATION_ID }
          : {}),
      });
    };

    const insertTask: (data: {
      id: ObjectID;
      title: string;
      repositoryId: ObjectID | null;
      minutesAgo: number;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      title: string;
      repositoryId: ObjectID | null;
      minutesAgo: number;
    }): Promise<void> => {
      await harness.query(
        `INSERT INTO "${harness.schema}"."AIRun" ("_id", "version", "projectId", "runType", "status", "codeRepositoryId", "codeFixTaskType", "title", "createdAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, now() - make_interval(mins => $8))`,
        [
          data.id.toString(),
          projectId.toString(),
          AIRunType.CodeFix,
          AIRunStatus.Completed,
          data.repositoryId ? data.repositoryId.toString() : null,
          CodeFixTaskType.CodeRequest,
          data.title,
          data.minutesAgo,
        ],
      );
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

    // The member's permissions, as the user middleware builds them.
    const propsOf: (
      userId: ObjectID,
    ) => Promise<DatabaseCommonInteractionProps> = async (
      userId: ObjectID,
    ): Promise<DatabaseCommonInteractionProps> => {
      const req: ExpressRequest = requestAs(userId, {});

      await UserMiddleware.getUserMiddleware(req, response(), (() => {
        // passed on
      }) as NextFunction);

      return await CommonAPI.getDatabaseCommonInteractionProps(req);
    };

    const namesOf: (repositories: Array<JSONObject>) => Array<string> = (
      repositories: Array<JSONObject>,
    ): Array<string> => {
      return repositories.map((repository: JSONObject): string => {
        return String(repository["name"]);
      });
    };

    const idsOf: (rows: Array<JSONObject>) => Array<string> = (
      rows: Array<JSONObject>,
    ): Array<string> => {
      return rows.map((row: JSONObject): string => {
        return String(row["id"]).toLowerCase();
      });
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Harbour logistics");
      await harness.insertProject(otherProjectId, "Another project");
      // The project's GitHub App: the repositories it reaches are connected.
      await harness.query(
        `UPDATE "${harness.schema}"."Project" SET "gitHubAppInstallationId" = $1 WHERE "_id" = $2`,
        [INSTALLATION_ID, projectId.toString()],
      );

      await harness.insertLabel({
        id: labelId,
        projectId: projectId,
        name: "Warehouse team",
      });

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });
      await harness.insertMember({
        userId: labelReaderId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ReadCodeRepository,
        labelIds: [labelId],
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

      // 510 repositories, connected through the project's GitHub App.
      await harness.query(
        `INSERT INTO "${harness.schema}"."CodeRepository" ("_id", "version", "projectId", "name", "slug", "repositoryHostedAt", "organizationName", "repositoryName", "gitHubAppInstallationId")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), 'code-repository-' || gen_random_uuid(), 'GitHub', 'acme', 'ap-' || lpad(i::text, 6, '0'), $3
         FROM generate_series(1, $2) AS i`,
        [projectId.toString(), REPOSITORIES_BEFORE_W, INSTALLATION_ID],
      );

      const first: Array<{ _id: string }> = (await harness.query(
        `SELECT "_id" FROM "${harness.schema}"."CodeRepository" WHERE "name" = 'AP000001'`,
      )) as Array<{ _id: string }>;
      firstRepositoryId = new ObjectID(first[0]!._id);

      await insertRepository({
        id: warehouseId,
        name: "Warehouse service",
        organizationName: "acme",
        repositoryName: "warehouse-service",
        isConnected: true,
      });
      await harness.insert("CodeRepositoryLabel", {
        codeRepositoryId: warehouseId,
        labelId: labelId,
      });

      await insertRepository({
        id: wharfId,
        name: "Wharf api",
        organizationName: "harbour-works",
        repositoryName: "wharf-api",
        isConnected: false,
      });

      await insertRepository({
        id: westwindId,
        name: "Westwind wharf",
        organizationName: "harbour-works",
        repositoryName: "westwind",
        inProject: otherProjectId,
        isConnected: true,
      });

      await insertTask({
        id: warehouseTaskId,
        title: "Fix the warehouse stock count",
        repositoryId: warehouseId,
        minutesAgo: 30,
      });
      await insertTask({
        id: wharfTaskId,
        title: "Speed up wharf berth lookups",
        repositoryId: wharfId,
        minutesAgo: 20,
      });
      await insertTask({
        id: earlyTaskId,
        title: "Add a test for the first repository",
        repositoryId: firstRepositoryId,
        minutesAgo: 10,
      });
      await insertTask({
        id: noRepositoryTaskId,
        title: "A fix that found no repository",
        repositoryId: null,
        minutesAgo: 5,
      });

      await harness.analyze("CodeRepository");
      await harness.analyze("AIRun");
    }, 120000);

    afterAll(async () => {
      await harness.tearDown();
    });

    test("the old read never had them: the first 500 repositories by name", async () => {
      const firstPage: Array<CodeRepository> =
        await CodeTaskAccess.readReadableRepositoriesPage({
          props: await propsOf(memberId),
          projectId,
          skip: 0,
          limit: MAX_CODE_REPOSITORIES_PER_PAGE,
        });

      const names: Array<string> = firstPage.map(
        (repository: CodeRepository): string => {
          return repository.name || "";
        },
      );

      expect(names).toHaveLength(MAX_CODE_REPOSITORIES_PER_PAGE);
      expect(names).not.toContain("Warehouse service");
      expect(names).not.toContain("Wharf api");
    });

    test("every repository a member may read is read, past the 500th - and never another project's", async () => {
      const all: Array<CodeRepository> =
        await CodeTaskAccess.listReadableRepositories({
          props: await propsOf(memberId),
          projectId,
        });
      const names: Array<string> = all.map(
        (repository: CodeRepository): string => {
          return repository.name || "";
        },
      );

      expect(all).toHaveLength(REPOSITORIES_BEFORE_W + 2);
      expect(names.slice(-2)).toEqual(["Warehouse service", "Wharf api"]);
      expect(names).not.toContain("Westwind wharf");

      const ids: Array<string> = (
        await CodeTaskAccess.readReadableRepositoryIds({
          props: await propsOf(memberId),
          projectId,
        })
      ).map((id: ObjectID): string => {
        return id.toString();
      });

      expect(ids).toHaveLength(REPOSITORIES_BEFORE_W + 2);
      expect(ids).toEqual(
        expect.arrayContaining([warehouseId.toString(), wharfId.toString()]),
      );
      expect(ids).not.toContain(westwindId.toString());
    });

    test("a member whose team reads only one label's repositories reads exactly those, however many there are", async () => {
      const props: DatabaseCommonInteractionProps =
        await propsOf(labelReaderId);

      expect(
        (await CodeTaskAccess.listReadableRepositories({ props, projectId })).map(
          (repository: CodeRepository): string => {
            return repository.name || "";
          },
        ),
      ).toEqual(["Warehouse service"]);
      expect(
        (await CodeTaskAccess.readReadableRepositoryIds({ props, projectId })).map(
          (id: ObjectID): string => {
            return id.toString();
          },
        ),
      ).toEqual([warehouseId.toString()]);
    });

    test("/code-task/repositories: a search finds a repository past the 500th, in its list, with what is true of all of them", async () => {
      const found: JSONObject = await callAs({
        userId: memberId,
        path: "/code-task/repositories",
        body: { search: "wharf", limit: 50 },
      });

      expect(namesOf(found["repositories"] as Array<JSONObject>)).toEqual([
        "Wharf api",
      ]);
      expect(found["count"]).toBe(1);
      expect(found["matches"]).toEqual({ connected: 0, notConnected: 1 });
      expect(found["facts"]).toMatchObject({
        total: REPOSITORIES_BEFORE_W + 2,
        connected: REPOSITORIES_BEFORE_W + 1,
        notConnected: 1,
        areAllOnGitHub: true,
        areAllNotConnectedOnGitHub: true,
      });

      // Each list keeps to its own: the late connected one, by its organization/name.
      const connected: JSONObject = await callAs({
        userId: memberId,
        path: "/code-task/repositories",
        body: {
          search: "acme/warehouse",
          group: CodeRepositoryListGroup.Connected,
          limit: 50,
        },
      });

      expect(namesOf(connected["repositories"] as Array<JSONObject>)).toEqual(
        ["Warehouse service"],
      );
      expect(
        (connected["repositories"] as Array<JSONObject>)[0]!["isConnected"],
      ).toBe(true);

      const notConnected: JSONObject = await callAs({
        userId: memberId,
        path: "/code-task/repositories",
        body: {
          search: "w",
          group: CodeRepositoryListGroup.NotConnected,
          limit: 50,
        },
      });

      expect(
        namesOf(notConnected["repositories"] as Array<JSONObject>),
      ).toEqual(["Wharf api"]);
    });

    test("/code-task/repositories: pages run past the 500th, those AI can work in first, each by name", async () => {
      const page: JSONObject = await callAs({
        userId: memberId,
        path: "/code-task/repositories",
        body: { order: CodeRepositoryListOrder.Name, skip: 500, limit: 20 },
      });

      expect(namesOf(page["repositories"] as Array<JSONObject>)).toEqual([
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
        "Wharf api",
      ]);
      expect(page["count"]).toBe(REPOSITORIES_BEFORE_W + 2);

      // By activity: the repositories something happened in, most recent first.
      const byActivity: JSONObject = await callAs({
        userId: memberId,
        path: "/code-task/repositories",
        body: {
          order: CodeRepositoryListOrder.Activity,
          group: CodeRepositoryListGroup.Connected,
          limit: 3,
        },
      });

      expect(namesOf(byActivity["repositories"] as Array<JSONObject>)).toEqual(
        ["AP000001", "Warehouse service", "AP000002"],
      );
    });

    test("/code-task/repositories: a member whose team reads one label's repositories never finds another, by a search or a page", async () => {
      const found: JSONObject = await callAs({
        userId: labelReaderId,
        path: "/code-task/repositories",
        body: { search: "w", limit: 50 },
      });

      expect(namesOf(found["repositories"] as Array<JSONObject>)).toEqual([
        "Warehouse service",
      ]);
      expect(found["facts"]).toMatchObject({
        total: 1,
        connected: 1,
        notConnected: 0,
      });

      const wharf: JSONObject = await callAs({
        userId: labelReaderId,
        path: "/code-task/repositories",
        body: { search: "wharf", limit: 50 },
      });

      expect(wharf["repositories"]).toEqual([]);
      expect(wharf["count"]).toBe(0);
    });

    test("/code-task/repositories-by-id: what a page holds is read by its id - never one the reader may not read, another project's or one deleted", async () => {
      const asMember: JSONObject = await callAs({
        userId: memberId,
        path: "/code-task/repositories-by-id",
        body: {
          repositoryIds: [
            wharfId.toString(),
            westwindId.toString(),
            deletedId.toString(),
          ],
        },
      });

      expect(idsOf(asMember["repositories"] as Array<JSONObject>)).toEqual([
        wharfId.toString().toLowerCase(),
      ]);

      const asLabelReader: JSONObject = await callAs({
        userId: labelReaderId,
        path: "/code-task/repositories-by-id",
        body: {
          repositoryIds: [warehouseId.toString(), wharfId.toString()],
        },
      });

      expect(
        idsOf(asLabelReader["repositories"] as Array<JSONObject>),
      ).toEqual([warehouseId.toString().toLowerCase()]);
    });

    test("/code-task/list across repositories: a task in a repository past the 500th is listed and its row named - never one in a repository the reader may not read", async () => {
      const asMember: JSONObject = await callAs({
        userId: memberId,
        path: "/code-task/list",
        body: { allRepositories: true, limit: 50 },
      });
      const tasks: Array<JSONObject> = asMember["tasks"] as Array<JSONObject>;

      expect(idsOf(tasks)).toEqual(
        expect.arrayContaining([
          warehouseTaskId.toString().toLowerCase(),
          wharfTaskId.toString().toLowerCase(),
          earlyTaskId.toString().toLowerCase(),
        ]),
      );

      const wharfRow: JSONObject | undefined = tasks.find(
        (task: JSONObject): boolean => {
          return (
            String(task["id"]).toLowerCase() ===
            wharfTaskId.toString().toLowerCase()
          );
        },
      );

      expect(wharfRow?.["repository"]).toEqual({
        name: "Wharf api",
        provider: "GitHub",
      });

      const asLabelReader: JSONObject = await callAs({
        userId: labelReaderId,
        path: "/code-task/list",
        body: { allRepositories: true, limit: 50 },
      });

      expect(idsOf(asLabelReader["tasks"] as Array<JSONObject>)).toEqual([
        warehouseTaskId.toString().toLowerCase(),
      ]);
      expect(asLabelReader["totalCount"]).toBe(1);
    });

    test("/code-task/list across repositories, searched: the same scope through the filters' SQL", async () => {
      const asMember: JSONObject = await callAs({
        userId: memberId,
        path: "/code-task/list",
        body: { allRepositories: true, search: "wharf berth", limit: 50 },
      });

      expect(idsOf(asMember["tasks"] as Array<JSONObject>)).toEqual([
        wharfTaskId.toString().toLowerCase(),
      ]);

      const asLabelReader: JSONObject = await callAs({
        userId: labelReaderId,
        path: "/code-task/list",
        body: { allRepositories: true, search: "wharf berth", limit: 50 },
      });

      expect(asLabelReader["tasks"]).toEqual([]);
    });

    test("/code-task/summaries: an insight's fix task in a repository past the 500th is read - by whoever may read its repository", async () => {
      const body: JSONObject = {
        taskIds: [wharfTaskId.toString(), warehouseTaskId.toString()],
      };

      expect(
        idsOf(
          (
            await callAs({
              userId: memberId,
              path: "/code-task/summaries",
              body,
            })
          )["tasks"] as Array<JSONObject>,
        ).sort(),
      ).toEqual(
        [
          wharfTaskId.toString().toLowerCase(),
          warehouseTaskId.toString().toLowerCase(),
        ].sort(),
      );

      expect(
        idsOf(
          (
            await callAs({
              userId: labelReaderId,
              path: "/code-task/summaries",
              body,
            })
          )["tasks"] as Array<JSONObject>,
        ),
      ).toEqual([warehouseTaskId.toString().toLowerCase()]);
    });

    test("who may ask AI is weighed for many repositories in one read, as canAskInRepository weighs one", async () => {
      const repositoryIds: Array<ObjectID> = [
        warehouseId,
        wharfId,
        firstRepositoryId,
      ];

      for (const userId of [memberId, labelEditorId, labelReaderId]) {
        const props: DatabaseCommonInteractionProps = await propsOf(userId);
        const askable: Set<string> =
          await CodeTaskAccess.listAskableRepositoryIds({
            props,
            projectId,
            repositoryIds,
          });

        for (const repositoryId of repositoryIds) {
          expect({
            userId: userId.toString(),
            repositoryId: repositoryId.toString(),
            canAsk: askable.has(repositoryId.toString().toLowerCase()),
          }).toEqual({
            userId: userId.toString(),
            repositoryId: repositoryId.toString(),
            canAsk: await CodeTaskAccess.canAskInRepository({
              props,
              projectId,
              repositoryId,
            }),
          });
        }
      }

      // The member changes every repository; the label's editor only its own; a reader none.
      expect(
        await CodeTaskAccess.listAskableRepositoryIds({
          props: await propsOf(labelEditorId),
          projectId,
          repositoryIds,
        }),
      ).toEqual(new Set<string>([warehouseId.toString().toLowerCase()]));
      expect(
        (
          await CodeTaskAccess.listAskableRepositoryIds({
            props: await propsOf(labelReaderId),
            projectId,
            repositoryIds,
          })
        ).size,
      ).toBe(0);
    });

    test("the scope is one array however long: 70,000 ids in one statement, and the tasks with no repository with them", async () => {
      const ids: Array<ObjectID> = [];

      for (let index: number = 0; index < 70000; index++) {
        ids.push(ObjectID.generate());
      }

      ids.push(wharfId);

      const tasks: Array<AIRun> = await AIRunService.findBy({
        query: {
          projectId: projectId,
          codeRepositoryId: QueryHelper.anyOfIds(ids),
        },
        select: { _id: true },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      });

      expect(
        tasks.map((task: AIRun): string => {
          return task.id!.toString();
        }),
      ).toEqual([wharfTaskId.toString()]);

      const withNone: Array<AIRun> = await AIRunService.findBy({
        query: {
          projectId: projectId,
          codeRepositoryId: QueryHelper.anyOfIds([wharfId], { orNull: true }),
        },
        select: { _id: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      });

      expect(
        withNone.map((task: AIRun): string => {
          return task.id!.toString();
        }),
      ).toEqual([wharfTaskId.toString(), noRepositoryTaskId.toString()]);
    });

    test("an AI rule's Code Repositories field: searched by name or organization past the 500th, through the list route, as each member", async () => {
      const search: (data: {
        userId: ObjectID;
        text: string;
      }) => Promise<ListedPage<CodeRepository>> = async (data: {
        userId: ObjectID;
        text: string;
      }): Promise<ListedPage<CodeRepository>> => {
        return await harness.list<CodeRepository>({
          path: "/code-repository",
          query: withSearchIn(
            {},
            ["name", "organizationName", "repositoryName"],
            data.text,
          ),
          select: {
            _id: true,
            name: true,
            organizationName: true,
            repositoryName: true,
          },
          sort: { name: SortOrder.Ascending },
          limit: 50,
          userId: data.userId,
          projectId: projectId,
        });
      };

      expect(
        valuesOf(await search({ userId: memberId, text: "wharf" }), "name"),
      ).toEqual(["Wharf api"]);
      // By its organization, as typed.
      expect(
        valuesOf(
          await search({ userId: memberId, text: "harbour-works" }),
          "name",
        ),
      ).toEqual(["Wharf api"]);
      // The label's reader never finds one without it.
      expect(
        valuesOf(await search({ userId: labelReaderId, text: "w" }), "name"),
      ).toEqual(["Warehouse service"]);
    });

    test("an AI rule's Code Repositories field: what a rule holds is read by its ids - one the reader may not read is not answered, and the field keeps it as one they cannot access", async () => {
      harness.routeModelAPIReads({ userId: labelReaderId, projectId });

      const held: Array<CodeRepository> = await RecordsById.read<CodeRepository>(
        {
          modelType: CodeRepository,
          ids: [warehouseId.toString(), wharfId.toString(), deletedId.toString()],
          select: {
            _id: true,
            name: true,
            organizationName: true,
            repositoryName: true,
          },
        },
      );

      expect(
        held.map((repository: CodeRepository): string => {
          return repository.name || "";
        }),
      ).toEqual(["Warehouse service"]);

      harness.routeModelAPIReads({ userId: memberId, projectId });

      const asMember: Array<CodeRepository> =
        await RecordsById.read<CodeRepository>({
          modelType: CodeRepository,
          ids: [warehouseId.toString(), wharfId.toString()],
          select: { _id: true, name: true },
        });

      expect(
        asMember
          .map((repository: CodeRepository): string => {
            return repository.name || "";
          })
          .sort(),
      ).toEqual(["Warehouse service", "Wharf api"]);
    });
  },
);
