import Entities from "../../../Models/DatabaseModels/Index";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorTemplateChange from "../../../Models/DatabaseModels/MonitorTemplateChange";
import NetworkAlertPolicy from "../../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import {
  CREATE_INSERT_TRIGGER,
  CREATE_MONITOR_NETWORK_DEVICE_IDS_FUNCTION,
  CREATE_SYNC_FUNCTION,
  CREATE_UPDATE_TRIGGER,
} from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809163000000-AddMonitorNetworkDevice";
import Queue from "../../../Server/Infrastructure/Queue";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import NetworkAlertPolicyEngineService from "../../../Server/Services/NetworkAlertPolicyEngineService";
import NetworkDeviceAutoImportRuleEngineService from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import logger from "../../../Server/Utils/Logger";
import MonitorTemplateChangeRunner from "../../../Server/Utils/Monitor/MonitorTemplateChangeRunner";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import {
  MonitorTemplateChangeKind,
  MonitorTemplateChangeLine,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeStatus,
  MonitorTemplateChangeView,
} from "../../../Types/Monitor/MonitorTemplateChange";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { AutoImportRuleRunResult } from "../../../Types/NetworkAutomation/RuleRunResult";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import MonitorCriteriaClear from "../../../Utils/Monitor/MonitorCriteriaClear";
import { getDeviceHasMonitorOfTemplateRefusal } from "../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import { dropSchemaOneTableAtATime } from "../../Helpers/DropSchemaOneTableAtATime";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * MOVING A FLEET AN AUTO IMPORT RULE MADE TO A BETTER TEMPLATE, OR OFF ITS
 * TEMPLATE, ON A MIGRATED POSTGRES (OneUptime issues #11260, #11266).
 *
 * "851 of 851 monitors could not be linked": every monitor an import made
 * was refused a move to another template, and deleting them lost their
 * history. Here thousands of them move as one change, through the worker,
 * as a person: each keeps its id, labels, owners, status history and
 * incident links, takes the better template's criteria on its own device,
 * and keeps the template it was created from - so the auto import rule and
 * the alert policy that made them make none of them again, and leave what
 * the person chose alone.
 *
 * Opt in with RUN_POSTGRES_MONITOR_TEMPLATE_CHANGE_TESTS=true against a
 * database the registered migrations have been applied to, e.g. from
 * packages/Common:
 *
 *   RUN_POSTGRES_MONITOR_TEMPLATE_CHANGE_TESTS=true \
 *   MONITOR_TEMPLATE_CHANGE_TEST_DATABASE_HOST=127.0.0.1 \
 *   MONITOR_TEMPLATE_CHANGE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/MonitorTemplateChangePostgres.test.ts --forceExit
 *
 * MONITOR_TEMPLATE_CHANGE_TEST_FLEET sets how many monitors the fleet has
 * (2,000 unless set; 10,000 is a change's ceiling). Every table is copied
 * from public into a schema of its own, dropped afterwards; every row is
 * synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITOR_TEMPLATE_CHANGE_TESTS"] === "true"
    ? describe
    : describe.skip;

const FLEET_SIZE: number = Math.max(
  10,
  Number(process.env["MONITOR_TEMPLATE_CHANGE_TEST_FLEET"] || "2000"),
);

// Rows per INSERT while a fleet is written.
const INSERT_BATCH: number = 500;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

describePostgres(
  "a fleet an auto import rule made moves to another template, or off it (#11260, #11266)",
  () => {
    const schema: string = `monitor_template_change_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;

    let database: DataSource;

    let projectId: ObjectID;
    let probeId: ObjectID;
    let userId: ObjectID;
    let operationalStatusId: ObjectID;
    let offlineStatusId: ObjectID;
    let incidentSeverityId: ObjectID;
    let alertSeverityId: ObjectID;
    let createdStateId: ObjectID;
    let resolvedStateId: ObjectID;
    let labelId: ObjectID;
    let personProps: DatabaseCommonInteractionProps;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MONITOR_TEMPLATE_CHANGE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["MONITOR_TEMPLATE_CHANGE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MONITOR_TEMPLATE_CHANGE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema},public`,
          max: 4,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      const tables: Array<string> = (
        await database.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migrations'`,
        )
      ).map((row: { table_name: string }): string => {
        return row.table_name;
      });

      for (const table of tables) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      /*
       * The triggers that keep MonitorNetworkDevice from every monitor's
       * steps: a copied table has no triggers, and the monitors watching a
       * device are read through this table (DeviceMonitorDuplicateCheck).
       */
      for (const statement of [
        CREATE_MONITOR_NETWORK_DEVICE_IDS_FUNCTION,
        CREATE_SYNC_FUNCTION,
        CREATE_INSERT_TRIGGER,
        CREATE_UPDATE_TRIGGER,
      ]) {
        await database.query(statement);
      }
    }, 600000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await dropSchemaOneTableAtATime(database, schema);
        await database.destroy();
      }
    }, 600000);

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);
      jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
        return {} as SemaphoreMutex;
      }) as never);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
      jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);
      jest.spyOn(Queue, "addJob").mockResolvedValue({} as never);

      projectId = ObjectID.generate();
      probeId = ObjectID.generate();
      userId = ObjectID.generate();
      operationalStatusId = ObjectID.generate();
      offlineStatusId = ObjectID.generate();
      incidentSeverityId = ObjectID.generate();
      alertSeverityId = ObjectID.generate();
      createdStateId = ObjectID.generate();
      resolvedStateId = ObjectID.generate();
      labelId = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug") VALUES ($1, 1, 'Warehouse fleet', $2)`,
        [projectId.toString(), `warehouse-fleet-${projectId.toString()}`],
      );
      await database.query(
        `INSERT INTO "${schema}"."User" ("_id", "version", "email", "slug", "name") VALUES ($1, 1, $2, $3, 'Kiru')`,
        [
          userId.toString(),
          `kiru-${userId.toString()}@example.com`,
          `kiru-${userId.toString()}`,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."MonitorStatus" ("_id", "version", "projectId", "name", "slug", "color", "isOperationalState", "isOfflineState", "priority") VALUES ($1, 1, $2, 'Operational', $3, '#22c55e', true, false, 0), ($4, 1, $2, 'Offline', $5, '#ef4444', false, true, 1)`,
        [
          operationalStatusId.toString(),
          projectId.toString(),
          `operational-${operationalStatusId.toString()}`,
          offlineStatusId.toString(),
          `offline-${offlineStatusId.toString()}`,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."IncidentSeverity" ("_id", "version", "projectId", "name", "slug", "color", "order") VALUES ($1, 1, $2, 'Critical', $3, '#ef4444', 1)`,
        [
          incidentSeverityId.toString(),
          projectId.toString(),
          `critical-${incidentSeverityId.toString()}`,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."AlertSeverity" ("_id", "version", "projectId", "name", "slug", "color", "order") VALUES ($1, 1, $2, 'High', $3, '#f97316', 1)`,
        [
          alertSeverityId.toString(),
          projectId.toString(),
          `high-${alertSeverityId.toString()}`,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."IncidentState" ("_id", "version", "projectId", "name", "slug", "color", "order", "isCreatedState", "isResolvedState") VALUES ($1, 1, $2, 'Identified', $3, '#ef4444', 1, true, false), ($4, 1, $2, 'Resolved', $5, '#22c55e', 2, false, true)`,
        [
          createdStateId.toString(),
          projectId.toString(),
          `identified-${createdStateId.toString()}`,
          resolvedStateId.toString(),
          `resolved-${resolvedStateId.toString()}`,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."Probe" ("_id", "version", "projectId", "key", "name", "slug", "probeVersion") VALUES ($1, 1, $2, $3, 'Warehouse probe', $4, '1.0.0')`,
        [
          probeId.toString(),
          projectId.toString(),
          ObjectID.generate().toString(),
          `warehouse-probe-${probeId.toString()}`,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."Label" ("_id", "version", "projectId", "name", "slug", "color") VALUES ($1, 1, $2, 'Warehouse', $3, '#6366f1')`,
        [
          labelId.toString(),
          projectId.toString(),
          `warehouse-${labelId.toString()}`,
        ],
      );

      const permissions: Array<UserPermission> = [
        Permission.ReadProjectMonitor,
        Permission.EditProjectMonitor,
        Permission.ReadMonitorTemplate,
        Permission.DeleteMonitorTemplate,
        Permission.ReadNetworkDevice,
      ].map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      });
      const tenant: UserTenantAccessPermission = {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: permissions,
      };
      personProps = {
        tenantId: projectId,
        userId: userId,
        userTenantAccessPermission: { [projectId.toString()]: tenant },
        ...ON_HIGHEST_PLAN,
      };

      // The worker reads the person's permissions again.
      jest
        .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
        .mockResolvedValue(personProps as never);
    }, 120000);

    afterEach(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 1500);
      });
      jest.restoreAllMocks();
    });

    // ---- What a template's monitor checks and raises.

    interface Criteria {
      offlineCriteriaId: string;
      offlineIncidentTemplateId: string;
      criteriaIds: Array<string>;
    }

    /*
     * A Network Device template's steps: the default criteria a new monitor
     * gets, its offline incident set to resolve on its own, every id named
     * after the template so a monitor's criteria say whose they are.
     */
    const templateSteps: (data: { prefix: string; deviceId: ObjectID }) => {
      steps: MonitorSteps;
      criteria: Criteria;
    } = (data: {
      prefix: string;
      deviceId: ObjectID;
    }): { steps: MonitorSteps; criteria: Criteria } => {
      const monitorCriteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType: MonitorType.NetworkDevice,
          monitorName: data.prefix,
          onlineMonitorStatusId: operationalStatusId,
          offlineMonitorStatusId: offlineStatusId,
          defaultIncidentSeverityId: incidentSeverityId,
          defaultAlertSeverityId: alertSeverityId,
        });

      const instances: Array<MonitorCriteriaInstance> =
        monitorCriteria.data!.monitorCriteriaInstanceArray;

      instances.forEach((instance: MonitorCriteriaInstance, index: number) => {
        instance.data!.id = `${data.prefix}-criteria-${index + 1}`;
        (instance.data!.incidents || []).forEach(
          (
            incident: { id: string; autoResolveIncident?: boolean },
            incidentIndex: number,
          ) => {
            incident.id = `${data.prefix}-incident-${index + 1}-${incidentIndex + 1}`;
            incident.autoResolveIncident = true;
          },
        );
      });

      const offline: MonitorCriteriaInstance = instances.find(
        (instance: MonitorCriteriaInstance): boolean => {
          return (instance.data!.incidents || []).length > 0;
        },
      )!;

      const step: MonitorStep = new MonitorStep();
      step.data!.id = `${data.prefix}-step`;
      step.data!.networkDeviceMonitor = {
        networkDeviceId: data.deviceId.toString(),
        monitorInterfaces: true,
        collectEndpoints: false,
        oids: [],
      };
      step.data!.monitorCriteria = monitorCriteria;

      const steps: MonitorSteps = new MonitorSteps();
      steps.data = {
        monitorStepsInstanceArray: [step],
        defaultMonitorStatusId: operationalStatusId,
      };

      return {
        steps: steps,
        criteria: {
          offlineCriteriaId: offline.data!.id!,
          offlineIncidentTemplateId: offline.data!.incidents![0]!.id,
          criteriaIds: instances.map(
            (instance: MonitorCriteriaInstance): string => {
              return instance.data!.id!;
            },
          ),
        },
      };
    };

    const saveTemplate: (data: {
      name: string;
      prefix: string;
      interval: string;
    }) => Promise<{
      template: MonitorTemplate;
      criteria: Criteria;
    }> = async (data: {
      name: string;
      prefix: string;
      interval: string;
    }): Promise<{ template: MonitorTemplate; criteria: Criteria }> => {
      const built: { steps: MonitorSteps; criteria: Criteria } = templateSteps({
        prefix: data.prefix,
        deviceId: ObjectID.generate(),
      });
      const template: MonitorTemplate = new MonitorTemplate();
      template.projectId = projectId;
      template.templateName = data.name;
      template.slug = `${data.prefix}-${ObjectID.generate().toString()}`;
      template.monitorName = data.name;
      template.monitorType = MonitorType.NetworkDevice;
      template.monitorSteps = built.steps;
      template.monitoringInterval = data.interval;
      template.minimumProbeAgreement = 1;

      return {
        template: await database.manager.save(template),
        criteria: built.criteria,
      };
    };

    interface FleetMonitor {
      monitorId: ObjectID;
      deviceId: ObjectID;
      address: string;
    }

    /*
     * `count` devices at the probe, each with the monitor an import made for
     * it from `template` - written as rows, as the migrations left a fleet
     * made before Created From was recorded: Monitor Template set, Created
     * From empty. Each monitor has a label, an owner and two status changes
     * of history; every tenth is linked to an incident.
     */
    const seedFleet: (data: {
      count: number;
      template: MonitorTemplate;
      prefix: string;
      networkAlertPolicyId?: ObjectID | undefined;
      subnet: number;
    }) => Promise<Array<FleetMonitor>> = async (data: {
      count: number;
      template: MonitorTemplate;
      prefix: string;
      networkAlertPolicyId?: ObjectID | undefined;
      subnet: number;
    }): Promise<Array<FleetMonitor>> => {
      const fleet: Array<FleetMonitor> = [];

      for (let index: number = 0; index < data.count; index++) {
        fleet.push({
          monitorId: ObjectID.generate(),
          deviceId: ObjectID.generate(),
          address: `10.${data.subnet}.${Math.floor(index / 250)}.${(index % 250) + 1}`,
        });
      }

      // The suite's ids, as the rows carry them: read once, not in the loop.
      const probe: string = probeId.toString();
      const project: string = projectId.toString();
      const operationalStatus: string = operationalStatusId.toString();

      for (
        let offset: number = 0;
        offset < fleet.length;
        offset += INSERT_BATCH
      ) {
        const batch: Array<FleetMonitor> = fleet.slice(
          offset,
          offset + INSERT_BATCH,
        );

        const deviceValues: Array<string> = [];
        const deviceParams: Array<unknown> = [];

        batch.forEach((member: FleetMonitor, index: number) => {
          const base: number = index * 5;
          deviceValues.push(
            `($${base + 1}, 1, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, '${probe}', 'Probe')`,
          );
          deviceParams.push(
            member.deviceId.toString(),
            project,
            `${data.prefix}SW${offset + index}`,
            `${data.prefix.toLowerCase()}sw${offset + index}-${member.deviceId.toString()}`,
            // The device's address is its hostname, as a scan found it.
            member.address,
          );
        });

        await database.query(
          `INSERT INTO "${schema}"."NetworkDevice" ("_id", "version", "projectId", "name", "slug", "hostname", "probeId", "monitoringMethod") VALUES ${deviceValues.join(", ")}`,
          deviceParams,
        );

        const monitorValues: Array<string> = [];
        const monitorParams: Array<unknown> = [];

        batch.forEach((member: FleetMonitor, index: number) => {
          const base: number = index * 5;
          const steps: MonitorSteps = MonitorSteps.clone(
            data.template.monitorSteps!,
          );
          steps.data!.monitorStepsInstanceArray[0]!.data!.networkDeviceMonitor!.networkDeviceId =
            member.deviceId.toString();

          monitorValues.push(
            `($${base + 1}, 1, '${project}', $${base + 2}, $${base + 3}, '${MonitorType.NetworkDevice}', '${operationalStatus}', $${base + 4}::jsonb, '${data.template.id!.toString()}', $${base + 5}, '${data.template.monitoringInterval}', ${
              data.networkAlertPolicyId
                ? `'${data.networkAlertPolicyId.toString()}'`
                : "NULL"
            })`,
          );
          monitorParams.push(
            member.monitorId.toString(),
            `${data.prefix}SW${offset + index} - ${data.template.templateName}`,
            `${data.prefix.toLowerCase()}sw${offset + index}-${member.monitorId.toString()}`,
            JSON.stringify(steps.toJSON()),
            member.deviceId.toString(),
          );
        });

        await database.query(
          `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "monitorSteps", "monitorTemplateId", "autoProvisionedNetworkDeviceId", "monitoringInterval", "networkAlertPolicyId") VALUES ${monitorValues.join(", ")}`,
          monitorParams,
        );

        const ids: Array<string> = batch.map((member: FleetMonitor): string => {
          return member.monitorId.toString();
        });

        await database.query(
          `INSERT INTO "${schema}"."MonitorLabel" ("monitorId", "labelId") SELECT unnest($1::uuid[]), $2`,
          [ids, labelId.toString()],
        );
        await database.query(
          `INSERT INTO "${schema}"."MonitorOwnerUser" ("_id", "version", "projectId", "monitorId", "userId") SELECT gen_random_uuid(), 1, $2, unnest($1::uuid[]), $3`,
          [ids, projectId.toString(), userId.toString()],
        );
        await database.query(
          `INSERT INTO "${schema}"."MonitorStatusTimeline" ("_id", "version", "projectId", "monitorId", "monitorStatusId", "startsAt") SELECT gen_random_uuid(), 1, $2, m, s, now() - interval '1 day' * k FROM unnest($1::uuid[]) AS m, (VALUES ($3::uuid, 2), ($4::uuid, 1)) AS v(s, k)`,
          [
            ids,
            projectId.toString(),
            operationalStatusId.toString(),
            offlineStatusId.toString(),
          ],
        );
      }

      // Every tenth monitor took part in an incident, resolved long ago.
      const withIncidents: Array<FleetMonitor> = fleet.filter(
        (_member: FleetMonitor, index: number): boolean => {
          return index % 10 === 0;
        },
      );

      for (const member of withIncidents) {
        const incidentId: ObjectID = ObjectID.generate();

        await database.query(
          `INSERT INTO "${schema}"."Incident" ("_id", "version", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId") VALUES ($1, 1, $2, 'Uplink down', $3, $4, $5)`,
          [
            incidentId.toString(),
            projectId.toString(),
            `uplink-down-${incidentId.toString()}`,
            resolvedStateId.toString(),
            incidentSeverityId.toString(),
          ],
        );
        await database.query(
          `INSERT INTO "${schema}"."IncidentMonitor" ("incidentId", "monitorId") VALUES ($1, $2)`,
          [incidentId.toString(), member.monitorId.toString()],
        );
      }

      return fleet;
    };

    // What a monitor keeps through any change: counted per table.
    const historyOf: (
      monitorIds: Array<ObjectID>,
    ) => Promise<Record<string, number>> = async (
      monitorIds: Array<ObjectID>,
    ): Promise<Record<string, number>> => {
      const ids: Array<string> = monitorIds.map((id: ObjectID): string => {
        return id.toString();
      });
      const counts: Record<string, number> = {};

      for (const [table, column] of [
        ["Monitor", "_id"],
        ["MonitorLabel", "monitorId"],
        ["MonitorOwnerUser", "monitorId"],
        ["MonitorStatusTimeline", "monitorId"],
        ["IncidentMonitor", "monitorId"],
      ] as const) {
        const rows: Array<{ count: string }> = await database.query(
          `SELECT count(*) AS count FROM "${schema}"."${table}" WHERE "${column}" = ANY($1::uuid[])${table === "Monitor" ? ` AND "deletedAt" IS NULL` : ""}`,
          [ids],
        );
        counts[table] = Number(rows[0]!.count);
      }

      return counts;
    };

    const monitorsById: (
      monitorIds: Array<ObjectID>,
    ) => Promise<Map<string, Monitor>> = async (
      monitorIds: Array<ObjectID>,
    ): Promise<Map<string, Monitor>> => {
      const rows: Array<Monitor> = await database.manager.find(Monitor, {
        where: {
          projectId: projectId,
        } as never,
        select: {
          _id: true,
          monitorTemplateId: true,
          createdFromMonitorTemplateId: true,
          networkAlertPolicyId: true,
          autoProvisionedNetworkDeviceId: true,
          monitorSteps: true,
          monitoringInterval: true,
        } as never,
      });
      const wanted: Set<string> = new Set<string>(
        monitorIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      );
      const byId: Map<string, Monitor> = new Map<string, Monitor>();

      for (const row of rows) {
        if (wanted.has(row.id!.toString())) {
          byId.set(row.id!.toString(), row);
        }
      }

      return byId;
    };

    const criteriaIdsOf: (monitor: Monitor) => Array<string> = (
      monitor: Monitor,
    ): Array<string> => {
      return (
        monitor.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data
          ?.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
      ).map((instance: MonitorCriteriaInstance): string => {
        return instance.data!.id!;
      });
    };

    const deviceOfSteps: (monitor: Monitor) => string | undefined = (
      monitor: Monitor,
    ): string | undefined => {
      return monitor.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data
        ?.networkDeviceMonitor?.networkDeviceId;
    };

    // Ask for a change, as the person, and let the worker run it to its end.
    const runChange: (data: {
      template: MonitorTemplate | null;
      kind: MonitorTemplateChangeKind;
      monitorIds?: Array<ObjectID> | undefined;
      applyTemplateSettings?: boolean | undefined;
      clearTemplateSettings?: boolean | undefined;
      deleteTemplateWhenDone?: boolean | undefined;
    }) => Promise<MonitorTemplateChangeView> = async (data: {
      template: MonitorTemplate | null;
      kind: MonitorTemplateChangeKind;
      monitorIds?: Array<ObjectID> | undefined;
      applyTemplateSettings?: boolean | undefined;
      clearTemplateSettings?: boolean | undefined;
      deleteTemplateWhenDone?: boolean | undefined;
    }): Promise<MonitorTemplateChangeView> => {
      const asked: MonitorTemplateChange =
        await MonitorTemplateChangeRunner.start({
          projectId: projectId,
          props: personProps,
          monitorTemplateId: data.template?.id?.toString(),
          settings: {
            kind: data.kind,
            applyTemplateSettings: data.applyTemplateSettings === true,
            clearTemplateSettings: data.clearTemplateSettings === true,
            deleteTemplateWhenDone: data.deleteTemplateWhenDone === true,
          },
          monitorIds: data.monitorIds?.map((id: ObjectID): string => {
            return id.toString();
          }),
          allLinkedToTemplate: data.deleteTemplateWhenDone === true,
        });

      await MonitorTemplateChangeRunner.runProjectChanges(projectId);

      return MonitorTemplateChangeRunner.toView({
        row: await MonitorTemplateChangeRunner.findChange({
          changeId: asked.id!,
          projectId: projectId,
        }),
        allLines: true,
      });
    };

    /*
     * An auto import rule on `template` over a scan that found `fleet`, run
     * now. Run Now applies the rule to every completed scan of the project,
     * so a second rule over the same devices reuses the scan
     * (`isScanThere`).
     */
    const runRule: (data: {
      template: MonitorTemplate;
      fleet: Array<FleetMonitor>;
      subnet: number;
      isScanThere?: boolean | undefined;
    }) => Promise<AutoImportRuleRunResult> = async (data: {
      template: MonitorTemplate;
      fleet: Array<FleetMonitor>;
      subnet: number;
      isScanThere?: boolean | undefined;
    }): Promise<AutoImportRuleRunResult> => {
      if (!data.isScanThere) {
        await saveScan(data);
      }

      return await runRuleOver(data.template, data.subnet);
    };

    const saveScan: (data: {
      fleet: Array<FleetMonitor>;
      subnet: number;
    }) => Promise<void> = async (data: {
      fleet: Array<FleetMonitor>;
      subnet: number;
    }): Promise<void> => {
      const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
      scan.projectId = projectId;
      scan.probeId = probeId;
      scan.name = "Warehouse discovery";
      scan.cidr = `10.${data.subnet}.0.0/16`;
      scan.status = "Completed" as never;
      scan.startedAt = OneUptimeDate.getSomeMinutesAgo(30);
      scan.completedAt = OneUptimeDate.getSomeMinutesAgo(20);
      scan.autoImportProcessedAt = OneUptimeDate.getSomeMinutesAgo(19);
      scan.discoveredDevices = data.fleet.map(
        (member: FleetMonitor, index: number): DiscoveredNetworkDevice => {
          return {
            ipAddress: member.address,
            sysName: `SW${index}`,
            sysDescr: "Cisco IOS XE Software",
            snmpReachable: true,
          } as DiscoveredNetworkDevice;
        },
      );
      scan.snmpVersion = "V2c" as never;
      scan.snmpCommunityString = "public";
      scan.snmpPort = 161;
      await database.manager.save(scan);
    };

    const runRuleOver: (
      template: MonitorTemplate,
      subnet: number,
    ) => Promise<AutoImportRuleRunResult> = async (
      template: MonitorTemplate,
      subnet: number,
    ): Promise<AutoImportRuleRunResult> => {
      const rule: NetworkDeviceAutoImportRule =
        new NetworkDeviceAutoImportRule();
      rule.projectId = projectId;
      rule.name = `Warehouse switches ${ObjectID.generate().toString()}`;
      rule.isEnabled = true;
      rule.isExclusion = false;
      rule.ipMatchTarget = `10.${subnet}.0.0/16`;
      rule.monitorTemplateId = template.id!;
      const savedRule: NetworkDeviceAutoImportRule =
        await database.manager.save(rule);

      return await NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans(
        {
          ruleId: savedRule.id!,
          projectId: projectId,
          isDryRun: false,
        },
      );
    };

    test(`${FLEET_SIZE} monitors an import made move to a better template with its settings, keep their history, and the rule makes none of them again`, async () => {
      const old: { template: MonitorTemplate; criteria: Criteria } =
        await saveTemplate({
          name: "WB Ping Monitor Template",
          prefix: "v1",
          interval: "*/5 * * * *",
        });
      const better: { template: MonitorTemplate; criteria: Criteria } =
        await saveTemplate({
          name: "WB Ping Monitor Template v2",
          prefix: "v2",
          interval: "*/2 * * * *",
        });

      const fleet: Array<FleetMonitor> = await seedFleet({
        count: FLEET_SIZE,
        template: old.template,
        prefix: "WB",
        subnet: 20,
      });
      const monitorIds: Array<ObjectID> = fleet.map(
        (member: FleetMonitor): ObjectID => {
          return member.monitorId;
        },
      );

      const before: Record<string, number> = await historyOf(monitorIds);

      expect(before).toEqual({
        Monitor: FLEET_SIZE,
        MonitorLabel: FLEET_SIZE,
        MonitorOwnerUser: FLEET_SIZE,
        MonitorStatusTimeline: FLEET_SIZE * 2,
        IncidentMonitor: Math.ceil(FLEET_SIZE / 10),
      });

      const startedAt: number = Date.now();

      const change: MonitorTemplateChangeView = await runChange({
        template: better.template,
        kind: MonitorTemplateChangeKind.Link,
        monitorIds: monitorIds,
        applyTemplateSettings: true,
      });

      const tookMs: number = Date.now() - startedAt;

      expect(change.status).toBe(MonitorTemplateChangeStatus.Completed);
      expect(change.progress).toMatchObject({
        total: FLEET_SIZE,
        processed: FLEET_SIZE,
        changed: FLEET_SIZE,
        skipped: 0,
        failed: 0,
        notReached: 0,
      });
      expect(change.lines).toEqual([]);

      // The same monitors, every one: nothing deleted, nothing made.
      expect(await historyOf(monitorIds)).toEqual(before);

      const moved: Map<string, Monitor> = await monitorsById(monitorIds);

      expect(moved.size).toBe(FLEET_SIZE);

      for (const member of fleet) {
        const monitor: Monitor = moved.get(member.monitorId.toString())!;

        expect({
          linkedTo: monitor.monitorTemplateId?.toString(),
          createdFrom: monitor.createdFromMonitorTemplateId?.toString(),
          criteria: criteriaIdsOf(monitor),
          device: deviceOfSteps(monitor),
          interval: monitor.monitoringInterval,
        }).toEqual({
          linkedTo: better.template.id!.toString(),
          createdFrom: old.template.id!.toString(),
          criteria: better.criteria.criteriaIds,
          device: member.deviceId.toString(),
          interval: "*/2 * * * *",
        });
      }

      // The rule that made them, still on the old template, makes none again.
      const sample: Array<FleetMonitor> = fleet.slice(0, 200);
      const ruleRun: AutoImportRuleRunResult = await runRule({
        template: old.template,
        fleet: sample,
        subnet: 20,
      });

      expect(ruleRun).toMatchObject({
        devicesCreated: 0,
        monitorsCreated: 0,
        monitorsSkippedAlreadyExisting: sample.length,
        monitorsFailed: 0,
      });

      // Nor does a rule on the better template: they are its monitors now.
      const betterRun: AutoImportRuleRunResult = await runRule({
        template: better.template,
        fleet: sample,
        subnet: 20,
        isScanThere: true,
      });

      expect(betterRun).toMatchObject({
        monitorsCreated: 0,
        monitorsSkippedAlreadyExisting: sample.length,
      });
      expect(await historyOf(monitorIds)).toEqual(before);

      // A change of a ceiling's worth of monitors stays well inside a worker's job.
      expect(tookMs).toBeLessThan(FLEET_SIZE * 250);
    }, 3600000);

    test("unlinking with the template's criteria cleared stops what they raise, resolves what they left open, and the rule never puts them back", async () => {
      const old: { template: MonitorTemplate; criteria: Criteria } =
        await saveTemplate({
          name: "WB Ping Monitor Template - No Alert",
          prefix: "na",
          interval: "*/5 * * * *",
        });

      const fleet: Array<FleetMonitor> = await seedFleet({
        count: 300,
        template: old.template,
        prefix: "NA",
        subnet: 21,
      });
      const monitorIds: Array<ObjectID> = fleet.map(
        (member: FleetMonitor): ObjectID => {
          return member.monitorId;
        },
      );

      // Three of them have an incident open that their criteria raised.
      const openIncidents: Array<ObjectID> = [];

      for (const member of fleet.slice(1, 4)) {
        const incidentId: ObjectID = ObjectID.generate();
        openIncidents.push(incidentId);

        await database.query(
          `INSERT INTO "${schema}"."Incident" ("_id", "version", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "createdCriteriaId", "createdIncidentTemplateId") VALUES ($1, 1, $2, 'Switch offline', $3, $4, $5, $6, $7)`,
          [
            incidentId.toString(),
            projectId.toString(),
            `switch-offline-${incidentId.toString()}`,
            createdStateId.toString(),
            incidentSeverityId.toString(),
            old.criteria.offlineCriteriaId,
            old.criteria.offlineIncidentTemplateId,
          ],
        );
        await database.query(
          `INSERT INTO "${schema}"."IncidentMonitor" ("incidentId", "monitorId") VALUES ($1, $2)`,
          [incidentId.toString(), member.monitorId.toString()],
        );
      }

      /*
       * The resolve as it is written: the open incidents found by the
       * monitor, their criteria and template matched for real; the timeline
       * row it writes is caught here, so the incident's own pipeline (its
       * notifications) is not this suite's to run.
       */
      const resolved: Array<{ incidentId: string; rootCause: string }> = [];
      jest
        .spyOn(IncidentStateTimelineService, "create")
        .mockImplementation((async (data: {
          data: IncidentStateTimeline;
        }): Promise<IncidentStateTimeline> => {
          expect(data.data.incidentStateId?.toString()).toBe(
            resolvedStateId.toString(),
          );
          resolved.push({
            incidentId: data.data.incidentId!.toString(),
            rootCause: data.data.rootCause || "",
          });
          return data.data;
        }) as never);

      const before: Record<string, number> = await historyOf(monitorIds);

      const change: MonitorTemplateChangeView = await runChange({
        template: old.template,
        kind: MonitorTemplateChangeKind.Unlink,
        monitorIds: monitorIds,
        clearTemplateSettings: true,
      });

      expect(change.status).toBe(MonitorTemplateChangeStatus.Completed);
      expect(change.progress).toMatchObject({
        changed: 300,
        resolvedIncidents: 3,
      });
      expect(
        resolved
          .map((entry: { incidentId: string }): string => {
            return entry.incidentId;
          })
          .sort(),
      ).toEqual(
        openIncidents
          .map((id: ObjectID): string => {
            return id.toString();
          })
          .sort(),
      );
      expect(resolved[0]!.rootCause).toContain(
        "**WB Ping Monitor Template - No Alert**",
      );

      expect(await historyOf(monitorIds)).toEqual(before);

      const cleared: Map<string, Monitor> = await monitorsById(monitorIds);

      for (const member of fleet) {
        const monitor: Monitor = cleared.get(member.monitorId.toString())!;

        expect({
          linkedTo: monitor.monitorTemplateId,
          createdFrom: monitor.createdFromMonitorTemplateId?.toString(),
          hasCriteria: MonitorCriteriaClear.hasCriteria(monitor.monitorSteps),
          device: deviceOfSteps(monitor),
        }).toEqual({
          linkedTo: null,
          createdFrom: old.template.id!.toString(),
          hasCriteria: false,
          device: member.deviceId.toString(),
        });
      }

      const ruleRun: AutoImportRuleRunResult = await runRule({
        template: old.template,
        fleet: fleet,
        subnet: 21,
      });

      expect(ruleRun).toMatchObject({
        monitorsCreated: 0,
        monitorsSkippedAlreadyExisting: 300,
      });
      expect(await historyOf(monitorIds)).toEqual(before);
    }, 1200000);

    test("an alert policy's monitors a person moved are theirs: the policy neither deletes them nor makes others beside them", async () => {
      const old: { template: MonitorTemplate; criteria: Criteria } =
        await saveTemplate({
          name: "Switch alert pack",
          prefix: "pk",
          interval: "*/5 * * * *",
        });
      const better: { template: MonitorTemplate; criteria: Criteria } =
        await saveTemplate({
          name: "Switch alert pack v2",
          prefix: "pk2",
          interval: "*/5 * * * *",
        });

      const policy: NetworkAlertPolicy = new NetworkAlertPolicy();
      policy.projectId = projectId;
      policy.name = "Every switch";
      policy.isEnabled = true;
      policy.monitorTemplateId = old.template.id!;
      policy.scope = {};
      const savedPolicy: NetworkAlertPolicy =
        await database.manager.save(policy);

      const fleet: Array<FleetMonitor> = await seedFleet({
        count: 150,
        template: old.template,
        prefix: "PK",
        subnet: 22,
        networkAlertPolicyId: savedPolicy.id!,
      });
      const monitorIds: Array<ObjectID> = fleet.map(
        (member: FleetMonitor): ObjectID => {
          return member.monitorId;
        },
      );

      // The policy's fleet as the engine sees it: complete, nothing to do.
      const settled: Awaited<
        ReturnType<typeof NetworkAlertPolicyEngineService.syncPolicy>
      > = await NetworkAlertPolicyEngineService.syncPolicy({
        policyId: savedPolicy.id!,
      });

      expect(settled).toMatchObject({
        monitorsCreated: 0,
        monitorsDeleted: 0,
        monitorsAdopted: 0,
      });

      const change: MonitorTemplateChangeView = await runChange({
        template: better.template,
        kind: MonitorTemplateChangeKind.Link,
        monitorIds: monitorIds,
        applyTemplateSettings: true,
      });

      expect(change.progress.changed).toBe(150);

      const released: Map<string, Monitor> = await monitorsById(monitorIds);

      for (const monitor of released.values()) {
        expect({
          policy: monitor.networkAlertPolicyId,
          createdFrom: monitor.createdFromMonitorTemplateId?.toString(),
        }).toEqual({
          policy: null,
          createdFrom: old.template.id!.toString(),
        });
      }

      const after: Awaited<
        ReturnType<typeof NetworkAlertPolicyEngineService.syncPolicy>
      > = await NetworkAlertPolicyEngineService.syncPolicy({
        policyId: savedPolicy.id!,
      });

      expect(after).toMatchObject({
        monitorsCreated: 0,
        monitorsDeleted: 0,
        monitorsAdopted: 0,
      });
      expect((await monitorsById(monitorIds)).size).toBe(150);

      const total: Array<{ count: string }> = await database.query(
        `SELECT count(*) AS count FROM "${schema}"."Monitor" WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
        [projectId.toString()],
      );

      expect(Number(total[0]!.count)).toBe(150);
    }, 1200000);

    test("a device that has the better template's monitor already keeps both, and the change names the one in the way", async () => {
      const old: { template: MonitorTemplate; criteria: Criteria } =
        await saveTemplate({
          name: "Core switches",
          prefix: "cs",
          interval: "*/5 * * * *",
        });
      const better: { template: MonitorTemplate; criteria: Criteria } =
        await saveTemplate({
          name: "Core switches v2",
          prefix: "cs2",
          interval: "*/5 * * * *",
        });

      const fleet: Array<FleetMonitor> = await seedFleet({
        count: 3,
        template: old.template,
        prefix: "CS",
        subnet: 23,
      });

      // The rule moved to v2 first, and gave the second device v2's monitor.
      const inTheWay: ObjectID = ObjectID.generate();
      const steps: MonitorSteps = MonitorSteps.clone(
        better.template.monitorSteps!,
      );
      steps.data!.monitorStepsInstanceArray[0]!.data!.networkDeviceMonitor!.networkDeviceId =
        fleet[1]!.deviceId.toString();
      await database.query(
        `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "monitorSteps", "monitorTemplateId", "createdFromMonitorTemplateId", "autoProvisionedNetworkDeviceId") VALUES ($1, 1, $2, 'CSSW1 - Core switches v2', $3, $4, $5, $6::jsonb, $7, $7, $8)`,
        [
          inTheWay.toString(),
          projectId.toString(),
          `cssw1-v2-${inTheWay.toString()}`,
          MonitorType.NetworkDevice,
          operationalStatusId.toString(),
          JSON.stringify(steps.toJSON()),
          better.template.id!.toString(),
          fleet[1]!.deviceId.toString(),
        ],
      );

      const change: MonitorTemplateChangeView = await runChange({
        template: better.template,
        kind: MonitorTemplateChangeKind.Link,
        monitorIds: fleet.map((member: FleetMonitor): ObjectID => {
          return member.monitorId;
        }),
        applyTemplateSettings: true,
      });

      expect(change.progress).toMatchObject({ changed: 2, skipped: 1 });
      expect(change.lines).toEqual([
        {
          monitorId: fleet[1]!.monitorId.toString(),
          monitorName: `CSSW1 - Core switches`,
          outcome: MonitorTemplateChangeOutcome.Skipped,
          reason: getDeviceHasMonitorOfTemplateRefusal(
            "CSSW1 - Core switches v2",
          ),
        },
      ] as Array<MonitorTemplateChangeLine>);

      // Both monitors of the second device are as they were.
      const second: Map<string, Monitor> = await monitorsById([
        fleet[1]!.monitorId,
        inTheWay,
      ]);

      expect(
        second
          .get(fleet[1]!.monitorId.toString())!
          .monitorTemplateId?.toString(),
      ).toBe(old.template.id!.toString());
      expect(
        second.get(inTheWay.toString())!.monitorTemplateId?.toString(),
      ).toBe(better.template.id!.toString());
    }, 600000);

    test("a template's delete clears its criteria from every monitor linked to it first, then deletes it", async () => {
      const doomed: { template: MonitorTemplate; criteria: Criteria } =
        await saveTemplate({
          name: "WB Ping Monitor Template - Retired",
          prefix: "rt",
          interval: "*/5 * * * *",
        });

      const fleet: Array<FleetMonitor> = await seedFleet({
        count: 120,
        template: doomed.template,
        prefix: "RT",
        subnet: 24,
      });

      const change: MonitorTemplateChangeView = await runChange({
        template: doomed.template,
        kind: MonitorTemplateChangeKind.Unlink,
        clearTemplateSettings: true,
        deleteTemplateWhenDone: true,
      });

      expect(change.status).toBe(MonitorTemplateChangeStatus.Completed);
      expect(change.progress).toMatchObject({ total: 120, changed: 120 });
      expect(change.isTemplateDeleted).toBe(true);

      expect(
        await MonitorTemplateService.findOneById({
          id: doomed.template.id!,
          select: { _id: true },
          props: { isRoot: true },
        }),
      ).toBeNull();

      const cleared: Map<string, Monitor> = await monitorsById(
        fleet.map((member: FleetMonitor): ObjectID => {
          return member.monitorId;
        }),
      );

      expect(cleared.size).toBe(120);

      for (const monitor of cleared.values()) {
        expect({
          linkedTo: monitor.monitorTemplateId,
          hasCriteria: MonitorCriteriaClear.hasCriteria(monitor.monitorSteps),
        }).toEqual({ linkedTo: null, hasCriteria: false });
      }
    }, 600000);
  },
);
