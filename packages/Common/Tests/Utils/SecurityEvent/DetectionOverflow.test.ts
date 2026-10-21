import {
  DetectionGroupSplit,
  describeDetectionOverflow,
  splitDetectionGroups,
} from "../../../Utils/SecurityEvent/DetectionOverflow";
import { describe, expect, test } from "@jest/globals";

/*
 * What one run of a detection rule or a threat-intel feed does with the
 * groups it matched, highest count first: the first ones open alerts and
 * cases of their own, every one read is recorded, and the rest - the
 * overflow - share one case about the source, whose last error says how
 * many there were. Nothing is dropped without a word.
 */

function groups(count: number): Array<string> {
  const list: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    list.push(`group-${index}`);
  }

  return list;
}

describe("splitDetectionGroups", () => {
  test("fewer groups than a run opens cases for: every one opens its own, none overflow", () => {
    const split: DetectionGroupSplit<string> = splitDetectionGroups(
      groups(3),
      { openLimit: 5, recordLimit: 10 },
    );

    expect(split.opened).toEqual(["group-0", "group-1", "group-2"]);
    expect(split.recorded).toEqual(split.opened);
    expect(split.overflow).toEqual([]);
    expect(split.moreThanRead).toBe(false);
  });

  test("more than it opens cases for: the first open theirs, every one is recorded, the rest overflow", () => {
    const split: DetectionGroupSplit<string> = splitDetectionGroups(
      groups(8),
      { openLimit: 5, recordLimit: 10 },
    );

    expect(split.opened).toEqual(groups(5));
    expect(split.recorded).toEqual(groups(8));
    expect(split.overflow).toEqual(["group-5", "group-6", "group-7"]);
    expect(split.moreThanRead).toBe(false);
  });

  test("exactly as many as a run reads is not more than it reads", () => {
    const split: DetectionGroupSplit<string> = splitDetectionGroups(
      groups(10),
      { openLimit: 5, recordLimit: 10 },
    );

    expect(split.recorded).toHaveLength(10);
    expect(split.moreThanRead).toBe(false);
  });

  test("one more than it reads - the match query's extra row - says there were more", () => {
    const split: DetectionGroupSplit<string> = splitDetectionGroups(
      groups(11),
      { openLimit: 5, recordLimit: 10 },
    );

    expect(split.recorded).toEqual(groups(10));
    expect(split.overflow).toHaveLength(5);
    expect(split.moreThanRead).toBe(true);
  });
});

describe("describeDetectionOverflow", () => {
  test("a rule whose groups are all findings", () => {
    expect(
      describeDetectionOverflow({
        kind: "rule",
        matched: 2340,
        moreThanRead: false,
        opened: 100,
        findingsWritten: true,
      }),
    ).toBe(
      "This run matched 2,340 groups. Alerts, incidents and cases opened for the 100 with the most matches; every one of them is a Detection Finding. Raise the Match Count Threshold, or group by a coarser field.",
    );
  });

  test("a rule that matched more than a run reads", () => {
    expect(
      describeDetectionOverflow({
        kind: "rule",
        matched: 10000,
        moreThanRead: true,
        opened: 100,
        findingsWritten: true,
      }),
    ).toBe(
      "This run matched more than 10,000 groups. Alerts, incidents and cases opened for the 100 with the most matches; the 10,000 with the most matches are Detection Findings, and the rest were not recorded. Raise the Match Count Threshold, or group by a coarser field.",
    );
  });

  test("a rule that writes no findings", () => {
    expect(
      describeDetectionOverflow({
        kind: "rule",
        matched: 101,
        moreThanRead: false,
        opened: 100,
        findingsWritten: false,
      }),
    ).toBe(
      "This run matched 101 groups. Alerts, incidents and cases opened for the 100 with the most matches; the rest were not recorded, because Write Detection Finding on Match is off. Raise the Match Count Threshold, or group by a coarser field.",
    );
  });

  test("a feed's check, in a feed's words", () => {
    expect(
      describeDetectionOverflow({
        kind: "feed",
        matched: 150,
        moreThanRead: false,
        opened: 100,
        findingsWritten: false,
      }),
    ).toBe(
      "This check matched 150 indicator values. Alerts, incidents and cases opened for the 100 with the most matches; the rest were not recorded, because Write Detection Finding on Match is off for this feed. Check the feed for indicators that match everyday values, or raise its Minimum Confidence.",
    );
  });
});
