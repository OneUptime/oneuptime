import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Encryption from "../../../Server/Utils/Encryption";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import URL from "../../../Types/API/URL";
import { isEncryptedValue } from "../../../Types/Database/EncryptedValue";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A URL COLUMN AND THE SECRET FIELDS OF A JSON LIST, KEPT ENCRYPTED THROUGH
 * DATABASESERVICE'S OWN WRITES AND READS (#9013, #9014).
 *
 * A status page subscriber's webhook is a URL; a discovery scan's SNMP
 * credential sets a JSON list. Through the real create, update and read
 * pipeline - a table in memory stands in for Postgres, holding each value
 * as the column's transformer would hand it over - each is stored
 * encrypted, read back as written, compared as written when an update
 * writes it back, and read as it is when it was stored before its column
 * was encrypted. A hook-free write stores it encrypted too, clamped to its
 * column first.
 */

jest.mock("../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: (): Promise<void> => {
        return Promise.resolve();
      },
      recordUpdate: (): Promise<void> => {
        return Promise.resolve();
      },
      recordDelete: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

const PROJECT_ID: string = "90130000-0000-4000-8000-000000000001";
const PAGE_ID: string = "90130000-0000-4000-8000-000000000002";
const SUBSCRIBER_ID: string = "90130000-0000-4000-8000-000000000003";
const SCAN_ID: string = "90140000-0000-4000-8000-000000000004";

const SLACK_HOOK: string =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
const OTHER_HOOK: string = "https://hooks.example.com/oneuptime/status";

const CONFIGS: Array<JSONObject> = [
  {
    id: "access",
    name: "Access switches",
    snmpVersion: "V2c",
    snmpCommunityString: "s3cr3t-community",
    snmpPort: 161,
  },
  {
    id: "core",
    snmpVersion: "V3",
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "monitoring",
    snmpV3AuthProtocol: "SHA",
    snmpV3AuthKey: "an auth passphrase",
    snmpV3PrivProtocol: "AES",
    snmpV3PrivKey: "a privacy passphrase",
  },
];

type Exposed<T extends StatusPageSubscriber | NetworkDeviceDiscoveryScan> =
  DatabaseService<T> & {
    getValueAsGiven: (data: unknown, column: string) => unknown;
  };

function permitEverything(): void {
  jest
    .spyOn(ModelPermission, "checkUpdatePermissionByModel")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ModelPermission, "checkUpdateQueryPermissions")
    .mockImplementation(((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    }) as never);
}

function quiet(
  service: DatabaseService<StatusPageSubscriber | NetworkDeviceDiscoveryScan>,
): { workflow: jest.SpiedFunction<() => Promise<void>> } {
  jest
    .spyOn(service, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);

  return {
    workflow: jest
      .spyOn(service, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never) as never,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a URL column kept encrypted (a status page subscriber's webhook)", () => {
  function subscribers(rows: Array<StoredRow> = []): {
    service: Exposed<StatusPageSubscriber>;
    table: InMemoryTable;
  } {
    const service: Exposed<StatusPageSubscriber> =
      new DatabaseService<StatusPageSubscriber>(
        StatusPageSubscriber,
      ) as Exposed<StatusPageSubscriber>;

    const table: InMemoryTable = useInMemoryTable(service, rows);
    quiet(service as never);
    permitEverything();

    return { service, table };
  }

  test("a create stores the address encrypted, and a read hands back the URL as written", async () => {
    const { service, table } = subscribers();

    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber.projectId = new ObjectID(PROJECT_ID);
    subscriber.statusPageId = new ObjectID(PAGE_ID);
    subscriber.subscriberWebhook = URL.fromString(SLACK_HOOK);

    const created: StatusPageSubscriber = await service.create({
      data: subscriber,
      props: { isRoot: true },
    });

    const stored: unknown = table.inserts[0]!["subscriberWebhook"];

    expect(isEncryptedValue(stored)).toBe(true);
    expect(String(stored)).not.toContain("hooks.slack.com");
    expect(await Encryption.decrypt(String(stored))).toBe(SLACK_HOOK);

    // What a hook after the encryption reads it as.
    const given: unknown = service.getValueAsGiven(
      created,
      "subscriberWebhook",
    );

    expect(given).toBeInstanceOf(URL);
    expect(String(given)).toBe(SLACK_HOOK);

    const read: StatusPageSubscriber | null = await service.findOneById({
      id: created.id!,
      select: { subscriberWebhook: true },
      props: { isRoot: true },
    });

    expect(read!.subscriberWebhook).toBeInstanceOf(URL);
    expect(read!.subscriberWebhook!.toString()).toBe(SLACK_HOOK);
  });

  test("an address stored before its column was encrypted reads as the URL it is", async () => {
    const { service } = subscribers([
      {
        _id: SUBSCRIBER_ID,
        projectId: new ObjectID(PROJECT_ID),
        // As the column's transformer reads a value that is not a ciphertext.
        subscriberWebhook: URL.fromString(SLACK_HOOK),
      },
    ]);

    const read: StatusPageSubscriber | null = await service.findOneById({
      id: new ObjectID(SUBSCRIBER_ID),
      select: { subscriberWebhook: true },
      props: { isRoot: true },
    });

    expect(read!.subscriberWebhook!.toString()).toBe(SLACK_HOOK);
  });

  test("writing the address back as the row holds it is no change, and a new one is stored encrypted", async () => {
    const { service, table } = subscribers([
      {
        _id: SUBSCRIBER_ID,
        projectId: new ObjectID(PROJECT_ID),
        subscriberWebhook: await Encryption.encrypt(SLACK_HOOK),
      },
    ]);
    const workflow: jest.SpiedFunction<() => Promise<void>> = jest.spyOn(
      service,
      "onTriggerWorkflow",
    ) as never;

    await service.updateOneById({
      id: new ObjectID(SUBSCRIBER_ID),
      data: { subscriberWebhook: URL.fromString(SLACK_HOOK) } as never,
      props: { isRoot: true },
    });

    expect(workflow).not.toHaveBeenCalled();

    await service.updateOneById({
      id: new ObjectID(SUBSCRIBER_ID),
      data: { subscriberWebhook: URL.fromString(OTHER_HOOK) } as never,
      props: { isRoot: true },
    });

    const stored: unknown = table.get(SUBSCRIBER_ID)!["subscriberWebhook"];

    expect(isEncryptedValue(stored)).toBe(true);
    expect(await Encryption.decrypt(String(stored))).toBe(OTHER_HOOK);
  });

  test("an address that is not one is refused, as the column refuses it unencrypted", async () => {
    const { service, table } = subscribers();

    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber.projectId = new ObjectID(PROJECT_ID);
    (subscriber as unknown as JSONObject)["subscriberWebhook"] =
      "javascript:alert(1)";

    await expect(
      service.create({ data: subscriber, props: { isRoot: true } }),
    ).rejects.toThrow();
    expect(table.inserts).toHaveLength(0);
  });
});

describe("a JSON list with encrypted fields (a discovery scan's credential sets)", () => {
  function scans(rows: Array<StoredRow> = []): {
    service: Exposed<NetworkDeviceDiscoveryScan>;
    table: InMemoryTable;
  } {
    const service: Exposed<NetworkDeviceDiscoveryScan> =
      new DatabaseService<NetworkDeviceDiscoveryScan>(
        NetworkDeviceDiscoveryScan,
      ) as Exposed<NetworkDeviceDiscoveryScan>;

    const table: InMemoryTable = useInMemoryTable(service, rows);
    quiet(service as never);
    permitEverything();

    return { service, table };
  }

  test("a create stores each set's secrets encrypted, in the list's own shape, and a read hands back the list as written", async () => {
    const { service, table } = scans();

    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.projectId = new ObjectID(PROJECT_ID);
    scan.probeId = new ObjectID("90140000-0000-4000-8000-000000000005");
    scan.cidr = "10.20.30.0/24";
    const given: Array<JSONObject> = JSON.parse(JSON.stringify(CONFIGS));
    scan.snmpConfigs = given;
    scan.snmpCommunityString = "s3cr3t-community";

    const created: NetworkDeviceDiscoveryScan = await service.create({
      data: scan,
      props: { isRoot: true },
    });

    const stored: Array<JSONObject> = table.inserts[0]![
      "snmpConfigs"
    ] as Array<JSONObject>;

    expect(stored).toHaveLength(2);
    expect(isEncryptedValue(stored[0]!["snmpCommunityString"])).toBe(true);
    expect(isEncryptedValue(stored[1]!["snmpV3AuthKey"])).toBe(true);
    expect(isEncryptedValue(stored[1]!["snmpV3PrivKey"])).toBe(true);
    expect(stored[1]!["snmpV3Username"]).toBe("monitoring");
    expect(stored[0]!["name"]).toBe("Access switches");
    expect(isEncryptedValue(table.inserts[0]!["snmpCommunityString"])).toBe(
      true,
    );

    /*
     * The list the create was given is as it was given: the record holds a
     * new list, the one stored, and the hooks read the one given.
     */
    expect(given).toEqual(CONFIGS);
    expect(created.snmpConfigs).not.toBe(given);
    expect(service.getValueAsGiven(created, "snmpConfigs")).toBe(given);

    const read: NetworkDeviceDiscoveryScan | null = await service.findOneById({
      id: created.id!,
      select: { snmpConfigs: true, snmpCommunityString: true },
      props: { isRoot: true },
    });

    expect(read!.snmpConfigs).toEqual(CONFIGS);
    expect(read!.snmpCommunityString).toBe("s3cr3t-community");
  });

  test("a list stored before its column was encrypted reads as written", async () => {
    const { service } = scans([
      {
        _id: SCAN_ID,
        projectId: new ObjectID(PROJECT_ID),
        snmpConfigs: JSON.parse(JSON.stringify(CONFIGS)),
        snmpCommunityString: "s3cr3t-community",
      },
    ]);

    const read: NetworkDeviceDiscoveryScan | null = await service.findOneById({
      id: new ObjectID(SCAN_ID),
      select: { snmpConfigs: true, snmpCommunityString: true },
      props: { isRoot: true },
    });

    expect(read!.snmpConfigs).toEqual(CONFIGS);
    expect(read!.snmpCommunityString).toBe("s3cr3t-community");
  });
});

describe("a hook-free write", () => {
  interface CapturedQuery {
    sql: string;
    params: Array<unknown>;
  }

  function fakeRepository(
    model: NetworkDeviceDiscoveryScan | ProjectCallSMSConfig,
    captured: Array<CapturedQuery>,
  ): unknown {
    return {
      metadata: {
        tableName: model.tableName,
        findColumnWithPropertyName: (
          propertyName: string,
        ): { databaseName: string } | undefined => {
          return model.hasColumn(propertyName)
            ? { databaseName: propertyName }
            : undefined;
        },
        updateDateColumn: { databaseName: "updatedAt" },
        primaryColumns: [{ databaseName: "_id" }],
      },
      manager: {
        connection: {
          driver: {
            preparePersistentValue: (value: unknown): unknown => {
              return value;
            },
          },
        },
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<Array<unknown>> => {
          captured.push({ sql, params });
          return [{ _id: "x" }];
        },
      },
    };
  }

  test("stores an encrypted column encrypted, as a write through the service does: a scan's rebuilt credential list", async () => {
    const service: DatabaseService<NetworkDeviceDiscoveryScan> =
      new DatabaseService<NetworkDeviceDiscoveryScan>(
        NetworkDeviceDiscoveryScan,
      );
    const captured: Array<CapturedQuery> = [];

    jest
      .spyOn(service, "getRepository")
      .mockReturnValue(
        fakeRepository(new NetworkDeviceDiscoveryScan(), captured) as never,
      );

    const configs: Array<JSONObject> = JSON.parse(JSON.stringify(CONFIGS));

    await service.updateColumnsByIdWithoutHooks({
      id: new ObjectID(SCAN_ID),
      data: {
        snmpConfigs: configs,
        snmpCommunityString: "s3cr3t-community",
        status: "Pending",
      } as never,
    });

    expect(captured).toHaveLength(1);

    const params: Array<unknown> = captured[0]!.params;
    const storedConfigs: Array<JSONObject> = params.find(
      (param: unknown): boolean => {
        return Array.isArray(param);
      },
    ) as Array<JSONObject>;

    expect(isEncryptedValue(storedConfigs[0]!["snmpCommunityString"])).toBe(
      true,
    );
    expect(isEncryptedValue(storedConfigs[1]!["snmpV3PrivKey"])).toBe(true);
    expect(
      params.some((param: unknown): boolean => {
        return param === "s3cr3t-community";
      }),
    ).toBe(false);
    expect(
      params.some((param: unknown): boolean => {
        return isEncryptedValue(param);
      }),
    ).toBe(true);
    expect(params).toContain("Pending");

    // The caller's own list is left as it gave it.
    expect(configs).toEqual(CONFIGS);
  });

  test("clamps a value to its column before it encrypts it, so a ciphertext is never cut", async () => {
    const service: DatabaseService<ProjectCallSMSConfig> =
      new DatabaseService<ProjectCallSMSConfig>(ProjectCallSMSConfig);
    const captured: Array<CapturedQuery> = [];

    jest
      .spyOn(service, "getRepository")
      .mockReturnValue(
        fakeRepository(new ProjectCallSMSConfig(), captured) as never,
      );

    // The token's column declares 500 characters.
    await service.updateColumnsByIdWithoutHooks({
      id: new ObjectID(SCAN_ID),
      data: { twilioAuthToken: "t".repeat(600) } as never,
    });

    const stored: string = captured[0]!.params.find((param: unknown) => {
      return isEncryptedValue(param);
    }) as string;

    expect(await Encryption.decrypt(stored)).toBe("t".repeat(500));
  });

  test("compare-and-set and the unlocked write encrypt it too", async () => {
    const service: DatabaseService<NetworkDeviceDiscoveryScan> =
      new DatabaseService<NetworkDeviceDiscoveryScan>(
        NetworkDeviceDiscoveryScan,
      );
    const captured: Array<CapturedQuery> = [];

    jest
      .spyOn(service, "getRepository")
      .mockReturnValue(
        fakeRepository(new NetworkDeviceDiscoveryScan(), captured) as never,
      );

    await service.compareAndSetColumnsByIdWithoutHooks({
      id: new ObjectID(SCAN_ID),
      data: { snmpV3AuthKey: "an auth passphrase" } as never,
      expectedData: { status: "Pending" } as never,
    });
    await service.updateColumnsByIdIfUnlockedWithoutHooks({
      id: new ObjectID(SCAN_ID),
      data: { snmpV3PrivKey: "a privacy passphrase" } as never,
    });

    for (const query of captured) {
      expect(
        query.params.some((param: unknown): boolean => {
          return (
            param === "an auth passphrase" || param === "a privacy passphrase"
          );
        }),
      ).toBe(false);
      expect(
        query.params.some((param: unknown): boolean => {
          return isEncryptedValue(param);
        }),
      ).toBe(true);
    }
  });
});
