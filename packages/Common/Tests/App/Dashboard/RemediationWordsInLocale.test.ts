import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { TRACK_RECORD_RUN_TITLES } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationTrackRecordLine";
import {
  RemediationTrackRecord,
  RemediationTrackRecordOutcome,
} from "../../../Types/AutoRemediation/RemediationTrackRecord";
import {
  describeRemediationTrackRecord,
  TRACK_RECORD_DID_NOT_WORK,
  TRACK_RECORD_MIXED,
  TRACK_RECORD_WORKED,
} from "../../../Types/AutoRemediation/RemediationTrackRecordWords";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  CLOUD_CHANGE_SENTENCES,
  CLOUD_CONCURRENCY_SENTENCE,
  CLOUD_KIND_WORDS,
  CLOUD_SCALE_SENTENCES,
  describeCloudChange,
} from "../../../Utils/AiRemediation/CloudChangeWords";

/*
 * EVERY WORD A FIX'S CHANGES ARE SHOWN WITH IS EVERY LANGUAGE'S OWN.
 *
 * A cloud change in plain words - each sentence and each kind of resource
 * it names - and how the same change went before, with the words a run's
 * link says on hover, read from the Dashboard's locale files themselves: a
 * key that lost its translation, kept the English (where the language does
 * not keep a product's name as it is) or lost a placeholder is caught. And
 * the sentences come out whole in the reader's language - the kind
 * translated with the sentence, the count in the language's own form,
 * Russian's 21 in its "one" form.
 */

const LOCALES_DIR: string = path.resolve(
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

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

const PLURALS: Array<PluralTemplate> = [
  CLOUD_CONCURRENCY_SENTENCE,
  ...Object.values(CLOUD_SCALE_SENTENCES.out),
  ...Object.values(CLOUD_SCALE_SENTENCES.in),
  TRACK_RECORD_WORKED,
  TRACK_RECORD_DID_NOT_WORK,
  TRACK_RECORD_MIXED,
];

// Each key, with the English it holds: a plural's "one" under key + "_one".
const WORDS: Array<[string, string]> = [
  ...Object.values(CLOUD_KIND_WORDS),
  ...Object.values(CLOUD_CHANGE_SENTENCES),
  ...Object.values(TRACK_RECORD_RUN_TITLES),
]
  .map((word: string): [string, string] => {
    return [word, word];
  })
  .concat(
    PLURALS.flatMap((template: PluralTemplate): Array<[string, string]> => {
      return [
        [template.other, template.other],
        [`${template.other}_one`, template.one],
      ];
    }),
  );

// A product's name a language keeps as English writes it.
const KEPT_AS_ENGLISH: Readonly<Record<string, ReadonlyArray<string>>> = {
  "*": ["Container App"],
  hi: ["Compute Engine VM"],
  ja: ["Compute Engine VM"],
  ko: ["Compute Engine VM"],
};

const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

function translatorFor(language: string): Translator {
  const words: Record<string, string> = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, language);
}

const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";

function trackRecord(
  worked: number,
  didNotWork: number,
): RemediationTrackRecord {
  return {
    workedCount: worked,
    didNotWorkCount: didNotWork,
    runs: [
      {
        subjectKind: "incident",
        subjectId: "0193c0de-aaaa-4aaa-8bbb-00000000001a",
        subjectNumber: "INC-41",
        ranAt: "2026-10-28T10:00:00.000Z",
        outcome: RemediationTrackRecordOutcome.Worked,
      },
    ],
  };
}

describe("English holds every word under its own key", () => {
  test("there is something to check", () => {
    expect(WORDS.length).toBeGreaterThan(50);
  });

  test.each(WORDS)("%s", (key: string, english: string) => {
    expect(ENGLISH[key]).toBe(english);
  });
});

describe.each(LANGUAGES)("the %s locale", (language: string) => {
  const words: Record<string, string> = readLocale(language);
  const kept: ReadonlyArray<string> = [
    ...(KEPT_AS_ENGLISH["*"] || []),
    ...(KEPT_AS_ENGLISH[language] || []),
  ];

  test.each(WORDS)(
    "words %s its own way, with the same placeholders",
    (key: string, english: string) => {
      const translated: string | undefined = words[key];

      expect(translated).toBeDefined();
      expect(translated!.trim().length).toBeGreaterThan(0);
      expect({
        key,
        translated: translated !== english || kept.includes(key),
      }).toEqual({ key, translated: true });
      expect(placeholders(translated!)).toEqual(placeholders(english));
    },
  );
});

describe("the sentences come out whole in the reader's language", () => {
  test("German: the kind is translated with the sentence, the count written the German way", () => {
    expect(
      describeCloudChange({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud scale-out ${ECS} --count 1000`,
        translator: translatorFor("de"),
      })?.sentence,
    ).toBe("ECS-Dienst web: auf 1.000 Tasks hochskalieren");
    expect(
      describeRemediationTrackRecord(trackRecord(3, 0), translatorFor("de")),
    ).toBe("Hat alle 3 Male geholfen, die es hier zuvor lief");
    expect(
      describeRemediationTrackRecord(trackRecord(2, 1), translatorFor("de")),
    ).toBe("Hat 2 der 3 Male geholfen, die es hier zuvor lief");
  });

  test("Russian: 21 is in its one form, 22 in the general one, each reading right", () => {
    expect(
      describeRemediationTrackRecord(trackRecord(21, 0), translatorFor("ru")),
    ).toBe("Помогало каждый раз, когда запускалось здесь раньше");
    expect(
      describeRemediationTrackRecord(trackRecord(22, 0), translatorFor("ru")),
    ).toBe("Помогло при каждом запуске здесь раньше, запусков: 22");
    expect(
      describeCloudChange({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud scale-out ${ECS} --count 21`,
        translator: translatorFor("ru"),
      })?.sentence,
    ).toBe("Сервис ECS web: увеличить до 21 задачи");
  });

  test("Japanese and Persian put the resource where their grammar wants it", () => {
    expect(
      describeCloudChange({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud restart-service ${ECS}`,
        translator: translatorFor("ja"),
      })?.sentence,
    ).toBe("ECS サービス web を再起動");
    expect(
      describeCloudChange({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud restart-service ${ECS}`,
        translator: translatorFor("fa"),
      })?.sentence,
    ).toBe("سرویس ECS web را دوباره راه‌اندازی کنید");
  });

  test("an Azure virtual machine is named by its product, in English and German", () => {
    const vm: string =
      "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/vm-1";

    expect(
      describeCloudChange({
        resourceType: AiResourceType.AzureSubscription,
        command: `cloud reboot-instance ${vm}`,
      })?.sentence,
    ).toBe("Reboot the Azure virtual machine vm-1");
    expect(
      describeCloudChange({
        resourceType: AiResourceType.AzureSubscription,
        command: `cloud reboot-instance ${vm}`,
        translator: translatorFor("de"),
      })?.sentence,
    ).toBe("Azure-VM vm-1: neu starten");
  });
});
