import Entities from "../../../Models/DatabaseModels/Index";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageService from "../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { INCIDENT_SCOPE_COLUMNS } from "../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import Dictionary from "../../../Types/Dictionary";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * The public status page endpoints against a migrated Postgres: what a page
 * shows of incidents limited to some status pages, with the real SQL behind
 * every read - the IncidentMonitor and IncidentStatusPage joins, the scope
 * split, the relation selects, the report count's window, and the rule that
 * a private incident or episode is shown on no page whatever its Visible on
 * Status Page switch says (StatusPageVisibility). The in-memory
 * version (StatusPageIncidentScope.test.ts) covers every endpoint and case;
 * this pins down that the same queries do the same on the database.
 *
 * Opt in with RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS=true \
 *   INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_HOST=127.0.0.1 \
 *   INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/StatusPageIncidentScopePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml with the other
 * incident status page scope tests.
 *
 * The tables the endpoints read are cloned, structure only (LIKE ...
 * INCLUDING ALL), into a uniquely named schema that search_path puts first;
 * no row is written outside it, and it is dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS"] === "true"
    ? describe
    : describe.skip;

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const TABLES: Array<string> = [
  "Project",
  "ProjectSMTPConfig",
  "ProjectCallSMSConfig",
  "Label",
  "File",
  "StatusPage",
  "StatusPageLabel",
  "StatusPageDownMonitorStatus",
  "StatusPageGroup",
  "StatusPageResource",
  "StatusPageHistoryChartBarColorRule",
  "Monitor",
  "MonitorStatus",
  "MonitorGroup",
  "MonitorGroupResource",
  "IncidentSeverity",
  "IncidentState",
  "Incident",
  "IncidentMonitor",
  "IncidentStatusPage",
  "IncidentLabel",
  "IncidentPostmortemAttachmentFile",
  "IncidentStateTimeline",
  "IncidentPublicNote",
  "IncidentPublicNoteFile",
  "IncidentEpisode",
  "IncidentEpisodeLabel",
  "IncidentEpisodeMember",
  "IncidentEpisodeStateTimeline",
  "IncidentEpisodePublicNote",
  "IncidentEpisodePublicNoteFile",
];

const OVERVIEW_ROUTE: string = "/status-page/overview/:statusPageIdOrDomain";
const INCIDENTS_ROUTE: string = "/status-page/incidents/:statusPageIdOrDomain";
const INCIDENT_DETAIL_ROUTE: string = `${INCIDENTS_ROUTE}/:incidentId`;
const EPISODES_ROUTE: string = "/status-page/episodes/:statusPageIdOrDomain";
const EPISODE_DETAIL_ROUTE: string = `${EPISODES_ROUTE}/:episodeId`;

describePostgres(
  "The status page endpoints against a migrated Postgres",
  () => {
    const schema: string = `incident_scope_api_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      mockRouter.routes.length = 0;
      new StatusPageAPI();
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      StatusPageAPI.clearOverviewResponseCache();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    let siteA: ObjectID;
    let siteB: ObjectID;
    // Only shows incidents limited to it.
    let siteC: ObjectID;
    let sharedMonitor: ObjectID;
    let secondMonitor: ObjectID;
    let investigating: ObjectID;
    let resolved: ObjectID;

    // The incidents, by where they are limited to.
    let unscoped: ObjectID;
    let scopedToA: ObjectID;
    let scopedToAAndC: ObjectID;
    let scopedToDeletedPage: ObjectID;
    let hiddenScopedToB: ObjectID;
    let secondScopedToA: ObjectID;
    let resolvedScopedToB: ObjectID;
    let otherProjectIncident: ObjectID;
    // Private, with Visible on Status Page on: shown nowhere.
    let privateUnscoped: ObjectID;
    let privateScopedToAAndC: ObjectID;

    // The episodes, by their members.
    let episodeScopedToA: ObjectID;
    let episodeMixed: ObjectID;
    // Its only incident is private.
    let episodeOfPrivateIncident: ObjectID;
    // Private itself, of an incident every page shows.
    let privateEpisode: ObjectID;

    async function insert(
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> {
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
    }

    async function seedProject(id: ObjectID): Promise<void> {
      await insert("Project", {
        _id: id,
        name: "Scope API test",
        slug: `scope-api-${id.toString()}`,
        version: 1,
      });
    }

    async function seedState(data: {
      name: string;
      order: number;
      isResolvedState: boolean;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await insert("IncidentState", {
        _id: id,
        projectId: projectId,
        name: data.name,
        slug: `${data.name.toLowerCase()}-${id.toString()}`,
        color: "#000000",
        order: data.order,
        isResolvedState: data.isResolvedState,
        isCreatedState: data.order === 1,
        version: 1,
      });
      return id;
    }

    async function seedStatusPage(
      name: string,
      onlyShowScopedIncidents: boolean,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await insert("StatusPage", {
        _id: id,
        projectId: projectId,
        name: name,
        slug: `page-${id.toString()}`,
        version: 1,
        isPublicStatusPage: true,
        showIncidentsOnStatusPage: true,
        showEpisodesOnStatusPage: true,
        // Not what this test is about; each would need its own tables.
        showAnnouncementsOnStatusPage: false,
        showScheduledMaintenanceEventsOnStatusPage: false,
        onlyShowScopedIncidents: onlyShowScopedIncidents,
      });
      return id;
    }

    async function seedMonitor(name: string): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await insert("Monitor", {
        _id: id,
        projectId: projectId,
        name: name,
        slug: `monitor-${id.toString()}`,
        monitorType: "Manual",
        currentMonitorStatusId: ObjectID.generate(),
        version: 1,
      });
      return id;
    }

    async function listMonitorOnPage(
      monitorId: ObjectID,
      statusPageId: ObjectID,
    ): Promise<void> {
      await insert("StatusPageResource", {
        _id: ObjectID.generate(),
        projectId: projectId,
        statusPageId: statusPageId,
        monitorId: monitorId,
        displayName: "Checkout",
        order: 1,
        version: 1,
        // No uptime history: the timeline queries are not what this is about.
        showStatusHistoryChart: false,
        showUptimePercent: false,
      });
    }

    async function seedIncident(data: {
      title: string;
      monitorIds: Array<ObjectID>;
      hoursAgo: number;
      scopedTo?: Array<ObjectID>;
      isVisibleOnStatusPage?: boolean;
      isPrivate?: boolean;
      project?: ObjectID;
      stateId?: ObjectID;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const at: Date = new Date(Date.now() - data.hoursAgo * 60 * 60 * 1000);

      await insert("Incident", {
        _id: id,
        projectId: data.project || projectId,
        title: data.title,
        slug: `incident-${id.toString()}`,
        currentIncidentStateId: data.stateId || investigating,
        incidentSeverityId: ObjectID.generate(),
        version: 1,
        createdAt: at,
        declaredAt: at,
        isVisibleOnStatusPage: data.isVisibleOnStatusPage !== false,
        isPrivate: data.isPrivate === true,
        isScopedToStatusPages: data.scopedTo !== undefined,
        statusPagesNotifiedOnCreation: JSON.stringify(
          (data.scopedTo || []).map((pageId: ObjectID): string => {
            return pageId.toString();
          }),
        ),
      });

      for (const monitorId of data.monitorIds) {
        await insert("IncidentMonitor", {
          incidentId: id,
          monitorId: monitorId,
        });
      }

      for (const statusPageId of data.scopedTo || []) {
        await insert("IncidentStatusPage", {
          incidentId: id,
          statusPageId: statusPageId,
        });
      }

      return id;
    }

    async function seedEpisode(
      title: string,
      memberIds: Array<ObjectID>,
      options?: { isPrivate?: boolean },
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await insert("IncidentEpisode", {
        _id: id,
        projectId: projectId,
        title: title,
        currentIncidentStateId: investigating,
        isVisibleOnStatusPage: true,
        isPrivate: options?.isPrivate === true,
        declaredAt: new Date(),
        version: 1,
      });

      for (const incidentId of memberIds) {
        await insert("IncidentEpisodeMember", {
          _id: ObjectID.generate(),
          projectId: projectId,
          incidentEpisodeId: id,
          incidentId: incidentId,
          version: 1,
        });
      }

      return id;
    }

    beforeEach(async () => {
      StatusPageAPI.clearOverviewResponseCache();

      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        })
          .reverse()
          .join("; "),
      );

      await seedProject(projectId);
      await seedProject(otherProjectId);

      investigating = await seedState({
        name: "Investigating",
        order: 1,
        isResolvedState: false,
      });
      resolved = await seedState({
        name: "Resolved",
        order: 2,
        isResolvedState: true,
      });

      siteA = await seedStatusPage("Site A", false);
      siteB = await seedStatusPage("Site B", false);
      siteC = await seedStatusPage("Site C", true);

      sharedMonitor = await seedMonitor("Shared uplink");
      secondMonitor = await seedMonitor("Payments");

      await listMonitorOnPage(sharedMonitor, siteA);
      await listMonitorOnPage(secondMonitor, siteA);
      await listMonitorOnPage(sharedMonitor, siteB);
      await listMonitorOnPage(secondMonitor, siteB);
      await listMonitorOnPage(sharedMonitor, siteC);

      unscoped = await seedIncident({
        title: "Checkout is down everywhere",
        monitorIds: [sharedMonitor],
        hoursAgo: 8,
      });
      scopedToA = await seedIncident({
        title: "Checkout is down at Site A",
        monitorIds: [sharedMonitor],
        hoursAgo: 7,
        scopedTo: [siteA],
      });
      scopedToAAndC = await seedIncident({
        title: "Checkout is down at Sites A and C",
        monitorIds: [sharedMonitor, secondMonitor],
        hoursAgo: 6,
        scopedTo: [siteA, siteC],
      });
      // Its only page was deleted: the flag stays, the join row is gone.
      scopedToDeletedPage = await seedIncident({
        title: "Checkout is down at a closed site",
        monitorIds: [sharedMonitor],
        hoursAgo: 5,
        scopedTo: [],
      });
      hiddenScopedToB = await seedIncident({
        title: "Checkout is down at Site B, not published",
        monitorIds: [sharedMonitor],
        hoursAgo: 4,
        scopedTo: [siteB],
        isVisibleOnStatusPage: false,
      });
      secondScopedToA = await seedIncident({
        title: "Payments are slow at Site A",
        monitorIds: [secondMonitor],
        hoursAgo: 3,
        scopedTo: [siteA],
      });
      resolvedScopedToB = await seedIncident({
        title: "Checkout was down at Site B",
        monitorIds: [sharedMonitor],
        hoursAgo: 2,
        scopedTo: [siteB],
        stateId: resolved,
      });
      otherProjectIncident = await seedIncident({
        title: "Another project's outage",
        monitorIds: [sharedMonitor],
        hoursAgo: 1,
        project: otherProjectId,
      });
      privateUnscoped = await seedIncident({
        title: "A private outage everywhere",
        monitorIds: [sharedMonitor, secondMonitor],
        hoursAgo: 0.5,
        isPrivate: true,
      });
      privateScopedToAAndC = await seedIncident({
        title: "A private outage at Sites A and C",
        monitorIds: [sharedMonitor],
        hoursAgo: 0.4,
        scopedTo: [siteA, siteC],
        isPrivate: true,
      });

      episodeScopedToA = await seedEpisode("Site A checkout episode", [
        scopedToA,
      ]);
      episodeMixed = await seedEpisode("Checkout and payments episode", [
        unscoped,
        secondScopedToA,
      ]);
      episodeOfPrivateIncident = await seedEpisode(
        "An episode of a private outage",
        [privateUnscoped],
      );
      privateEpisode = await seedEpisode("A private episode", [unscoped], {
        isPrivate: true,
      });

      (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
    });

    type RouteResult = {
      payload: JSONObject | null;
      error: unknown;
    };

    async function invokeRoute(data: {
      route: string;
      params: Dictionary<string>;
    }): Promise<RouteResult> {
      const req: ExpressRequest = {
        params: data.params,
        body: {},
        query: {},
        cookies: {},
        headers: {},
        socket: {},
        ips: [],
      } as unknown as ExpressRequest;
      const res: ExpressResponse = {
        send: jest.fn(),
        json: jest.fn(),
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as ExpressResponse;
      const next: jest.Mock = jest.fn() as unknown as jest.Mock;
      const responseMock: jest.Mock =
        Response.sendJsonObjectResponse as unknown as jest.Mock;
      const previousResponseCount: number = responseMock.mock.calls.length;

      await mockRouter
        .match("post", data.route)
        .handlerFunction(req, res, next as unknown as NextFunction);
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      if (next.mock.calls.length > 0) {
        return { payload: null, error: next.mock.calls[0]![0] };
      }

      return {
        payload:
          (responseMock.mock.calls[previousResponseCount]?.[2] as JSONObject) ||
          null,
        error: undefined,
      };
    }

    async function getJson(
      route: string,
      params: Dictionary<string>,
    ): Promise<JSONObject> {
      const result: RouteResult = await invokeRoute({ route, params });

      expect(result.error).toBeUndefined();
      expect(result.payload).not.toBeNull();

      // Never a scope column, anywhere in what a page is sent.
      const text: string = JSON.stringify(result.payload);
      for (const column of INCIDENT_SCOPE_COLUMNS) {
        expect(text).not.toContain(`"${column}"`);
      }

      return result.payload!;
    }

    function ids(items: unknown): Array<string> {
      return ((items as JSONArray) || [])
        .map((item: unknown): string => {
          return String((item as JSONObject)["_id"]);
        })
        .sort();
    }

    function sorted(values: Array<ObjectID>): Array<string> {
      return values
        .map((value: ObjectID): string => {
          return value.toString();
        })
        .sort();
    }

    test("the incident list shows each page the incidents in its scope", async () => {
      expect(
        ids(
          (
            await getJson(INCIDENTS_ROUTE, {
              statusPageIdOrDomain: siteA.toString(),
            })
          )["incidents"],
        ),
      ).toEqual(sorted([unscoped, scopedToA, scopedToAAndC, secondScopedToA]));

      expect(
        ids(
          (
            await getJson(INCIDENTS_ROUTE, {
              statusPageIdOrDomain: siteB.toString(),
            })
          )["incidents"],
        ),
      ).toEqual(sorted([unscoped, resolvedScopedToB]));

      expect(
        ids(
          (
            await getJson(INCIDENTS_ROUTE, {
              statusPageIdOrDomain: siteC.toString(),
            })
          )["incidents"],
        ),
      ).toEqual(sorted([scopedToAAndC]));
    });

    test("the incident list never shows an incident scoped to a deleted page, a hidden one or another project's", async () => {
      for (const page of [siteA, siteB, siteC]) {
        const shown: Array<string> = ids(
          (
            await getJson(INCIDENTS_ROUTE, {
              statusPageIdOrDomain: page.toString(),
            })
          )["incidents"],
        );

        expect(shown).not.toContain(scopedToDeletedPage.toString());
        expect(shown).not.toContain(hiddenScopedToB.toString());
        expect(shown).not.toContain(otherProjectIncident.toString());
      }
    });

    test("an incident opens only on a page in its scope", async () => {
      const open: (
        page: ObjectID,
        incident: ObjectID,
      ) => Promise<Array<string>> = async (
        page: ObjectID,
        incident: ObjectID,
      ): Promise<Array<string>> => {
        return ids(
          (
            await getJson(INCIDENT_DETAIL_ROUTE, {
              statusPageIdOrDomain: page.toString(),
              incidentId: incident.toString(),
            })
          )["incidents"],
        );
      };

      expect(await open(siteA, scopedToA)).toEqual([scopedToA.toString()]);
      expect(await open(siteB, scopedToA)).toEqual([]);
      expect(await open(siteC, scopedToAAndC)).toEqual([
        scopedToAAndC.toString(),
      ]);
      expect(await open(siteC, unscoped)).toEqual([]);
      expect(await open(siteA, scopedToDeletedPage)).toEqual([]);
    });

    test("the overview shows each page the active incidents in its scope, and names only those on its uptime bars", async () => {
      const siteAOverview: JSONObject = await getJson(OVERVIEW_ROUTE, {
        statusPageIdOrDomain: siteA.toString(),
      });
      expect(ids(siteAOverview["activeIncidents"])).toEqual(
        sorted([unscoped, scopedToA, scopedToAAndC, secondScopedToA]),
      );
      expect(ids(siteAOverview["timelineIncidents"])).toEqual(
        sorted([unscoped, scopedToA, scopedToAAndC, secondScopedToA]),
      );

      // The resolved incident is on the uptime bars, not among the active ones.
      const siteBOverview: JSONObject = await getJson(OVERVIEW_ROUTE, {
        statusPageIdOrDomain: siteB.toString(),
      });
      expect(ids(siteBOverview["activeIncidents"])).toEqual(sorted([unscoped]));
      expect(ids(siteBOverview["timelineIncidents"])).toEqual(
        sorted([unscoped, resolvedScopedToB]),
      );

      const siteCOverview: JSONObject = await getJson(OVERVIEW_ROUTE, {
        statusPageIdOrDomain: siteC.toString(),
      });
      expect(ids(siteCOverview["activeIncidents"])).toEqual(
        sorted([scopedToAAndC]),
      );
      expect(siteCOverview["statusPage"]).not.toHaveProperty(
        "onlyShowScopedIncidents",
      );
    });

    test("the overview and the episode list show each page the episodes of incidents in its scope", async () => {
      const expected: Array<[ObjectID, Array<ObjectID>]> = [
        [siteA, [episodeScopedToA, episodeMixed]],
        [siteB, [episodeMixed]],
        [siteC, []],
      ];

      for (const [page, episodes] of expected) {
        expect(
          ids(
            (
              await getJson(OVERVIEW_ROUTE, {
                statusPageIdOrDomain: page.toString(),
              })
            )["activeEpisodes"],
          ),
        ).toEqual(sorted(episodes));

        expect(
          ids(
            (
              await getJson(EPISODES_ROUTE, {
                statusPageIdOrDomain: page.toString(),
              })
            )["episodes"],
          ),
        ).toEqual(sorted(episodes));
      }
    });

    test("an episode opens by id only on a page one of its incidents is in the scope of, against those incidents' monitors", async () => {
      const onSiteB: JSONObject = await getJson(EPISODE_DETAIL_ROUTE, {
        statusPageIdOrDomain: siteB.toString(),
        episodeId: episodeMixed.toString(),
      });
      const episode: JSONObject = (
        onSiteB["episodes"] as JSONArray
      )[0] as JSONObject;
      expect(episode["_id"]).toBe(episodeMixed.toString());
      // The payments incident is limited to Site A: not shown against it here.
      expect(ids(episode["monitors"])).toEqual([sharedMonitor.toString()]);

      const onSiteA: JSONObject = await getJson(EPISODE_DETAIL_ROUTE, {
        statusPageIdOrDomain: siteA.toString(),
        episodeId: episodeMixed.toString(),
      });
      expect(
        ids(((onSiteA["episodes"] as JSONArray)[0] as JSONObject)["monitors"]),
      ).toEqual(sorted([sharedMonitor, secondMonitor]));

      for (const [page, episodeId] of [
        [siteB, episodeScopedToA],
        [siteC, episodeScopedToA],
        [siteC, episodeMixed],
      ] as Array<[ObjectID, ObjectID]>) {
        const result: RouteResult = await invokeRoute({
          route: EPISODE_DETAIL_ROUTE,
          params: {
            statusPageIdOrDomain: page.toString(),
            episodeId: episodeId.toString(),
          },
        });

        expect(result.error).toBeInstanceOf(NotFoundException);
      }
    });

    test("a private incident or episode is shown on no page, by any route, even with Visible on Status Page on", async () => {
      for (const page of [siteA, siteB, siteC]) {
        const overview: JSONObject = await getJson(OVERVIEW_ROUTE, {
          statusPageIdOrDomain: page.toString(),
        });
        const incidents: JSONObject = await getJson(INCIDENTS_ROUTE, {
          statusPageIdOrDomain: page.toString(),
        });
        const episodes: JSONObject = await getJson(EPISODES_ROUTE, {
          statusPageIdOrDomain: page.toString(),
        });

        const shown: Array<string> = [
          ...ids(overview["activeIncidents"]),
          ...ids(overview["timelineIncidents"]),
          ...ids(overview["activeEpisodes"]),
          ...ids(incidents["incidents"]),
          ...ids(episodes["episodes"]),
        ];

        for (const hidden of [
          privateUnscoped,
          privateScopedToAAndC,
          episodeOfPrivateIncident,
          privateEpisode,
        ]) {
          expect(shown).not.toContain(hidden.toString());
        }

        // Nothing of them in what the page is sent, by title either.
        const sent: string = JSON.stringify([overview, incidents, episodes]);
        expect(sent).not.toContain("A private outage");
        expect(sent).not.toContain("A private episode");
        expect(sent).not.toContain("An episode of a private outage");

        // Opened by id: nothing.
        for (const incident of [privateUnscoped, privateScopedToAAndC]) {
          expect(
            ids(
              (
                await getJson(INCIDENT_DETAIL_ROUTE, {
                  statusPageIdOrDomain: page.toString(),
                  incidentId: incident.toString(),
                })
              )["incidents"],
            ),
          ).toEqual([]);
        }

        // An episode only a private incident takes to the page is not found.
        const throughPrivate: RouteResult = await invokeRoute({
          route: EPISODE_DETAIL_ROUTE,
          params: {
            statusPageIdOrDomain: page.toString(),
            episodeId: episodeOfPrivateIncident.toString(),
          },
        });
        expect(throughPrivate.error).toBeInstanceOf(NotFoundException);
      }

      // A private episode of an incident the page shows opens as nothing.
      for (const page of [siteA, siteB]) {
        expect(
          ids(
            (
              await getJson(EPISODE_DETAIL_ROUTE, {
                statusPageIdOrDomain: page.toString(),
                episodeId: privateEpisode.toString(),
              })
            )["episodes"],
          ),
        ).toEqual([]);
      }
    });

    test("the report counts on each page the incidents it shows, visible and in its project", async () => {
      const count: (page: ObjectID, onlyScoped: boolean) => Promise<number> = (
        page: ObjectID,
        onlyScoped: boolean,
      ): Promise<number> => {
        const statusPage: StatusPage = new StatusPage();
        statusPage._id = page.toString();
        statusPage.projectId = projectId;
        statusPage.onlyShowScopedIncidents = onlyScoped;

        return StatusPageService.getIncidentCountByMonitorIds({
          statusPage: statusPage,
          monitorIds: [sharedMonitor, secondMonitor],
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          endDate: new Date(),
        });
      };

      // unscoped, limited to A, limited to A and C (on both monitors: once), payments at A.
      expect(await count(siteA, false)).toBe(4);
      // unscoped, the resolved one limited to B. Not the hidden one.
      expect(await count(siteB, false)).toBe(2);
      // Never a private one, on any page.
      expect(await count(siteC, true)).toBe(1);

      // A window that ends before any of them: none.
      const statusPage: StatusPage = new StatusPage();
      statusPage._id = siteA.toString();
      statusPage.projectId = projectId;
      statusPage.onlyShowScopedIncidents = false;

      expect(
        await StatusPageService.getIncidentCountByMonitorIds({
          statusPage: statusPage,
          monitorIds: [sharedMonitor],
          startDate: new Date(Date.now() - 48 * 60 * 60 * 1000),
          endDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        }),
      ).toBe(0);
    });
  },
);
