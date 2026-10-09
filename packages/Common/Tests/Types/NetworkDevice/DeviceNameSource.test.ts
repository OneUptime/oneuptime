import {
  DEVICE_NAME_SOURCES_BEST_FIRST,
  DeviceNameSource,
  getDeviceNameSourceRank,
  isBetterDeviceNameSource,
  readDeviceNameSource,
} from "../../../Types/NetworkDevice/DeviceNameSource";
import { describe, expect, test } from "@jest/globals";

/*
 * Where a discovered device's name came from (OneUptime issue #4518). The
 * value is stored on the device (NetworkDevice.discoveredNameSource) and
 * read back out of rows and API payloads, and the ORDER of the sources is
 * what a later scan's rename keys on: a name is only ever replaced by one
 * from a strictly better source. Both are pinned here, literally — the
 * stored spellings are a contract with every row already written.
 */

describe("the stored spellings", () => {
  test("are short kebab-case codes, one per source", () => {
    expect(DeviceNameSource.SystemName).toBe("system-name");
    expect(DeviceNameSource.NetbiosName).toBe("netbios-name");
    expect(DeviceNameSource.DnsName).toBe("dns-name");
    expect(DeviceNameSource.Address).toBe("address");
    expect(Object.values(DeviceNameSource)).toHaveLength(4);
  });

  test("fit the varchar(100) column they are stored in", () => {
    for (const source of Object.values(DeviceNameSource)) {
      expect(source.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("the order, best first", () => {
  test("is the device's own names, then DNS, then the address", () => {
    expect(DEVICE_NAME_SOURCES_BEST_FIRST).toEqual([
      DeviceNameSource.SystemName,
      DeviceNameSource.NetbiosName,
      DeviceNameSource.DnsName,
      DeviceNameSource.Address,
    ]);
  });

  test("lists every source exactly once", () => {
    expect(new Set(DEVICE_NAME_SOURCES_BEST_FIRST).size).toBe(
      Object.values(DeviceNameSource).length,
    );
  });

  test("ranks a better source higher, and the address lowest at 1", () => {
    expect(getDeviceNameSourceRank(DeviceNameSource.SystemName)).toBe(4);
    expect(getDeviceNameSourceRank(DeviceNameSource.NetbiosName)).toBe(3);
    expect(getDeviceNameSourceRank(DeviceNameSource.DnsName)).toBe(2);
    expect(getDeviceNameSourceRank(DeviceNameSource.Address)).toBe(1);
  });

  test("ranks a value that is not a source at 0, below everything", () => {
    expect(
      getDeviceNameSourceRank("typed" as unknown as DeviceNameSource),
    ).toBe(0);
  });
});

describe("isBetterDeviceNameSource", () => {
  /*
   * The full matrix: a rename may only ever climb. Equal is NOT better — that
   * is what stops a device's name flapping when one scan's answer differs
   * from the next one's.
   */
  const sources: Array<DeviceNameSource> = [...DEVICE_NAME_SOURCES_BEST_FIRST];

  for (const candidate of sources) {
    for (const current of sources) {
      const expected: boolean =
        sources.indexOf(candidate) < sources.indexOf(current);

      test(`${candidate} over ${current} is ${expected ? "better" : "not better"}`, () => {
        expect(isBetterDeviceNameSource(candidate, current)).toBe(expected);
      });
    }
  }

  test("the device's own SNMP name beats everything else, and nothing beats it", () => {
    for (const current of sources.slice(1)) {
      expect(
        isBetterDeviceNameSource(DeviceNameSource.SystemName, current),
      ).toBe(true);
    }

    for (const candidate of sources) {
      expect(
        isBetterDeviceNameSource(candidate, DeviceNameSource.SystemName),
      ).toBe(false);
    }
  });

  test("a NetBIOS name beats a DNS name, which is the heart of issue #4518", () => {
    expect(
      isBetterDeviceNameSource(
        DeviceNameSource.NetbiosName,
        DeviceNameSource.DnsName,
      ),
    ).toBe(true);
    expect(
      isBetterDeviceNameSource(
        DeviceNameSource.DnsName,
        DeviceNameSource.NetbiosName,
      ),
    ).toBe(false);
  });
});

describe("readDeviceNameSource", () => {
  test.each(Object.values(DeviceNameSource))(
    "reads %s back as itself",
    (source: string) => {
      expect(readDeviceNameSource(source)).toBe(source);
    },
  );

  /*
   * Anything else is "discovery did not name this device", which is the safe
   * answer: such a device is never renamed by a scan.
   */
  test.each([
    ["undefined", undefined],
    ["null", null],
    ["the empty string", ""],
    ["a different case", "Address"],
    ["the enum's key rather than its value", "SystemName"],
    ["a spelling with spaces", "system name"],
    ["surrounding whitespace", " dns-name "],
    ["a number", 1],
    ["a boolean", true],
    ["an object", { source: "address" }],
    ["an array", ["address"]],
    ["a source a newer release might add", "agent-hostname"],
  ])("refuses %s", (_label: string, value: unknown) => {
    expect(readDeviceNameSource(value)).toBeUndefined();
  });
});
