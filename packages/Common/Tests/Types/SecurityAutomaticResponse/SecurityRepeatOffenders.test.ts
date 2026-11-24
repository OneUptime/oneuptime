import {
  SECURITY_REPEAT_OFFENDER_LADDER,
  SECURITY_REPEAT_OFFENDER_WINDOW_DAYS,
  getSecurityRepeatOffenderDuration,
  getSecurityRepeatOffenderRung,
  isSecurityRepeatOffence,
} from "../../../Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
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
