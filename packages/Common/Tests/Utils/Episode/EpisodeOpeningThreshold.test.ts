import {
  DEFAULT_RECORDS_TO_OPEN_EPISODE,
  MAX_RECORDS_TO_OPEN_EPISODE,
  MIN_RECORDS_TO_OPEN_EPISODE,
  MIN_RECORDS_TO_WAIT_FOR,
  getRecordsToOpenEpisode,
  isValidRecordsToOpenEpisode,
} from "../../../Utils/Episode/EpisodeOpeningThreshold";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW MANY MATCHING RECORDS A GROUPING RULE WAITS FOR (issue #5374).
 *
 * One rule, read by the engines, the rule services that check a save and the
 * Dashboard's form:
 *
 *   - off - as every rule is until someone turns it on - is no wait: the
 *     first matching record opens the episode, as it always did;
 *   - on, a whole number above 1 is how many must be ongoing, and one above
 *     the most is read as the most;
 *   - anything else - 1, 0, a fraction, text, nothing - waits for nothing,
 *     so a rule written past the check still groups;
 *   - a save takes a whole number from 1 to 100 and nothing else.
 */

describe("the limits", () => {
  test("are a count of 1 to 100, starting at 3, with 2 the fewest worth waiting for", () => {
    expect(MIN_RECORDS_TO_OPEN_EPISODE).toBe(1);
    expect(MIN_RECORDS_TO_WAIT_FOR).toBe(2);
    expect(DEFAULT_RECORDS_TO_OPEN_EPISODE).toBe(3);
    expect(MAX_RECORDS_TO_OPEN_EPISODE).toBe(100);

    expect(MIN_RECORDS_TO_WAIT_FOR).toBeGreaterThan(
      MIN_RECORDS_TO_OPEN_EPISODE,
    );
    expect(DEFAULT_RECORDS_TO_OPEN_EPISODE).toBeGreaterThanOrEqual(
      MIN_RECORDS_TO_WAIT_FOR,
    );
    expect(DEFAULT_RECORDS_TO_OPEN_EPISODE).toBeLessThanOrEqual(
      MAX_RECORDS_TO_OPEN_EPISODE,
    );
  });
});

describe("getRecordsToOpenEpisode", () => {
  test.each([
    ["off", false],
    ["never set", undefined],
    ["null", null],
    ["the text true", "true"],
    ["1", 1],
  ] as Array<[string, unknown]>)(
    "waits for nothing while the switch is %s",
    (_name: string, enabled: unknown) => {
      expect(getRecordsToOpenEpisode({ enabled: enabled, count: 5 })).toBe(1);
    },
  );

  test.each([2, 3, 7, 42, 99, 100])(
    "on, waits for the count it was saved with: %d",
    (count: number) => {
      expect(getRecordsToOpenEpisode({ enabled: true, count: count })).toBe(
        count,
      );
    },
  );

  test.each([101, 250, 100000, Number.MAX_SAFE_INTEGER])(
    "on, reads a count above the most as the most: %d",
    (count: number) => {
      expect(getRecordsToOpenEpisode({ enabled: true, count: count })).toBe(
        MAX_RECORDS_TO_OPEN_EPISODE,
      );
    },
  );

  test.each([
    ["1", 1],
    ["0", 0],
    ["a negative count", -3],
    ["a fraction", 2.5],
    ["text", "5"],
    ["no count", undefined],
    ["null", null],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["an object", { count: 5 }],
  ] as Array<[string, unknown]>)(
    "on, waits for nothing with %s",
    (_name: string, count: unknown) => {
      expect(getRecordsToOpenEpisode({ enabled: true, count: count })).toBe(1);
    },
  );

  test("is always a whole number from 1 to 100, whatever it is handed", () => {
    const random: SeededRandom = seededRandom(5374);
    const pool: Array<unknown> = [
      true,
      false,
      undefined,
      null,
      "3",
      0,
      1,
      -1,
      2.5,
      NaN,
      Infinity,
      -Infinity,
      {},
      [],
    ];

    for (let draw: number = 0; draw < 2000; draw++) {
      const enabled: unknown = pool[random(pool.length)];
      const count: unknown =
        random() < 0.5
          ? random(400) - 100
          : random() < 0.5
            ? random() * 300
            : pool[random(pool.length)];

      const read: number = getRecordsToOpenEpisode({
        enabled: enabled,
        count: count,
      });

      expect(Number.isInteger(read)).toBe(true);
      expect(read).toBeGreaterThanOrEqual(MIN_RECORDS_TO_OPEN_EPISODE);
      expect(read).toBeLessThanOrEqual(MAX_RECORDS_TO_OPEN_EPISODE);

      // Only a switch that is really on, with a whole count above 1, waits.
      if (read > 1) {
        expect(enabled).toBe(true);
        expect(Number.isInteger(count)).toBe(true);
        expect(count as number).toBeGreaterThan(1);
      }
    }
  });
});

describe("isValidRecordsToOpenEpisode", () => {
  test.each([1, 2, 3, 50, 99, 100])("takes %d", (count: number) => {
    expect(isValidRecordsToOpenEpisode(count)).toBe(true);
  });

  test.each([
    ["0", 0],
    ["101", 101],
    ["a negative count", -1],
    ["a fraction", 3.5],
    ["text", "3"],
    ["null", null],
    ["undefined", undefined],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["true", true],
  ] as Array<[string, unknown]>)(
    "refuses %s",
    (_name: string, count: unknown) => {
      expect(isValidRecordsToOpenEpisode(count)).toBe(false);
    },
  );

  test("takes exactly what the engines act on as written", () => {
    for (let count: number = -5; count <= 110; count++) {
      if (!isValidRecordsToOpenEpisode(count)) {
        continue;
      }

      // A count the API takes is read as it is - 1 waits for nothing.
      expect(getRecordsToOpenEpisode({ enabled: true, count: count })).toBe(
        count,
      );
    }
  });
});
