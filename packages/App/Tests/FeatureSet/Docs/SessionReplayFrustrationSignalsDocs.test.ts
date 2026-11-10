import CustomSignalDetector, {
  CustomSignalHit,
} from "../../../FeatureSet/BrowserRecorder/src/CustomSignalDetector";
import {
  ADD_SIGNAL_TEXT,
  BUILT_IN_CARD_TITLE,
  BUILT_IN_SIGNAL_KEYS,
  BUILT_IN_SIGNAL_TITLES,
  BuiltInSignalKey,
  CHANGE_RULE_TITLE,
  COUNTS_AS_FRUSTRATION_TITLE,
  CUSTOM_CARD_TITLE,
  CUSTOM_SIGNAL_TRIGGER_COPY,
  CUSTOM_SIGNAL_TRIGGERS,
  DELETE_SIGNAL_TEXT,
  EDIT_SIGNAL_TEXT,
  FRUSTRATION_SIGNALS_TITLE,
  IGNORE_SELECTORS_HINT,
  IGNORE_SELECTORS_LABEL,
  MARKER_PILL_TEXT,
  RULE_NUMBER_FIELDS,
  RuleNumberField,
  SAVE_RULE_TEXT,
  USE_DEFAULTS_TEXT,
  describeBuiltInSignal,
  hasIgnoredSelectors,
  toSeconds,
} from "../../../FeatureSet/Dashboard/src/Components/SessionReplay/FrustrationSignals/FrustrationSignalsCopy";
import {
  SESSION_REPLAY_FILTER_FIELDS,
  SessionReplayFilterField,
} from "../../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayFilterFields";
import { FILTER_URL_KEYS } from "../../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";
import {
  CustomSignalMatcher,
  MobileCustomSignalHit,
  readCustomSignals,
} from "../../../FeatureSet/MobileRecorder/src/CustomSignals";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { dashboardLocale, drawnDashboardLabel } from "./DocsDashboardLabels";
import { tables } from "./DocsPageShape";
import { sectionInLanguage } from "./NetworkDocsLabels";
import { SESSION_REPLAY } from "./RumDocsPages";
import {
  SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
  SESSION_REPLAY_MAX_IGNORED_SELECTORS,
  SessionReplayCustomSignalConfig,
  SessionReplayCustomSignalTrigger,
  SessionReplayFrustrationSettings,
  getDefaultSessionReplayFrustrationSettings,
} from "Common/Types/Rum/SessionReplayFrustrationSignals";
import {
  checkSessionReplayFrustrationSettings,
  getSessionReplayCustomSignalMatchProblem,
  isPlausibleCssSelector,
} from "Common/Utils/Rum/SessionReplayFrustrationSettingsValidation";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Session Replay page's "Frustration signals" section (issue #6443),
 * held to the code that does what it says, in every docs language.
 *
 * The section is the reference for each application's Frustration Signals
 * page, so it names the page's cards, buttons and fields as the Dashboard
 * draws them in the reader's language, states each built-in signal's
 * default rule in the very sentence the page builds from the default
 * numbers, and gives each number's range as the rule editor allows it.
 * What it says the recorders do - which recorder detects what, how a page
 * pattern, an event name and an error's text are matched, once a second at
 * most, how often an app reads its settings again - is run through the
 * recorders' own code, and what it says is refused on save is run through
 * the check the server makes.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const MOBILE_RECORDER_FILE: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/MobileRecorder/src/MobileReplayRecorder.ts",
);

const HEADING: string = "## Frustration signals";
const SESSION_LIST_HEADING: string = "### The session list";

/*
 * One example of what each trigger matches: the section's own, and for an
 * event the name the dialog's placeholder shows (the section gives none).
 */
const EXAMPLE_MATCHES: Record<SessionReplayCustomSignalTrigger, string> = {
  click: "#pay-button",
  page: "/checkout/error",
  event: "payment_failed",
  error: "card declined",
};

const DEFAULTS: SessionReplayFrustrationSettings =
  getDefaultSessionReplayFrustrationSettings();

// The table's delimiter row is left out: the header, then one row a signal.
const HEADER_ROWS: number = 1;

type SectionFunction = (language: string) => string;

const section: SectionFunction = (language: string): string => {
  return sectionInLanguage(language, SESSION_REPLAY, HEADING);
};

type TableFunction = (language: string, index: number) => Array<Array<string>>;

const sectionTable: TableFunction = (
  language: string,
  index: number,
): Array<Array<string>> => {
  return tables(section(language))[index] || [];
};

type BoldLabelFunction = (language: string, english: string) => string;

// A Dashboard label as the page names it in this language: in bold.
const boldLabel: BoldLabelFunction = (
  language: string,
  english: string,
): string => {
  return `**${drawnDashboardLabel(language, english)}**`;
};

type TranslatorFunction = (language: string) => Translator;

// The Dashboard's translator for a language, from its locale file.
const dashboardTranslator: TranslatorFunction = (
  language: string,
): Translator => {
  const locale: Record<string, unknown> = dashboardLocale(language);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, language);
};

type RangeFunction = (field: RuleNumberField) => string;

/*
 * "**Time between clicks** 0.3 to 5 seconds": a rule's number as the
 * editor takes it, milliseconds in seconds as the editor shows them.
 */
const englishRange: RangeFunction = (field: RuleNumberField): string => {
  const shown: (value: number) => number = (value: number): number => {
    return field.unit === "milliseconds" ? toSeconds(value) : value;
  };
  const unit: Record<RuleNumberField["unit"], string> = {
    count: "",
    seconds: " seconds",
    milliseconds: " seconds",
    pixels: " px",
  };

  return `**${field.label}** ${shown(field.limit.min)} to ${shown(field.limit.max)}${unit[field.unit]}`;
};

type ListFunction = (parts: Array<string>) => string;

// "A, B, and C." as the English table writes a list.
const englishList: ListFunction = (parts: Array<string>): string => {
  if (parts.length === 1) {
    return `${parts[0]}.`;
  }

  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`;
};

type SignalFunction = (
  trigger: SessionReplayCustomSignalTrigger,
  match: string,
) => SessionReplayCustomSignalConfig;

const signal: SignalFunction = (
  trigger: SessionReplayCustomSignalTrigger,
  match: string,
): SessionReplayCustomSignalConfig => {
  return {
    name: `Signal on ${match}`,
    trigger: trigger,
    match: match,
    isFrustration: true,
  };
};

type BrowserHitsFunction = (
  signals: Array<SessionReplayCustomSignalConfig>,
  act: (detector: CustomSignalDetector) => void,
) => Array<CustomSignalHit>;

// What the browser recorder reports for what happens on a page.
const browserHits: BrowserHitsFunction = (
  signals: Array<SessionReplayCustomSignalConfig>,
  act: (detector: CustomSignalDetector) => void,
): Array<CustomSignalHit> => {
  const hits: Array<CustomSignalHit> = [];
  const detector: CustomSignalDetector = new CustomSignalDetector({
    signals: signals,
    onSignal: (hit: CustomSignalHit): void => {
      hits.push(hit);
    },
  });

  act(detector);

  return hits;
};

describe("Session Replay docs: frustration signals, in every language", (): void => {
  describe.each(DOCS_LANGUAGES)("%s", (language: string): void => {
    it("states each built-in signal's default rule in the sentence its card builds from the defaults", (): void => {
      const rows: Array<Array<string>> = sectionTable(language, 0);
      const translator: Translator = dashboardTranslator(language);

      expect(rows).toHaveLength(HEADER_ROWS + BUILT_IN_SIGNAL_KEYS.length);

      BUILT_IN_SIGNAL_KEYS.forEach(
        (key: BuiltInSignalKey, index: number): void => {
          const row: Array<string> = rows[HEADER_ROWS + index] || [];

          expect(row[0]).toBe(boldLabel(language, BUILT_IN_SIGNAL_TITLES[key]));
          expect(row[1]).toBe(describeBuiltInSignal(key, DEFAULTS, translator));
        },
      );
    });

    it("names each number the rule editor changes, in its order, and the ignore list only where a rule has one", (): void => {
      const rows: Array<Array<string>> = sectionTable(language, 0);
      const ignoreList: string = boldLabel(language, IGNORE_SELECTORS_LABEL);

      BUILT_IN_SIGNAL_KEYS.forEach(
        (key: BuiltInSignalKey, index: number): void => {
          const cell: string = (rows[HEADER_ROWS + index] || [])[2] || "";
          let from: number = -1;

          for (const field of RULE_NUMBER_FIELDS[key]) {
            const at: number = cell.indexOf(boldLabel(language, field.label));

            expect({ key, field: field.id, isAfter: at > from }).toEqual({
              key,
              field: field.id,
              isAfter: true,
            });
            from = at;
          }

          expect({ key, ignoreList: cell.includes(ignoreList) }).toEqual({
            key,
            ignoreList: hasIgnoredSelectors(key),
          });
        },
      );
    });

    it("names the four things that can set a signal off, in the order the dialog offers them, and the one only the browser detects", (): void => {
      const rows: Array<Array<string>> = sectionTable(language, 1);

      expect(rows).toHaveLength(HEADER_ROWS + CUSTOM_SIGNAL_TRIGGERS.length);

      const detectedBy: Array<string> = CUSTOM_SIGNAL_TRIGGERS.map(
        (trigger: SessionReplayCustomSignalTrigger, index: number): string => {
          const row: Array<string> = rows[HEADER_ROWS + index] || [];

          expect(row[0]).toBe(
            boldLabel(language, CUSTOM_SIGNAL_TRIGGER_COPY[trigger].title),
          );

          return row[2] || "";
        },
      );
      const clickIndex: number = CUSTOM_SIGNAL_TRIGGERS.indexOf("click");
      const others: Array<string> = detectedBy.filter(
        (_cell: string, index: number): boolean => {
          return index !== clickIndex;
        },
      );

      // Both recorders detect the other three; the browser one the click.
      expect(new Set(others).size).toBe(1);
      expect(others).not.toContain(detectedBy[clickIndex]);
    });

    it("names the page, its cards, buttons and choices, and the list's filter, as the Dashboard draws them", (): void => {
      const text: string = section(language);
      const signalOfYourOwn: SessionReplayFilterField | undefined =
        SESSION_REPLAY_FILTER_FIELDS.find(
          (field: SessionReplayFilterField): boolean => {
            return field.field === "customSignalName";
          },
        );

      expect(signalOfYourOwn).toBeDefined();

      for (const english of [
        FRUSTRATION_SIGNALS_TITLE,
        BUILT_IN_CARD_TITLE,
        CHANGE_RULE_TITLE,
        SAVE_RULE_TEXT,
        USE_DEFAULTS_TEXT,
        IGNORE_SELECTORS_LABEL,
        CUSTOM_CARD_TITLE,
        ADD_SIGNAL_TEXT,
        COUNTS_AS_FRUSTRATION_TITLE,
        MARKER_PILL_TEXT,
        EDIT_SIGNAL_TEXT,
        DELETE_SIGNAL_TEXT,
        signalOfYourOwn?.title || "",
      ]) {
        expect({
          english,
          named: text.includes(boldLabel(language, english)),
        }).toEqual({ english, named: true });
      }

      // The session list's own section names the filter's field too.
      expect(
        sectionInLanguage(language, SESSION_REPLAY, SESSION_LIST_HEADING),
      ).toContain(boldLabel(language, signalOfYourOwn?.title || ""));
    });

    it("gives the list URL's parameter for the filter as the list writes it", (): void => {
      expect(FILTER_URL_KEYS.customSignalName).toBe("signalName");
      expect(section(language)).toContain("`signalName`");
      expect(readPage(language, SESSION_REPLAY)).toMatch(
        /`trigger`[^`]+`signalName`[^`]+`sort`/,
      );
    });
  });
});

describe("Session Replay docs: frustration signals, held to the code", (): void => {
  const english: string = section("en");

  it("gives each number's range as the rule editor allows it", (): void => {
    const rows: Array<Array<string>> = sectionTable("en", 0);

    BUILT_IN_SIGNAL_KEYS.forEach(
      (key: BuiltInSignalKey, index: number): void => {
        const parts: Array<string> = RULE_NUMBER_FIELDS[key].map(englishRange);

        if (hasIgnoredSelectors(key)) {
          parts.push(`**${IGNORE_SELECTORS_LABEL}**`);
        }

        expect((rows[HEADER_ROWS + index] || [])[2]).toBe(englishList(parts));
      },
    );
  });

  it("says the defaults are the rules recordings used before they could be changed", (): void => {
    // The numbers every recorder used before issue #6443.
    expect(DEFAULTS.rageClick).toMatchObject({
      clickCount: 3,
      windowMs: 1000,
      radiusPx: 30,
    });
    expect(DEFAULTS.deadClick.timeoutMs).toBe(3000);
    expect(DEFAULTS.errorClick.windowMs).toBe(1000);
    expect(DEFAULTS.refreshRage).toMatchObject({
      reloadCount: 3,
      windowSeconds: 60,
    });
    expect(english).toContain(
      "The defaults are the rules every recording used before they could be changed:",
    );
  });

  it("states how many selectors a rule ignores and how many signals an application has, with the editor's own example", (): void => {
    expect(english).toContain(
      `up to ${SESSION_REPLAY_MAX_IGNORED_SELECTORS} CSS selectors, one a line, such as \`.quantity-stepper\`.`,
    );
    expect(IGNORE_SELECTORS_HINT).toContain("such as .quantity-stepper.");
    expect(isPlausibleCssSelector(".quantity-stepper")).toBe(true);
    expect(english).toContain(
      `up to ${SESSION_REPLAY_MAX_CUSTOM_SIGNALS} for each application.`,
    );
  });

  it("says which recorder detects what, as each recorder reads the settings", (): void => {
    const rows: Array<Array<string>> = sectionTable("en", 1);
    const detectedBy: Record<string, string> = {};

    CUSTOM_SIGNAL_TRIGGERS.forEach(
      (trigger: SessionReplayCustomSignalTrigger, index: number): void => {
        detectedBy[trigger] = (rows[HEADER_ROWS + index] || [])[2] || "";
      },
    );

    expect(detectedBy).toEqual({
      click: "The browser recorder",
      page: "Both recorders",
      event: "Both recorders",
      error: "Both recorders",
    });

    // Its examples are ones a save takes.
    expect(CUSTOM_SIGNAL_TRIGGER_COPY.event.matchPlaceholder).toBe(
      EXAMPLE_MATCHES.event,
    );

    for (const trigger of CUSTOM_SIGNAL_TRIGGERS) {
      const example: string = EXAMPLE_MATCHES[trigger];

      expect({
        trigger,
        problem: getSessionReplayCustomSignalMatchProblem(trigger, example),
        shown: trigger === "event" || english.includes(`\`${example}\``),
      }).toEqual({ trigger, problem: null, shown: true });
    }

    // The app recorder sets the click signals aside and keeps the rest.
    const mobile: Array<SessionReplayCustomSignalConfig> = readCustomSignals({
      customSignals: CUSTOM_SIGNAL_TRIGGERS.map(
        (
          trigger: SessionReplayCustomSignalTrigger,
        ): Record<string, unknown> => {
          return {
            ...signal(trigger, EXAMPLE_MATCHES[trigger]),
            isEnabled: true,
          };
        },
      ),
    });

    expect(
      mobile.map((kept: SessionReplayCustomSignalConfig): string => {
        return kept.trigger;
      }),
    ).toEqual(["page", "event", "error"]);

    // The browser recorder listens for clicks when there is a click signal.
    const detector: CustomSignalDetector = new CustomSignalDetector({
      signals: [signal("click", "#pay-button")],
      onSignal: (): void => {},
    });

    expect(detector.hasSignals("click")).toBe(true);
  });

  it("runs the page patterns it shows through both recorders", (): void => {
    expect(english).toContain(
      "such as `/checkout/error` or `/orders/*/failed`.",
    );
    expect(english).toContain(
      "In a page pattern, `*` stands for any part of the path, slashes included.",
    );
    expect(english).toContain("case and a slash at the end are ignored.");

    const pattern: SessionReplayCustomSignalConfig = signal(
      "page",
      "/orders/*/failed",
    );

    for (const visited of [
      "/orders/1042/failed",
      "/orders/eu/1042/failed",
      "/Orders/1042/Failed/",
    ]) {
      expect({
        visited,
        browser: browserHits([pattern], (detector: CustomSignalDetector) => {
          detector.notifyPage([visited], 1000);
        }).length,
        app: new CustomSignalMatcher().matchPage([pattern], visited, 1000)
          .length,
      }).toEqual({ visited, browser: 1, app: 1 });
    }

    const exact: SessionReplayCustomSignalConfig = signal(
      "page",
      "/checkout/error",
    );

    expect(
      browserHits([exact], (detector: CustomSignalDetector): void => {
        detector.notifyPage(["/checkout/error/details"], 1000);
      }),
    ).toHaveLength(0);
  });

  it("matches a hash-routed page on its route, and an app on the route it passes to setRoute()", (): void => {
    expect(english).toContain(
      "A page that routes after `#/` is matched on that route too, and a React Native app on the route it passes to `setRoute()`.",
    );

    const paths: Array<string> = CustomSignalDetector.pagePathsOf({
      pathname: "/",
      hash: "#/checkout/error?step=2",
    });

    expect(paths).toEqual(["/", "/checkout/error"]);
    expect(
      browserHits(
        [signal("page", "/checkout/error")],
        (detector: CustomSignalDetector): void => {
          detector.notifyPage(paths, 1000);
        },
      ),
    ).toHaveLength(1);

    const hits: Array<MobileCustomSignalHit> =
      new CustomSignalMatcher().matchPage(
        [signal("page", "/checkout/error")],
        "/checkout/error",
        1000,
      );

    expect(hits).toHaveLength(1);
    expect(fs.readFileSync(MOBILE_RECORDER_FILE, "utf8")).toContain(
      "public async setRoute(route: string): Promise<void> {",
    );
  });

  it("matches an event's name and an error's text in any case, in both recorders", (): void => {
    expect(english).toContain(
      "A call to `OneUptimeReplay.track()` with that name, in any case.",
    );
    expect(english).toContain(
      "An error whose message contains the text, in any case, such as `card declined`.",
    );

    const event: SessionReplayCustomSignalConfig = signal(
      "event",
      "payment_failed",
    );
    const error: SessionReplayCustomSignalConfig = signal(
      "error",
      "card declined",
    );
    const message: string = "Payment failed: Card Declined by the issuer";

    expect(
      browserHits([event, error], (detector: CustomSignalDetector): void => {
        detector.notifyEvent("Payment_Failed", 1000);
        detector.notifyErrorText(message, 1000);
      }),
    ).toHaveLength(2);

    const matcher: CustomSignalMatcher = new CustomSignalMatcher();

    expect(matcher.matchEvent([event], "PAYMENT_FAILED", 1000)).toHaveLength(1);
    expect(matcher.matchErrorText([error], message, 1000)).toHaveLength(1);
  });

  it("fires the same signal at most once a second", (): void => {
    expect(SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS).toBe(1000);
    expect(english).toContain(
      "and the same signal fires at most once a second.",
    );

    const event: SessionReplayCustomSignalConfig = signal("event", "retry");
    const atMs: Array<number> = [10000, 10500, 10999, 11000];

    expect(
      browserHits([event], (detector: CustomSignalDetector): void => {
        for (const at of atMs) {
          detector.notifyEvent("retry", at);
        }
      }).map((hit: CustomSignalHit): number => {
        return hit.atUnixMs;
      }),
    ).toEqual([10000, 11000]);

    const matcher: CustomSignalMatcher = new CustomSignalMatcher();
    const fired: Array<number> = [];

    for (const at of atMs) {
      for (const hit of matcher.matchEvent([event], "retry", at)) {
        fired.push(hit.atUnixMs);
      }
    }

    expect(fired).toEqual([10000, 11000]);
  });

  it("says an app reads the settings again on start, on coming back and every five minutes", (): void => {
    const recorder: string = fs.readFileSync(MOBILE_RECORDER_FILE, "utf8");

    expect(recorder).toContain(
      "export const MOBILE_POLICY_REFRESH_INTERVAL_MS: number = 5 * 60_000;",
    );
    expect(recorder).toMatch(
      /type PolicyRefreshReason = [^;]*"foreground"[^;]*"periodic"/,
    );
    expect(english).toContain(
      "which it does when it starts, when it comes back to the foreground and every five minutes while it is open.",
    );
  });

  it("names what a save refuses, as the server's check refuses it", (): void => {
    expect(english).toContain(
      "a number outside its range, a selector that is not CSS, a page pattern that cannot match a path or a name another signal has is refused with a message that names it.",
    );

    const custom: (
      name: string,
      trigger: SessionReplayCustomSignalTrigger,
      match: string,
    ) => Record<string, unknown> = (
      name: string,
      trigger: SessionReplayCustomSignalTrigger,
      match: string,
    ): Record<string, unknown> => {
      return {
        name: name,
        trigger: trigger,
        match: match,
        isFrustration: true,
        isEnabled: true,
      };
    };
    const problem: (value: Record<string, unknown>) => string | null = (
      value: Record<string, unknown>,
    ): string | null => {
      return checkSessionReplayFrustrationSettings(value, (): string => {
        return "generated";
      }).problem;
    };

    expect(problem({ rageClick: { clickCount: 11 } })).toContain("Rage clicks");
    expect(problem({ deadClick: { ignoreSelectors: ["<button>"] } })).toContain(
      "Dead clicks",
    );
    expect(
      problem({
        customSignals: [custom("Checkout failed", "page", "checkout")],
      }),
    ).toContain("Checkout failed");
    expect(
      problem({
        customSignals: [
          custom("Paid", "event", "paid"),
          custom("paid", "event", "payment_done"),
        ],
      }),
    ).toContain("paid");
    expect(
      problem({ customSignals: [custom("Rage clicks", "event", "rage")] }),
    ).not.toBeNull();
    expect(problem({ customSignals: [custom("Paid", "event", "paid")] })).toBe(
      null,
    );
  });
});
