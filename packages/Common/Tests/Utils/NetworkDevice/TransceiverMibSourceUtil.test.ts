import { describe, expect, test } from "@jest/globals";
import { TransceiverMibSource } from "../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverMibSourceUtil from "../../../Utils/NetworkDevice/TransceiverMibSourceUtil";

/*
 * Which MIBs a device's optics are read from, decided by its sysObjectID
 * alone - never by whether someone applied a vendor template. The vendor's
 * own table goes first where it has what the standard one lacks, and
 * ENTITY-SENSOR-MIB is the fallback for everyone else.
 *
 * Each sysObjectID below is a real one a device of that make reports.
 */
describe("TransceiverMibSourceUtil.getSourcesForDevice", () => {
  test.each<[string, string, Array<TransceiverMibSource>]>([
    [
      "Cisco Catalyst 9300",
      "1.3.6.1.4.1.9.1.2494",
      [
        TransceiverMibSource.CiscoEntitySensor,
        TransceiverMibSource.EntitySensor,
      ],
    ],
    [
      "Juniper EX4300",
      "1.3.6.1.4.1.2636.1.1.1.2.63",
      [TransceiverMibSource.JuniperDom, TransceiverMibSource.EntitySensor],
    ],
    ["MikroTik CRS", "1.3.6.1.4.1.14988.1", [TransceiverMibSource.MikroTik]],
    [
      "HPE Comware 5130",
      "1.3.6.1.4.1.25506.11.1.163",
      [TransceiverMibSource.H3cTransceiver, TransceiverMibSource.EntitySensor],
    ],
    [
      "HPE Aruba 2930F (ArubaOS-Switch)",
      "1.3.6.1.4.1.11.2.3.7.11.181.20",
      [
        TransceiverMibSource.HpIcfTransceiver,
        TransceiverMibSource.EntitySensor,
      ],
    ],
    [
      "Arista 7050",
      "1.3.6.1.4.1.30065.1.3011.7050.3741.48",
      [TransceiverMibSource.AristaEntitySensor],
    ],
    [
      "Cambium cnMatrix (its own arc)",
      "1.3.6.1.4.1.17713.24.1.1",
      [
        TransceiverMibSource.CambiumTransceiver,
        TransceiverMibSource.EntitySensor,
      ],
    ],
    [
      "Cambium cnMatrix (the Aricent ISS arc)",
      "1.3.6.1.4.1.2076.81.1",
      [
        TransceiverMibSource.CambiumTransceiver,
        TransceiverMibSource.EntitySensor,
      ],
    ],
  ])(
    "%s (%s)",
    (
      _name: string,
      sysObjectId: string,
      expected: Array<TransceiverMibSource>,
    ) => {
      expect(TransceiverMibSourceUtil.getSourcesForDevice(sysObjectId)).toEqual(
        expected,
      );
    },
  );

  test("every other vendor gets the standard ENTITY-SENSOR-MIB", () => {
    // Dell OS10, Extreme, Ubiquiti, FS.com's own switches.
    for (const sysObjectId of [
      "1.3.6.1.4.1.674.11000.5000.100.2.1.1",
      "1.3.6.1.4.1.1916.2.282",
      "1.3.6.1.4.1.41112.1.6",
      "1.3.6.1.4.1.52642.2.1.45.22",
    ]) {
      expect(TransceiverMibSourceUtil.getSourcesForDevice(sysObjectId)).toEqual(
        [TransceiverMibSource.EntitySensor],
      );
    }
  });

  test("a Cambium device that is not a cnMatrix switch is not read as one", () => {
    // cnPilot / ePMP live elsewhere under Cambium's enterprise number.
    expect(
      TransceiverMibSourceUtil.getSourcesForDevice("1.3.6.1.4.1.17713.22.1"),
    ).toEqual([TransceiverMibSource.EntitySensor]);
    // 17713.240 is not under 17713.24.
    expect(
      TransceiverMibSourceUtil.getSourcesForDevice("1.3.6.1.4.1.17713.240.1"),
    ).toEqual([TransceiverMibSource.EntitySensor]);
  });

  test("the enterprise number is matched whole, not by prefix", () => {
    // 90 and 99 are not Cisco (9); 116 is not HP (11).
    expect(
      TransceiverMibSourceUtil.getSourcesForDevice("1.3.6.1.4.1.90.1"),
    ).toEqual([TransceiverMibSource.EntitySensor]);
    expect(
      TransceiverMibSourceUtil.getSourcesForDevice("1.3.6.1.4.1.116.3.11"),
    ).toEqual([TransceiverMibSource.EntitySensor]);
  });

  test("a leading dot and whitespace are ignored", () => {
    expect(
      TransceiverMibSourceUtil.getSourcesForDevice(" .1.3.6.1.4.1.2636.1.1 "),
    ).toEqual([
      TransceiverMibSource.JuniperDom,
      TransceiverMibSource.EntitySensor,
    ]);
  });

  test("no sysObjectID, or one outside the enterprises arc, is the standard MIB", () => {
    expect(TransceiverMibSourceUtil.getSourcesForDevice(undefined)).toEqual([
      TransceiverMibSource.EntitySensor,
    ]);
    expect(TransceiverMibSourceUtil.getSourcesForDevice("")).toEqual([
      TransceiverMibSource.EntitySensor,
    ]);
    expect(
      TransceiverMibSourceUtil.getSourcesForDevice("1.3.6.1.2.1.1"),
    ).toEqual([TransceiverMibSource.EntitySensor]);
    expect(
      TransceiverMibSourceUtil.getSourcesForDevice("1.3.6.1.4.1.not-a-number"),
    ).toEqual([TransceiverMibSource.EntitySensor]);
  });

  test("callers get their own copy - changing it changes nothing for the next device", () => {
    const first: Array<TransceiverMibSource> =
      TransceiverMibSourceUtil.getSourcesForDevice("1.3.6.1.4.1.9.1.1");
    first.length = 0;

    expect(
      TransceiverMibSourceUtil.getSourcesForDevice("1.3.6.1.4.1.9.1.1"),
    ).toHaveLength(2);
  });

  test("every vendor list ends in a source the probe can read", () => {
    const sources: Array<TransceiverMibSource> =
      Object.values(TransceiverMibSource);

    for (const sysObjectId of [
      "1.3.6.1.4.1.9",
      "1.3.6.1.4.1.11",
      "1.3.6.1.4.1.2076",
      "1.3.6.1.4.1.2636",
      "1.3.6.1.4.1.14988",
      "1.3.6.1.4.1.25506",
      "1.3.6.1.4.1.30065",
    ]) {
      const list: Array<TransceiverMibSource> =
        TransceiverMibSourceUtil.getSourcesForDevice(sysObjectId);

      expect(list.length).toBeGreaterThan(0);
      for (const source of list) {
        expect(sources).toContain(source);
      }
      // No source is tried twice.
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
