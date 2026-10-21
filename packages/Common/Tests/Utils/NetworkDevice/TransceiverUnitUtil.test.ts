import { describe, expect, test } from "@jest/globals";
import TransceiverUnitUtil, {
  TRANSCEIVER_MIN_POWER_DBM,
} from "../../../Utils/NetworkDevice/TransceiverUnitUtil";

/*
 * Every vendor reports transceiver readings in units of its own: Juniper and
 * HPE Comware in hundredths of a dBm, MikroTik and ArubaOS-Switch in
 * thousandths, cnMatrix in microwatts, Arista in milliwatts with an SI
 * prefix and a precision. These conversions are what make all of them read
 * the same on the page, in an alert and to OneUptime AI, so each one is
 * pinned against a value worked out by hand.
 */
describe("TransceiverUnitUtil.milliwattsToDbm", () => {
  test.each<[number, number]>([
    [1, 0],
    [0.5, -3.01],
    [2, 3.01],
    [0.1, -10],
    [0.01, -20],
    [0.6322, -1.99],
    [0.0363, -14.4],
    [1.7783, 2.5],
  ])("%s mW is %s dBm", (milliwatts: number, dbm: number) => {
    expect(TransceiverUnitUtil.milliwattsToDbm(milliwatts)).toBeCloseTo(dbm, 2);
  });

  test("no light - zero, negative or not a number - is the -40 dBm floor", () => {
    expect(TransceiverUnitUtil.milliwattsToDbm(0)).toBe(
      TRANSCEIVER_MIN_POWER_DBM,
    );
    expect(TransceiverUnitUtil.milliwattsToDbm(-1)).toBe(
      TRANSCEIVER_MIN_POWER_DBM,
    );
    expect(TransceiverUnitUtil.milliwattsToDbm(NaN)).toBe(
      TRANSCEIVER_MIN_POWER_DBM,
    );
    expect(TransceiverUnitUtil.milliwattsToDbm(Infinity)).toBe(
      TRANSCEIVER_MIN_POWER_DBM,
    );
  });

  test("anything darker than the floor reads as the floor", () => {
    // 0.00001 mW is -50 dBm.
    expect(TransceiverUnitUtil.milliwattsToDbm(0.00001)).toBe(-40);
    expect(TRANSCEIVER_MIN_POWER_DBM).toBe(-40);
  });

  test("the result is rounded to a hundredth of a dB", () => {
    const dbm: number = TransceiverUnitUtil.milliwattsToDbm(0.3333333);
    expect(dbm).toBe(Math.round(dbm * 100) / 100);
  });
});

describe("TransceiverUnitUtil.microwattsToDbm", () => {
  test.each<[number, number]>([
    [1000, 0],
    [500, -3.01],
    [100, -10],
    [400, -3.98],
  ])("%s uW is %s dBm", (microwatts: number, dbm: number) => {
    expect(TransceiverUnitUtil.microwattsToDbm(microwatts)).toBeCloseTo(dbm, 2);
  });

  test("zero microwatts is no light", () => {
    expect(TransceiverUnitUtil.microwattsToDbm(0)).toBe(-40);
  });
});

describe("TransceiverUnitUtil.fromFixedPoint", () => {
  test("hundredths of a dBm (JUNIPER-DOM-MIB, HH3C-TRANSCEIVER-INFO-MIB)", () => {
    expect(TransceiverUnitUtil.fromFixedPoint(-473, 2)).toBe(-4.73);
    expect(TransceiverUnitUtil.fromFixedPoint(250, 2)).toBe(2.5);
  });

  test("thousandths (MIKROTIK-MIB dBm, HP-ICF temperature)", () => {
    expect(TransceiverUnitUtil.fromFixedPoint(-5673, 3)).toBe(-5.673);
    expect(TransceiverUnitUtil.fromFixedPoint(49120, 3)).toBe(49.12);
  });

  test("hundreds of microvolts (HP-ICF voltage)", () => {
    expect(TransceiverUnitUtil.fromFixedPoint(32928, 4)).toBe(3.2928);
  });

  test("zero decimals is the value itself", () => {
    expect(TransceiverUnitUtil.fromFixedPoint(41, 0)).toBe(41);
  });
});

describe("TransceiverUnitUtil.fromEntitySensorValue", () => {
  test("RFC 3433's own example: 258 at precision 1, units(9) is 25.8", () => {
    expect(
      TransceiverUnitUtil.fromEntitySensorValue({
        raw: 258,
        scale: 9,
        precision: 1,
      }),
    ).toBe(25.8);
  });

  test("milli(8) with precision 4: an optical power of 6322 is 0.0006322 W", () => {
    expect(
      TransceiverUnitUtil.fromEntitySensorValue({
        raw: 6322,
        scale: 8,
        precision: 4,
      }),
    ).toBeCloseTo(0.0006322, 10);
  });

  test("milli(8) with precision 2: a bias of 3345 is 0.03345 A", () => {
    expect(
      TransceiverUnitUtil.fromEntitySensorValue({
        raw: 3345,
        scale: 8,
        precision: 2,
      }),
    ).toBeCloseTo(0.03345, 10);
  });

  test("micro(7) and kilo(10) are three orders of magnitude from units", () => {
    expect(
      TransceiverUnitUtil.fromEntitySensorValue({
        raw: 500,
        scale: 7,
        precision: 0,
      }),
    ).toBeCloseTo(0.0005, 10);
    expect(
      TransceiverUnitUtil.fromEntitySensorValue({
        raw: 3,
        scale: 10,
        precision: 0,
      }),
    ).toBe(3000);
  });

  test("a precision of zero or below is not fixed-point", () => {
    expect(
      TransceiverUnitUtil.fromEntitySensorValue({
        raw: 1234,
        scale: 9,
        precision: 0,
      }),
    ).toBe(1234);
    expect(
      TransceiverUnitUtil.fromEntitySensorValue({
        raw: 1234,
        scale: 9,
        precision: -3,
      }),
    ).toBe(1234);
  });

  test("an unknown scale or precision falls back to units, not a guess", () => {
    expect(
      TransceiverUnitUtil.fromEntitySensorValue({
        raw: 42,
        scale: undefined,
        precision: undefined,
      }),
    ).toBe(42);
    expect(
      TransceiverUnitUtil.fromEntitySensorValue({
        raw: 42,
        scale: 99,
        precision: 77,
      }),
    ).toBe(42);
  });
});

describe("TransceiverUnitUtil.isUnavailableRawValue", () => {
  test.each<[number | undefined]>([
    [2147483647],
    [-2147483648],
    [1000000000],
    [-1000000000],
    [-32768],
    [undefined],
    [NaN],
    [Infinity],
  ])("%s means no reading", (raw: number | undefined) => {
    expect(TransceiverUnitUtil.isUnavailableRawValue(raw)).toBe(true);
  });

  test.each<[number]>([[0], [-4000], [-99], [3302], [85000]])(
    "%s is a real reading",
    (raw: number) => {
      expect(TransceiverUnitUtil.isUnavailableRawValue(raw)).toBe(false);
    },
  );
});

describe("TransceiverUnitUtil.clampDbm and roundTo", () => {
  test("clampDbm keeps a reading and floors a dark one", () => {
    expect(TransceiverUnitUtil.clampDbm(-4.731)).toBe(-4.73);
    expect(TransceiverUnitUtil.clampDbm(-45)).toBe(-40);
    expect(TransceiverUnitUtil.clampDbm(-Infinity)).toBe(-40);
  });

  test("roundTo never returns negative zero", () => {
    expect(Object.is(TransceiverUnitUtil.roundTo(-0.0001, 2), -0)).toBe(false);
    expect(TransceiverUnitUtil.roundTo(-0.0001, 2)).toBe(0);
  });
});
