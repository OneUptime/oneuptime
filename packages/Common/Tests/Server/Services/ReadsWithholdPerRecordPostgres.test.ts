import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceTemplateService from "../../../Server/Services/ScheduledMaintenanceTemplateService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import MultiTenantQuery from "../../../Server/Utils/MultiTenantQuery";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import express from "express";
import { DataSource } from "typeorm";

/*
 * READS ACROSS PROJECTS, AND THROUGH RELATIONS, WITHHOLD A COLUMN READ ON
 * SOME LABELS ONLY PER RECORD (#11438), ON A MIGRATED POSTGRES.
 *
 * #11259 stopped one project's reads from narrowing a record by a column
 * its reader reads on some labels only: the column is left out of the
 * records its grant does not reach. Two read paths kept the old rule:
 *
 *   - a read across projects (the "is-multi-tenant-query" header): each
 *     project's query was narrowed to the labels the column is read on, so
 *     a Viewer over each project who is a Project Member on one label lost
 *     every other record of every project from the list - a permission
 *     taking away what they read without it. Now every record each
 *     project's grants reach is read, and the column left out of the rows
 *     of each project its grant there does not reach;
 *   - a select through a relation of a column held to its own read there
 *     (a probe's SNMP trap report, through the network device that names
 *     the probe): weighed by whether the column's read is held at all, it
 *     was read on every related record - those outside the grant's labels
 *     too. Now it is left out of the related records the grant does not
 *     reach.
 *
 * No model read across projects has such a column yet (a guard lists them:
 * ColumnsNarrowerThanTheirTableGuard), so the read across projects is shown
 * on maintenance templates with their description made one only Project
 * Members read - by the model's own column rules, as such a column would
 * be declared. The rows are read by the services themselves, with the
 * props the real user middleware builds from the tables below.
 *
 * Opt in with RUN_POSTGRES_READS_WITHHOLD_PER_RECORD_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_READS_WITHHOLD_PER_RECORD_TESTS=true \
 *   READS_WITHHOLD_PER_RECORD_TEST_DATABASE_HOST=127.0.0.1 \
 *   READS_WITHHOLD_PER_RECORD_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/ReadsWithholdPerRecordPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is
 * dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_READS_WITHHOLD_PER_RECORD_TESTS"] === "true"
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

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

jest.mock("isolated-vm", () => {
  return {};
});

jest.setTimeout(10 * 60 * 1000);

const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "ScheduledMaintenanceTemplate",
  "ScheduledMaintenanceTemplateLabel",
  "ScheduledMaintenanceTemplateOwnerUser",
  "ScheduledMaintenanceTemplateOwnerTeam",
  "Probe",
  "ProbeLabel",
  "ProbeOwnerUser",
  "ProbeOwnerTeam",
  "NetworkDevice",
  "NetworkDeviceLabel",
  "NetworkDeviceOwnerUser",
  "NetworkDeviceOwnerTeam",
];

interface PermissionRow {
  permission: Permission;
  scope: PermissionScope;
  labelIds?: Array<ObjectID>;
}

// Who reads a template's description: those who may change templates, not Viewers.
const DESCRIPTION_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.ScheduledMaintenanceAdmin,
  Permission.ScheduledMaintenanceMember,
];

describePostgres(
  "reads across projects and through relations, on Postgres",
  () => {
    const schema: string = `withhold_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;
    let server: DashboardRequestsOverHttp;
    let capturedProps: DatabaseCommonInteractionProps | null = null;

    const readerId: ObjectID = ObjectID.generate();

    const firstProjectId: ObjectID = ObjectID.generate();
    const secondProjectId: ObjectID = ObjectID.generate();
    const firstTeamId: ObjectID = ObjectID.generate();
    const secondTeamId: ObjectID = ObjectID.generate();
    const firstLabelId: ObjectID = ObjectID.generate();
    const secondLabelId: ObjectID = ObjectID.generate();

    // In each project, a template carrying its label and one carrying none.
    const templates: Array<{
      id: ObjectID;
      projectId: ObjectID;
      name: string;
      labelId: ObjectID | null;
      description: string;
    }> = [
      {
        id: ObjectID.generate(),
        projectId: firstProjectId,
        name: "Database upgrade",
        labelId: firstLabelId,
        description: "first-labelled-description",
      },
      {
        id: ObjectID.generate(),
        projectId: firstProjectId,
        name: "Office move",
        labelId: null,
        description: "first-unlabelled-description",
      },
      {
        id: ObjectID.generate(),
        projectId: secondProjectId,
        name: "Kernel patch",
        labelId: secondLabelId,
        description: "second-labelled-description",
      },
      {
        id: ObjectID.generate(),
        projectId: secondProjectId,
        name: "Fibre swap",
        labelId: null,
        description: "second-unlabelled-description",
      },
    ];

    // The first project's probes: one carrying its label, one carrying none; a device on each.
    const plainProbeId: ObjectID = ObjectID.generate();
    const labelledProbeId: ObjectID = ObjectID.generate();
    const plainDeviceId: ObjectID = ObjectID.generate();
    const labelledDeviceId: ObjectID = ObjectID.generate();

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

    const setTeamPermissions: (
      teamId: ObjectID,
      projectId: ObjectID,
      rows: Array<PermissionRow>,
    ) => Promise<void> = async (
      teamId: ObjectID,
      projectId: ObjectID,
      rows: Array<PermissionRow>,
    ): Promise<void> => {
      await database.query(
        `DELETE FROM "${schema}"."TeamPermissionLabel" WHERE "teamPermissionId" IN (SELECT "_id" FROM "${schema}"."TeamPermission" WHERE "teamId" = $1)`,
        [teamId.toString()],
      );
      await database.query(
        `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
        [teamId.toString()],
      );

      for (const row of rows) {
        const id: ObjectID = ObjectID.generate();

        await insert("TeamPermission", {
          _id: id,
          projectId: projectId,
          teamId: teamId,
          permission: row.permission,
          isBlockPermission: false,
          scope: row.scope,
          version: 1,
        });

        for (const labelId of row.labelIds || []) {
          await insert("TeamPermissionLabel", {
            teamPermissionId: id,
            labelId: labelId,
          });
        }
      }
    };

    // The props the real user middleware builds: in one project, or across them.
    const propsOf: (data: {
      projectId?: ObjectID | undefined;
    }) => Promise<DatabaseCommonInteractionProps> = async (data: {
      projectId?: ObjectID | undefined;
    }): Promise<DatabaseCommonInteractionProps> => {
      capturedProps = null;

      const answer: SentRequest = await server.request(
        "GET",
        data.projectId
          ? `/api/test/reader-props?project=${data.projectId.toString()}`
          : "/api/test/reader-props",
      );

      expect(answer.status).toBe(200);
      expect(capturedProps).not.toBeNull();

      return capturedProps!;
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["READS_WITHHOLD_PER_RECORD_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["READS_WITHHOLD_PER_RECORD_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["READS_WITHHOLD_PER_RECORD_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
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

      getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
        database,
      );

      getJestSpyOn(JSONWebToken, "decode").mockImplementation(((
        token: string,
      ): JSONWebTokenData => {
        return {
          userId: new ObjectID(token),
          isMasterAdmin: false,
          isGlobalLogin: true,
        } as JSONWebTokenData;
      }) as never);

      getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(
        null as never,
      );
      // Across projects, each project's permissions are read from the tables too.
      getJestSpyOn(GlobalCache, "getJSONObjects").mockImplementation((async (
        _namespace: string,
        keys: Array<string>,
      ): Promise<Array<null>> => {
        return keys.map((): null => {
          return null;
        });
      }) as never);
      getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
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
      getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(
        GlobalConfigService,
        "getRequireSsoForLogin",
      ).mockResolvedValue(false as never);

      for (const service of [
        ScheduledMaintenanceTemplateService,
        NetworkDeviceService,
      ] as Array<DatabaseService<BaseModel>>) {
        getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
          undefined as never,
        );
        getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
          undefined as never,
        );
      }

      /*
       * A template's description, read only by those who may change
       * templates - as a column narrower than its table is declared
       * (@ColumnAccessControl) - wherever the rule reads who may read it.
       */
      const columnsOf: () => Dictionary<ColumnAccessControl> =
        ScheduledMaintenanceTemplate.prototype.getColumnAccessControlForAllColumns;

      getJestSpyOn(
        ScheduledMaintenanceTemplate.prototype,
        "getColumnAccessControlForAllColumns",
      ).mockImplementation(function (
        this: ScheduledMaintenanceTemplate,
      ): Dictionary<ColumnAccessControl> {
        const columns: Dictionary<ColumnAccessControl> = columnsOf.call(this);

        return {
          ...columns,
          description: {
            ...(columns["description"] as ColumnAccessControl),
            read: DESCRIPTION_READERS,
          },
        };
      } as never);

      for (const [id, name] of [
        [firstProjectId, "Acme Europe"],
        [secondProjectId, "Acme Asia"],
      ] as Array<[ObjectID, string]>) {
        await insert("Project", {
          _id: id,
          name: name,
          slug: id.toString(),
          version: 1,
        });
      }

      await insert("User", {
        _id: readerId,
        name: "Ana Lima",
        email: `${readerId.toString()}@example.com`,
        slug: readerId.toString(),
        version: 1,
      });

      for (const [teamId, projectId] of [
        [firstTeamId, firstProjectId],
        [secondTeamId, secondProjectId],
      ] as Array<[ObjectID, ObjectID]>) {
        await insert("Team", {
          _id: teamId,
          projectId: projectId,
          name: "Operations",
          slug: teamId.toString(),
          version: 1,
        });
        await insert("TeamMember", {
          _id: ObjectID.generate(),
          projectId: projectId,
          teamId: teamId,
          userId: readerId,
          hasAcceptedInvitation: true,
          version: 1,
        });
      }

      for (const [labelId, projectId] of [
        [firstLabelId, firstProjectId],
        [secondLabelId, secondProjectId],
      ] as Array<[ObjectID, ObjectID]>) {
        await insert("Label", {
          _id: labelId,
          projectId: projectId,
          name: "Production",
          slug: labelId.toString(),
          color: "#000000",
          version: 1,
        });
      }

      for (const template of templates) {
        await insert("ScheduledMaintenanceTemplate", {
          _id: template.id,
          projectId: template.projectId,
          templateName: template.name,
          templateDescription: "A maintenance template.",
          title: template.name,
          description: template.description,
          slug: template.id.toString(),
          version: 1,
        });

        if (template.labelId) {
          await insert("ScheduledMaintenanceTemplateLabel", {
            scheduledMaintenanceTemplateId: template.id,
            labelId: template.labelId,
          });
        }
      }

      for (const [id, name, isLabelled] of [
        [plainProbeId, "Frankfurt", false],
        [labelledProbeId, "Production probe", true],
      ] as Array<[ObjectID, string, boolean]>) {
        await insert("Probe", {
          _id: id,
          projectId: firstProjectId,
          name: name,
          slug: id.toString(),
          key: ObjectID.generate().toString(),
          probeVersion: "1.0.0",
          snmpTrapReceiver: JSON.stringify({
            isEnabled: true,
            port: 162,
            refusedTraps: [{ sourceAddress: `${name}-source` }],
          }),
          version: 1,
        });

        if (isLabelled) {
          await insert("ProbeLabel", {
            probeId: id,
            labelId: firstLabelId,
          });
        }
      }

      for (const [id, name, probeId] of [
        [plainDeviceId, "core-sw-1", plainProbeId],
        [labelledDeviceId, "core-sw-2", labelledProbeId],
      ] as Array<[ObjectID, string, ObjectID]>) {
        await insert("NetworkDevice", {
          _id: id,
          projectId: firstProjectId,
          name: name,
          hostname: `${name}.example.com`,
          slug: id.toString(),
          probeId: probeId,
          version: 1,
        });
      }

      // The reader's session; across projects unless a project is asked for.
      const session: ExpressRouter =
        express.Router() as unknown as ExpressRouter;

      session.use(
        (req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
          req.headers["authorization"] = `Bearer ${readerId.toString()}`;

          const project: unknown = req.query?.["project"];

          if (typeof project === "string" && project) {
            req.headers["tenantid"] = project;
          } else {
            req.headers[MultiTenantQuery.HEADER] = "true";
          }

          next();
        },
      );

      const props: ExpressRouter = express.Router() as unknown as ExpressRouter;

      props.get(
        "/test/reader-props",
        UserMiddleware.getUserMiddleware,
        async (req: ExpressRequest, res: ExpressResponse) => {
          capturedProps = await CommonAPI.getDatabaseCommonInteractionProps(
            req,
          );
          res.status(200).json({});
        },
      );

      server = new DashboardRequestsOverHttp();
      await server.start([session, props]);
    });

    afterAll(async () => {
      await server?.stop();
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    // A Viewer over each project who is a Project Member on its label.
    const viewerAndLabelMember: () => Promise<void> =
      async (): Promise<void> => {
        await setTeamPermissions(firstTeamId, firstProjectId, [
          { permission: Permission.Viewer, scope: PermissionScope.All },
          {
            permission: Permission.ProjectMember,
            scope: PermissionScope.Labels,
            labelIds: [firstLabelId],
          },
        ]);
        await setTeamPermissions(secondTeamId, secondProjectId, [
          { permission: Permission.Viewer, scope: PermissionScope.All },
          {
            permission: Permission.ProjectMember,
            scope: PermissionScope.Labels,
            labelIds: [secondLabelId],
          },
        ]);
      };

    const readTemplates: (data: {
      props: DatabaseCommonInteractionProps;
      query?: Dictionary<unknown>;
      sort?: Dictionary<SortOrder>;
    }) => Promise<Array<ScheduledMaintenanceTemplate>> = async (data: {
      props: DatabaseCommonInteractionProps;
      query?: Dictionary<unknown>;
      sort?: Dictionary<SortOrder>;
    }): Promise<Array<ScheduledMaintenanceTemplate>> => {
      return await ScheduledMaintenanceTemplateService.findBy({
        query: (data.query || {}) as never,
        select: { templateName: true, description: true },
        ...(data.sort ? { sort: data.sort as never } : {}),
        skip: 0,
        limit: 50,
        props: data.props,
      });
    };

    // Each template read, by name, with the description it was read with.
    const descriptionsOf: (
      rows: Array<ScheduledMaintenanceTemplate>,
    ) => Dictionary<string | null> = (
      rows: Array<ScheduledMaintenanceTemplate>,
    ): Dictionary<string | null> => {
      const read: Dictionary<string | null> = {};

      for (const row of rows) {
        read[row.templateName || ""] = row.description || null;
      }

      return read;
    };

    describe("a read across projects", () => {
      test("holds every template of both projects, the description on the labelled ones alone", async () => {
        await viewerAndLabelMember();

        const rows: Array<ScheduledMaintenanceTemplate> = await readTemplates({
          props: await propsOf({}),
        });

        expect(descriptionsOf(rows)).toEqual({
          "Database upgrade": "first-labelled-description",
          "Office move": null,
          "Kernel patch": "second-labelled-description",
          "Fibre swap": null,
        });
      });

      test("each row is weighed by its own project's grants", async () => {
        // In the first project the reader reads every description; in the second, the label's.
        await setTeamPermissions(firstTeamId, firstProjectId, [
          { permission: Permission.ProjectMember, scope: PermissionScope.All },
        ]);
        await setTeamPermissions(secondTeamId, secondProjectId, [
          { permission: Permission.Viewer, scope: PermissionScope.All },
          {
            permission: Permission.ProjectMember,
            scope: PermissionScope.Labels,
            labelIds: [secondLabelId],
          },
        ]);

        const rows: Array<ScheduledMaintenanceTemplate> = await readTemplates({
          props: await propsOf({}),
        });

        expect(descriptionsOf(rows)).toEqual({
          "Database upgrade": "first-labelled-description",
          "Office move": "first-unlabelled-description",
          "Kernel patch": "second-labelled-description",
          "Fibre swap": null,
        });
      });

      test("the project each row was weighed by is not handed back unless asked for", async () => {
        await viewerAndLabelMember();

        const rows: Array<ScheduledMaintenanceTemplate> = await readTemplates({
          props: await propsOf({}),
        });

        expect(rows.length).toBe(4);

        for (const row of rows) {
          expect(
            (row as unknown as Dictionary<unknown>)["projectId"],
          ).toBeUndefined();
        }
      });

      test("a filter on the description finds only what its grant reaches", async () => {
        await viewerAndLabelMember();

        const props: DatabaseCommonInteractionProps = await propsOf({});

        expect(
          await readTemplates({
            props: props,
            query: { description: "first-unlabelled-description" },
          }),
        ).toEqual([]);

        expect(
          descriptionsOf(
            await readTemplates({
              props: props,
              query: { description: "first-labelled-description" },
            }),
          ),
        ).toEqual({ "Database upgrade": "first-labelled-description" });
      });

      test("an order by the description is refused, saying why", async () => {
        await viewerAndLabelMember();

        await expect(
          readTemplates({
            props: await propsOf({}),
            sort: { description: SortOrder.Ascending },
          }),
        ).rejects.toThrow(
          "Your access lets you read the Description only of the Scheduled Maintenance Templates carrying some labels, so you cannot sort Scheduled Maintenance Templates by it.",
        );
      });

      test("a read of one project is as it was: every template, the description on the labelled one", async () => {
        await viewerAndLabelMember();

        const rows: Array<ScheduledMaintenanceTemplate> = await readTemplates({
          props: await propsOf({ projectId: firstProjectId }),
        });

        expect(descriptionsOf(rows)).toEqual({
          "Database upgrade": "first-labelled-description",
          "Office move": null,
        });
      });
    });

    describe("a select through a relation of a column held to its own read", () => {
      const readDevices: (
        props: DatabaseCommonInteractionProps,
      ) => Promise<Dictionary<unknown>> = async (
        props: DatabaseCommonInteractionProps,
      ): Promise<Dictionary<unknown>> => {
        const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy(
          {
            query: {},
            select: {
              name: true,
              probe: { _id: true, name: true, snmpTrapReceiver: true },
            },
            skip: 0,
            limit: 50,
            props: props,
          },
        );

        const read: Dictionary<unknown> = {};

        for (const device of devices) {
          read[device.name || ""] = {
            probe: device.probe?.name,
            report: device.probe?.snmpTrapReceiver
              ? JSON.parse(JSON.stringify(device.probe.snmpTrapReceiver))
              : null,
          };
        }

        return read;
      };

      test("a probe's trap report reaches the reader only through a device whose probe their grant reaches", async () => {
        await setTeamPermissions(firstTeamId, firstProjectId, [
          { permission: Permission.ReadNetworkDevice, scope: PermissionScope.All },
          {
            permission: Permission.ReadProjectProbe,
            scope: PermissionScope.Labels,
            labelIds: [firstLabelId],
          },
        ]);

        const read: Dictionary<unknown> = await readDevices(
          await propsOf({ projectId: firstProjectId }),
        );

        expect(read["core-sw-2"]).toEqual({
          probe: "Production probe",
          report: {
            isEnabled: true,
            port: 162,
            refusedTraps: [{ sourceAddress: "Production probe-source" }],
          },
        });
        // The probe's name is the relation's: every reader of the device reads it.
        expect(read["core-sw-1"]).toEqual({ probe: "Frankfurt", report: null });
      });

      test("a reader who reads probes over the whole project reads both reports, as before", async () => {
        await setTeamPermissions(firstTeamId, firstProjectId, [
          { permission: Permission.ReadNetworkDevice, scope: PermissionScope.All },
          {
            permission: Permission.ReadProjectProbe,
            scope: PermissionScope.All,
          },
        ]);

        const read: Dictionary<unknown> = await readDevices(
          await propsOf({ projectId: firstProjectId }),
        );

        expect(Object.keys(read).sort()).toEqual(["core-sw-1", "core-sw-2"]);
        expect((read["core-sw-1"] as { report: unknown }).report).toEqual({
          isEnabled: true,
          port: 162,
          refusedTraps: [{ sourceAddress: "Frankfurt-source" }],
        });
      });
    });
  },
);
