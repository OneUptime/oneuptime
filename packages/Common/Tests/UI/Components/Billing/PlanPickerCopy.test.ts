import SubscriptionPlan from "../../../../Types/Billing/SubscriptionPlan";
import {
  BillingPeriod,
  getYearlySaving,
} from "../../../../Types/Billing/SubscriptionPlanPricing";
import {
  CUSTOM_TRIAL_TERMS,
  PlanPickerCopy,
  PlanPickerOptionText,
  PlanTermsText,
  TRIAL_BADGE,
  TRIAL_TERMS,
  getPlanAudience,
  getPlanPickerOptionText,
  getPlanTermsText,
  getYearlySavingText,
} from "../../../../UI/Components/Billing/PlanPicker/PlanPickerCopy";
import {
  PluralTemplate,
  Translator,
  createTranslator,
} from "../../../../UI/Utils/TranslateTemplate";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the plan picker says about each plan, and about what picking it means
 * for money (PlanPickerCopy). Each sentence is held to what OneUptime does:
 *
 *   - plan prices are per user, quoted per month; billed yearly, the year is
 *     charged at once ($20 a month is $240 a year);
 *   - a new project on a plan with a trial starts free for that many days
 *     with no card, and is billed when it ends; one without a trial is
 *     billed from the day it is created;
 *   - Free costs nothing, but its active monitors and telemetry are pay as
 *     you go and need a payment method; on the paid plans they are pay as
 *     you go too;
 *   - Enterprise has no list price: the sales team agrees on one.
 */

const english: Translator = createTranslator(undefined, "en");

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
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

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function translatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, code);
}

const FREE: SubscriptionPlan = new SubscriptionPlan(
  "price_free_month",
  "price_free_year",
  "Free",
  0,
  0,
  1,
  0,
);
const GROWTH: SubscriptionPlan = new SubscriptionPlan(
  "price_growth_month",
  "price_growth_year",
  "Growth",
  22,
  20,
  2,
  14,
);
const SCALE: SubscriptionPlan = new SubscriptionPlan(
  "price_scale_month",
  "price_scale_year",
  "Scale",
  99,
  84,
  3,
  14,
);
const ENTERPRISE: SubscriptionPlan = new SubscriptionPlan(
  "price_enterprise_month",
  "price_enterprise_year",
  "Enterprise",
  -1,
  -1,
  4,
  14,
);

function optionText(
  plan: SubscriptionPlan,
  period: BillingPeriod,
  translator: Translator = english,
): PlanPickerOptionText {
  return getPlanPickerOptionText({ plan, period, translator });
}

function terms(
  plan: SubscriptionPlan,
  period: BillingPeriod,
  translator: Translator = english,
): PlanTermsText {
  return getPlanTermsText({ plan, period, translator });
}

function noTrial(plan: SubscriptionPlan): SubscriptionPlan {
  return new SubscriptionPlan(
    plan.getMonthlyPlanId(),
    plan.getYearlyPlanId(),
    plan.getName(),
    plan.getMonthlySubscriptionAmountInUSD(),
    plan.getYearlySubscriptionAmountInUSD(),
    plan.getPlanOrder(),
    0,
  );
}

function withTrial(plan: SubscriptionPlan, days: number): SubscriptionPlan {
  return new SubscriptionPlan(
    plan.getMonthlyPlanId(),
    plan.getYearlyPlanId(),
    plan.getName(),
    plan.getMonthlySubscriptionAmountInUSD(),
    plan.getYearlySubscriptionAmountInUSD(),
    plan.getPlanOrder(),
    days,
  );
}

describe("PlanPickerCopy: each plan's row", () => {
  it("Free: $0, no unit, no billing line and no trial", () => {
    expect(optionText(FREE, BillingPeriod.Yearly)).toEqual({
      name: "Free",
      audience: "For one person getting started.",
      price: "$0",
      priceUnit: null,
      priceCaption: null,
      trialBadge: null,
    });
    expect(optionText(FREE, BillingPeriod.Monthly).price).toBe("$0");
  });

  it("Growth: the yearly price per user per month, billed yearly, with its trial", () => {
    expect(optionText(GROWTH, BillingPeriod.Yearly)).toEqual({
      name: "Growth",
      audience: "For teams. On-call, workflows, integrations and API access.",
      price: "$20",
      priceUnit: "per user / month",
      priceCaption: "billed yearly",
      trialBadge: "14-day free trial",
    });
  });

  it("Growth: the monthly price, billed monthly", () => {
    expect(optionText(GROWTH, BillingPeriod.Monthly)).toMatchObject({
      price: "$22",
      priceUnit: "per user / month",
      priceCaption: "billed monthly",
    });
  });

  it("Scale: $84 a month billed yearly, $99 billed monthly", () => {
    expect(optionText(SCALE, BillingPeriod.Yearly)).toMatchObject({
      price: "$84",
      audience:
        "For larger teams. SSO, advanced access control and faster support.",
    });
    expect(optionText(SCALE, BillingPeriod.Monthly).price).toBe("$99");
  });

  it("Enterprise: a custom price with no unit and no billing line, and its trial", () => {
    expect(optionText(ENTERPRISE, BillingPeriod.Yearly)).toEqual({
      name: "Enterprise",
      audience: "Custom terms, a dedicated engineer and phone support.",
      price: "Custom Price",
      priceUnit: null,
      priceCaption: null,
      trialBadge: "14-day free trial",
    });
  });

  it("a plan without a trial has no trial pill, and a one-day trial says day", () => {
    expect(optionText(noTrial(GROWTH), BillingPeriod.Yearly).trialBadge).toBe(
      null,
    );
    expect(
      optionText(withTrial(GROWTH, 1), BillingPeriod.Yearly).trialBadge,
    ).toBe("1-day free trial");
    expect(
      optionText(withTrial(GROWTH, 30), BillingPeriod.Yearly).trialBadge,
    ).toBe("30-day free trial");
  });

  it("a plan name OneUptime Cloud does not sell keeps its name and gets no line", () => {
    const other: SubscriptionPlan = new SubscriptionPlan(
      "m",
      "y",
      "Startup",
      9,
      8,
      5,
      0,
    );

    expect(getPlanAudience(other)).toBeNull();
    expect(optionText(other, BillingPeriod.Yearly)).toMatchObject({
      name: "Startup",
      audience: null,
      price: "$8",
    });
  });

  it("keeps a plan's name as it is in every language, as the invoice does", () => {
    for (const code of LANGUAGES) {
      expect(optionText(GROWTH, BillingPeriod.Yearly, translatorFor(code)).name).toBe(
        "Growth",
      );
    }
  });
});

describe("PlanPickerCopy: what picking a plan means for money", () => {
  it("Free: free forever, and active monitors and telemetry need a payment method", () => {
    expect(terms(FREE, BillingPeriod.Yearly)).toEqual({
      headline: "Free forever.",
      details: [
        "Active monitors and telemetry are pay as you go, and need a payment method.",
      ],
    });
    expect(terms(FREE, BillingPeriod.Monthly).headline).toBe("Free forever.");
  });

  it("a paid plan with a trial: free for its days without a card, then the year's price", () => {
    expect(terms(GROWTH, BillingPeriod.Yearly)).toEqual({
      headline: "Free for 14 days, no card needed to start.",
      details: [
        "Then $240 per user, billed yearly.",
        "Active monitors and telemetry are pay as you go.",
      ],
    });
    expect(terms(SCALE, BillingPeriod.Yearly).details[0]).toBe(
      "Then $1,008 per user, billed yearly.",
    );
  });

  it("a paid plan with a trial, monthly: then the month's price", () => {
    expect(terms(GROWTH, BillingPeriod.Monthly).details[0]).toBe(
      "Then $22 per user, billed monthly.",
    );
    expect(terms(SCALE, BillingPeriod.Monthly).details[0]).toBe(
      "Then $99 per user, billed monthly.",
    );
  });

  it("a paid plan without a trial is billed from today", () => {
    expect(terms(noTrial(GROWTH), BillingPeriod.Yearly)).toEqual({
      headline: "$240 per user, billed yearly from today.",
      details: ["Active monitors and telemetry are pay as you go."],
    });
    expect(terms(noTrial(GROWTH), BillingPeriod.Monthly).headline).toBe(
      "$22 per user, billed monthly from today.",
    );
  });

  it("a one-day trial says day", () => {
    expect(terms(withTrial(GROWTH, 1), BillingPeriod.Yearly).headline).toBe(
      "Free for 1 day, no card needed to start.",
    );
    expect(
      terms(withTrial(ENTERPRISE, 1), BillingPeriod.Yearly).headline,
    ).toBe("Free for 1 day.");
  });

  it("Enterprise: its trial, and the sales team agrees on a price - said, not promised silently", () => {
    expect(terms(ENTERPRISE, BillingPeriod.Yearly)).toEqual({
      headline: "Free for 14 days.",
      details: ["Our sales team will contact you to agree on a price."],
    });
    expect(terms(noTrial(ENTERPRISE), BillingPeriod.Monthly)).toEqual({
      headline: "Our sales team will contact you to agree on a price.",
      details: [],
    });
  });

  it("never claims a card is not needed on a plan billed from today", () => {
    for (const plan of [noTrial(GROWTH), noTrial(SCALE)]) {
      for (const period of [BillingPeriod.Monthly, BillingPeriod.Yearly]) {
        const said: PlanTermsText = terms(plan, period);

        expect([said.headline, ...said.details].join(" ")).not.toContain(
          "no card",
        );
      }
    }
  });
});

describe("PlanPickerCopy: the saving beside Yearly", () => {
  it("says 'up to' when the plans save different amounts", () => {
    expect(
      getYearlySavingText({
        saving: getYearlySaving([FREE, GROWTH, SCALE, ENTERPRISE]),
        translator: english,
      }),
    ).toBe("Save up to 15%");
  });

  it("says the percent alone when every paid plan saves it", () => {
    expect(
      getYearlySavingText({
        saving: { percent: 20, isSameForEveryPlan: true },
        translator: english,
      }),
    ).toBe("Save 20%");
  });

  it("says nothing when yearly saves nothing", () => {
    expect(
      getYearlySavingText({ saving: null, translator: english }),
    ).toBeNull();
  });

  it("writes the percent the reader's way", () => {
    expect(
      getYearlySavingText({
        saving: { percent: 15, isSameForEveryPlan: false },
        translator: translatorFor("de"),
      }),
    ).toBe("Bis zu 15 % sparen");
    expect(
      getYearlySavingText({
        saving: { percent: 15, isSameForEveryPlan: false },
        translator: translatorFor("fa"),
      }),
    ).toContain(translatorFor("fa").formatNumber(15));
  });
});

describe("PlanPickerCopy: in every Dashboard language", () => {
  const english_: Record<string, unknown> = readLocale("en");

  const sentences: Array<string> = [
    ...Object.values(PlanPickerCopy),
    ...[FREE, GROWTH, SCALE, ENTERPRISE].map(
      (plan: SubscriptionPlan): string => {
        return getPlanAudience(plan)!;
      },
    ),
  ];

  const plurals: Array<PluralTemplate> = [
    TRIAL_BADGE,
    TRIAL_TERMS,
    CUSTOM_TRIAL_TERMS,
  ];

  it("has every sentence in en.json, as its own key", () => {
    for (const sentence of sentences) {
      expect({ sentence, inEnglish: english_[sentence] }).toEqual({
        sentence,
        inEnglish: sentence,
      });
    }

    for (const plural of plurals) {
      expect(english_[plural.other]).toBe(plural.other);
      expect(english_[`${plural.other}_one`]).toBe(plural.one);
    }
  });

  it("is translated in all 16 languages, keeping every placeholder", () => {
    const placeholder: RegExp = /\{\{\w+\}\}/g;

    for (const code of LANGUAGES) {
      const locale: Record<string, unknown> = readLocale(code);

      for (const sentence of [
        ...sentences,
        ...plurals.map((plural: PluralTemplate): string => {
          return plural.other;
        }),
      ]) {
        const translated: unknown = locale[sentence];

        expect({ code, sentence, isText: typeof translated }).toEqual({
          code,
          sentence,
          isText: "string",
        });
        expect(
          ((translated as string).match(placeholder) || []).sort(),
        ).toEqual((sentence.match(placeholder) || []).sort());

        /*
         * "Plan" reads the same in Spanish, Danish and Swedish, and is on
         * their same-as-English lists; everything else is translated.
         */
        if (sentence !== PlanPickerCopy.label) {
          expect({ code, sentence, untranslated: translated === sentence }).toEqual(
            { code, sentence, untranslated: false },
          );
        }
      }
    }
  });

  it("German reads as the German Dashboard words billing", () => {
    const german: Translator = translatorFor("de");

    expect(optionText(GROWTH, BillingPeriod.Yearly, german)).toEqual({
      name: "Growth",
      audience:
        "Für Teams. Bereitschaft, Arbeitsabläufe, Integrationen und API-Zugriff.",
      price: "$20",
      priceUnit: "pro Benutzer / Monat",
      priceCaption: "jährlich abgerechnet",
      trialBadge: "14 Tage kostenlos testen",
    });
    expect(optionText(ENTERPRISE, BillingPeriod.Yearly, german).price).toBe(
      "Individueller Preis",
    );
    expect(terms(GROWTH, BillingPeriod.Yearly, german)).toEqual({
      headline: "14 Tage kostenlos, zum Start ist keine Karte nötig.",
      details: [
        "Danach $240 pro Benutzer, jährlich abgerechnet.",
        "Aktive Monitore und Telemetrie werden nutzungsbasiert abgerechnet.",
      ],
    });
  });

  it("Russian words a trial right for any number of days", () => {
    const russian: Translator = translatorFor("ru");

    expect(
      optionText(withTrial(GROWTH, 1), BillingPeriod.Yearly, russian)
        .trialBadge,
    ).toBe("Пробный период 1 день");
    expect(
      optionText(withTrial(GROWTH, 21), BillingPeriod.Yearly, russian)
        .trialBadge,
    ).toBe("Пробный период 21 день");
    expect(
      optionText(GROWTH, BillingPeriod.Yearly, russian).trialBadge,
    ).toBe("Пробный период 14 дн.");
  });
});
