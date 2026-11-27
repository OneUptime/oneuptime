import ObjectID from "../../../Types/ObjectID";
import { XcpNgPoolEventsStore } from "../../../Server/Utils/XcpNg/XcpNgPoolEventsIngest";
import {
  XcpNgFeedLine,
  XcpNgPoolEventColumns,
  XcpNgStoredPool,
  XcpNgStoredResource,
  XcpNgVmBackupUpdate,
} from "../../../Server/Utils/XcpNg/XcpNgPoolEventsProcessing";
import { XcpNgHostPatches } from "../../../Types/XcpNg/XcpNgPoolEvents";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";

/*
 * The events ingest's store (XcpNgPoolEventsStore) in memory, for tests:
 * what a collection committed is what the next job is read from, as the
 * database does it - every value round-tripped through JSON as a JSON
 * column round-trips it, a VM's last backup only moved forward, its newest
 * success kept (the SQL's recency guard and GREATEST).
 */
export default class MemoryXcpNgPoolEventsStore
  implements XcpNgPoolEventsStore
{
  public pools: Map<string, XcpNgStoredPool> = new Map();
  public inventories: Map<string, Array<XcpNgStoredResource>> = new Map();
  public poolWrites: Array<{ id: string; columns: XcpNgPoolEventColumns }> = [];
  public vmBackupWrites: Array<XcpNgVmBackupUpdate> = [];
  public patchWrites: Array<XcpNgHostPatches> = [];
  public feed: Array<XcpNgFeedLine & { xcpNgPoolId: string }> = [];
  public failWritesFor: Set<string> = new Set<string>();
  // Every VM's last backup as the SQL would keep it.
  public lastBackups: Map<string, XcpNgVmBackupUpdate> = new Map();

  public addPool(pool: XcpNgStoredPool): void {
    this.pools.set(pool.xcpNgPoolId, pool);
  }

  public async readPools(data: {
    projectId: ObjectID;
    xcpNgPoolIds: Array<ObjectID>;
  }): Promise<Array<XcpNgStoredPool>> {
    return data.xcpNgPoolIds
      .map((id: ObjectID): XcpNgStoredPool | undefined => {
        const pool: XcpNgStoredPool | undefined = this.pools.get(id.toString());
        return pool
          ? (JSON.parse(JSON.stringify(pool)) as XcpNgStoredPool)
          : undefined;
      })
      .filter((pool: XcpNgStoredPool | undefined): pool is XcpNgStoredPool => {
        return Boolean(pool);
      })
      .map((pool: XcpNgStoredPool): XcpNgStoredPool => {
        return {
          ...pool,
          patchesCheckedAt: pool.patchesCheckedAt
            ? new Date(pool.patchesCheckedAt)
            : null,
        };
      });
  }

  public async readInventory(data: {
    xcpNgPoolId: ObjectID;
  }): Promise<Array<XcpNgStoredResource>> {
    return (this.inventories.get(data.xcpNgPoolId.toString()) || []).map(
      (row: XcpNgStoredResource): XcpNgStoredResource => {
        const last: XcpNgVmBackupUpdate | undefined = this.lastBackups.get(
          row.externalId,
        );
        return {
          ...row,
          lastSuccessfulBackupAt:
            row.kind === XcpNgResourceKind.VM && last?.lastSuccessfulBackupAt
              ? last.lastSuccessfulBackupAt
              : row.lastSuccessfulBackupAt,
        };
      },
    );
  }

  public async writePool(data: {
    xcpNgPoolId: ObjectID;
    columns: XcpNgPoolEventColumns;
  }): Promise<void> {
    const id: string = data.xcpNgPoolId.toString();
    if (this.failWritesFor.has(id)) {
      throw new Error("the database went away");
    }
    this.poolWrites.push({ id: id, columns: data.columns });
    const pool: XcpNgStoredPool = this.pools.get(id) as XcpNgStoredPool;
    const columns: XcpNgPoolEventColumns = JSON.parse(
      JSON.stringify(data.columns),
    ) as XcpNgPoolEventColumns;
    this.pools.set(id, {
      ...pool,
      eventState: columns.eventState,
      isHaEnabled:
        columns.isHaEnabled === undefined
          ? pool.isHaEnabled
          : columns.isHaEnabled ?? null,
      haHostFailuresToTolerate:
        columns.haHostFailuresToTolerate === undefined
          ? pool.haHostFailuresToTolerate
          : columns.haHostFailuresToTolerate ?? null,
      haPlanExistsFor:
        columns.haPlanExistsFor === undefined
          ? pool.haPlanExistsFor
          : columns.haPlanExistsFor ?? null,
      isHaOvercommitted:
        columns.isHaOvercommitted === undefined
          ? pool.isHaOvercommitted
          : columns.isHaOvercommitted ?? null,
      masterHostExternalId:
        columns.masterHostExternalId === undefined
          ? pool.masterHostExternalId
          : columns.masterHostExternalId ?? null,
      backupJobs: columns.backupJobs ?? pool.backupJobs,
      patchesCheckedAt: columns.patchesCheckedAt
        ? new Date(columns.patchesCheckedAt)
        : pool.patchesCheckedAt,
    });
  }

  public async writeVmBackups(data: {
    updates: Array<XcpNgVmBackupUpdate>;
  }): Promise<void> {
    this.vmBackupWrites.push(...data.updates);
    for (const update of data.updates) {
      const known: XcpNgVmBackupUpdate | undefined = this.lastBackups.get(
        update.vmId,
      );
      const newest: XcpNgVmBackupUpdate =
        !known || known.lastBackupAt <= update.lastBackupAt
          ? { ...update }
          : { ...known };
      const successes: Array<number> = [
        known?.lastSuccessfulBackupAt,
        update.lastSuccessfulBackupAt,
      ]
        .filter((date: Date | null | undefined): date is Date => {
          return Boolean(date);
        })
        .map((date: Date): number => {
          return date.getTime();
        });
      newest.lastSuccessfulBackupAt =
        successes.length > 0 ? new Date(Math.max(...successes)) : null;
      this.lastBackups.set(update.vmId, newest);
    }
  }

  public async writeVmIntervals(data: {
    xcpNgPoolId: ObjectID;
    updates: Array<{ vmId: string; intervalSeconds: number | null }>;
  }): Promise<void> {
    const rows: Array<XcpNgStoredResource> =
      this.inventories.get(data.xcpNgPoolId.toString()) || [];
    for (const update of data.updates) {
      const row: XcpNgStoredResource | undefined = rows.find(
        (entry: XcpNgStoredResource) => {
          return (
            entry.kind === XcpNgResourceKind.VM &&
            entry.externalId === update.vmId
          );
        },
      );
      if (row) {
        row.backupIntervalSeconds = update.intervalSeconds;
      }
    }
  }

  public async writeHostPatches(data: {
    xcpNgPoolId: ObjectID;
    hosts: Array<XcpNgHostPatches>;
  }): Promise<void> {
    this.patchWrites.push(...data.hosts);
    const rows: Array<XcpNgStoredResource> =
      this.inventories.get(data.xcpNgPoolId.toString()) || [];
    for (const host of data.hosts) {
      const row: XcpNgStoredResource | undefined = rows.find(
        (entry: XcpNgStoredResource) => {
          return entry.externalId === host.hostId;
        },
      );
      if (row) {
        row.missingPatchCount = host.patchCount;
      }
    }
  }

  public async writeFeed(data: {
    xcpNgPoolId: ObjectID;
    lines: Array<XcpNgFeedLine>;
  }): Promise<void> {
    for (const line of data.lines) {
      this.feed.push({ ...line, xcpNgPoolId: data.xcpNgPoolId.toString() });
    }
  }
}

export function makeXcpNgStoredPool(data: {
  xcpNgPoolId: string;
  poolIdentifier: string;
  name: string;
}): XcpNgStoredPool {
  return {
    xcpNgPoolId: data.xcpNgPoolId,
    poolIdentifier: data.poolIdentifier,
    name: data.name,
    reportedName: data.name,
    xenOrchestraName: "xo-paris",
    isHaEnabled: null,
    haHostFailuresToTolerate: null,
    haPlanExistsFor: null,
    isHaOvercommitted: null,
    masterHostExternalId: null,
    backupJobs: null,
    eventState: null,
    patchesCheckedAt: null,
  };
}

export function makeXcpNgStoredResource(
  kind: string,
  externalId: string,
  name: string,
  extra: Partial<XcpNgStoredResource> = {},
): XcpNgStoredResource {
  return {
    kind: kind,
    externalId: externalId,
    name: name,
    isUp: true,
    isEnabled: true,
    isControlDomain: false,
    lastSuccessfulBackupAt: null,
    backupIntervalSeconds: null,
    missingPatchCount: null,
    ...extra,
  };
}

// The recorded lab's two pools, as their inventories hold them.
export function makeXcpNgLabStore(data: {
  productionId: string;
  labId: string;
}): MemoryXcpNgPoolEventsStore {
  const store: MemoryXcpNgPoolEventsStore = new MemoryXcpNgPoolEventsStore();
  store.addPool(
    makeXcpNgStoredPool({
      xcpNgPoolId: data.productionId,
      poolIdentifier: "b7569d99-30f8-178a-7d94-801de3e29b5b",
      name: "Production",
    }),
  );
  store.addPool(
    makeXcpNgStoredPool({
      xcpNgPoolId: data.labId,
      poolIdentifier: "2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1",
      name: "Pool 2ad2c2ec",
    }),
  );
  store.inventories.set(data.productionId, [
    makeXcpNgStoredResource(
      XcpNgResourceKind.Host,
      "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
      "xcp-prod-01",
    ),
    makeXcpNgStoredResource(
      XcpNgResourceKind.Host,
      "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7",
      "xcp-prod-02",
      { isEnabled: false },
    ),
    makeXcpNgStoredResource(
      XcpNgResourceKind.Host,
      "f0e1d2c3-b4a5-4968-8776-655443322110",
      "xcp-prod-03",
      { isUp: false },
    ),
    makeXcpNgStoredResource(
      XcpNgResourceKind.VM,
      "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
      "web-01",
    ),
    makeXcpNgStoredResource(
      XcpNgResourceKind.VM,
      "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
      "db-01",
    ),
    makeXcpNgStoredResource(
      XcpNgResourceKind.VM,
      "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e",
      "app-02",
      { isUp: false },
    ),
    makeXcpNgStoredResource(
      XcpNgResourceKind.VM,
      "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a",
      "win-03",
      { isUp: false },
    ),
    makeXcpNgStoredResource(
      XcpNgResourceKind.StorageRepository,
      "1d2c3b4a-5e6f-4789-9abc-def012345678",
      "NFS VM store",
    ),
  ]);
  store.inventories.set(data.labId, [
    makeXcpNgStoredResource(
      XcpNgResourceKind.Host,
      "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
      "xcp-lab-01",
    ),
    makeXcpNgStoredResource(
      XcpNgResourceKind.VM,
      "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
      "lab-vm-01",
    ),
  ]);
  return store;
}
