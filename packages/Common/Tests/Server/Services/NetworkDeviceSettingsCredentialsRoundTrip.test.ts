import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import Encryption from "../../../Server/Utils/Encryption";
import NetworkDeviceHydrationUtil from "../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { isEncryptedValue } from "../../../Types/Database/EncryptedValue";
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
 * A DEVICE'S SETTINGS FORM SAVES ITS SNMP CREDENTIALS BACK AS IT READ THEM,
 * AND "PING ONLY" SAVES THEM BLANK, WITH THE CREDENTIALS KEPT ENCRYPTED AT
 * REST (#9014).
 *
 * The form reads the device's credentials - decrypted, for whom may read
 * them - and sends every field of its SNMP step back on a save, changed or
 * not; its "Ping only" box blanks the community string, the v3 username and
 * the v3 keys on the way (Dashboard: NetworkDevice/View/Settings.tsx). Here
 * the real NetworkDeviceService reads and writes a table in memory that
 * holds the credentials as DatabaseService stores them: a save of what was
 * read keeps them as they were, encrypted once - never a ciphertext of the
 * ciphertext - a new credential is stored encrypted, and Ping only
 * stores blanks - never a ciphertext of nothing - which read back blank, so
 * the next poll pings the device without walking it.
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
  "90140000-0000-4000-8000-000000000301",
);
const V2C_DEVICE_ID: string = "90140000-0000-4000-8000-000000000302";
const V3_DEVICE_ID: string = "90140000-0000-4000-8000-000000000303";

const COMMUNITY: string = "s3cr3t-community";
const AUTH_KEY: string = "an auth passphrase";
const PRIV_KEY: string = "a privacy passphrase";

// The columns of the form's SNMP step, which a save sends back whole.
const SNMP_STEP_SELECT: {
  snmpVersion: true;
  snmpCommunityString: true;
  snmpPort: true;
  snmpV3SecurityLevel: true;
  snmpV3Username: true;
  snmpV3AuthProtocol: true;
  snmpV3AuthKey: true;
  snmpV3PrivProtocol: true;
  snmpV3PrivKey: true;
} = {
  snmpVersion: true,
  snmpCommunityString: true,
  snmpPort: true,
  snmpV3SecurityLevel: true,
  snmpV3Username: true,
  snmpV3AuthProtocol: true,
  snmpV3AuthKey: true,
  snmpV3PrivProtocol: true,
  snmpV3PrivKey: true,
};

const SECRET_COLUMNS: Array<string> = [
  "snmpCommunityString",
  "snmpV3AuthKey",
  "snmpV3PrivKey",
];

// What DatabaseService stores for these values.
async function stored(values: StoredRow): Promise<StoredRow> {
  const record: StoredRow = { ...values };

  await (
    NetworkDeviceService as unknown as {
      encrypt: (data: StoredRow) => Promise<unknown>;
    }
  ).encrypt(record);

  return record;
}

let devices: InMemoryTable;

beforeEach(async () => {
  devices = useInMemoryTable(NetworkDeviceService, [
    {
      _id: V2C_DEVICE_ID,
      projectId: PROJECT_ID,
      name: "access-sw-01",
      hostname: "10.0.0.5",
      ...(await stored({
        snmpVersion: "V2c",
        snmpCommunityString: COMMUNITY,
        snmpPort: 161,
      })),
    },
    {
      _id: V3_DEVICE_ID,
      projectId: PROJECT_ID,
      name: "core-rtr-01",
      hostname: "10.0.0.6",
      ...(await stored({
        snmpVersion: "V3",
        snmpPort: 161,
        snmpV3SecurityLevel: "authPriv",
        snmpV3Username: "monitoring",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: AUTH_KEY,
        snmpV3PrivProtocol: "AES",
        snmpV3PrivKey: PRIV_KEY,
      })),
    },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The form's edit: what it reads of the SNMP step, as it reads it.
async function readForm(id: string): Promise<Record<string, unknown>> {
  const device: NetworkDevice | null = await NetworkDeviceService.findOneById({
    id: new ObjectID(id),
    select: SNMP_STEP_SELECT,
    props: { isRoot: true },
  });

  const values: Record<string, unknown> = {};

  for (const column of Object.keys(SNMP_STEP_SELECT)) {
    values[column] = (device as unknown as Record<string, unknown>)[column];
  }

  return values;
}

async function save(
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  await NetworkDeviceService.updateOneById({
    id: new ObjectID(id),
    data: { ...values } as never,
    props: { isRoot: true },
  });
}

async function expectStoredOnce(stored: unknown, value: string): Promise<void> {
  expect(isEncryptedValue(stored)).toBe(true);
  expect(await Encryption.decrypt(stored as string)).toBe(value);
}

describe("a device's Settings form", () => {
  test("reads the device's credentials as written", async () => {
    expect(await readForm(V2C_DEVICE_ID)).toMatchObject({
      snmpVersion: "V2c",
      snmpCommunityString: COMMUNITY,
    });
    expect(await readForm(V3_DEVICE_ID)).toMatchObject({
      snmpV3Username: "monitoring",
      snmpV3AuthKey: AUTH_KEY,
      snmpV3PrivKey: PRIV_KEY,
    });
  });

  test("saving the credentials it read keeps them as they were, encrypted once", async () => {
    for (const id of [V2C_DEVICE_ID, V3_DEVICE_ID]) {
      await save(id, await readForm(id));
    }

    await expectStoredOnce(
      devices.get(V2C_DEVICE_ID)!["snmpCommunityString"],
      COMMUNITY,
    );
    await expectStoredOnce(devices.get(V3_DEVICE_ID)!["snmpV3AuthKey"], AUTH_KEY);
    await expectStoredOnce(devices.get(V3_DEVICE_ID)!["snmpV3PrivKey"], PRIV_KEY);

    expect(await readForm(V3_DEVICE_ID)).toMatchObject({
      snmpV3AuthKey: AUTH_KEY,
      snmpV3PrivKey: PRIV_KEY,
    });
  });

  test("a credential changed on it is stored encrypted, and read back as typed", async () => {
    const values: Record<string, unknown> = await readForm(V2C_DEVICE_ID);
    values["snmpCommunityString"] = "a new community";

    await save(V2C_DEVICE_ID, values);

    await expectStoredOnce(
      devices.get(V2C_DEVICE_ID)!["snmpCommunityString"],
      "a new community",
    );
    expect((await readForm(V2C_DEVICE_ID))["snmpCommunityString"]).toBe(
      "a new community",
    );
  });

  test("Ping only saves the credentials blank - no ciphertext of nothing - and the next poll pings the device", async () => {
    for (const id of [V2C_DEVICE_ID, V3_DEVICE_ID]) {
      // What the Ping only box does to the form's values on the way.
      await save(id, {
        ...(await readForm(id)),
        snmpCommunityString: "",
        snmpV3Username: "",
        snmpV3AuthKey: "",
        snmpV3PrivKey: "",
      });

      const row: StoredRow = devices.get(id)!;

      for (const column of [...SECRET_COLUMNS, "snmpV3Username"]) {
        expect(row[column]).toBe("");
      }

      const form: Record<string, unknown> = await readForm(id);

      for (const column of [...SECRET_COLUMNS, "snmpV3Username"]) {
        expect(form[column]).toBe("");
      }

      const polled: NetworkDevice | null = await NetworkDeviceService.findOneById(
        {
          id: new ObjectID(id),
          select: NetworkDeviceHydrationUtil.snmpConfigSelect,
          props: { isRoot: true },
        },
      );

      expect(NetworkDeviceHydrationUtil.resolvePollMode(polled!)).toBe("ping");
    }
  });
});
