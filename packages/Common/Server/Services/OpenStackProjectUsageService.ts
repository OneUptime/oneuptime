import { EntityManager } from "typeorm";
import Model from "../../Models/DatabaseModels/OpenStackProjectUsage";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  OPENSTACK_USAGE_DAY_ROWS_KEPT_DAYS,
  OPENSTACK_USAGE_IMAGE_STATUS_HOLDING,
  OPENSTACK_USAGE_INSTANCE_STATUSES_HOLDING_NOTHING,
  OPENSTACK_USAGE_MONTH_ROWS_KEPT_MONTHS,
  OPENSTACK_USAGE_STORAGE_STATUSES_HOLDING_NOTHING,
  OpenStackUsageCountGroup,
  OpenStackUsageFlavorRow,
  OpenStackUsageInstanceGroup,
  OpenStackUsageQuantities,
  OpenStackUsageRows,
  OpenStackUsageStorageGroup,
  readOpenStackUsageFlavorId,
  readOpenStackUsageQuantities,
  toOpenStackUsageDay,
  toOpenStackUsageMonth,
} from "../../Types/OpenStack/OpenStackProjectUsage";
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";
import { OPENSTACK_RATED_FACTS_SQL } from "../../Types/OpenStack/OpenStackSpendSnapshot";
import {
  OPENSTACK_WASTE_ROWS_READ,
  OpenStackWasteRow,
} from "../../Types/OpenStack/OpenStackWaste";
import {
  addUtcDays,
  addUtcMonths,
  startOfUtcMonth,
} from "../../Types/Cloud/CloudCost";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";

/*
 * THE READS AND WRITES OF A CLOUD'S USAGE.
 *
 * Grouped on the server, so a cloud of 200,000 instances costs one statement over their rows, and
 * its rows read back a page at a time. Writing is one transaction: what a reading adds, and the
 * time it says it has read up to. So a reading that fails counts nothing, and two workers on one
 * cloud count its time once. The second waits for the first's rows, then finds the time has moved.
 */

export interface OpenStackUsageProjectRow {
  openStackProjectId: string;
  name: string | null;
  domainId: string | null;
  // CloudKitty's figures, where a probe has read them: see readOpenStackRatedByPeriod.
  rated: unknown;
}

export interface OpenStackUsageDomainRow {
  domainId: string;
  name: string | null;
}

export interface OpenStackUsagePeriodRow {
  openStackProjectId: string;
  name: string | null;
  domainId: string | null;
  domainName: string | null;
  quantities: OpenStackUsageQuantities;
}

export interface OpenStackUsageRowWrite {
  openStackProjectId: string;
  period: string;
  name: string | null;
  domainId: string | null;
  domainName: string | null;
  quantities: OpenStackUsageQuantities;
  vcpuHours: number;
  memoryGbHours: number;
  volumeGbHours: number;
  floatingIpHours: number;
  estimatedCost: number | null;
  lastMonthCost: number | null;
  onCourseFor: number | null;
  growth: number | null;
  costSource: string | null;
  unpricedLineCount: number | null;
  sortValue: number;
}

export interface OpenStackWasteRows {
  volumes: Array<OpenStackWasteRow>;
  floatingIps: Array<OpenStackWasteRow>;
  instances: Array<OpenStackWasteRow>;
  images: Array<OpenStackWasteRow>;
  snapshots: Array<OpenStackWasteRow>;
  instanceImageIds: Array<string | null>;
  volumeImageIds: Array<string | null>;
  // Instances and bootable volumes whose row says nothing of an image, which is the agent's series.
  instancesNotSaying: number;
  // Whether this cloud reports snapshots one by one: the agent's exporter reports only how many.
  snapshotRowCount: number;
}

// A reading only one worker got to save. Not an error: see saveReading.
class UsageAlreadyCounted extends Error {}

const WRITE_BATCH_SIZE: number = 500;
const READ_BATCH_SIZE: number = 2000;
const DELETE_BATCH_SIZE: number = 5000;
// Keystone's names fit, and a column's length is the longest anything else could send.
const LONGEST_TEXT: number = 100;

const WRITE_COLUMNS: ReadonlyArray<[string, string]> = [
  ["openStackProjectId", "text"],
  ["period", "text"],
  ["name", "text"],
  ["domainId", "text"],
  ["domainName", "text"],
  ["quantities", "jsonb"],
  ["vcpuHours", "numeric"],
  ["memoryGbHours", "numeric"],
  ["volumeGbHours", "numeric"],
  ["floatingIpHours", "numeric"],
  ["estimatedCost", "numeric"],
  ["lastMonthCost", "numeric"],
  ["onCourseFor", "numeric"],
  ["growth", "numeric"],
  ["costSource", "text"],
  ["unpricedLineCount", "integer"],
  ["sortValue", "numeric"],
];

function toText(value: string | null): string | null {
  return value ? value.slice(0, LONGEST_TEXT) : null;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * 0 is a sort value: a project that has cost nothing, and one that has
   * used no vCPU-hours where nothing has a price. Its rows are written by
   * saveReading's own INSERT today, which the required-column check never
   * sees, but that check reads 0 as missing, so a row written through
   * create() would be refused as "sortValue is required". Any number is a
   * value of it; anything else is still read as the check reads it.
   */
  protected override isRequiredColumnValueGiven(
    column: string,
    value: unknown,
  ): boolean {
    if (
      column === "sortValue" &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return true;
    }

    return super.isRequiredColumnValueGiven(column, value);
  }

  /*
   * What the inventory says each project holds now. Six statements, however many instances there
   * are: the first is the one that reads every instance's row.
   */
  @CaptureSpan()
  public async getUsageRows(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<OpenStackUsageRows> {
    const params: Array<string> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
    ];
    const query: <T>(
      sql: string,
      extra?: Array<unknown>,
    ) => Promise<Array<T>> = async <T>(
      sql: string,
      extra?: Array<unknown>,
    ): Promise<Array<T>> => {
      return (await this.getRepository().manager.query(sql, [
        ...params,
        ...(extra || []),
      ])) as Array<T>;
    };
    const owned: (kind: OpenStackResourceKind) => string = (
      kind: OpenStackResourceKind,
    ): string => {
      return `"projectId" = $1 AND "openStackCloudId" = $2 AND "kind" = '${kind}'
        AND "deletedAt" IS NULL AND "openStackProjectId" IS NOT NULL`;
    };

    const instances: Array<{
      openStackProjectId: string;
      regionName: string | null;
      flavorId: string | null;
      status: string | null;
      count: string;
    }> = await query(
      `SELECT "openStackProjectId", "regionName", "facts"->>'flavorId' AS "flavorId", "status",
              COUNT(*)::text AS "count"
       FROM "OpenStackResource"
       WHERE ${owned(OpenStackResourceKind.Instance)}
         AND "hypervisorName" IS NOT NULL
         AND COALESCE("status", '') <> ALL($3::text[])
       GROUP BY "openStackProjectId", "regionName", "facts"->>'flavorId', "status"`,
      [Array.from(OPENSTACK_USAGE_INSTANCE_STATUSES_HOLDING_NOTHING)],
    );

    const flavors: Array<{
      externalId: string;
      regionName: string | null;
      name: string | null;
      vcpuCapacity: number | null;
      memoryCapacityBytes: string | null;
    }> = await query(
      `SELECT "externalId", "regionName", "name", "vcpuCapacity", "memoryCapacityBytes"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Flavor}' AND "deletedAt" IS NULL`,
    );

    const storage: (
      kind: OpenStackResourceKind,
      condition: string,
      extra: Array<unknown>,
      groupByType: boolean,
    ) => Promise<Array<OpenStackUsageStorageGroup>> = async (
      kind: OpenStackResourceKind,
      condition: string,
      extra: Array<unknown>,
      groupByType: boolean,
    ): Promise<Array<OpenStackUsageStorageGroup>> => {
      const type: string = `"facts"->>'volumeType'`;
      const rows: Array<{
        openStackProjectId: string;
        type?: string | null;
        bytes: string;
      }> = await query(
        `SELECT "openStackProjectId", ${groupByType ? `${type} AS "type",` : ""}
                COALESCE(SUM("diskCapacityBytes"), 0)::text AS "bytes"
         FROM "OpenStackResource"
         WHERE ${owned(kind)} AND ${condition}
         GROUP BY "openStackProjectId"${groupByType ? `, ${type}` : ""}`,
        extra,
      );

      return rows.map(
        (row: {
          openStackProjectId: string;
          type?: string | null;
          bytes: string;
        }): OpenStackUsageStorageGroup => {
          return {
            openStackProjectId: row.openStackProjectId,
            type: row.type ?? null,
            bytes: Number(row.bytes) || 0,
          };
        },
      );
    };

    const notHoldingNothing: string = `COALESCE("status", '') <> ALL($3::text[])`;
    const holdingNothing: Array<unknown> = [
      Array.from(OPENSTACK_USAGE_STORAGE_STATUSES_HOLDING_NOTHING),
    ];

    const volumes: Array<OpenStackUsageStorageGroup> = await storage(
      OpenStackResourceKind.Volume,
      notHoldingNothing,
      holdingNothing,
      true,
    );

    const floatingIps: Array<{
      openStackProjectId: string;
      count: string;
    }> = await query(
      `SELECT "openStackProjectId", COUNT(*)::text AS "count"
       FROM "OpenStackResource"
       WHERE ${owned(OpenStackResourceKind.FloatingIp)}
       GROUP BY "openStackProjectId"`,
    );

    const images: Array<OpenStackUsageStorageGroup> = await storage(
      OpenStackResourceKind.Image,
      `"status" = $3`,
      [OPENSTACK_USAGE_IMAGE_STATUS_HOLDING],
      false,
    );

    const snapshots: Array<OpenStackUsageStorageGroup> = await storage(
      OpenStackResourceKind.Snapshot,
      notHoldingNothing,
      holdingNothing,
      false,
    );

    return {
      instances: instances.map(
        (row: (typeof instances)[number]): OpenStackUsageInstanceGroup => {
          return {
            openStackProjectId: row.openStackProjectId,
            regionName: row.regionName,
            flavorId: row.flavorId,
            status: row.status,
            count: Number.parseInt(row.count, 10) || 0,
          };
        },
      ),
      flavors: flavors.map(
        (row: (typeof flavors)[number]): OpenStackUsageFlavorRow => {
          return {
            regionName: row.regionName,
            flavorId: readOpenStackUsageFlavorId({
              externalId: row.externalId,
              regionName: row.regionName,
            }),
            name: row.name,
            vcpus: row.vcpuCapacity === null ? null : Number(row.vcpuCapacity),
            memoryBytes:
              row.memoryCapacityBytes === null
                ? null
                : Number(row.memoryCapacityBytes),
          };
        },
      ),
      volumes,
      floatingIps: floatingIps.map(
        (row: (typeof floatingIps)[number]): OpenStackUsageCountGroup => {
          return {
            openStackProjectId: row.openStackProjectId,
            count: Number.parseInt(row.count, 10) || 0,
          };
        },
      ),
      images,
      snapshots,
    };
  }

  // The names a project's row keeps, and what CloudKitty last rated it, where a probe has read that.
  @CaptureSpan()
  public async getUsageProjects(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<{
    projects: Array<OpenStackUsageProjectRow>;
    domains: Array<OpenStackUsageDomainRow>;
  }> {
    const params: Array<string> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
    ];
    const projects: Array<{
      externalId: string;
      name: string | null;
      domainId: string | null;
      rated: unknown;
    }> = await this.getRepository().manager.query(
      `SELECT "externalId", "name", "facts"->>'domainId' AS "domainId", ${OPENSTACK_RATED_FACTS_SQL} AS "rated"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Project}' AND "deletedAt" IS NULL`,
      params,
    );
    const domains: Array<{
      externalId: string;
      name: string | null;
    }> = await this.getRepository().manager.query(
      `SELECT "externalId", "name"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Domain}' AND "deletedAt" IS NULL`,
      params,
    );

    return {
      projects: projects.map(
        (row: (typeof projects)[number]): OpenStackUsageProjectRow => {
          return {
            openStackProjectId: row.externalId,
            name: row.name,
            domainId: row.domainId,
            rated: row.rated,
          };
        },
      ),
      domains: domains.map(
        (row: (typeof domains)[number]): OpenStackUsageDomainRow => {
          return { domainId: row.externalId, name: row.name };
        },
      ),
    };
  }

  // Every project's row of one period, a page at a time so one statement never carries them all.
  @CaptureSpan()
  public async getPeriodRows(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    period: string;
  }): Promise<Array<OpenStackUsagePeriodRow>> {
    const rows: Array<OpenStackUsagePeriodRow> = [];
    let after: string = "";

    for (;;) {
      const page: Array<{
        openStackProjectId: string;
        name: string | null;
        domainId: string | null;
        domainName: string | null;
        quantities: unknown;
      }> = await this.getRepository().manager.query(
        `SELECT "openStackProjectId", "name", "domainId", "domainName", "quantities"
         FROM "OpenStackProjectUsage"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "period" = $3
           AND "deletedAt" IS NULL AND "openStackProjectId" > $4
         ORDER BY "openStackProjectId" ASC
         LIMIT ${READ_BATCH_SIZE}`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          data.period,
          after,
        ],
      );

      for (const row of page) {
        rows.push({
          openStackProjectId: row.openStackProjectId,
          name: row.name,
          domainId: row.domainId,
          domainName: row.domainName,
          quantities: readOpenStackUsageQuantities(row.quantities),
        });
      }

      if (page.length < READ_BATCH_SIZE) {
        return rows;
      }

      after = page[page.length - 1]!.openStackProjectId;
    }
  }

  /*
   * What a reading adds, and the time it has read up to, or neither. False when this cloud's reading
   * had already moved on, because another worker got there first: nothing's been counted twice.
   */
  @CaptureSpan()
  public async saveReading(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    rows: ReadonlyArray<OpenStackUsageRowWrite>;
    lastReadAt: Date | null;
    readAt: Date;
    snapshot: JSONObject;
  }): Promise<boolean> {
    try {
      await this.executeTransaction(
        async (manager: EntityManager): Promise<void> => {
          for (
            let index: number = 0;
            index < data.rows.length;
            index += WRITE_BATCH_SIZE
          ) {
            await this.writeRows({
              manager,
              projectId: data.projectId,
              openStackCloudId: data.openStackCloudId,
              rows: data.rows.slice(index, index + WRITE_BATCH_SIZE),
            });
          }

          // The Postgres driver returns [rows, affected] for an UPDATE.
          const updated: [Array<JSONObject>, number] = await manager.query(
            `UPDATE "OpenStackCloud"
             SET "usageReadAt" = $1, "spendSnapshot" = $2::jsonb, "updatedAt" = now()
             WHERE "_id" = $3 AND "projectId" = $4
               AND "usageReadAt" IS NOT DISTINCT FROM $5
             RETURNING "_id"`,
            [
              data.readAt,
              JSON.stringify(data.snapshot),
              data.openStackCloudId.toString(),
              data.projectId.toString(),
              data.lastReadAt,
            ],
          );

          if (updated[1] !== 1) {
            throw new UsageAlreadyCounted();
          }
        },
      );

      return true;
    } catch (err) {
      if (err instanceof UsageAlreadyCounted) {
        return false;
      }
      throw err;
    }
  }

  private async writeRows(data: {
    manager: EntityManager;
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    rows: ReadonlyArray<OpenStackUsageRowWrite>;
  }): Promise<void> {
    const names: Array<string> = WRITE_COLUMNS.map(
      ([name]: [string, string]): string => {
        return `"${name}"`;
      },
    );
    const types: string = WRITE_COLUMNS.map(
      ([name, type]: [string, string]): string => {
        return `"${name}" ${type}`;
      },
    ).join(", ");
    const updates: string = WRITE_COLUMNS.filter(
      ([name]: [string, string]): boolean => {
        return name !== "openStackProjectId" && name !== "period";
      },
    )
      .map(([name]: [string, string]): string => {
        return `"${name}" = EXCLUDED."${name}"`;
      })
      .join(", ");

    await data.manager.query(
      `INSERT INTO "OpenStackProjectUsage" ("projectId", "openStackCloudId", "version", ${names.join(", ")})
       SELECT $1::uuid, $2::uuid, 1, ${names.join(", ")}
       FROM jsonb_to_recordset($3::jsonb) AS row(${types})
       ON CONFLICT ("projectId", "openStackCloudId", "period", "openStackProjectId")
       DO UPDATE SET ${updates}, "updatedAt" = now()`,
      [
        data.projectId.toString(),
        data.openStackCloudId.toString(),
        JSON.stringify(
          data.rows.map((row: OpenStackUsageRowWrite): JSONObject => {
            return {
              ...row,
              name: toText(row.name),
              domainId: toText(row.domainId),
              domainName: toText(row.domainName),
            } as unknown as JSONObject;
          }),
        ),
      ],
    );
  }

  /*
   * What's older than anyone reads, in small statements so a large cloud's month going never holds
   * a long transaction. A day's rows go after 62 days and a month's after 13 months.
   */
  @CaptureSpan()
  public async deleteOldRows(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    now: Date;
  }): Promise<number> {
    const oldestDay: string = toOpenStackUsageDay(
      addUtcDays(data.now, -OPENSTACK_USAGE_DAY_ROWS_KEPT_DAYS),
    );
    const oldestMonth: string = toOpenStackUsageMonth(
      addUtcMonths(
        startOfUtcMonth(data.now),
        -(OPENSTACK_USAGE_MONTH_ROWS_KEPT_MONTHS - 1),
      ),
    );
    let deleted: number = 0;

    for (const { period, length } of [
      { period: oldestDay, length: oldestDay.length },
      { period: oldestMonth, length: oldestMonth.length },
    ]) {
      for (;;) {
        const result: [Array<JSONObject>, number] =
          await this.getRepository().manager.query(
            `DELETE FROM "OpenStackProjectUsage"
             WHERE "_id" IN (
               SELECT "_id" FROM "OpenStackProjectUsage"
               WHERE "projectId" = $1 AND "openStackCloudId" = $2
                 AND LENGTH("period") = $3 AND "period" < $4
               LIMIT ${DELETE_BATCH_SIZE}
             )`,
            [
              data.projectId.toString(),
              data.openStackCloudId.toString(),
              length,
              period,
            ],
          );
        const affected: number = result[1] || 0;

        deleted += affected;

        if (affected < DELETE_BATCH_SIZE) {
          break;
        }
      }
    }

    return deleted;
  }

  /*
   * What the waste rules read: the rows each could name, oldest first, and what says an image is in
   * use. Hourly, because it's a read of every instance's row. The rules themselves decide
   * (OpenStackWaste). These statements only keep them from reading what could never be named.
   */
  @CaptureSpan()
  public async getWasteRows(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<OpenStackWasteRows> {
    const params: Array<string> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
    ];
    const read: (
      kind: OpenStackResourceKind,
      status: string | null,
    ) => Promise<Array<OpenStackWasteRow>> = async (
      kind: OpenStackResourceKind,
      status: string | null,
    ): Promise<Array<OpenStackWasteRow>> => {
      return (await this.getRepository().manager.query(
        `SELECT "externalId", "name", "regionName", "openStackProjectId", "status",
                "stateChangedAt", "createdAt", "diskCapacityBytes", "facts"
         FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "kind" = '${kind}'
           AND "deletedAt" IS NULL ${status ? `AND "status" = '${status}'` : ""}
         ORDER BY COALESCE("stateChangedAt", "createdAt") ASC
         LIMIT ${OPENSTACK_WASTE_ROWS_READ}`,
        params,
      )) as Array<OpenStackWasteRow>;
    };

    const instanceImages: Array<{
      imageId: string | null;
      notSaying: string;
    }> = await this.getRepository().manager.query(
      `SELECT "facts"->>'imageId' AS "imageId",
              COUNT(*) FILTER (WHERE NOT jsonb_exists("facts", 'imageId'))::text AS "notSaying"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Instance}' AND "deletedAt" IS NULL
       GROUP BY "facts"->>'imageId'`,
      params,
    );
    const volumeImages: Array<{
      imageId: string | null;
      notSaying: string;
    }> = await this.getRepository().manager.query(
      `SELECT "facts"->>'imageId' AS "imageId",
              COUNT(*) FILTER (
                WHERE "facts"->>'isBootable' = 'true' AND NOT jsonb_exists("facts", 'imageId')
              )::text AS "notSaying"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Volume}' AND "deletedAt" IS NULL
       GROUP BY "facts"->>'imageId'`,
      params,
    );
    const snapshotCount: Array<{ count: string }> =
      await this.getRepository().manager.query(
        `SELECT COUNT(*)::text AS "count" FROM (
           SELECT 1 FROM "OpenStackResource"
           WHERE "projectId" = $1 AND "openStackCloudId" = $2
             AND "kind" = '${OpenStackResourceKind.Snapshot}' AND "deletedAt" IS NULL
           LIMIT 1
         ) AS "any"`,
        params,
      );

    const notSaying: (rows: Array<{ notSaying: string }>) => number = (
      rows: Array<{ notSaying: string }>,
    ): number => {
      return rows.reduce((sum: number, row: { notSaying: string }): number => {
        return sum + (Number.parseInt(row.notSaying, 10) || 0);
      }, 0);
    };
    const idsOf: (
      rows: Array<{ imageId: string | null }>,
    ) => Array<string | null> = (
      rows: Array<{ imageId: string | null }>,
    ): Array<string | null> => {
      return rows.map((row: { imageId: string | null }): string | null => {
        return row.imageId;
      });
    };

    return {
      volumes: await read(OpenStackResourceKind.Volume, "available"),
      floatingIps: await read(OpenStackResourceKind.FloatingIp, null),
      instances: await read(OpenStackResourceKind.Instance, "SHUTOFF"),
      images: await read(OpenStackResourceKind.Image, "active"),
      snapshots: await read(OpenStackResourceKind.Snapshot, "available"),
      instanceImageIds: idsOf(instanceImages),
      volumeImageIds: idsOf(volumeImages),
      instancesNotSaying: notSaying(instanceImages) + notSaying(volumeImages),
      snapshotRowCount:
        Number.parseInt(snapshotCount[0]?.count || "0", 10) || 0,
    };
  }
}

export default new Service();
