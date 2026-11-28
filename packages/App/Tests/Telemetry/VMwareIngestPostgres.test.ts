import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import Entities from "Common/Models/DatabaseModels/Index";
import InventoryItemModel from "Common/Models/DatabaseModels/InventoryItem";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import InventoryItemService from "Common/Server/Services/InventoryItemService";
import VMwareResourceService from "Common/Server/Services/VMwareResourceService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import {
  VMwareAssessment,
  assessVMwareVirtualMachine,
} from "../../FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHealth";
import { ResourceAttentionSeverity } from "../../FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import logger from "Common/Server/Utils/Logger";
import TelemetryChangeDetector from "Common/Server/Utils/Telemetry/ChangeDetection/TelemetryChangeDetector";
import * as EntityRegistry from "Common/Server/Utils/Telemetry/EntityRegistry";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import EntityExtractor, {
  ExtractedEntity,
} from "Common/Server/Utils/Telemetry/TelemetryEntity";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  VMwareSwapRateMetric,
  VMwareSwapRateSource,
} from "Common/Types/VMware/VMwareSwapRates";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
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
import { DataSource } from "Common/node_modules/typeorm";
import fs from "fs";
import path from "path";

/*
 * WHAT INVENTORY CALLS A VCENTER'S VMS, HOSTS, CLUSTERS AND DATASTORES, END
 * TO END ON POSTGRES (#11254).
 *
 * The vcenter receiver's recorded export of a simulated vCenter (one
 * datacenter, two clusters of two hosts, a standalone host, resource pools,
 * six VMs and a datastore: Probe/Tests/Utils/VMware/Fixtures) goes through
 * the real metrics ingest - the OTLP walk, the entity extraction, the
 * entity registry and InventoryItemService - into copies of the migrated
 * InventoryItem, InventoryItemRelationship and VMwareResource tables. Only
 * what has nothing to do with Inventory is stood in for: ClickHouse, Redis
 * (every reconcile fence open), the vCenter's discovery and the choice of a
 * batch's primary entity.
 *
 * Before the fix every one of the six VMs was called "golden-vcenter" and
 * every host, cluster and datastore "dc0"; now each is called by its own
 * name, as the VMware pages call it (the VMwareResource rows of the same
 * ingest). A row stored by the old rule takes its own name on its next
 * report, and a name a person typed is kept.
 *
 * And whether a VM's swapped memory is swapping (#11157): no collector sends
 * a swap rate, so ingest works it out from how the swapped amount moves
 * between two reports of the same export, and the Overview's rules judge
 * the rows as a page reads them - the issue's 4 MiB left from earlier is
 * no finding, a VM the host swaps out is critical.
 *
 * And vSphere's own rates (#11468): the same recorded export with the swap
 * rate counters a probe adds to it (vcenter.vm.memory.swap_out.rate and
 * swap_in.rate, as the probe's builder writes them) keeps vSphere's rates
 * as sent and says so; without them - the VMware agent's export - the rates
 * are worked out, and say that. Either way the flush writes the rate it
 * judges by as OneUptime's own metric, which VM Memory Swapping reads.
 *
 * Opt in with RUN_POSTGRES_VMWARE_INGEST_TESTS=true against a Postgres
 * migrated to the current head (the Postgres Schema Drift workflow's
 * database right after its drift check). The tables' STRUCTURE is cloned
 * into a unique schema, dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * VMWARE_INGEST_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * VMWARE_INGEST_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_VMWARE_INGEST_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "InventoryItem",
  "InventoryItemRelationship",
  "VMwareResource",
];

// Columns every row the services write fills; every other NOT NULL is relaxed.
const KEPT_NOT_NULL: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "version",
  "projectId",
];

const RECORDED_VCENTER: string = path.resolve(
  __dirname,
  "../../../Probe/Tests/Utils/VMware/Fixtures/vcenterreceiver-0.161.0-vcsim-vcenter.json",
);

const AUTO_DISCOVERY_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

interface InventoryRow {
  entityType: string;
  entityKey: string;
  displayName: string | null;
}

function recordedExport(): JSONObject {
  return JSON.parse(fs.readFileSync(RECORDED_VCENTER, "utf8")) as JSONObject;
}

function attributesOf(
  resourceMetrics: JSONObject,
): Record<string, string | null> {
  const attributes: Record<string, string | null> = {};
  const list: Array<JSONObject> = ((resourceMetrics["resource"] as JSONObject)[
    "attributes"
  ] || []) as Array<JSONObject>;
  for (const attribute of list) {
    attributes[attribute["key"] as string] =
      ((attribute["value"] as JSONObject)["stringValue"] as string) ?? null;
  }
  return attributes;
}

/*
 * The issue's own two VMs (#11254), as the receiver would send them: each
 * VM's resource with its host, cluster and datacenter, and its memory.
 */
function issueExport(): JSONObject {
  const vm: (attributes: Record<string, string>) => JSONObject = (
    attributes: Record<string, string>,
  ): JSONObject => {
    return {
      resource: {
        attributes: Object.entries({
          "vmware.vcenter.name": "vcsa01.acme.lan",
          "vcenter.datacenter.name": "DC-NORTH",
          ...attributes,
        }).map(([key, value]: [string, string]): JSONObject => {
          return { key, value: { stringValue: value } };
        }),
      },
      scopeMetrics: [
        {
          scope: {
            name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/vcenterreceiver",
            version: "0.165.0",
          },
          metrics: [
            {
              name: "vcenter.vm.memory.usage",
              unit: "MiBy",
              sum: {
                aggregationTemporality: 2,
                dataPoints: [
                  {
                    startTimeUnixNano: "1791640315000000000",
                    timeUnixNano: "1791640316000000000",
                    asInt: "2048",
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  };
  return {
    resourceMetrics: [
      vm({
        "vcenter.cluster.name": "cluster-alpha",
        "vcenter.host.name": "esx-node-07.acme.lan",
        "vcenter.vm.name": "web-frontend-03",
        "vcenter.vm.id": "4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e",
      }),
      vm({
        "vcenter.cluster.name": "cluster-beta",
        "vcenter.host.name": "esx-node-12.acme.lan",
        "vcenter.vm.name": "billing-db-01",
        "vcenter.vm.id": "4a7d02b8-e61a-4f22-8b3c-9d0e1f2a3b4c",
      }),
    ],
  };
}

describePostgres(
  "Inventory names of a vCenter's objects through the real ingest, on Postgres",
  () => {
    const schema: string = `vmware_inventory_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    const projectId: ObjectID = ObjectID.generate();
    const vcenterId: ObjectID = ObjectID.generate();
    let reconciles: Array<Promise<void>> = [];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["VMWARE_INGEST_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["VMWARE_INGEST_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["VMWARE_INGEST_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema}` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
        const columns: Array<{ column_name: string }> = await database.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'`,
          [schema, table],
        );
        for (const column of columns) {
          if (!KEPT_NOT_NULL.includes(column.column_name)) {
            await database.query(
              `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
            );
          }
        }
      }
      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation((() => {
          return undefined;
        }) as never);
      }
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Redis: every reconcile fence is open, so every report reconciles.
      jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
      jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);
      jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
      jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ingest: Record<string, any> =
        OtelMetricsIngestService as unknown as {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          [key: string]: any;
        };
      jest.spyOn(ingest, "runBatchHostEnrichment").mockResolvedValue(undefined);
      jest.spyOn(ingest, "submitMetricsBuffer").mockResolvedValue(undefined);
      for (const method of AUTO_DISCOVERY_RETURNING_NULL) {
        jest.spyOn(ingest, method).mockResolvedValue(null);
      }
      jest
        .spyOn(ingest, "autoDiscoverVMwareVCenter")
        .mockResolvedValue(vcenterId);
      // The batch's primary entity is the vCenter's; the entities stay real.
      jest.spyOn(ingest, "selectPrimaryEntity").mockResolvedValue({
        serviceName: "vmware/golden-vcenter",
        primaryEntityId: vcenterId,
        primaryEntityType: ServiceType.VMwareVCenter,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      });
      jest
        .spyOn(ingest, "tryPlaceServiceOnOpenStack")
        .mockResolvedValue(undefined);
      jest
        .spyOn(TelemetryChangeDetector, "observeResource")
        .mockReturnValue(undefined as never);
      jest
        .spyOn(MetricPipelineRuleService, "loadRules")
        .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
      jest
        .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(VMwareVCenterService, "updateLastSeen")
        .mockResolvedValue(undefined as never);

      /*
       * Ingest reconciles the registry fire-and-forget; keep each promise so
       * a test reads the rows once every write has landed.
       */
      reconciles = [];
      const reconcile: typeof EntityRegistry.reconcileEntityRegistryThrottled =
        EntityRegistry.reconcileEntityRegistryThrottled;
      jest
        .spyOn(EntityRegistry, "reconcileEntityRegistryThrottled")
        .mockImplementation(
          (
            data: Parameters<
              typeof EntityRegistry.reconcileEntityRegistryThrottled
            >[0],
          ): Promise<void> => {
            const pending: Promise<void> = reconcile(data);
            reconciles.push(pending);
            return pending;
          },
        );

      for (const table of TABLES) {
        await database.query(`TRUNCATE "${schema}"."${table}"`);
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function ingest(body: JSONObject): Promise<void> {
      await OtelMetricsIngestService.processMetricsFromQueue({
        projectId,
        body,
        headers: {},
      } as unknown as TelemetryRequest);
      await Promise.all(reconciles);
    }

    async function inventory(entityType: EntityType): Promise<Array<string>> {
      const rows: Array<InventoryRow> = await database.query(
        `SELECT "entityType", "entityKey", "displayName" FROM "InventoryItem"
         WHERE "projectId" = $1 AND "entityType" = $2 ORDER BY "displayName"`,
        [projectId.toString(), entityType],
      );
      return rows.map((row: InventoryRow): string => {
        return row.displayName || "";
      });
    }

    async function vmwareNames(kind: string): Promise<Array<string>> {
      const rows: Array<{ name: string | null }> = await database.query(
        `SELECT "name" FROM "VMwareResource"
         WHERE "projectId" = $1 AND "vmwareVCenterId" = $2 AND "kind" = $3 ORDER BY "name"`,
        [projectId.toString(), vcenterId.toString(), kind],
      );
      return rows.map((row: { name: string | null }): string => {
        return row.name || "";
      });
    }

    test("each of the six VMs is an item of its own name, not the vCenter's", async () => {
      await ingest(recordedExport());

      const vms: Array<string> = await inventory(
        EntityType.VMwareVirtualMachine,
      );
      expect(vms).toEqual([
        "DC0_C0_RP1_VM0",
        "DC0_C0_RP1_VM1",
        "DC0_C1_RP1_VM0",
        "DC0_C1_RP1_VM1",
        "DC0_H0_VM0",
        "DC0_H0_VM1",
      ]);
      expect(vms).not.toContain("golden-vcenter");
      // The names the VMware pages show for the same VMs, from the same ingest.
      expect(vms).toEqual(await vmwareNames("VirtualMachine"));
    });

    test("every ESXi host, cluster and datastore is named by itself, not by its datacenter", async () => {
      await ingest(recordedExport());

      expect(await inventory(EntityType.VMwareHost)).toEqual([
        "DC0_C0_H0",
        "DC0_C0_H1",
        "DC0_C1_H0",
        "DC0_C1_H1",
        "DC0_H0",
      ]);
      expect(await inventory(EntityType.VMwareCluster)).toEqual([
        "DC0_C0",
        "DC0_C1",
      ]);
      expect(await inventory(EntityType.VMwareDatastore)).toEqual([
        "LocalDS_0",
      ]);
      expect(await inventory(EntityType.VMwareVCenter)).toEqual([
        "golden-vcenter",
      ]);
      expect(await inventory(EntityType.VMwareHost)).toEqual(
        await vmwareNames("Host"),
      );
      expect(await inventory(EntityType.VMwareCluster)).toEqual(
        await vmwareNames("Cluster"),
      );
    });

    test("no two of the vCenter's items read alike any more", async () => {
      await ingest(recordedExport());

      const rows: Array<InventoryRow> = await database.query(
        `SELECT "entityType", "entityKey", "displayName" FROM "InventoryItem" WHERE "projectId" = $1`,
        [projectId.toString()],
      );
      // 6 VMs + 5 hosts + 2 clusters + 1 datastore + the vCenter.
      expect(rows).toHaveLength(15);
      const names: Set<string> = new Set<string>(
        rows.map((row: InventoryRow): string => {
          return `${row.entityType}:${row.displayName}`;
        }),
      );
      expect(names.size).toBe(rows.length);
    });

    test("the issue's two VMs and their hosts and clusters read by their own names", async () => {
      await ingest(issueExport());

      expect(await inventory(EntityType.VMwareVirtualMachine)).toEqual([
        "billing-db-01",
        "web-frontend-03",
      ]);
      expect(await inventory(EntityType.VMwareHost)).toEqual([
        "esx-node-07.acme.lan",
        "esx-node-12.acme.lan",
      ]);
      expect(await inventory(EntityType.VMwareCluster)).toEqual([
        "cluster-alpha",
        "cluster-beta",
      ]);
      expect(await inventory(EntityType.VMwareVCenter)).toEqual([
        "vcsa01.acme.lan",
      ]);
    });

    /*
     * The rows the old rule stored: each VM named after the vCenter, each
     * host, cluster and datastore after the datacenter, lowercased as the
     * identity holds it.
     */
    async function storeAsTheOldRuleNamedThem(data: {
      typed?: { entityType: EntityType; name: string } | undefined;
    }): Promise<void> {
      const seen: Set<string> = new Set<string>();
      for (const resourceMetrics of recordedExport()[
        "resourceMetrics"
      ] as Array<JSONObject>) {
        for (const entity of EntityExtractor.extractEntities({
          projectId: projectId.toString(),
          attributes: attributesOf(resourceMetrics),
        })) {
          if (seen.has(entity.entityKey)) {
            continue;
          }
          seen.add(entity.entityKey);
          const legacy: Record<string, string> = {
            [EntityType.VMwareVirtualMachine]:
              entity.identifyingAttributes["vmware.vcenter.name"] || "",
            [EntityType.VMwareHost]:
              entity.identifyingAttributes["vcenter.datacenter.name"] || "",
            [EntityType.VMwareCluster]:
              entity.identifyingAttributes["vcenter.datacenter.name"] || "",
            [EntityType.VMwareDatastore]:
              entity.identifyingAttributes["vcenter.datacenter.name"] || "",
            [EntityType.VMwareVCenter]:
              entity.identifyingAttributes["vmware.vcenter.name"] || "",
          };
          // What the old code kept beside the name: the same, but each kind's own name.
          const ownName: Record<string, string> = {
            [EntityType.VMwareHost]: "vcenter.host.name",
            [EntityType.VMwareCluster]: "vcenter.cluster.name",
            [EntityType.VMwareDatastore]: "vcenter.datastore.name",
            [EntityType.VMwareVCenter]: "vmware.vcenter.name",
          };
          const descriptive: Record<string, string> = {
            ...(entity.descriptiveAttributes || {}),
          };
          delete descriptive[ownName[entity.entityType] || ""];

          const row: InventoryItemModel = new InventoryItemModel();
          row.projectId = projectId;
          row.entityType = entity.entityType;
          row.entityKey = entity.entityKey;
          row.source = EntitySource.Discovered;
          row.identifyingAttributes = entity.identifyingAttributes;
          if (Object.keys(descriptive).length > 0) {
            row.descriptiveAttributes = descriptive;
          }
          row.displayName =
            data.typed &&
            data.typed.entityType === entity.entityType &&
            entity.descriptiveAttributes?.["vcenter.vm.name"] === "DC0_H0_VM0"
              ? data.typed.name
              : legacy[entity.entityType]!;
          row.firstSeenAt = new Date("2026-11-01T00:00:00.000Z");
          row.lastSeenAt = new Date("2026-11-01T00:00:00.000Z");
          await InventoryItemService.create({
            data: row,
            props: { isRoot: true },
          });
        }
      }
    }

    test("rows the old rule stored are renamed on their next report", async () => {
      await storeAsTheOldRuleNamedThem({});
      expect(await inventory(EntityType.VMwareVirtualMachine)).toEqual(
        Array(6).fill("golden-vcenter"),
      );
      expect(await inventory(EntityType.VMwareHost)).toEqual(
        Array(5).fill("dc0"),
      );

      await ingest(recordedExport());

      expect(await inventory(EntityType.VMwareVirtualMachine)).toEqual([
        "DC0_C0_RP1_VM0",
        "DC0_C0_RP1_VM1",
        "DC0_C1_RP1_VM0",
        "DC0_C1_RP1_VM1",
        "DC0_H0_VM0",
        "DC0_H0_VM1",
      ]);
      expect(await inventory(EntityType.VMwareHost)).toEqual([
        "DC0_C0_H0",
        "DC0_C0_H1",
        "DC0_C1_H0",
        "DC0_C1_H1",
        "DC0_H0",
      ]);
      expect(await inventory(EntityType.VMwareCluster)).toEqual([
        "DC0_C0",
        "DC0_C1",
      ]);
      expect(await inventory(EntityType.VMwareDatastore)).toEqual([
        "LocalDS_0",
      ]);

      // Renamed in place: still one row per item, the same rows as before.
      const count: Array<{ count: string }> = await database.query(
        `SELECT count(*)::text AS count FROM "InventoryItem" WHERE "projectId" = $1`,
        [projectId.toString()],
      );
      expect(count[0]!.count).toBe("15");
    });

    test("a name a person typed is kept through the next report", async () => {
      await storeAsTheOldRuleNamedThem({
        typed: {
          entityType: EntityType.VMwareVirtualMachine,
          name: "Ledger primary (blue)",
        },
      });

      await ingest(recordedExport());

      const vms: Array<string> = await inventory(
        EntityType.VMwareVirtualMachine,
      );
      expect(vms).toContain("Ledger primary (blue)");
      expect(vms).not.toContain("DC0_H0_VM0");
      expect(vms).not.toContain("golden-vcenter");
      expect(vms).toHaveLength(6);
    });

    test("a second report changes nothing once every name is right", async () => {
      await ingest(recordedExport());
      const before: Array<{ entityKey: string; displayName: string }> =
        await database.query(
          `SELECT "entityKey", "displayName" FROM "InventoryItem" WHERE "projectId" = $1 ORDER BY "entityKey"`,
          [projectId.toString()],
        );

      await ingest(recordedExport());

      const after: Array<{ entityKey: string; displayName: string }> =
        await database.query(
          `SELECT "entityKey", "displayName" FROM "InventoryItem" WHERE "projectId" = $1 ORDER BY "entityKey"`,
          [projectId.toString()],
        );
      expect(after).toEqual(before);
    });

    test("a VM's host and cluster are kept on its row, where the list reads them", async () => {
      await ingest(issueExport());

      const rows: Array<{
        displayName: string;
        descriptiveAttributes: Record<string, string>;
      }> = await database.query(
        `SELECT "displayName", "descriptiveAttributes" FROM "InventoryItem"
         WHERE "projectId" = $1 AND "entityType" = $2 ORDER BY "displayName"`,
        [projectId.toString(), EntityType.VMwareVirtualMachine],
      );
      expect(rows[1]!.displayName).toBe("web-frontend-03");
      expect(rows[1]!.descriptiveAttributes).toEqual(
        expect.objectContaining({
          "vcenter.vm.name": "web-frontend-03",
          "vcenter.host.name": "esx-node-07.acme.lan",
          "vcenter.cluster.name": "cluster-alpha",
          "vcenter.datacenter.name": "DC-NORTH",
        }),
      );
    });

    /*
     * #11157: the same recorded export, reported twice two minutes apart.
     * The simulator's VMs report no swapped memory, so two of them are
     * given some: DC0_H0_VM0 the issue's 4 MiB both times - memory left
     * from earlier - and DC0_H0_VM1 4 MiB, then 12 MiB - the host swapping
     * it out.
     */
    function recordedExportWith(data: {
      secondsLater: number;
      swappedMiB: Record<string, number>;
    }): JSONObject {
      const body: JSONObject = recordedExport();
      const shift: bigint = BigInt(data.secondsLater) * BigInt(1000000000);
      for (const resourceMetrics of body[
        "resourceMetrics"
      ] as Array<JSONObject>) {
        const vmName: string | null =
          attributesOf(resourceMetrics)["vcenter.vm.name"] || null;
        for (const scopeMetrics of resourceMetrics[
          "scopeMetrics"
        ] as Array<JSONObject>) {
          for (const metric of scopeMetrics["metrics"] as Array<JSONObject>) {
            const series: JSONObject = (metric["sum"] ||
              metric["gauge"]) as JSONObject;
            for (const point of series["dataPoints"] as Array<JSONObject>) {
              for (const key of ["timeUnixNano", "startTimeUnixNano"]) {
                if (typeof point[key] === "string") {
                  point[key] = String(BigInt(point[key] as string) + shift);
                }
              }
              if (
                metric["name"] === "vcenter.vm.memory.swapped" &&
                vmName &&
                data.swappedMiB[vmName] !== undefined
              ) {
                point["asInt"] = String(data.swappedMiB[vmName]);
              }
            }
          }
        }
      }
      return body;
    }

    async function virtualMachines(): Promise<Map<string, VMwareResource>> {
      const rows: Array<VMwareResource> = await VMwareResourceService.findBy({
        query: {
          projectId,
          vmwareVCenterId: vcenterId,
          kind: VMwareResourceKind.VirtualMachine,
        },
        select: {
          name: true,
          kind: true,
          externalId: true,
          hostName: true,
          datacenterName: true,
          isTemplate: true,
          isPoweredOn: true,
          memorySwappedBytes: true,
          memorySwapOutBytesPerSecond: true,
          memorySwapInBytesPerSecond: true,
          memorySwapRateSource: true,
          memoryBalloonedBytes: true,
          cpuReadinessPercent: true,
          metricsUpdatedAt: true,
        },
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      });
      return new Map<string, VMwareResource>(
        rows.map((row: VMwareResource): [string, VMwareResource] => {
          return [row.name || "", row];
        }),
      );
    }

    test("#11157: two reports tell memory left from earlier from a VM the host is swapping out", async () => {
      await ingest(
        recordedExportWith({
          secondsLater: 0,
          swappedMiB: { DC0_H0_VM0: 4, DC0_H0_VM1: 4 },
        }),
      );
      // One report alone cannot say which way memory moves.
      let vms: Map<string, VMwareResource> = await virtualMachines();
      expect(vms.get("DC0_H0_VM1")!.memorySwapOutBytesPerSecond).toBeNull();

      await ingest(
        recordedExportWith({
          secondsLater: 120,
          swappedMiB: { DC0_H0_VM0: 4, DC0_H0_VM1: 12 },
        }),
      );
      vms = await virtualMachines();

      const residual: VMwareResource = vms.get("DC0_H0_VM0")!;
      expect(residual.memorySwappedBytes).toBe(4 * 1024 * 1024);
      expect(residual.memorySwapOutBytesPerSecond).toBe(0);
      expect(residual.memorySwapInBytesPerSecond).toBe(0);

      const swapping: VMwareResource = vms.get("DC0_H0_VM1")!;
      expect(swapping.memorySwappedBytes).toBe(12 * 1024 * 1024);
      expect(swapping.memorySwapOutBytesPerSecond).toBeCloseTo(
        (8 * 1024 * 1024) / 120,
        3,
      );
      expect(swapping.memorySwapInBytesPerSecond).toBe(0);

      // A VM that reported no swapped memory either time moves none.
      expect(vms.get("DC0_C0_RP1_VM0")!.memorySwapOutBytesPerSecond).toBe(0);

      // As the Overview judges the rows it reads: the issue's VM is fine.
      const now: Date = new Date(
        new Date(swapping.metricsUpdatedAt!).getTime() + 60 * 1000,
      );
      expect(residual.isPoweredOn).toBe(true);
      expect(assessVMwareVirtualMachine({ vm: residual, now })).toEqual({
        severity: null,
        reasons: [],
      });
      const swappingNow: VMwareAssessment = assessVMwareVirtualMachine({
        vm: swapping,
        now,
      });
      expect(swappingNow.severity).toBe(ResourceAttentionSeverity.Critical);
      expect(
        swappingNow.reasons.map((reason: { text: string }) => {
          return reason.text;
        }),
      ).toEqual(["Host swapping memory out at {{rate}}"]);
    });

    test("#11157: the old rule called the issue's 4 MiB critical; the amount alone still reads 4 MiB", async () => {
      await ingest(
        recordedExportWith({ secondsLater: 0, swappedMiB: { DC0_H0_VM0: 4 } }),
      );
      await ingest(
        recordedExportWith({
          secondsLater: 120,
          swappedMiB: { DC0_H0_VM0: 4 },
        }),
      );
      const residual: VMwareResource = (await virtualMachines()).get(
        "DC0_H0_VM0",
      )!;
      // What the old rule read: any swapped memory, critical.
      expect(Number(residual.memorySwappedBytes)).toBeGreaterThan(0);
      expect(
        assessVMwareVirtualMachine({
          vm: residual,
          now: new Date(
            new Date(residual.metricsUpdatedAt!).getTime() + 60 * 1000,
          ),
        }).severity,
      ).toBeNull();
    });

    /*
     * The recorded export as a probe sends it (#11468): the receiver's
     * metrics, and for each powered-on VM vSphere's swap rates, a gauge of
     * doubles in By/s at the report's time, as VMwareOtlpBuilder writes
     * them.
     */
    function withVSphereSwapRates(
      body: JSONObject,
      ratesByVm: Record<string, { out: number; in: number }>,
    ): JSONObject {
      for (const resourceMetrics of body[
        "resourceMetrics"
      ] as Array<JSONObject>) {
        const vmName: string | null =
          attributesOf(resourceMetrics)["vcenter.vm.name"] || null;
        const rates: { out: number; in: number } | undefined = vmName
          ? ratesByVm[vmName]
          : undefined;
        if (!rates) {
          continue;
        }
        const scopeMetrics: JSONObject = (
          resourceMetrics["scopeMetrics"] as Array<JSONObject>
        )[0]!;
        const metrics: Array<JSONObject> = scopeMetrics[
          "metrics"
        ] as Array<JSONObject>;
        // At the report's time: the VM's swapped amount's.
        const reference: JSONObject =
          metrics.find((metric: JSONObject): boolean => {
            return metric["name"] === "vcenter.vm.memory.swapped";
          }) || metrics[0]!;
        const series: JSONObject = (reference["sum"] ||
          reference["gauge"]) as JSONObject;
        const time: string = (
          series["dataPoints"] as Array<JSONObject>
        )[0]!["timeUnixNano"] as string;
        for (const [name, value] of [
          ["vcenter.vm.memory.swap_out.rate", rates.out],
          ["vcenter.vm.memory.swap_in.rate", rates.in],
        ] as Array<[string, number]>) {
          metrics.push({
            name,
            unit: "By/s",
            gauge: {
              dataPoints: [
                { startTimeUnixNano: time, timeUnixNano: time, asDouble: value },
              ],
            },
          });
        }
      }
      return body;
    }

    // The rows the flush wrote as OneUptime's swap rate metrics.
    function swapRateRows(): Array<JSONObject> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const submit: jest.SpiedFunction<any> = jest.spyOn(
        OtelMetricsIngestService as unknown as Record<string, () => unknown>,
        "submitMetricsBuffer",
      );
      const rows: Array<JSONObject> = [];
      for (const call of submit.mock.calls) {
        for (const row of (call[0] || []) as Array<JSONObject>) {
          if (
            String(row["name"]).startsWith("oneuptime.vmware.") &&
            row["name"] !== undefined
          ) {
            rows.push(row);
          }
        }
      }
      return rows;
    }

    function rowFor(
      rows: Array<JSONObject>,
      metricName: string,
      vmName: string,
    ): JSONObject | undefined {
      return rows.find((row: JSONObject): boolean => {
        const attributes: JSONObject = (row["attributes"] || {}) as JSONObject;
        return (
          row["name"] === metricName &&
          attributes["resource.vcenter.vm.name"] === vmName
        );
      });
    }

    async function swapRateSourceOf(vmName: string): Promise<string | null> {
      const rows: Array<{ memorySwapRateSource: string | null }> =
        await database.query(
          `SELECT "memorySwapRateSource" FROM "VMwareResource"
           WHERE "projectId" = $1 AND "vmwareVCenterId" = $2 AND "kind" = 'VirtualMachine' AND "name" = $3`,
          [projectId.toString(), vcenterId.toString(), vmName],
        );
      return rows[0]?.memorySwapRateSource ?? null;
    }

    test("#11468: without vSphere's rates - the agent's export - two reports work them out, and the flush writes them as worked out", async () => {
      await ingest(
        recordedExportWith({
          secondsLater: 0,
          swappedMiB: { DC0_H0_VM0: 4, DC0_H0_VM1: 4 },
        }),
      );
      // A first report has no rate to write.
      expect(swapRateRows()).toEqual([]);
      expect(await swapRateSourceOf("DC0_H0_VM1")).toBeNull();

      await ingest(
        recordedExportWith({
          secondsLater: 120,
          swappedMiB: { DC0_H0_VM0: 4, DC0_H0_VM1: 12 },
        }),
      );

      expect(await swapRateSourceOf("DC0_H0_VM1")).toBe(
        VMwareSwapRateSource.Derived,
      );
      const rows: Array<JSONObject> = swapRateRows();
      const swapping: JSONObject = rowFor(
        rows,
        VMwareSwapRateMetric.VirtualMachineSwapOut,
        "DC0_H0_VM1",
      )!;
      expect(Number(swapping["value"])).toBeCloseTo((8 * 1024 * 1024) / 120, 3);
      expect((swapping["attributes"] as JSONObject)["source"]).toBe("derived");
      // Scoped and grouped as every VMware monitor reads a VM's metrics.
      expect(
        (swapping["attributes"] as JSONObject)["resource.vmware.vcenter.name"],
      ).toBeTruthy();
      expect(swapping["metricPointType"]).toBe("Gauge");
      expect(swapping["projectId"]).toBe(projectId.toString());

      const residual: JSONObject = rowFor(
        rows,
        VMwareSwapRateMetric.VirtualMachineSwapOut,
        "DC0_H0_VM0",
      )!;
      expect(Number(residual["value"])).toBe(0);
      expect(
        Number(
          rowFor(rows, VMwareSwapRateMetric.VirtualMachineSwapIn, "DC0_H0_VM0")![
            "value"
          ],
        ),
      ).toBe(0);
    });

    test("#11468: with vSphere's rates - a probe's export - one report keeps them as sent, and the flush writes them as measured", async () => {
      await ingest(
        withVSphereSwapRates(
          recordedExportWith({
            secondsLater: 0,
            swappedMiB: { DC0_H0_VM0: 4, DC0_H0_VM1: 4 },
          }),
          {
            // The issue's VM: 4 MiB left from earlier, nothing swapped now.
            DC0_H0_VM0: { out: 0, in: 0 },
            // Swapping out now, though its swapped amount has not moved yet.
            DC0_H0_VM1: { out: 524288, in: 2048 },
          },
        ),
      );

      const vms: Map<string, VMwareResource> = await virtualMachines();
      const swapping: VMwareResource = vms.get("DC0_H0_VM1")!;
      expect(swapping.memorySwappedBytes).toBe(4 * 1024 * 1024);
      expect(swapping.memorySwapOutBytesPerSecond).toBe(524288);
      expect(swapping.memorySwapInBytesPerSecond).toBe(2048);
      expect(await swapRateSourceOf("DC0_H0_VM1")).toBe(
        VMwareSwapRateSource.VSphere,
      );
      expect(vms.get("DC0_H0_VM0")!.memorySwapOutBytesPerSecond).toBe(0);
      // A VM vSphere sent no rate for has none yet, from one report.
      expect(vms.get("DC0_C0_RP1_VM0")!.memorySwapOutBytesPerSecond).toBeNull();

      const rows: Array<JSONObject> = swapRateRows();
      const written: JSONObject = rowFor(
        rows,
        VMwareSwapRateMetric.VirtualMachineSwapOut,
        "DC0_H0_VM1",
      )!;
      expect(Number(written["value"])).toBe(524288);
      expect((written["attributes"] as JSONObject)["source"]).toBe("vsphere");
      expect(
        Number(
          rowFor(rows, VMwareSwapRateMetric.VirtualMachineSwapIn, "DC0_H0_VM1")![
            "value"
          ],
        ),
      ).toBe(2048);

      // As the Overview judges the rows: swapping now is critical, and says vSphere measured it.
      const now: Date = new Date(
        new Date(swapping.metricsUpdatedAt!).getTime() + 60 * 1000,
      );
      expect(swapping.memorySwapRateSource).toBe(VMwareSwapRateSource.VSphere);
      const verdict: VMwareAssessment = assessVMwareVirtualMachine({
        vm: swapping,
        now,
      });
      expect(verdict.severity).toBe(ResourceAttentionSeverity.Critical);
      expect(
        assessVMwareVirtualMachine({ vm: vms.get("DC0_H0_VM0")!, now }).severity,
      ).toBeNull();
    });

    test("#11468: a probe's vCenter that stops sending vSphere's rates goes back to working them out", async () => {
      await ingest(
        withVSphereSwapRates(
          recordedExportWith({
            secondsLater: 0,
            swappedMiB: { DC0_H0_VM1: 4 },
          }),
          { DC0_H0_VM1: { out: 0, in: 0 } },
        ),
      );
      expect(await swapRateSourceOf("DC0_H0_VM1")).toBe(
        VMwareSwapRateSource.VSphere,
      );

      await ingest(
        recordedExportWith({
          secondsLater: 120,
          swappedMiB: { DC0_H0_VM1: 12 },
        }),
      );
      expect(await swapRateSourceOf("DC0_H0_VM1")).toBe(
        VMwareSwapRateSource.Derived,
      );
      expect(
        (await virtualMachines()).get("DC0_H0_VM1")!.memorySwapOutBytesPerSecond,
      ).toBeCloseTo((8 * 1024 * 1024) / 120, 3);
    });

    test("the extractor's entities for the recorded export are what Inventory holds", async () => {
      await ingest(recordedExport());

      const keys: Set<string> = new Set<string>();
      for (const resourceMetrics of recordedExport()[
        "resourceMetrics"
      ] as Array<JSONObject>) {
        for (const entity of EntityExtractor.extractEntities({
          projectId: projectId.toString(),
          attributes: attributesOf(resourceMetrics),
        }) as Array<ExtractedEntity>) {
          keys.add(`${entity.entityType}:${entity.entityKey}`);
        }
      }
      const rows: Array<InventoryRow> = await database.query(
        `SELECT "entityType", "entityKey", "displayName" FROM "InventoryItem" WHERE "projectId" = $1`,
        [projectId.toString()],
      );
      expect(
        rows
          .map((row: InventoryRow): string => {
            return `${row.entityType}:${row.entityKey}`;
          })
          .sort(),
      ).toEqual(Array.from(keys).sort());
    });
  },
);
