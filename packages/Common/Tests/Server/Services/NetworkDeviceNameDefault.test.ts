import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A device created without a name is named after its address.
 *
 * The Add Device form asks for the hostname first and leaves the name
 * optional ("Same as the hostname"), and fills it in itself before it posts.
 * The server applies the same rule (DeviceNameDefault) so the same request
 * made through the API - or by anything else that posts a device - names
 * the device the same way instead of being refused for a missing name.
 *
 * Driven through the real onBeforeCreate, which runs BEFORE DatabaseService's
 * required-field check: a payload with a hostname and no name reaches that
 * check with a name, and a payload with neither reaches it untouched, so the
 * check still says which field is missing.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type DeviceServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDevice>,
  ) => Promise<OnCreate<NetworkDevice>>;
};

function internals(): DeviceServiceInternals {
  return new NetworkDeviceServiceType() as unknown as DeviceServiceInternals;
}

/*
 * A create with nothing that makes the hook reach for the database: no
 * site, no probe, no monitor, no template.
 */
function createWith(fields: {
  name?: unknown;
  hostname?: unknown;
}): CreateBy<NetworkDevice> {
  const device: NetworkDevice = new NetworkDevice();
  device.projectId = PROJECT_ID;

  const record: Record<string, unknown> = device as unknown as Record<
    string,
    unknown
  >;

  if ("name" in fields) {
    record["name"] = fields.name;
  }

  if ("hostname" in fields) {
    record["hostname"] = fields.hostname;
  }

  return {
    data: device,
    props: { isRoot: true },
  } as CreateBy<NetworkDevice>;
}

function nameOf(result: OnCreate<NetworkDevice>): unknown {
  return (result.createBy.data as unknown as Record<string, unknown>)["name"];
}

describe("NetworkDeviceService names a device without a name after its address", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  test("an IP address becomes the name", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({ hostname: "10.20.30.44" }),
    );

    expect(nameOf(result)).toBe("10.20.30.44");
  });

  test("a hostname becomes the name, trimmed", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({ hostname: "  core-sw-01.example.com " }),
    );

    expect(nameOf(result)).toBe("core-sw-01.example.com");
  });

  test.each([
    ["an empty name", ""],
    ["a name of spaces", "   "],
    ["a null name", null],
  ])(
    "%s is replaced by the address",
    async (_label: string, name: unknown): Promise<void> => {
      const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
        createWith({ name: name, hostname: "10.20.30.44" }),
      );

      expect(nameOf(result)).toBe("10.20.30.44");
    },
  );

  test("a name that was given is kept, only trimmed", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({ name: "  Register 4 ", hostname: "10.20.30.44" }),
    );

    expect(nameOf(result)).toBe("Register 4");
  });

  test("the hostname itself is not rewritten", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({ hostname: "10.20.30.44" }),
    );

    expect(
      (result.createBy.data as unknown as Record<string, unknown>)["hostname"],
    ).toBe("10.20.30.44");
  });

  /*
   * Neither: the hook invents nothing, so the required-field check that
   * follows it refuses the create naming the missing field, exactly as it
   * did before the name became optional on the form.
   */
  test("a create with neither a name nor a hostname is left for the required check", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({}),
    );

    expect(nameOf(result)).toBeUndefined();
  });

  test("a blank name with a blank hostname stays as it came", async () => {
    const result: OnCreate<NetworkDevice> = await internals().onBeforeCreate(
      createWith({ name: "", hostname: "" }),
    );

    expect(nameOf(result)).toBe("");
  });
});
