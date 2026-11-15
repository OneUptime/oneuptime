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
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DataStoreService from "../../../Server/Services/DataStoreService";
import OpenStackCloudCheckService from "../../../Server/Services/OpenStackCloudCheckService";
import OpenStackCloudService from "../../../Server/Services/OpenStackCloudService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import { claimDueTableHealthStoresForProbe } from "../../../Server/Utils/DataObservability/DataObservabilityProbeClaim";
import { claimDueDataStoresForProbe } from "../../../Server/Utils/DataSecurity/DataSecurityProbeClaim";
import Encryption from "../../../Server/Utils/Encryption";
import logger from "../../../Server/Utils/Logger";
import OpenStackCheckStore, {
  OpenStackCheckKind,
  OpenStackCheckService,
} from "../../../Server/Utils/OpenStack/OpenStackCheckStore";
import OpenStackProbeCollectionStore from "../../../Server/Utils/OpenStack/OpenStackProbeCollectionStore";
import {
  SET_ASIDE_FOR_MINUTES,
  SET_ASIDE_PER_CLAIM,
  SET_ASIDE_ROUNDS_PER_CLAIM,
  SET_ASIDE_SPREAD_IN_MINUTES,
} from "../../../Server/Utils/Probe/ClaimSetAside";
import VMwareVCenterConnection from "../../../Server/Utils/VMware/VMwareVCenterConnection";
import { holdRow } from "../TestingUtils/Postgres/ClaimRowLocks";
import { Gray500 } from "../../../Types/BrandColors";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import VMwareCollectionMethod from "../../../Types/VMware/VMwareCollectionMethod";
import type { SpyInstance } from "jest-mock";
import { DataSource, QueryRunner } from "typeorm";

/*
 * THE SET-ASIDE OF THE PROBES' COLLECTION AND SCAN CLAIMS, ON POSTGRES
 * (OneUptime issue #7919).
 *
 * A probe's claims of its vCenters, OpenStack clouds and checks, and the
 * data stores whose tables it collects or whose content it scans, moved
 * only the rows they handed out. A row due but not claimable kept its old
 * due time, at the head of the probe's range, and every claim read it
 * again. Now each claim reads `due <= now` in the order of a (probe, due)
 * index, and after it the rows it stepped over are set aside for a quarter
 * of an hour plus a spread (Utils/Probe/ClaimSetAside), judged by the very
 * rule the claim keeps rows by.
 *
 * For each claim this runs: an unclaimable due row stops being due after a
 * claim; a claimable one is never set aside; a row with no due time is made
 * due; a row another writer holds is skipped; making a row claimable brings
 * it back at once, and wins a race with a set-aside in flight; and EXPLAIN
 * shows each claim's ordered read served by an index, with no sort over the
 * probe's rows. ProbeCollectionClaimSetAside pins the statements' text.
 *
 * Opt in with RUN_POSTGRES_PROBE_COLLECTION_SET_ASIDE_TESTS=true against a
 * Postgres migrated to the current head (the indexes the reads need come
 * from AddProbeCollectionClaimIndexes). The tables' STRUCTURE, indexes
 * included, is cloned into a unique schema (search_path holds only that
 * schema), and dropped afterwards. Credentials come from DATABASE_USERNAME
 * / DATABASE_PASSWORD, the database from
 * PROBE_COLLECTION_SET_ASIDE_TEST_DATABASE_NAME or DATABASE_NAME, the
 * endpoint from PROBE_COLLECTION_SET_ASIDE_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROBE_COLLECTION_SET_ASIDE_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that blocks instead of skipping a locked row fails, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const TABLES: Array<string> = [
  "Project",
  "Probe",
  "DataSecuritySetting",
  "DataStore",
  "VMwareVCenter",
  "OpenStackCloud",
  "OpenStackCloudCheck",
];

const DASHES: RegExp = /-/g;

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

interface PlanNode {
  "Node Type": string;
  "Index Name"?: string;
  "Relation Name"?: string;
  "Subplan Name"?: string;
  "CTE Name"?: string;
  Plans?: Array<PlanNode>;
}

// Every node of a plan, depth first.
function nodesOf(node: PlanNode): Array<PlanNode> {
  return [
    node,
    ...(node.Plans || []).flatMap((child: PlanNode): Array<PlanNode> => {
      return nodesOf(child);
    }),
  ];
}

// The plan of one CTE of a statement's plan, or null where it was folded in.
function cteOrNull(plan: PlanNode, name: string): PlanNode | null {
  return (
    nodesOf(plan).find((node: PlanNode): boolean => {
      return node["Subplan Name"] === `CTE ${name}`;
    }) || null
  );
}

function cteOf(plan: PlanNode, name: string): PlanNode {
  const cte: PlanNode | null = cteOrNull(plan, name);

  expect(cte).not.toBeNull();

  return cte!;
}

describePostgres(
  "the probes' collection and scan claims set aside what they step over, on Postgres",
  () => {
    const schema: string = `claim_set_aside_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;
    let database: DataSource;

    const projectId: ObjectID = ObjectID.generate();
    const probeId: ObjectID = ObjectID.generate();
    // Another project, with a probe of its own, whose rows are never this probe's.
    const otherProjectId: ObjectID = ObjectID.generate();
    const otherProbeId: ObjectID = ObjectID.generate();

    let count: number = 0;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PROBE_COLLECTION_SET_ASIDE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["PROBE_COLLECTION_SET_ASIDE_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PROBE_COLLECTION_SET_ASIDE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // A fixture names only what a statement reads; ids stay NOT NULL.
      const columns: Array<{ table_name: string; column_name: string }> =
        await database.query(
          `SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = $1 AND is_nullable = 'NO' AND column_name <> '_id'`,
          [schema],
        );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
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
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      for (const table of [...TABLES].reverse()) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      await insertProject(projectId);
      await insertProject(otherProjectId);
      await insertProbe(probeId, projectId);
      await insertProbe(otherProbeId, otherProjectId);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function insertProject(id: ObjectID): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "isBlocked", "isSampleProject")
         VALUES ($1, $2, false, false)`,
        [id.toString(), `Project ${id.toString()}`],
      );
    }

    async function insertProbe(id: ObjectID, project: ObjectID): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."Probe" ("_id", "projectId", "name", "isGlobalProbe")
         VALUES ($1, $2, $3, false)`,
        [id.toString(), project.toString(), `Probe ${id.toString()}`],
      );
    }

    async function readDue(
      table: string,
      column: string,
      id: ObjectID,
    ): Promise<Date | null> {
      const rows: Array<Record<string, Date | null>> = await database.query(
        `SELECT "${column}" AS "due" FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]!["due"] || null;
    }

    async function insertVCenter(data: {
      claimable: boolean;
      due: Date | null;
      probe?: ObjectID;
      project?: ObjectID;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      count++;

      await database.query(
        `INSERT INTO "${schema}"."VMwareVCenter"
          ("_id", "projectId", "name", "slug", "collectionMethod", "vcenterUrl", "vcenterUsername",
           "vcenterPassword", "isVCenterPasswordSet", "collectionProbeId", "collectionIntervalInMinutes",
           "nextCollectionAt", "collectionSettingsVersion", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, $4, $5, $6, 'oneuptime@vsphere.local', $7, true, $8, 5, $9, 0, now(), now(), 1)`,
        [
          id.toString(),
          (data.project || projectId).toString(),
          `vCenter ${count}`,
          `vcenter-${count}-${id.toString().substring(0, 8)}`,
          // Not claimable: collected by the VMware agent, as the switch leaves it.
          data.claimable
            ? VMwareCollectionMethod.Probe
            : VMwareCollectionMethod.Agent,
          `https://vcsa-${count}.example.com`,
          await Encryption.encrypt(`secret-${count}`),
          (data.probe || probeId).toString(),
          data.due,
        ],
      );

      return id;
    }

    async function insertCloud(data: {
      claimable: boolean;
      due: Date | null;
      probe?: ObjectID;
      project?: ObjectID;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      count++;

      await database.query(
        `INSERT INTO "${schema}"."OpenStackCloud"
          ("_id", "projectId", "name", "slug", "collectionMethod", "authUrl", "endpointInterface",
           "credentialKind", "applicationCredentialId", "credentialSecret", "isCredentialSet", "isArchived",
           "collectionProbeId", "collectionIntervalInMinutes", "nextCollectionAt", "collectionSettingsVersion",
           "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, $4, $5, 'https://keystone.example.com:5000', 'public',
                 'applicationCredential', 'the-clouds', $6, true, $7, $8, 5, $9, 0, now(), now(), 1)`,
        [
          id.toString(),
          (data.project || projectId).toString(),
          `Cloud ${count}`,
          `cloud-${count}-${id.toString().substring(0, 8)}`,
          OpenStackCollectionMethod.Probe,
          await Encryption.encrypt("the-clouds-secret"),
          // Not claimable: archived.
          !data.claimable,
          (data.probe || probeId).toString(),
          data.due,
        ],
      );

      return id;
    }

    /*
     * A check of a cloud this probe collects. `ownProbe`: it names a probe
     * of its own; otherwise it runs on its cloud's.
     */
    async function insertCheck(data: {
      kind: OpenStackCheckKind;
      claimable: boolean;
      due: Date | null;
      ownProbe?: ObjectID | null;
      cloudProbe?: ObjectID;
    }): Promise<ObjectID> {
      const cloud: ObjectID = await insertCloud({
        claimable: true,
        due: minutesFromNow(60),
        probe: data.cloudProbe || probeId,
      });
      const id: ObjectID = ObjectID.generate();
      const isOn: boolean = data.claimable;

      await database.query(
        `INSERT INTO "${schema}"."OpenStackCloudCheck"
          ("_id", "projectId", "openStackCloudId", "probeId",
           "isApiCheckEnabled", "apiCheckIntervalInMinutes", "nextApiCheckAt",
           "isLifecycleCheckEnabled", "lifecycleCheckIntervalInMinutes", "nextLifecycleCheckAt",
           "isSweepPending", "settingsVersion", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7, 30, $8, false, 0, now(), now(), 1)`,
        [
          id.toString(),
          projectId.toString(),
          cloud.toString(),
          data.ownProbe === undefined
            ? probeId.toString()
            : data.ownProbe
              ? data.ownProbe.toString()
              : null,
          // Not claimable: that kind turned off.
          data.kind === "api" ? isOn : false,
          data.kind === "api" ? data.due : minutesFromNow(60),
          data.kind === "lifecycle" ? isOn : false,
          data.kind === "lifecycle" ? data.due : minutesFromNow(60),
        ],
      );

      return id;
    }

    async function insertStore(data: {
      dueColumn: "nextContentScanAt" | "nextTableHealthCollectionAt";
      claimable: boolean;
      due: Date | null;
      probe?: ObjectID;
      project?: ObjectID;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      count++;
      const isContentScan: boolean = data.dueColumn === "nextContentScanAt";

      await database.query(
        `INSERT INTO "${schema}"."DataStore"
          ("_id", "projectId", "name", "storeKey", "kind", "provider", "scanProbeId", "probeConnectionVariable",
           "isContentScanEnabled", "isTableHealthEnabled", "isArchived", "nextContentScanAt",
           "nextTableHealthCollectionAt", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ORDERS_DATABASE_URL', $8, $9, false, $10, $11, now(), now(), 1)`,
        [
          id.toString(),
          (data.project || projectId).toString(),
          `Store ${count}`,
          `manual:${id.toString()}`,
          DataStoreKind.PostgreSql,
          DataStoreProvider.SelfManaged,
          (data.probe || probeId).toString(),
          // Not claimable: that collection switched off.
          isContentScan ? data.claimable : true,
          isContentScan ? true : data.claimable,
          isContentScan ? data.due : minutesFromNow(60),
          isContentScan ? minutesFromNow(60) : data.due,
        ],
      );

      return id;
    }

    /*
     * A check claim, through the store, answering the ids it claimed: what
     * it reads back by id is what it handed out.
     */
    async function claimChecks(
      kind: OpenStackCheckKind,
      limit: number,
    ): Promise<Array<string>> {
      const claimed: Array<string> = [];
      const service: OpenStackCheckService = {
        getRepository: (): never => {
          return OpenStackCloudCheckService.getRepository() as never;
        },
        // The claimed ids, as readClaimed asks for them (QueryHelper.any).
        findBy: async (options: {
          query: Record<string, unknown>;
        }): Promise<Array<never>> => {
          const bound: Record<string, unknown> =
            (
              options.query["_id"] as {
                objectLiteralParameters?: Record<string, unknown>;
              }
            )?.objectLiteralParameters || {};

          for (const ids of Object.values(bound)) {
            for (const id of Array.isArray(ids) ? ids : []) {
              claimed.push(String(id));
            }
          }

          return [];
        },
        findOneById: async (): Promise<null> => {
          return null;
        },
        updateColumnsByIdWithoutHooks: async (): Promise<void> => {
          return undefined;
        },
      };

      const options: {
        probeId: ObjectID;
        runningIds: Array<string>;
        limit: number;
      } = { probeId: probeId, runningIds: [], limit: limit };

      if (kind === "api") {
        await OpenStackCheckStore.claimApiChecks(service, options);
      } else {
        await OpenStackCheckStore.claimLifecycleChecks(service, options);
      }

      return claimed;
    }

    interface ClaimKind {
      name: string;
      table: string;
      dueColumn: string;
      insert: (data: {
        claimable: boolean;
        due: Date | null;
      }) => Promise<ObjectID>;
      claim: (limit: number) => Promise<Array<string>>;
      // The write that makes it claimable again, as the product makes it.
      makeClaimable: (id: ObjectID) => Promise<void>;
      // The service each claim's statements run on, for EXPLAIN.
      service: { getRepository: () => unknown };
      // The index its claim's ordered read is a range of: its columns.
      indexColumns: string;
      // The column that names the probe a row is claimed by.
      probeColumn: string;
      // The claim's locking CTE that reads the probe's own rows.
      readCte: string;
      runClaimForPlan: () => Promise<void>;
    }

    function checkKind(kind: OpenStackCheckKind): ClaimKind {
      const dueColumn: string = OpenStackCheckStore.getDueColumn(kind);

      return {
        name: `OpenStack ${kind} check`,
        table: "OpenStackCloudCheck",
        dueColumn: dueColumn,
        insert: (data: {
          claimable: boolean;
          due: Date | null;
        }): Promise<ObjectID> => {
          return insertCheck({ kind: kind, ...data });
        },
        claim: (limit: number): Promise<Array<string>> => {
          return claimChecks(kind, limit);
        },
        // Turned back on, as OpenStackCheckSettings writes it: due at once.
        makeClaimable: async (id: ObjectID): Promise<void> => {
          await database.query(
            `UPDATE "${schema}"."OpenStackCloudCheck"
             SET "${kind === "api" ? "isApiCheckEnabled" : "isLifecycleCheckEnabled"}" = true,
                 "${dueColumn}" = now()
             WHERE "_id" = $1`,
            [id.toString()],
          );
        },
        service: OpenStackCloudCheckService,
        indexColumns: `("probeId", "${dueColumn}")`,
        probeColumn: "probeId",
        readCte: "ownProbeDue",
        runClaimForPlan: async (): Promise<void> => {
          await claimChecks(kind, 10);
        },
      };
    }

    function storeKind(
      dueColumn: "nextContentScanAt" | "nextTableHealthCollectionAt",
    ): ClaimKind {
      const isContentScan: boolean = dueColumn === "nextContentScanAt";
      const claim: (data: {
        probeId: ObjectID;
        limit: number;
      }) => Promise<Array<{ _id: string }>> = isContentScan
        ? claimDueDataStoresForProbe
        : claimDueTableHealthStoresForProbe;

      return {
        name: isContentScan
          ? "Data Security content scan"
          : "Data Observability table health",
        table: "DataStore",
        dueColumn: dueColumn,
        insert: (data: {
          claimable: boolean;
          due: Date | null;
        }): Promise<ObjectID> => {
          return insertStore({ dueColumn: dueColumn, ...data });
        },
        claim: async (limit: number): Promise<Array<string>> => {
          return (await claim({ probeId: probeId, limit: limit })).map(
            (row: { _id: string }): string => {
              return row._id;
            },
          );
        },
        // Switched back on, then DataStoreService's hook makes it due.
        makeClaimable: async (id: ObjectID): Promise<void> => {
          await database.query(
            `UPDATE "${schema}"."DataStore" SET "${isContentScan ? "isContentScanEnabled" : "isTableHealthEnabled"}" = true WHERE "_id" = $1`,
            [id.toString()],
          );
          await DataStoreService.makeDueNow({
            dataStoreIds: [id],
            dueColumns: [dueColumn],
          });
        },
        service: DataStoreService,
        indexColumns: `("scanProbeId", "${dueColumn}")`,
        probeColumn: "scanProbeId",
        readCte: "due",
        runClaimForPlan: async (): Promise<void> => {
          await claim({ probeId: probeId, limit: 10 });
        },
      };
    }

    const KINDS: Array<ClaimKind> = [
      {
        name: "VMware collection",
        table: "VMwareVCenter",
        dueColumn: "nextCollectionAt",
        insert: insertVCenter,
        claim: async (limit: number): Promise<Array<string>> => {
          return (
            await VMwareVCenterService.claimForCollection({
              probeId: probeId,
              runningVMwareVCenterIds: [],
              limit: limit,
            })
          ).map((job: { vmwareVCenterId: string }): string => {
            return job.vmwareVCenterId;
          });
        },
        // Switched back to the probe: the settings write's own step makes it due.
        makeClaimable: async (id: ObjectID): Promise<void> => {
          await database.query(
            `UPDATE "${schema}"."VMwareVCenter" SET "collectionMethod" = $2 WHERE "_id" = $1`,
            [id.toString(), VMwareCollectionMethod.Probe],
          );
          await VMwareVCenterConnection.afterWrite({
            change: {
              vmwareVCenterId: id,
              projectId: projectId,
              isConnectionChanged: true,
              isCredentialChanged: false,
              isPasswordSet: null,
              isSwitchedToAgent: false,
              feedLines: [],
              feedColor: Gray500,
            },
            writeServerColumns: async (write: {
              vmwareVCenterId: ObjectID;
              values: Record<string, unknown>;
              bumpSettingsVersion: boolean;
            }): Promise<void> => {
              await (
                VMwareVCenterService as unknown as {
                  writeConnectionServerColumns: (
                    data: typeof write,
                  ) => Promise<void>;
                }
              ).writeConnectionServerColumns(write);
            },
          });
        },
        service: VMwareVCenterService,
        indexColumns: `("collectionProbeId", "nextCollectionAt")`,
        probeColumn: "collectionProbeId",
        readCte: "due",
        runClaimForPlan: async (): Promise<void> => {
          await VMwareVCenterService.claimForCollection({
            probeId: probeId,
            runningVMwareVCenterIds: [],
            limit: 10,
          });
        },
      },
      {
        name: "OpenStack collection",
        table: "OpenStackCloud",
        dueColumn: "nextCollectionAt",
        insert: insertCloud,
        claim: async (limit: number): Promise<Array<string>> => {
          return (
            await OpenStackCloudService.claimForCollection({
              probeId: probeId,
              runningOpenStackCloudIds: [],
              limit: limit,
            })
          ).map((job: { openStackCloudId: string }): string => {
            return job.openStackCloudId;
          });
        },
        // Unarchived: OpenStackCloudService's hook makes it due.
        makeClaimable: async (id: ObjectID): Promise<void> => {
          await database.query(
            `UPDATE "${schema}"."OpenStackCloud" SET "isArchived" = false WHERE "_id" = $1`,
            [id.toString()],
          );
          await OpenStackProbeCollectionStore.makeDueNow(
            OpenStackCloudService,
            [id],
          );
        },
        service: OpenStackCloudService,
        indexColumns: `("collectionProbeId", "nextCollectionAt")`,
        probeColumn: "collectionProbeId",
        readCte: "due",
        runClaimForPlan: async (): Promise<void> => {
          await OpenStackCloudService.claimForCollection({
            probeId: probeId,
            runningOpenStackCloudIds: [],
            limit: 10,
          });
        },
      },
      checkKind("api"),
      checkKind("lifecycle"),
      storeKind("nextContentScanAt"),
      storeKind("nextTableHealthCollectionAt"),
    ];

    describe.each(KINDS)("the $name claim", (kind: ClaimKind) => {
      function due(id: ObjectID): Promise<Date | null> {
        return readDue(kind.table, kind.dueColumn, id);
      }

      async function expectSetAside(
        id: ObjectID,
        since: number,
      ): Promise<void> {
        const next: number = (await due(id))!.getTime();

        expect(next).toBeGreaterThanOrEqual(
          since + SET_ASIDE_FOR_MINUTES * 60_000,
        );
        expect(next).toBeLessThanOrEqual(
          Date.now() +
            (SET_ASIDE_FOR_MINUTES + SET_ASIDE_SPREAD_IN_MINUTES) * 60_000,
        );
      }

      test("a due row nothing may claim stops being due once a claim has stepped over it; the claimable one is handed out", async () => {
        const stuck: ObjectID = await kind.insert({
          claimable: false,
          due: minutesFromNow(-30),
        });
        const claimable: ObjectID = await kind.insert({
          claimable: true,
          due: minutesFromNow(-5),
        });

        const claimedAt: number = Date.now();

        expect(await kind.claim(10)).toEqual([claimable.toString()]);
        await expectSetAside(stuck, claimedAt);

        // The next claim does not step over it again: it is not due.
        expect(await kind.claim(10)).toEqual([]);
        expect((await due(stuck))!.getTime()).toBeGreaterThan(Date.now());
      });

      test("a claimable row the claim had no room for is left due, never set aside", async () => {
        const first: ObjectID = await kind.insert({
          claimable: true,
          due: minutesFromNow(-3),
        });
        const second: ObjectID = await kind.insert({
          claimable: true,
          due: minutesFromNow(-2),
        });
        const secondDue: Date | null = await due(second);

        expect(await kind.claim(1)).toEqual([first.toString()]);
        expect(await due(second)).toEqual(secondDue);
        expect(await kind.claim(1)).toEqual([second.toString()]);
      });

      test("a row not due yet is left alone", async () => {
        const notDue: ObjectID = await kind.insert({
          claimable: false,
          due: minutesFromNow(30),
        });
        const notDueAt: Date | null = await due(notDue);

        await kind.claim(10);

        expect(await due(notDue)).toEqual(notDueAt);
      });

      test("a row with no due time is made due, and the next claim hands it out, or sets it aside", async () => {
        const unscheduled: ObjectID = await kind.insert({
          claimable: true,
          due: null,
        });
        const unscheduledStuck: ObjectID = await kind.insert({
          claimable: false,
          due: null,
        });

        // Never read by the claim, which reads `due <= now`: made due after it.
        expect(await kind.claim(10)).toEqual([]);
        expect((await due(unscheduled))!.getTime()).toBeLessThanOrEqual(
          Date.now(),
        );
        expect((await due(unscheduledStuck))!.getTime()).toBeLessThanOrEqual(
          Date.now(),
        );

        const claimedAt: number = Date.now();

        expect(await kind.claim(10)).toEqual([unscheduled.toString()]);
        await expectSetAside(unscheduledStuck, claimedAt);
      });

      test("the set-aside skips a row another writer holds, instead of waiting for it; the next claim sets it aside", async () => {
        const held: ObjectID = await kind.insert({
          claimable: false,
          due: minutesFromNow(-10),
        });
        const heldDue: Date | null = await due(held);

        const holder: { release: () => Promise<void> } = await holdRow({
          database: database,
          schema: schema,
          table: kind.table,
          id: held,
        });

        try {
          // A set-aside that waited would run past lock_timeout and be logged.
          const errors: SpyInstance<typeof logger.error> = jest
            .spyOn(logger, "error")
            .mockImplementation(() => {
              return undefined as never;
            });

          expect(await kind.claim(10)).toEqual([]);
          expect(errors).not.toHaveBeenCalled();
          expect(await due(held)).toEqual(heldDue);
        } finally {
          await holder.release();
        }

        const claimedAt: number = Date.now();
        await kind.claim(10);
        await expectSetAside(held, claimedAt);
      });

      test("making a row claimable again brings it back for the next claim at once", async () => {
        const stuck: ObjectID = await kind.insert({
          claimable: false,
          due: minutesFromNow(-30),
        });

        await kind.claim(10);
        expect((await due(stuck))!.getTime()).toBeGreaterThan(Date.now());

        await kind.makeClaimable(stuck);

        expect((await due(stuck))!.getTime()).toBeLessThanOrEqual(Date.now());
        expect(await kind.claim(10)).toEqual([stuck.toString()]);
      });

      test("EXPLAIN: the claim reads the probe's due rows through its (probe, due) index, in the index's order, and nothing reads the whole table", async () => {
        // Enough rows, over enough probes, that a scan of them all costs what it is.
        await seed(kind);

        // The first claims set the backlog aside; then what autovacuum does.
        for (let claim: number = 0; claim < 3; claim++) {
          await kind.claim(10);
        }

        for (const table of TABLES) {
          await database.query(`VACUUM ANALYZE "${schema}"."${table}"`);
        }

        // As the planner chooses: through an index led by the probe.
        const plans: Array<PlanNode> = await plansOf(kind, {
          isSortOff: false,
        });
        const readIndexes: Array<string> = indexesReading(
          cteOf(plans[0]!, kind.readCte),
          kind.table,
        );

        expect(readIndexes.length).toBeGreaterThan(0);

        const readDefinitions: Array<string> = await Promise.all(
          readIndexes.map(indexDefinitionOf),
        );

        expect(
          readDefinitions.some((definition: string): boolean => {
            return definition.includes(`USING btree ("${kind.probeColumn}"`);
          }),
        ).toBe(true);

        // Neither the claim nor its set-aside reads the whole table.
        for (const plan of plans) {
          expect(
            nodesOf(plan).some((node: PlanNode): boolean => {
              return (
                node["Node Type"] === "Seq Scan" &&
                node["Relation Name"] === kind.table
              );
            }),
          ).toBe(false);
        }

        /*
         * And the order is the index's: with sorting off, the read walks the
         * (probe, due) index in its own order and stops at the limit. With
         * NULLS FIRST no btree could give that order, and the check claim's
         * COALESCE could not use an index at all.
         */
        const ordered: PlanNode = cteOf(
          (await plansOf(kind, { isSortOff: true }))[0]!,
          kind.readCte,
        );

        expect(
          nodesOf(ordered).some((node: PlanNode): boolean => {
            return node["Node Type"] === "Sort";
          }),
        ).toBe(false);

        const orderedScans: Array<PlanNode> = nodesOf(ordered).filter(
          (node: PlanNode): boolean => {
            return (
              (node["Node Type"] === "Index Scan" ||
                node["Node Type"] === "Index Only Scan") &&
              node["Relation Name"] === kind.table
            );
          },
        );

        expect(orderedScans.length).toBeGreaterThan(0);
        expect(
          await indexDefinitionOf(orderedScans[0]!["Index Name"]!),
        ).toContain(kind.indexColumns);
      });
    });

    /*
     * The race a write that makes a row claimable must win: a claim's
     * set-aside of it, in flight. The write matches the row as it was,
     * waits for the set-aside's lock, and writes over it - LEAST over every
     * row it names, with no filter on a future due time, which would have
     * read the row before the set-aside committed and left it set aside.
     */
    describe("bringing a row back waits for a set-aside of it in flight, and wins", () => {
      async function setAsideInFlight(
        table: string,
        column: string,
        id: ObjectID,
      ): Promise<QueryRunner> {
        const setAside: QueryRunner = database.createQueryRunner();
        await setAside.connect();
        await setAside.startTransaction();
        await setAside.query(
          `UPDATE "${schema}"."${table}" SET "${column}" = now() + INTERVAL '17 minutes' WHERE "_id" = $1`,
          [id.toString()],
        );

        return setAside;
      }

      test("an OpenStack cloud unarchived", async () => {
        const cloud: ObjectID = await insertCloud({
          claimable: true,
          due: minutesFromNow(-10),
        });
        const setAside: QueryRunner = await setAsideInFlight(
          "OpenStackCloud",
          "nextCollectionAt",
          cloud,
        );

        let isSettled: boolean = false;
        const bringBack: Promise<void> =
          OpenStackProbeCollectionStore.makeDueNow(OpenStackCloudService, [
            cloud,
          ]).then(() => {
            isSettled = true;
          });

        // It waits for the set-aside...
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 300);
        });
        expect(isSettled).toBe(false);

        await setAside.commitTransaction();
        await setAside.release();
        await bringBack;

        // ...and wins: the set-aside committed first, and was written over.
        expect(
          (await readDue(
            "OpenStackCloud",
            "nextCollectionAt",
            cloud,
          ))!.getTime(),
        ).toBeLessThanOrEqual(Date.now());
      });

      test("a data store scanned again", async () => {
        const store: ObjectID = await insertStore({
          dueColumn: "nextContentScanAt",
          claimable: true,
          due: minutesFromNow(-10),
        });
        const setAside: QueryRunner = await setAsideInFlight(
          "DataStore",
          "nextContentScanAt",
          store,
        );

        let isSettled: boolean = false;
        const bringBack: Promise<void> = DataStoreService.makeDueNow({
          dataStoreIds: [store],
          dueColumns: ["nextContentScanAt"],
        }).then(() => {
          isSettled = true;
        });

        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 300);
        });
        expect(isSettled).toBe(false);

        await setAside.commitTransaction();
        await setAside.release();
        await bringBack;

        expect(
          (await readDue("DataStore", "nextContentScanAt", store))!.getTime(),
        ).toBeLessThanOrEqual(Date.now());
      });

      test("a project turning content scanning back on brings back its probe stores, and no other's", async () => {
        const store: ObjectID = await insertStore({
          dueColumn: "nextContentScanAt",
          claimable: true,
          due: minutesFromNow(17),
        });
        const otherProjects: ObjectID = await insertStore({
          dueColumn: "nextContentScanAt",
          claimable: true,
          due: minutesFromNow(17),
          project: otherProjectId,
          probe: otherProbeId,
        });

        await DataStoreService.makeDueNowForProjects({
          projectIds: [projectId],
          dueColumns: ["nextContentScanAt"],
        });

        expect(
          (await readDue("DataStore", "nextContentScanAt", store))!.getTime(),
        ).toBeLessThanOrEqual(Date.now());
        expect(
          (await readDue(
            "DataStore",
            "nextContentScanAt",
            otherProjects,
          ))!.getTime(),
        ).toBeGreaterThan(Date.now());
      });

      test("an unarchived cloud's checks, both kinds, by their cloud", async () => {
        const check: ObjectID = await insertCheck({
          kind: "api",
          claimable: true,
          due: minutesFromNow(17),
        });
        const cloud: Array<{ openStackCloudId: string }> = await database.query(
          `SELECT "openStackCloudId" FROM "${schema}"."OpenStackCloudCheck" WHERE "_id" = $1`,
          [check.toString()],
        );

        await OpenStackCheckStore.makeDueNow(OpenStackCloudService, {
          ids: [new ObjectID(cloud[0]!.openStackCloudId)],
          byCloud: true,
        });

        for (const column of ["nextApiCheckAt", "nextLifecycleCheckAt"]) {
          expect(
            (await readDue("OpenStackCloudCheck", column, check))!.getTime(),
          ).toBeLessThanOrEqual(Date.now());
        }
      });
    });

    describe("bounds", () => {
      test("a round sets aside at most SET_ASIDE_PER_CLAIM rows and a claim SET_ASIDE_ROUNDS_PER_CLAIM rounds; the next claim the rest", async () => {
        const stuck: number =
          SET_ASIDE_PER_CLAIM * SET_ASIDE_ROUNDS_PER_CLAIM + 3;

        await database.query(
          `INSERT INTO "${schema}"."VMwareVCenter"
            ("_id", "projectId", "name", "slug", "collectionMethod", "collectionProbeId",
             "nextCollectionAt", "isVCenterPasswordSet", "createdAt", "updatedAt", "version")
           SELECT gen_random_uuid(), $1, 'bulk ' || n, 'bulk-' || n, $2, $3,
                  now() - (n || ' seconds')::interval, true, now(), now(), 1
           FROM generate_series(1, $4) AS n`,
          [
            projectId.toString(),
            VMwareCollectionMethod.Agent,
            probeId.toString(),
            stuck,
          ],
        );

        const countDue: () => Promise<number> = async (): Promise<number> => {
          const rows: Array<{ count: number }> = await database.query(
            `SELECT COUNT(*)::int AS "count" FROM "${schema}"."VMwareVCenter" WHERE "nextCollectionAt" <= now()`,
          );

          return rows[0]!.count;
        };

        await VMwareVCenterService.claimForCollection({
          probeId: probeId,
          runningVMwareVCenterIds: [],
          limit: 10,
        });

        expect(await countDue()).toBe(3);

        await VMwareVCenterService.claimForCollection({
          probeId: probeId,
          runningVMwareVCenterIds: [],
          limit: 10,
        });

        expect(await countDue()).toBe(0);
      });
    });

    /*
     * Rows for a plan to be read over: 40 probes of 40 projects, 100 rows
     * each, a third of them unclaimable, due over the last day - and the
     * statistics read, so the planner prices each path as it is.
     */
    async function seed(kind: ClaimKind): Promise<void> {
      const owners: Array<{ probe: ObjectID; project: ObjectID }> = [
        { probe: probeId, project: projectId },
      ];

      for (let i: number = 0; i < 39; i++) {
        const project: ObjectID = ObjectID.generate();
        const probe: ObjectID = ObjectID.generate();

        await insertProject(project);
        await insertProbe(probe, project);
        owners.push({ probe: probe, project: project });
      }

      for (const owner of owners) {
        await database.query(seedStatement(kind), [
          owner.probe.toString(),
          owner.project.toString(),
          ...seedValues(kind),
        ]);
      }

      for (const table of TABLES) {
        await database.query(`ANALYZE "${schema}"."${table}"`);
      }
    }

    // The values a seed statement binds after the probe and the project.
    function seedValues(kind: ClaimKind): Array<unknown> {
      switch (kind.table) {
        case "VMwareVCenter":
          return [VMwareCollectionMethod.Agent, VMwareCollectionMethod.Probe];
        case "OpenStackCloud":
        case "OpenStackCloudCheck":
          return [OpenStackCollectionMethod.Probe];
        default:
          return [
            DataStoreKind.PostgreSql,
            DataStoreProvider.SelfManaged,
            DataStoreProvider.Aws,
          ];
      }
    }

    function seedStatement(kind: ClaimKind): string {
      const dueOverTheLastDay: string = `now() - (n * 14 || ' minutes')::interval`;

      switch (kind.table) {
        case "VMwareVCenter":
          return `INSERT INTO "${schema}"."VMwareVCenter"
            ("_id", "projectId", "name", "slug", "collectionMethod", "collectionProbeId", "vcenterUrl",
             "vcenterUsername", "isVCenterPasswordSet", "nextCollectionAt", "createdAt", "updatedAt", "version")
            SELECT gen_random_uuid(), $2::uuid, 'seed ' || n, 'seed-' || n || '-' || $1::text,
                   CASE WHEN n % 3 = 0 THEN $3::text ELSE $4::text END, $1::uuid, 'https://vcsa.example.com',
                   'reader', true, ${dueOverTheLastDay}, now(), now(), 1
            FROM generate_series(1, 100) AS n`;
        case "OpenStackCloud":
          return `INSERT INTO "${schema}"."OpenStackCloud"
            ("_id", "projectId", "name", "slug", "collectionMethod", "collectionProbeId", "authUrl",
             "isCredentialSet", "isArchived", "nextCollectionAt", "createdAt", "updatedAt", "version")
            SELECT gen_random_uuid(), $2::uuid, 'seed ' || n, 'seed-' || n || '-' || $1::text, $3::text, $1::uuid,
                   'https://keystone.example.com', true, n % 3 = 0, ${dueOverTheLastDay}, now(), now(), 1
            FROM generate_series(1, 100) AS n`;
        case "OpenStackCloudCheck":
          return `WITH "clouds" AS (
              INSERT INTO "${schema}"."OpenStackCloud"
                ("_id", "projectId", "name", "slug", "collectionMethod", "collectionProbeId",
                 "isCredentialSet", "isArchived", "nextCollectionAt", "createdAt", "updatedAt", "version")
              SELECT gen_random_uuid(), $2::uuid, 'seed ' || n, 'seed-' || n || '-' || $1::text, $3::text, $1::uuid,
                     true, false, now() + INTERVAL '1 hour', now(), now(), 1
              FROM generate_series(1, 100) AS n
              RETURNING "_id"
            )
            INSERT INTO "${schema}"."OpenStackCloudCheck"
              ("_id", "projectId", "openStackCloudId", "probeId", "isApiCheckEnabled", "nextApiCheckAt",
               "isLifecycleCheckEnabled", "nextLifecycleCheckAt", "isSweepPending", "createdAt", "updatedAt", "version")
            SELECT gen_random_uuid(), $2::uuid, "clouds"."_id", $1::uuid, random() > 0.33,
                   now() - random() * INTERVAL '1 day', random() > 0.33, now() - random() * INTERVAL '1 day',
                   false, now(), now(), 1
            FROM "clouds"`;
        default:
          /*
           * The stores the probe scans, a third of them switched off for each
           * claim, and three times as many the project's cloud inventory found,
           * which no probe scans.
           */
          return `WITH "probeStores" AS (
              INSERT INTO "${schema}"."DataStore"
                ("_id", "projectId", "name", "storeKey", "kind", "provider", "scanProbeId", "probeConnectionVariable",
                 "isContentScanEnabled", "isTableHealthEnabled", "isArchived", "nextContentScanAt",
                 "nextTableHealthCollectionAt", "createdAt", "updatedAt", "version")
              SELECT gen_random_uuid(), $2::uuid, 'seed ' || n, 'seed:' || n || ':' || $1::text, $3::text, $4::text,
                     $1::uuid, 'ORDERS_DATABASE_URL', n % 3 <> 0, n % 3 <> 1, false, ${dueOverTheLastDay},
                     ${dueOverTheLastDay}, now(), now(), 1
              FROM generate_series(1, 100) AS n
              RETURNING "_id"
            )
            INSERT INTO "${schema}"."DataStore"
              ("_id", "projectId", "name", "storeKey", "kind", "provider", "isContentScanEnabled",
               "isTableHealthEnabled", "isArchived", "nextContentScanAt", "createdAt", "updatedAt", "version")
            SELECT gen_random_uuid(), $2::uuid, 'found ' || n, 'found:' || n || ':' || $1::text, $3::text, $5::text,
                   true, true, false, now() + (n || ' minutes')::interval, now(), now(), 1
            FROM generate_series(1, 300) AS n`;
      }
    }

    /*
     * The plans of the claim's statement and of its set-aside, not run: each
     * explained on a connection of its own, with sorting off if asked.
     */
    async function plansOf(
      kind: ClaimKind,
      options: { isSortOff: boolean },
    ): Promise<Array<PlanNode>> {
      const plans: Array<PlanNode> = [];
      const explainer: QueryRunner = database.createQueryRunner();
      await explainer.connect();
      await explainer.startTransaction();

      const repository: SpyInstance<() => unknown> = jest.spyOn(
        kind.service,
        "getRepository",
      );

      try {
        if (options.isSortOff) {
          await explainer.query("SET LOCAL enable_sort = off");
        }

        repository.mockReturnValue({
          manager: {
            query: async (
              sql: string,
              parameters: Array<unknown>,
            ): Promise<Array<unknown>> => {
              const explained: Array<{
                "QUERY PLAN": Array<{ Plan: PlanNode }>;
              }> = await explainer.query(
                `EXPLAIN (FORMAT JSON) ${sql}`,
                parameters,
              );

              plans.push(explained[0]!["QUERY PLAN"][0]!.Plan);

              return [];
            },
          },
        } as never);

        await kind.runClaimForPlan();
      } finally {
        repository.mockRestore();
        await explainer.rollbackTransaction();
        await explainer.release();
      }

      expect(plans.length).toBeGreaterThanOrEqual(2);

      return plans;
    }

    /*
     * The indexes a plan reads a table through: an index scan of it, or the
     * bitmap index scans under a bitmap heap scan of it.
     */
    function indexesReading(plan: PlanNode, table: string): Array<string> {
      const names: Array<string> = [];

      for (const node of nodesOf(plan)) {
        if (node["Relation Name"] !== table) {
          continue;
        }

        if (node["Index Name"]) {
          names.push(node["Index Name"]);
        }

        if (node["Node Type"] === "Bitmap Heap Scan") {
          for (const child of nodesOf(node)) {
            if (
              child["Node Type"] === "Bitmap Index Scan" &&
              child["Index Name"]
            ) {
              names.push(child["Index Name"]);
            }
          }
        }
      }

      return names;
    }

    async function indexDefinitionOf(name: string): Promise<string> {
      const rows: Array<{ indexdef: string }> = await database.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
        [schema, name],
      );

      expect(rows).toHaveLength(1);

      return rows[0]!.indexdef;
    }
  },
);
