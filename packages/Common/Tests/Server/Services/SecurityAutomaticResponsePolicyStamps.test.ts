import {
  getSecurityAutomaticResponseModeStamps,
  getSecurityAutomaticResponsePolicyProblem,
} from "../../../Server/Services/SecurityAutomaticResponsePolicyService";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_AUTOMATIC_RESPONSE_MESSAGES,
  SecurityAutomaticResponseMode,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { describe, expect, test } from "@jest/globals";

/*
 * What OneUptime stamps as an automatic response policy's mode changes
 * (#10350): the trial's week when it starts, who turned it on (its blocks
 * run without approval in their name), whether that skipped the trial, and
 * a finished trial written down as the policy leaves it.
 */

const NOW: Date = new Date("2026-11-22T10:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const USER: ObjectID = new ObjectID("7ba9b2a4-9a5b-4d8e-8a3c-6f0d2c1b5e4a");

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_IN_MS);
}

describe("getSecurityAutomaticResponseModeStamps", () => {
  test("nothing is stamped when the mode does not change", () => {
    expect(
      getSecurityAutomaticResponseModeStamps({
        policy: { mode: SecurityAutomaticResponseMode.On },
        to: SecurityAutomaticResponseMode.On,
        now: NOW,
        userId: USER,
      }),
    ).toEqual({});
  });

  test("starting the trial run stamps its week, and who started it", () => {
    expect(
      getSecurityAutomaticResponseModeStamps({
        policy: { mode: SecurityAutomaticResponseMode.Off },
        to: SecurityAutomaticResponseMode.TrialRun,
        now: NOW,
        userId: USER,
      }),
    ).toEqual({
      modeChangedAt: NOW,
      modeChangedByUserId: USER,
      trialStartedAt: NOW,
      trialEndsAt: daysFromNow(7),
      trialSkippedAt: null,
      trialSkippedByUserId: null,
    });
  });

  test("turning on after a whole week writes the trial down as finished, and skips nothing", () => {
    const stamps: Record<string, unknown> =
      getSecurityAutomaticResponseModeStamps({
        policy: {
          mode: SecurityAutomaticResponseMode.TrialRun,
          trialStartedAt: daysFromNow(-8),
          trialEndsAt: daysFromNow(-1),
        },
        to: SecurityAutomaticResponseMode.On,
        now: NOW,
        userId: USER,
      });

    expect(stamps).toEqual({
      modeChangedAt: NOW,
      modeChangedByUserId: USER,
      trialFinishedAt: daysFromNow(-1),
      turnedOnAt: NOW,
      turnedOnByUserId: USER,
    });
  });

  test("turning on before the week is up skips the trial, saying who did", () => {
    const stamps: Record<string, unknown> =
      getSecurityAutomaticResponseModeStamps({
        policy: {
          mode: SecurityAutomaticResponseMode.TrialRun,
          trialStartedAt: daysFromNow(-2),
          trialEndsAt: daysFromNow(5),
        },
        to: SecurityAutomaticResponseMode.On,
        now: NOW,
        userId: USER,
      });

    expect(stamps["turnedOnAt"]).toEqual(NOW);
    expect(stamps["turnedOnByUserId"]).toEqual(USER);
    expect(stamps["trialSkippedAt"]).toEqual(NOW);
    expect(stamps["trialSkippedByUserId"]).toEqual(USER);
    expect(stamps["trialFinishedAt"]).toBeUndefined();
  });

  test("turning on straight from off, with no trial at all, skips it", () => {
    const stamps: Record<string, unknown> =
      getSecurityAutomaticResponseModeStamps({
        policy: { mode: SecurityAutomaticResponseMode.Off },
        to: SecurityAutomaticResponseMode.On,
        now: NOW,
        userId: USER,
      });

    expect(stamps["trialSkippedAt"]).toEqual(NOW);
    expect(stamps["turnedOnByUserId"]).toEqual(USER);
  });

  test("turning on again after a trial finished long ago skips nothing", () => {
    const stamps: Record<string, unknown> =
      getSecurityAutomaticResponseModeStamps({
        policy: {
          mode: SecurityAutomaticResponseMode.Off,
          trialEndsAt: daysFromNow(-20),
          trialFinishedAt: daysFromNow(-20),
        },
        to: SecurityAutomaticResponseMode.On,
        now: NOW,
        userId: USER,
      });

    expect(stamps["trialSkippedAt"]).toBeUndefined();
    expect(stamps["trialFinishedAt"]).toBeUndefined();
    expect(stamps["turnedOnAt"]).toEqual(NOW);
  });

  test("turning off after a whole week keeps the trial finished", () => {
    expect(
      getSecurityAutomaticResponseModeStamps({
        policy: {
          mode: SecurityAutomaticResponseMode.TrialRun,
          trialEndsAt: daysFromNow(-1),
        },
        to: SecurityAutomaticResponseMode.Off,
        now: NOW,
        userId: USER,
      }),
    ).toEqual({
      modeChangedAt: NOW,
      modeChangedByUserId: USER,
      trialFinishedAt: daysFromNow(-1),
    });
  });

  test("turning off part way through a week finishes nothing", () => {
    expect(
      getSecurityAutomaticResponseModeStamps({
        policy: {
          mode: SecurityAutomaticResponseMode.TrialRun,
          trialEndsAt: daysFromNow(3),
        },
        to: SecurityAutomaticResponseMode.Off,
        now: NOW,
        userId: USER,
      }),
    ).toEqual({ modeChangedAt: NOW, modeChangedByUserId: USER });
  });

  test("a trial started again starts a new week and clears an earlier skip", () => {
    const stamps: Record<string, unknown> =
      getSecurityAutomaticResponseModeStamps({
        policy: {
          mode: SecurityAutomaticResponseMode.Off,
          trialStartedAt: daysFromNow(-30),
          trialEndsAt: daysFromNow(-23),
          trialSkippedAt: daysFromNow(-25),
        },
        to: SecurityAutomaticResponseMode.TrialRun,
        now: NOW,
        userId: null,
      });

    expect(stamps["trialStartedAt"]).toEqual(NOW);
    expect(stamps["trialEndsAt"]).toEqual(daysFromNow(7));
    expect(stamps["trialSkippedAt"]).toBeNull();
    expect(stamps["modeChangedByUserId"]).toBeNull();
  });
});

describe("getSecurityAutomaticResponsePolicyProblem", () => {
  const all: Array<string> = [
    "name",
    "blockAction",
    "duration",
    "matchConditions",
  ];

  test("a project's own policy needs a name", () => {
    expect(
      getSecurityAutomaticResponsePolicyProblem({
        name: "  ",
        matchConditions: { mitreTechniques: ["T1046"] },
        writes: all,
      }),
    ).toBe(SECURITY_AUTOMATIC_RESPONSE_MESSAGES.nameRequired);
  });

  test("a project's own policy must match on something", () => {
    expect(
      getSecurityAutomaticResponsePolicyProblem({
        name: "Port scans",
        matchConditions: { requiresEveryRequestTurnedAway: true },
        writes: all,
      }),
    ).toBe(SECURITY_AUTOMATIC_RESPONSE_MESSAGES.matchNamesNothing);
  });

  test("Block or Challenge, for 1 hour, 24 hours or 7 days", () => {
    expect(
      getSecurityAutomaticResponsePolicyProblem({
        name: "Port scans",
        blockAction: "Tarpit",
        matchConditions: { mitreTechniques: ["T1046"] },
        writes: all,
      }),
    ).toBe(SECURITY_AUTOMATIC_RESPONSE_MESSAGES.notAnAction);
    // A file's action is never an address's (#10346).
    expect(
      getSecurityAutomaticResponsePolicyProblem({
        name: "Port scans",
        blockAction: "BlockAndQuarantine",
        matchConditions: { mitreTechniques: ["T1046"] },
        writes: all,
      }),
    ).toBe(SECURITY_AUTOMATIC_RESPONSE_MESSAGES.notAnAction);
    expect(
      getSecurityAutomaticResponsePolicyProblem({
        name: "Port scans",
        duration: SecurityBlockDuration.UntilLifted,
        matchConditions: { mitreTechniques: ["T1046"] },
        writes: all,
      }),
    ).toBe(SECURITY_AUTOMATIC_RESPONSE_MESSAGES.notADuration);
  });

  test("a policy that can run has no problem", () => {
    expect(
      getSecurityAutomaticResponsePolicyProblem({
        name: "Port scans",
        blockAction: SecurityBlockAction.Challenge,
        duration: SecurityBlockDuration.OneDay,
        matchConditions: { mitreTechniques: ["T1046"] },
        writes: all,
      }),
    ).toBeNull();
  });

  test("an update is held to what it writes", () => {
    expect(
      getSecurityAutomaticResponsePolicyProblem({
        duration: SecurityBlockDuration.SevenDays,
        writes: ["duration"],
      }),
    ).toBeNull();
    expect(
      getSecurityAutomaticResponsePolicyProblem({
        matchConditions: {},
        writes: ["matchConditions"],
      }),
    ).toBe(SECURITY_AUTOMATIC_RESPONSE_MESSAGES.matchNamesNothing);
  });
});
