import { afterEach, describe, expect, test } from "@jest/globals";
import {
  CodeTaskOriginJSON,
  CodeTaskOriginType,
} from "../../../Types/AI/CodeTask";
import {
  PRODUCTION_REVIEW_WINDOWS,
  ProductionReviewAiNoteCode,
  ProductionReviewOperationMatch,
  ProductionReviewPosting,
  ProductionReviewPullRequestContent,
  ProductionReviewSection,
  ProductionReviewSummaryJSON,
  ProductionReviewUtil,
  ProductionReviewWhere,
} from "../../../Types/CodeRepository/ProductionReview";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  PRODUCTION_REVIEW_AI_NOTES,
  PRODUCTION_REVIEW_CONTENT_ANSWERS,
  PRODUCTION_REVIEW_CONTENT_COPY,
  PRODUCTION_REVIEW_CONTENT_FIELD_KEY,
  PRODUCTION_REVIEW_COPY,
  PRODUCTION_REVIEW_GLANCE,
  PRODUCTION_REVIEW_INCIDENTS_IN_ALL,
  PRODUCTION_REVIEW_MATCH_LABELS,
  PRODUCTION_REVIEW_PROFILE_KIND_LABELS,
  PRODUCTION_REVIEW_SECTION_LABELS,
  PRODUCTION_REVIEW_SETTINGS_COPY,
  PRODUCTION_REVIEW_SPANS_LAST_HOUR,
  PRODUCTION_REVIEW_WHERE_LABELS,
  formatReviewDuration,
  formatReviewPercent,
  getGitHubAppSlug,
  getPickedProductionReviewContent,
  getProductionReviewCommand,
  getProductionReviewGlance,
  getProductionReviewNothingSentence,
  getProductionReviewPostingSentence,
  getProfileKindLabel,
  getReviewedPullRequestNumber,
  getValuesForProductionReviewContent,
  readProductionReviewContent,
  splitCodeNameAtBreaks,
  splitPointText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReviewCopy";
import {
  CODE_TASK_RECIPE_LABELS,
  getRecipeLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskCopy";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  ProfileCategory,
  getProfileCategoryNoun,
} from "../../../Utils/Profiles/ProfileTypes";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A pull request's production review in Code, in words and plain rules
 * (Components/Code/CodeProductionReviewCopy): what the reviews page, a
 * review's page, a list row and the repository's settings say, and the
 * small rules they share - the GitHub command, what a row says a review
 * found, which sentence says what the pull request shows, and how a
 * duration, a share or OneUptime AI's words are drawn.
 *
 * Every sentence is an English key the Dashboard translates where it is
 * drawn: each must be in en.json, and German - one of the 16 locales the
 * production review ships translated in - must word it.
 */

const english: Translator = createTranslator(undefined, "en");
// A German reader: the Dashboard's own German locale.
const german: Translator = createTranslator(
  (key: string): string | undefined => {
    return (germanLocale as unknown as Record<string, string>)[key];
  },
  "de",
);

const SUMMARY: ProductionReviewSummaryJSON = {
  hasSignal: true,
  exceptionCount: 2,
  operationCount: 1,
  hotFunctionCount: 0,
  incidentCount: 3,
  suspectDeployCount: 1,
  headSha: "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39",
  reviewedAt: "2026-10-22T08:00:00.000Z",
  posting: ProductionReviewPosting.Review,
};

afterEach(() => {
  delete process.env["GITHUB_APP_NAME"];
});

// Every English key a value holds, through plain objects and records.
function keysOf(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(keysOf);
  }

  return [];
}

describe("the words are the Dashboard's to translate", () => {
  const sentences: Array<string> = [
    ...keysOf(PRODUCTION_REVIEW_COPY),
    ...keysOf(PRODUCTION_REVIEW_SETTINGS_COPY),
    ...keysOf(PRODUCTION_REVIEW_CONTENT_COPY),
    ...keysOf(PRODUCTION_REVIEW_WHERE_LABELS),
    ...keysOf(PRODUCTION_REVIEW_MATCH_LABELS),
    ...keysOf(PRODUCTION_REVIEW_SECTION_LABELS),
    ...keysOf(PRODUCTION_REVIEW_AI_NOTES),
    ...Object.values(PRODUCTION_REVIEW_PROFILE_KIND_LABELS),
    PRODUCTION_REVIEW_GLANCE.nothingFound,
  ];

  test("every sentence is a key of en.json", () => {
    const missing: Array<string> = sentences.filter(
      (sentence: string): boolean => {
        return !(sentence in (englishLocale as Record<string, unknown>));
      },
    );

    expect(missing).toEqual([]);
  });

  test("every count is a plural of en.json: the general sentence the key, the one form beside it", () => {
    const plurals: Array<{ one: string; other: string }> = [
      PRODUCTION_REVIEW_GLANCE.exceptions,
      PRODUCTION_REVIEW_GLANCE.operations,
      PRODUCTION_REVIEW_GLANCE.hotFunctions,
      PRODUCTION_REVIEW_GLANCE.incidents,
      PRODUCTION_REVIEW_GLANCE.suspectDeploys,
      PRODUCTION_REVIEW_SPANS_LAST_HOUR,
      PRODUCTION_REVIEW_INCIDENTS_IN_ALL,
    ];
    const locale: Record<string, string> = englishLocale as unknown as Record<
      string,
      string
    >;

    for (const plural of plurals) {
      expect({ key: plural.other, one: locale[`${plural.other}_one`] }).toEqual(
        { key: plural.other, one: plural.one },
      );
    }
  });

  test("German words every one of them - the setting, the page, the review", () => {
    const locale: Record<string, string> = germanLocale as unknown as Record<
      string,
      string
    >;
    // The same in German: names, units and figures.
    const sameInGerman: Array<string> = [
      "Pull Requests",
      "Commit {{sha}}",
      "p95 {{duration}}",
      "p99 {{duration}}",
      "{{count}} spans",
    ];
    /*
     * Labels other pages drew first - a profile's "Samples": their words are
     * those pages', and the review reuses them.
     */
    const sharedWithOtherPages: Array<string> = [
      "Traces",
      "Deployments",
      "Goroutines",
      "Samples",
    ];
    const untranslated: Array<string> = sentences.filter(
      (sentence: string): boolean => {
        return (
          !sameInGerman.includes(sentence) &&
          !sharedWithOtherPages.includes(sentence) &&
          (!locale[sentence] || locale[sentence] === sentence)
        );
      },
    );

    expect(untranslated).toEqual([]);
    expect(
      german.translateText(PRODUCTION_REVIEW_SETTINGS_COPY.switchTitle),
    ).toBe("Pull Requests gegen die Produktion prüfen");
    /*
     * When an exception was last thrown is a sentence of the review's own,
     * worded with its German time: an exception is thrown, not seen, so it
     * is not the heroes' shared "Last seen {{time}}".
     */
    expect(PRODUCTION_REVIEW_COPY.lastThrown).not.toBe("Last seen {{time}}");
    expect(
      german.translateTemplate(PRODUCTION_REVIEW_COPY.lastThrown, {
        time: "vor 5 Minuten",
      }),
    ).toBe("Zuletzt aufgetreten vor 5 Minuten");
    expect(
      (germanLocale as unknown as Record<string, string>)["Last seen {{time}}"],
    ).not.toBe(
      (germanLocale as unknown as Record<string, string>)[
        PRODUCTION_REVIEW_COPY.lastThrown
      ],
    );
    expect(
      german.translatePlural(
        { one: "{{count}} error", other: "{{count}} errors" },
        93,
      ),
    ).toBe("93 Fehler");
  });

  test("every description a person reads while setting it up fits two short lines", () => {
    const lines: Array<string> = [
      PRODUCTION_REVIEW_SETTINGS_COPY.switchDescription,
      PRODUCTION_REVIEW_COPY.pageDescription,
      PRODUCTION_REVIEW_COPY.statusOnOthers,
      PRODUCTION_REVIEW_COPY.emptyDescription,
      ...PRODUCTION_REVIEW_CONTENT_ANSWERS.map(
        (content: ProductionReviewPullRequestContent): string => {
          return PRODUCTION_REVIEW_CONTENT_COPY[content].description;
        },
      ),
    ];

    for (const line of lines) {
      expect({ line, fits: line.length <= 150 }).toEqual({ line, fits: true });
    }

    expect(
      PRODUCTION_REVIEW_SETTINGS_COPY.contentCardDescription.length,
    ).toBeLessThanOrEqual(210);
  });

  test("the recipe has its name, on a list row and on the review's page", () => {
    expect(
      CODE_TASK_RECIPE_LABELS[
        CodeFixTaskType.GitHubPullRequestProductionReview
      ],
    ).toBe("Production Review");
    expect(
      getRecipeLabel(CodeFixTaskType.GitHubPullRequestProductionReview),
    ).toBe(PRODUCTION_REVIEW_COPY.recipeLabel);
  });

  test("every kind of closeness, match, part and AI note has its words", () => {
    for (const where of Object.values(ProductionReviewWhere)) {
      expect(PRODUCTION_REVIEW_WHERE_LABELS[where]).toBeTruthy();
    }

    for (const match of Object.values(ProductionReviewOperationMatch)) {
      expect(PRODUCTION_REVIEW_MATCH_LABELS[match]).toBeTruthy();
    }

    for (const section of Object.values(ProductionReviewSection)) {
      expect(PRODUCTION_REVIEW_SECTION_LABELS[section]).toBeTruthy();
    }

    for (const code of Object.values(ProductionReviewAiNoteCode)) {
      expect(PRODUCTION_REVIEW_AI_NOTES[code]).toBeTruthy();
    }

    expect(PRODUCTION_REVIEW_CONTENT_ANSWERS).toEqual(
      Object.values(ProductionReviewPullRequestContent),
    );
  });
});

describe("the command that asks for a review on GitHub", () => {
  test("is the GitHub App's mention, as GitHub makes its slug from the app's name", () => {
    expect(getGitHubAppSlug("OneUptime")).toBe("oneuptime");
    expect(getGitHubAppSlug("Acme OneUptime Bot")).toBe("acme-oneuptime-bot");
    expect(getGitHubAppSlug("  --Acme  (Prod)  App-- ")).toBe("acme-prod-app");
    expect(getGitHubAppSlug("oneuptime-app")).toBe("oneuptime-app");
    // Nothing configured: the app's own name.
    expect(getGitHubAppSlug("")).toBe("oneuptime");
    expect(getGitHubAppSlug(null)).toBe("oneuptime");
    expect(getGitHubAppSlug("!!!")).toBe("oneuptime");
  });

  test("names the app the Dashboard was configured with, then 'production review'", () => {
    process.env["GITHUB_APP_NAME"] = "Acme Code Bot";
    expect(getProductionReviewCommand()).toBe(
      "@acme-code-bot production review",
    );

    delete process.env["GITHUB_APP_NAME"];
    expect(getProductionReviewCommand()).toBe("@oneuptime production review");
  });

  test("reads a long app name in time in line with it", () => {
    const name: string = "a -".repeat(200000);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(getGitHubAppSlug(name).startsWith("a-a-a")).toBe(true);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("what a list row says a review found", () => {
  test("each part it found, counted, in order: exceptions, operations, hot functions, incidents, deploys", () => {
    expect(getProductionReviewGlance(SUMMARY, english)).toEqual([
      "2 exceptions",
      "1 operation",
      "3 incidents",
      "1 suspect deploy",
    ]);
  });

  test("a review that found nothing says so in two words, whatever the counts", () => {
    expect(
      getProductionReviewGlance({ ...SUMMARY, hasSignal: false }, english),
    ).toEqual(["Nothing found"]);
    expect(
      getProductionReviewGlance({ ...SUMMARY, hasSignal: false }, german),
    ).toEqual(["Nichts gefunden"]);
  });

  test("in the reader's language, with their counts", () => {
    expect(
      getProductionReviewGlance(
        { ...SUMMARY, exceptionCount: 1, operationCount: 0 },
        german,
      ),
    ).toEqual(["1 Ausnahme", "3 Vorfälle", "1 verdächtiges Deployment"]);
  });

  test("its pull request's number, read from what started it - none for anything else", () => {
    const origin: (data: Partial<CodeTaskOriginJSON>) => CodeTaskOriginJSON = (
      data: Partial<CodeTaskOriginJSON>,
    ): CodeTaskOriginJSON => {
      return {
        type: CodeTaskOriginType.GitHubPullRequest,
        label: "#42",
        ...data,
      };
    };

    expect(getReviewedPullRequestNumber(origin({}))).toBe(42);
    expect(getReviewedPullRequestNumber(origin({ label: "#7" }))).toBe(7);
    expect(getReviewedPullRequestNumber(origin({ label: "42" }))).toBeNull();
    expect(getReviewedPullRequestNumber(origin({ label: "#0" }))).toBeNull();
    expect(getReviewedPullRequestNumber(origin({ label: "#4.5" }))).toBeNull();
    expect(getReviewedPullRequestNumber(origin({ label: "#abc" }))).toBeNull();
    expect(
      getReviewedPullRequestNumber(
        origin({ type: CodeTaskOriginType.GitHubIssue }),
      ),
    ).toBeNull();
    expect(getReviewedPullRequestNumber(undefined)).toBeNull();
  });
});

describe("what the pull request shows of a review", () => {
  test("the review, posted; a link on a public repository; a link the settings asked for; nothing", () => {
    expect(
      getProductionReviewPostingSentence({
        posting: ProductionReviewPosting.Review,
        isPublicRepository: false,
      }),
    ).toBe("Posted on the pull request.");
    expect(
      getProductionReviewPostingSentence({
        posting: ProductionReviewPosting.Link,
        isPublicRepository: true,
      }),
    ).toBe(
      "This repository is public, so the pull request only links to this review.",
    );
    // A repository whose visibility is not known is read as public.
    expect(
      getProductionReviewPostingSentence({
        posting: ProductionReviewPosting.Link,
        isPublicRepository: undefined,
      }),
    ).toBe(PRODUCTION_REVIEW_COPY.postedLinkPublic);
    expect(
      getProductionReviewPostingSentence({
        posting: ProductionReviewPosting.Link,
        isPublicRepository: false,
      }),
    ).toBe(
      "This repository's pull requests only link to their review, as its settings ask.",
    );
    // The review below it says why: once is enough.
    expect(
      getProductionReviewPostingSentence({
        posting: ProductionReviewPosting.None,
        isPublicRepository: false,
      }),
    ).toBe("Nothing was posted on the pull request.");
  });

  test("the choice of what it shows, read and written - unset or unknown is the default", () => {
    expect(readProductionReviewContent(undefined)).toBe(
      ProductionReviewPullRequestContent.Review,
    );
    expect(readProductionReviewContent(null)).toBe(
      ProductionReviewPullRequestContent.Review,
    );
    expect(readProductionReviewContent("Everything")).toBe(
      ProductionReviewPullRequestContent.Review,
    );
    expect(readProductionReviewContent("Link")).toBe(
      ProductionReviewPullRequestContent.Link,
    );
    // The Dashboard reads the choice as the server does.
    for (const value of [undefined, null, "", "Link", "Review", "x"]) {
      expect(readProductionReviewContent(value)).toBe(
        ProductionReviewUtil.readContent(value),
      );
    }

    expect(getPickedProductionReviewContent({})).toBe("Review");
    expect(
      getPickedProductionReviewContent({
        productionReviewPullRequestContent: "ReviewEvenIfPublic",
      }),
    ).toBe("ReviewEvenIfPublic");
    expect(
      getPickedProductionReviewContent({
        productionReviewPullRequestContent: "ReviewEvenIfPublic",
        [PRODUCTION_REVIEW_CONTENT_FIELD_KEY]: "Link",
      }),
    ).toBe("Link");
    expect(
      getPickedProductionReviewContent({
        [PRODUCTION_REVIEW_CONTENT_FIELD_KEY]: "Nonsense",
      }),
    ).toBe("Review");
    expect(getPickedProductionReviewContent(null)).toBe("Review");

    expect(
      getValuesForProductionReviewContent({
        values: {
          name: "checkout-api",
          productionReviewPullRequestContent: null,
        },
        content: ProductionReviewPullRequestContent.Link,
      }),
    ).toEqual({
      name: "checkout-api",
      [PRODUCTION_REVIEW_CONTENT_FIELD_KEY]: "Link",
      productionReviewPullRequestContent: "Link",
    });
  });
});

describe("what a review that found nothing says", () => {
  test("no code changed; no service known to run the repository's code; or nothing where it runs", () => {
    expect(
      getProductionReviewNothingSentence(
        { codeFileCount: 0, services: [], noServicesReason: "NoServices" },
        english,
      ),
    ).toBe(
      "This pull request changes no code production runs, so production has nothing to say about it.",
    );
    expect(
      getProductionReviewNothingSentence(
        { codeFileCount: 3, services: [], noServicesReason: "NoServices" },
        english,
      ),
    ).toBe(PRODUCTION_REVIEW_COPY.noServices);
    expect(
      getProductionReviewNothingSentence(
        {
          codeFileCount: 3,
          services: [{ id: "s", name: "checkout-api" }],
          noServicesReason: undefined,
        },
        english,
      ),
    ).toBe(
      `Nothing in production runs through this pull request's changes: no exception thrown in them in the last ${PRODUCTION_REVIEW_WINDOWS.exceptionsDays} days, no traced operation or profiled function that runs them in the last hour, and no open incident or suspect deploy on their services.`,
    );
  });
});

describe("figures, as a review draws them", () => {
  test("a duration: milliseconds under a second, seconds to one place above", () => {
    expect(formatReviewDuration(0, english)).toBe("0 ms");
    expect(formatReviewDuration(840.4, english)).toBe("840 ms");
    expect(formatReviewDuration(1234, english)).toBe("1.2 s");
    expect(formatReviewDuration(61000, english)).toBe("61 s");
    expect(formatReviewDuration(1234, german)).toBe("1,2 s");
    expect(formatReviewDuration(-1, english)).toBe("");
    expect(formatReviewDuration(Number.NaN, english)).toBe("");
  });

  test("a share: whole above ten, one place below", () => {
    expect(formatReviewPercent(12.4, english)).toBe("12%");
    expect(formatReviewPercent(0.44, english)).toBe("0.4%");
    expect(formatReviewPercent(0, english)).toBe("0%");
    expect(formatReviewPercent(2.5, german)).toBe("2,5%");
    expect(formatReviewPercent(-3, english)).toBe("");
    expect(formatReviewPercent(Number.POSITIVE_INFINITY, english)).toBe("");
  });

  test("what a profile measures, in the reader's words - every kind the server names", () => {
    for (const category of Object.values(ProfileCategory)) {
      const noun: string = getProfileCategoryNoun(category);

      expect({
        noun,
        label: PRODUCTION_REVIEW_PROFILE_KIND_LABELS[noun],
      }).toEqual({ noun, label: expect.any(String) });
    }

    expect(getProfileKindLabel("CPU time", english)).toBe("CPU time");
    expect(getProfileKindLabel("wall time", english)).toBe("Wall time");
    expect(getProfileKindLabel("memory allocations", german)).toBe(
      "Speicherzuweisungen",
    );
    // A profile the server names another way is shown as named.
    expect(getProfileKindLabel('the "custom" profile', english)).toBe(
      'the "custom" profile',
    );
  });
});

describe("OneUptime AI's words, in pieces", () => {
  test("the names of code it wrapped in backticks are code; the rest is text", () => {
    expect(
      splitPointText(
        "The change adds a query to `chargeCard()` in `src/payments.ts`, which throws 1,240 times a week.",
      ),
    ).toEqual([
      { text: "The change adds a query to ", isCode: false },
      { text: "chargeCard()", isCode: true },
      { text: " in ", isCode: false },
      { text: "src/payments.ts", isCode: true },
      { text: ", which throws 1,240 times a week.", isCode: false },
    ]);
  });

  test("an unclosed backtick stays text, and empty pieces are dropped", () => {
    expect(splitPointText("Watch `retry() closely")).toEqual([
      { text: "Watch ", isCode: false },
      { text: "`retry() closely", isCode: false },
    ]);
    expect(splitPointText("``")).toEqual([]);
    expect(splitPointText("")).toEqual([]);
  });

  test("markup in its words is text, never markup", () => {
    expect(splitPointText('<img src=x onerror="alert(1)"> `a<b>`')).toEqual([
      { text: '<img src=x onerror="alert(1)"> ', isCode: false },
      { text: "a<b>", isCode: true },
    ]);
  });

  test("a long answer is split in time in line with it", () => {
    const text: string = "`x` ".repeat(100000);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(splitPointText(text)).toHaveLength(200000);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("the names of code, in the pieces a narrow screen wraps them between", () => {
  test("a path at its folders; a function after the dot before it; never inside a part", () => {
    expect(splitCodeNameAtBreaks("src/payments/charge.ts:88")).toEqual([
      "src/",
      "payments/",
      "charge.ts:88",
    ]);
    expect(splitCodeNameAtBreaks("PaymentClient.chargeWithRetries")).toEqual([
      "PaymentClient.",
      "chargeWithRetries",
    ]);
    expect(splitCodeNameAtBreaks("POST /api/charges")).toEqual([
      "POST /",
      "api/",
      "charges",
    ]);
    expect(splitCodeNameAtBreaks("charge_card_with_retries")).toEqual([
      "charge_",
      "card_",
      "with_",
      "retries",
    ]);
    expect(splitCodeNameAtBreaks("Foo::chargeCard")).toEqual([
      "Foo::",
      "chargeCard",
    ]);
  });

  test("a short part after a dot or a colon stays with it: a file's extension, a version, a line", () => {
    for (const name of ["charge.ts", "v2.14.0", "app.js:12", "chargeCard"]) {
      expect(splitCodeNameAtBreaks(name)).toEqual([name]);
    }
    expect(splitCodeNameAtBreaks("")).toEqual([]);
    // A name never ends on an empty piece, nor loses a character.
    expect(splitCodeNameAtBreaks("src/").join("")).toBe("src/");
    expect(splitCodeNameAtBreaks("src/")).toEqual(["src/"]);
  });

  test("every piece joins back into the name", () => {
    for (const name of [
      "GET /api/v2/organizations/:organizationId/payment-methods/:paymentMethodId/verification",
      "services\\checkout\\charge.cs",
      "__init__",
      "a.b.c.dddddd",
    ]) {
      expect(splitCodeNameAtBreaks(name).join("")).toBe(name);
    }
  });

  test("a long name is split in time in line with it, whatever it holds", () => {
    for (const unit of ["a.", "/", "a.bbbbb", ".:", "x"]) {
      const name: string = unit.repeat(Math.ceil(400000 / unit.length));
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          expect(splitCodeNameAtBreaks(name).join("")).toBe(name);
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    }
  });
});
