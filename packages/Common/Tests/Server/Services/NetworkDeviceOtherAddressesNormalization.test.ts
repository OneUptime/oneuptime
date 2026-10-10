import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A device's Other Addresses, through the real onBeforeCreate and
 * onBeforeUpdate: the addresses traps, syslog and flows are matched by, so a
 * value that is stored must be one the matcher can read.
 *
 *   - addresses in any spelling land canonical, each once, comma-separated;
 *   - blank clears the column (a form cannot post null);
 *   - anything that is not an IP address is REFUSED, naming it - a DNS name
 *     stored here would match nothing, forever, with no error anywhere;
 *   - undefined, null and a SQL-expression function pass through untouched;
 *   - on update, the normalisation runs above the early return, so the
 *     settings form's one-field save is normalised too.
 */

beforeEach(() => {
  jest.restoreAllMocks();
  stubProjectDirectory({});
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

type DeviceServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDevice>,
  ) => Promise<OnCreate<NetworkDevice>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkDevice>,
  ) => Promise<OnUpdate<NetworkDevice>>;
};

function internals(): DeviceServiceInternals {
  return new NetworkDeviceServiceType() as unknown as DeviceServiceInternals;
}

function createWith(otherAddresses: unknown): CreateBy<NetworkDevice> {
  const device: NetworkDevice = new NetworkDevice();
  device.projectId = PROJECT_ID;
  device.name = "Core router";
  device.hostname = "10.0.0.1";
  (device as unknown as Record<string, unknown>)["otherAddresses"] =
    otherAddresses;

  return {
    data: device,
    props: { isRoot: true },
  } as CreateBy<NetworkDevice>;
}

function updateWith(otherAddresses: unknown): UpdateBy<NetworkDevice> {
  return {
    query: { _id: DEVICE_ID.toString() },
    data: { otherAddresses: otherAddresses },
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDevice>;
}

function created(result: OnCreate<NetworkDevice>): unknown {
  return (result.createBy.data as unknown as Record<string, unknown>)[
    "otherAddresses"
  ];
}

function updated(result: OnUpdate<NetworkDevice>): unknown {
  return (result.updateBy.data as unknown as Record<string, unknown>)[
    "otherAddresses"
  ];
}

describe("Other Addresses on create", () => {
  test("lands canonical, each address once, comma-separated", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith("10.255.0.1;  2001:DB8:0::1\n10.255.0.1"),
    );

    expect(created(result)).toBe("10.255.0.1, 2001:db8::1");
  });

  test("blank clears it", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith("  "),
    );

    expect(created(result)).toBeNull();
  });

  test("an unset value stays unset", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith(undefined),
    );

    expect(created(result)).toBeUndefined();
  });

  test("a DNS name is refused, by name, as a 400", async () => {
    await expect(
      internals().onBeforeCreate(createWith("10.255.0.1, core.example.com")),
    ).rejects.toThrow("Not an IP address: core.example.com.");

    await expect(
      internals().onBeforeCreate(createWith("core.example.com")),
    ).rejects.toThrow(BadDataException);
  });

  test("a value that is not text is refused", async () => {
    await expect(
      internals().onBeforeCreate(createWith(["10.255.0.1"])),
    ).rejects.toThrow("Other Addresses must be text.");
  });
});

describe("Other Addresses on update", () => {
  test("a save of this one field is normalised too", async () => {
    const result: OnUpdate<NetworkDevice> = await internals().onBeforeUpdate(
      updateWith("192.168.1.1,10.255.0.1"),
    );

    expect(updated(result)).toBe("192.168.1.1, 10.255.0.1");
  });

  test("blank clears it, and null and SQL functions pass through", async () => {
    expect(
      updated(await internals().onBeforeUpdate(updateWith(""))),
    ).toBeNull();
    expect(
      updated(await internals().onBeforeUpdate(updateWith(null))),
    ).toBeNull();

    const sqlFunction: () => string = (): string => {
      return "otherAddresses";
    };

    expect(
      updated(await internals().onBeforeUpdate(updateWith(sqlFunction))),
    ).toBe(sqlFunction);
  });

  test("an address that is not one is refused before anything is written", async () => {
    await expect(
      internals().onBeforeUpdate(updateWith("10.0.0.256")),
    ).rejects.toThrow(BadDataException);
  });
});
