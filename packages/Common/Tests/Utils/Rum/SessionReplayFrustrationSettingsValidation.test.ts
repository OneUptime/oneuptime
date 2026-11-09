import { describe, expect, it } from "@jest/globals";
import {
  SessionReplayFrustrationSettingsCheck,
  checkSessionReplayFrustrationSettings,
  getSessionReplayCustomSignalMatchProblem,
  getSessionReplayCustomSignalNameProblem,
  isPlausibleCssSelector,
} from "../../../Utils/Rum/SessionReplayFrustrationSettingsValidation";
import { getDefaultSessionReplayFrustrationSettings } from "../../../Types/Rum/SessionReplayFrustrationSignals";

/*
 * The write-side check of RumApplication.sessionReplayFrustrationSignals:
 * every write is refused with words that name the rule or the signal, or
 * stored canonical. The settings page runs the same check before it sends.
 */

let nextId: number = 0;

function generateId(): string {
  nextId++;
  return `generated-${nextId}`;
}

function check(value: unknown): SessionReplayFrustrationSettingsCheck {
  return checkSessionReplayFrustrationSettings(value, generateId);
}

function problemOf(value: unknown): string {
  const result: SessionReplayFrustrationSettingsCheck = check(value);
  expect(result.settings).toBeNull();
  return result.problem || "";
}

describe("checkSessionReplayFrustrationSettings", () => {
  it("clears the column for null or nothing, which means the defaults", () => {
    expect(check(null)).toEqual({ settings: null, problem: null });
    expect(check(undefined)).toEqual({ settings: null, problem: null });
  });

  it("refuses something that is not the settings object", () => {
    for (const value of [1, "x", [], true]) {
      expect(problemOf(value)).toBe("Frustration signals must be an object.");
    }
  });

  it("fills every rule and number a write leaves out with its default", () => {
    expect(check({})).toEqual({
      settings: getDefaultSessionReplayFrustrationSettings(),
      problem: null,
    });

    const result: SessionReplayFrustrationSettingsCheck = check({
      rageClick: { clickCount: 5 },
    });

    expect(result.settings?.rageClick).toEqual({
      isEnabled: true,
      clickCount: 5,
      windowMs: 1000,
      radiusPx: 30,
      ignoreSelectors: [],
    });
  });

  it("names the rule and the range of a number outside it, instead of clamping it", () => {
    expect(problemOf({ rageClick: { clickCount: 2 } })).toBe(
      "Rage clicks: the number of clicks must be a whole number from 3 to 10.",
    );
    expect(problemOf({ rageClick: { windowMs: 5001 } })).toBe(
      "Rage clicks: the time between clicks in milliseconds must be a whole number from 300 to 5000.",
    );
    expect(problemOf({ rageClick: { radiusPx: 4 } })).toBe(
      "Rage clicks: the distance in pixels must be a whole number from 5 to 200.",
    );
    expect(problemOf({ deadClick: { timeoutMs: 400 } })).toBe(
      "Dead clicks: the wait in milliseconds must be a whole number from 500 to 10000.",
    );
    expect(problemOf({ errorClick: { windowMs: 1.5 } })).toBe(
      "Error clicks: the time after a click in milliseconds must be a whole number from 100 to 5000.",
    );
    expect(problemOf({ refreshRage: { reloadCount: "4" } })).toBe(
      "Refresh rage: the number of loads must be a whole number from 2 to 10.",
    );
    expect(problemOf({ refreshRage: { windowSeconds: 601 } })).toBe(
      "Refresh rage: the time in seconds must be a whole number from 10 to 600.",
    );
  });

  it("takes the ends of every range", () => {
    const result: SessionReplayFrustrationSettingsCheck = check({
      rageClick: { clickCount: 10, windowMs: 300, radiusPx: 200 },
      deadClick: { timeoutMs: 10000 },
      errorClick: { windowMs: 100 },
      refreshRage: { reloadCount: 2, windowSeconds: 600 },
    });

    expect(result.problem).toBeNull();
    expect(result.settings?.refreshRage).toEqual({
      isEnabled: true,
      reloadCount: 2,
      windowSeconds: 600,
    });
  });

  it("wants a switch to be true or false", () => {
    expect(problemOf({ deadClick: { isEnabled: "off" } })).toBe(
      "Dead clicks: On must be true or false.",
    );

    expect(
      check({ deadClick: { isEnabled: false } }).settings?.deadClick.isEnabled,
    ).toBe(false);
  });

  it("refuses a rule that is not an object", () => {
    expect(problemOf({ rageClick: 3 })).toBe("Rage clicks must be an object.");
  });

  it("checks the elements a click rule ignores", () => {
    expect(
      check({ rageClick: { ignoreSelectors: [" .stepper ", ".stepper", ""] } })
        .settings?.rageClick.ignoreSelectors,
    ).toEqual([".stepper"]);

    expect(problemOf({ deadClick: { ignoreSelectors: ".x" } })).toBe(
      "Dead clicks: elements to ignore must be a list of CSS selectors.",
    );
    expect(problemOf({ deadClick: { ignoreSelectors: ["a {"] } })).toBe(
      'Dead clicks: elements to ignore: "a {" is not a CSS selector.',
    );
    expect(
      problemOf({ rageClick: { ignoreSelectors: [`.${"x".repeat(200)}`] } }),
    ).toBe(
      "Rage clicks: elements to ignore: a selector can be at most 200 characters.",
    );

    const tooMany: Array<string> = [];

    for (let index: number = 0; index < 21; index++) {
      tooMany.push(`.x${index}`);
    }

    expect(problemOf({ rageClick: { ignoreSelectors: tooMany } })).toBe(
      "Rage clicks: elements to ignore: list at most 20 selectors.",
    );
  });
});

describe("custom signals on the way in", () => {
  it("stores them trimmed, with ids, keeping the ones they came with", () => {
    nextId = 0;

    const result: SessionReplayFrustrationSettingsCheck = check({
      customSignals: [
        {
          id: "keep-me",
          name: " Payment failed ",
          trigger: "event",
          match: " payment_failed ",
          isFrustration: true,
          isEnabled: true,
        },
        { name: "Help opened", trigger: "click", match: "#help" },
        // A duplicate id is replaced, so two rows never share one.
        {
          id: "keep-me",
          name: "Sold out",
          trigger: "page",
          match: "/sold-out*",
        },
      ],
    });

    expect(result.problem).toBeNull();
    expect(result.settings?.customSignals).toEqual([
      {
        id: "keep-me",
        name: "Payment failed",
        trigger: "event",
        match: "payment_failed",
        isFrustration: true,
        isEnabled: true,
      },
      {
        id: "generated-1",
        name: "Help opened",
        trigger: "click",
        match: "#help",
        isFrustration: true,
        isEnabled: true,
      },
      {
        id: "generated-2",
        name: "Sold out",
        trigger: "page",
        match: "/sold-out*",
        isFrustration: true,
        isEnabled: true,
      },
    ]);
  });

  it("refuses more than twenty", () => {
    const signals: Array<Record<string, unknown>> = [];

    for (let index: number = 0; index < 21; index++) {
      signals.push({ name: `Signal ${index}`, trigger: "event", match: "x" });
    }

    expect(problemOf({ customSignals: signals })).toBe(
      "An application can have at most 20 signals of its own.",
    );
  });

  it("refuses two signals of one name, whatever their case", () => {
    expect(
      problemOf({
        customSignals: [
          { name: "Sold out", trigger: "page", match: "/a" },
          { name: "SOLD OUT", trigger: "page", match: "/b" },
        ],
      }),
    ).toBe('Two custom signals are named "SOLD OUT". Give each its own name.');
  });

  it("refuses a name the built-in signals use", () => {
    expect(
      problemOf({
        customSignals: [{ name: "Rage clicks", trigger: "event", match: "x" }],
      }),
    ).toBe(
      'Custom signal 1: "Rage clicks" is a built-in signal. Give yours its own name.',
    );
  });

  it("names what is wrong with a signal, by its number or its name", () => {
    expect(
      problemOf({ customSignals: [{ trigger: "event", match: "x" }] }),
    ).toBe("Custom signal 1: Give the signal a name.");
    expect(
      problemOf({
        customSignals: [{ name: "x".repeat(41), trigger: "event", match: "x" }],
      }),
    ).toBe("Custom signal 1: A name can be at most 40 characters.");
    expect(
      problemOf({
        customSignals: [{ name: "Hover", trigger: "hover", match: "x" }],
      }),
    ).toBe(
      'Custom signal "Hover": choose what it reacts to (click, page, event or error).',
    );
    expect(
      problemOf({ customSignals: [{ name: "Empty", trigger: "event" }] }),
    ).toBe('Custom signal "Empty": enter what it matches.');
    expect(
      problemOf({
        customSignals: [{ name: "Page", trigger: "page", match: "checkout" }],
      }),
    ).toBe(
      'Custom signal "Page": A page pattern starts with / (or with * to match the end of any path), such as /checkout/error.',
    );
    expect(
      problemOf({
        customSignals: [{ name: "Click", trigger: "click", match: "button[" }],
      }),
    ).toBe('Custom signal "Click": "button[" is not a CSS selector.');
    expect(
      problemOf({
        customSignals: [
          { name: "Off", trigger: "event", match: "x", isEnabled: "no" },
        ],
      }),
    ).toBe('Custom signal "Off": On must be true or false.');
  });
});

describe("getSessionReplayCustomSignalMatchProblem", () => {
  it("wants a page path without a query or a fragment", () => {
    expect(getSessionReplayCustomSignalMatchProblem("page", "/a?b=1")).toBe(
      "Match the page's path only, without ? or #.",
    );
    expect(getSessionReplayCustomSignalMatchProblem("page", "/a#b")).toBe(
      "Match the page's path only, without ? or #.",
    );
    expect(
      getSessionReplayCustomSignalMatchProblem("page", "*/failed"),
    ).toBeNull();
    expect(getSessionReplayCustomSignalMatchProblem("page", "")).toBe(
      "Enter the page's path, such as /checkout/error.",
    );
  });

  it("caps an event name at track()'s 64 characters and an error text at 200", () => {
    expect(
      getSessionReplayCustomSignalMatchProblem("event", "e".repeat(64)),
    ).toBeNull();
    expect(
      getSessionReplayCustomSignalMatchProblem("event", "e".repeat(65)),
    ).toBe(
      "Enter the event name your code passes to track(), at most 64 characters.",
    );
    expect(
      getSessionReplayCustomSignalMatchProblem("error", "e".repeat(200)),
    ).toBeNull();
    expect(
      getSessionReplayCustomSignalMatchProblem("error", "e".repeat(201)),
    ).toBe("Enter the text the error contains, at most 200 characters.");
  });

  it("refuses line breaks and control characters", () => {
    expect(getSessionReplayCustomSignalMatchProblem("event", "a\nb")).toBe(
      "An event name cannot contain line breaks or control characters.",
    );
    expect(getSessionReplayCustomSignalMatchProblem("error", "a\tb")).toBe(
      "The error text cannot contain line breaks or control characters.",
    );
    expect(getSessionReplayCustomSignalNameProblem("a\u0000b")).toBe(
      "A name cannot contain line breaks or control characters.",
    );
  });
});

describe("isPlausibleCssSelector", () => {
  it("accepts the selectors people write", () => {
    for (const selector of [
      "#pay-button",
      ".checkout .submit",
      "button.primary > span",
      "a ~ b",
      "li + li",
      "button[data-action='pay']",
      'input[name="q"]',
      "[class~=x]",
      "li:nth-child(2n+1)",
      "a, button",
      ":is(.a, .b) > .c",
      ".icon\\:large",
      "[data-x='a,b']",
    ]) {
      expect({ selector, ok: isPlausibleCssSelector(selector) }).toEqual({
        selector,
        ok: true,
      });
    }
  });

  it("refuses what no selector parser would take", () => {
    for (const selector of [
      "",
      "   ",
      "a {",
      "a { color: red }",
      "div;",
      "button[",
      "button]",
      "a)",
      "(a",
      "a,,b",
      ", a",
      "a,",
      "> a",
      "a >",
      "a > > b",
      "a + ~ b",
      "'unclosed",
      "a\nb",
    ]) {
      expect({ selector, ok: isPlausibleCssSelector(selector) }).toEqual({
        selector,
        ok: false,
      });
    }
  });

  it("reads a long selector once, end to end", () => {
    const selector: string = `${"[a='".repeat(500)}x`;
    const startedAt: number = Date.now();

    for (let run: number = 0; run < 500; run++) {
      expect(isPlausibleCssSelector(selector)).toBe(false);
    }

    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});
