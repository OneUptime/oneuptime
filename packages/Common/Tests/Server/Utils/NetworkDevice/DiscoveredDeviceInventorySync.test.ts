import DiscoveredDeviceInventorySync, {
  DISCOVERED_LIST_ENTRY_REFRESH_MS,
  DiscoveredDeviceInventorySyncSummary,
  INVENTORY_SYNC_PAGE_SIZE,
  INVENTORY_SYNC_PROJECTS_PER_PAGE,
  MatchedDiscoveredDevice,
  buildMatchedDevicesStatement,
  buildSyncProjectsStatement,
  planDiscoveredListPatch,
} from "../../../../Server/Utils/NetworkDevice/DiscoveredDeviceInventorySync";
import DiscoveredDevices, {
  ClassifiedDiscoveredDevice,
} from "../../../../Server/Utils/NetworkDevice/DiscoveredDevices";
import { DiscoveredDetailsMerge } from "../../../../Server/Services/NetworkDeviceService";
import { DiscoveredDeviceStatement } from "../../../../Server/Utils/NetworkDevice/DiscoveredDeviceQuery";
import { DiscoveredDeviceMatch } from "../../../../Types/NetworkDevice/DiscoveredDevice";
import {
  NetworkDeviceDiscoveryReaderType,
  buildDiscoveredListEntries,
  buildDiscoveredValue,
  NetworkDeviceDiscoveredField,
} from "../../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../../Types/ObjectID";
import logger from "../../../../Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Keeping a monitored device's inventory in step with the Discovered Devices
 * list (OneUptime issue #9305), with the statements' runner, the writer and
 * the clock standing in for Postgres and time. Pinned here: what one
 * device's details need to say what its row says - filled in when empty,
 * updated when the list's word changes, dropped when the list has none, left
 * alone while current, refreshed once a day - that nothing else of the
 * details is touched, that only values travel as parameters, and the paging,
 * the time budget and the carrying on of an interrupted run, which is how
 * the devices imported before this are backfilled.
 */

jest.mock("../../../../Server/Services/NetworkEndpointService", () => {
  return {
    __esModule: true,
    default: {
      getRepository: () => {
        throw new Error("The runner is replaced in these tests.");
      },
    },
  };
});

jest.mock("../../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      mergeDiscoveredDetails: () => {
        throw new Error("The writer is replaced in these tests.");
      },
    },
  };
});

const HOUR: number = 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-17T12:00:00.000Z");

const PROJECT_A: string = "a1000000-0000-4000-8000-000000000001";
const PROJECT_B: string = "a1000000-0000-4000-8000-000000000002";
const DEVICE: string = "c3000000-0000-4000-8000-000000000001";
const ENDPOINT: string = "e4000000-0000-4000-8000-000000000001";
const OTHER_ENDPOINT: string = "e4000000-0000-4000-8000-000000000002";

function rowOf(
  fields: Partial<ClassifiedDiscoveredDevice> = {},
): ClassifiedDiscoveredDevice {
  return {
    id: ENDPOINT,
    name: "PROFUSION-733451",
    macAddress: "20:4b:22:91:d7:21",
    ipAddress: "10.34.15.10",
    hostname: "PROFUSION-733451",
    vendor: "Sunnovo International",
    isSeenRecently: true,
    isFromController: true,
    isHidden: false,
    monitoredDevice: { id: DEVICE },
    monitoredBy: DiscoveredDeviceMatch.IpAddress,
    ...fields,
  };
}

function storedFrom(data: {
  endpointId?: string;
  name?: string;
  vendor?: string;
  clientName?: string;
  readAt?: Date;
}): Record<string, unknown> {
  return buildDiscoveredListEntries({
    reading: {
      endpointId: data.endpointId || ENDPOINT,
      name: data.name ?? "PROFUSION-733451",
      vendor: data.vendor,
      clientName: data.clientName,
    },
    readAt: data.readAt || new Date(NOW.getTime() - HOUR),
  });
}

function plan(
  row: ClassifiedDiscoveredDevice,
  storedDetails: unknown,
  now: Date = NOW,
): DiscoveredDetailsMerge | null {
  const match: MatchedDiscoveredDevice = {
    deviceId: DEVICE,
    row: row,
    storedDetails: storedDetails,
  };

  return planDiscoveredListPatch({ match: match, now: now });
}

describe("planDiscoveredListPatch: what one device needs", () => {
  test("a device that knows nothing yet is filled in - the backfill of one imported before #9305", () => {
    expect(plan(rowOf(), null)).toEqual({
      deviceId: DEVICE,
      set: storedFrom({
        vendor: "Sunnovo International",
        clientName: "PROFUSION-733451",
        readAt: NOW,
      }),
    });
  });

  test("a device that already says what the row says is left alone", () => {
    expect(
      plan(
        rowOf(),
        storedFrom({
          vendor: "Sunnovo International",
          clientName: "PROFUSION-733451",
        }),
      ),
    ).toBeNull();
  });

  test("the list's newer word replaces the one it gave before", () => {
    const patch: DiscoveredDetailsMerge | null = plan(
      rowOf({ vendor: "Zebra Technologies" }),
      storedFrom({
        vendor: "Sunnovo International",
        clientName: "PROFUSION-733451",
      }),
    );

    expect(patch?.unset).toBeUndefined();
    expect(Object.keys(patch?.set || {})).toEqual(["vendor"]);
    expect(
      (patch?.set?.["vendor"] as { value: string } | undefined)?.value,
    ).toBe("Zebra Technologies");
  });

  test("a field the row no longer has is dropped; the others stay", () => {
    expect(
      plan(
        rowOf({ hostname: undefined }),
        storedFrom({
          vendor: "Sunnovo International",
          clientName: "PROFUSION-733451",
        }),
      ),
    ).toEqual({ deviceId: DEVICE, unset: ["clientName"] });
  });

  test("matched to another row now, or the row renamed: written again with its source", () => {
    const fromOther: DiscoveredDetailsMerge | null = plan(
      rowOf(),
      storedFrom({
        endpointId: OTHER_ENDPOINT,
        vendor: "Sunnovo International",
        clientName: "PROFUSION-733451",
      }),
    );

    expect(Object.keys(fromOther?.set || {}).sort()).toEqual([
      "clientName",
      "vendor",
    ]);

    const renamed: DiscoveredDetailsMerge | null = plan(
      rowOf({ name: "Front till" }),
      storedFrom({
        vendor: "Sunnovo International",
        clientName: "PROFUSION-733451",
      }),
    );

    expect(
      (
        renamed?.set?.["vendor"] as
          | { readBy: { type: string; name: string } }
          | undefined
      )?.readBy,
    ).toEqual({
      type: NetworkDeviceDiscoveryReaderType.DiscoveredDevice,
      id: ENDPOINT,
      name: "Front till",
    });
  });

  test("once a day, the same word is written again so its time stays true", () => {
    const stored: Record<string, unknown> = storedFrom({
      vendor: "Sunnovo International",
      clientName: "PROFUSION-733451",
      readAt: new Date(NOW.getTime() - DISCOVERED_LIST_ENTRY_REFRESH_MS),
    });

    expect(Object.keys(plan(rowOf(), stored)?.set || {}).sort()).toEqual([
      "clientName",
      "vendor",
    ]);

    // A time in the future is no reading to keep either.
    expect(
      plan(
        rowOf(),
        storedFrom({
          vendor: "Sunnovo International",
          clientName: "PROFUSION-733451",
          readAt: new Date(NOW.getTime() + HOUR),
        }),
      ),
    ).not.toBeNull();
  });

  test("nothing else of the device's discovered details is touched", () => {
    const sysName: unknown = buildDiscoveredValue({
      field: NetworkDeviceDiscoveredField.SystemName,
      value: "till-01",
      readBy: {
        type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
        id: "f5000000-0000-4000-8000-000000000001",
        name: "Store subnets",
      },
      readAt: NOW,
    });
    const patch: DiscoveredDetailsMerge | null = plan(rowOf(), {
      sysName: sysName,
    });

    expect(Object.keys(patch?.set || {}).sort()).toEqual([
      "clientName",
      "vendor",
    ]);
    expect(patch?.unset).toBeUndefined();
  });

  test("a row with nothing to say, on a device that holds nothing of it, needs nothing", () => {
    expect(
      plan(rowOf({ vendor: undefined, hostname: undefined }), {}),
    ).toBeNull();
  });

  test("a row without an id, or a device id that is not one, is never planned", () => {
    expect(plan(rowOf({ id: "" }), null)).toBeNull();
    expect(
      planDiscoveredListPatch({
        match: { deviceId: "nope", row: rowOf(), storedDetails: null },
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("the statements", () => {
  test("the projects: both a discovered and a monitored device, after a cursor, as parameters", () => {
    const statement: DiscoveredDeviceStatement = buildSyncProjectsStatement({
      afterProjectId: PROJECT_A,
      limit: 100,
    });

    expect(statement.sql).toContain(`FROM "NetworkEndpoint" e`);
    expect(statement.sql).toContain(`FROM "NetworkDevice" d`);
    expect(statement.sql).toContain(`p."_id" > $1::uuid`);
    expect(statement.sql).not.toContain(PROJECT_A);
    expect(statement.params).toEqual([PROJECT_A, 100]);
  });

  test("the matched devices: one row each, by MAC first, then the one seen last, after a cursor", () => {
    const statement: DiscoveredDeviceStatement = buildMatchedDevicesStatement({
      projectId: new ObjectID(PROJECT_A),
      afterDeviceId: DEVICE,
      limit: 1000,
    });

    expect(statement.sql).toContain(
      `SELECT DISTINCT ON (c."monitoredDeviceId")`,
    );
    expect(statement.sql).toContain(`(c."monitoredBy" = 'macAddress') DESC`);
    expect(statement.sql).toContain(`c."lastSeenAt" DESC NULLS LAST`);
    expect(statement.sql).toContain(`d."discoveredDetails" AS "storedDetails"`);
    expect(statement.sql).not.toContain(DEVICE);
    expect(statement.sql).not.toContain(PROJECT_A);
    expect(statement.params[0]).toBe(PROJECT_A);
    expect(statement.params).toContain(DEVICE);
    expect(statement.params[statement.params.length - 1]).toBe(1000);
  });
});

interface Ran {
  sql: string;
  params: Array<unknown>;
}

function matchedRaw(deviceId: string, vendor: string): Record<string, unknown> {
  return {
    id: ENDPOINT,
    macAddress: "20:4b:22:91:d7:21",
    ipAddress: "10.34.15.10",
    vendor: vendor,
    monitoredDeviceId: deviceId,
    monitoredBy: "macAddress",
    storedDetails: null,
  };
}

function deviceIdOf(index: number): string {
  return `c3000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

describe("a run", () => {
  let ran: Array<Ran>;
  let merged: Array<{
    projectId: string;
    patches: Array<DiscoveredDetailsMerge>;
  }>;
  let clock: number;
  let projects: Array<string>;
  let devicesByProject: Record<string, number>;
  let failingProject: string | undefined;
  let mergeDetails: typeof DiscoveredDeviceInventorySync.mergeDetails;
  let runQuery: typeof DiscoveredDeviceInventorySync.runQuery;
  let now: typeof DiscoveredDeviceInventorySync.now;
  let listNow: typeof DiscoveredDevices.now;

  beforeEach(() => {
    ran = [];
    merged = [];
    clock = NOW.getTime();
    projects = [PROJECT_A, PROJECT_B];
    devicesByProject = { [PROJECT_A]: 2, [PROJECT_B]: 1 };
    failingProject = undefined;
    DiscoveredDeviceInventorySync.cursor = undefined;

    mergeDetails = DiscoveredDeviceInventorySync.mergeDetails;
    runQuery = DiscoveredDeviceInventorySync.runQuery;
    now = DiscoveredDeviceInventorySync.now;
    listNow = DiscoveredDevices.now;

    DiscoveredDevices.now = (): Date => {
      return new Date(clock);
    };
    DiscoveredDeviceInventorySync.now = (): Date => {
      return new Date(clock);
    };
    DiscoveredDeviceInventorySync.mergeDetails = async (data: {
      projectId: ObjectID;
      patches: Array<DiscoveredDetailsMerge>;
    }): Promise<number> => {
      merged.push({
        projectId: data.projectId.toString(),
        patches: data.patches,
      });
      return data.patches.length;
    };
    DiscoveredDeviceInventorySync.runQuery = async (
      sql: string,
      params: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      ran.push({ sql: sql, params: params });

      if (sql.startsWith(`SELECT p."_id"::text AS "projectId"`)) {
        const after: unknown = sql.includes(`p."_id" > $1`)
          ? params[0]
          : undefined;
        return projects
          .filter((id: string): boolean => {
            return !after || id > String(after);
          })
          .map((id: string): Record<string, unknown> => {
            return { projectId: id };
          });
      }

      const projectId: string = String(params[0]);

      if (projectId === failingProject) {
        throw new Error("connection terminated");
      }

      const after: string | undefined = sql.includes(`c."monitoredDeviceId" > `)
        ? String(params[params.length - 2])
        : undefined;
      const limit: number = Number(params[params.length - 1]);
      const rows: Array<Record<string, unknown>> = [];

      for (
        let index: number = 1;
        index <= devicesByProject[projectId]!;
        index++
      ) {
        const deviceId: string = deviceIdOf(index);

        if (!after || deviceId > after) {
          rows.push(matchedRaw(deviceId, "Sunnovo International"));
        }
      }

      return rows.slice(0, limit);
    };
  });

  afterEach(() => {
    DiscoveredDeviceInventorySync.mergeDetails = mergeDetails;
    DiscoveredDeviceInventorySync.runQuery = runQuery;
    DiscoveredDeviceInventorySync.now = now;
    DiscoveredDevices.now = listNow;
    DiscoveredDeviceInventorySync.cursor = undefined;
  });

  test("every matched device of every project is filled in, a project's devices in one write", async () => {
    const summary: DiscoveredDeviceInventorySyncSummary =
      await DiscoveredDeviceInventorySync.run();

    expect(summary).toEqual({
      projects: 2,
      failedProjects: 0,
      updatedDevices: 3,
      isCutShort: false,
    });
    expect(
      merged.map((write: { projectId: string; patches: Array<unknown> }) => {
        return [write.projectId, write.patches.length];
      }),
    ).toEqual([
      [PROJECT_A, 2],
      [PROJECT_B, 1],
    ]);
    expect(DiscoveredDeviceInventorySync.cursor).toBeUndefined();
  });

  test("a project of more devices than a page is read a page at a time, in id order", async () => {
    projects = [PROJECT_A];
    devicesByProject = { [PROJECT_A]: INVENTORY_SYNC_PAGE_SIZE + 5 };

    const summary: DiscoveredDeviceInventorySyncSummary =
      await DiscoveredDeviceInventorySync.run();

    expect(summary.updatedDevices).toBe(INVENTORY_SYNC_PAGE_SIZE + 5);
    expect(
      merged.map((write: { patches: Array<unknown> }) => {
        return write.patches.length;
      }),
    ).toEqual([INVENTORY_SYNC_PAGE_SIZE, 5]);

    const pages: Array<Ran> = ran.filter((statement: Ran): boolean => {
      return statement.sql.includes("matched AS");
    });

    expect(pages).toHaveLength(2);
    expect(pages[1]!.params).toContain(deviceIdOf(INVENTORY_SYNC_PAGE_SIZE));
  });

  test("when the time runs out, the next run carries on where this one stopped", async () => {
    projects = [PROJECT_A, PROJECT_B];
    devicesByProject = {
      [PROJECT_A]: INVENTORY_SYNC_PAGE_SIZE + 5,
      [PROJECT_B]: 1,
    };

    // Each statement takes a minute; the budget is a minute and a half.
    const timed: typeof DiscoveredDeviceInventorySync.runQuery =
      DiscoveredDeviceInventorySync.runQuery;
    DiscoveredDeviceInventorySync.runQuery = async (
      sql: string,
      params: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      clock += 60 * 1000;
      return await timed(sql, params);
    };

    const first: DiscoveredDeviceInventorySyncSummary =
      await DiscoveredDeviceInventorySync.run({ timeBudgetMs: 90 * 1000 });

    expect(first.isCutShort).toBe(true);
    expect(first.updatedDevices).toBe(INVENTORY_SYNC_PAGE_SIZE);
    expect(DiscoveredDeviceInventorySync.cursor).toEqual({
      projectId: PROJECT_A,
      afterDeviceId: deviceIdOf(INVENTORY_SYNC_PAGE_SIZE),
    });

    const second: DiscoveredDeviceInventorySyncSummary =
      await DiscoveredDeviceInventorySync.run({ timeBudgetMs: 60 * HOUR });

    expect(second).toEqual({
      projects: 2,
      failedProjects: 0,
      updatedDevices: 6,
      isCutShort: false,
    });
    expect(DiscoveredDeviceInventorySync.cursor).toBeUndefined();
  });

  test("one project's failure is logged and stops no other", async () => {
    failingProject = PROJECT_A;
    const errorSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    const summary: DiscoveredDeviceInventorySyncSummary =
      await DiscoveredDeviceInventorySync.run();

    expect(summary).toEqual({
      projects: 2,
      failedProjects: 1,
      updatedDevices: 1,
      isCutShort: false,
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("a project page short of the page size is the last page of projects", async () => {
    await DiscoveredDeviceInventorySync.run();

    expect(
      ran.filter((statement: Ran): boolean => {
        return statement.sql.startsWith(`SELECT p."_id"::text`);
      }),
    ).toHaveLength(1);
    expect(INVENTORY_SYNC_PROJECTS_PER_PAGE).toBeGreaterThan(projects.length);
  });
});
