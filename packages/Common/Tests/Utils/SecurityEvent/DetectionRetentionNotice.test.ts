import {
  DATA_RETENTION_PLACE,
  describeDetectionRetentionNotice,
  joinDetectionRunNotices,
} from "../../../Utils/SecurityEvent/DetectionRetentionNotice";
import { isDetectionRunNotice } from "../../../Utils/SecurityEvent/DetectionOverflow";
import { DetectionRuleDefinition } from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { describe, expect, test } from "@jest/globals";

/*
 * The note a rule's run leaves when the rule reads further back than the
 * project keeps its security events (#10432): what it looked back, what
 * the rule asks for, what that means, and what to change - as a note about
 * the run's own work (Needs attention), never a failure. Nothing when the
 * events kept cover the rule's window.
 */

const FIRST_SEEN_30_DAYS: string = `title: AWS activity in a new region
correlation:
  type: new_value
  rules: [call]
  group-by: [targetHost]
  timespan: 30d
  condition:
    field: awsRegion
---
title: Call
name: call
detection:
  selection:
    productName: AWS CloudTrail
  condition: selection`;

const FIRST_SEEN_14_DAYS: string = FIRST_SEEN_30_DAYS.replace(
  "timespan: 30d",
  "timespan: 14d",
);

const SEQUENCE_WITH_COUNTING_STEP: string = `title: A burst, then a success
correlation:
  type: temporal_ordered
  rules: [burst, success]
  group-by: [principalIp]
  timespan: 1d
---
title: Burst
name: burst
correlation:
  type: event_count
  rules: [failure]
  group-by: [principalIp]
  timespan: 12h
  condition:
    gte: 5
---
title: Failure
name: failure
detection:
  selection:
    statusName: Failure
  condition: selection
---
title: Success
name: success
detection:
  selection:
    statusName: Success
  condition: selection`;

const SINGLE: string = `title: Audit log cleared
detection:
  selection:
    className: Account Change
  condition: selection`;

function parse(yaml: string): DetectionRuleDefinition {
  return SigmaRuleSetParser.parse(yaml);
}

describe("describeDetectionRetentionNotice", () => {
  test("a 30-day First seen rule, 15 days kept: what it looked back, what a value then reads as, and what to change", () => {
    expect(
      describeDetectionRetentionNotice({
        definition: parse(FIRST_SEEN_30_DAYS),
        retentionInDays: 15,
      }),
    ).toBe(
      "This run looked back 15 days, not the 30 days this rule asks for: security events are kept for 15 days, so a value last seen before then reads as new. Keep them for at least 30 days under Project Settings > Telemetry & APM > Data Retention, or shorten the rule's timespan to 15 days.",
    );
  });

  test("a week kept reads as a week", () => {
    expect(
      describeDetectionRetentionNotice({
        definition: parse(FIRST_SEEN_14_DAYS),
        retentionInDays: 7,
      }),
    ).toBe(
      "This run looked back 1 week, not the 2 weeks this rule asks for: security events are kept for 1 week, so a value last seen before then reads as new. Keep them for at least 2 weeks under Project Settings > Telemetry & APM > Data Retention, or shorten the rule's timespan to 1 week.",
    );
  });

  test("a sequence counts only the events kept", () => {
    expect(
      describeDetectionRetentionNotice({
        definition: parse(SEQUENCE_WITH_COUNTING_STEP),
        retentionInDays: 1,
      }),
    ).toBe(
      "This run read 1 day of events, not the 36 hours this rule's window needs: security events are kept for 1 day, so it counts only those. Keep them for at least 2 days under Project Settings > Telemetry & APM > Data Retention, or shorten the rule's timespan.",
    );
  });

  test("nothing while the events kept cover the window", () => {
    for (const retentionInDays of [30, 31, 90, 400]) {
      expect(
        describeDetectionRetentionNotice({
          definition: parse(FIRST_SEEN_30_DAYS),
          retentionInDays,
        }),
      ).toBeNull();
    }

    expect(
      describeDetectionRetentionNotice({
        definition: parse(FIRST_SEEN_14_DAYS),
        retentionInDays: 15,
      }),
    ).toBeNull();
    expect(
      describeDetectionRetentionNotice({
        definition: parse(SEQUENCE_WITH_COUNTING_STEP),
        retentionInDays: 2,
      }),
    ).toBeNull();
  });

  test("never for a single rule, which reads nothing before its events", () => {
    expect(
      describeDetectionRetentionNotice({
        definition: parse(SINGLE),
        retentionInDays: 1,
      }),
    ).toBeNull();
  });

  test("it is a note about the run's own work: the row reads Needs attention, not a failure", () => {
    const notice: string | null = describeDetectionRetentionNotice({
      definition: parse(FIRST_SEEN_30_DAYS),
      retentionInDays: 15,
    });

    expect(isDetectionRunNotice(notice)).toBe(true);
  });

  test("it names the place the retention is changed as the docs do", () => {
    expect(DATA_RETENTION_PLACE).toBe(
      "Project Settings > Telemetry & APM > Data Retention",
    );
  });
});

describe("joinDetectionRunNotices", () => {
  test("each note a sentence of its own, in order; none when there are none", () => {
    expect(joinDetectionRunNotices(["This run a.", "This run b."])).toBe(
      "This run a. This run b.",
    );
    expect(joinDetectionRunNotices([null, "This run b.", undefined])).toBe(
      "This run b.",
    );
    expect(joinDetectionRunNotices([null, undefined, " "])).toBeNull();
    expect(joinDetectionRunNotices([])).toBeNull();
  });

  test("notes joined are still a note", () => {
    expect(
      isDetectionRunNotice(
        joinDetectionRunNotices(["This run a.", "This run b."]),
      ),
    ).toBe(true);
  });
});
