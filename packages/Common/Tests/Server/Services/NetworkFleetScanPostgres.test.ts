import Entities from "../../../Models/DatabaseModels/Index";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import {
  DeviceFleetScan,
  readDeviceFleetScan,
  DEVICE_FLEET_SCAN_AGGREGATES,
  DEVICE_FLEET_SCAN_GROUP_COLUMNS,
  DEVICE_FLEET_SCAN_ORDER,
  DEVICE_FLEET_SUMMARY_AGGREGATES,
  DEVICE_HEALTH_AGGREGATES,
  DEVICE_HEALTH_GROUP_COLUMNS,
  DEVICE_HEALTH_GROUP_ORDER,
  DEVICE_HEALTH_NOW_PARAMETER,
  DEVICE_VENDOR_GROUP_COLUMN,
  DeviceHealthGroup,
  parseDeviceHealthGroup,
} from "../../../Server/Utils/NetworkDevice/DeviceHealthAggregation";
import {
  AggregateColumn,
  AggregateOrder,
  AggregateRow,
} from "../../../Server/Types/Database/AggregateBy";
import AggregateResultUtil from "../../../Server/Types/Database/AggregateResultUtil";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, SelectQueryBuilder } from "typeorm";

/*
 * THE FLEET, COUNTED ONCE, IS THE FLEET COUNTED FOUR TIMES.
 *
 * NetworkDeviceService.getFleetScan answers in one GROUP BY what four reads
 * answered: the summary strip's numbers (getFleetSummary), the health
 * buckets (getHealthGroups), the vendor breakdown (getVendorBreakdown) and
 * the count of devices whose SNMP walk fails (a countBy). Each is run here
 * as it was - the same select, group and order DatabaseService.aggregateBy
 * builds - beside the folded scan, over a fleet seeded to sit on every
 * fact the health rule reads (reachable, unreachable, never polled, stale
 * and fresh, dark ports, monitor-backed, stamped statuses), every vendor
 * spelling (blank, padded, missing, ties at the breakdown's cut), sites,
 * walk states, archived, deleted and another project's devices; and again
 * after an outage takes a quarter of the fleet down.
 *
 * Opt in with RUN_POSTGRES_NETWORK_FLEET_SCAN_TESTS=true against a database
 * the registered migrations have run on (NETWORK_FLEET_SCAN_TEST_DATABASE_
 * HOST, _PORT, _NAME): the table is copied from public into a schema of the
 * test's own, every row is synthetic, and the schema is dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_FLEET_SCAN_TESTS"] === "true"
    ? describe
    : describe.skip;

type Row = Record<string, unknown>;

const NOW: Date = new Date(Date.UTC(2026, 10, 14, 12, 0, 0));

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describePostgres(
  "the fleet scan against the reads it folds, on Postgres",
  () => {
    const schema: string = `fleet_scan_${ObjectID.generate().toString().split("-").join("")}`;
    let database: DataSource;
    let sequence: number = 0;

    const projectId: string = ObjectID.generate().toString();
    const otherProjectId: string = ObjectID.generate().toString();
    const statusIds: Array<string> = [
      ObjectID.generate().toString(),
      ObjectID.generate().toString(),
      ObjectID.generate().toString(),
    ];
    const siteIds: Array<string> = [
      ObjectID.generate().toString(),
      ObjectID.generate().toString(),
    ];

    async function requiredFillers(table: string): Promise<Row> {
      const columns: Array<{
        column_name: string;
        data_type: string;
        udt_name: string;
        character_maximum_length: number | null;
      }> = await database.query(
        `SELECT column_name, data_type, udt_name, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       AND is_nullable = 'NO' AND column_default IS NULL`,
        [schema, table],
      );
      const fillers: Row = {};

      for (const column of columns) {
        if (column.data_type === "uuid") {
          fillers[column.column_name] = ObjectID.generate().toString();
        } else if (
          column.data_type === "character varying" ||
          column.data_type === "text"
        ) {
          fillers[column.column_name] = `v${sequence++}`.slice(
            0,
            column.character_maximum_length || 100,
          );
        } else if (
          [
            "integer",
            "bigint",
            "numeric",
            "smallint",
            "double precision",
          ].includes(column.data_type)
        ) {
          fillers[column.column_name] = 0;
        } else if (column.data_type === "boolean") {
          fillers[column.column_name] = false;
        } else if (column.data_type.startsWith("timestamp")) {
          fillers[column.column_name] = NOW;
        } else if (
          column.data_type === "jsonb" ||
          column.data_type === "json"
        ) {
          fillers[column.column_name] = {};
        } else if (column.data_type === "USER-DEFINED") {
          const values: Array<{ value: string }> = await database.query(
            `SELECT unnest(enum_range(NULL::"${schema}"."${column.udt_name}"))::text AS value`,
          );
          fillers[column.column_name] = values[0]?.value;
        }
      }

      return fillers;
    }

    let fillers: Row | null = null;

    async function insertDevice(row: Row): Promise<void> {
      if (!fillers) {
        fillers = await requiredFillers("NetworkDevice");
      }

      sequence++;
      const values: Row = {
        ...fillers,
        _id: ObjectID.generate().toString(),
        version: 1,
        projectId: projectId,
        name: `device-${sequence}`,
        slug: `device-${sequence}`,
        hostname: `10.0.${Math.floor(sequence / 250)}.${sequence % 250}`,
        isArchived: false,
        ...row,
      };
      const columns: Array<string> = Object.keys(values);

      await database.query(
        `INSERT INTO "${schema}"."NetworkDevice" (${columns
          .map((column: string) => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number) => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string) => {
          const value: unknown = values[column];
          return value && typeof value === "object" && !(value instanceof Date)
            ? JSON.stringify(value)
            : value;
        }),
      );
    }

    /*
     * The read DatabaseService.aggregateBy builds for these columns: the
     * project's devices that are not archived (and not deleted), selected,
     * grouped and ordered as asked.
     */
    async function aggregate(data: {
      groupBy?: Array<AggregateColumn>;
      select: Array<AggregateColumn>;
      orderBy?: Array<AggregateOrder>;
      limit?: number;
    }): Promise<Array<AggregateRow>> {
      const builder: SelectQueryBuilder<NetworkDevice> = database.manager
        .createQueryBuilder(NetworkDevice, "NetworkDevice")
        .setFindOptions({
          where: { projectId: projectId, isArchived: false } as never,
        });
      const columns: Array<AggregateColumn> = [
        ...(data.groupBy || []),
        ...data.select,
      ];

      builder.select(columns[0]!.expression, columns[0]!.alias);

      for (const column of columns.slice(1)) {
        builder.addSelect(column.expression, column.alias);
      }

      for (const column of data.groupBy || []) {
        builder.addGroupBy(column.expression);
      }

      for (const order of data.orderBy || []) {
        builder.addOrderBy(
          order.expression,
          order.sortOrder === SortOrder.Ascending ? "ASC" : "DESC",
        );
      }

      if (data.limit !== undefined) {
        builder.limit(data.limit);
      }

      builder.setParameters({ [DEVICE_HEALTH_NOW_PARAMETER]: NOW });

      return (await builder.getRawMany()) as Array<AggregateRow>;
    }

    // What the four reads answered, each as its own method did.
    async function readSeparately(): Promise<DeviceFleetScan> {
      const summaryRow: AggregateRow | undefined = (
        await aggregate({ select: DEVICE_FLEET_SUMMARY_AGGREGATES })
      )[0];

      const healthGroups: Array<DeviceHealthGroup> = (
        await aggregate({
          groupBy: DEVICE_HEALTH_GROUP_COLUMNS,
          select: DEVICE_HEALTH_AGGREGATES,
          orderBy: DEVICE_HEALTH_GROUP_ORDER,
        })
      ).map(parseDeviceHealthGroup);

      const vendors: Array<{ vendor: string; count: number }> = (
        await aggregate({
          groupBy: [DEVICE_VENDOR_GROUP_COLUMN],
          select: [{ expression: "COUNT(*)", alias: "deviceCount" }],
          orderBy: [
            { expression: `"deviceCount"`, sortOrder: SortOrder.Descending },
            { expression: `"vendor"`, sortOrder: SortOrder.Ascending },
          ],
          limit: 6,
        })
      ).map((row: AggregateRow) => {
        return {
          vendor: AggregateResultUtil.toStringOrNull(row, "vendor") || "",
          count: AggregateResultUtil.toNumber(row, "deviceCount"),
        };
      });

      const snmpFailing: number = await database
        .getRepository(NetworkDevice)
        .count({
          where: {
            projectId: projectId,
            isArchived: false,
            isReachable: true,
            isSnmpReachable: false,
          } as never,
        });

      return {
        summary: {
          devicesUp: AggregateResultUtil.toNumber(summaryRow, "devicesUp"),
          devicesDown: AggregateResultUtil.toNumber(summaryRow, "devicesDown"),
          devicesPending: AggregateResultUtil.toNumber(
            summaryRow,
            "devicesPending",
          ),
          interfacesDown: AggregateResultUtil.toNumber(
            summaryRow,
            "interfacesDown",
          ),
          totalDevices: AggregateResultUtil.toNumber(
            summaryRow,
            "totalDevices",
          ),
          devicesWithoutSite: AggregateResultUtil.toNumber(
            summaryRow,
            "devicesWithoutSite",
          ),
        },
        healthGroups: healthGroups,
        vendors: vendors,
        snmpFailing: snmpFailing,
      };
    }

    async function readFolded(): Promise<DeviceFleetScan> {
      return readDeviceFleetScan(
        await aggregate({
          groupBy: DEVICE_FLEET_SCAN_GROUP_COLUMNS,
          select: DEVICE_FLEET_SCAN_AGGREGATES,
          orderBy: DEVICE_FLEET_SCAN_ORDER,
        }),
      );
    }

    // Buckets in a total order, for buckets the health order leaves tied.
    function canonical(groups: Array<DeviceHealthGroup>): Array<string> {
      return groups
        .map((group: DeviceHealthGroup): string => {
          return JSON.stringify(group);
        })
        .sort();
    }

    async function expectSameAnswers(): Promise<DeviceFleetScan> {
      const separate: DeviceFleetScan = await readSeparately();
      const folded: DeviceFleetScan = await readFolded();

      expect(folded.summary).toEqual(separate.summary);
      expect(folded.snmpFailing).toBe(separate.snmpFailing);

      // The same buckets, in the health order wherever it decides one.
      expect(canonical(folded.healthGroups)).toEqual(
        canonical(separate.healthGroups),
      );
      expect(
        folded.healthGroups.map((group: DeviceHealthGroup) => {
          return [group.monitorStatusId, group.deviceCount];
        }),
      ).toEqual(
        separate.healthGroups.map((group: DeviceHealthGroup) => {
          return [group.monitorStatusId, group.deviceCount];
        }),
      );

      // The breakdown's six, in its order, ties at the cut included.
      expect(folded.vendors.slice(0, 6)).toEqual(separate.vendors);

      return folded;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["NETWORK_FLEET_SCAN_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["NETWORK_FLEET_SCAN_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["NETWORK_FLEET_SCAN_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."NetworkDevice" (LIKE public."NetworkDevice" INCLUDING ALL)`,
      );

      // Every combination of the facts the health rule reads, twice over.
      const vendors: Array<string | null> = [
        "Cisco",
        "Juniper",
        "Arista",
        "  Cisco ",
        "",
        "   ",
        null,
        "MikroTik",
        "HPE Aruba",
        "aruba",
        "Zyxel",
      ];
      let index: number = 0;

      for (const isReachable of [true, false, null]) {
        for (const polled of [true, false]) {
          for (const seen of ["fresh", "stale", "never"]) {
            for (const interfacesDown of [0, 3]) {
              for (const method of ["Probe", "Monitor", "SNMP", null]) {
                index++;

                const status: string | null =
                  index % 4 === 0 ? null : statusIds[index % 3]!;
                const lastSeenAt: Date | null =
                  seen === "fresh"
                    ? minutesAgo(2)
                    : seen === "stale"
                      ? minutesAgo(5 * 24 * 60)
                      : null;

                await insertDevice({
                  isReachable: isReachable,
                  isSnmpReachable:
                    index % 3 === 0 ? false : index % 3 === 1 ? true : null,
                  lastPolledAt: polled ? lastSeenAt ?? minutesAgo(3) : null,
                  lastSeenAt: lastSeenAt,
                  lastSnmpSeenAt: index % 2 === 0 ? minutesAgo(10) : null,
                  pollingIntervalInMinutes: [5, 1, 60, null, 0][index % 5],
                  interfacesDown: interfacesDown,
                  monitoringMethod: method,
                  currentMonitorStatusId: status,
                  siteId: index % 3 === 0 ? null : siteIds[index % 2]!,
                  vendor: vendors[index % vendors.length],
                });
              }
            }
          }
        }
      }

      // Ties at the breakdown's cut: two vendors with the same count.
      for (let tie: number = 0; tie < 7; tie++) {
        await insertDevice({ vendor: "Ubiquiti", isReachable: true });
        await insertDevice({ vendor: "Fortinet", isReachable: true });
      }

      // Outside the scan: archived, deleted, and another project's.
      for (let outside: number = 0; outside < 5; outside++) {
        await insertDevice({
          isArchived: true,
          vendor: "Archived",
          isReachable: true,
        });
        await insertDevice({ deletedAt: minutesAgo(1), vendor: "Deleted" });
        await insertDevice({
          projectId: otherProjectId,
          vendor: "Elsewhere",
          isReachable: false,
        });
      }
    }, 300000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("over a fleet on every boundary: the same numbers, buckets and vendors", async () => {
      const folded: DeviceFleetScan = await expectSameAnswers();

      // The seed is what the comparison assumes: something on each side.
      // 144 combinations of the health facts, 14 tied vendors.
      expect(folded.summary.totalDevices).toBe(158);
      expect(folded.summary.devicesUp).toBeGreaterThan(0);
      expect(folded.summary.devicesDown).toBeGreaterThan(0);
      expect(folded.summary.devicesPending).toBeGreaterThan(0);
      expect(folded.summary.devicesWithoutSite).toBeGreaterThan(0);
      expect(folded.summary.interfacesDown).toBeGreaterThan(0);
      expect(folded.snmpFailing).toBeGreaterThan(0);
      expect(
        folded.healthGroups.some((group: DeviceHealthGroup) => {
          return group.isStale;
        }),
      ).toBe(true);
      expect(folded.vendors.length).toBeGreaterThan(6);

      // Nothing from outside the scan.
      expect(
        folded.vendors.map((vendor: { vendor: string }) => {
          return vendor.vendor;
        }),
      ).not.toEqual(expect.arrayContaining(["Archived"]));
      for (const outside of ["Archived", "Deleted", "Elsewhere"]) {
        expect(
          folded.vendors.some((vendor: { vendor: string }) => {
            return vendor.vendor === outside;
          }),
        ).toBe(false);
      }
    });

    test("blank, padded and missing vendors group as the breakdown grouped them", async () => {
      const folded: DeviceFleetScan = await readFolded();
      const names: Array<string> = folded.vendors.map(
        (vendor: { vendor: string }) => {
          return vendor.vendor;
        },
      );

      // "  Cisco " is Cisco; "", "   " and NULL are one unnamed group.
      expect(
        names.filter((name: string) => {
          return name === "Cisco";
        }),
      ).toHaveLength(1);
      expect(
        names.filter((name: string) => {
          return name === "";
        }),
      ).toHaveLength(1);
      expect(names).not.toContain("  Cisco ");
    });

    test("after an outage takes a quarter of the fleet down: still the same", async () => {
      await database.query(
        `UPDATE "${schema}"."NetworkDevice" SET "isReachable" = false, "lastSeenAt" = $1
       WHERE "projectId" = $2 AND "isReachable" = true AND ("_id"::text < '4')`,
        [minutesAgo(30), projectId],
      );

      await expectSameAnswers();
    });

    test("the folded read is one statement where the separate reads were four", async () => {
      let statements: number = 0;
      const runner: ReturnType<DataSource["createQueryRunner"]> =
        database.createQueryRunner();
      const query: typeof runner.query = runner.query.bind(runner);

      runner.query = (async (...args: Parameters<typeof query>) => {
        statements++;
        return await query(...args);
      }) as typeof runner.query;

      try {
        const builder: SelectQueryBuilder<NetworkDevice> = database.manager
          .createQueryBuilder(NetworkDevice, "NetworkDevice", runner)
          .setFindOptions({
            where: { projectId: projectId, isArchived: false } as never,
          });
        const columns: Array<AggregateColumn> = [
          ...DEVICE_FLEET_SCAN_GROUP_COLUMNS,
          ...DEVICE_FLEET_SCAN_AGGREGATES,
        ];

        builder.select(columns[0]!.expression, columns[0]!.alias);
        for (const column of columns.slice(1)) {
          builder.addSelect(column.expression, column.alias);
        }
        for (const column of DEVICE_FLEET_SCAN_GROUP_COLUMNS) {
          builder.addGroupBy(column.expression);
        }
        builder.setParameters({ [DEVICE_HEALTH_NOW_PARAMETER]: NOW });

        await builder.getRawMany();
      } finally {
        await runner.release();
      }

      expect(statements).toBe(1);
    });
  },
);
