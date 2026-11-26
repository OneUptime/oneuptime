import {
  SECURITY_REPEAT_OFFENDER_LADDER,
  SECURITY_REPEAT_OFFENDER_WINDOW_DAYS,
  SecurityRepeatOffenderSummary,
  getSecurityRepeatOffenderDuration,
  getSecurityRepeatOffenderHoldingNetwork,
  getSecurityRepeatOffenderRung,
  isSecurityRepeatOffence,
  readSecurityRepeatOffenderSummary,
  writeSecurityRepeatOffenderSummary,
} from "../../../Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { describe, expect, test } from "@jest/globals";

/*
 * The repeat-offender ladder (#10350): 1 hour the first time, then 24
 * hours, then 7 days, within 30 days - climbed from a policy's own first
 * length, never past 7 days, and never on a block somebody lifted.
 */

describe("the ladder", () => {
  test("is 1 hour, 24 hours, 7 days, over 30 days", () => {
    expect(SECURITY_REPEAT_OFFENDER_LADDER).toEqual([
      SecurityBlockDuration.OneHour,
      SecurityBlockDuration.OneDay,
      SecurityBlockDuration.SevenDays,
    ]);
    expect(SECURITY_REPEAT_OFFENDER_WINDOW_DAYS).toBe(30);
  });

  test("a first offence is the policy's first length", () => {
    expect(
      getSecurityRepeatOffenderDuration({
        firstDuration: SecurityBlockDuration.OneHour,
        offenceCount: 0,
      }),
    ).toBe(SecurityBlockDuration.OneHour);
  });

  test("each offence before climbs a rung", () => {
    expect(
      getSecurityRepeatOffenderDuration({
        firstDuration: SecurityBlockDuration.OneHour,
        offenceCount: 1,
      }),
    ).toBe(SecurityBlockDuration.OneDay);
    expect(
      getSecurityRepeatOffenderDuration({
        firstDuration: SecurityBlockDuration.OneHour,
        offenceCount: 2,
      }),
    ).toBe(SecurityBlockDuration.SevenDays);
  });

  test("never past 7 days", () => {
    expect(
      getSecurityRepeatOffenderDuration({
        firstDuration: SecurityBlockDuration.OneHour,
        offenceCount: 12,
      }),
    ).toBe(SecurityBlockDuration.SevenDays);
  });

  test("a policy that starts at 24 hours starts its ladder there", () => {
    expect(
      getSecurityRepeatOffenderDuration({
        firstDuration: SecurityBlockDuration.OneDay,
        offenceCount: 0,
      }),
    ).toBe(SecurityBlockDuration.OneDay);
    expect(
      getSecurityRepeatOffenderDuration({
        firstDuration: SecurityBlockDuration.OneDay,
        offenceCount: 1,
      }),
    ).toBe(SecurityBlockDuration.SevenDays);
  });

  test("a first length off the ladder starts at its foot", () => {
    expect(
      getSecurityRepeatOffenderDuration({
        firstDuration: SecurityBlockDuration.ThirtyDays,
        offenceCount: 0,
      }),
    ).toBe(SecurityBlockDuration.OneHour);
  });

  test("a broken count counts as none", () => {
    expect(
      getSecurityRepeatOffenderDuration({
        firstDuration: SecurityBlockDuration.OneHour,
        offenceCount: Number.NaN,
      }),
    ).toBe(SecurityBlockDuration.OneHour);
    expect(
      getSecurityRepeatOffenderDuration({
        firstDuration: SecurityBlockDuration.OneHour,
        offenceCount: -3,
      }),
    ).toBe(SecurityBlockDuration.OneHour);
  });

  test("names each rung from 1", () => {
    expect(getSecurityRepeatOffenderRung(SecurityBlockDuration.OneHour)).toBe(
      1,
    );
    expect(getSecurityRepeatOffenderRung(SecurityBlockDuration.OneDay)).toBe(2);
    expect(getSecurityRepeatOffenderRung(SecurityBlockDuration.SevenDays)).toBe(
      3,
    );
    expect(
      getSecurityRepeatOffenderRung(SecurityBlockDuration.UntilLifted),
    ).toBe(0);
  });
});

describe("what counts as an offence", () => {
  test("a block in force, or one that expired", () => {
    expect(isSecurityRepeatOffence({ state: SecurityBlockState.Active })).toBe(
      true,
    );
    expect(isSecurityRepeatOffence({ state: SecurityBlockState.Expired })).toBe(
      true,
    );
  });

  test("never a block somebody lifted", () => {
    expect(isSecurityRepeatOffence({ state: SecurityBlockState.Lifted })).toBe(
      false,
    );
  });
});

/*
 * Which network held it (#10895): when the last block that counted was of
 * a wider network - the whole network by its ASN, which Challenge This
 * Network holds, or a range around the value - the line names it.
 */
describe("the network that held it", () => {
  function last(value: string): {
    createdAt: Date;
    action: SecurityBlockAction;
    value: string;
    securityCaseId: string | null;
    caseNumber: string | null;
  } {
    return {
      createdAt: new Date("2026-11-12T10:00:00.000Z"),
      action: SecurityBlockAction.Challenge,
      value,
      securityCaseId: null,
      caseNumber: null,
    };
  }

  test("an address held by its network's ASN: the ASN", () => {
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.7",
        last: last("AS14061"),
      }),
    ).toBe("AS14061");
  });

  test("an address held by a range around it: the range, as blocks write it", () => {
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.7",
        last: last("203.0.113.0/24"),
      }),
    ).toBe("203.0.113.0/24");
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "2001:db8::7",
        last: last("2001:0db8:0000::/48"),
      }),
    ).toBe("2001:db8::/48");
  });

  test("an address blocked itself: none, however either is written", () => {
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.7",
        last: last("203.0.113.7"),
      }),
    ).toBeNull();
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "2001:db8::7",
        last: last("2001:db8:0:0:0:0:0:7"),
      }),
    ).toBeNull();
  });

  test("a network asked about, blocked itself: none - Challenge This Network's own record of an ASN or a range", () => {
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "AS14061",
        last: last("as14061"),
      }),
    ).toBeNull();
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.0/24",
        last: last("203.0.113.0/24"),
      }),
    ).toBeNull();
  });

  test("a network asked about, held by an address or a range inside it: none - nothing wider held it", () => {
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.0/24",
        last: last("203.0.113.7"),
      }),
    ).toBeNull();
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.0/24",
        last: last("203.0.113.128/25"),
      }),
    ).toBeNull();
  });

  test("a network asked about, held by a wider range: the wider range", () => {
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.0/24",
        last: last("203.0.0.0/16"),
      }),
    ).toBe("203.0.0.0/16");
  });

  test("a range that does not hold the value, nothing at all, or what is no block: none", () => {
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.7",
        last: last("198.51.100.0/24"),
      }),
    ).toBeNull();
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.7",
        last: null,
      }),
    ).toBeNull();
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.7",
        last: last(""),
      }),
    ).toBeNull();
    expect(
      getSecurityRepeatOffenderHoldingNetwork({
        value: "203.0.113.7",
        last: last("evil.example"),
      }),
    ).toBeNull();
  });

  test("the network goes on the wire as the block's own value, and is read back", () => {
    const summary: SecurityRepeatOffenderSummary | null =
      readSecurityRepeatOffenderSummary(
        JSON.parse(
          JSON.stringify(
            writeSecurityRepeatOffenderSummary({
              value: "203.0.113.7",
              offenceCount: 1,
              last: {
                createdAt: new Date("2026-11-12T10:00:00.000Z"),
                action: SecurityBlockAction.Challenge,
                value: "AS14061",
                securityCaseId: "case-812",
                caseNumber: "CASE-812",
              },
              suggestedDuration: SecurityBlockDuration.OneDay,
            }),
          ),
        ),
      );

    expect(summary?.last?.value).toBe("AS14061");
    expect(summary?.last?.action).toBe(SecurityBlockAction.Challenge);
    expect(getSecurityRepeatOffenderHoldingNetwork(summary!)).toBe("AS14061");
  });
});
