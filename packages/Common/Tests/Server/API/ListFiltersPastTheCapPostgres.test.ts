import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  valuesOf,
} from "./PostgresListRouteHarness";
import BaseAPI from "../../../Server/API/BaseAPI";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  CloudEnvironmentStatus,
  buildCloudEnvironmentStatusFilter,
  buildCloudEnvironmentStatusQuery,
  getCloudEnvironmentStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsEnvironmentStatus";
import {
  buildDatabaseEngineMetricsStatusFilter,
  buildDatabaseEngineMetricsStatusQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseEngineMetricsFilter";
import {
  DatabaseEngineMetricsStatus,
  getDatabaseEngineMetricsStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import {
  FacetColumnQuery,
  buildFacetColumnQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import { FilterOperator } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { buildTeamMemberFilter } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ProjectUserFacetOptions";
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
 * THE STATUS AND MEMBER CHIPS, ANSWERED BY POSTGRES (#11211).
 *
 * The Databases list's Engine Metrics chip, All Environments' Status chip
 * and the Teams list's Member chip each read the ids of the records their
 * picks match first - the first 10,000 - and narrowed the list by those
 * ids: a status, or a person, with more records than that listed and
 * counted at most 10,000 of them, and nothing said the list was cut short.
 * The two status chips are one FilterGroups in the list's own query now,
 * and the Member chip one LinkedTo through TeamMember, which the server
 * answers inside the query that lists the records.
 *
 * Every filter here is the one the chip writes (the Dashboard's own
 * builders, through buildFacetColumnQuery), serialized as ModelAPI
 * serializes it and read through POST <model>/get-list as a member of the
 * project (PostgresListRouteHarness): the real user middleware, the
 * permission pipeline, the query serializer and TypeORM. The old reads -
 * each status's ids first, capped at 10,000 - are made too, to show where
 * they stopped.
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

// More records of one status, or of one person, than the chips used to read.
const PAST_THE_CAP: number = 10_050;

// The names of the bulk rows, in the order the lists sort them.
const bulkName: (prefix: string, n: number) => string = (
  prefix: string,
  n: number,
): string => {
  return `${prefix} ${String(n).padStart(5, "0")}`;
};

// Every set of statuses a person can pick from three: one, two or all.
const subsetsOf: <T>(values: Array<T>) => Array<Array<T>> = <T>(
  values: Array<T>,
): Array<Array<T>> => {
  const subsets: Array<Array<T>> = [];

  for (let mask: number = 1; mask < 1 << values.length; mask++) {
    subsets.push(
      values.filter((_: T, index: number): boolean => {
        return (mask & (1 << index)) !== 0;
      }),
    );
  }

  return subsets;
};

describePostgres(
  "the status and member chips list every record they match, on Postgres (#11211)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "list_filters_cap",
      tables: ["DatabaseServer", "DatabaseServerLabel", "CloudResource"],
    });

    // The list routes, as the app registers them.
    new BaseAPI(
      DatabaseServer as { new (): BaseModel },
      DatabaseServerService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      CloudResource as { new (): BaseModel },
      CloudResourceService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      Team as { new (): BaseModel },
      TeamService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      TeamMember as { new (): BaseModel },
      TeamMemberService as unknown as DatabaseService<BaseModel>,
    );

    const projectId: ObjectID = ObjectID.generate();
    const bulkProjectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const memberTeamId: ObjectID = ObjectID.generate();
    const memberBulkTeamId: ObjectID = ObjectID.generate();
    // A member who may read only the databases labelled Payments.
    const paymentsMemberId: ObjectID = ObjectID.generate();
    const paymentsTeamId: ObjectID = ObjectID.generate();
    const paymentsLabelId: ObjectID = ObjectID.generate();
    // A member of the project who may read neither databases nor teams.
    const incidentsMemberId: ObjectID = ObjectID.generate();
    const incidentsTeamId: ObjectID = ObjectID.generate();

    // The small project's teams the members' permissions are kept in.
    const PERMISSION_TEAMS: Array<string> = [
      memberTeamId,
      paymentsTeamId,
      incidentsTeamId,
    ].map((teamId: ObjectID): string => {
      return `Team ${teamId.toString()}`;
    });

    // People in teams: Alice, Bob, and Carol, who left T4.
    const aliceId: ObjectID = ObjectID.generate();
    const bobId: ObjectID = ObjectID.generate();
    const carolId: ObjectID = ObjectID.generate();

    const SEEN_AT: Date = new Date("2026-11-20T10:00:00.000Z");

    /*
     * The small project's databases, each by what its two columns hold,
     * and the status the Status column draws it with.
     */
    const DATABASES: Array<{
      name: string;
      otelCollectorStatus: string | null;
      collectorLastSeenAt: Date | null;
      labelled?: boolean | undefined;
    }> = [
      {
        name: "a-connected",
        otelCollectorStatus: "connected",
        collectorLastSeenAt: SEEN_AT,
        labelled: true,
      },
      {
        name: "b-stopped",
        otelCollectorStatus: "disconnected",
        collectorLastSeenAt: SEEN_AT,
      },
      // The column's old default, and no agent ever.
      {
        name: "c-never-default",
        otelCollectorStatus: "disconnected",
        collectorLastSeenAt: null,
        labelled: true,
      },
      // No status at all: found from traces or containers.
      {
        name: "d-never-null",
        otelCollectorStatus: null,
        collectorLastSeenAt: null,
      },
      // A collector reported, its status never written: Disconnected.
      {
        name: "e-null-reported",
        otelCollectorStatus: null,
        collectorLastSeenAt: SEEN_AT,
        labelled: true,
      },
      // A status no collector writes, never seen: Not connected.
      {
        name: "f-error-never",
        otelCollectorStatus: "error",
        collectorLastSeenAt: null,
      },
    ];

    const ENVIRONMENTS: Array<{
      name: string;
      otelCollectorStatus: string | null;
      lastSeenAt: Date | null;
    }> = [
      {
        name: "env-a-connected",
        otelCollectorStatus: "connected",
        lastSeenAt: SEEN_AT,
      },
      {
        name: "env-b-quiet",
        otelCollectorStatus: "disconnected",
        lastSeenAt: SEEN_AT,
      },
      { name: "env-c-new", otelCollectorStatus: null, lastSeenAt: null },
      {
        name: "env-d-default-new",
        otelCollectorStatus: "disconnected",
        lastSeenAt: null,
      },
      {
        name: "env-e-null-seen",
        otelCollectorStatus: null,
        lastSeenAt: SEEN_AT,
      },
      // A status the collector path never writes: read as not connected.
      {
        name: "env-f-error-seen",
        otelCollectorStatus: "error",
        lastSeenAt: SEEN_AT,
      },
    ];

    const insertDatabase: (data: {
      name: string;
      otelCollectorStatus: string | null;
      collectorLastSeenAt: Date | null;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      otelCollectorStatus: string | null;
      collectorLastSeenAt: Date | null;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      labelId?: ObjectID | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();

      await harness.insert("DatabaseServer", {
        _id: id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `${data.name}-${id.toString()}`,
        databaseIdentifier: `postgresql://${data.name}`,
        dbSystem: "postgresql",
        otelCollectorStatus: data.otelCollectorStatus,
        collectorLastSeenAt: data.collectorLastSeenAt,
        isArchived: Boolean(data.isArchived),
      });

      if (data.labelId) {
        await harness.insert("DatabaseServerLabel", {
          databaseServerId: id,
          labelId: data.labelId,
        });
      }
    };

    const insertEnvironment: (data: {
      name: string;
      otelCollectorStatus: string | null;
      lastSeenAt: Date | null;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      kind?: CloudResourceKind | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      otelCollectorStatus: string | null;
      lastSeenAt: Date | null;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      kind?: CloudResourceKind | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();

      await harness.insert("CloudResource", {
        _id: id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `${data.name}-${id.toString()}`,
        resourceIdentifier: `env/${data.name}`,
        cloudResourceKind: data.kind || CloudResourceKind.Environment,
        otelCollectorStatus: data.otelCollectorStatus,
        lastSeenAt: data.lastSeenAt,
        isArchived: Boolean(data.isArchived),
      });
    };

    const insertTeam: (data: {
      name: string;
      memberIds: Array<ObjectID>;
      formerMemberIds?: Array<ObjectID> | undefined;
      inProject?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      memberIds: Array<ObjectID>;
      formerMemberIds?: Array<ObjectID> | undefined;
      inProject?: ObjectID | undefined;
    }): Promise<void> => {
      const id: ObjectID = ObjectID.generate();
      const inProject: ObjectID = data.inProject || projectId;

      await harness.insert("Team", {
        _id: id,
        version: 1,
        projectId: inProject,
        name: data.name,
        slug: `${data.name}-${id.toString()}`,
      });

      for (const userId of data.memberIds) {
        await harness.insert("TeamMember", {
          _id: ObjectID.generate(),
          version: 1,
          projectId: inProject,
          teamId: id,
          userId: userId,
          hasAcceptedInvitation: true,
        });
      }

      // Taken out of the team: the row is kept, marked deleted.
      for (const userId of data.formerMemberIds || []) {
        await harness.insert("TeamMember", {
          _id: ObjectID.generate(),
          version: 1,
          projectId: inProject,
          teamId: id,
          userId: userId,
          hasAcceptedInvitation: true,
          deletedAt: SEEN_AT,
        });
      }
    };

    // The chip's filter for these picks, as the facet bar merges it into the list's query.
    const chip: (
      facet: ResourceFacet,
      operator: FilterOperator,
      picks: Array<string>,
    ) => Dictionary<unknown> = (
      facet: ResourceFacet,
      operator: FilterOperator,
      picks: Array<string>,
    ): Dictionary<unknown> => {
      const columnQuery: FacetColumnQuery | null = buildFacetColumnQuery({
        facet: facet,
        operator: operator,
        values: picks,
        existingValue: undefined,
      });

      expect(columnQuery).not.toBeNull();

      return { [columnQuery!.field]: columnQuery!.value };
    };

    // The Databases list's Engine Metrics chip, as Databases.tsx declares it.
    const ENGINE_METRICS_FACET: ResourceFacet = {
      key: "otelCollectorStatus",
      label: "Engine Metrics",
      isMultiSelect: true,
      supportedOperators: ["is", "is_not"],
      toFilterGroups: buildDatabaseEngineMetricsStatusFilter,
    };

    // All Environments' Status chip, as AppPlatformsEnvironmentStatus declares it.
    const ENVIRONMENT_STATUS_FACET: ResourceFacet = {
      key: "environmentStatus",
      label: "Status",
      isMultiSelect: true,
      supportedOperators: ["is", "is_not"],
      toFilterGroups: buildCloudEnvironmentStatusFilter,
    };

    // The Teams list's Member chip, as Teams/Index.tsx declares it.
    const MEMBER_FACET: ResourceFacet = {
      key: "member",
      label: "Member",
      isMultiSelect: true,
      supportedOperators: ["is", "is_not"],
      toLinkedTo: buildTeamMemberFilter,
    };

    const listDatabases: (data: {
      chips: Dictionary<unknown>;
      inProject?: ObjectID | undefined;
      asUserId?: ObjectID | undefined;
      limit?: number | undefined;
      skip?: number | undefined;
    }) => Promise<ListedPage<DatabaseServer>> = async (data: {
      chips: Dictionary<unknown>;
      inProject?: ObjectID | undefined;
      asUserId?: ObjectID | undefined;
      limit?: number | undefined;
      skip?: number | undefined;
    }): Promise<ListedPage<DatabaseServer>> => {
      return await harness.list<DatabaseServer>({
        path: "/database-server",
        // The Databases list's own query, with the chip merged in.
        query: { isArchived: false, ...data.chips },
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: data.limit || 100,
        skip: data.skip || 0,
        userId: data.asUserId || memberId,
        projectId: data.inProject || projectId,
      });
    };

    const listEnvironments: (data: {
      chips: Dictionary<unknown>;
      inProject?: ObjectID | undefined;
      limit?: number | undefined;
      skip?: number | undefined;
    }) => Promise<ListedPage<CloudResource>> = async (data: {
      chips: Dictionary<unknown>;
      inProject?: ObjectID | undefined;
      limit?: number | undefined;
      skip?: number | undefined;
    }): Promise<ListedPage<CloudResource>> => {
      return await harness.list<CloudResource>({
        path: "/cloud-resource",
        // All Environments' own query, with the chip merged in.
        query: {
          isArchived: false,
          cloudResourceKind: CloudResourceKind.Environment,
          ...data.chips,
        },
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: data.limit || 100,
        skip: data.skip || 0,
        userId: memberId,
        projectId: data.inProject || projectId,
      });
    };

    const listTeams: (data: {
      chips: Dictionary<unknown>;
      inProject?: ObjectID | undefined;
      asUserId?: ObjectID | undefined;
      limit?: number | undefined;
      skip?: number | undefined;
    }) => Promise<ListedPage<Team>> = async (data: {
      chips: Dictionary<unknown>;
      inProject?: ObjectID | undefined;
      asUserId?: ObjectID | undefined;
      limit?: number | undefined;
      skip?: number | undefined;
    }): Promise<ListedPage<Team>> => {
      return await harness.list<Team>({
        path: "/team",
        query: { ...data.chips },
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: data.limit || 100,
        skip: data.skip || 0,
        userId: data.asUserId || memberId,
        projectId: data.inProject || projectId,
      });
    };

    const namesOf: (page: ListedPage<BaseModel>) => Array<string> = (
      page: ListedPage<BaseModel>,
    ): Array<string> => {
      return valuesOf(page, "name");
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Checkout");
      await harness.insertProject(bulkProjectId, "Busy");
      await harness.insertProject(otherProjectId, "Another project");

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: memberTeamId,
        permission: Permission.ProjectMember,
      });

      await harness.insertTeamPermission({
        userId: memberId,
        projectId: bulkProjectId,
        teamId: memberBulkTeamId,
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
        teamId: paymentsTeamId,
        permission: Permission.ReadDatabaseServer,
        labelIds: [paymentsLabelId],
      });

      await harness.insertMember({
        userId: incidentsMemberId,
        projectId: projectId,
        teamId: incidentsTeamId,
        permission: Permission.ReadProjectIncident,
      });

      // The small project: one database of every shape the two columns take.
      for (const database of DATABASES) {
        await insertDatabase({
          name: database.name,
          otelCollectorStatus: database.otelCollectorStatus,
          collectorLastSeenAt: database.collectorLastSeenAt,
          labelId: database.labelled ? paymentsLabelId : undefined,
        });
      }

      // Never listed: an archived one, and another project's.
      await insertDatabase({
        name: "z-archived",
        otelCollectorStatus: null,
        collectorLastSeenAt: null,
        isArchived: true,
      });
      await insertDatabase({
        name: "elsewhere",
        otelCollectorStatus: null,
        collectorLastSeenAt: null,
        inProject: otherProjectId,
      });

      for (const environment of ENVIRONMENTS) {
        await insertEnvironment(environment);
      }

      // Never listed: archived, a monitored resource, another project's.
      await insertEnvironment({
        name: "env-z-archived",
        otelCollectorStatus: null,
        lastSeenAt: null,
        isArchived: true,
      });
      await insertEnvironment({
        name: "env-z-resource",
        otelCollectorStatus: null,
        lastSeenAt: null,
        kind: CloudResourceKind.Resource,
      });
      await insertEnvironment({
        name: "env-elsewhere",
        otelCollectorStatus: null,
        lastSeenAt: null,
        inProject: otherProjectId,
      });

      /*
       * The small project's teams: Alice in T1 and T2, Bob in T2 and T3,
       * nobody in T4 but Carol, who was taken out of it.
       */
      await insertTeam({ name: "T1", memberIds: [aliceId] });
      await insertTeam({ name: "T2", memberIds: [aliceId, bobId] });
      await insertTeam({ name: "T3", memberIds: [bobId] });
      await insertTeam({
        name: "T4",
        memberIds: [],
        formerMemberIds: [carolId],
      });
      // Another project's team with Alice in it.
      await insertTeam({
        name: "T-elsewhere",
        memberIds: [aliceId],
        inProject: otherProjectId,
      });

      /*
       * The busy project: more databases that never reported, environments
       * waiting for their first data, and teams Alice is in, than the
       * chips read - and a few of each that are not.
       */
      await harness.query(
        `INSERT INTO "${harness.schema}"."DatabaseServer" ("_id", "version", "projectId", "name", "slug", "databaseIdentifier", "dbSystem", "isArchived")
         SELECT gen_random_uuid(), 1, $1, 'Never ' || lpad(n::text, 5, '0'), 'never-' || n, 'postgresql://never-' || n, 'postgresql', false
         FROM generate_series(1, $2::int) AS n`,
        [bulkProjectId.toString(), PAST_THE_CAP],
      );
      for (const name of ["Reporting 1", "Reporting 2"]) {
        await insertDatabase({
          name,
          otelCollectorStatus: "connected",
          collectorLastSeenAt: SEEN_AT,
          inProject: bulkProjectId,
        });
      }

      await harness.query(
        `INSERT INTO "${harness.schema}"."CloudResource" ("_id", "version", "projectId", "name", "slug", "resourceIdentifier", "cloudResourceKind", "isArchived")
         SELECT gen_random_uuid(), 1, $1, 'Waiting ' || lpad(n::text, 5, '0'), 'waiting-' || n, 'env/waiting-' || n, $2, false
         FROM generate_series(1, $3::int) AS n`,
        [bulkProjectId.toString(), CloudResourceKind.Environment, PAST_THE_CAP],
      );
      for (const name of ["Live 1", "Live 2", "Live 3"]) {
        await insertEnvironment({
          name,
          otelCollectorStatus: "connected",
          lastSeenAt: SEEN_AT,
          inProject: bulkProjectId,
        });
      }

      await harness.query(
        `INSERT INTO "${harness.schema}"."Team" ("_id", "version", "projectId", "name", "slug")
         SELECT gen_random_uuid(), 1, $1, 'Squad ' || lpad(n::text, 5, '0'), 'squad-' || n
         FROM generate_series(1, $2::int) AS n`,
        [bulkProjectId.toString(), PAST_THE_CAP],
      );
      await harness.query(
        `INSERT INTO "${harness.schema}"."TeamMember" ("_id", "version", "projectId", "teamId", "userId", "hasAcceptedInvitation")
         SELECT gen_random_uuid(), 1, $1, "_id", $2, true
         FROM "${harness.schema}"."Team" WHERE "projectId" = $1 AND "name" LIKE 'Squad %'`,
        [bulkProjectId.toString(), aliceId.toString()],
      );
      for (const name of ["Quiet 1", "Quiet 2", "Quiet 3"]) {
        await insertTeam({
          name,
          memberIds: [bobId],
          inProject: bulkProjectId,
        });
      }

      await harness.analyze("DatabaseServer");
      await harness.analyze("CloudResource");
      await harness.analyze("Team");
      await harness.analyze("TeamMember");
    }, 600_000);

    afterAll(async () => {
      await harness.tearDown();
    });

    describe("the Databases list's Engine Metrics chip", () => {
      const STATUSES: Array<DatabaseEngineMetricsStatus> = [
        DatabaseEngineMetricsStatus.Connected,
        DatabaseEngineMetricsStatus.Disconnected,
        DatabaseEngineMetricsStatus.NotConnected,
      ];

      test.each(subsetsOf(STATUSES))(
        "%s: 'is' lists exactly the databases the Status column draws so, 'is not' exactly the others",
        async (...picked: Array<DatabaseEngineMetricsStatus>) => {
          const shownAs: (wanted: boolean) => Array<string> = (
            wanted: boolean,
          ): Array<string> => {
            return DATABASES.filter((database: (typeof DATABASES)[number]) => {
              return (
                picked.includes(getDatabaseEngineMetricsStatus(database)) ===
                wanted
              );
            }).map((database: (typeof DATABASES)[number]): string => {
              return database.name;
            });
          };

          const is: ListedPage<DatabaseServer> = await listDatabases({
            chips: chip(ENGINE_METRICS_FACET, "is", picked),
          });
          const isNot: ListedPage<DatabaseServer> = await listDatabases({
            chips: chip(ENGINE_METRICS_FACET, "is_not", picked),
          });

          expect(namesOf(is)).toEqual(shownAs(true));
          expect(is.count).toBe(shownAs(true).length);
          expect(namesOf(isNot)).toEqual(shownAs(false));
          expect(isNot.count).toBe(shownAs(false).length);
        },
      );

      test("a database a collector reported from, whose status was never written, is Disconnected - which the old query left out", async () => {
        const page: ListedPage<DatabaseServer> = await listDatabases({
          chips: chip(ENGINE_METRICS_FACET, "is", ["disconnected"]),
        });

        expect(namesOf(page)).toEqual(["b-stopped", "e-null-reported"]);
      });

      test(`${PAST_THE_CAP} databases that never reported: listed, counted and paged past the old cap`, async () => {
        const filter: Dictionary<unknown> = chip(ENGINE_METRICS_FACET, "is", [
          "not-connected",
        ]);

        const firstPage: ListedPage<DatabaseServer> = await listDatabases({
          chips: filter,
          inProject: bulkProjectId,
          limit: 5,
        });

        expect(firstPage.count).toBe(PAST_THE_CAP);
        expect(namesOf(firstPage)).toEqual(
          [1, 2, 3, 4, 5].map((n: number): string => {
            return bulkName("Never", n);
          }),
        );

        const lastPage: ListedPage<DatabaseServer> = await listDatabases({
          chips: filter,
          inProject: bulkProjectId,
          limit: 10,
          skip: PAST_THE_CAP - 5,
        });

        expect(lastPage.count).toBe(PAST_THE_CAP);
        expect(namesOf(lastPage)).toEqual(
          [10_046, 10_047, 10_048, 10_049, 10_050].map((n: number): string => {
            return bulkName("Never", n);
          }),
        );
      });

      test("'is not' them keeps only the ones that report, and two statuses together count both", async () => {
        const isNot: ListedPage<DatabaseServer> = await listDatabases({
          chips: chip(ENGINE_METRICS_FACET, "is_not", ["not-connected"]),
          inProject: bulkProjectId,
        });

        expect(namesOf(isNot)).toEqual(["Reporting 1", "Reporting 2"]);

        const either: ListedPage<DatabaseServer> = await listDatabases({
          chips: chip(ENGINE_METRICS_FACET, "is", [
            "connected",
            "not-connected",
          ]),
          inProject: bulkProjectId,
          limit: 1,
        });

        expect(either.count).toBe(PAST_THE_CAP + 2);
      });

      test("the old read - each status's ids first - stopped at 10,000, and the list it narrowed with them", async () => {
        // What computeDatabaseServerIdsForEngineMetricsStatuses read.
        const ids: ListedPage<DatabaseServer> = await harness.list({
          path: "/database-server",
          query: {
            projectId: bulkProjectId,
            ...buildDatabaseEngineMetricsStatusQuery("never-reported"),
          } as Dictionary<unknown>,
          select: { _id: true },
          limit: LIMIT_PER_PROJECT,
          userId: memberId,
          projectId: bulkProjectId,
        });

        expect(ids.count).toBe(PAST_THE_CAP);
        expect(ids.rows).toHaveLength(LIMIT_PER_PROJECT);

        // The list the hook narrowed by those ids: 50 databases short.
        const narrowed: ListedPage<DatabaseServer> = await listDatabases({
          chips: {
            _id: new Includes(
              ids.rows.map((row: DatabaseServer): ObjectID => {
                return new ObjectID(row._id!.toString());
              }),
            ),
          },
          inProject: bulkProjectId,
          limit: 1,
        });

        expect(narrowed.count).toBe(LIMIT_PER_PROJECT);
        expect(PAST_THE_CAP - narrowed.count).toBe(50);
      });

      test("a reader of the Payments databases only is kept to them", async () => {
        const page: ListedPage<DatabaseServer> = await listDatabases({
          chips: chip(ENGINE_METRICS_FACET, "is", [
            "connected",
            "not-connected",
          ]),
          asUserId: paymentsMemberId,
        });

        // a-connected and c-never-default are Payments'; e is Disconnected.
        expect(namesOf(page)).toEqual(["a-connected", "c-never-default"]);

        const isNot: ListedPage<DatabaseServer> = await listDatabases({
          chips: chip(ENGINE_METRICS_FACET, "is_not", ["connected"]),
          asUserId: paymentsMemberId,
        });

        expect(namesOf(isNot)).toEqual(["c-never-default", "e-null-reported"]);
      });

      test("someone who may not read databases is refused the list, filter or not", async () => {
        await expect(
          listDatabases({
            chips: chip(ENGINE_METRICS_FACET, "is", ["connected"]),
            asUserId: incidentsMemberId,
          }),
        ).rejects.toThrow();
      });
    });

    describe("All Environments' Status chip", () => {
      test.each(subsetsOf(Object.values(CloudEnvironmentStatus)))(
        "%s: 'is' lists exactly the environments the Status column draws so, 'is not' exactly the others",
        async (...picked: Array<CloudEnvironmentStatus>) => {
          const shownAs: (wanted: boolean) => Array<string> = (
            wanted: boolean,
          ): Array<string> => {
            return ENVIRONMENTS.filter(
              (environment: (typeof ENVIRONMENTS)[number]) => {
                return (
                  picked.includes(getCloudEnvironmentStatus(environment)) ===
                  wanted
                );
              },
            ).map((environment: (typeof ENVIRONMENTS)[number]): string => {
              return environment.name;
            });
          };

          const is: ListedPage<CloudResource> = await listEnvironments({
            chips: chip(ENVIRONMENT_STATUS_FACET, "is", picked),
          });
          const isNot: ListedPage<CloudResource> = await listEnvironments({
            chips: chip(ENVIRONMENT_STATUS_FACET, "is_not", picked),
          });

          expect(namesOf(is)).toEqual(shownAs(true));
          expect(namesOf(isNot)).toEqual(shownAs(false));
        },
      );

      test("an environment reporting a status no collector writes is Disconnected once seen - which the old query left out", async () => {
        const page: ListedPage<CloudResource> = await listEnvironments({
          chips: chip(ENVIRONMENT_STATUS_FACET, "is", ["disconnected"]),
        });

        expect(namesOf(page)).toEqual([
          "env-b-quiet",
          "env-e-null-seen",
          "env-f-error-seen",
        ]);
      });

      test(`${PAST_THE_CAP} environments waiting for their first data: listed, counted and paged past the old cap`, async () => {
        const filter: Dictionary<unknown> = chip(
          ENVIRONMENT_STATUS_FACET,
          "is",
          [CloudEnvironmentStatus.Waiting],
        );

        const lastPage: ListedPage<CloudResource> = await listEnvironments({
          chips: filter,
          inProject: bulkProjectId,
          limit: 10,
          skip: PAST_THE_CAP - 3,
        });

        expect(lastPage.count).toBe(PAST_THE_CAP);
        expect(namesOf(lastPage)).toEqual(
          [10_048, 10_049, 10_050].map((n: number): string => {
            return bulkName("Waiting", n);
          }),
        );

        const isNot: ListedPage<CloudResource> = await listEnvironments({
          chips: chip(ENVIRONMENT_STATUS_FACET, "is_not", [
            CloudEnvironmentStatus.Waiting,
          ]),
          inProject: bulkProjectId,
        });

        expect(namesOf(isNot)).toEqual(["Live 1", "Live 2", "Live 3"]);
      });

      test("the old read stopped at 10,000 waiting environments", async () => {
        // What computeCloudEnvironmentIdsForStatuses read.
        const ids: ListedPage<CloudResource> = await harness.list({
          path: "/cloud-resource",
          query: {
            projectId: bulkProjectId,
            isArchived: false,
            cloudResourceKind: CloudResourceKind.Environment,
            ...buildCloudEnvironmentStatusQuery(CloudEnvironmentStatus.Waiting),
          } as Dictionary<unknown>,
          select: { _id: true },
          limit: LIMIT_PER_PROJECT,
          userId: memberId,
          projectId: bulkProjectId,
        });

        expect(ids.count).toBe(PAST_THE_CAP);
        expect(ids.rows).toHaveLength(LIMIT_PER_PROJECT);
      });
    });

    describe("the Teams list's Member chip", () => {
      test("'is': the teams one of the people picked is in, each once", async () => {
        expect(
          namesOf(
            await listTeams({
              chips: chip(MEMBER_FACET, "is", [aliceId.toString()]),
            }),
          ),
        ).toEqual(["T1", "T2"]);

        const either: ListedPage<Team> = await listTeams({
          chips: chip(MEMBER_FACET, "is", [
            aliceId.toString(),
            bobId.toString(),
          ]),
        });

        expect(namesOf(either)).toEqual(["T1", "T2", "T3"]);
        expect(either.count).toBe(3);
      });

      test("'is not': the teams none of them is in, a team with nobody in it among them", async () => {
        const page: ListedPage<Team> = await listTeams({
          chips: chip(MEMBER_FACET, "is_not", [aliceId.toString()]),
        });

        // Sorted here: the permission teams are named by their ids.
        expect(namesOf(page).sort()).toEqual(
          ["T3", "T4", ...PERMISSION_TEAMS].sort(),
        );
      });

      test("someone taken out of a team is no longer in it, for 'is' or 'is not'", async () => {
        expect(
          namesOf(
            await listTeams({
              chips: chip(MEMBER_FACET, "is", [carolId.toString()]),
            }),
          ),
        ).toEqual([]);

        expect(
          namesOf(
            await listTeams({
              chips: chip(MEMBER_FACET, "is_not", [carolId.toString()]),
            }),
          ).sort(),
        ).toEqual(["T1", "T2", "T3", "T4", ...PERMISSION_TEAMS].sort());
      });

      test(`a person in ${PAST_THE_CAP} teams: every one listed, counted and paged past the old cap`, async () => {
        const filter: Dictionary<unknown> = chip(MEMBER_FACET, "is", [
          aliceId.toString(),
        ]);

        const lastPage: ListedPage<Team> = await listTeams({
          chips: filter,
          inProject: bulkProjectId,
          limit: 10,
          skip: PAST_THE_CAP - 2,
        });

        expect(lastPage.count).toBe(PAST_THE_CAP);
        expect(namesOf(lastPage)).toEqual([
          bulkName("Squad", 10_049),
          bulkName("Squad", 10_050),
        ]);

        const isNot: ListedPage<Team> = await listTeams({
          chips: chip(MEMBER_FACET, "is_not", [aliceId.toString()]),
          inProject: bulkProjectId,
        });

        expect(namesOf(isNot)).toEqual([
          "Quiet 1",
          "Quiet 2",
          "Quiet 3",
          `Team ${memberBulkTeamId.toString()}`,
        ]);
      });

      test("the old read - the people's memberships first - stopped at 10,000 teams", async () => {
        // What computeTeamIdsForMembers read.
        const memberships: ListedPage = await harness.list({
          path: "/team-member",
          query: {
            projectId: bulkProjectId,
            userId: new Includes([aliceId]),
          },
          select: { _id: true, teamId: true },
          limit: LIMIT_PER_PROJECT,
          userId: memberId,
          projectId: bulkProjectId,
        });

        expect(memberships.count).toBe(PAST_THE_CAP);
        expect(memberships.rows).toHaveLength(LIMIT_PER_PROJECT);
      });

      test("another project's teams are never among them", async () => {
        const page: ListedPage<Team> = await listTeams({
          chips: chip(MEMBER_FACET, "is", [aliceId.toString()]),
        });

        expect(namesOf(page)).not.toContain("T-elsewhere");
      });

      test("anyone in the project reads its teams, and who is in them, as a project user - and filters them alike", async () => {
        /*
         * Their team holds Read Incidents only; every member of a project
         * is a Project User, which reads its teams and their TeamMember
         * rows (LinkedToLinkTables holds the filter to that read).
         */
        const page: ListedPage<Team> = await listTeams({
          chips: chip(MEMBER_FACET, "is", [aliceId.toString()]),
          asUserId: incidentsMemberId,
        });

        expect(namesOf(page)).toEqual(["T1", "T2"]);
      });
    });
  },
);
