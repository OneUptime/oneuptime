import { mockRouter } from "./Helpers";
import MonitorAPI from "../../../Server/API/MonitorAPI";
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
import MonitorLatestArrivals from "../../../Server/Utils/Monitor/MonitorLatestArrivals";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Response from "../../../Server/Utils/Response";
import Entities from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  withLabels,
  withSearch,
} from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";
import { getLinkableMonitorsQuery } from "../../../Utils/Monitor/MonitorTemplateLinkableMonitors";
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
 * LINK EXISTING MONITORS, SEARCHED THROUGH THE REAL SERVER (#10399).
 *
 * A Ping template with 264 linked monitors, in a project of more than 10,000
 * Ping monitors, as the report had it: in Monitors, a search for
 * "WB1500KSK0" finds WB1500KSK01 (linked to the template) and WB1500KSK02
 * (Ping, no template), and Link Existing Monitors said "No matches found".
 *
 * Every read here is the one the dialog's picker sends (EntityDropdown:
 * getLinkableMonitorsQuery, ArchivedValuePicker, withSearch or withLabels,
 * 50 by name), serialized as ModelAPI serializes it, through the monitor list
 * route the app registers (MonitorAPI, POST /monitor/get-list) as a member of
 * the project: the real user middleware reading the member's team and its
 * permission rows from the tables below, the permission pipeline, the query
 * serializer and TypeORM, so the filter is the SQL Postgres runs.
 *
 * And the read the dialog used to make (17.0.0): every Ping monitor of the
 * project, at most 10,000, by name, the linked ones dropped and the search
 * run in the browser. It never had WB1500KSK02 to offer.
 *
 * Opt in with RUN_POSTGRES_LINKABLE_MONITORS_TESTS=true against a database
 * the registered migrations have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_LINKABLE_MONITORS_TESTS=true \
 *   LINKABLE_MONITORS_TEST_DATABASE_HOST=127.0.0.1 \
 *   LINKABLE_MONITORS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/API/MonitorTemplateLinkableMonitorsPostgres.test.ts --forceExit
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is dropped
 * afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_LINKABLE_MONITORS_TESTS"] === "true"
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

// The tables a member's request reads besides the monitors and their labels.
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
  "Monitor",
  "MonitorLabel",
];

// How many of each the project holds.
const LINKED_TO_TEMPLATE: number = 264;
// More Ping monitors than the dialog ever read, all named before "WB".
const PING_MONITORS_BEFORE_WB: number = 10050;
// Unlinked Ping monitors sharing one prefix: more than a page of the picker.
const UNLINKED_WB3000: number = 120;
// Monitors of other types named like the Ping ones.
const OTHER_TYPE_MONITORS: number = 300;

const PICKER_PAGE_SIZE: number = 50;

describePostgres(
  "Link Existing Monitors, searched through the real server (#10399)",
  () => {
    const schema: string = `linkable_monitors_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;

    let database: DataSource;

    // The monitor list route, as the app registers it.
    new MonitorAPI();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const memberTeamId: ObjectID = ObjectID.generate();
    const monitorStatusId: ObjectID = ObjectID.generate();

    // "WB KSK Ping Monitor Template", and another Ping template.
    const templateId: ObjectID = ObjectID.generate();
    const otherTemplateId: ObjectID = ObjectID.generate();

    // The label the Labels tab picks by: on linked and unlinked monitors.
    const kioskLabelId: ObjectID = ObjectID.generate();

    // The report's monitors, and their neighbours, by name.
    const named: Dictionary<string> = {};

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

    // One monitor, with what the report's monitors have.
    const insertMonitor: (data: {
      name: string;
      monitorType: MonitorType;
      monitorTemplateId?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      inProject?: ObjectID | undefined;
      labelId?: ObjectID | undefined;
    }) => Promise<string> = async (data: {
      name: string;
      monitorType: MonitorType;
      monitorTemplateId?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      inProject?: ObjectID | undefined;
      labelId?: ObjectID | undefined;
    }): Promise<string> => {
      const id: ObjectID = ObjectID.generate();

      await insert("Monitor", {
        _id: id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `${data.name.toLowerCase()}-${id.toString()}`,
        monitorType: data.monitorType,
        currentMonitorStatusId: monitorStatusId,
        monitorTemplateId: data.monitorTemplateId || null,
        isArchived: Boolean(data.isArchived),
      });

      if (data.labelId) {
        await insert("MonitorLabel", {
          monitorId: id,
          labelId: data.labelId,
        });
      }

      named[data.name] = id.toString();

      return id.toString();
    };

    /*
     * `count` monitors in one statement, named `prefix` and a number of
     * `digits` digits from 1: a project the size of the report's.
     */
    const insertMonitors: (data: {
      prefix: string;
      digits: number;
      count: number;
      monitorType: MonitorType;
      monitorTemplateId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      prefix: string;
      digits: number;
      count: number;
      monitorType: MonitorType;
      monitorTemplateId?: ObjectID | undefined;
    }): Promise<void> => {
      await database.query(
        `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "monitorTemplateId", "isArchived")
         SELECT gen_random_uuid(), 1, $1, $2 || lpad(i::text, $3, '0'), lower($2) || '-' || i || '-' || gen_random_uuid(), $4, $5, $6, false
         FROM generate_series(1, $7) AS i`,
        [
          projectId.toString(),
          data.prefix,
          data.digits,
          data.monitorType,
          monitorStatusId.toString(),
          data.monitorTemplateId ? data.monitorTemplateId.toString() : null,
          data.count,
        ],
      );
    };

    const requestOf: (body: JSONObject) => ExpressRequest = (
      body: JSONObject,
    ): ExpressRequest => {
      return {
        method: "POST",
        params: {},
        query: {},
        cookies: {},
        headers: {
          authorization: `Bearer ${memberId.toString()}`,
          tenantid: projectId.toString(),
        },
        body: body,
      } as unknown as ExpressRequest;
    };

    const responseStub: () => ExpressResponse = (): ExpressResponse => {
      return {
        set: jest.fn(),
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn(),
      } as unknown as ExpressResponse;
    };

    interface Listed {
      names: Array<string>;
      ids: Array<string>;
      templateIds: Array<string | null>;
      count: number;
    }

    // A list of monitors, through POST /monitor/get-list, as ModelAPI sends it.
    const listMonitors: (data: {
      query: Dictionary<unknown>;
      select?: Dictionary<boolean> | undefined;
      limit: number;
      skip?: number | undefined;
    }) => Promise<Listed> = async (data: {
      query: Dictionary<unknown>;
      select?: Dictionary<boolean> | undefined;
      limit: number;
      skip?: number | undefined;
    }): Promise<Listed> => {
      jest.mocked(Response.sendEntityArrayResponse).mockClear();
      jest.mocked(Response.sendErrorResponse).mockClear();

      const body: JSONObject = JSON.parse(
        JSON.stringify({
          query: JSONFunctions.serialize(data.query as JSONObject),
          select: JSONFunctions.serialize(
            (data.select || { _id: true, name: true }) as JSONObject,
          ),
          sort: JSONFunctions.serialize({
            name: SortOrder.Ascending,
          } as JSONObject),
        }),
      );

      const req: ExpressRequest = requestOf(body);

      // ModelAPI sends the page in the query string.
      (req as unknown as { query: Dictionary<string> }).query = {
        limit: String(data.limit),
        skip: String(data.skip || 0),
      };

      const res: ExpressResponse = responseStub();
      const route: (typeof mockRouter.routes)[number] = mockRouter.match(
        "post",
        "/monitor/get-list",
      );

      for (const middleware of route.middlewares) {
        let isPassed: boolean = false;

        await middleware(req, res, ((error?: unknown) => {
          if (!error) {
            isPassed = true;
          }
        }) as NextFunction);

        if (!isPassed) {
          throw new Error(
            `The list was refused before it was read: ${String(
              jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2],
            )}`,
          );
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
        Response.sendEntityArrayResponse,
      ).mock.calls[0];

      if (!call) {
        throw new Error("/monitor/get-list answered nothing.");
      }

      const monitors: Array<Monitor> = call[2] as Array<Monitor>;

      return {
        names: monitors.map((monitor: Monitor): string => {
          return monitor.name || "";
        }),
        ids: monitors.map((monitor: Monitor): string => {
          return monitor.id!.toString();
        }),
        templateIds: monitors.map((monitor: Monitor): string | null => {
          return monitor.monitorTemplateId
            ? monitor.monitorTemplateId.toString()
            : null;
        }),
        count: Number((call[3] as { toNumber: () => number }).toNumber()),
      };
    };

    // What the dialog's picker lists for this template, as it sends it.
    const pickerQuery: () => Dictionary<unknown> = (): Dictionary<unknown> => {
      return ArchivedValuePicker.getPickerQuery(
        Monitor,
        getLinkableMonitorsQuery({
          monitorTemplateId: templateId,
          monitorType: MonitorType.Ping,
        }),
      );
    };

    // A search typed into the picker: a page of 50, by name.
    const search: (
      text: string,
      skip?: number | undefined,
    ) => Promise<Listed> = async (
      text: string,
      skip?: number | undefined,
    ): Promise<Listed> => {
      return await listMonitors({
        query: withSearch(pickerQuery(), "name", text),
        limit: PICKER_PAGE_SIZE,
        skip: skip,
      });
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["LINKABLE_MONITORS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["LINKABLE_MONITORS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["LINKABLE_MONITORS_TEST_DATABASE_NAME"] ||
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
      getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(
        null as never,
      );
      getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(RealtimeAccessChanges, "announce").mockReturnValue(
        undefined as never,
      );

      // The heartbeats kept in Redis, laid over the rows: none here.
      getJestSpyOn(MonitorLatestArrivals, "putOverRows").mockResolvedValue(
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

      // The locks and the shared cache generations (Valkey): always free.
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
        [projectId, "Kiosk fleet"],
        [otherProjectId, "Another project"],
      ] as Array<[ObjectID, string]>) {
        await insert("Project", {
          _id: id,
          name: name,
          slug: id.toString(),
          version: 1,
        });
      }

      await insert("User", {
        _id: memberId,
        name: "Synthetic Member",
        email: `${memberId.toString()}@example.com`,
        slug: memberId.toString(),
        version: 1,
      });

      await insert("Team", {
        _id: memberTeamId,
        projectId: projectId,
        name: "Operators",
        slug: memberTeamId.toString(),
        version: 1,
      });

      await insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: memberTeamId,
        userId: memberId,
        hasAcceptedInvitation: true,
        version: 1,
      });

      // A member who may read and link the project's monitors.
      await insert("TeamPermission", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: memberTeamId,
        permission: Permission.ProjectMember,
        isBlockPermission: false,
        scope: PermissionScope.All,
        version: 1,
      });

      await insert("Label", {
        _id: kioskLabelId,
        projectId: projectId,
        name: "SubCategory: Kiosk",
        slug: kioskLabelId.toString(),
        color: "#6366f1",
        version: 1,
      });

      // The report's two, and their neighbours under the same search.
      await insertMonitor({
        name: "WB1500KSK01",
        monitorType: MonitorType.Ping,
        monitorTemplateId: templateId,
        labelId: kioskLabelId,
      });
      await insertMonitor({
        name: "WB1500KSK02",
        monitorType: MonitorType.Ping,
        labelId: kioskLabelId,
      });
      // Linked to another template: it moves to this one.
      await insertMonitor({
        name: "WB1500KSK03",
        monitorType: MonitorType.Ping,
        monitorTemplateId: otherTemplateId,
        labelId: kioskLabelId,
      });
      // Another type: a Ping template never links it.
      await insertMonitor({
        name: "WB1500KSK04",
        monitorType: MonitorType.API,
        labelId: kioskLabelId,
      });
      // Archived: hidden from every monitor list, and not offered either.
      await insertMonitor({
        name: "WB1500KSK05",
        monitorType: MonitorType.Ping,
        isArchived: true,
        labelId: kioskLabelId,
      });
      // Another project's.
      await insertMonitor({
        name: "WB1500KSK06",
        monitorType: MonitorType.Ping,
        inProject: otherProjectId,
      });

      // The rest of the template's 264.
      await insertMonitors({
        prefix: "WB2000KSK",
        digits: 3,
        count: LINKED_TO_TEMPLATE - 1,
        monitorType: MonitorType.Ping,
        monitorTemplateId: templateId,
      });

      // Ping monitors of the project's other sites, linked to nothing.
      await insertMonitors({
        prefix: "AP",
        digits: 6,
        count: PING_MONITORS_BEFORE_WB,
        monitorType: MonitorType.Ping,
      });

      await insertMonitors({
        prefix: "WB3000KSK",
        digits: 4,
        count: UNLINKED_WB3000,
        monitorType: MonitorType.Ping,
      });

      // Other types, named like the Ping ones, linked to nothing.
      await insertMonitors({
        prefix: "WB1500KSK9",
        digits: 3,
        count: OTHER_TYPE_MONITORS,
        monitorType: MonitorType.Website,
      });

      await database.query(`ANALYZE "${schema}"."Monitor"`);
    }, 600000);

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    describe("the read the dialog made until now", () => {
      test("never had WB1500KSK02 to offer: 10,000 Ping monitors by name, the search in the browser", async () => {
        // The read as 17.0.0 made it, and what it did with the answer.
        const read: Listed = await listMonitors({
          query: {
            projectId: projectId,
            monitorType: MonitorType.Ping,
          },
          select: { _id: true, name: true, monitorTemplateId: true },
          limit: LIMIT_PER_PROJECT,
        });

        expect(read.names).toHaveLength(LIMIT_PER_PROJECT);
        expect(read.count).toBeGreaterThan(LIMIT_PER_PROJECT);

        const offered: Array<string> = read.names.filter(
          (_name: string, index: number): boolean => {
            return read.templateIds[index] !== templateId.toString();
          },
        );

        // react-select's search: case-insensitive, anywhere in the name.
        const matches: Array<string> = offered.filter(
          (name: string): boolean => {
            return name.toLowerCase().includes("wb1500ksk0");
          },
        );

        expect(read.names).not.toContain("WB1500KSK02");
        expect(matches).toEqual([]);
      });
    });

    describe("a search, as the picker sends it", () => {
      test("finds WB1500KSK02, and the one linked to another template, and nothing else", async () => {
        const found: Listed = await search("WB1500KSK0");

        expect(found.names).toEqual(["WB1500KSK02", "WB1500KSK03"]);
        expect(found.count).toBe(2);
      });

      test("never the template's own, another type, an archived one or another project's", async () => {
        const found: Listed = await search("WB1500KSK0");

        for (const name of [
          "WB1500KSK01",
          "WB1500KSK04",
          "WB1500KSK05",
          "WB1500KSK06",
        ]) {
          expect({ name, isListed: found.names.includes(name) }).toEqual({
            name,
            isListed: false,
          });
        }
      });

      test("finds a monitor by any part of its name, in any case", async () => {
        expect((await search("ksk02")).names).toEqual(["WB1500KSK02"]);
        expect((await search("1500KSK02")).names).toEqual(["WB1500KSK02"]);
        expect((await search("  WB1500KSK02  ")).names).toEqual([
          "WB1500KSK02",
        ]);
      });

      test("finds nothing where only the template's own monitors match", async () => {
        const found: Listed = await search("WB2000KSK");

        expect(found.names).toEqual([]);
        expect(found.count).toBe(0);
      });

      test("finds nothing of another type, however many share the name", async () => {
        const found: Listed = await search("WB1500KSK9");

        expect(found.names).toEqual([]);
        expect(found.count).toBe(0);
      });

      test("reads a match a wildcard would hide as written: _ and % are letters", async () => {
        expect((await search("WB1500KSK_2")).names).toEqual([]);
        expect((await search("WB1500%02")).names).toEqual([]);
      });

      test("pages more matches than fit, 50 at a time, by name, each once", async () => {
        const pages: Array<Listed> = [
          await search("WB3000", 0),
          await search("WB3000", PICKER_PAGE_SIZE),
          await search("WB3000", PICKER_PAGE_SIZE * 2),
        ];

        expect(
          pages.map((page: Listed): number => {
            return page.names.length;
          }),
        ).toEqual([50, 50, 20]);

        for (const page of pages) {
          expect(page.count).toBe(UNLINKED_WB3000);
        }

        const names: Array<string> = pages.flatMap(
          (page: Listed): Array<string> => {
            return page.names;
          },
        );

        expect(new Set(names).size).toBe(UNLINKED_WB3000);
        expect(names).toEqual([...names].sort());
        expect(names[0]).toBe("WB3000KSK0001");
        expect(names[names.length - 1]).toBe("WB3000KSK0120");
      });
    });

    describe("the open list, before anything is typed", () => {
      test("is 50 monitors that can be linked, by name, and counts every one of them", async () => {
        const opened: Listed = await search("");

        expect(opened.names).toHaveLength(PICKER_PAGE_SIZE);
        expect(opened.names[0]).toBe("AP000001");
        expect(opened.names).toEqual([...opened.names].sort());

        // The 10,050 AP, the 120 WB3000, WB1500KSK02 and WB1500KSK03.
        expect(opened.count).toBe(
          PING_MONITORS_BEFORE_WB + UNLINKED_WB3000 + 2,
        );
      });

      test("counts no monitor the template has, of all 264", async () => {
        const linked: Listed = await listMonitors({
          query: {
            monitorType: MonitorType.Ping,
            monitorTemplateId: templateId,
          },
          limit: PICKER_PAGE_SIZE,
        });

        expect(linked.count).toBe(LINKED_TO_TEMPLATE);
      });
    });

    describe("the Labels tab: every monitor with a label, at once", () => {
      test("picks the ones that can be linked, never the template's own, another type or an archived one", async () => {
        const query: Dictionary<unknown> | null = withLabels(pickerQuery(), [
          kioskLabelId.toString(),
        ]);

        expect(query).not.toBeNull();

        const picked: Listed = await listMonitors({
          query: query!,
          limit: LIMIT_PER_PROJECT,
        });

        expect(picked.names).toEqual(["WB1500KSK02", "WB1500KSK03"]);
      });
    });

    describe("why NotEqualOrNull, and not NotEqual", () => {
      test("NotEqual would lose every monitor linked to no template: WB1500KSK02 among them", async () => {
        const found: Listed = await listMonitors({
          query: withSearch(
            {
              ...pickerQuery(),
              monitorTemplateId: new NotEqual<string>(templateId.toString()),
            },
            "name",
            "WB1500KSK0",
          ),
          limit: PICKER_PAGE_SIZE,
        });

        expect(found.names).toEqual(["WB1500KSK03"]);
      });
    });

    describe("once linked", () => {
      test("a monitor leaves the search: it is the template's now", async () => {
        // What MonitorTemplateService.linkMonitor writes.
        await database.query(
          `UPDATE "${schema}"."Monitor" SET "monitorTemplateId" = $1 WHERE "_id" = $2`,
          [templateId.toString(), named["WB1500KSK02"]],
        );

        try {
          expect((await search("WB1500KSK0")).names).toEqual(["WB1500KSK03"]);
        } finally {
          await database.query(
            `UPDATE "${schema}"."Monitor" SET "monitorTemplateId" = NULL WHERE "_id" = $1`,
            [named["WB1500KSK02"]],
          );
        }

        expect((await search("WB1500KSK0")).names).toEqual([
          "WB1500KSK02",
          "WB1500KSK03",
        ]);
      });
    });
  },
);
