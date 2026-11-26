import Entities from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
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
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import NetworkDeviceAutoImportRuleEngineService from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import OneUptimeDate from "../../../Types/Date";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { AutoImportRuleRunResult } from "../../../Types/NetworkAutomation/RuleRunResult";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import { dropSchemaOneTableAtATime } from "../../Helpers/DropSchemaOneTableAtATime";
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
 * DEVICES ALREADY IN NETWORK DEVICES GET THEIR MONITORS (OneUptime issue
 * #10990), ON A MIGRATED POSTGRES.
 *
 * Opt in with RUN_POSTGRES_EXISTING_DEVICE_MONITORS_TESTS=true against a
 * database the registered migrations have been applied to, e.g. from
 * packages/Common:
 *
 *   RUN_POSTGRES_EXISTING_DEVICE_MONITORS_TESTS=true \
 *   EXISTING_DEVICE_MONITORS_TEST_DATABASE_HOST=127.0.0.1 \
 *   EXISTING_DEVICE_MONITORS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/ExistingDeviceMonitorsPostgres.test.ts --forceExit
 *
 * Every table is copied from public into a schema of its own, dropped
 * afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_EXISTING_DEVICE_MONITORS_TESTS"] === "true"
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

describePostgres(
  "devices already in Network Devices get their monitors (#10990)",
  () => {
    const schema: string = `existing_device_monitors_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;

    let database: DataSource;

    let projectId: ObjectID;
    let probeId: ObjectID;
    let operationalStatusId: ObjectID;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["EXISTING_DEVICE_MONITORS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["EXISTING_DEVICE_MONITORS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["EXISTING_DEVICE_MONITORS_TEST_DATABASE_NAME"] ||
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
       * Created unqualified, they land in this schema, first on the path.
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

      projectId = ObjectID.generate();
      probeId = ObjectID.generate();
      operationalStatusId = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug") VALUES ($1, 1, 'Meraki fleet', $2)`,
        [projectId.toString(), `meraki-fleet-${projectId.toString()}`],
      );
      await database.query(
        `INSERT INTO "${schema}"."MonitorStatus" ("_id", "version", "projectId", "name", "slug", "color", "isOperationalState", "isOfflineState", "priority") VALUES ($1, 1, $2, 'Operational', $3, '#22c55e', true, false, 0)`,
        [
          operationalStatusId.toString(),
          projectId.toString(),
          `operational-${operationalStatusId.toString()}`,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."Probe" ("_id", "version", "projectId", "key", "name", "slug", "probeVersion") VALUES ($1, 1, $2, $3, 'Branch probe', $4, '1.0.0')`,
        [
          probeId.toString(),
          projectId.toString(),
          ObjectID.generate().toString(),
          `branch-probe-${probeId.toString()}`,
        ],
      );
    });

    afterEach(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 1500);
      });
      jest.restoreAllMocks();
    });

    const networkDeviceSteps: () => MonitorSteps = (): MonitorSteps => {
      const step: MonitorStep = new MonitorStep();
      step.data!.networkDeviceMonitor = {
        networkDeviceId: ObjectID.generate().toString(),
        monitorInterfaces: true,
        collectEndpoints: false,
        oids: [],
      };

      const steps: MonitorSteps = new MonitorSteps();
      steps.data = {
        monitorStepsInstanceArray: [step],
        defaultMonitorStatusId: operationalStatusId,
      };
      return steps;
    };

    const saveTemplate: (name: string) => Promise<MonitorTemplate> = async (
      name: string,
    ): Promise<MonitorTemplate> => {
      const template: MonitorTemplate = new MonitorTemplate();
      template.projectId = projectId;
      template.templateName = name;
      template.slug = `${name.toLowerCase().split(" ").join("-")}-${ObjectID.generate().toString()}`;
      template.monitorName = name;
      template.monitorType = MonitorType.NetworkDevice;
      template.monitorSteps = networkDeviceSteps();
      template.monitoringInterval = "*/5 * * * *";
      return await database.manager.save(template);
    };

    const saveDevice: (data: {
      name: string;
      address: string;
    }) => Promise<NetworkDevice> = async (data: {
      name: string;
      address: string;
    }): Promise<NetworkDevice> => {
      const device: NetworkDevice = new NetworkDevice();
      device.projectId = projectId;
      device.name = data.name;
      device.slug = `${data.name.toLowerCase()}-${ObjectID.generate().toString()}`;
      device.hostname = data.address;
      device.probeId = probeId;
      device.monitoringMethod = NetworkDeviceMonitoringMethod.Probe;
      return await database.manager.save(device);
    };

    const saveScan: (
      hosts: Array<DiscoveredNetworkDevice>,
    ) => Promise<NetworkDeviceDiscoveryScan> = async (
      hosts: Array<DiscoveredNetworkDevice>,
    ): Promise<NetworkDeviceDiscoveryScan> => {
      const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
      scan.projectId = projectId;
      scan.probeId = probeId;
      scan.name = "Switch Discovery";
      scan.cidr = "10.20.0.0/24";
      scan.status = "Completed" as never;
      scan.startedAt = OneUptimeDate.getSomeMinutesAgo(30);
      scan.completedAt = OneUptimeDate.getSomeMinutesAgo(20);
      scan.autoImportProcessedAt = OneUptimeDate.getSomeMinutesAgo(19);
      scan.discoveredDevices = hosts;
      scan.snmpVersion = "V2c" as never;
      scan.snmpCommunityString = "public";
      scan.snmpPort = 161;
      return await database.manager.save(scan);
    };

    const saveRule: (
      template: MonitorTemplate,
    ) => Promise<NetworkDeviceAutoImportRule> = async (
      template: MonitorTemplate,
    ): Promise<NetworkDeviceAutoImportRule> => {
      const rule: NetworkDeviceAutoImportRule =
        new NetworkDeviceAutoImportRule();
      rule.projectId = projectId;
      rule.name = "Switch";
      rule.isEnabled = true;
      rule.isExclusion = false;
      rule.ipMatchTarget = "10.20.0.0/24";
      rule.monitorTemplateId = template.id!;
      return await database.manager.save(rule);
    };

    const monitorsOf: (deviceId: ObjectID) => Promise<Array<Monitor>> = async (
      deviceId: ObjectID,
    ): Promise<Array<Monitor>> => {
      return await database.manager.find(Monitor, {
        where: {
          projectId: projectId,
          autoProvisionedNetworkDeviceId: deviceId,
        } as never,
      });
    };

    /*
     * A Network Device monitor already watching a device, written as a row
     * so the triggers record which device its steps watch, as they do for
     * every monitor saved: one a person made (no provenance), one an import
     * made (made for the device), from a template or from none.
     */
    const insertDeviceMonitor: (data: {
      name: string;
      deviceId: ObjectID;
      monitorTemplateId?: ObjectID | undefined;
      madeForDeviceId?: ObjectID | undefined;
    }) => Promise<ObjectID> = async (data: {
      name: string;
      deviceId: ObjectID;
      monitorTemplateId?: ObjectID | undefined;
      madeForDeviceId?: ObjectID | undefined;
    }): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();
      const step: MonitorStep = new MonitorStep();
      step.data!.networkDeviceMonitor = {
        networkDeviceId: data.deviceId.toString(),
        monitorInterfaces: true,
        collectEndpoints: false,
        oids: [],
      };
      const steps: MonitorSteps = new MonitorSteps();
      steps.data = {
        monitorStepsInstanceArray: [step],
        defaultMonitorStatusId: operationalStatusId,
      };

      await database.query(
        `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "monitorSteps", "monitorTemplateId", "autoProvisionedNetworkDeviceId") VALUES ($1, 1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [
          id.toString(),
          projectId.toString(),
          data.name,
          `${data.name.toLowerCase().split(" ").join("-")}-${id.toString()}`,
          MonitorType.NetworkDevice,
          operationalStatusId.toString(),
          JSON.stringify(steps.toJSON()),
          data.monitorTemplateId?.toString() || null,
          data.madeForDeviceId?.toString() || null,
        ],
      );

      return id;
    };

    // Every Network Device monitor whose steps watch the device.
    const watchingMonitorsOf: (
      deviceId: ObjectID,
    ) => Promise<
      Array<{ monitorId: string; monitorTemplateId: string | null }>
    > = async (
      deviceId: ObjectID,
    ): Promise<
      Array<{ monitorId: string; monitorTemplateId: string | null }>
    > => {
      return await database.query(
        `SELECT m."_id" AS "monitorId", m."monitorTemplateId" FROM "${schema}"."MonitorNetworkDevice" w JOIN "${schema}"."Monitor" m ON m."_id" = w."monitorId" WHERE w."networkDeviceId" = $1 AND m."deletedAt" IS NULL ORDER BY m."createdAt"`,
        [deviceId.toString()],
      );
    };

    const hostOf: (device: NetworkDevice) => DiscoveredNetworkDevice = (
      device: NetworkDevice,
    ): DiscoveredNetworkDevice => {
      return {
        ipAddress: device.hostname!,
        sysName: device.name!,
        sysDescr: "Meraki MS120-48LP Cloud Managed PoE Switch",
        snmpReachable: true,
      } as DiscoveredNetworkDevice;
    };

    test("Run Now gives the devices a scan already added their template's monitor", async () => {
      const template: MonitorTemplate = await saveTemplate(
        "Enterprise Switch Monitoring",
      );
      const devices: Array<NetworkDevice> = [];

      for (let index: number = 1; index <= 3; index++) {
        devices.push(
          await saveDevice({
            name: `RRKLCRLANSWI0${index}`,
            address: `10.20.0.${index}`,
          }),
        );
      }

      await saveScan(devices.map(hostOf));

      const rule: NetworkDeviceAutoImportRule = await saveRule(template);

      const result: AutoImportRuleRunResult =
        await NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans(
          {
            ruleId: rule.id!,
            projectId: projectId,
            isDryRun: false,
          },
        );

      expect(result).toMatchObject({
        hostsMatched: 3,
        hostsSkippedAlreadyRegistered: 3,
        devicesCreated: 0,
        monitorsCreated: 3,
        monitorsSkippedAlreadyExisting: 0,
        monitorsFailed: 0,
      });

      for (const device of devices) {
        const made: Array<Monitor> = await monitorsOf(device.id!);

        expect(made).toHaveLength(1);
        expect(made[0]!.monitorTemplateId?.toString()).toBe(
          template.id!.toString(),
        );
      }
    }, 120000);

    /*
     * THE SKIP (#10990). A device that already has a Network Device monitor
     * - one a person made for one OID, or one whose template was deleted
     * since (the foreign key sets monitorTemplateId to NULL) - has no monitor
     * from the rule's template. The engine counted any such monitor as the
     * device's monitor and skipped every template for it, for good. Only a
     * monitor from the same template is a duplicate, however it was made.
     */
    test("a device's other monitors never stop its template's monitor; one from the template does", async () => {
      const template: MonitorTemplate = await saveTemplate(
        "Enterprise Switch Monitoring",
      );
      const retired: MonitorTemplate = await saveTemplate("Old Switch Health");

      const handMadeDevice: NetworkDevice = await saveDevice({
        name: "NHOLCRLANSWI01",
        address: "10.20.0.11",
      });
      const orphanedDevice: NetworkDevice = await saveDevice({
        name: "NHOLCRLANSWI02",
        address: "10.20.0.12",
      });
      const monitoredDevice: NetworkDevice = await saveDevice({
        name: "IRVLCRLANSWI01",
        address: "10.20.0.13",
      });
      const linkedDevice: NetworkDevice = await saveDevice({
        name: "IRVLCRLANSWI02",
        address: "10.20.0.14",
      });

      // A person's monitor for one OID: no template.
      await insertDeviceMonitor({
        name: "NHOLCRLANSWI01 uplink errors",
        deviceId: handMadeDevice.id!,
      });

      // An earlier import's monitor, from a template since deleted.
      await insertDeviceMonitor({
        name: "NHOLCRLANSWI02 - Old Switch Health",
        deviceId: orphanedDevice.id!,
        monitorTemplateId: retired.id!,
        madeForDeviceId: orphanedDevice.id!,
      });
      await database.query(
        `DELETE FROM "${schema}"."MonitorTemplate" WHERE "_id" = $1`,
        [retired.id!.toString()],
      );
      await database.query(
        `UPDATE "${schema}"."Monitor" SET "monitorTemplateId" = NULL WHERE "monitorTemplateId" = $1`,
        [retired.id!.toString()],
      );

      // An import's monitor from the rule's own template.
      await insertDeviceMonitor({
        name: "IRVLCRLANSWI01 - Enterprise Switch Monitoring",
        deviceId: monitoredDevice.id!,
        monitorTemplateId: template.id!,
        madeForDeviceId: monitoredDevice.id!,
      });

      /*
       * A person's monitor from the rule's own template - Create from
       * template on the Monitors page: linked to it, made for nobody, tied
       * to nobody, watching the device in its steps.
       */
      await insertDeviceMonitor({
        name: "IRVLCRLANSWI02 health",
        deviceId: linkedDevice.id!,
        monitorTemplateId: template.id!,
      });

      await saveScan(
        [handMadeDevice, orphanedDevice, monitoredDevice, linkedDevice].map(
          hostOf,
        ),
      );

      const rule: NetworkDeviceAutoImportRule = await saveRule(template);

      const dryRun: AutoImportRuleRunResult =
        await NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans(
          {
            ruleId: rule.id!,
            projectId: projectId,
            isDryRun: true,
          },
        );

      expect(dryRun).toMatchObject({
        hostsSkippedAlreadyRegistered: 4,
        monitorsWouldCreate: 2,
        monitorsSkippedAlreadyExisting: 2,
      });

      const result: AutoImportRuleRunResult =
        await NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans(
          {
            ruleId: rule.id!,
            projectId: projectId,
            isDryRun: false,
          },
        );

      expect(result).toMatchObject({
        hostsSkippedAlreadyRegistered: 4,
        devicesCreated: 0,
        monitorsCreated: 2,
        monitorsSkippedAlreadyExisting: 2,
        monitorsFailed: 0,
      });

      for (const device of [handMadeDevice, orphanedDevice]) {
        const fromTemplate: Array<Monitor> = (
          await monitorsOf(device.id!)
        ).filter((monitor: Monitor): boolean => {
          return (
            monitor.monitorTemplateId?.toString() === template.id!.toString()
          );
        });

        expect(fromTemplate).toHaveLength(1);
        // Beside the monitor it had, which is left as it was.
        expect(await watchingMonitorsOf(device.id!)).toHaveLength(2);
      }

      for (const device of [monitoredDevice, linkedDevice]) {
        const watching: Array<{
          monitorId: string;
          monitorTemplateId: string | null;
        }> = await watchingMonitorsOf(device.id!);

        expect(watching).toHaveLength(1);
        expect(watching[0]!.monitorTemplateId).toBe(template.id!.toString());
      }

      // Running it again makes nothing: every device has its monitor.
      const again: AutoImportRuleRunResult =
        await NetworkDeviceAutoImportRuleEngineService.applyRuleToCompletedScans(
          {
            ruleId: rule.id!,
            projectId: projectId,
            isDryRun: false,
          },
        );

      expect(again).toMatchObject({
        monitorsCreated: 0,
        monitorsSkippedAlreadyExisting: 4,
      });
    }, 180000);
  },
);
