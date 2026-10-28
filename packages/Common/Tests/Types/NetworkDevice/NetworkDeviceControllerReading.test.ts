import { describe, expect, test } from "@jest/globals";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import {
  DISCOVERED_DETAILS_CONTROLLER_KEY,
  MAX_CONTROLLER_VALUE_LENGTH,
  NETWORK_CONTROLLER_PRODUCT_TYPES,
  NETWORK_DEVICE_CONTROLLER_FIELDS,
  NetworkDeviceControllerField,
  NetworkDeviceControllerReading,
  NetworkDeviceDiscoveredDetails,
  NetworkDeviceDiscoveryReader,
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
  buildDiscoveredValue,
  isDiscoveredDetailsKey,
  normalizeControllerValue,
  readNetworkDeviceDiscoveredDetails,
  sanitizeDiscoveredDetailsOnWrite,
  toDiscoveredDetailsJson,
  NetworkDeviceDiscoveredField,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * What a device's network controller says it is - one reading of the
 * Meraki dashboard's device list, kept whole under the `controller` key of
 * the device's discovered details (the follow-ups of #5185 and #5225).
 *
 * The values are Meraki's: outside text, and the column is jsonb an API
 * create can carry. These pin what may be stored, that the reader keeps
 * exactly what the writer writes, that the reading rides beside the other
 * writers' keys without touching them, and that no input makes either
 * throw.
 */

const CONNECTION: NetworkDeviceDiscoveryReader = {
  type: NetworkDeviceDiscoveryReaderType.NetworkController,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Acme Retail",
};

const READ_AT: string = "2026-10-28T10:00:00.000Z";

const VALUES: Readonly<Record<NetworkDeviceControllerField, string>> = {
  [NetworkDeviceControllerField.Name]: "Lobby AP",
  [NetworkDeviceControllerField.Model]: "MR46",
  [NetworkDeviceControllerField.SerialNumber]: "Q2KD-ABCD-1234",
  [NetworkDeviceControllerField.MacAddress]: "e0:55:3d:12:34:56",
  [NetworkDeviceControllerField.IpAddress]: "10.20.30.41",
  [NetworkDeviceControllerField.FirmwareVersion]: "wireless-29-7",
  [NetworkDeviceControllerField.ProductType]: "wireless",
  [NetworkDeviceControllerField.NetworkName]: "Branch 12",
  [NetworkDeviceControllerField.Address]: "1600 Amphitheatre Pkwy, Mountain View",
};

function reading(
  overrides: Partial<{
    provider: unknown;
    readBy: unknown;
    readAt: unknown;
    values: unknown;
  }> = {},
): NetworkDeviceControllerReading | undefined {
  return buildControllerReading({
    provider: NetworkControllerProvider.Meraki,
    readBy: CONNECTION,
    readAt: READ_AT,
    values: { ...VALUES },
    ...overrides,
  });
}

describe("the controller reading's fields", () => {
  test("nine values, in the order a card would list them", () => {
    expect([...NETWORK_DEVICE_CONTROLLER_FIELDS]).toEqual([
      "name",
      "model",
      "serialNumber",
      "macAddress",
      "ipAddress",
      "firmwareVersion",
      "productType",
      "networkName",
      "address",
    ]);
    // Every field has a length it is cut to.
    for (const field of NETWORK_DEVICE_CONTROLLER_FIELDS) {
      expect(MAX_CONTROLLER_VALUE_LENGTH[field]).toBeGreaterThan(0);
    }
  });

  test("the reading has a key of its own in the column, and only that", () => {
    expect(DISCOVERED_DETAILS_CONTROLLER_KEY).toBe("controller");
    expect(isDiscoveredDetailsKey("controller")).toBe(true);
    // Its values are not keys of the column: they live inside the reading.
    expect(isDiscoveredDetailsKey("model")).toBe(false);
    expect(isDiscoveredDetailsKey("firmwareVersion")).toBe(false);
    expect(isDiscoveredDetailsKey("Controller")).toBe(false);
  });

  test("the product types are Meraki's own", () => {
    expect([...NETWORK_CONTROLLER_PRODUCT_TYPES]).toEqual([
      "appliance",
      "switch",
      "wireless",
      "camera",
      "sensor",
      "cellularGateway",
      "wirelessController",
      "campusGateway",
      "secureConnect",
      "systemsManager",
    ]);
  });
});

describe("normalizeControllerValue", () => {
  test("a MAC in any spelling becomes the one OneUptime keeps", () => {
    for (const spelling of [
      "E0-55-3D-12-34-56",
      "e055.3d12.3456",
      "E0:55:3D:12:34:56",
      "e0553d123456",
    ]) {
      expect(
        normalizeControllerValue(
          NetworkDeviceControllerField.MacAddress,
          spelling,
        ),
      ).toBe("e0:55:3d:12:34:56");
    }

    expect(
      normalizeControllerValue(NetworkDeviceControllerField.MacAddress, "lobby"),
    ).toBeUndefined();
    expect(
      normalizeControllerValue(NetworkDeviceControllerField.MacAddress, 42),
    ).toBeUndefined();
  });

  test("an address must be an address literal", () => {
    expect(
      normalizeControllerValue(
        NetworkDeviceControllerField.IpAddress,
        " 10.20.30.41 ",
      ),
    ).toBe("10.20.30.41");
    expect(
      normalizeControllerValue(
        NetworkDeviceControllerField.IpAddress,
        "fe80::1",
      ),
    ).toBe("fe80::1");
    for (const notAnAddress of ["lobby-ap.corp", "10.20.30", "", null]) {
      expect(
        normalizeControllerValue(
          NetworkDeviceControllerField.IpAddress,
          notAnAddress,
        ),
      ).toBeUndefined();
    }
  });

  test("a product type must be one Meraki names", () => {
    expect(
      normalizeControllerValue(
        NetworkDeviceControllerField.ProductType,
        "switch",
      ),
    ).toBe("switch");
    for (const other of ["Switch", "router", "<b>switch</b>", ""]) {
      expect(
        normalizeControllerValue(NetworkDeviceControllerField.ProductType, other),
      ).toBeUndefined();
    }
  });

  test("text is cleaned and cut, never refused for its length", () => {
    expect(
      normalizeControllerValue(
        NetworkDeviceControllerField.Name,
        "  Lobby\u0000 AP\n\t2  ",
      ),
    ).toBe("Lobby AP 2");
    expect(
      normalizeControllerValue(
        NetworkDeviceControllerField.Address,
        "1600 Amphitheatre Pkwy\nMountain View, CA",
      ),
    ).toBe("1600 Amphitheatre Pkwy Mountain View, CA");

    const long: string | undefined = normalizeControllerValue(
      NetworkDeviceControllerField.Model,
      "M".repeat(5000),
    );
    expect(long).toHaveLength(
      MAX_CONTROLLER_VALUE_LENGTH[NetworkDeviceControllerField.Model],
    );
    expect(
      normalizeControllerValue(NetworkDeviceControllerField.Name, "   "),
    ).toBeUndefined();
    expect(
      normalizeControllerValue(NetworkDeviceControllerField.Name, { a: 1 }),
    ).toBeUndefined();
  });
});

describe("buildControllerReading", () => {
  test("a reading keeps every usable value, read by the connection, when", () => {
    expect(reading()).toEqual({
      provider: "meraki",
      readBy: CONNECTION,
      readAt: READ_AT,
      values: { ...VALUES },
    });
  });

  test("only a controller OneUptime reads, read by a connection, at a time that parses", () => {
    expect(reading({ provider: "aruba" })).toBeUndefined();
    expect(reading({ provider: undefined })).toBeUndefined();
    expect(
      reading({
        readBy: { ...CONNECTION, type: NetworkDeviceDiscoveryReaderType.DiscoveryScan },
      }),
    ).toBeUndefined();
    expect(reading({ readBy: { type: "networkController" } })).toBeUndefined();
    expect(reading({ readAt: "yesterday" })).toBeUndefined();
    expect(reading({ values: "MR46" })).toBeUndefined();
    expect(reading({ values: [] })).toBeUndefined();
  });

  test("a reading with nothing usable in it is no reading", () => {
    expect(
      reading({
        values: { macAddress: "nope", productType: "router", name: " " },
      }),
    ).toBeUndefined();
  });

  test("values it cannot use are left out, the rest kept", () => {
    expect(
      reading({
        values: {
          ...VALUES,
          ipAddress: "not-an-address",
          productType: "toaster",
          extra: "ignored",
        },
      })?.values,
    ).toEqual({
      name: "Lobby AP",
      model: "MR46",
      serialNumber: "Q2KD-ABCD-1234",
      macAddress: "e0:55:3d:12:34:56",
      firmwareVersion: "wireless-29-7",
      networkName: "Branch 12",
      address: "1600 Amphitheatre Pkwy, Mountain View",
    });
  });

  test("a time written another way is stored in one form", () => {
    expect(reading({ readAt: new Date(READ_AT) })?.readAt).toBe(READ_AT);
    expect(reading({ readAt: "2026-10-28T12:00:00+02:00" })?.readAt).toBe(
      READ_AT,
    );
  });

  test("the reader's name is cut, never refused", () => {
    expect(
      reading({ readBy: { ...CONNECTION, name: "N".repeat(400) } })?.readBy
        .name,
    ).toHaveLength(100);
  });
});

describe("the column, with the controller's reading in it", () => {
  const scanReader: NetworkDeviceDiscoveryReader = {
    type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
    id: "80000000-0000-4000-8000-000000000001",
    name: "Store subnets",
  };

  function columnWithEverything(): Record<string, unknown> {
    return {
      sysName: buildDiscoveredValue({
        field: NetworkDeviceDiscoveredField.SystemName,
        value: "lobby-ap",
        readBy: scanReader,
        readAt: "2026-10-28T08:00:00.000Z",
      }),
      controller: reading(),
    };
  }

  test("the reader keeps it, beside the other writers' entries", () => {
    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(columnWithEverything());

    expect(details.controller).toEqual(reading());
    expect(details.values.sysName?.value).toBe("lobby-ap");
  });

  test("it round-trips: what the writer stores is what the reader reads", () => {
    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(columnWithEverything());
    const json: Record<string, unknown> = toDiscoveredDetailsJson(details);

    expect(Object.keys(json)).toEqual(["sysName", "controller"]);
    expect(readNetworkDeviceDiscoveredDetails(json)).toEqual(details);
  });

  test("a stored reading OneUptime would not have written is dropped, never shown", () => {
    for (const forged of [
      "MR46",
      42,
      [],
      { ...reading(), provider: "unifi" },
      { ...reading(), readBy: { ...CONNECTION, type: "probe" } },
      { ...reading(), readAt: "never" },
      { ...reading(), values: { productType: "toaster" } },
    ]) {
      expect(
        readNetworkDeviceDiscoveredDetails({ controller: forged }).controller,
      ).toBeUndefined();
    }
  });

  test("an API create keeps a well-formed reading and drops a forged one", () => {
    expect(
      sanitizeDiscoveredDetailsOnWrite({ controller: reading() }),
    ).toEqual({ controller: reading() });
    expect(
      sanitizeDiscoveredDetailsOnWrite({
        controller: { provider: "meraki", values: { model: "MR46" } },
      }),
    ).toBeNull();
  });

  test("no input makes the reader or the builder throw", () => {
    const random: SeededRandom = seededRandom(5298);
    const pieces: Array<unknown> = [
      undefined,
      null,
      0,
      -1,
      "",
      " ",
      "meraki",
      "networkController",
      READ_AT,
      "e0:55:3d:12:34:56",
      "10.0.0.1",
      [],
      {},
      { id: "x" },
      CONNECTION,
      VALUES,
    ];

    const pick: () => unknown = (): unknown => {
      return pieces[random(pieces.length)];
    };

    for (let index: number = 0; index < 2000; index++) {
      const raw: unknown = {
        controller: {
          provider: pick(),
          readBy: pick(),
          readAt: pick(),
          values: random() < 0.5 ? pick() : { name: pick(), model: pick() },
        },
      };

      expect(() => {
        readNetworkDeviceDiscoveredDetails(raw);
        buildControllerReading({
          provider: pick(),
          readBy: pick(),
          readAt: pick(),
          values: pick(),
        });
      }).not.toThrow();
    }
  });

  test("megabytes of outside text are read in linear time", () => {
    const huge: string = `${" ".repeat(400000)}${"a".repeat(400000)}`;

    const result: FastestRun<void> = fastestRun({
      run: (): void => {
        buildControllerReading({
          provider: NetworkControllerProvider.Meraki,
          readBy: CONNECTION,
          readAt: READ_AT,
          values: {
            name: huge,
            model: huge,
            serialNumber: huge,
            macAddress: huge,
            ipAddress: huge,
            firmwareVersion: huge,
            productType: huge,
            networkName: huge,
            address: huge,
          },
        });
      },
      limitInMs: 2000,
    });

    expect(result.inMs).toBeLessThan(2000);
  });
});
