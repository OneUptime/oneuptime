import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import { isEncryptedValue } from "../../../Types/Database/EncryptedValue";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DISCOVERY SCAN'S EDIT IS JUDGED BY ITS CREDENTIALS AS WRITTEN, NOT BY
 * THE CIPHERTEXT STORED (#9014).
 *
 * An edit that changes what the probe sweeps - its range, its method, its
 * credentials (SWEEP_COLUMNS) - retires the scan's results and queues it
 * again; one that writes them back as they were, which the edit form does
 * on every save, keeps them. With the credentials kept encrypted, the scan
 * the service compares with is read decrypted and the edit is compared as
 * given: the same credential list saved back is no change, whatever salt
 * the row's ciphertext holds, and a changed one is. Through the real
 * service, over a table in memory holding the scan as DatabaseService
 * stores it; the follow-up write that retires a run is recorded.
 */

jest.mock("../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "90140000-0000-4000-8000-000000000401",
);
const PROBE_ID: ObjectID = new ObjectID("90140000-0000-4000-8000-000000000402");
const SCAN_ID: string = "90140000-0000-4000-8000-000000000403";

const SNMP_CONFIGS: Array<JSONObject> = [
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
    snmpPort: 161,
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "monitoring",
    snmpV3AuthProtocol: "SHA",
    snmpV3AuthKey: "an auth passphrase",
    snmpV3PrivProtocol: "AES",
    snmpV3PrivKey: "a privacy passphrase",
  },
];

let scans: InMemoryTable;
let followUps: Array<JSONObject>;

beforeEach(async () => {
  const credentials: StoredRow = {
    snmpConfigs: JSON.parse(JSON.stringify(SNMP_CONFIGS)),
    snmpVersion: "V2c",
    snmpCommunityString: "s3cr3t-community",
    snmpPort: 161,
  };

  await (
    NetworkDeviceDiscoveryScanService as unknown as {
      encrypt: (data: StoredRow) => Promise<unknown>;
    }
  ).encrypt(credentials);

  scans = useInMemoryTable(NetworkDeviceDiscoveryScanService, [
    {
      _id: SCAN_ID,
      projectId: PROJECT_ID,
      probeId: PROBE_ID,
      name: "Campus",
      cidr: "10.0.0.0/24",
      isSnmpEnabled: true,
      status: "Completed",
      completedAt: new Date(),
      discoveredDevices: [{ ipAddress: "10.0.0.5", snmpReachable: true }],
      ...credentials,
    },
  ]);

  followUps = [];

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (input: JSONObject): Promise<void> => {
      followUps.push(input);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function edit(snmpConfigs: Array<JSONObject>): Promise<void> {
  await NetworkDeviceDiscoveryScanService.updateOneById({
    id: new ObjectID(SCAN_ID),
    // Cast: the model's JSON column makes DeepPartial recursion blow up.
    data: {
      snmpConfigs: JSON.parse(JSON.stringify(snmpConfigs)),
    } as never,
    props: { isRoot: true },
  });
}

function retired(): boolean {
  return followUps.some((input: JSONObject): boolean => {
    return (input["data"] as JSONObject)["status"] === "Pending";
  });
}

describe("a discovery scan's edit", () => {
  test("saving its credential list back as it was keeps its results", async () => {
    await edit(SNMP_CONFIGS);

    expect(retired()).toBe(false);

    // Stored encrypted again, in the list's own shape.
    const stored: Array<JSONObject> = scans.get(SCAN_ID)![
      "snmpConfigs"
    ] as Array<JSONObject>;
    expect(isEncryptedValue(stored[0]!["snmpCommunityString"])).toBe(true);
    expect(isEncryptedValue(stored[1]!["snmpV3PrivKey"])).toBe(true);
    expect(stored[1]!["snmpV3Username"]).toBe("monitoring");
  });

  test("a changed credential retires its results and queues it again", async () => {
    const changed: Array<JSONObject> = JSON.parse(JSON.stringify(SNMP_CONFIGS));
    changed[1]!["snmpV3PrivKey"] = "a new privacy passphrase";

    await edit(changed);

    expect(retired()).toBe(true);
  });

  test("a changed community string, mirrored onto the flattened column, does too", async () => {
    const changed: Array<JSONObject> = JSON.parse(JSON.stringify(SNMP_CONFIGS));
    changed[0]!["snmpCommunityString"] = "a new community";

    await edit(changed);

    expect(retired()).toBe(true);
  });
});
