import {
  CRITICAL_ALERT_VOLUME_MAX_PERCENT,
  CRITICAL_ALERT_VOLUME_MIN_PERCENT,
  CRITICAL_ALERT_VOLUME_OPTIONS,
  DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT,
  getCriticalAlertVolumePercent,
  isCriticalAlertVolumePercent,
  toCriticalAlertSoundVolume,
} from "../../../Types/PushNotification/CriticalAlertVolume";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * How loud a critical on-call page plays on an iPhone. iOS takes the volume
 * from the push itself, whatever the ringer says, so the number the server
 * sends IS the volume the responder hears. Three ways it goes wrong, none of
 * which fails loudly:
 *
 *   - a value read as zero, or anywhere near it, is a critical alert that
 *     rings through silent mode at a volume that wakes nobody;
 *   - a value above 1 is refused or clipped by APNs, depending on the path;
 *   - a value the API stores that the delivery path reads differently is a
 *     setting that looks saved and does something else.
 *
 * So the bounds, the steps the app offers, the API's acceptance rule and the
 * page's reading of anything stored are all pinned here, including what a
 * row could hold that this server never wrote.
 */

describe("the critical alert volume bounds", () => {
  test("runs from 10 to 100 percent", () => {
    expect(CRITICAL_ALERT_VOLUME_MIN_PERCENT).toBe(10);
    expect(CRITICAL_ALERT_VOLUME_MAX_PERCENT).toBe(100);
  });

  test("never goes down to silence", () => {
    /*
     * A critical alert at 0% would show as switched on while waking nobody,
     * which is worse than switched off: the responder believes they will be
     * woken.
     */
    expect(CRITICAL_ALERT_VOLUME_MIN_PERCENT).toBeGreaterThan(0);
    expect(toCriticalAlertSoundVolume(0)).toBeGreaterThan(0);
  });

  test("defaults to full volume, which is what every critical page played before the choice existed", () => {
    expect(DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT).toBe(100);
    expect(DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT).toBe(
      CRITICAL_ALERT_VOLUME_MAX_PERCENT,
    );
  });
});

describe("the volume steps the app offers", () => {
  test("are 25, 50, 75 and 100 percent", () => {
    expect(CRITICAL_ALERT_VOLUME_OPTIONS).toEqual([25, 50, 75, 100]);
  });

  test("are listed quietest first, once each", () => {
    const sorted: Array<number> = [...CRITICAL_ALERT_VOLUME_OPTIONS].sort(
      (left: number, right: number): number => {
        return left - right;
      },
    );

    expect([...CRITICAL_ALERT_VOLUME_OPTIONS]).toEqual(sorted);
    expect(new Set<number>(CRITICAL_ALERT_VOLUME_OPTIONS).size).toBe(
      CRITICAL_ALERT_VOLUME_OPTIONS.length,
    );
  });

  test.each(
    CRITICAL_ALERT_VOLUME_OPTIONS.map((option: number): [number] => {
      return [option];
    }),
  )("%s%% is a volume the API stores as it is", (option: number) => {
    /*
     * A step the app offers that the API refused would be a choice the
     * responder can make and never keep.
     */
    expect(isCriticalAlertVolumePercent(option)).toBe(true);
    expect(getCriticalAlertVolumePercent(option)).toBe(option);
  });

  test("include the default, so a device that never chose shows one of them selected", () => {
    expect(CRITICAL_ALERT_VOLUME_OPTIONS).toContain(
      DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT,
    );
  });

  test("offer full volume as the loudest step", () => {
    expect(
      CRITICAL_ALERT_VOLUME_OPTIONS[CRITICAL_ALERT_VOLUME_OPTIONS.length - 1],
    ).toBe(CRITICAL_ALERT_VOLUME_MAX_PERCENT);
  });
});

describe("isCriticalAlertVolumePercent", () => {
  test.each([
    ["the floor", 10],
    ["just above the floor", 11],
    ["a quarter", 25],
    ["half", 50],
    ["three quarters", 75],
    ["just below full", 99],
    ["full", 100],
    ["a whole number written with a decimal point", 10.0],
    ["a whole number written as an exponent", 1e2],
  ])("accepts %s (%s)", (_label: string, value: number) => {
    expect(isCriticalAlertVolumePercent(value)).toBe(true);
  });

  test.each([
    ["just below the floor", 9],
    ["zero", 0],
    ["negative zero", -0],
    ["a negative percentage", -5],
    ["just above full", 101],
    ["a fraction already in APNs' 0 to 1 form", 0.5],
    ["full volume in APNs' form", 1],
    ["a thousand", 1000],
    ["a fraction of a percent above the floor", 10.4],
    ["half a percent above the floor", 10.5],
    ["half a percent below full", 99.5],
    ["a fraction in the middle", 50.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["the largest number", Number.MAX_VALUE],
    ["a number written as text", "50"],
    ["full volume written as text", "100"],
    ["padded text", " 50"],
    ["a percentage with its sign", "50%"],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["true", true],
    ["false", false],
    ["an object", { volume: 50 }],
    ["an array holding a volume", [50]],
    ["a boxed number", Object(50)],
    ["a bigint", BigInt(50)],
  ])("refuses %s", (_label: string, value: unknown) => {
    /*
     * The preferences route refuses whatever this refuses, by name. Accepting
     * "50" or 0.5 here would store a value the delivery path reads as
     * something else - full volume, or the floor.
     */
    expect(isCriticalAlertVolumePercent(value)).toBe(false);
  });

  test("accepts every whole percentage from the floor to full, and nothing around them", () => {
    for (let value: number = -50; value <= 200; value++) {
      expect({ value, accepted: isCriticalAlertVolumePercent(value) }).toEqual({
        value,
        accepted: value >= 10 && value <= 100,
      });
    }
  });

  test("refuses every non-whole number in range, however close to a whole one", () => {
    const random: SeededRandom = seededRandom(1013);

    for (let draw: number = 0; draw < 2000; draw++) {
      const whole: number = 10 + random(90);
      const fraction: number = 0.000001 + random() * 0.999998;
      const value: number = whole + fraction;

      expect({ value, accepted: isCriticalAlertVolumePercent(value) }).toEqual({
        value,
        accepted: false,
      });
    }
  });
});

describe("getCriticalAlertVolumePercent - the volume a device is paged at", () => {
  test("keeps every whole percentage within the bounds as it is", () => {
    for (let value: number = 10; value <= 100; value++) {
      expect(getCriticalAlertVolumePercent(value)).toBe(value);
    }
  });

  test.each([
    ["just below the floor", 9, 10],
    ["zero", 0, 10],
    ["negative zero", -0, 10],
    ["a negative percentage", -5, 10],
    ["the most negative number", -Number.MAX_VALUE, 10],
    ["the smallest positive number", Number.MIN_VALUE, 10],
    ["a fraction that rounds below the floor", 9.4, 10],
    ["a fraction that rounds to the floor", 9.5, 10],
    ["the floor", 10, 10],
    ["a fraction that rounds down to the floor", 10.4, 10],
    ["half a percent above the floor, which rounds up", 10.5, 11],
    ["a fraction in the middle", 50.5, 51],
    ["a fraction just under a half", 74.49, 74],
    ["a fraction that rounds down below full", 99.4, 99],
    ["half a percent below full, which rounds up to it", 99.5, 100],
    ["full", 100, 100],
    ["a fraction above full", 100.4, 100],
    ["a fraction that rounds above full", 100.5, 100],
    ["just above full", 101, 100],
    ["a thousand", 1000, 100],
    ["the largest number", Number.MAX_VALUE, 100],
  ])(
    "reads %s (%s) as %s",
    (_label: string, stored: number, expected: number) => {
      /*
       * Never written by this server, but a page must not fail - or go out
       * silent - on a row that holds one: it is pulled back inside the
       * bounds, to the nearest whole percentage.
       */
      expect(getCriticalAlertVolumePercent(stored)).toBe(expected);
    },
  );

  test.each([
    ["undefined (a device read without the column)", undefined],
    ["null", null],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["a number written as text", "50"],
    ["text that is no number at all", "loud"],
    ["an empty string", ""],
    ["true", true],
    ["false", false],
    ["an object", { volume: 50 }],
    ["an array", [50]],
    ["a boxed number", Object(25)],
    ["a bigint", BigInt(25)],
  ])("reads %s as full volume", (_label: string, stored: unknown) => {
    /*
     * Anything that is not a finite number is not a volume anybody chose, so
     * the page goes out as it always did: full. Failing loud rather than
     * quiet is the right way round for a page meant to wake somebody.
     */
    expect(getCriticalAlertVolumePercent(stored)).toBe(
      DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT,
    );
  });

  test("always answers a whole percentage within the bounds, over thousands of generated values", () => {
    const random: SeededRandom = seededRandom(20261013);

    for (let draw: number = 0; draw < 5000; draw++) {
      const value: number = (random() - 0.5) * 2000;
      const percent: number = getCriticalAlertVolumePercent(value);

      expect(Number.isInteger(percent)).toBe(true);
      expect(percent).toBeGreaterThanOrEqual(CRITICAL_ALERT_VOLUME_MIN_PERCENT);
      expect(percent).toBeLessThanOrEqual(CRITICAL_ALERT_VOLUME_MAX_PERCENT);
    }
  });

  test("never makes a louder stored value quieter than a softer one", () => {
    /*
     * Pulling values back inside the bounds must keep their order: a device
     * set louder than another is never paged more quietly than it.
     */
    const random: SeededRandom = seededRandom(31337);

    for (let draw: number = 0; draw < 2000; draw++) {
      const first: number = (random() - 0.25) * 200;
      const second: number = (random() - 0.25) * 200;
      const softer: number = Math.min(first, second);
      const louder: number = Math.max(first, second);

      expect(getCriticalAlertVolumePercent(softer)).toBeLessThanOrEqual(
        getCriticalAlertVolumePercent(louder),
      );
    }
  });

  test("whatever it answers is a volume the API would have stored", () => {
    const inputs: Array<unknown> = [
      undefined,
      null,
      NaN,
      -Infinity,
      Infinity,
      -5,
      0,
      9.5,
      10.5,
      55.5,
      99.5,
      101,
      "50",
    ];

    for (const input of inputs) {
      expect(
        isCriticalAlertVolumePercent(getCriticalAlertVolumePercent(input)),
      ).toBe(true);
    }
  });
});

describe("toCriticalAlertSoundVolume - what the iOS push carries", () => {
  test.each([
    [10, 0.1],
    [25, 0.25],
    [50, 0.5],
    [75, 0.75],
    [100, 1],
  ])("%s%% goes out as %s", (percent: number, volume: number) => {
    expect(toCriticalAlertSoundVolume(percent)).toBe(volume);
  });

  test("is exactly the percentage over 100 for every whole percentage within the bounds", () => {
    for (let percent: number = 10; percent <= 100; percent++) {
      expect(toCriticalAlertSoundVolume(percent)).toBe(percent / 100);
    }
  });

  test.each([
    ["undefined (a device that never chose)", undefined],
    ["null", null],
    ["NaN", NaN],
    ["a number written as text", "50"],
  ])("%s goes out at full volume, 1", (_label: string, stored: unknown) => {
    expect(toCriticalAlertSoundVolume(stored)).toBe(1);
  });

  test.each([
    ["a stored 5", 5, 0.1],
    ["a stored 0", 0, 0.1],
    ["a stored -20", -20, 0.1],
    ["a stored 250", 250, 1],
    ["a stored 1, which is not APNs' full volume here", 1, 0.1],
  ])(
    "%s is pulled back inside the bounds before it is sent (%s -> %s)",
    (_label: string, stored: number, volume: number) => {
      expect(toCriticalAlertSoundVolume(stored)).toBe(volume);
    },
  );

  test("never sends silence, and never more than APNs' 1", () => {
    const random: SeededRandom = seededRandom(4096);
    const inputs: Array<unknown> = [
      undefined,
      null,
      NaN,
      Infinity,
      -Infinity,
      "",
      "100",
    ];

    for (let draw: number = 0; draw < 2000; draw++) {
      inputs.push((random() - 0.5) * 1000);
    }

    for (const input of inputs) {
      const volume: number = toCriticalAlertSoundVolume(input);

      expect(volume).toBeGreaterThanOrEqual(0.1);
      expect(volume).toBeLessThanOrEqual(1);
    }
  });
});
