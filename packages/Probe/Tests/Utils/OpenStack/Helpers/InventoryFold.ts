import { ParsedOpenStackResource } from "Common/Server/Services/OpenStackResourceService";
import OpenStackProbeMetrics, {
  OpenStackProbeMetricsPayload,
} from "Common/Server/Utils/OpenStack/OpenStackProbeMetrics";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackCollectionReport } from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  OPENSTACK_KINDS_BY_SERVICE,
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";

/*
 * What ingest makes of one upload of a probe's collection, and what the inventory makes of that.
 * The fold is the real one, exactly as OtelMetricsIngestService runs it, without ClickHouse.
 */
export function foldOpenStackUpload(
  report: OpenStackCollectionReport,
): Array<OpenStackResourceBufferEntry> {
  const payload: OpenStackProbeMetricsPayload = OpenStackProbeMetrics.prepare({
    resourceMetrics: report.resourceMetrics,
    cloudName: "a-cloud",
  });
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const resource of payload.resourceMetrics as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const metricName: string = metric["name"] as string;
        const gauge: JSONObject | undefined = metric["gauge"] as
          | JSONObject
          | undefined;

        for (const datapoint of (gauge?.["dataPoints"] ||
          []) as Array<JSONObject>) {
          if (isOpenStackSnapshotDatapoint({ metricName, datapoint })) {
            bufferOpenStackSnapshotMetric({ metricName, datapoint, buffer });
          }
        }
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

export function toOpenStackInventoryRow(
  entry: OpenStackResourceBufferEntry,
): ParsedOpenStackResource {
  return {
    kind: entry.kind,
    externalId: entry.externalId,
    name: entry.name,
    regionName: entry.regionName,
    availabilityZone: entry.availabilityZone,
    hypervisorName: entry.hypervisorName,
    openStackProjectId: entry.openStackProjectId,
    status: entry.status,
    adminState: entry.adminState,
    disabledReason: entry.disabledReason,
    vcpuCapacity: entry.vcpuCapacity,
    vcpuAllocated: entry.vcpuAllocated,
    memoryCapacityBytes: entry.memoryCapacityBytes,
    memoryAllocatedBytes: entry.memoryAllocatedBytes,
    diskCapacityBytes: entry.diskCapacityBytes,
    diskAllocatedBytes: entry.diskAllocatedBytes,
    instanceCount: entry.instanceCount,
    facts: entry.facts,
    lastSeenAt: entry.observedAt,
  };
}

// What these tests ask of the inventory, whether it is the model below or Postgres.
export interface OpenStackTestInventory {
  write: (rows: Array<ParsedOpenStackResource>) => Promise<void>;
  // How many it deleted.
  sweep: () => Promise<number>;
  externalIdsOf: (kind: OpenStackResourceKind) => Promise<Array<string>>;
}

interface ModelRow {
  row: ParsedOpenStackResource;
  lastSeenAt: number;
}

const DEFAULT_WINDOW_IN_MINUTES: number = 15;
const MAX_TOUCH_INTERVAL_IN_MS: number = 5 * 60_000;

/*
 * OpenStackResourceService.bulkUpsert and deleteStaleForCloud, for what the stale-row rule reads, so
 * a test of a cloud's whole life runs in CI without a database. OpenStackScalePostgres holds the SQL
 * to these same rules, and OpenStackStaleRowsLifecycle runs on either.
 */
export class OpenStackInventoryModel implements OpenStackTestInventory {
  private readonly rows: Map<string, ModelRow> = new Map();
  private readonly windowInMs: number;
  private readonly touchInMs: number;

  public constructor(windowInMinutes: number = DEFAULT_WINDOW_IN_MINUTES) {
    this.windowInMs = windowInMinutes * 60_000;
    this.touchInMs = Math.min(MAX_TOUCH_INTERVAL_IN_MS, this.windowInMs / 3);
  }

  public async write(rows: Array<ParsedOpenStackResource>): Promise<void> {
    for (const row of rows) {
      const key: string = `${row.kind}/${row.externalId}`;
      const seenAt: number = row.lastSeenAt.getTime();
      const known: ModelRow | undefined = this.rows.get(key);

      if (!known) {
        this.rows.set(key, { row: { ...row }, lastSeenAt: seenAt });
        continue;
      }

      if (seenAt < known.lastSeenAt) {
        continue;
      }

      const before: JSONObject = known.row.facts || {};
      const facts: JSONObject = { ...before, ...(row.facts || {}) };
      const isChanged: boolean =
        (row.status !== null && row.status !== known.row.status) ||
        JSON.stringify(facts) !== JSON.stringify(before);

      if (!isChanged && known.lastSeenAt >= seenAt - this.touchInMs) {
        continue;
      }

      if (
        row.facts?.["vouchedAt"] &&
        before["vouchedAt"] &&
        row.facts["vouchedAt"] !== before["vouchedAt"]
      ) {
        facts["previousVouchedAt"] = before["vouchedAt"];
        facts["previousRefreshCycleMinutes"] =
          before["refreshCycleMinutes"] ?? null;
      }

      known.row = {
        ...known.row,
        ...row,
        status: row.status ?? known.row.status,
        facts: facts,
      };
      known.lastSeenAt = seenAt;
    }
  }

  public async sweep(): Promise<number> {
    let deleted: number = 0;

    for (const api of Array.from(this.rows.values())) {
      const facts: JSONObject = api.row.facts || {};
      const previous: unknown = facts["previousVouchedAt"];

      if (
        api.row.kind !== OpenStackResourceKind.Api ||
        api.row.status !== "up" ||
        typeof previous !== "string"
      ) {
        continue;
      }

      const service: OpenStackServiceType = api.row
        .name as OpenStackServiceType;
      const cutoff: number =
        Date.parse(previous) -
        this.windowInMs -
        ((facts["previousRefreshCycleMinutes"] as number) || 0) * 60_000;

      for (const [key, part] of Array.from(this.rows.entries())) {
        const family: unknown = part.row.facts?.["family"];
        const isOfService: boolean =
          OPENSTACK_KINDS_BY_SERVICE[service].includes(part.row.kind) ||
          (part.row.kind === OpenStackResourceKind.Service &&
            family === service);
        const isInRegion: boolean =
          service === OpenStackServiceType.Identity ||
          part.row.regionName === api.row.regionName;

        if (isOfService && isInRegion && part.lastSeenAt < cutoff) {
          this.rows.delete(key);
          deleted++;
        }
      }
    }

    return deleted;
  }

  public async externalIdsOf(
    kind: OpenStackResourceKind,
  ): Promise<Array<string>> {
    return Array.from(this.rows.values())
      .filter((part: ModelRow): boolean => {
        return part.row.kind === kind;
      })
      .map((part: ModelRow): string => {
        return part.row.externalId;
      });
  }
}
