import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  valuesOf,
} from "./PostgresListRouteHarness";
import BaseAPI from "../../../Server/API/BaseAPI";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import HostService from "../../../Server/Services/HostService";
import IncidentService from "../../../Server/Services/IncidentService";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import LinkedTo, {
  LINKED_TO_QUERY_KEY,
  LinkedToMatch,
} from "../../../Types/BaseDatabase/LinkedTo";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import buildAffectedResourcesFacet from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/buildAffectedResourcesFacet";
import {
  buildFacetColumnQuery,
  FacetColumnQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE AFFECTED RESOURCE FILTER, ANSWERED BY POSTGRES (#11073).
 *
 * The incidents, alerts and scheduled maintenance lists' Affected
 * Resources chip read the ids of the records each picked resource type
 * touches - the first 10,000 of each - and filtered the list by those ids:
 * a monitor with more incidents than that listed at most 10,000 of them,
 * counted as many, and nothing said the list was cut short. Its filter is
 * one LinkedTo in the list's own query now, which the server answers with
 * a subquery per relation.
 *
 * Every query here is the one the chip writes (buildAffectedResourcesFacet
 * and buildFacetColumnQuery, the Dashboard's own), serialized as ModelAPI
 * serializes it and read through POST /incident/get-list or
 * /alert/get-list as a member of the project (PostgresListRouteHarness):
 * the real user middleware, the permission pipeline, the query serializer
 * and TypeORM.
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

// More incidents on one monitor than the chip used to read: its first 10,000.
const PAST_THE_CAP: number = 10_050;

describePostgres(
  "the Affected Resources chip lists every record it matches, on Postgres (#11073)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "affected_resources",
      tables: [
        "Incident",
        "IncidentMonitor",
        "IncidentHost",
        "IncidentLabel",
        "Alert",
        "AlertHost",
        "Monitor",
        "Host",
      ],
    });

    // The list routes, as the app registers them.
    new BaseAPI(
      Incident as { new (): BaseModel },
      IncidentService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      Alert as { new (): BaseModel },
      AlertService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      Host as { new (): BaseModel },
      HostService as unknown as DatabaseService<BaseModel>,
    );

    const projectId: ObjectID = ObjectID.generate();
    const bulkProjectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    // A member who may read only the incidents labelled Payments.
    const paymentsMemberId: ObjectID = ObjectID.generate();
    const paymentsLabelId: ObjectID = ObjectID.generate();

    const stateId: ObjectID = ObjectID.generate();
    const severityId: ObjectID = ObjectID.generate();
    const monitorStatusId: ObjectID = ObjectID.generate();

    const checkoutMonitorId: ObjectID = ObjectID.generate();
    const apiMonitorId: ObjectID = ObjectID.generate();
    // Deleted since it was picked.
    const retiredMonitorId: ObjectID = ObjectID.generate();
    const busyMonitorId: ObjectID = ObjectID.generate();
    const webHostId: ObjectID = ObjectID.generate();
    const dbHostId: ObjectID = ObjectID.generate();
    const archivedHostId: ObjectID = ObjectID.generate();
    const deletedHostId: ObjectID = ObjectID.generate();

    const incidentFacet: ResourceFacet = buildAffectedResourcesFacet<Incident>({
      parentModelType: Incident,
      includeNetworkDevice: true,
      includeCloudResource: true,
      includeServiceLevelObjective: true,
    });

    // The Alerts table's: its monitors are the Monitor chip's.
    const alertFacet: ResourceFacet = buildAffectedResourcesFacet<Alert>({
      parentModelType: Alert,
      monitorQueryField: "monitorId",
      includeNetworkDevice: true,
      includeCloudResource: true,
      includeServiceLevelObjective: true,
    });

    const insertMonitor: (data: {
      id: ObjectID;
      name: string;
      inProject?: ObjectID | undefined;
      isDeleted?: boolean | undefined;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      name: string;
      inProject?: ObjectID | undefined;
      isDeleted?: boolean | undefined;
    }): Promise<void> => {
      await harness.insert("Monitor", {
        _id: data.id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `${data.name}-${data.id.toString()}`,
        monitorType: "Manual",
        currentMonitorStatusId: monitorStatusId,
        isArchived: false,
        deletedAt: data.isDeleted ? new Date() : null,
      });
    };

    const insertHost: (data: {
      id: ObjectID;
      name: string;
      isArchived?: boolean | undefined;
      isDeleted?: boolean | undefined;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      name: string;
      isArchived?: boolean | undefined;
      isDeleted?: boolean | undefined;
    }): Promise<void> => {
      await harness.insert("Host", {
        _id: data.id,
        version: 1,
        projectId: projectId,
        name: data.name,
        slug: `${data.name}-${data.id.toString()}`,
        hostIdentifier: data.name,
        isArchived: Boolean(data.isArchived),
        deletedAt: data.isDeleted ? new Date() : null,
      });
    };

    const insertIncident: (data: {
      title: string;
      monitorIds?: Array<ObjectID> | undefined;
      hostIds?: Array<ObjectID> | undefined;
      labelId?: ObjectID | undefined;
      inProject?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      title: string;
      monitorIds?: Array<ObjectID> | undefined;
      hostIds?: Array<ObjectID> | undefined;
      labelId?: ObjectID | undefined;
      inProject?: ObjectID | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();

      await harness.insert("Incident", {
        _id: id,
        version: 1,
        projectId: data.inProject || projectId,
        title: data.title,
        slug: `${data.title}-${id.toString()}`,
        currentIncidentStateId: stateId,
        incidentSeverityId: severityId,
        isPrivate: false,
      });

      for (const monitorId of data.monitorIds || []) {
        await harness.insert("IncidentMonitor", {
          incidentId: id,
          monitorId: monitorId,
        });
      }

      for (const hostId of data.hostIds || []) {
        await harness.insert("IncidentHost", { incidentId: id, hostId });
      }

      if (data.labelId) {
        await harness.insert("IncidentLabel", {
          incidentId: id,
          labelId: data.labelId,
        });
      }
    };

    const insertAlert: (data: {
      title: string;
      monitorId?: ObjectID | undefined;
      hostIds?: Array<ObjectID> | undefined;
    }) => Promise<void> = async (data: {
      title: string;
      monitorId?: ObjectID | undefined;
      hostIds?: Array<ObjectID> | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();

      await harness.insert("Alert", {
        _id: id,
        version: 1,
        projectId: projectId,
        title: data.title,
        currentAlertStateId: stateId,
        alertSeverityId: severityId,
        monitorId: data.monitorId || null,
        isPrivate: false,
      });

      for (const hostId of data.hostIds || []) {
        await harness.insert("AlertHost", { alertId: id, hostId });
      }
    };

    // The chip's filter for these picks, as the facet bar merges it into the list's query.
    const chip: (
      facet: ResourceFacet,
      operator: "is" | "is_not",
      picks: Array<string>,
    ) => Dictionary<unknown> = (
      facet: ResourceFacet,
      operator: "is" | "is_not",
      picks: Array<string>,
    ): Dictionary<unknown> => {
      const columnQuery: FacetColumnQuery | null = buildFacetColumnQuery({
        facet: facet,
        operator: operator,
        values: picks,
        existingValue: undefined,
      });

      expect(columnQuery?.field).toBe(LINKED_TO_QUERY_KEY);

      return { [columnQuery!.field]: columnQuery!.value };
    };

    const listIncidents: (data: {
      chips: Dictionary<unknown>;
      asUserId?: ObjectID | undefined;
      inProject?: ObjectID | undefined;
      limit?: number | undefined;
      skip?: number | undefined;
    }) => Promise<ListedPage<Incident>> = async (data: {
      chips: Dictionary<unknown>;
      asUserId?: ObjectID | undefined;
      inProject?: ObjectID | undefined;
      limit?: number | undefined;
      skip?: number | undefined;
    }): Promise<ListedPage<Incident>> => {
      return await harness.list<Incident>({
        path: "/incident",
        query: { ...data.chips },
        select: { _id: true, title: true },
        sort: { title: SortOrder.Ascending },
        limit: data.limit || 100,
        skip: data.skip || 0,
        userId: data.asUserId || memberId,
        projectId: data.inProject || projectId,
      });
    };

    const listAlerts: (
      chips: Dictionary<unknown>,
    ) => Promise<ListedPage<Alert>> = async (
      chips: Dictionary<unknown>,
    ): Promise<ListedPage<Alert>> => {
      return await harness.list<Alert>({
        path: "/alert",
        query: { ...chips },
        select: { _id: true, title: true },
        sort: { title: SortOrder.Ascending },
        limit: 100,
        userId: memberId,
        projectId: projectId,
      });
    };

    const titlesOf: (page: ListedPage<BaseModel>) => Array<string> = (
      page: ListedPage<BaseModel>,
    ): Array<string> => {
      return valuesOf(page, "title");
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Checkout");
      await harness.insertProject(bulkProjectId, "Busy");
      await harness.insertProject(otherProjectId, "Another project");

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });

      await harness.insertTeamPermission({
        userId: memberId,
        projectId: bulkProjectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });

      await harness.insertLabel({
        id: paymentsLabelId,
        projectId: projectId,
        name: "Payments",
      });

      await harness.insertMember({
        userId: paymentsMemberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ReadProjectIncident,
        labelIds: [paymentsLabelId],
      });

      await insertMonitor({ id: checkoutMonitorId, name: "checkout" });
      await insertMonitor({ id: apiMonitorId, name: "api" });
      await insertMonitor({
        id: retiredMonitorId,
        name: "retired",
        isDeleted: true,
      });
      await insertMonitor({
        id: busyMonitorId,
        name: "busy",
        inProject: bulkProjectId,
      });
      await insertHost({ id: webHostId, name: "web-1" });
      await insertHost({ id: dbHostId, name: "db-1" });
      await insertHost({
        id: archivedHostId,
        name: "old-web",
        isArchived: true,
      });
      await insertHost({ id: deletedHostId, name: "gone", isDeleted: true });

      /*
       * The small project: A on the checkout monitor, B on web-1, C on
       * both, D on the api monitor and db-1, E on nothing, F on the retired
       * monitor only; A and C are Payments'.
       */
      await insertIncident({
        title: "A",
        monitorIds: [checkoutMonitorId],
        labelId: paymentsLabelId,
      });
      await insertIncident({ title: "B", hostIds: [webHostId] });
      await insertIncident({
        title: "C",
        monitorIds: [checkoutMonitorId],
        hostIds: [webHostId],
        labelId: paymentsLabelId,
      });
      await insertIncident({
        title: "D",
        monitorIds: [apiMonitorId],
        hostIds: [dbHostId],
      });
      await insertIncident({ title: "E" });
      await insertIncident({ title: "F", monitorIds: [retiredMonitorId] });
      // Another project's incident on the checkout monitor's id.
      await insertIncident({
        title: "Elsewhere",
        monitorIds: [checkoutMonitorId],
        inProject: otherProjectId,
      });

      // The busy project: more incidents on one monitor than the cap, and a few on none.
      await harness.query(
        `INSERT INTO "${harness.schema}"."Incident" ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "isPrivate", "version")
         SELECT gen_random_uuid(), $1, 'Busy ' || lpad(n::text, 5, '0'), 'busy-' || n, $2, $3, false, 1
         FROM generate_series(1, $4::int) AS n`,
        [
          bulkProjectId.toString(),
          stateId.toString(),
          severityId.toString(),
          PAST_THE_CAP,
        ],
      );
      await harness.query(
        `INSERT INTO "${harness.schema}"."IncidentMonitor" ("incidentId", "monitorId")
         SELECT "_id", $1 FROM "${harness.schema}"."Incident" WHERE "projectId" = $2`,
        [busyMonitorId.toString(), bulkProjectId.toString()],
      );
      for (const title of ["Quiet 1", "Quiet 2", "Quiet 3"]) {
        await insertIncident({ title, inProject: bulkProjectId });
      }
      await harness.analyze("Incident");
      await harness.analyze("IncidentMonitor");

      // Alerts: by their monitor (a column of theirs), or a host (a join table).
      await insertAlert({ title: "X", monitorId: checkoutMonitorId });
      await insertAlert({ title: "Y", hostIds: [webHostId] });
      await insertAlert({ title: "Z" });
      await insertAlert({ title: "W", monitorId: apiMonitorId });
    }, 600_000);

    afterAll(async () => {
      await harness.tearDown();
    });

    test(`a monitor with ${PAST_THE_CAP} incidents lists and counts every one of them`, async () => {
      const filter: Dictionary<unknown> = chip(incidentFacet, "is", [
        `monitor:${busyMonitorId.toString()}`,
      ]);

      const firstPage: ListedPage<Incident> = await listIncidents({
        chips: filter,
        inProject: bulkProjectId,
        limit: 10,
      });

      expect(firstPage.count).toBe(PAST_THE_CAP);
      expect(titlesOf(firstPage)).toEqual(
        Array.from({ length: 10 }, (_: unknown, index: number): string => {
          return `Busy ${String(index + 1).padStart(5, "0")}`;
        }),
      );

      // The page past the old cap holds the last of them.
      const lastPage: ListedPage<Incident> = await listIncidents({
        chips: filter,
        inProject: bulkProjectId,
        limit: 10,
        skip: PAST_THE_CAP - 5,
      });

      expect(lastPage.count).toBe(PAST_THE_CAP);
      expect(titlesOf(lastPage)).toEqual(
        [10_046, 10_047, 10_048, 10_049, 10_050].map((n: number): string => {
          return `Busy ${n}`;
        }),
      );
    });

    test(`"is not" that monitor keeps only the incidents on none, past the cap too`, async () => {
      const page: ListedPage<Incident> = await listIncidents({
        chips: chip(incidentFacet, "is_not", [
          `monitor:${busyMonitorId.toString()}`,
        ]),
        inProject: bulkProjectId,
      });

      expect(page.count).toBe(3);
      expect(titlesOf(page)).toEqual(["Quiet 1", "Quiet 2", "Quiet 3"]);
    });

    test("a monitor or a host: the incidents touching either, each once", async () => {
      const page: ListedPage<Incident> = await listIncidents({
        chips: chip(incidentFacet, "is", [
          `monitor:${checkoutMonitorId.toString()}`,
          `host:${webHostId.toString()}`,
        ]),
      });

      expect(titlesOf(page)).toEqual(["A", "B", "C"]);
      expect(page.count).toBe(3);
    });

    test('"is not" them: the incidents touching neither, those touching nothing included', async () => {
      const page: ListedPage<Incident> = await listIncidents({
        chips: chip(incidentFacet, "is_not", [
          `monitor:${checkoutMonitorId.toString()}`,
          `host:${webHostId.toString()}`,
        ]),
      });

      expect(titlesOf(page)).toEqual(["D", "E", "F"]);
    });

    test("is and is not split the list in two, whatever the picks", async () => {
      const everything: ListedPage<Incident> = await listIncidents({
        chips: {},
      });

      for (const picks of [
        [`monitor:${apiMonitorId.toString()}`],
        [`host:${dbHostId.toString()}`, `host:${webHostId.toString()}`],
        [
          `monitor:${retiredMonitorId.toString()}`,
          `monitor:${checkoutMonitorId.toString()}`,
        ],
      ]) {
        const matching: Array<string> = titlesOf(
          await listIncidents({ chips: chip(incidentFacet, "is", picks) }),
        );
        const rest: Array<string> = titlesOf(
          await listIncidents({ chips: chip(incidentFacet, "is_not", picks) }),
        );

        expect([...matching, ...rest].sort()).toEqual(titlesOf(everything));
        expect(
          matching.filter((title: string): boolean => {
            return rest.includes(title);
          }),
        ).toEqual([]);
      }
    });

    test("a deleted monitor's links count for neither: nothing is on it, and nothing is kept from not being on it", async () => {
      expect(
        titlesOf(
          await listIncidents({
            chips: chip(incidentFacet, "is", [
              `monitor:${retiredMonitorId.toString()}`,
            ]),
          }),
        ),
      ).toEqual([]);

      expect(
        titlesOf(
          await listIncidents({
            chips: chip(incidentFacet, "is_not", [
              `monitor:${retiredMonitorId.toString()}`,
            ]),
          }),
        ),
      ).toEqual(["A", "B", "C", "D", "E", "F"]);
    });

    test("another project's incidents are never listed, whatever they are linked to", async () => {
      const page: ListedPage<Incident> = await listIncidents({
        chips: chip(incidentFacet, "is", [
          `monitor:${checkoutMonitorId.toString()}`,
        ]),
      });

      expect(titlesOf(page)).toEqual(["A", "C"]);
    });

    test("the filter never widens what a member may read: Payments' reader sees only Payments' incidents", async () => {
      const page: ListedPage<Incident> = await listIncidents({
        chips: chip(incidentFacet, "is", [
          `monitor:${checkoutMonitorId.toString()}`,
          `host:${webHostId.toString()}`,
          `monitor:${apiMonitorId.toString()}`,
        ]),
        asUserId: paymentsMemberId,
      });

      expect(titlesOf(page)).toEqual(["A", "C"]);
      expect(page.count).toBe(2);
    });

    test("picks that name nothing match nothing, and the list says so rather than listing everything", async () => {
      const filter: Dictionary<unknown> = chip(incidentFacet, "is", [
        "host:not-an-id",
        `somethingElse:${webHostId.toString()}`,
      ]);

      const page: ListedPage<Incident> = await listIncidents({
        chips: filter,
      });

      expect(page.count).toBe(0);
    });

    test("alerts: by their monitor, a column of theirs, or a host, through a join table", async () => {
      expect(
        titlesOf(
          await listAlerts(
            chip(alertFacet, "is", [
              `monitor:${checkoutMonitorId.toString()}`,
              `host:${webHostId.toString()}`,
            ]),
          ),
        ),
      ).toEqual(["X", "Y"]);

      // An alert with no monitor is on none of them.
      expect(
        titlesOf(
          await listAlerts(
            chip(alertFacet, "is_not", [
              `monitor:${checkoutMonitorId.toString()}`,
            ]),
          ),
        ),
      ).toEqual(["W", "Y", "Z"]);
    });

    test("a filter naming a relation the records lack is refused, not answered with everything", async () => {
      await expect(
        listIncidents({
          chips: {
            [LINKED_TO_QUERY_KEY]: new LinkedTo({
              match: LinkedToMatch.AnyOf,
              relations: { networkSites: [webHostId.toString()] },
            }),
          },
        }),
      ).rejects.toThrow(/networkSites/);
    });

    test("the chip's saved picks are read by their ids: one archived is marked, one deleted is gone", async () => {
      harness.routeModelAPIReads({ userId: memberId, projectId: projectId });

      const options: Array<FilterChipDropdownOption> =
        await incidentFacet.resolveOptions!(projectId, [
          `host:${webHostId.toString()}`,
          `host:${archivedHostId.toString()}`,
          `host:${deletedHostId.toString()}`,
        ]);

      expect(
        options.map((option: FilterChipDropdownOption) => {
          return [
            option.value,
            option.isNotFound ? "gone" : option.label,
            Boolean(option.isArchived),
          ];
        }),
      ).toEqual([
        [`host:${webHostId.toString()}`, "web-1", false],
        [`host:${archivedHostId.toString()}`, "old-web", true],
        [`host:${deletedHostId.toString()}`, "gone", false],
      ]);
    });
  },
);
