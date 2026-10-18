import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  RunbookOverviewCopy,
  RunbookOverviewFacts,
  getRunNowLockedReason,
  getRunbookOverviewFacts,
  hasRunbookSteps,
  isRunNowOffered,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookOverviewState";
import RunbookSwitchCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookSwitchCopy";

/*
 * What a runbook's Overview offers first (RunbookOverviewState), read
 * without drawing it - RunbookOverviewFirstSteps draws the page. A runbook
 * runs only while it is on and has a step (RunbookStarter refuses it
 * otherwise), so the Overview offers Add Steps to a runbook with none, and
 * says so - with Turn on runbook - for one that is off.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const READY: RunbookOverviewFacts = { isTurnedOff: false, hasSteps: true };

describe("whether a runbook has a step", () => {
  test.each([
    [[{ type: "Manual" }], true],
    [[{}, {}], true],
    [[], false],
    [null, false],
    [undefined, false],
    ["[]", false],
    [{ length: 2 }, false],
  ] as Array<[unknown, boolean]>)(
    "%p is %p, as the starter reads a runbook's steps",
    (steps: unknown, has: boolean) => {
      expect(hasRunbookSteps(steps)).toBe(has);
    },
  );
});

describe("the facts the Overview acts on", () => {
  test("none before the runbook is read", () => {
    expect(getRunbookOverviewFacts(null)).toBeNull();
  });

  test("a runbook is off only when its switch says so; never written is on, as its column starts", () => {
    expect(getRunbookOverviewFacts({ isEnabled: false, steps: [{}] })).toEqual({
      isTurnedOff: true,
      hasSteps: true,
    });
    expect(getRunbookOverviewFacts({ isEnabled: true, steps: [] })).toEqual({
      isTurnedOff: false,
      hasSteps: false,
    });
    expect(getRunbookOverviewFacts({ steps: [{}] })).toEqual(READY);
  });
});

describe("Run Now", () => {
  test("is offered before the runbook is read - the server decides - and while it has a step", () => {
    expect(isRunNowOffered(null)).toBe(true);
    expect(isRunNowOffered(READY)).toBe(true);
    expect(isRunNowOffered({ isTurnedOff: true, hasSteps: true })).toBe(true);
  });

  test("is not offered to a runbook with no step: Add Steps is the way on", () => {
    expect(isRunNowOffered({ isTurnedOff: false, hasSteps: false })).toBe(
      false,
    );
    expect(isRunNowOffered({ isTurnedOff: true, hasSteps: false })).toBe(false);
  });

  test("is locked for a runbook that is off, saying how to run it", () => {
    expect(
      getRunNowLockedReason({
        facts: { isTurnedOff: true, hasSteps: true },
      }),
    ).toBe(RunbookOverviewCopy.runNowTurnedOff);
    expect(RunbookOverviewCopy.runNowTurnedOff).toBe(
      "Turn this runbook on to run it.",
    );
  });

  test("tells someone who may not run runbooks so first", () => {
    expect(
      getRunNowLockedReason({
        permissionReason: "You do not have permission.",
        facts: { isTurnedOff: true, hasSteps: true },
      }),
    ).toBe("You do not have permission.");
  });

  test("is not locked for a runbook that can run, or before it is read", () => {
    expect(getRunNowLockedReason({ facts: READY })).toBeUndefined();
    expect(getRunNowLockedReason({ facts: null })).toBeUndefined();
    expect(
      getRunNowLockedReason({ permissionReason: "", facts: READY }),
    ).toBeUndefined();
  });
});

describe("the Overview's words", () => {
  test("are short and plain", () => {
    expect(RunbookOverviewCopy).toEqual({
      noStepsTitle: "No steps yet",
      noStepsDescription:
        "A runbook runs its steps in order. Add its first step to run it.",
      addStepsButton: "Add Steps",
      turnedOffTitle: "This runbook is turned off",
      turnOnButton: "Turn on runbook",
      runNowTurnedOff: "Turn this runbook on to run it.",
    });
  });

  test.each(LANGUAGES)("are translated in %s", (language: string) => {
    const locale: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;

    for (const english of [
      ...Object.values(RunbookOverviewCopy),
      // The banner's line is the Settings switch's own.
      RunbookSwitchCopy.switchOffDescription,
      "Never run yet.",
    ]) {
      expect({
        english,
        translated:
          typeof locale[english] === "string" &&
          locale[english]!.trim().length > 0 &&
          locale[english] !== english,
      }).toEqual({ english, translated: true });
    }
  });
});
