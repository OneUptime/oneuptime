import DeclaredDataStores, {
  ADDRESS_VAULT_STORE_GRACE_IN_DAYS,
  DECLARED_STORE_DISCOVERED_FROM,
  DECLARED_STORE_SEEN_REFRESH_IN_MS,
  DeclaredStoreChange,
  DeclaredStoresResult,
} from "../../../../Server/Utils/DataSecurity/DeclaredDataStores";
import SecurityEventRetention from "../../../../Server/Utils/SecurityEvent/SecurityEventRetention";
import SecurityEventsReadTelemetry, {
  SecurityEventsReadSignal,
} from "../../../../Server/Utils/SecurityEvent/SecurityEventsReadTelemetry";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import LogScrubRuleService from "../../../../Server/Services/LogScrubRuleService";
import NetworkFlowService from "../../../../Server/Services/NetworkFlowService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import TraceScrubRuleService from "../../../../Server/Services/TraceScrubRuleService";
import logger from "../../../../Server/Utils/Logger";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import LogScrubRule from "../../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../../Models/DatabaseModels/TraceScrubRule";
import NetworkFlow from "../../../../Models/AnalyticsModels/NetworkFlow";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import Includes from "../../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../../Types/Date";
import { DataSecurityDeclaredStore } from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import {
  DECLARED_DATA_STORE_KINDS,
  DataStoreFamily,
  DataStoreKind,
  DataStoreProvider,
} from "../../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../../Types/DataSecurity/DataStorePosture";
import {
  DECLARED_DATA_STORES,
  DECLARED_STORE_PURPOSE,
  DeclaredDataStoreInfo,
  DeclaredStoreReaders,
  DeclaredStoreRetentionBasis,
  SECURITY_EVENTS_SCANS_ONLY_TEXT,
  getDeclaredDataStore,
} from "../../../../Types/DataSecurity/DeclaredDataStore";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../../Types/Permission";
import { SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS } from "../../../../Types/SecurityEvent/SecurityAddressVaultRetention";
import { NETWORK_FLOW_RETENTION_IN_DAYS } from "../../../../Types/NetFlow/NetworkFlowRetention";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE STORES ONEUPTIME DECLARES FOR A PROJECT'S SECURITY (#10398).
 *
 * Security Events, Network Flows and Security Address Vault are data
 * stores of every project that has one: made the first time the project
 * has such data, kept while it does, archived once it has none - and
 * never by reading what they hold. The DataStore table is in memory here;
 * whether a project keeps events, flows or a Hash rule's addresses is
 * whatever each test says.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-11-22T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

let table: Array<DataStore>;
let holdsEvents: boolean | Error;
let holdsFlows: boolean | Error;
let logHashRule: boolean;
let traceHashRule: boolean;
let readsSignals: Set<SecurityEventsReadSignal>;
let eventRetentionInDays: number;

let createSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let archivedFeedSpy: jest.SpyInstance;
let restoredFeedSpy: jest.SpyInstance;
let eventsExistSpy: jest.SpyInstance;
let flowsExistSpy: jest.SpyInstance;
let logRuleSpy: jest.SpyInstance;
let traceRuleSpy: jest.SpyInstance;
let readsSpy: jest.SpyInstance;
let retentionSpy: jest.SpyInstance;

function infoOf(kind: DataStoreKind): DeclaredDataStoreInfo {
  return getDeclaredDataStore(kind)!;
}

function rowOf(kind: DataStoreKind): DataStore | undefined {
  return table.find((row: DataStore): boolean => {
    return row.storeKey === infoOf(kind).storeKey;
  });
}

// A store declared before, as the table keeps it.
function declaredRow(
  kind: DataStoreKind,
  columns: Partial<{
    isArchived: boolean;
    lastSeenAt: Date;
    purpose: string;
    retention: string;
    dataTypeIds: Array<string>;
  }> = {},
): DataStore {
  const info: DeclaredDataStoreInfo = infoOf(kind);
  const row: DataStore = new DataStore(ObjectID.generate());

  row.projectId = PROJECT_ID;
  row.storeKey = info.storeKey;
  row.name = info.name;
  row.kind = info.kind;
  row.provider = DataStoreProvider.OneUptime;
  row.discoveredFrom = DECLARED_STORE_DISCOVERED_FROM;
  row.dataTypeIds = columns.dataTypeIds || [...info.dataTypeIds];
  row.dataCategories = [...info.dataCategories];
  row.sensitivity = info.sensitivity;
  row.exposure = DataStoreExposure.Private;
  row.isArchived = Boolean(columns.isArchived);
  row.lastSeenAt = columns.lastSeenAt || NOW;

  if (columns.purpose !== undefined) {
    row.purpose = columns.purpose;
  }

  if (columns.retention !== undefined) {
    row.retention = columns.retention;
  }

  table.push(row);
  return row;
}

// What a declared row says of itself, column by column.
function factsOf(row: DataStore): Record<string, unknown> {
  return {
    projectId: row.projectId?.toString(),
    storeKey: row.storeKey,
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    family: row.family,
    discoveredFrom: row.discoveredFrom,
    dataTypeIds: row.dataTypeIds,
    dataCategories: row.dataCategories,
    sensitivity: row.sensitivity,
    exposure: row.exposure,
    isContentScanEnabled: row.isContentScanEnabled,
  };
}

function updatesOf(row: DataStore): Array<Record<string, unknown>> {
  return updateSpy.mock.calls
    .filter((call: Array<unknown>): boolean => {
      const by: { id: ObjectID } = call[0] as { id: ObjectID };
      return by.id.toString() === row.id!.toString();
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    });
}

beforeEach(() => {
  table = [];
  holdsEvents = false;
  holdsFlows = false;
  logHashRule = false;
  traceHashRule = false;
  readsSignals = new Set();
  eventRetentionInDays = 15;
  DeclaredDataStores.clearCache();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);

  jest.spyOn(DataStoreService, "findBy").mockImplementation((async (data: {
    query: { kind?: Includes };
  }) => {
    const kinds: Array<string> =
      (data.query.kind?.values as Array<string> | undefined) || [];

    return table.filter((row: DataStore): boolean => {
      return kinds.includes(row.kind || "");
    });
  }) as never);
  jest.spyOn(DataStoreService, "findOneBy").mockImplementation((async (data: {
    query: { storeKey: string };
  }) => {
    return (
      table.find((row: DataStore): boolean => {
        return row.storeKey === data.query.storeKey;
      }) || null
    );
  }) as never);
  createSpy = jest
    .spyOn(DataStoreService, "create")
    .mockImplementation((async (data: { data: DataStore }) => {
      const row: DataStore = data.data;
      row._id = ObjectID.generate().toString();
      table.push(row);
      return row;
    }) as never);
  updateSpy = jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: Record<string, unknown>;
    }) => {
      const row: DataStore | undefined = table.find(
        (candidate: DataStore): boolean => {
          return candidate.id!.toString() === data.id.toString();
        },
      );

      for (const [column, value] of Object.entries(data.data)) {
        row?.setColumnValue(column, value as never);
      }
    }) as never);
  archivedFeedSpy = jest
    .spyOn(DataStoreService, "writeArchivedFeed")
    .mockResolvedValue(undefined);
  restoredFeedSpy = jest
    .spyOn(DataStoreService, "writeRestoredFeed")
    .mockResolvedValue(undefined);

  eventsExistSpy = jest
    .spyOn(SecurityEventService, "existsBy")
    .mockImplementation((async () => {
      if (holdsEvents instanceof Error) {
        throw holdsEvents;
      }

      return holdsEvents;
    }) as never);
  flowsExistSpy = jest
    .spyOn(NetworkFlowService, "existsBy")
    .mockImplementation((async () => {
      if (holdsFlows instanceof Error) {
        throw holdsFlows;
      }

      return holdsFlows;
    }) as never);
  logRuleSpy = jest
    .spyOn(LogScrubRuleService, "findOneBy")
    .mockImplementation((async () => {
      return logHashRule ? new LogScrubRule(ObjectID.generate()) : null;
    }) as never);
  traceRuleSpy = jest
    .spyOn(TraceScrubRuleService, "findOneBy")
    .mockImplementation((async () => {
      return traceHashRule ? new TraceScrubRule(ObjectID.generate()) : null;
    }) as never);
  readsSpy = jest
    .spyOn(SecurityEventsReadTelemetry, "readsProjectTelemetry")
    .mockImplementation((async (data: { signal: SecurityEventsReadSignal }) => {
      return readsSignals.has(data.signal);
    }) as never);
  retentionSpy = jest
    .spyOn(SecurityEventRetention, "getRetentionInDays")
    .mockImplementation((async () => {
      return eventRetentionInDays;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project with security events and network flows", () => {
  test("gets a Security Events and a Network Flows store, each as OneUptime knows it by design", async () => {
    holdsEvents = true;
    holdsFlows = true;

    const result: DeclaredStoresResult =
      await DeclaredDataStores.declareProject(PROJECT_ID);

    expect(result).toEqual({
      [DataStoreKind.SecurityEvents]: DeclaredStoreChange.Created,
      [DataStoreKind.NetworkFlows]: DeclaredStoreChange.Created,
      [DataStoreKind.SecurityAddressVault]: DeclaredStoreChange.Unchanged,
    });

    const events: DataStore = rowOf(DataStoreKind.SecurityEvents)!;

    expect(factsOf(events)).toMatchObject({
      projectId: PROJECT_ID.toString(),
      storeKey: "oneuptime:security-events",
      name: "Security Events",
      kind: DataStoreKind.SecurityEvents,
      provider: DataStoreProvider.OneUptime,
      family: DataStoreFamily.SecurityRecords,
      discoveredFrom: "OneUptime",
      dataTypeIds: ["ip-address", "username", "email-address"],
      dataCategories: [DataCategory.ContactAndIdentity],
      sensitivity: DataSensitivity.Confidential,
      exposure: DataStoreExposure.Private,
      isContentScanEnabled: false,
    });
    expect(events.firstSeenAt).toEqual(NOW);
    expect(events.lastSeenAt).toEqual(NOW);
    // OneUptime's purpose and retention are filled in when read, never stored as the team's.
    expect(events.purpose).toBeUndefined();
    expect(events.retention).toBeUndefined();

    expect(factsOf(rowOf(DataStoreKind.NetworkFlows)!)).toMatchObject({
      storeKey: "oneuptime:network-flows",
      name: "Network Flows",
      kind: DataStoreKind.NetworkFlows,
      dataTypeIds: ["ip-address"],
      dataCategories: [DataCategory.ContactAndIdentity],
      sensitivity: DataSensitivity.Confidential,
    });
    expect(rowOf(DataStoreKind.SecurityAddressVault)).toBeUndefined();

    // As OneUptime, as discovery makes every store.
    for (const call of createSpy.mock.calls) {
      expect((call[0] as { props: { isRoot: boolean } }).props).toEqual({
        isRoot: true,
      });
    }
  });

  test("is asked only whether a row exists, never for an event or a flow", async () => {
    holdsEvents = true;
    holdsFlows = true;

    await DeclaredDataStores.declareProject(PROJECT_ID);

    expect(eventsExistSpy).toHaveBeenCalledTimes(1);
    expect(eventsExistSpy.mock.calls[0]![0]).toEqual({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });
    expect(flowsExistSpy).toHaveBeenCalledTimes(1);
    expect(flowsExistSpy.mock.calls[0]![0]).toEqual({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  test("is declared again without a second row, and only refreshed once an hour", async () => {
    holdsEvents = true;

    await DeclaredDataStores.declareProject(PROJECT_ID);
    const result: DeclaredStoresResult =
      await DeclaredDataStores.declareProject(PROJECT_ID);

    expect(result[DataStoreKind.SecurityEvents]).toBe(
      DeclaredStoreChange.Unchanged,
    );
    expect(
      table.filter((row: DataStore): boolean => {
        return row.kind === DataStoreKind.SecurityEvents;
      }),
    ).toHaveLength(1);
    expect(updateSpy).not.toHaveBeenCalled();

    // An hour on, it was seen again.
    const later: Date = new Date(
      NOW.getTime() + DECLARED_STORE_SEEN_REFRESH_IN_MS,
    );

    expect(
      (
        await DeclaredDataStores.declareProject(PROJECT_ID, { now: later })
      )[DataStoreKind.SecurityEvents],
    ).toBe(DeclaredStoreChange.Refreshed);
    expect(updatesOf(rowOf(DataStoreKind.SecurityEvents)!)).toEqual([
      { lastSeenAt: later },
    ]);
  });

  test("keeps what it holds as the code says it now, and never the team's purpose, retention or name", async () => {
    holdsEvents = true;
    const row: DataStore = declaredRow(DataStoreKind.SecurityEvents, {
      dataTypeIds: ["ip-address"],
      purpose: "Detecting and blocking attacks on our shop",
      retention: "90 days",
    });
    row.name = "SIEM events";

    await DeclaredDataStores.declareProject(PROJECT_ID);

    const written: Array<Record<string, unknown>> = updatesOf(row);

    expect(written).toEqual([
      {
        dataTypeIds: ["ip-address", "username", "email-address"],
        lastSeenAt: NOW,
      },
    ]);
    expect(row.purpose).toBe("Detecting and blocking attacks on our shop");
    expect(row.retention).toBe("90 days");
    expect(row.name).toBe("SIEM events");
  });

  test("a store another server declared first is not made twice", async () => {
    holdsEvents = true;
    createSpy.mockImplementationOnce((async (data: { data: DataStore }) => {
      // The other server's row is there by the time this one's insert fails.
      const raced: DataStore = data.data;
      raced._id = ObjectID.generate().toString();
      table.push(raced);
      throw new Error("duplicate key value violates unique constraint");
    }) as never);

    const result: DeclaredStoresResult =
      await DeclaredDataStores.declareProject(PROJECT_ID);

    expect(result[DataStoreKind.SecurityEvents]).toBe(
      DeclaredStoreChange.Unchanged,
    );
    expect(
      table.filter((row: DataStore): boolean => {
        return row.kind === DataStoreKind.SecurityEvents;
      }),
    ).toHaveLength(1);
  });
});

describe("a project with neither", () => {
  test("gets none of them", async () => {
    const result: DeclaredStoresResult =
      await DeclaredDataStores.declareProject(PROJECT_ID);

    expect(result).toEqual({
      [DataStoreKind.SecurityEvents]: DeclaredStoreChange.Unchanged,
      [DataStoreKind.NetworkFlows]: DeclaredStoreChange.Unchanged,
      [DataStoreKind.SecurityAddressVault]: DeclaredStoreChange.Unchanged,
    });
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(table).toEqual([]);
  });

  test("whose data could not be read is left as it was: nothing made from nothing, nothing archived for a hiccup", async () => {
    holdsEvents = new Error("ClickHouse is not reachable");
    holdsFlows = new Error("ClickHouse is not reachable");
    const flows: DataStore = declaredRow(DataStoreKind.NetworkFlows);

    const result: DeclaredStoresResult =
      await DeclaredDataStores.declareProject(PROJECT_ID);

    expect(result[DataStoreKind.SecurityEvents]).toBe(
      DeclaredStoreChange.Unknown,
    );
    expect(result[DataStoreKind.NetworkFlows]).toBe(
      DeclaredStoreChange.Unknown,
    );
    expect(createSpy).not.toHaveBeenCalled();
    expect(updatesOf(flows)).toEqual([]);
    expect(flows.isArchived).toBe(false);
  });
});

describe("a project whose data is gone", () => {
  test("has its Security Events and Network Flows stores archived, with its Timeline saying why", async () => {
    const events: DataStore = declaredRow(DataStoreKind.SecurityEvents, {
      purpose: "Our own words",
    });
    const flows: DataStore = declaredRow(DataStoreKind.NetworkFlows);

    const result: DeclaredStoresResult =
      await DeclaredDataStores.declareProject(PROJECT_ID);

    expect(result[DataStoreKind.SecurityEvents]).toBe(
      DeclaredStoreChange.Archived,
    );
    expect(result[DataStoreKind.NetworkFlows]).toBe(
      DeclaredStoreChange.Archived,
    );
    expect(events.isArchived).toBe(true);
    expect(flows.isArchived).toBe(true);
    // The team's words stay with the store.
    expect(events.purpose).toBe("Our own words");
    expect(archivedFeedSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dataStoreId: events.id,
      discoveredFrom: "OneUptime",
    });
  });

  test("gets it back with the team's purpose and retention when the data comes back", async () => {
    holdsEvents = true;
    const events: DataStore = declaredRow(DataStoreKind.SecurityEvents, {
      isArchived: true,
      lastSeenAt: new Date(NOW.getTime() - 40 * DAY_IN_MS),
      purpose: "Our own words",
      retention: "A year",
    });

    const result: DeclaredStoresResult =
      await DeclaredDataStores.declareProject(PROJECT_ID);

    expect(result[DataStoreKind.SecurityEvents]).toBe(
      DeclaredStoreChange.Restored,
    );
    expect(events.isArchived).toBe(false);
    expect(events.purpose).toBe("Our own words");
    expect(events.retention).toBe("A year");
    expect(updatesOf(events)).toEqual([
      { isArchived: false, lastSeenAt: NOW },
    ]);
    expect(restoredFeedSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dataStoreId: events.id,
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("leaves an archived store archived", async () => {
    declaredRow(DataStoreKind.SecurityEvents, { isArchived: true });

    const result: DeclaredStoresResult =
      await DeclaredDataStores.declareProject(PROJECT_ID);

    expect(result[DataStoreKind.SecurityEvents]).toBe(
      DeclaredStoreChange.Unchanged,
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(archivedFeedSpy).not.toHaveBeenCalled();
  });
});

describe("the address vault", () => {
  test("is declared while an enabled IP Address rule hashes logs Security Events reads", async () => {
    logHashRule = true;
    readsSignals = new Set(["log"]);

    const result: DeclaredStoresResult =
      await DeclaredDataStores.declareProject(PROJECT_ID);

    expect(result[DataStoreKind.SecurityAddressVault]).toBe(
      DeclaredStoreChange.Created,
    );
    expect(factsOf(rowOf(DataStoreKind.SecurityAddressVault)!)).toMatchObject({
      storeKey: "oneuptime:security-address-vault",
      name: "Security Address Vault",
      dataTypeIds: ["ip-address"],
      sensitivity: DataSensitivity.Confidential,
    });

    // The writer's own rule: enabled, IP Address, Hash.
    expect(logRuleSpy.mock.calls[0]![0]).toEqual({
      query: {
        projectId: PROJECT_ID,
        isEnabled: true,
        patternType: LogScrubPatternType.IPAddress,
        scrubAction: LogScrubAction.Hash,
      },
      select: { _id: true },
      props: { isRoot: true },
    });
    expect(readsSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      signal: "log",
    });
  });

  test("is declared while an enabled IP Address rule hashes traces Security Events reads", async () => {
    traceHashRule = true;
    readsSignals = new Set(["trace"]);

    expect(
      (await DeclaredDataStores.declareProject(PROJECT_ID))[
        DataStoreKind.SecurityAddressVault
      ],
    ).toBe(DeclaredStoreChange.Created);
    expect(traceRuleSpy.mock.calls[0]![0]).toMatchObject({
      query: {
        isEnabled: true,
        patternType: LogScrubPatternType.IPAddress,
        scrubAction: LogScrubAction.Hash,
      },
    });
  });

  test("is not declared for a Hash rule on telemetry Security Events does not read, nor without one", async () => {
    // A rule on logs, but Security Events reads only traces.
    logHashRule = true;
    readsSignals = new Set(["trace"]);

    expect(await DeclaredDataStores.isAddressVaultWritten(PROJECT_ID)).toBe(
      false,
    );

    // Security Events reads both, but no rule hashes: Redact and Mask keep nothing.
    logHashRule = false;
    readsSignals = new Set(["log", "trace"]);

    expect(await DeclaredDataStores.isAddressVaultWritten(PROJECT_ID)).toBe(
      false,
    );
    expect(rowOf(DataStoreKind.SecurityAddressVault)).toBeUndefined();
  });

  test("stays declared until every address written while it was is past the vault's 30 days", async () => {
    const vault: DataStore = declaredRow(DataStoreKind.SecurityAddressVault, {
      lastSeenAt: NOW,
    });
    const keptForDays: number =
      SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS +
      ADDRESS_VAULT_STORE_GRACE_IN_DAYS;

    // The Hash rule is gone; addresses are still in the vault for 30 days.
    const justBefore: Date = new Date(
      NOW.getTime() + keptForDays * DAY_IN_MS - 1,
    );

    expect(
      (
        await DeclaredDataStores.declareProject(PROJECT_ID, {
          now: justBefore,
        })
      )[DataStoreKind.SecurityAddressVault],
    ).toBe(DeclaredStoreChange.Unchanged);
    expect(vault.isArchived).toBe(false);

    const pastIt: Date = new Date(NOW.getTime() + keptForDays * DAY_IN_MS);

    expect(
      (await DeclaredDataStores.declareProject(PROJECT_ID, { now: pastIt }))[
        DataStoreKind.SecurityAddressVault
      ],
    ).toBe(DeclaredStoreChange.Archived);
    expect(vault.isArchived).toBe(true);
    expect(keptForDays).toBeGreaterThan(SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS);
  });
});

describe("declared before the record is read", () => {
  test("at most once a minute a project", async () => {
    holdsEvents = true;

    await DeclaredDataStores.declareBeforeRead(PROJECT_ID);
    await DeclaredDataStores.declareBeforeRead(PROJECT_ID);

    expect(eventsExistSpy).toHaveBeenCalledTimes(1);

    // Another project is its own.
    await DeclaredDataStores.declareBeforeRead(ObjectID.generate());

    expect(eventsExistSpy).toHaveBeenCalledTimes(2);
  });

  test("never in the way of the read", async () => {
    jest
      .spyOn(DataStoreService, "findBy")
      .mockRejectedValue(new Error("Postgres is restarting") as never);

    await expect(
      DeclaredDataStores.declareBeforeRead(PROJECT_ID),
    ).resolves.toBeUndefined();
  });
});

describe("what OneUptime declares of a store", () => {
  function storeOf(
    kind: DataStoreKind,
    columns: { purpose?: string; retention?: string } = {},
  ): DataStore {
    const store: DataStore = new DataStore(ObjectID.generate());
    store.kind = kind;

    if (columns.purpose !== undefined) {
      store.purpose = columns.purpose;
    }

    if (columns.retention !== undefined) {
      store.retention = columns.retention;
    }

    return store;
  }

  test("Security Events: its purpose, the project's retention for security events read now, and Security Events' roles", async () => {
    const declared: DataSecurityDeclaredStore | null =
      await DeclaredDataStores.describe({
        projectId: PROJECT_ID,
        store: storeOf(DataStoreKind.SecurityEvents),
      });

    expect(declared).toEqual({
      kind: DataStoreKind.SecurityEvents,
      purpose: "Network and information security (GDPR Recital 49)",
      retentionInDays: 15,
      retentionBasis: DeclaredStoreRetentionBasis.SecurityEvents,
      retentionText: "15 days",
      isPurposeTheTeams: false,
      isRetentionTheTeams: false,
      readers: DeclaredStoreReaders.Roles,
      readPermissions: [...new SecurityEvent().getReadPermissions()],
      readerNames: PermissionHelper.getPermissionTitles(
        new SecurityEvent().getReadPermissions(),
      ),
      dataTypeNames: ["IP address", "Username", "Email address"],
      fields: [
        "principalIp",
        "targetIp",
        "principalUser",
        "targetUser",
        "observables",
      ],
    });
    // Read fresh, as the Settings page shows it.
    expect(retentionSpy).toHaveBeenCalledWith(PROJECT_ID, { isFresh: true });
    // The Security tiers, and nothing broader: no Viewer, no Project Member.
    expect(declared!.readPermissions).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.SecurityAdmin,
        Permission.SecurityMember,
        Permission.SecurityViewer,
        Permission.ReadSecurityEvent,
      ]),
    );
    expect(declared!.readPermissions).not.toContain(Permission.Viewer);
    expect(declared!.readPermissions).not.toContain(Permission.ProjectMember);
  });

  test("a retention changed after the store was declared is the one said", async () => {
    eventRetentionInDays = 90;

    expect(
      (
        await DeclaredDataStores.describe({
          projectId: PROJECT_ID,
          store: storeOf(DataStoreKind.SecurityEvents),
        })
      )?.retentionText,
    ).toBe("90 days");

    eventRetentionInDays = 1;

    expect(
      (
        await DeclaredDataStores.describe({
          projectId: PROJECT_ID,
          store: storeOf(DataStoreKind.SecurityEvents),
        })
      )?.retentionText,
    ).toBe("1 day");
  });

  test("Network Flows: the table's own 30 days, read by whoever may read network devices", async () => {
    const declared: DataSecurityDeclaredStore | null =
      await DeclaredDataStores.describe({
        projectId: PROJECT_ID,
        store: storeOf(DataStoreKind.NetworkFlows),
      });

    expect(declared).toMatchObject({
      retentionInDays: NETWORK_FLOW_RETENTION_IN_DAYS,
      retentionText: "30 days",
      retentionBasis: DeclaredStoreRetentionBasis.NetworkFlows,
      readers: DeclaredStoreReaders.Roles,
      readPermissions: [...new NetworkFlow().getReadPermissions()],
      dataTypeNames: ["IP address"],
      fields: ["srcIp", "dstIp"],
    });
    expect(declared!.readPermissions).toContain(Permission.ReadNetworkDevice);
    // No setting of the project's: nothing is read for it.
    expect(retentionSpy).not.toHaveBeenCalled();
  });

  test("Security Address Vault: 30 days after an address was last seen, and only Security Events' scans read it", async () => {
    const declared: DataSecurityDeclaredStore | null =
      await DeclaredDataStores.describe({
        projectId: PROJECT_ID,
        store: storeOf(DataStoreKind.SecurityAddressVault),
      });

    expect(declared).toMatchObject({
      retentionInDays: SECURITY_ADDRESS_VAULT_RETENTION_IN_DAYS,
      retentionText: "30 days after an address was last seen",
      retentionBasis: DeclaredStoreRetentionBasis.AddressVault,
      readers: DeclaredStoreReaders.SecurityEventsScansOnly,
      readPermissions: [],
      readerNames: [],
      dataTypeNames: ["IP address"],
    });
    expect(DeclaredDataStores.getReadPermissions(DataStoreKind.SecurityAddressVault)).toEqual([]);
    expect(SECURITY_EVENTS_SCANS_ONLY_TEXT).toBe(
      "Only Security Events' scans, inside OneUptime",
    );
  });

  test("a purpose or a retention the team wrote is theirs, and kept", async () => {
    const store: DataStore = storeOf(DataStoreKind.SecurityEvents, {
      purpose: "Detecting and blocking attacks on our shop",
      retention: "  ",
    });
    const declared: DataSecurityDeclaredStore = (await DeclaredDataStores.describe({
      projectId: PROJECT_ID,
      store,
    }))!;

    expect(declared.isPurposeTheTeams).toBe(true);
    // Only spaces is no retention of theirs: OneUptime's stands.
    expect(declared.isRetentionTheTeams).toBe(false);
    expect(
      DeclaredDataStores.getRecordedPurposeAndRetention({ store, declared }),
    ).toEqual({
      purpose: "Detecting and blocking attacks on our shop",
      retention: "15 days",
    });
  });

  test("of a store it does not declare: nothing", async () => {
    for (const kind of [
      DataStoreKind.AwsS3Bucket,
      DataStoreKind.TelemetryLogs,
      DataStoreKind.PostgreSql,
    ]) {
      expect(
        await DeclaredDataStores.describe({
          projectId: PROJECT_ID,
          store: storeOf(kind),
        }),
      ).toBeNull();
    }
  });
});

describe("the declared stores' description", () => {
  test("is exactly the declared kinds, one each, each its own key", () => {
    expect(
      DECLARED_DATA_STORES.map((info: DeclaredDataStoreInfo): DataStoreKind => {
        return info.kind;
      }),
    ).toEqual([...DECLARED_DATA_STORE_KINDS]);
    expect(
      new Set(
        DECLARED_DATA_STORES.map((info: DeclaredDataStoreInfo): string => {
          return info.storeKey;
        }),
      ).size,
    ).toBe(DECLARED_DATA_STORE_KINDS.length);
  });

  test("names every store's purpose in GDPR's terms", () => {
    expect(DECLARED_STORE_PURPOSE).toBe(
      "Network and information security (GDPR Recital 49)",
    );
  });
});
