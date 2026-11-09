import { describe, expect, test } from "@jest/globals";
import {
  getDefaultSessionReplayFrustrationSettings,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
  SessionReplayCustomSignal,
  SessionReplayCustomSignalTrigger,
  SessionReplayFrustrationSettings,
} from "../../../Types/Rum/SessionReplayFrustrationSignals";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  BUILT_IN_SIGNAL_KEYS,
  BuiltInSignalKey,
  canAddCustomSignal,
  CustomSignalDraft,
  describeBuiltInSignal,
  describeCustomSignalTrigger,
  describeIgnoredSelectors,
  getCustomSignalDraftProblems,
  getDefaultRuleFieldTexts,
  getIgnoredSelectorsProblem,
  isBuiltInSignalEnabled,
  makeCustomSignalId,
  readFieldText,
  readSelectorLines,
  RULE_NUMBER_FIELDS,
  RuleNumberField,
  toFieldText,
  toSeconds,
  withBuiltInSignalEnabled,
  withCustomSignal,
  withoutCustomSignal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/FrustrationSignals/FrustrationSignalsCopy";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";

/*
 * What the Frustration Signals page says and decides, without React
 * (issue #6443): each built-in signal's sentence follows its own numbers,
 * the rule editor reads seconds and refuses what the server would, and a
 * signal of the application's own is checked kind by kind before it is
 * sent.
 */

const english: Translator = createTranslator(undefined, "en");

const acceptsEverything: (selector: string) => boolean = (): boolean => {
  return true;
};

function field(key: BuiltInSignalKey, id: string): RuleNumberField {
  const found: RuleNumberField | undefined = RULE_NUMBER_FIELDS[key].find(
    (candidate: RuleNumberField): boolean => {
      return candidate.id === id;
    },
  );

  if (!found) {
    throw new Error(`No field ${key}.${id}`);
  }

  return found;
}

function draft(overrides: Partial<CustomSignalDraft>): CustomSignalDraft {
  return {
    name: "Payment failed",
    trigger: "page",
    match: "/checkout/error",
    isFrustration: true,
    ...overrides,
  };
}

function problemsOf(
  overrides: Partial<CustomSignalDraft>,
  otherNames: Array<string> = [],
  acceptsSelector: (selector: string) => boolean = acceptsEverything,
): { name: string | null; match: string | null } {
  return getCustomSignalDraftProblems(
    draft(overrides),
    otherNames,
    english,
    acceptsSelector,
  );
}

describe("a built-in signal's sentence", () => {
  test("says what each signal flags with today's numbers", () => {
    const defaults: SessionReplayFrustrationSettings =
      getDefaultSessionReplayFrustrationSettings();

    expect(describeBuiltInSignal("rageClick", defaults, english)).toBe(
      "3 or more clicks within 30 px of each other, each within 1 second of the one before.",
    );
    expect(describeBuiltInSignal("deadClick", defaults, english)).toBe(
      "A click on something that looks clickable, after which nothing on the page changes for 3 seconds.",
    );
    expect(describeBuiltInSignal("errorClick", defaults, english)).toBe(
      "An error within 1 second of a click.",
    );
    expect(describeBuiltInSignal("refreshRage", defaults, english)).toBe(
      "The same page loaded 3 times within 60 seconds.",
    );
  });

  test("follows changed numbers, in seconds with up to two decimals", () => {
    const settings: SessionReplayFrustrationSettings =
      getDefaultSessionReplayFrustrationSettings();
    settings.rageClick.clickCount = 5;
    settings.rageClick.windowMs = 1500;
    settings.rageClick.radiusPx = 80;
    settings.deadClick.timeoutMs = 1000;
    settings.errorClick.windowMs = 250;
    settings.refreshRage.reloadCount = 4;
    settings.refreshRage.windowSeconds = 1;

    expect(describeBuiltInSignal("rageClick", settings, english)).toBe(
      "5 or more clicks within 80 px of each other, each within 1.5 seconds of the one before.",
    );
    expect(describeBuiltInSignal("deadClick", settings, english)).toBe(
      "A click on something that looks clickable, after which nothing on the page changes for 1 second.",
    );
    expect(describeBuiltInSignal("errorClick", settings, english)).toBe(
      "An error within 0.25 seconds of a click.",
    );
    expect(describeBuiltInSignal("refreshRage", settings, english)).toBe(
      "The same page loaded 4 times within 1 second.",
    );
  });

  test("is the same sentence with the signal switched off", () => {
    const off: SessionReplayFrustrationSettings = withBuiltInSignalEnabled(
      getDefaultSessionReplayFrustrationSettings(),
      "rageClick",
      false,
    );

    expect(isBuiltInSignalEnabled("rageClick", off)).toBe(false);
    expect(describeBuiltInSignal("rageClick", off, english)).toBe(
      describeBuiltInSignal(
        "rageClick",
        getDefaultSessionReplayFrustrationSettings(),
        english,
      ),
    );
  });

  test("counts the elements it ignores, and says nothing with none", () => {
    expect(describeIgnoredSelectors([], english)).toBe("");
    expect(describeIgnoredSelectors([".stepper"], english)).toBe(
      "Clicks on 1 element you listed never count.",
    );
    expect(describeIgnoredSelectors([".a", ".b", ".c"], english)).toBe(
      "Clicks on 3 elements you listed never count.",
    );
  });
});

describe("switching a built-in signal", () => {
  test("changes that one signal and leaves every other setting as it was", () => {
    const settings: SessionReplayFrustrationSettings =
      getDefaultSessionReplayFrustrationSettings();
    settings.deadClick.timeoutMs = 5000;
    settings.customSignals = [
      {
        id: "signal-1",
        name: "Payment failed",
        trigger: "page",
        match: "/checkout/error",
        isFrustration: true,
        isEnabled: true,
      },
    ];

    for (const key of BUILT_IN_SIGNAL_KEYS) {
      const next: SessionReplayFrustrationSettings = withBuiltInSignalEnabled(
        settings,
        key,
        false,
      );

      expect(next[key].isEnabled).toBe(false);
      expect({ ...next, [key]: settings[key] }).toEqual(settings);
    }

    // The settings it was given are not changed.
    expect(settings.rageClick.isEnabled).toBe(true);
  });
});

describe("the rule editor's numbers", () => {
  test("shows milliseconds as seconds and counts as they are", () => {
    expect(toSeconds(1000)).toBe(1);
    expect(toSeconds(1500)).toBe(1.5);
    expect(toSeconds(250)).toBe(0.25);
    expect(toSeconds(1234)).toBe(1.23);
    expect(toFieldText(field("rageClick", "windowMs"), 1500)).toBe("1.5");
    expect(toFieldText(field("rageClick", "clickCount"), 3)).toBe("3");
    expect(toFieldText(field("refreshRage", "windowSeconds"), 60)).toBe("60");
  });

  test("reads seconds back as milliseconds, with a point or a comma", () => {
    expect(
      readFieldText(field("rageClick", "windowMs"), "1.5", english),
    ).toEqual({ value: 1500, problem: null });
    expect(
      readFieldText(field("rageClick", "windowMs"), " 2,5 ", english),
    ).toEqual({ value: 2500, problem: null });
    expect(
      readFieldText(field("deadClick", "timeoutMs"), "0.5", english),
    ).toEqual({ value: 500, problem: null });
    expect(
      readFieldText(field("errorClick", "windowMs"), "0.25", english),
    ).toEqual({ value: 250, problem: null });
  });

  test("refuses seconds outside the rule's range, saying the range in seconds", () => {
    expect(
      readFieldText(field("deadClick", "timeoutMs"), "0.4", english),
    ).toEqual({
      value: null,
      problem: "Enter a number from 0.5 to 10.",
    });
    expect(readFieldText(field("rageClick", "windowMs"), "6", english)).toEqual(
      {
        value: null,
        problem: "Enter a number from 0.3 to 5.",
      },
    );
    expect(readFieldText(field("errorClick", "windowMs"), "", english)).toEqual(
      {
        value: null,
        problem: "Enter a number from 0.1 to 5.",
      },
    );
  });

  test("takes whole numbers in range for counts, pixels and seconds kept as seconds", () => {
    expect(
      readFieldText(field("rageClick", "clickCount"), "10", english),
    ).toEqual({ value: 10, problem: null });
    expect(
      readFieldText(field("rageClick", "clickCount"), "2", english),
    ).toEqual({
      value: null,
      problem: "Enter a whole number from 3 to 10.",
    });
    expect(
      readFieldText(field("rageClick", "clickCount"), "3.5", english),
    ).toEqual({ value: null, problem: "Enter a whole number from 3 to 10." });
    expect(
      readFieldText(field("rageClick", "radiusPx"), "abc", english),
    ).toEqual({
      value: null,
      problem: "Enter a whole number from 5 to 200.",
    });
    expect(
      readFieldText(field("refreshRage", "windowSeconds"), "601", english),
    ).toEqual({
      value: null,
      problem: "Enter a whole number from 10 to 600.",
    });
    expect(
      readFieldText(field("refreshRage", "reloadCount"), "2", english),
    ).toEqual({ value: 2, problem: null });
  });

  test("writes each number to its own rule only", () => {
    const defaults: SessionReplayFrustrationSettings =
      getDefaultSessionReplayFrustrationSettings();

    for (const key of BUILT_IN_SIGNAL_KEYS) {
      for (const ruleField of RULE_NUMBER_FIELDS[key]) {
        const next: SessionReplayFrustrationSettings = ruleField.write(
          defaults,
          ruleField.limit.max,
        );

        expect([key, ruleField.id, ruleField.read(next)]).toEqual([
          key,
          ruleField.id,
          ruleField.limit.max,
        ]);
        expect({ ...next, [key]: defaults[key] }).toEqual(defaults);
      }
    }
  });

  test("the defaults' texts are today's numbers", () => {
    const defaults: SessionReplayFrustrationSettings =
      getDefaultSessionReplayFrustrationSettings();

    expect(getDefaultRuleFieldTexts("rageClick", defaults)).toEqual({
      clickCount: "3",
      windowMs: "1",
      radiusPx: "30",
    });
    expect(getDefaultRuleFieldTexts("deadClick", defaults)).toEqual({
      timeoutMs: "3",
    });
    expect(getDefaultRuleFieldTexts("errorClick", defaults)).toEqual({
      windowMs: "1",
    });
    expect(getDefaultRuleFieldTexts("refreshRage", defaults)).toEqual({
      reloadCount: "3",
      windowSeconds: "60",
    });
  });

  /*
   * A label is a translation key, and a key another screen already holds
   * is translated as that screen means it: "Within" is a forecast's horizon
   * in the locales ("Prognosezeitraum"), so the reload window would have
   * read as one in German. Every label must be a key the locales translate
   * as the number it names.
   */
  test("labels the reload window a Time window, never a forecast's Within, and every number in words the locales have", () => {
    const german: Record<string, unknown> = germanLocale as Record<
      string,
      unknown
    >;
    const labels: Array<string> = BUILT_IN_SIGNAL_KEYS.flatMap(
      (key: BuiltInSignalKey): Array<string> => {
        return RULE_NUMBER_FIELDS[key].flatMap(
          (ruleField: RuleNumberField): Array<string> => {
            return [ruleField.label, ruleField.unitLabel];
          },
        );
      },
    );

    expect(field("refreshRage", "windowSeconds").label).toBe("Time window");
    expect(german["Time window"]).toBe("Zeitfenster");
    expect(labels).not.toContain("Within");

    for (const label of labels) {
      expect([label, typeof german[label]]).toEqual([label, "string"]);
    }
  });
});

describe("ignored elements", () => {
  test("are read one a line, trimmed, blank lines dropped, each once", () => {
    expect(readSelectorLines("  .a \n\n.b\r\n.a\n   \n#c")).toEqual([
      ".a",
      ".b",
      "#c",
    ]);
    expect(readSelectorLines("")).toEqual([]);
  });

  test("refuse more than twenty, a long one and one the browser cannot read", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < 21; index++) {
      many.push(`.item-${index}`);
    }

    expect(getIgnoredSelectorsProblem(many, english, acceptsEverything)).toBe(
      "List at most 20 selectors.",
    );
    expect(
      getIgnoredSelectorsProblem(
        [`.${"a".repeat(200)}`],
        english,
        acceptsEverything,
      ),
    ).toBe("A selector can be at most 200 characters.");
    expect(
      getIgnoredSelectorsProblem(
        [".fine", "div["],
        english,
        (selector: string): boolean => {
          return selector !== "div[";
        },
      ),
    ).toBe("Your browser cannot read div[ as a CSS selector.");
    expect(
      getIgnoredSelectorsProblem([".fine", "#ok"], english, acceptsEverything),
    ).toBeNull();
  });
});

describe("a signal of the application's own", () => {
  test("needs a name of its own: not empty, not a built-in one, not taken", () => {
    expect(problemsOf({ name: "   " }).name).toBe("Give the signal a name.");
    expect(problemsOf({ name: "rage CLICKS" }).name).toBe(
      "rage CLICKS is a built-in signal. Give yours its own name.",
    );
    expect(problemsOf({ name: "Refresh rage" }).name).toBe(
      "Refresh rage is a built-in signal. Give yours its own name.",
    );
    expect(problemsOf({ name: "Checkout" }, [" checkout "]).name).toBe(
      "Another signal is already called Checkout.",
    );
    expect(problemsOf({ name: "a".repeat(41) }).name).toBe(
      "A name can be at most 40 characters.",
    );
    expect(problemsOf({ name: "Line\nbreak" }).name).toBe(
      "A name cannot contain line breaks.",
    );
    expect(
      problemsOf({ name: "  Payment failed  " }, ["Other"]).name,
    ).toBeNull();
  });

  test("a click needs a selector the browser reads", () => {
    expect(problemsOf({ trigger: "click", match: "" }).match).toBe(
      "Enter the CSS selector of the element, such as #pay-button.",
    );
    expect(
      problemsOf({ trigger: "click", match: "#pay-button" }).match,
    ).toBeNull();
    expect(
      problemsOf({ trigger: "click", match: "button[" }, [], (): boolean => {
        return false;
      }).match,
    ).toBe("Your browser cannot read button[ as a CSS selector.");
  });

  test("a page needs a path that starts with / or *, without ? or #", () => {
    expect(problemsOf({ trigger: "page", match: "" }).match).toBe(
      "Enter the page's path, such as /checkout/error.",
    );
    expect(problemsOf({ trigger: "page", match: "checkout/error" }).match).toBe(
      "A page path starts with / (or with * to match the end of any path), such as /checkout/error.",
    );
    expect(
      problemsOf({ trigger: "page", match: "/checkout?step=2" }).match,
    ).toBe("Match the page's path only, without ? or #.");
    expect(problemsOf({ trigger: "page", match: "/app#/orders" }).match).toBe(
      "Match the page's path only, without ? or #.",
    );
    expect(
      problemsOf({ trigger: "page", match: "/orders/*/failed" }).match,
    ).toBeNull();
    expect(problemsOf({ trigger: "page", match: "*/failed" }).match).toBeNull();
  });

  test("an event needs the name the page's code passes to track(), at most 64 characters", () => {
    expect(problemsOf({ trigger: "event", match: "" }).match).toBe(
      "Enter the event name your code passes to track().",
    );
    expect(
      problemsOf({ trigger: "event", match: "payment_failed" }).match,
    ).toBeNull();
    expect(problemsOf({ trigger: "event", match: "e".repeat(65) }).match).toBe(
      "This can be at most 64 characters.",
    );
  });

  test("an error needs some of its text, at most 200 characters, on one line", () => {
    expect(problemsOf({ trigger: "error", match: "  " }).match).toBe(
      "Enter the text the error contains.",
    );
    expect(
      problemsOf({ trigger: "error", match: "card declined" }).match,
    ).toBeNull();
    expect(problemsOf({ trigger: "error", match: "x".repeat(201) }).match).toBe(
      "This can be at most 200 characters.",
    );
    expect(problemsOf({ trigger: "error", match: "two\nlines" }).match).toBe(
      "This cannot contain line breaks.",
    );
  });

  test("says what sets it off, kind by kind", () => {
    const rows: Array<[SessionReplayCustomSignalTrigger, string, string]> = [
      ["click", "#open-chat", "A click on #open-chat"],
      ["page", "/checkout/error", "The page /checkout/error"],
      ["event", "payment_failed", "The event payment_failed"],
      ["error", "card declined", "An error containing card declined"],
    ];

    for (const [trigger, match, sentence] of rows) {
      expect(
        describeCustomSignalTrigger(
          { trigger: trigger, match: match },
          english,
        ),
      ).toBe(sentence);
    }
  });
});

describe("the list of signals of the application's own", () => {
  function customSignal(id: string, name: string): SessionReplayCustomSignal {
    return {
      id: id,
      name: name,
      trigger: "event",
      match: name.toLowerCase().replace(/ /g, "_"),
      isFrustration: false,
      isEnabled: true,
    };
  }

  test("adds a new signal at the end, and replaces one by its id in place", () => {
    const start: SessionReplayFrustrationSettings = {
      ...getDefaultSessionReplayFrustrationSettings(),
      customSignals: [customSignal("a", "First"), customSignal("b", "Second")],
    };

    const added: SessionReplayFrustrationSettings = withCustomSignal(
      start,
      customSignal("c", "Third"),
    );

    expect(
      added.customSignals.map((signal: SessionReplayCustomSignal): string => {
        return signal.id;
      }),
    ).toEqual(["a", "b", "c"]);

    const renamed: SessionReplayFrustrationSettings = withCustomSignal(added, {
      ...customSignal("a", "First, renamed"),
    });

    expect(
      renamed.customSignals.map((signal: SessionReplayCustomSignal): string => {
        return signal.name;
      }),
    ).toEqual(["First, renamed", "Second", "Third"]);

    // Neither change touches the settings it was given.
    expect(start.customSignals).toHaveLength(2);
    expect(added.customSignals[0]!.name).toBe("First");
  });

  test("deletes by id only", () => {
    const start: SessionReplayFrustrationSettings = {
      ...getDefaultSessionReplayFrustrationSettings(),
      customSignals: [customSignal("a", "First"), customSignal("b", "First")],
    };

    expect(withoutCustomSignal(start, "a").customSignals).toEqual([
      customSignal("b", "First"),
    ]);
    expect(withoutCustomSignal(start, "missing").customSignals).toHaveLength(2);
  });

  test("has room for twenty, and no more", () => {
    const signals: Array<SessionReplayCustomSignal> = [];

    for (
      let index: number = 0;
      index < SESSION_REPLAY_MAX_CUSTOM_SIGNALS - 1;
      index++
    ) {
      signals.push(customSignal(`s${index}`, `Signal ${index}`));
    }

    const almost: SessionReplayFrustrationSettings = {
      ...getDefaultSessionReplayFrustrationSettings(),
      customSignals: signals,
    };

    expect(canAddCustomSignal(almost)).toBe(true);
    expect(
      canAddCustomSignal(
        withCustomSignal(almost, customSignal("last", "Last")),
      ),
    ).toBe(false);
  });

  test("new ids do not repeat", () => {
    const ids: Set<string> = new Set<string>();

    for (let index: number = 0; index < 200; index++) {
      ids.add(makeCustomSignalId());
    }

    expect(ids.size).toBe(200);
  });
});
