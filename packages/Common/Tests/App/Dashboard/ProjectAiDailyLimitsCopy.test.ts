import {
  getProjectAiAdvancedItems,
  getProjectAiAdvancedSummary,
  getProjectAiDailyLimitColumns,
  getProjectAiDailyLimitFieldError,
  getProjectAiDailyLimitsFromItem,
  parseProjectAiDailyUsage,
  PROJECT_AI_DAILY_LIMITS_CARD_KEY,
  ProjectAiDailyLimitsCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
  PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
  ProjectAiDailyLimitValues,
} from "../../../Types/AI/ProjectAiDailyLimits";
import { FoldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The words and decisions of Project Settings → AI Features → More
 * settings, without React: what the folded sentence says for every
 * combination of limits, usage and billing, what the header lists, which
 * fields the card offers, and what the fields refuse - in English and, from
 * the real locale file, in German, so a translated sentence is whole and
 * its numbers are written the reader's way.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function translatorFor(language: string): Translator {
  const dictionary: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  return createTranslator((key: string): string | undefined => {
    return dictionary[key];
  }, language);
}

const NONE: ProjectAiDailyLimitValues = {
  tokenLimit: null,
  spendLimitInUSD: null,
};

function summary(data: {
  limits: ProjectAiDailyLimitValues | null;
  usage?: { usedTokensToday: number; spentTodayInUSDCents: number } | null;
  isBillingEnabled?: boolean;
  translator?: Translator;
}): string | undefined {
  return getProjectAiAdvancedSummary({
    limits: data.limits,
    usage: data.usage === undefined ? null : data.usage,
    isBillingEnabled: Boolean(data.isBillingEnabled),
    translator: data.translator || ENGLISH,
  });
}

describe("the folded sentence", () => {
  test("says nothing before the card has read: an early 'nothing limits AI' could be untrue", () => {
    expect(summary({ limits: null })).toBeUndefined();
    expect(
      summary({
        limits: null,
        usage: { usedTokensToday: 5, spentTodayInUSDCents: 0 },
      }),
    ).toBeUndefined();
  });

  test.each([
    [NONE, false, "Nothing limits how much OneUptime AI uses each day."],
    [
      { tokenLimit: 200000, spendLimitInUSD: null },
      false,
      "At most 200,000 tokens a day.",
    ],
    [{ tokenLimit: 1, spendLimitInUSD: null }, false, "At most 1 token a day."],
    [
      { tokenLimit: null, spendLimitInUSD: 25 },
      true,
      "At most $25 of AI credits a day.",
    ],
    [
      { tokenLimit: 200000, spendLimitInUSD: 25 },
      true,
      "At most 200,000 tokens and $25 of AI credits a day.",
    ],
    // Where AI is not billed, a spend limit is not spoken of.
    [
      { tokenLimit: null, spendLimitInUSD: 25 },
      false,
      "Nothing limits how much OneUptime AI uses each day.",
    ],
    [
      { tokenLimit: 5000, spendLimitInUSD: 25 },
      false,
      "At most 5,000 tokens a day.",
    ],
  ])(
    "%o (billing %s) says what applies: %s",
    (limits: ProjectAiDailyLimitValues, billing: boolean, expected: string) => {
      expect(summary({ limits, isBillingEnabled: billing })).toBe(expected);
    },
  );

  test("adds what AI used today", () => {
    expect(
      summary({
        limits: NONE,
        usage: { usedTokensToday: 45210, spentTodayInUSDCents: 0 },
      }),
    ).toBe(
      "Nothing limits how much OneUptime AI uses each day. Used today: 45,210 tokens.",
    );
    expect(
      summary({
        limits: NONE,
        usage: { usedTokensToday: 1, spentTodayInUSDCents: 0 },
      }),
    ).toBe(
      "Nothing limits how much OneUptime AI uses each day. Used today: 1 token.",
    );
  });

  test("where AI is billed, today's spend too, even with no spend limit", () => {
    expect(
      summary({
        limits: { tokenLimit: 200000, spendLimitInUSD: null },
        usage: { usedTokensToday: 45210, spentTodayInUSDCents: 320 },
        isBillingEnabled: true,
      }),
    ).toBe(
      "At most 200,000 tokens a day. Used today: 45,210 tokens and $3.20 of AI credits.",
    );
  });

  test.each([
    [
      "the token limit",
      { tokenLimit: 1000, spendLimitInUSD: null },
      { usedTokensToday: 1000, spentTodayInUSDCents: 0 },
      false,
      "At most 1,000 tokens a day.",
    ],
    [
      "the spend limit",
      { tokenLimit: null, spendLimitInUSD: 3 },
      { usedTokensToday: 10, spentTodayInUSDCents: 301 },
      true,
      "At most $3 of AI credits a day.",
    ],
  ])(
    "once %s is reached, says AI is paused until midnight UTC instead of the usage",
    (
      _name: string,
      limits: ProjectAiDailyLimitValues,
      usage: { usedTokensToday: number; spentTodayInUSDCents: number },
      billing: boolean,
      first: string,
    ) => {
      expect(summary({ limits, usage, isBillingEnabled: billing })).toBe(
        `${first} Today's limit is reached, so OneUptime AI is paused until midnight UTC.`,
      );
    },
  );

  test("a spend reached where AI is not billed is no limit reached", () => {
    expect(
      summary({
        limits: { tokenLimit: null, spendLimitInUSD: 3 },
        usage: { usedTokensToday: 10, spentTodayInUSDCents: 99_999 },
        isBillingEnabled: false,
      }),
    ).toBe(
      "Nothing limits how much OneUptime AI uses each day. Used today: 10 tokens.",
    );
  });

  test("is one translated sentence after another, numbers written the reader's way (German)", () => {
    const german: Translator = translatorFor("de");

    expect(
      summary({
        limits: { tokenLimit: 200000, spendLimitInUSD: null },
        usage: { usedTokensToday: 45210, spentTodayInUSDCents: 0 },
        translator: german,
      }),
    ).toBe(
      "Höchstens 200.000 Tokens pro Tag. Heute verbraucht: 45.210 Tokens.",
    );

    expect(
      summary({
        limits: NONE,
        usage: { usedTokensToday: 1, spentTodayInUSDCents: 0 },
        translator: german,
      }),
    ).toBe(
      "Nichts begrenzt, wie viel OneUptime AI pro Tag verbraucht. Heute verbraucht: 1 Token.",
    );

    expect(
      summary({
        limits: { tokenLimit: 1000, spendLimitInUSD: null },
        usage: { usedTokensToday: 1000, spentTodayInUSDCents: 0 },
        translator: german,
      }),
    ).toBe(
      "Höchstens 1.000 Tokens pro Tag. Das heutige Limit ist erreicht, daher ist OneUptime AI bis Mitternacht UTC pausiert.",
    );
  });

  // Every language has the sentence whole: never English left inside it.
  test.each([
    ["de"],
    ["fr"],
    ["es"],
    ["it"],
    ["pt"],
    ["nl"],
    ["da"],
    ["no"],
    ["sv"],
    ["ru"],
    ["ja"],
    ["ko"],
    ["zh-CN"],
    ["zh-TW"],
    ["hi"],
    ["fa"],
  ])("%s has its own words for every sentence", (language: string) => {
    const translator: Translator = translatorFor(language);
    const english: string = summary({
      limits: { tokenLimit: 200000, spendLimitInUSD: 25 },
      usage: { usedTokensToday: 45210, spentTodayInUSDCents: 320 },
      isBillingEnabled: true,
    }) as string;
    const translated: string = summary({
      limits: { tokenLimit: 200000, spendLimitInUSD: 25 },
      usage: { usedTokensToday: 45210, spentTodayInUSDCents: 320 },
      isBillingEnabled: true,
      translator,
    }) as string;

    expect(translated).not.toBe(english);
    expect(translated).not.toContain("At most");
    expect(translated).not.toContain("Used today");
    expect(translated).toContain("$25");
    expect(translated).toContain("$3.20");
  });
});

describe("the folded header", () => {
  test("lists the one card, Daily limits, a chip only once a limit is set", () => {
    const unset: Array<FoldedSectionItem> = getProjectAiAdvancedItems(NONE);

    expect(unset).toEqual([
      {
        key: PROJECT_AI_DAILY_LIMITS_CARD_KEY,
        title: ProjectAiDailyLimitsCopy.cardTitle,
        isSet: false,
      },
    ]);
    expect(getProjectAiAdvancedItems(null)[0]!.isSet).toBe(false);
    expect(
      getProjectAiAdvancedItems({ tokenLimit: 5, spendLimitInUSD: null })[0]!
        .isSet,
    ).toBe(true);
    expect(
      getProjectAiAdvancedItems({ tokenLimit: null, spendLimitInUSD: 5 })[0]!
        .isSet,
    ).toBe(true);
  });

  test("the card is titled like the incident and alert pages' daily limits", () => {
    expect(ProjectAiDailyLimitsCopy.cardTitle).toBe("Daily limits");
  });
});

describe("which limits the card offers", () => {
  test("the spend limit only where AI is billed", () => {
    expect(getProjectAiDailyLimitColumns(false)).toEqual([
      PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
    ]);
    expect(getProjectAiDailyLimitColumns(true)).toEqual([
      PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
      PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
    ]);
  });

  test("reads a project the way the server enforces it", () => {
    expect(
      getProjectAiDailyLimitsFromItem({
        item: { aiDailyTokenLimit: 300, aiDailySpendLimitInUSD: 5 },
        isBillingEnabled: false,
      }),
    ).toEqual({ tokenLimit: 300, spendLimitInUSD: null });
    expect(
      getProjectAiDailyLimitsFromItem({
        item: { aiDailyTokenLimit: null, aiDailySpendLimitInUSD: 5 },
        isBillingEnabled: true,
      }),
    ).toEqual({ tokenLimit: null, spendLimitInUSD: 5 });
  });
});

describe("parseProjectAiDailyUsage", () => {
  test("reads POST /ai/daily-usage's answer", () => {
    expect(
      parseProjectAiDailyUsage({
        usedTokensToday: 45210,
        spentTodayInUSDCents: 320,
      }),
    ).toEqual({ usedTokensToday: 45210, spentTodayInUSDCents: 320 });
  });

  test("spend not answered (AI not billed) reads as none", () => {
    expect(
      parseProjectAiDailyUsage({
        usedTokensToday: 7,
        spentTodayInUSDCents: null,
      }),
    ).toEqual({ usedTokensToday: 7, spentTodayInUSDCents: 0 });
  });

  test.each([
    [null],
    [undefined],
    ["text"],
    [[1, 2]],
    [{}],
    [{ usedTokensToday: "45210" }],
    [{ usedTokensToday: -1 }],
    [{ usedTokensToday: Number.NaN }],
    [{ isAIEnabledForProject: true, providers: [] }],
  ])("%p cannot be read: no usage", (answer: unknown) => {
    expect(parseProjectAiDailyUsage(answer)).toBeNull();
  });
});

describe("getProjectAiDailyLimitFieldError", () => {
  function error(
    column: "aiDailyTokenLimit" | "aiDailySpendLimitInUSD",
    value: unknown,
  ): string | null {
    return getProjectAiDailyLimitFieldError({
      column,
      value,
      fieldTitle:
        column === "aiDailyTokenLimit"
          ? "Daily AI Token Limit"
          : "Daily AI Spend Limit (USD)",
      translator: ENGLISH,
    });
  }

  test.each([[null], [undefined], [""], ["   "], ["1"], ["200000"], [200000]])(
    "a token limit of %p may be saved",
    (value: unknown) => {
      expect(error("aiDailyTokenLimit", value)).toBeNull();
    },
  );

  test.each([["0"], ["-5"], ["2.5"], ["1e3"], ["abc"], ["3000000000"], [0]])(
    "a token limit of %p is refused",
    (value: unknown) => {
      expect(error("aiDailyTokenLimit", value)).toBe(
        "Daily AI Token Limit must be a whole number from 1 to 2,000,000,000. Leave it empty for no limit.",
      );
    },
  );

  test("a spend limit is held to whole dollars from 1 to 1,000,000", () => {
    expect(error("aiDailySpendLimitInUSD", "25")).toBeNull();
    expect(error("aiDailySpendLimitInUSD", "1000001")).toBe(
      "Daily AI Spend Limit (USD) must be a whole number from 1 to 1,000,000. Leave it empty for no limit.",
    );
  });

  test("is said in the reader's language, the field named in it", () => {
    expect(
      getProjectAiDailyLimitFieldError({
        column: "aiDailyTokenLimit",
        value: "0",
        fieldTitle: "Daily AI Token Limit",
        translator: translatorFor("de"),
      }),
    ).toBe(
      "Tägliches KI-Token-Limit muss eine ganze Zahl von 1 bis 2.000.000.000 sein. Leer lassen für kein Limit.",
    );
  });
});
