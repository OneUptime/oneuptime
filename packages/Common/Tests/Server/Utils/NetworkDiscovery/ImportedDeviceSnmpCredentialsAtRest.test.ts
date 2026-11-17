import DiscoveryImportRunner from "../../../../Server/Utils/NetworkDiscovery/DiscoveryImportRunner";
import NetworkDeviceAutoImportRuleEngineService from "../../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceDiscoveryScanService from "../../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceNamingRuleEngineService from "../../../../Server/Services/NetworkDeviceNamingRuleEngineService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import ProbeService from "../../../../Server/Services/ProbeService";
import Encryption from "../../../../Server/Utils/Encryption";
import NetworkDeviceHydrationUtil from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceAutoImportRule from "../../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceDiscoveryImport from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryImport";
import { DiscoveredNetworkDevice } from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { isEncryptedValue } from "../../../../Types/Database/EncryptedValue";
import { JSONObject } from "../../../../Types/JSON";
import {
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportStatus,
} from "../../../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { DiscoveryScanStatus } from "../../../../Utils/NetworkDiscovery/DiscoveryScanStatus";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DEVICE IMPORTED FROM A DISCOVERY SCAN IS CREATED WITH THE CREDENTIALS
 * THE SCAN WAS WRITTEN WITH, AND KEEPS THEM ENCRYPTED IN TURN (#9014).
 *
 * Both paths a scan's hosts become devices by - a person's import from
 * Review Results (DiscoveryImportRunner) and an auto-import rule
 * (NetworkDeviceAutoImportRuleEngineService) - read the scan through the
 * real service, from a table in memory that holds its credentials as
 * DatabaseService stores them (encrypted, the credential sets field by
 * field) or as written before they were, and create each device through
 * the real NetworkDeviceService into another. Each device row holds the
 * credentials of the set that answered its host encrypted - once, never a
 * ciphertext of the scan's ciphertext - and the poll reads them back as
 * the scan was written.
 */

jest.mock("../../../../Server/Services/AuditLogService", () => {
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

jest.mock("../../../../Server/Utils/Logger");

/*
 * The engine yields between scans with setImmediate, which jsdom (this
 * repo's jest environment) does not provide.
 */
if (typeof globalThis.setImmediate === "undefined") {
  (globalThis as Record<string, unknown>)["setImmediate"] = ((
    callback: () => void,
  ): ReturnType<typeof setTimeout> => {
    return setTimeout(callback, 0);
  }) as unknown as typeof globalThis.setImmediate;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "90140000-0000-4000-8000-000000000201",
);
const PERSON_ID: ObjectID = new ObjectID(
  "90140000-0000-4000-8000-000000000202",
);
const PROBE_ID: ObjectID = new ObjectID("90140000-0000-4000-8000-000000000203");
const SCAN_ID: ObjectID = new ObjectID("90140000-0000-4000-8000-000000000204");
const IMPORT_ID: ObjectID = new ObjectID(
  "90140000-0000-4000-8000-000000000205",
);
const RULE_ID: ObjectID = new ObjectID("90140000-0000-4000-8000-000000000206");

const COMMUNITY: string = "s3cr3t-community";
const AUTH_KEY: string = "an auth passphrase";
const PRIV_KEY: string = "a privacy passphrase";

const SNMP_CONFIGS: Array<JSONObject> = [
  {
    id: "access",
    name: "Access switches",
    snmpVersion: "V2c",
    snmpCommunityString: COMMUNITY,
    snmpPort: 161,
  },
  {
    id: "core",
    name: "Core routers",
    snmpVersion: "V3",
    snmpPort: 1161,
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "monitoring",
    snmpV3AuthProtocol: "SHA",
    snmpV3AuthKey: AUTH_KEY,
    snmpV3PrivProtocol: "AES",
    snmpV3PrivKey: PRIV_KEY,
  },
];

// One host answered by each credential set.
const ACCESS_SWITCH: DiscoveredNetworkDevice = {
  ipAddress: "10.0.0.5",
  snmpReachable: true,
  snmpConfigId: "access",
  sysName: "access-sw-01",
  sysDescr: "Cisco IOS Software, C2960X",
};
const CORE_ROUTER: DiscoveredNetworkDevice = {
  ipAddress: "10.0.0.6",
  snmpReachable: true,
  snmpConfigId: "core",
  sysName: "core-rtr-01",
  sysDescr: "Juniper Networks, Inc. mx204",
};

function personProps(): DatabaseCommonInteractionProps {
  const permissions: Array<UserPermission> = [
    Permission.CreateNetworkDevice,
    Permission.ReadNetworkDevice,
    Permission.ReadNetworkDeviceDiscoveryScan,
    Permission.ReadProbe,
  ].map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
    };
  });

  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions,
  };

  return {
    tenantId: PROJECT_ID,
    userId: PERSON_ID,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
  };
}

// The scan's row as DatabaseService stores what it is given.
async function storedScan(): Promise<StoredRow> {
  const record: StoredRow = {
    snmpConfigs: JSON.parse(JSON.stringify(SNMP_CONFIGS)),
    snmpVersion: "V2c",
    snmpCommunityString: COMMUNITY,
    snmpPort: 161,
  };

  await (
    NetworkDeviceDiscoveryScanService as unknown as {
      encrypt: (data: StoredRow) => Promise<unknown>;
    }
  ).encrypt(record);

  return record;
}

// The scan's row as it was written before its credentials were encrypted.
function scanAsWritten(): StoredRow {
  return {
    snmpConfigs: JSON.parse(JSON.stringify(SNMP_CONFIGS)),
    snmpVersion: "V2c",
    snmpCommunityString: COMMUNITY,
    snmpPort: 161,
  };
}

let scans: InMemoryTable;
let devices: InMemoryTable;
let scanCredentials: StoredRow;

async function useTables(credentials: StoredRow): Promise<void> {
  scanCredentials = JSON.parse(JSON.stringify(credentials));

  scans = useInMemoryTable(NetworkDeviceDiscoveryScanService, [
    {
      _id: SCAN_ID.toString(),
      projectId: PROJECT_ID,
      probeId: PROBE_ID,
      name: "Campus",
      cidr: "10.0.0.0/24",
      status: DiscoveryScanStatus.Completed,
      statusMessage: "Swept 254 hosts.",
      completedAt: new Date(),
      startedAt: new Date(Date.now() - 60_000),
      scannedHostCount: 254,
      respondedHostCount: 2,
      isSnmpEnabled: true,
      discoveredDevices: [ACCESS_SWITCH, CORE_ROUTER],
      ...credentials,
    },
  ]);

  devices = useInMemoryTable(NetworkDeviceService, []);

  // The scan's probe, which the builder puts on each device, is the project's.
  jest
    .spyOn(ProbeService, "isProbeAttachableToProject")
    .mockResolvedValue(true);

  // Nothing here names devices by rule: each under its discovered name.
  jest
    .spyOn(NetworkDeviceNamingRuleEngineService, "startImportSession")
    .mockResolvedValue(null as never);

  // The rules a new device starts, which reach other tables, run apart.
  jest
    .spyOn(
      NetworkDeviceService as unknown as {
        onCreateSuccess: (onCreate: unknown, created: unknown) => unknown;
      },
      "onCreateSuccess",
    )
    .mockImplementation(async (_onCreate: unknown, created: unknown) => {
      return created;
    });
}

function deviceAt(address: string): StoredRow {
  const row: StoredRow | undefined = devices.rows.find((device: StoredRow) => {
    return device["hostname"] === address;
  });

  expect(row).toBeDefined();

  return row!;
}

// Stored encrypted once: decrypted once, it is the value as written.
async function expectStoredOnce(stored: unknown, value: string): Promise<void> {
  expect(isEncryptedValue(stored)).toBe(true);
  expect(await Encryption.decrypt(stored as string)).toBe(value);
}

async function expectDevicesCreatedWithTheScansCredentials(): Promise<void> {
  expect(devices.inserts).toHaveLength(2);

  const accessSwitch: StoredRow = deviceAt(ACCESS_SWITCH.ipAddress);
  await expectStoredOnce(accessSwitch["snmpCommunityString"], COMMUNITY);
  expect(accessSwitch["snmpVersion"]).toBe("V2c");

  const coreRouter: StoredRow = deviceAt(CORE_ROUTER.ipAddress);
  await expectStoredOnce(coreRouter["snmpV3AuthKey"], AUTH_KEY);
  await expectStoredOnce(coreRouter["snmpV3PrivKey"], PRIV_KEY);
  expect(coreRouter["snmpV3Username"]).toBe("monitoring");
  expect(coreRouter["snmpPort"]).toBe(1161);

  // The poll reads each device's credentials as the scan was written.
  const read: Array<NetworkDevice> = await NetworkDeviceService.findBy({
    query: { projectId: PROJECT_ID },
    select: NetworkDeviceHydrationUtil.snmpConfigSelect,
    limit: 10,
    skip: 0,
    props: { isRoot: true },
  });

  const byAddress: Map<string, NetworkDevice> = new Map();

  for (const device of read) {
    byAddress.set(device.hostname!, device);
  }

  expect(byAddress.get(ACCESS_SWITCH.ipAddress)!.snmpCommunityString).toBe(
    COMMUNITY,
  );
  expect(byAddress.get(CORE_ROUTER.ipAddress)!.snmpV3AuthKey).toBe(AUTH_KEY);
  expect(byAddress.get(CORE_ROUTER.ipAddress)!.snmpV3PrivKey).toBe(PRIV_KEY);

  // The scan is as it was: an import writes none of its credentials.
  const scan: StoredRow = scans.get(SCAN_ID)!;
  expect(scans.updates).toEqual([]);

  for (const [column, value] of Object.entries(scanCredentials)) {
    expect(scan[column]).toEqual(value);
  }
}

const STORED: Array<[string, () => Promise<StoredRow>]> = [
  ["stored encrypted", storedScan],
  [
    "written before they were encrypted",
    async (): Promise<StoredRow> => {
      return scanAsWritten();
    },
  ],
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(STORED)(
  "a scan whose credentials are %s",
  (_label: string, credentials: () => Promise<StoredRow>) => {
    beforeEach(async () => {
      await useTables(await credentials());
    });

    test("a person's import from Review Results creates each device with its set's credentials, encrypted", async () => {
      jest
        .spyOn(
          DiscoveryImportRunner as unknown as {
            readPersonProps: () => Promise<DatabaseCommonInteractionProps>;
          },
          "readPersonProps",
        )
        .mockResolvedValue(personProps());

      const row: NetworkDeviceDiscoveryImport =
        new NetworkDeviceDiscoveryImport();
      row.id = IMPORT_ID;
      row.projectId = PROJECT_ID;
      row.networkDeviceDiscoveryScanId = SCAN_ID;
      row.status = DiscoveryImportStatus.Running;
      row.createdByUserId = PERSON_ID;
      row.settings = {
        pollingIntervalInMinutes: 5,
        applyVendorTemplates: false,
        alerting: DiscoveryImportAlerting.None,
      };
      row.hosts = [ACCESS_SWITCH, CORE_ROUTER];
      row.results = [];
      row.resumeCount = 0;

      const runner: {
        prepare: (row: NetworkDeviceDiscoveryImport) => Promise<{
          results: Array<DiscoveryImportHostResult>;
        }>;
        importHost: (state: unknown, index: number) => Promise<void>;
      } = DiscoveryImportRunner as never;

      const state: { results: Array<DiscoveryImportHostResult> } =
        await runner.prepare(row);

      await runner.importHost(state, 0);
      await runner.importHost(state, 1);

      expect(
        state.results.map((result: DiscoveryImportHostResult) => {
          return [result.device, result.deviceError];
        }),
      ).toEqual([
        [DiscoveryImportDeviceOutcome.Created, undefined],
        [DiscoveryImportDeviceOutcome.Created, undefined],
      ]);

      await expectDevicesCreatedWithTheScansCredentials();
    });

    test("an auto-import rule creates each device with its set's credentials, encrypted", async () => {
      const engine: Record<string, unknown> =
        NetworkDeviceAutoImportRuleEngineService as unknown as Record<
          string,
          unknown
        >;

      const rule: NetworkDeviceAutoImportRule = Object.assign(
        new NetworkDeviceAutoImportRule(),
        {
          id: RULE_ID,
          projectId: PROJECT_ID,
          name: "Import the campus",
          isEnabled: true,
          isExclusion: false,
          ipMatchTarget: "10.0.0.0/24",
        },
      );

      jest
        .spyOn(engine as never, "loadEnabledRules")
        .mockResolvedValue([rule] as never);
      // Of the devices already there, which this pass finds none of.
      jest
        .spyOn(engine as never, "improveDiscoveredDeviceNames")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(engine as never, "recordDiscoveredDetails")
        .mockResolvedValue(undefined as never);
      const stamp: jest.SpiedFunction<() => Promise<void>> = jest
        .spyOn(engine as never, "stampScan")
        .mockResolvedValue(undefined as never) as never;

      const result: { devicesCreated: number; devicesFailed: number } | null =
        (await NetworkDeviceAutoImportRuleEngineService.processCompletedScan({
          scanId: SCAN_ID,
          existingHostnamesByProjectId: new Map(),
        })) as never;

      expect(result).toMatchObject({ devicesCreated: 2, devicesFailed: 0 });
      expect(stamp).toHaveBeenCalledTimes(1);

      await expectDevicesCreatedWithTheScansCredentials();
    });
  },
);
