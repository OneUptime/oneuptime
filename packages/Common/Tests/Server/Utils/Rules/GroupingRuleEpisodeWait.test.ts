import ObjectID from "../../../../Types/ObjectID";
import {
  RecordWaitingForEpisode,
  getGroupingWaitKey,
  getRecordsArrivedTogether,
} from "../../../../Server/Utils/Rules/GroupingRuleEpisodeWait";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A GROUPING RULE THAT WAITS FOR MORE RECORDS BEFORE IT OPENS AN EPISODE
 * (issue #5374): the mark a waiting record carries, and which waiting
 * records count when the next one of their group arrives.
 *
 *   - the mark is the rule and the grouping key together: one group's
 *     records share it, any other group's - another key, another rule -
 *     never do, and no title is kept in it;
 *   - with no time window, every waiting record counts;
 *   - with one, only the run that arrived close together - each within the
 *     window of the one after it, the newest within the window of now - as
 *     an open episode keeps taking records.
 */

const RULE_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-00000000a001");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-00000000a002",
);

const NOW: Date = new Date("2026-11-06T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

interface Waiting extends RecordWaitingForEpisode {
  name: string;
}

function minutesAgo(name: string, minutes: number): Waiting {
  return {
    name: name,
    createdAt: new Date(NOW.getTime() - minutes * MINUTE_MS),
  };
}

function names(records: Array<Waiting>): Array<string> {
  return records.map((record: Waiting): string => {
    return record.name;
  });
}

describe("getGroupingWaitKey", () => {
  test("is the same for every record of one rule's group", () => {
    expect(
      getGroupingWaitKey({ ruleId: RULE_ID, groupingKey: "default" }),
    ).toBe(getGroupingWaitKey({ ruleId: RULE_ID, groupingKey: "default" }));
    expect(
      getGroupingWaitKey({
        ruleId: new ObjectID(RULE_ID.toString()),
        groupingKey: "monitor:abc|severity:def",
      }),
    ).toBe(
      getGroupingWaitKey({
        ruleId: RULE_ID,
        groupingKey: "monitor:abc|severity:def",
      }),
    );
  });

  test("differs for another group of the rule, and for the same group of another rule", () => {
    const key: string = getGroupingWaitKey({
      ruleId: RULE_ID,
      groupingKey: "monitor:abc",
    });

    expect(
      getGroupingWaitKey({ ruleId: RULE_ID, groupingKey: "monitor:abd" }),
    ).not.toBe(key);
    expect(
      getGroupingWaitKey({ ruleId: OTHER_RULE_ID, groupingKey: "monitor:abc" }),
    ).not.toBe(key);
  });

  test("keeps no title, and fits the short text column whatever the key holds", () => {
    const title: string = "Northwind payroll export copied to a public bucket";
    const keys: Array<string> = [
      "default",
      `title:${title.toLowerCase()}`,
      `title:${"x".repeat(5000)}|monitor:${RULE_ID.toString()}`,
      "",
    ];

    for (const groupingKey of keys) {
      const waitKey: string = getGroupingWaitKey({
        ruleId: RULE_ID,
        groupingKey: groupingKey,
      });

      expect(waitKey).toMatch(/^[0-9a-f]{64}$/);
      expect(waitKey.length).toBeLessThanOrEqual(100);
      expect(waitKey).not.toMatch(/northwind|payroll|default|title/i);
    }
  });

  test("tells a thousand groups of one rule apart", () => {
    const seen: Set<string> = new Set<string>();

    for (let index: number = 0; index < 1000; index++) {
      seen.add(
        getGroupingWaitKey({
          ruleId: RULE_ID,
          groupingKey: `monitor:${index.toString().padStart(4, "0")}`,
        }),
      );
    }

    expect(seen.size).toBe(1000);
  });
});

describe("getRecordsArrivedTogether", () => {
  test("with no time window, every waiting record counts, newest first", () => {
    const waiting: Array<Waiting> = [
      minutesAgo("a week ago", 7 * 24 * 60),
      minutesAgo("just now", 1),
      minutesAgo("an hour ago", 60),
    ];

    expect(
      names(
        getRecordsArrivedTogether({
          waiting: waiting,
          timeWindowMinutes: null,
          now: NOW,
        }),
      ),
    ).toEqual(["just now", "an hour ago", "a week ago"]);
  });

  test("with a window, counts the run that arrived within it of each other", () => {
    // 2, 9 and 15 minutes ago are each within 10 minutes of the next.
    const waiting: Array<Waiting> = [
      minutesAgo("2", 2),
      minutesAgo("9", 9),
      minutesAgo("15", 15),
      // 15 -> 40 is a gap of 25: the run ends there.
      minutesAgo("40", 40),
      minutesAgo("45", 45),
    ];

    expect(
      names(
        getRecordsArrivedTogether({
          waiting: waiting,
          timeWindowMinutes: 10,
          now: NOW,
        }),
      ),
    ).toEqual(["2", "9", "15"]);
  });

  test("with a window, counts none when the newest arrived longer ago than it", () => {
    expect(
      getRecordsArrivedTogether({
        waiting: [minutesAgo("11", 11), minutesAgo("12", 12)],
        timeWindowMinutes: 10,
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("a record exactly the window away still counts, one a moment more does not", () => {
    expect(
      names(
        getRecordsArrivedTogether({
          waiting: [minutesAgo("10", 10), minutesAgo("20", 20)],
          timeWindowMinutes: 10,
          now: NOW,
        }),
      ),
    ).toEqual(["10", "20"]);

    expect(
      names(
        getRecordsArrivedTogether({
          waiting: [
            {
              name: "10 and a bit",
              createdAt: new Date(NOW.getTime() - 10 * MINUTE_MS - 1),
            },
          ],
          timeWindowMinutes: 10,
          now: NOW,
        }),
      ),
    ).toEqual([]);
  });

  test("reads them newest first whatever order they come in", () => {
    const random: SeededRandom = seededRandom(5374);

    for (let trial: number = 0; trial < 200; trial++) {
      const waiting: Array<Waiting> = [];
      const count: number = 1 + random(12);

      for (let index: number = 0; index < count; index++) {
        waiting.push(minutesAgo(`r${index}`, random(60)));
      }

      const shuffledOrder: Array<Waiting> = shuffled(waiting, random);

      expect(
        names(
          getRecordsArrivedTogether({
            waiting: shuffledOrder,
            timeWindowMinutes: 7,
            now: NOW,
          }),
        ).sort(),
      ).toEqual(
        names(
          getRecordsArrivedTogether({
            waiting: waiting,
            timeWindowMinutes: 7,
            now: NOW,
          }),
        ).sort(),
      );
    }
  });

  test("a record whose arrival is not known ends the run, and counts with no window", () => {
    const waiting: Array<Waiting> = [
      minutesAgo("1", 1),
      { name: "unknown" },
      minutesAgo("3", 3),
    ];

    expect(
      names(
        getRecordsArrivedTogether({
          waiting: waiting,
          timeWindowMinutes: 10,
          now: NOW,
        }),
      ),
    ).toEqual(["1", "3"]);

    expect(
      names(
        getRecordsArrivedTogether({
          waiting: waiting,
          timeWindowMinutes: null,
          now: NOW,
        }),
      ),
    ).toEqual(["1", "3", "unknown"]);
  });

  test("takes an arrival written as text, as a record read through the API carries it", () => {
    expect(
      names(
        getRecordsArrivedTogether({
          waiting: [
            {
              name: "text",
              createdAt: new Date(
                NOW.getTime() - 4 * MINUTE_MS,
              ).toISOString() as unknown as Date,
            },
          ],
          timeWindowMinutes: 5,
          now: NOW,
        }),
      ),
    ).toEqual(["text"]);
  });

  test("never hands back what it was not handed, nor changes what it was", () => {
    const waiting: Array<Waiting> = [
      minutesAgo("5", 5),
      minutesAgo("1", 1),
      minutesAgo("3", 3),
    ];
    const before: Array<string> = names(waiting);

    const together: Array<Waiting> = getRecordsArrivedTogether({
      waiting: waiting,
      timeWindowMinutes: 10,
      now: NOW,
    });

    expect(names(waiting)).toEqual(before);
    expect(together).toHaveLength(3);

    for (const record of together) {
      expect(waiting).toContain(record);
    }
  });

  test("matches a walk of the gaps on random arrivals", () => {
    const random: SeededRandom = seededRandom(2718);

    for (let trial: number = 0; trial < 500; trial++) {
      const windowMinutes: number = 1 + random(30);
      const waiting: Array<Waiting> = [];
      const count: number = random(15);

      for (let index: number = 0; index < count; index++) {
        waiting.push(minutesAgo(`r${index}`, random(240)));
      }

      const together: Array<Waiting> = getRecordsArrivedTogether({
        waiting: waiting,
        timeWindowMinutes: windowMinutes,
        now: NOW,
      });

      // Newest first, each within the window of the one after it.
      let next: number = NOW.getTime();

      for (const record of together) {
        const arrival: number = (record.createdAt as Date).getTime();
        expect(next - arrival).toBeLessThanOrEqual(windowMinutes * MINUTE_MS);
        expect(arrival).toBeLessThanOrEqual(next);
        next = arrival;
      }

      // And nothing left out could have extended the run.
      const left: Array<Waiting> = waiting.filter((record: Waiting) => {
        return !together.includes(record);
      });

      for (const record of left) {
        const arrival: number = (record.createdAt as Date).getTime();
        expect(next - arrival).toBeGreaterThan(windowMinutes * MINUTE_MS);
      }
    }
  });
});
