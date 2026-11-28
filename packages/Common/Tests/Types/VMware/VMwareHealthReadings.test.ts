import {
  VMWARE_HEALTH_READINGS_KEEP_SECONDS,
  VMWARE_HEALTH_READINGS_MAX,
  VMWARE_HEALTH_READINGS_MAX_GAP_SECONDS,
  VMWARE_HEALTH_READING_FIELDS,
  VMwareHealthReading,
  VMwareHeldReading,
  getVMwarePastThresholdSince,
  hasVMwareReadingHeldFor,
  readVMwareHealthReadings,
} from "../../../Types/VMware/VMwareHealthReadings";
import { VMWARE_SWAP_RATE_MAX_GAP_SECONDS } from "../../../Server/Services/VMwareResourceService";
import { describe, expect, test } from "@jest/globals";

/*
 * "For at least N minutes" (#11469): what a part read lately, as ingest
 * keeps it on its row, and whether a reading past a threshold has held for
 * long enough to mark the part.
 *
 * T0 is a report time; reports every two minutes, as a vCenter collected
 * at the default interval sends them.
 */

const T0: number = Date.UTC(2026, 10, 27, 10, 0, 0) / 1000;
const MINUTE: number = 60;

function at(minutes: number, values: Partial<VMwareHealthReading>): VMwareHealthReading {
  return { t: T0 + minutes * MINUTE, ...values };
}

// A host's CPU every two minutes, from minute 0.
function cpuEveryTwoMinutes(values: Array<number>): Array<VMwareHealthReading> {
  return values.map((cpu: number, index: number): VMwareHealthReading => {
    return at(index * 2, { cpu });
  });
}

describe("how much is kept", () => {
  test("the longest wait and one gap more, never more than 64 readings", () => {
    expect(VMWARE_HEALTH_READINGS_KEEP_SECONDS).toBe(30 * 60 + 15 * 60);
    expect(VMWARE_HEALTH_READINGS_MAX).toBe(64);
    // A vCenter collected every minute keeps 45 readings: within the cap.
    expect(VMWARE_HEALTH_READINGS_KEEP_SECONDS / 60).toBeLessThan(
      VMWARE_HEALTH_READINGS_MAX,
    );
  });

  test("a run breaks across the gap the swap rates are worked out across too", () => {
    expect(VMWARE_HEALTH_READINGS_MAX_GAP_SECONDS).toBe(
      VMWARE_SWAP_RATE_MAX_GAP_SECONDS,
    );
  });

  test("names every reading a rule judges", () => {
    expect(VMWARE_HEALTH_READING_FIELDS).toEqual([
      "cpu",
      "mem",
      "disk",
      "so",
      "si",
      "sw",
      "bl",
      "rd",
    ]);
  });
});

describe("reading what a row holds", () => {
  test("oldest first, whatever order the row holds them in", () => {
    expect(
      readVMwareHealthReadings([at(4, { cpu: 3 }), at(0, { cpu: 1 }), at(2, { cpu: 2 })]),
    ).toEqual([at(0, { cpu: 1 }), at(2, { cpu: 2 }), at(4, { cpu: 3 })]);
  });

  test("a row from before #11469 holds none", () => {
    for (const value of [null, undefined, "", {}, 7, "not json"]) {
      expect(readVMwareHealthReadings(value)).toEqual([]);
    }
  });

  test("the JSON as the driver may hand it back, as text", () => {
    expect(
      readVMwareHealthReadings(JSON.stringify([at(0, { so: 2048, si: 0 })])),
    ).toEqual([at(0, { so: 2048, si: 0 })]);
  });

  test("numbers sent as text are numbers; what is not a number is left out", () => {
    expect(
      readVMwareHealthReadings([
        { t: String(T0), cpu: "91.5", mem: "lots", disk: null, sw: 0 },
      ]),
    ).toEqual([{ t: T0, cpu: 91.5, sw: 0 }]);
  });

  test("an entry with no time, a time of 0 or not an object is left out", () => {
    expect(
      readVMwareHealthReadings([
        { cpu: 99 },
        { t: 0, cpu: 99 },
        { t: -5, cpu: 99 },
        { t: "soon", cpu: 99 },
        [T0, 99],
        null,
        "x",
        at(0, { cpu: 50 }),
      ]),
    ).toEqual([at(0, { cpu: 50 })]);
  });

  test("a fractional time is whole seconds; keys that are no reading are dropped", () => {
    expect(
      readVMwareHealthReadings([{ t: T0 + 0.9, cpu: 1, other: 5 }]),
    ).toEqual([{ t: T0, cpu: 1 }]);
  });
});

describe("since when a reading has been past a threshold", () => {
  test("the first report of the newest run past it", () => {
    expect(
      getVMwarePastThresholdSince({
        readings: cpuEveryTwoMinutes([50, 95, 80, 95, 96, 97]),
        field: "cpu",
        threshold: 90,
      }),
    ).toEqual(new Date((T0 + 6 * MINUTE) * 1000));
  });

  test("none when the newest report is not past it", () => {
    expect(
      getVMwarePastThresholdSince({
        readings: cpuEveryTwoMinutes([95, 96, 97, 80]),
        field: "cpu",
        threshold: 90,
      }),
    ).toBeNull();
  });

  test("a reading at the threshold is not past it", () => {
    expect(
      getVMwarePastThresholdSince({
        readings: cpuEveryTwoMinutes([90]),
        field: "cpu",
        threshold: 90,
      }),
    ).toBeNull();
  });

  test("none for a rule turned off, no readings, or a field the readings do not hold", () => {
    expect(
      getVMwarePastThresholdSince({
        readings: cpuEveryTwoMinutes([99]),
        field: "cpu",
        threshold: null,
      }),
    ).toBeNull();
    expect(
      getVMwarePastThresholdSince({ readings: [], field: "cpu", threshold: 90 }),
    ).toBeNull();
    expect(
      getVMwarePastThresholdSince({
        readings: cpuEveryTwoMinutes([99]),
        field: "mem",
        threshold: 90,
      }),
    ).toBeNull();
  });

  test("a report that does not say the field ends the run", () => {
    expect(
      getVMwarePastThresholdSince({
        readings: [at(0, { cpu: 99 }), at(2, { mem: 50 }), at(4, { cpu: 99 })],
        field: "cpu",
        threshold: 90,
      }),
    ).toEqual(new Date((T0 + 4 * MINUTE) * 1000));
  });

  test("a gap longer than 15 minutes between reports ends the run", () => {
    expect(
      getVMwarePastThresholdSince({
        readings: [at(0, { cpu: 99 }), at(16, { cpu: 99 }), at(18, { cpu: 99 })],
        field: "cpu",
        threshold: 90,
      }),
    ).toEqual(new Date((T0 + 16 * MINUTE) * 1000));
    // Exactly 15 minutes apart is one run.
    expect(
      getVMwarePastThresholdSince({
        readings: [at(0, { cpu: 99 }), at(15, { cpu: 99 })],
        field: "cpu",
        threshold: 90,
      }),
    ).toEqual(new Date(T0 * 1000));
  });

  test("0 marks any amount at all", () => {
    expect(
      getVMwarePastThresholdSince({
        readings: [at(0, { so: 0 }), at(2, { so: 1 }), at(4, { so: 4096 })],
        field: "so",
        threshold: 0,
      }),
    ).toEqual(new Date((T0 + 2 * MINUTE) * 1000));
  });
});

describe("whether it has held for at least N minutes", () => {
  test("held once the run began that long before the newest report", () => {
    const readings: Array<VMwareHealthReading> = cpuEveryTwoMinutes([
      95, 95, 95, 95, 95, 95,
    ]);
    // The run began at 0, the newest report is at 10: ten minutes.
    expect(
      hasVMwareReadingHeldFor({
        readings,
        field: "cpu",
        threshold: 90,
        minutes: 10,
      }),
    ).toEqual({ isHeld: true, since: new Date(T0 * 1000) });
    expect(
      hasVMwareReadingHeldFor({
        readings,
        field: "cpu",
        threshold: 90,
        minutes: 11,
      }),
    ).toEqual({ isHeld: false, since: new Date(T0 * 1000) });
  });

  test("a dip below the threshold starts the wait again", () => {
    const held: VMwareHeldReading = hasVMwareReadingHeldFor({
      readings: cpuEveryTwoMinutes([95, 95, 95, 85, 95, 95]),
      field: "cpu",
      threshold: 90,
      minutes: 5,
    });
    expect(held).toEqual({
      isHeld: false,
      since: new Date((T0 + 8 * MINUTE) * 1000),
    });
  });

  test("0 minutes is the latest report alone", () => {
    expect(
      hasVMwareReadingHeldFor({
        readings: cpuEveryTwoMinutes([50, 95]),
        field: "cpu",
        threshold: 90,
        minutes: 0,
      }).isHeld,
    ).toBe(true);
    // Below 0 is read as 0.
    expect(
      hasVMwareReadingHeldFor({
        readings: cpuEveryTwoMinutes([95]),
        field: "cpu",
        threshold: 90,
        minutes: -3,
      }).isHeld,
    ).toBe(true);
  });

  test("a part new to the vCenter has not held anything yet", () => {
    expect(
      hasVMwareReadingHeldFor({
        readings: cpuEveryTwoMinutes([99]),
        field: "cpu",
        threshold: 90,
        minutes: 2,
      }),
    ).toEqual({ isHeld: false, since: new Date(T0 * 1000) });
  });

  test("not past the threshold is neither held nor begun", () => {
    expect(
      hasVMwareReadingHeldFor({
        readings: cpuEveryTwoMinutes([10, 20]),
        field: "cpu",
        threshold: 90,
        minutes: 0,
      }),
    ).toEqual({ isHeld: false, since: null });
  });

  test("a vCenter that went quiet for 20 minutes waits again from its return", () => {
    const readings: Array<VMwareHealthReading> = [
      at(0, { cpu: 99 }),
      at(2, { cpu: 99 }),
      at(22, { cpu: 99 }),
      at(24, { cpu: 99 }),
    ];
    expect(
      hasVMwareReadingHeldFor({
        readings,
        field: "cpu",
        threshold: 90,
        minutes: 5,
      }),
    ).toEqual({ isHeld: false, since: new Date((T0 + 22 * MINUTE) * 1000) });
  });
});
