import {
  SecurityRepeatOffenderBlock,
  SecurityRepeatOffenderRecord,
  SecurityRepeatOffenderSummary,
  getSecurityRepeatOffenderRecordBefore,
  getSecurityRepeatOffenderSuggestedDuration,
  readSecurityRepeatOffenderSummary,
  summarizeSecurityRepeatOffender,
  writeSecurityRepeatOffenderSummary,
} from "../../../Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import { JSONObject } from "../../../Types/JSON";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { describe, expect, test } from "@jest/globals";

/*
 * A CASE'S REPEAT OFFENDER (#10354): "Blocked twice before, last on 12 Nov
 * (case CASE-812)" counts the blocks made before the case opened, never the
 * case's own, and the block offered is the ladder's next step - 1 hour,
 * then 24 hours, then 7 days, shared with automatic response (#10350) -
 * never less than a person's default 24 hours.
 */

const CASE_OPENED: Date = new Date("2026-11-20T10:00:00.000Z");

function block(
  overrides: Partial<SecurityRepeatOffenderBlock>,
): SecurityRepeatOffenderBlock {
  return {
    securityBlockId: "b",
    value: "35.205.11.131",
    action: SecurityBlockAction.Block,
    source: SecurityBlockSource.Person,
    state: SecurityBlockState.Expired,
    createdAt: new Date("2026-11-12T09:00:00.000Z"),
    securityCaseId: "case-812",
    caseNumber: "CASE-812",
    ...overrides,
  };
}

function record(
  blocks: Array<SecurityRepeatOffenderBlock>,
): SecurityRepeatOffenderRecord {
  return {
    value: "35.205.11.131",
    since: new Date("2026-10-21T10:00:00.000Z"),
    blocks,
    offenceCount: blocks.length,
    last: blocks[0] || null,
  };
}

describe("the block a person is offered for a repeat offender", () => {
  test("is the ladder's next step from its foot, never under 24 hours", () => {
    expect(getSecurityRepeatOffenderSuggestedDuration(0)).toBe(
      SecurityBlockDuration.OneDay,
    );
    expect(getSecurityRepeatOffenderSuggestedDuration(1)).toBe(
      SecurityBlockDuration.OneDay,
    );
    expect(getSecurityRepeatOffenderSuggestedDuration(2)).toBe(
      SecurityBlockDuration.SevenDays,
    );
    // The ladder's top is 7 days, however often it came back.
    expect(getSecurityRepeatOffenderSuggestedDuration(9)).toBe(
      SecurityBlockDuration.SevenDays,
    );
  });

  test("reads anything that is no count as none", () => {
    expect(getSecurityRepeatOffenderSuggestedDuration(Number.NaN)).toBe(
      SecurityBlockDuration.OneDay,
    );
    expect(getSecurityRepeatOffenderSuggestedDuration(-3)).toBe(
      SecurityBlockDuration.OneDay,
    );
  });
});

describe("the record as it stood when the case opened", () => {
  test("counts only the blocks made before the case opened", () => {
    const before: SecurityRepeatOffenderRecord =
      getSecurityRepeatOffenderRecordBefore({
        record: record([
          block({
            securityBlockId: "after",
            createdAt: new Date("2026-11-20T11:00:00.000Z"),
            securityCaseId: "case-900",
            caseNumber: "CASE-900",
          }),
          block({
            securityBlockId: "twelfth",
            createdAt: new Date("2026-11-12T09:00:00.000Z"),
          }),
          block({
            securityBlockId: "fifth",
            createdAt: new Date("2026-11-05T09:00:00.000Z"),
            securityCaseId: "case-700",
            caseNumber: "CASE-700",
          }),
        ]),
        before: CASE_OPENED,
      });

    expect(before.offenceCount).toBe(2);
    expect(before.last?.securityBlockId).toBe("twelfth");
    expect(before.last?.caseNumber).toBe("CASE-812");
  });

  test("never counts a block made for the case itself", () => {
    const before: SecurityRepeatOffenderRecord =
      getSecurityRepeatOffenderRecordBefore({
        record: record([
          block({ securityBlockId: "own", securityCaseId: "case-1000" }),
        ]),
        before: CASE_OPENED,
        excludingCaseId: "case-1000",
      });

    expect(before.offenceCount).toBe(0);
    expect(before.last).toBeNull();
  });

  test("a block someone lifted is kept in the record, and is no offence", () => {
    const before: SecurityRepeatOffenderRecord =
      getSecurityRepeatOffenderRecordBefore({
        record: record([
          block({
            securityBlockId: "lifted",
            state: SecurityBlockState.Lifted,
          }),
          block({
            securityBlockId: "expired",
            createdAt: new Date("2026-11-01T09:00:00.000Z"),
          }),
        ]),
        before: CASE_OPENED,
      });

    expect(before.blocks).toHaveLength(2);
    expect(before.offenceCount).toBe(1);
    expect(before.last?.securityBlockId).toBe("expired");
  });
});

describe("a repeat offender, on the wire", () => {
  test("says how often, the latest, and the ladder's next step, and reads back the same", () => {
    const summary: SecurityRepeatOffenderSummary =
      summarizeSecurityRepeatOffender(
        record([
          block({ securityBlockId: "twelfth" }),
          block({
            securityBlockId: "fifth",
            createdAt: new Date("2026-11-05T09:00:00.000Z"),
          }),
        ]),
      );

    expect(summary.offenceCount).toBe(2);
    expect(summary.suggestedDuration).toBe(SecurityBlockDuration.SevenDays);
    expect(summary.last).toEqual({
      createdAt: new Date("2026-11-12T09:00:00.000Z"),
      action: SecurityBlockAction.Block,
      value: "35.205.11.131",
      securityCaseId: "case-812",
      caseNumber: "CASE-812",
    });

    const json: JSONObject = JSON.parse(
      JSON.stringify(writeSecurityRepeatOffenderSummary(summary)),
    ) as JSONObject;

    expect(readSecurityRepeatOffenderSummary(json)).toEqual(summary);
  });

  test("a challenge of a range around the address reads as that challenge", () => {
    const read: SecurityRepeatOffenderSummary | null =
      readSecurityRepeatOffenderSummary({
        value: "35.205.11.131",
        offenceCount: 1,
        last: {
          createdAt: "2026-11-12T09:00:00.000Z",
          action: SecurityBlockAction.Challenge,
          value: "35.205.11.0/24",
          securityCaseId: null,
          caseNumber: null,
        },
      });

    expect(read?.last?.action).toBe(SecurityBlockAction.Challenge);
    expect(read?.last?.value).toBe("35.205.11.0/24");
    expect(read?.last?.caseNumber).toBeNull();
    expect(read?.suggestedDuration).toBe(SecurityBlockDuration.OneDay);
  });

  test("names nothing from nothing", () => {
    expect(readSecurityRepeatOffenderSummary(undefined)).toBeNull();
    expect(readSecurityRepeatOffenderSummary({ offenceCount: 2 })).toBeNull();
    expect(
      readSecurityRepeatOffenderSummary({
        value: "35.205.11.131",
        offenceCount: 1,
        last: { createdAt: "not a date" },
      })?.last,
    ).toBeNull();
  });
});
