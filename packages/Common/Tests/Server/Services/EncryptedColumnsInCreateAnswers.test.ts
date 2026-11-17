import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import OpenStackProjectNoticeService from "../../../Server/Services/OpenStackProjectNoticeService";
import ProbeService from "../../../Server/Services/ProbeService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import OpenStackProjectNotice from "../../../Models/DatabaseModels/OpenStackProjectNotice";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
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
 * A CREATE ANSWERS WHAT IT WAS GIVEN, NEVER THE CIPHERTEXT IT STORES
 * (#9013, #9014).
 *
 * BaseAPI serializes the record a create hands back whole into the create's
 * answer, and a workflow's create step keeps it in the workflow's logs. A
 * webhook's address and a device's or a scan's SNMP credentials are stored
 * encrypted, so each service hands back, in their place, the values it was
 * given (DatabaseService.handBackAsGiven): what a read of the record gives
 * whoever may read it, and never a ciphertext nobody typed - one as good as
 * the value to whoever holds the server's encryption secret.
 */

jest.mock("../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: jest.fn(),
      recordUpdate: jest.fn(),
      recordDelete: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "90130000-0000-4000-8000-000000000701",
);
const USER_ID: ObjectID = new ObjectID("90130000-0000-4000-8000-000000000702");
const PROBE_ID: ObjectID = new ObjectID("90140000-0000-4000-8000-000000000703");
const CLOUD_ID: ObjectID = new ObjectID("90130000-0000-4000-8000-000000000704");

const METHOD_HOOK: string = "https://discord.com/api/webhooks/123/abcdefSECRET";
const CHANNEL_HOOK: string = "https://pager.example.internal/oneuptime";
const CHANNEL_SECRET: string = "c".repeat(64);
const NOTICE_HOOK: string = "https://notices.example.com/openstack/s3cr3t";
const COMMUNITY: string = "s3cr3t-community";
const AUTH_KEY: string = "an auth passphrase";
const PRIV_KEY: string = "a privacy passphrase";

const SNMP_CONFIGS: Array<JSONObject> = [
  {
    id: "core",
    snmpVersion: "V3",
    snmpPort: 161,
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "monitoring",
    snmpV3AuthProtocol: "SHA",
    snmpV3AuthKey: AUTH_KEY,
    snmpV3PrivProtocol: "AES",
    snmpV3PrivKey: PRIV_KEY,
  },
];

// Addresses are checked by the senders; DNS is not what this is about.
function approveAddresses(): void {
  jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined as never);
}

// The references a create names are the project's: not what this is about.
function permitReferences(): void {
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
}

function quietSuccessHooks(service: DatabaseService<never>): void {
  jest
    .spyOn(
      service as unknown as {
        onCreateSuccess: (onCreate: unknown, created: unknown) => unknown;
      },
      "onCreateSuccess",
    )
    .mockImplementation(async (_onCreate: unknown, created: unknown) => {
      return created;
    });
}

function storedOf(table: InMemoryTable): StoredRow {
  expect(table.inserts).toHaveLength(1);
  return table.inserts[0]!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a create's answer", () => {
  test("a webhook notification method's: its address as written", async () => {
    const table: InMemoryTable = useInMemoryTable(UserWebhookService, []);
    approveAddresses();

    const method: UserWebhook = new UserWebhook();
    method.projectId = PROJECT_ID;
    method.userId = USER_ID;
    method.name = "Pager bridge";
    method.webhookUrl = METHOD_HOOK;

    const created: UserWebhook = await UserWebhookService.create({
      data: method,
      props: { isRoot: true },
    });

    expect(isEncryptedValue(storedOf(table)["webhookUrl"])).toBe(true);
    expect(created.webhookUrl).toBe(METHOD_HOOK);
  });

  test("a custom notification channel's: its address and signing secret as written", async () => {
    const table: InMemoryTable = useInMemoryTable(
      CustomNotificationChannelService,
      [],
    );
    approveAddresses();

    const channel: CustomNotificationChannel = new CustomNotificationChannel();
    channel.name = "Pager bridge";
    channel.webhookUrl = CHANNEL_HOOK;
    channel.secret = CHANNEL_SECRET;

    const created: CustomNotificationChannel =
      await CustomNotificationChannelService.create({
        data: channel,
        props: { isRoot: true },
      });

    expect(isEncryptedValue(storedOf(table)["webhookUrl"])).toBe(true);
    expect(isEncryptedValue(storedOf(table)["secret"])).toBe(true);
    expect(String(created.webhookUrl)).toBe(CHANNEL_HOOK);
    expect(created.secret).toBe(CHANNEL_SECRET);
  });

  test("an OpenStack project notice's: its address as written", async () => {
    const table: InMemoryTable = useInMemoryTable(
      OpenStackProjectNoticeService,
      [],
    );
    approveAddresses();
    permitReferences();

    const notice: OpenStackProjectNotice = new OpenStackProjectNotice();
    notice.projectId = PROJECT_ID;
    notice.openStackCloudId = CLOUD_ID;
    notice.openStackProjectId = "p-0001";
    notice.webhookUrl = URL.fromString(NOTICE_HOOK);
    notice.isEnabled = false;

    const created: OpenStackProjectNotice =
      await OpenStackProjectNoticeService.create({
        data: notice,
        props: { isRoot: true },
      });

    expect(isEncryptedValue(storedOf(table)["webhookUrl"])).toBe(true);
    expect(created.webhookUrl).toBeInstanceOf(URL);
    expect(String(created.webhookUrl)).toBe(NOTICE_HOOK);
  });

  test("a network device's: its community string and v3 keys as written", async () => {
    const table: InMemoryTable = useInMemoryTable(NetworkDeviceService, []);
    quietSuccessHooks(NetworkDeviceService as never);

    const device: NetworkDevice = new NetworkDevice();
    device.projectId = PROJECT_ID;
    device.name = "core-rtr-01";
    device.hostname = "10.0.0.6";
    device.snmpVersion = "V3";
    device.snmpCommunityString = COMMUNITY;
    device.snmpV3Username = "monitoring";
    device.snmpV3AuthKey = AUTH_KEY;
    device.snmpV3PrivKey = PRIV_KEY;

    const created: NetworkDevice = await NetworkDeviceService.create({
      data: device,
      props: { isRoot: true },
    });

    for (const column of [
      "snmpCommunityString",
      "snmpV3AuthKey",
      "snmpV3PrivKey",
    ]) {
      expect([column, isEncryptedValue(storedOf(table)[column])]).toEqual([
        column,
        true,
      ]);
    }

    expect(created.snmpCommunityString).toBe(COMMUNITY);
    expect(created.snmpV3AuthKey).toBe(AUTH_KEY);
    expect(created.snmpV3PrivKey).toBe(PRIV_KEY);
  });

  test("a discovery scan's: its credential sets and flattened credentials as written", async () => {
    const table: InMemoryTable = useInMemoryTable(
      NetworkDeviceDiscoveryScanService,
      [],
    );
    quietSuccessHooks(NetworkDeviceDiscoveryScanService as never);
    permitReferences();
    // The scan's probe, the project's own.
    useInMemoryTable(ProbeService, [
      { _id: PROBE_ID.toString(), projectId: PROJECT_ID, name: "Campus" },
    ]);

    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.projectId = PROJECT_ID;
    scan.probeId = PROBE_ID;
    scan.name = "Campus";
    scan.cidr = "10.0.0.0/24";
    scan.isSnmpEnabled = true;
    scan.snmpConfigs = JSON.parse(JSON.stringify(SNMP_CONFIGS));

    const created: NetworkDeviceDiscoveryScan =
      await NetworkDeviceDiscoveryScanService.create({
        data: scan,
        props: { isRoot: true },
      });

    const stored: Array<JSONObject> = storedOf(table)[
      "snmpConfigs"
    ] as Array<JSONObject>;

    expect(isEncryptedValue(stored[0]!["snmpV3AuthKey"])).toBe(true);
    expect(isEncryptedValue(storedOf(table)["snmpV3PrivKey"])).toBe(true);

    expect(created.snmpConfigs).toEqual(SNMP_CONFIGS);
    expect(created.snmpV3AuthKey).toBe(AUTH_KEY);
    expect(created.snmpV3PrivKey).toBe(PRIV_KEY);
  });
});
