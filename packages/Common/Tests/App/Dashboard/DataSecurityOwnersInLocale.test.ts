import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DATA_SECURITY_KIND_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsData";
import {
  DATA_SECURITY_AI_ASK_REASON_SENTENCES,
  OwnersToReviewCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityAiCopy";
import DataSecurityAiProposal from "../../../Models/DatabaseModels/DataSecurityAiProposal";
import {
  DataSecurityAiAskReason,
  DataSecurityAiProposalKind,
} from "../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityAiFeature,
  DataSecurityAiFeatureInfo,
  getDataSecurityAiFeatureInfo,
} from "../../../Types/DataSecurity/DataSecurityAiFeatures";
import { PluralTemplate } from "../../../Types/Translator";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * EVERY WORD OF ONEUPTIME AI'S OWNER PROPOSALS (#10374) IS EVERY
 * LANGUAGE'S OWN.
 *
 * Owners to review on Data Security → AI and Data Stores, the owner kinds
 * on AI Results, what Settings → OneUptime AI says the feature sends and
 * keeps, why an owner always waits for a person, and the proposal model's
 * description - read from the Dashboard's locale files themselves, so a key
 * that kept the English or lost a placeholder is caught, and so is the
 * sentence the always-asks reason said before owners were added to it.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [...DASHBOARD_LANGUAGES];

// Japanese, Korean and Chinese read no "one" form: theirs may stay as is.
const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

const FEATURE: DataSecurityAiFeatureInfo = getDataSecurityAiFeatureInfo(
  DataSecurityAiFeature.ProposeStoreOwners,
);

const SENTENCES: Array<string> = [
  OwnersToReviewCopy.title,
  OwnersToReviewCopy.description,
  OwnersToReviewCopy.proposal,
  OwnersToReviewCopy.owners,
  OwnersToReviewCopy.howSure,
  OwnersToReviewCopy.sure,
  OwnersToReviewCopy.fairlySure,
  OwnersToReviewCopy.notSure,
  OwnersToReviewCopy.cannotOpen,
  OwnersToReviewCopy.evidenceDisagrees,
  OwnersToReviewCopy.changeAndApprove,
  OwnersToReviewCopy.changeTitle,
  OwnersToReviewCopy.changeDescription,
  OwnersToReviewCopy.ownersField,
  OwnersToReviewCopy.bulkApproveMessage,
  OwnersToReviewCopy.noLongerWaiting,
  DATA_SECURITY_KIND_LABELS[DataSecurityAiProposalKind.SetStoreOwners],
  DATA_SECURITY_KIND_LABELS[DataSecurityAiProposalKind.CreateOwnerRule],
  DATA_SECURITY_AI_ASK_REASON_SENTENCES[DataSecurityAiAskReason.AlwaysAsks],
  FEATURE.title,
  FEATURE.startedBy,
  ...FEATURE.sends,
  ...FEATURE.neverSends,
  FEATURE.keeps,
  new DataSecurityAiProposal().tableDescription!,
];

const PLURALS: Array<PluralTemplate> = [
  OwnersToReviewCopy.stores,
  OwnersToReviewCopy.rules,
  OwnersToReviewCopy.ruleWouldSet,
  OwnersToReviewCopy.ruleAlreadyOwned,
  OwnersToReviewCopy.bulkApproveTitle,
];

// What the page said before an owner was one of the changes that always ask.
const RETIRED: Array<string> = [
  "A change that deletes data or pages people always waits for a person.",
  "What OneUptime AI proposes for a Data Security issue: what will change, why, how it will be proven and how to undo it, and whether it waits for a person, was made, dismissed or undone. Written by OneUptime; approved, dismissed and undone through Data Security's own routes, with the person's own permission for the change.",
];

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(/\{\{[a-zA-Z]+\}\}/g) || [])).sort();
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

describe("English holds every sentence under its own words", () => {
  test("there is something to check", () => {
    expect(SENTENCES.length).toBeGreaterThan(20);
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(17);
  });

  test.each(SENTENCES)("%s", (sentence: string) => {
    expect(ENGLISH[sentence]).toBe(sentence);
  });

  test.each(PLURALS)("the plural %j", (plural: PluralTemplate) => {
    expect(ENGLISH[plural.other]).toBe(plural.other);
    expect(ENGLISH[`${plural.other}_one`]).toBe(plural.one);
  });

  test("an owner is one of the changes that always ask", () => {
    expect(
      DATA_SECURITY_AI_ASK_REASON_SENTENCES[DataSecurityAiAskReason.AlwaysAsks],
    ).toBe(
      "A change that deletes data, pages people or adds an owner always waits for a person.",
    );
  });
});

describe.each(["en", ...LANGUAGES])("the %s locale", (language: string) => {
  const words: Record<string, string> =
    language === "en" ? ENGLISH : LOCALES[language]!;

  test("keeps no sentence the owner proposals replaced", () => {
    expect(
      RETIRED.filter((sentence: string): boolean => {
        return words[sentence] !== undefined;
      }),
    ).toEqual([]);
  });
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  const words: Record<string, string> = LOCALES[language]!;

  test("every sentence is the language's own, with the English placeholders", () => {
    for (const sentence of SENTENCES) {
      const translated: string | undefined = words[sentence];

      expect({
        sentence,
        isTranslated: Boolean(translated) && translated !== sentence,
      }).toEqual({ sentence, isTranslated: true });
      expect({ sentence, placeholders: placeholders(translated!) }).toEqual({
        sentence,
        placeholders: placeholders(sentence),
      });
    }
  });

  test("every plural is the language's own, with the English placeholders", () => {
    for (const plural of PLURALS) {
      expect(words[plural.other]).toBeDefined();
      expect(words[plural.other]).not.toBe(plural.other);
      expect(placeholders(words[plural.other]!)).toEqual(
        placeholders(plural.other),
      );

      if (!WITHOUT_ONE_FORM.includes(language)) {
        expect(words[`${plural.other}_one`]).toBeDefined();
        expect(words[`${plural.other}_one`]).not.toBe(plural.one);
        expect(placeholders(words[`${plural.other}_one`]!)).toEqual(
          placeholders(plural.one),
        );
      }
    }
  });
});
