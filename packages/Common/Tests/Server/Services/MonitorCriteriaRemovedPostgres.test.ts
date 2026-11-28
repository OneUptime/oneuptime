import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Entities from "../../../Models/DatabaseModels/Index";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
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
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService, {
  SyncLinkedMonitorsResult,
  SyncToMonitorResult,
} from "../../../Server/Services/MonitorTemplateService";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import { MonitorTemplateLinkResult } from "../../../Types/Monitor/MonitorTemplateChange";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { readStatusChangeNote } from "../../../Utils/Monitor/StatusChangeNotes";
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
 * A WRITE THAT TAKES CRITERIA OFF A MONITOR RESOLVES WHAT THEY LEFT OPEN, ON
 * EVERY PATH THAT TAKES THEM OFF, ON A MIGRATED POSTGRES (issue #11453).
 *
 * An incident or alert a criteria opened, set to resolve on its own once the
 * monitor recovers, is resolved by a check that no longer meets that
 * criteria - matched by its id. A write that takes the criteria off the
 * monitor left it open for good, with nothing that could ever resolve it:
 * Sync Criteria to Linked Monitors when the template no longer has it, Sync
 * from Template, a person's edit of the monitor, an API key's, Terraform
 * resending the steps without the criteria. Every one of them now resolves
 * what it strands, in one place - MonitorService's own update hooks - with a
 * root cause that says why, and the sync's summary counts them.
 *
 * What is never resolved: an incident a person declared, one whose criteria
 * has auto-resolve off (a person resolves it by hand), and anything a
 * criteria the write keeps - by its id - goes on resolving itself.
 *
 * Every write runs through the real services, as the person, on a copy of
 * every table of the migrated schema. The resolve's timeline rows are
 * caught as they are written, so each incident's own pipeline (its
 * notifications) is not this suite's to run: what is asserted is which open
 * records the real queries matched, and what their timelines say.
 *
 * Opt in with RUN_POSTGRES_MONITOR_CRITERIA_REMOVED_TESTS=true against a
 * database the registered migrations have been applied to, e.g. from
 * packages/Common:
 *
 *   RUN_POSTGRES_MONITOR_CRITERIA_REMOVED_TESTS=true \
 *   MONITOR_CRITERIA_REMOVED_TEST_DATABASE_HOST=127.0.0.1 \
 *   MONITOR_CRITERIA_REMOVED_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/MonitorCriteriaRemovedPostgres.test.ts --forceExit
 *
 * Every table is copied from public into a schema of its own, dropped
 * afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITOR_CRITERIA_REMOVED_TESTS"] === "true"
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

// The criteria a Website template's monitors carry, by what each opens.
type CriteriaKind =
  // Opens an incident, set to resolve on its own.
  | "offline"
  // Opens an alert, set to resolve on its own.
  | "degraded"
  // Opens an incident a person resolves by hand: auto-resolve off.
  | "paged"
  // Sets the monitor online; opens nothing.
  | "online";

const ALL_CRITERIA: Array<CriteriaKind> = [
  "offline",
  "degraded",
  "paged",
  "online",
];

describePostgres(
  "a write that takes criteria off a monitor resolves what they left open (#11453)",
  () => {
    const schema: string = `monitor_criteria_removed_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;

    let database: DataSource;

    let projectId: ObjectID;
    let userId: ObjectID;
    let operationalStatusId: ObjectID;
    let offlineStatusId: ObjectID;
    let incidentSeverityId: ObjectID;
    let alertSeverityId: ObjectID;
    let incidentCreatedStateId: ObjectID;
    let incidentResolvedStateId: ObjectID;
    let alertCreatedStateId: ObjectID;
    let alertResolvedStateId: ObjectID;
    let labelId: ObjectID;
    let personProps: DatabaseCommonInteractionProps;
    let apiKeyProps: DatabaseCommonInteractionProps;

    // The resolves, as each timeline row is written.
    let resolvedIncidents: Array<{ incidentId: string; rootCause: string }>;
    let resolvedAlerts: Array<{ alertId: string; rootCause: string }>;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MONITOR_CRITERIA_REMOVED_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["MONITOR_CRITERIA_REMOVED_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MONITOR_CRITERIA_REMOVED_TEST_DATABASE_NAME"] ||
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
      userId = ObjectID.generate();
      operationalStatusId = ObjectID.generate();
      offlineStatusId = ObjectID.generate();
      incidentSeverityId = ObjectID.generate();
      alertSeverityId = ObjectID.generate();
      incidentCreatedStateId = ObjectID.generate();
      incidentResolvedStateId = ObjectID.generate();
      alertCreatedStateId = ObjectID.generate();
      alertResolvedStateId = ObjectID.generate();
      labelId = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug") VALUES ($1, 1, 'Checkout', $2)`,
        [projectId.toString(), `checkout-${projectId.toString()}`],
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
          incidentCreatedStateId.toString(),
          projectId.toString(),
          `identified-${incidentCreatedStateId.toString()}`,
          incidentResolvedStateId.toString(),
          `resolved-${incidentResolvedStateId.toString()}`,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."AlertState" ("_id", "version", "projectId", "name", "color", "order", "isCreatedState", "isResolvedState") VALUES ($1, 1, $2, 'Created', '#ef4444', 1, true, false), ($3, 1, $2, 'Resolved', '#22c55e', 2, false, true)`,
        [
          alertCreatedStateId.toString(),
          projectId.toString(),
          alertResolvedStateId.toString(),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."Label" ("_id", "version", "projectId", "name", "slug", "color") VALUES ($1, 1, $2, 'Production', $3, '#6366f1')`,
        [
          labelId.toString(),
          projectId.toString(),
          `production-${labelId.toString()}`,
        ],
      );

      const permissions: Array<UserPermission> = [
        Permission.ReadProjectMonitor,
        Permission.EditProjectMonitor,
        Permission.ReadMonitorTemplate,
        Permission.EditMonitorTemplate,
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
      // A project API key's: the project's permissions, and no person.
      apiKeyProps = {
        tenantId: projectId,
        userType: UserType.API,
        userTenantAccessPermission: { [projectId.toString()]: tenant },
        apiKeyId: ObjectID.generate(),
        apiKeyName: "Terraform",
        ...ON_HIGHEST_PLAN,
      };

      resolvedIncidents = [];
      resolvedAlerts = [];

      jest
        .spyOn(IncidentStateTimelineService, "create")
        .mockImplementation((async (data: {
          data: IncidentStateTimeline;
        }): Promise<IncidentStateTimeline> => {
          expect(data.data.incidentStateId?.toString()).toBe(
            incidentResolvedStateId.toString(),
          );
          resolvedIncidents.push({
            incidentId: data.data.incidentId!.toString(),
            rootCause: data.data.rootCause || "",
          });
          return data.data;
        }) as never);
      jest
        .spyOn(AlertStateTimelineService, "create")
        .mockImplementation((async (data: {
          data: AlertStateTimeline;
        }): Promise<AlertStateTimeline> => {
          expect(data.data.alertStateId?.toString()).toBe(
            alertResolvedStateId.toString(),
          );
          resolvedAlerts.push({
            alertId: data.data.alertId!.toString(),
            rootCause: data.data.rootCause || "",
          });
          return data.data;
        }) as never);
    }, 120000);

    afterEach(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 1000);
      });
      jest.restoreAllMocks();
    });

    // ---- What a Website template's monitors check and raise.

    const criteriaOf: (data: {
      prefix: string;
      kind: CriteriaKind;
    }) => MonitorCriteriaInstance = (data: {
      prefix: string;
      kind: CriteriaKind;
    }): MonitorCriteriaInstance => {
      const defaults: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType: MonitorType.Website,
          monitorName: "Checkout",
          onlineMonitorStatusId: operationalStatusId,
          offlineMonitorStatusId: offlineStatusId,
          defaultIncidentSeverityId: incidentSeverityId,
          defaultAlertSeverityId: alertSeverityId,
        });

      const offline: MonitorCriteriaInstance =
        defaults.data!.monitorCriteriaInstanceArray.find(
          (instance: MonitorCriteriaInstance): boolean => {
            return (instance.data!.incidents || []).length > 0;
          },
        )!;
      const online: MonitorCriteriaInstance =
        defaults.data!.monitorCriteriaInstanceArray.find(
          (instance: MonitorCriteriaInstance): boolean => {
            return (instance.data!.incidents || []).length === 0;
          },
        )!;

      const instance: MonitorCriteriaInstance = MonitorCriteriaInstance.clone(
        data.kind === "online" ? online : offline,
      );
      const id: string = `${data.prefix}-${data.kind}`;
      instance.data!.id = id;
      instance.data!.name = `${data.prefix} ${data.kind}`;

      if (data.kind === "offline" || data.kind === "paged") {
        instance.data!.incidents = [
          {
            ...instance.data!.incidents![0]!,
            id: `${id}-incident`,
            title: `Checkout is ${data.kind}`,
            autoResolveIncident: data.kind === "offline",
          },
        ];
        instance.data!.alerts = [];
      }

      if (data.kind === "degraded") {
        instance.data!.createIncidents = false;
        instance.data!.incidents = [];
        instance.data!.changeMonitorStatus = false;
        instance.data!.createAlerts = true;
        instance.data!.alerts = [
          {
            id: `${id}-alert`,
            title: "Checkout is degraded",
            description: "Slow answers",
            alertSeverityId: alertSeverityId,
            autoResolveAlert: true,
          },
        ];
      }

      return instance;
    };

    const websiteSteps: (data: {
      prefix: string;
      url: string;
      criteria: Array<CriteriaKind>;
      doNotSyncDestination?: boolean | undefined;
    }) => MonitorSteps = (data: {
      prefix: string;
      url: string;
      criteria: Array<CriteriaKind>;
      doNotSyncDestination?: boolean | undefined;
    }): MonitorSteps => {
      const step: MonitorStep = new MonitorStep();
      step.data!.id = `${data.prefix}-step`;
      step.data!.monitorDestination = URL.fromString(data.url);

      if (data.doNotSyncDestination) {
        step.data!.doNotSyncFields = ["monitorDestination"];
      }

      step.data!.monitorCriteria = new MonitorCriteria();
      step.data!.monitorCriteria.data = {
        monitorCriteriaInstanceArray: data.criteria.map(
          (kind: CriteriaKind): MonitorCriteriaInstance => {
            return criteriaOf({ prefix: data.prefix, kind: kind });
          },
        ),
      };

      const steps: MonitorSteps = new MonitorSteps();
      steps.data = {
        monitorStepsInstanceArray: [step],
        defaultMonitorStatusId: operationalStatusId,
      };

      return steps;
    };

    const saveTemplate: (data: {
      name: string;
      prefix: string;
      criteria: Array<CriteriaKind>;
      doNotSyncDestination?: boolean | undefined;
    }) => Promise<MonitorTemplate> = async (data: {
      name: string;
      prefix: string;
      criteria: Array<CriteriaKind>;
      doNotSyncDestination?: boolean | undefined;
    }): Promise<MonitorTemplate> => {
      const template: MonitorTemplate = new MonitorTemplate();
      template.projectId = projectId;
      template.templateName = data.name;
      template.slug = `${data.prefix}-${ObjectID.generate().toString()}`;
      template.monitorName = data.name;
      template.monitorType = MonitorType.Website;
      template.monitorSteps = websiteSteps({
        prefix: data.prefix,
        url: "https://template.example.com",
        criteria: data.criteria,
        doNotSyncDestination: data.doNotSyncDestination,
      });
      template.monitoringInterval = "*/5 * * * *";
      template.minimumProbeAgreement = 1;

      return await database.manager.save(template);
    };

    // The template's criteria edited: what it keeps of them.
    const editTemplateCriteria: (data: {
      template: MonitorTemplate;
      prefix: string;
      keep: Array<CriteriaKind>;
      doNotSyncDestination?: boolean | undefined;
    }) => Promise<void> = async (data: {
      template: MonitorTemplate;
      prefix: string;
      keep: Array<CriteriaKind>;
      doNotSyncDestination?: boolean | undefined;
    }): Promise<void> => {
      await MonitorTemplateService.updateOneById({
        id: data.template.id!,
        // Cast: the template's partial type is too deep for tsc to infer here.
        data: {
          monitorSteps: websiteSteps({
            prefix: data.prefix,
            url: "https://template.example.com",
            criteria: data.keep,
            doNotSyncDestination: data.doNotSyncDestination,
          }),
        } as never,
        props: personProps,
      });
    };

    interface SeededMonitor {
      monitorId: ObjectID;
      name: string;
      url: string;
    }

    /*
     * `count` Website monitors linked to the template, created from it, each
     * checking its own URL with the template's criteria - written as rows,
     * as the template's Create Monitor left them. Each has a label, an owner
     * and two status changes of history.
     */
    const seedMonitors: (data: {
      count: number;
      template: MonitorTemplate;
      prefix: string;
      criteria?: Array<CriteriaKind> | undefined;
    }) => Promise<Array<SeededMonitor>> = async (data: {
      count: number;
      template: MonitorTemplate;
      prefix: string;
      criteria?: Array<CriteriaKind> | undefined;
    }): Promise<Array<SeededMonitor>> => {
      const monitors: Array<SeededMonitor> = [];

      for (let index: number = 0; index < data.count; index++) {
        const monitorId: ObjectID = ObjectID.generate();
        const name: string = `${data.prefix} checkout ${index + 1}`;
        const url: string = `https://checkout-${index + 1}.${data.prefix.toLowerCase()}.example.com`;
        const steps: MonitorSteps = websiteSteps({
          prefix: data.prefix,
          url: url,
          criteria: data.criteria || ALL_CRITERIA,
        });

        await database.query(
          `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "monitorSteps", "monitorTemplateId", "createdFromMonitorTemplateId", "monitoringInterval") VALUES ($1, 1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8, '*/5 * * * *')`,
          [
            monitorId.toString(),
            projectId.toString(),
            name,
            `${name.split(" ").join("-")}-${monitorId.toString()}`,
            MonitorType.Website,
            operationalStatusId.toString(),
            JSON.stringify(steps.toJSON()),
            data.template.id!.toString(),
          ],
        );

        monitors.push({ monitorId: monitorId, name: name, url: url });
      }

      const ids: Array<string> = monitors.map(
        (monitor: SeededMonitor): string => {
          return monitor.monitorId.toString();
        },
      );

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

      return monitors;
    };

    // What a monitor has open: one of each kind the suite tells apart.
    interface OpenRecords {
      // Opened by "offline", set to resolve on its own.
      offlineIncidentId: string;
      // Opened by "paged", resolved by hand.
      pagedIncidentId: string;
      // Declared by a person: no criteria opened it.
      declaredIncidentId: string;
      // Opened by "degraded", set to resolve on its own.
      degradedAlertId: string;
    }

    const openRecords: (data: {
      monitor: SeededMonitor;
      prefix: string;
    }) => Promise<OpenRecords> = async (data: {
      monitor: SeededMonitor;
      prefix: string;
    }): Promise<OpenRecords> => {
      const incident: (data: {
        title: string;
        kind?: CriteriaKind | undefined;
      }) => Promise<string> = async (incidentData: {
        title: string;
        kind?: CriteriaKind | undefined;
      }): Promise<string> => {
        const incidentId: ObjectID = ObjectID.generate();
        const criteriaId: string | null = incidentData.kind
          ? `${data.prefix}-${incidentData.kind}`
          : null;

        await database.query(
          `INSERT INTO "${schema}"."Incident" ("_id", "version", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "createdCriteriaId", "createdIncidentTemplateId") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            incidentId.toString(),
            projectId.toString(),
            incidentData.title,
            `incident-${incidentId.toString()}`,
            incidentCreatedStateId.toString(),
            incidentSeverityId.toString(),
            criteriaId,
            criteriaId ? `${criteriaId}-incident` : null,
          ],
        );
        await database.query(
          `INSERT INTO "${schema}"."IncidentMonitor" ("incidentId", "monitorId") VALUES ($1, $2)`,
          [incidentId.toString(), data.monitor.monitorId.toString()],
        );

        return incidentId.toString();
      };

      const alertId: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."Alert" ("_id", "version", "projectId", "title", "currentAlertStateId", "alertSeverityId", "monitorId", "createdCriteriaId") VALUES ($1, 1, $2, 'Checkout is degraded', $3, $4, $5, $6)`,
        [
          alertId.toString(),
          projectId.toString(),
          alertCreatedStateId.toString(),
          alertSeverityId.toString(),
          data.monitor.monitorId.toString(),
          `${data.prefix}-degraded`,
        ],
      );

      return {
        offlineIncidentId: await incident({
          title: "Checkout is offline",
          kind: "offline",
        }),
        pagedIncidentId: await incident({
          title: "Checkout is paged",
          kind: "paged",
        }),
        declaredIncidentId: await incident({
          title: "Payments look wrong",
        }),
        degradedAlertId: alertId.toString(),
      };
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
        ["Alert", "monitorId"],
      ] as const) {
        const rows: Array<{ count: string }> = await database.query(
          `SELECT count(*) AS count FROM "${schema}"."${table}" WHERE "${column}" = ANY($1::uuid[])${table === "Monitor" ? ` AND "deletedAt" IS NULL` : ""}`,
          [ids],
        );
        counts[table] = Number(rows[0]!.count);
      }

      return counts;
    };

    const stepsOf: (monitorId: ObjectID) => Promise<MonitorSteps> = async (
      monitorId: ObjectID,
    ): Promise<MonitorSteps> => {
      const monitor: Monitor | null = await database.manager.findOne(Monitor, {
        where: { _id: monitorId.toString() } as never,
        select: { _id: true, monitorSteps: true } as never,
      });

      return monitor!.monitorSteps!;
    };

    const criteriaIdsOf: (steps: MonitorSteps) => Array<string> = (
      steps: MonitorSteps,
    ): Array<string> => {
      return (
        steps.data?.monitorStepsInstanceArray[0]?.data?.monitorCriteria?.data
          ?.monitorCriteriaInstanceArray || []
      ).map((instance: MonitorCriteriaInstance): string => {
        return instance.data!.id!;
      });
    };

    const ids: (
      entries: Array<{ incidentId?: string; alertId?: string }>,
    ) => Array<string> = (
      entries: Array<{ incidentId?: string; alertId?: string }>,
    ): Array<string> => {
      return entries
        .map((entry: { incidentId?: string; alertId?: string }): string => {
          return entry.incidentId || entry.alertId || "";
        })
        .sort();
    };

    // The note a root cause is, read back as the timeline reads it.
    const noteOf: (rootCause: string) => string = (
      rootCause: string,
    ): string => {
      const read: ReturnType<typeof readStatusChangeNote> =
        readStatusChangeNote(rootCause);

      expect({ rootCause, isNote: Boolean(read) }).toEqual({
        rootCause,
        isNote: true,
      });

      return read!.note.written;
    };

    // ---- The paths.

    test("Sync Criteria to Linked Monitors, on the bulk path: what the criteria the template dropped opened is resolved and counted, and nothing else", async () => {
      const template: MonitorTemplate = await saveTemplate({
        name: "Checkout health v1",
        prefix: "bulk",
        criteria: ALL_CRITERIA,
      });
      const monitors: Array<SeededMonitor> = await seedMonitors({
        count: 40,
        template: template,
        prefix: "bulk",
      });
      const open: Array<OpenRecords> = [];

      for (const monitor of monitors) {
        open.push(await openRecords({ monitor: monitor, prefix: "bulk" }));
      }

      const monitorIds: Array<ObjectID> = monitors.map(
        (monitor: SeededMonitor): ObjectID => {
          return monitor.monitorId;
        },
      );
      const before: Record<string, number> = await historyOf(monitorIds);

      // The template no longer checks for offline, degraded or paged.
      await editTemplateCriteria({
        template: template,
        prefix: "bulk",
        keep: ["online"],
      });

      const result: SyncLinkedMonitorsResult =
        await MonitorTemplateService.syncLinkedMonitors({
          monitorTemplateId: template.id!,
          props: personProps,
          fields: ["monitorSteps"],
        });

      expect(result).toEqual({
        totalLinkedMonitors: 40,
        syncedMonitors: 40,
        resolvedIncidentCount: 40,
        resolvedAlertCount: 40,
      });

      expect(ids(resolvedIncidents)).toEqual(
        open
          .map((records: OpenRecords): string => {
            return records.offlineIncidentId;
          })
          .sort(),
      );
      expect(ids(resolvedAlerts)).toEqual(
        open
          .map((records: OpenRecords): string => {
            return records.degradedAlertId;
          })
          .sort(),
      );

      // By hand, and declared: a person's to close.
      const resolvedIds: Set<string> = new Set<string>(ids(resolvedIncidents));

      for (const records of open) {
        expect(resolvedIds.has(records.pagedIncidentId)).toBe(false);
        expect(resolvedIds.has(records.declaredIncidentId)).toBe(false);
      }

      expect(noteOf(resolvedIncidents[0]!.rootCause)).toMatch(
        /^The criteria of the template \*\*\{\{template\}\}\*\* were synced to the monitor/,
      );
      expect(resolvedIncidents[0]!.rootCause).toContain(
        "**Checkout health v1**",
      );
      expect(noteOf(resolvedAlerts[0]!.rootCause)).toContain("this alert");

      expect(criteriaIdsOf(await stepsOf(monitors[0]!.monitorId))).toEqual([
        "bulk-online",
      ]);
      expect(await historyOf(monitorIds)).toEqual(before);
    }, 600000);

    test("Sync Criteria to Linked Monitors, one monitor at a time: each keeps its own destination and resolves what it stranded", async () => {
      const template: MonitorTemplate = await saveTemplate({
        name: "Checkout health, own URLs",
        prefix: "each",
        criteria: ALL_CRITERIA,
        doNotSyncDestination: true,
      });
      const monitors: Array<SeededMonitor> = await seedMonitors({
        count: 25,
        template: template,
        prefix: "each",
      });
      const open: Array<OpenRecords> = [];

      for (const monitor of monitors) {
        open.push(await openRecords({ monitor: monitor, prefix: "each" }));
      }

      // The template stops alerting on degraded answers.
      await editTemplateCriteria({
        template: template,
        prefix: "each",
        keep: ["offline", "paged", "online"],
        doNotSyncDestination: true,
      });

      const result: SyncLinkedMonitorsResult =
        await MonitorTemplateService.syncLinkedMonitors({
          monitorTemplateId: template.id!,
          props: personProps,
          fields: ["monitorSteps"],
        });

      expect(result).toEqual({
        totalLinkedMonitors: 25,
        syncedMonitors: 25,
        resolvedAlertCount: 25,
      });
      // The offline criteria is kept: its incidents go on resolving themselves.
      expect(resolvedIncidents).toEqual([]);
      expect(ids(resolvedAlerts)).toEqual(
        open
          .map((records: OpenRecords): string => {
            return records.degradedAlertId;
          })
          .sort(),
      );

      const steps: MonitorSteps = await stepsOf(monitors[3]!.monitorId);

      // Its own address, as written (a URL reads back with its "/").
      expect(
        steps
          .data!.monitorStepsInstanceArray[0]!.data!.monitorDestination?.toString()
          .replace(/\/$/, ""),
      ).toBe(monitors[3]!.url);
      expect(criteriaIdsOf(steps)).toEqual([
        "each-offline",
        "each-paged",
        "each-online",
      ]);
    }, 600000);

    test("Sync from Template, one monitor: resolves and counts what it stranded on that monitor only", async () => {
      const template: MonitorTemplate = await saveTemplate({
        name: "Checkout health v2",
        prefix: "one",
        criteria: ALL_CRITERIA,
      });
      const monitors: Array<SeededMonitor> = await seedMonitors({
        count: 2,
        template: template,
        prefix: "one",
      });
      const synced: OpenRecords = await openRecords({
        monitor: monitors[0]!,
        prefix: "one",
      });
      const other: OpenRecords = await openRecords({
        monitor: monitors[1]!,
        prefix: "one",
      });

      await editTemplateCriteria({
        template: template,
        prefix: "one",
        keep: ["paged", "online"],
      });

      const result: SyncToMonitorResult =
        await MonitorTemplateService.syncToMonitor({
          monitorTemplateId: template.id!,
          monitorId: monitors[0]!.monitorId,
          props: personProps,
          fields: ["monitorSteps"],
        });

      expect(result).toEqual({
        resolvedIncidentCount: 1,
        resolvedAlertCount: 1,
      });
      expect(ids(resolvedIncidents)).toEqual([synced.offlineIncidentId]);
      expect(ids(resolvedAlerts)).toEqual([synced.degradedAlertId]);
      expect(ids(resolvedIncidents)).not.toContain(other.offlineIncidentId);
    }, 600000);

    test("a person's edit of a monitor's criteria resolves what the criteria they removed opened, named on its timeline", async () => {
      const template: MonitorTemplate = await saveTemplate({
        name: "Checkout health v3",
        prefix: "edit",
        criteria: ALL_CRITERIA,
      });
      const [monitor] = await seedMonitors({
        count: 1,
        template: template,
        prefix: "edit",
      });
      const open: OpenRecords = await openRecords({
        monitor: monitor!,
        prefix: "edit",
      });

      // The form sends the monitor's steps with the criteria it keeps.
      const steps: MonitorSteps = await stepsOf(monitor!.monitorId);
      steps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!.monitorCriteriaInstanceArray =
        steps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.filter(
          (instance: MonitorCriteriaInstance): boolean => {
            return instance.data!.id !== "edit-degraded";
          },
        );

      await MonitorService.updateOneById({
        id: monitor!.monitorId,
        data: { monitorSteps: steps } as never,
        props: personProps,
      });

      expect(resolvedIncidents).toEqual([]);
      expect(ids(resolvedAlerts)).toEqual([open.degradedAlertId]);
      expect(noteOf(resolvedAlerts[0]!.rootCause)).toBe(
        "{{user}} changed the criteria of the monitor **{{monitor}}** and removed the ones that opened this alert. This alert was set to resolve on its own once the monitor recovered, and nothing can resolve it now that those criteria are gone, so it was resolved now. If the problem is still there and the monitor's criteria still check for it, they open a new alert.",
      );
      expect(resolvedAlerts[0]!.rootCause).toContain(`**${monitor!.name}**`);
    }, 600000);

    test("an API key's edit, with nobody to name, resolves what it stranded too", async () => {
      const template: MonitorTemplate = await saveTemplate({
        name: "Checkout health v4",
        prefix: "api",
        criteria: ALL_CRITERIA,
      });
      const [monitor] = await seedMonitors({
        count: 1,
        template: template,
        prefix: "api",
      });
      const open: OpenRecords = await openRecords({
        monitor: monitor!,
        prefix: "api",
      });

      const steps: MonitorSteps = await stepsOf(monitor!.monitorId);
      steps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!.monitorCriteriaInstanceArray =
        steps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.filter(
          (instance: MonitorCriteriaInstance): boolean => {
            return instance.data!.id !== "api-offline";
          },
        );

      await MonitorService.updateOneById({
        id: monitor!.monitorId,
        data: { monitorSteps: steps } as never,
        props: apiKeyProps,
      });

      expect(ids(resolvedIncidents)).toEqual([open.offlineIncidentId]);
      expect(resolvedAlerts).toEqual([]);
      expect(noteOf(resolvedIncidents[0]!.rootCause)).toMatch(
        /^The criteria of the monitor \*\*\{\{monitor\}\}\*\* were changed, and the ones that opened this incident were removed\./,
      );
    }, 600000);

    test("Terraform resending the steps without ids keeps every criteria it resends, by name, and resolves only what it left out", async () => {
      const template: MonitorTemplate = await saveTemplate({
        name: "Checkout health v5",
        prefix: "tf",
        criteria: ALL_CRITERIA,
      });
      const [monitor] = await seedMonitors({
        count: 1,
        template: template,
        prefix: "tf",
      });
      const open: OpenRecords = await openRecords({
        monitor: monitor!,
        prefix: "tf",
      });

      /*
       * The provider sends no ids: the steps as JSON, each criteria by its
       * name alone. "tf degraded" is not resent.
       */
      const resend: (kinds: Array<CriteriaKind>) => JSONObject = (
        kinds: Array<CriteriaKind>,
      ): JSONObject => {
        const json: JSONObject = websiteSteps({
          prefix: "tf",
          url: monitor!.url,
          criteria: kinds,
        }).toJSON() as JSONObject;
        const step: JSONObject = (
          (json["value"] as JSONObject)[
            "monitorStepsInstanceArray"
          ] as Array<JSONObject>
        )[0]!["value"] as JSONObject;
        delete step["id"];

        for (const criteria of (
          (step["monitorCriteria"] as JSONObject)["value"] as JSONObject
        )["monitorCriteriaInstanceArray"] as Array<JSONObject>) {
          delete (criteria["value"] as JSONObject)["id"];
        }

        return json;
      };

      await MonitorService.updateOneById({
        id: monitor!.monitorId,
        data: {
          monitorSteps: MonitorSteps.fromJSON(
            resend(["offline", "paged", "online"]),
          ),
        } as never,
        props: apiKeyProps,
      });

      expect(resolvedIncidents).toEqual([]);
      expect(ids(resolvedAlerts)).toEqual([open.degradedAlertId]);
      expect(criteriaIdsOf(await stepsOf(monitor!.monitorId))).toEqual([
        "tf-offline",
        "tf-paged",
        "tf-online",
      ]);

      // The same apply again takes nothing more off.
      await MonitorService.updateOneById({
        id: monitor!.monitorId,
        data: {
          monitorSteps: MonitorSteps.fromJSON(
            resend(["offline", "paged", "online"]),
          ),
        } as never,
        props: apiKeyProps,
      });

      expect(resolvedIncidents).toEqual([]);
      expect(resolvedAlerts).toHaveLength(1);
    }, 600000);

    test("a write that keeps every criteria resolves nothing, and one that removes them all resolves only what resolves on its own", async () => {
      const template: MonitorTemplate = await saveTemplate({
        name: "Checkout health v6",
        prefix: "all",
        criteria: ALL_CRITERIA,
      });
      const [monitor] = await seedMonitors({
        count: 1,
        template: template,
        prefix: "all",
      });
      const open: OpenRecords = await openRecords({
        monitor: monitor!,
        prefix: "all",
      });

      // Saving the form as it is: every criteria kept.
      await MonitorService.updateOneById({
        id: monitor!.monitorId,
        data: { monitorSteps: await stepsOf(monitor!.monitorId) } as never,
        props: personProps,
      });

      expect(resolvedIncidents).toEqual([]);
      expect(resolvedAlerts).toEqual([]);

      // Every criteria removed.
      await MonitorService.updateOneById({
        id: monitor!.monitorId,
        data: {
          monitorSteps: websiteSteps({
            prefix: "all-new",
            url: monitor!.url,
            criteria: ["online"],
          }),
        } as never,
        props: personProps,
      });

      expect(ids(resolvedIncidents)).toEqual([open.offlineIncidentId]);
      expect(ids(resolvedAlerts)).toEqual([open.degradedAlertId]);
      expect(ids(resolvedIncidents)).not.toContain(open.pagedIncidentId);
      expect(ids(resolvedIncidents)).not.toContain(open.declaredIncidentId);
    }, 600000);

    test("linking to another template with its settings, and unlinking with its criteria cleared, resolve through the same write and count it", async () => {
      const oldTemplate: MonitorTemplate = await saveTemplate({
        name: "Checkout health, old",
        prefix: "old",
        criteria: ALL_CRITERIA,
      });
      const betterTemplate: MonitorTemplate = await saveTemplate({
        name: "Checkout health, better",
        prefix: "better",
        criteria: ["offline", "online"],
      });
      const [linked, unlinked] = await seedMonitors({
        count: 2,
        template: oldTemplate,
        prefix: "old",
      });
      const linkedOpen: OpenRecords = await openRecords({
        monitor: linked!,
        prefix: "old",
      });

      const link: MonitorTemplateLinkResult =
        await MonitorTemplateService.linkMonitor({
          monitorTemplateId: betterTemplate.id!,
          monitorId: linked!.monitorId,
          props: personProps,
          applyTemplateSettings: true,
        });

      expect(link).toMatchObject({
        resolvedIncidentCount: 1,
        resolvedAlertCount: 1,
      });
      expect(ids(resolvedIncidents)).toEqual([linkedOpen.offlineIncidentId]);
      expect(noteOf(resolvedIncidents[0]!.rootCause)).toMatch(
        /was linked to the template \*\*\{\{template\}\}\*\*, and its criteria replaced the ones that opened this incident/,
      );
      expect(resolvedIncidents[0]!.rootCause).toContain(
        "**Checkout health, better**",
      );

      resolvedIncidents.length = 0;
      resolvedAlerts.length = 0;

      const unlinkedOpen: OpenRecords = await openRecords({
        monitor: unlinked!,
        prefix: "old",
      });

      const unlink: MonitorTemplateLinkResult =
        await MonitorTemplateService.unlinkMonitor({
          monitorTemplateId: oldTemplate.id!,
          monitorId: unlinked!.monitorId,
          props: personProps,
          clearTemplateSettings: true,
        });

      expect(unlink).toMatchObject({
        resolvedIncidentCount: 1,
        resolvedAlertCount: 1,
      });
      expect(ids(resolvedIncidents)).toEqual([unlinkedOpen.offlineIncidentId]);
      expect(ids(resolvedAlerts)).toEqual([unlinkedOpen.degradedAlertId]);
      expect(resolvedAlerts[0]!.rootCause).toContain(
        "**Checkout health, old**",
      );
    }, 600000);
  },
);
