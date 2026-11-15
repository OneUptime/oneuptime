import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import i18next from "i18next";
import {
  INVENTORY_TYPE_DESCRIPTORS,
  InventoryTypeDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTypeCatalog";
import {
  canHaveLinkedResource,
  describeMissingLink,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/LinkedResource";
import EntityType from "../../../Types/Telemetry/EntityType";
import { toSentenceTerm } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE INVENTORY'S EMPTY STATE KEEPS A TYPE'S LATIN CAPITALS IN JAPANESE,
 * PERSIAN AND ARABIC (#7951).
 *
 * An inventory item that can never own incidents says so with its type in
 * the middle of the sentence, as a term the Translator cases for the middle
 * of one (#7862). Japanese, Persian and Arabic word the sentence, and their
 * scripts have no letter case, but their words for a type carry Latin ones:
 * Japanese "Kubernetes Pod", Persian "Deployment در Kubernetes", Arabic "Pod
 * في Kubernetes". The Translator lowered those as it lowers an English
 * label's title case, and a Japanese reader read "このKubernetes podには".
 * Each now reads as its file writes it, through the Dashboard's files and
 * through the global i18next the Dashboard sets up.
 */

const sentenceIn: (language: string, entityType: string) => string = (
  language: string,
  entityType: string,
): string => {
  return withoutIsolateMarks(
    describeMissingLink(entityType, "incidents", dashboardTranslator(language)),
  );
};

// The types the empty state names: those that never link.
const UNLINKED_TYPES: ReadonlyArray<InventoryTypeDescriptor> =
  INVENTORY_TYPE_DESCRIPTORS.filter(
    (descriptor: InventoryTypeDescriptor): boolean => {
      return !canHaveLinkedResource(descriptor.entityType);
    },
  );

// The languages whose files word the sentence, rather than keep it English.
const SENTENCE_LANGUAGES: ReadonlyArray<string> = DASHBOARD_LANGUAGES.filter(
  (language: string): boolean => {
    return (
      sentenceIn(language, EntityType.Container) !==
      describeMissingLink(EntityType.Container, "incidents")
    );
  },
);

// A character outside ASCII, and a letter of any script.
const NON_ASCII_PATTERN: RegExp = /[^\p{ASCII}]/gu;
const LETTER_PATTERN: RegExp = /\p{L}/u;

/*
 * Whether a language's script has letter case, read from the letters of its
 * own Dashboard file: most of the letters outside ASCII are of a script
 * without case in Japanese, and have a capital and a small form in French
 * or Russian.
 */
const isWrittenWithoutLetterCase: (language: string) => boolean = (
  language: string,
): boolean => {
  let cased: number = 0;
  let caseless: number = 0;

  for (const value of Object.values(readDashboardLocale(language))) {
    for (const letter of String(value).match(NON_ASCII_PATTERN) || []) {
      if (!LETTER_PATTERN.test(letter)) {
        continue;
      }

      if (letter.toLowerCase() !== letter.toUpperCase()) {
        cased++;
      } else {
        caseless++;
      }
    }
  }

  return caseless > cased;
};

// What a type's label reads as in `language`'s file, as the file writes it.
const typeWordIn: (language: string, label: string) => string = (
  language: string,
  label: string,
): string => {
  return (readDashboardLocale(language)[label] || label).trim();
};

describe("the inventory's empty state in Japanese, Persian and Arabic", () => {
  test("those three word the sentence", () => {
    expect(SENTENCE_LANGUAGES).toEqual(
      expect.arrayContaining(["ja", "fa", "ar"]),
    );
  });

  // The sentences the issue was filed for, and their neighbours.
  test.each([
    [
      "ja",
      EntityType.KubernetesPod,
      "このKubernetes Podには独自のものはありません",
    ],
    [
      "ja",
      EntityType.KubernetesNamespace,
      "このKubernetes Namespaceには独自のものはありません",
    ],
    [
      "ja",
      EntityType.KubernetesDeployment,
      "このKubernetes Deploymentには独自のものはありません",
    ],
    [
      "fa",
      EntityType.KubernetesDeployment,
      "این Deployment در Kubernetes موارد خودش را ندارد",
    ],
    [
      "fa",
      EntityType.KubernetesNamespace,
      "این Namespace در Kubernetes موارد خودش را ندارد",
    ],
    [
      "fa",
      EntityType.VMwareDatastore,
      "این Datastore VMware موارد خودش را ندارد",
    ],
    ["ar", EntityType.KubernetesPod, "لا يحمل هذا العنصر (Pod في Kubernetes)"],
    [
      "ar",
      EntityType.KubernetesDeployment,
      "لا يحمل هذا العنصر (Deployment في Kubernetes)",
    ],
  ])(
    "%s names a %s as its file does",
    (language: string, entityType: string, named: string) => {
      expect(sentenceIn(language, entityType)).toContain(named);
    },
  );

  test("a caseless or noun-capitalizing language names each type exactly as written", () => {
    for (const language of SENTENCE_LANGUAGES) {
      if (language !== "de" && !isWrittenWithoutLetterCase(language)) {
        continue;
      }

      for (const descriptor of UNLINKED_TYPES) {
        const word: string = typeWordIn(language, descriptor.label);

        expect(toSentenceTerm(word, language)).toBe(
          word.split(/\s+/).join(" "),
        );
      }
    }
  });

  test("a Japanese pod is never a lower-case pod", () => {
    expect(sentenceIn("ja", EntityType.KubernetesPod)).not.toMatch(
      /Kubernetes pod/,
    );
  });

  /*
   * Every type the sentence names, in each language that words it: the
   * type reads exactly as the language's file writes it where its script
   * has no letter case (or, as German, keeps its nouns' capitals), and as
   * the middle of a sentence writes it elsewhere - since every language
   * words the sentence (#7950), French reads "Cet élément (pod
   * Kubernetes)", its brand names' capitals kept.
   */
  test.each(SENTENCE_LANGUAGES)(
    "%s names every type exactly as its file writes it",
    (language: string) => {
      const misnamed: Array<string> = UNLINKED_TYPES.filter(
        (descriptor: InventoryTypeDescriptor): boolean => {
          return !sentenceIn(language, descriptor.entityType).includes(
            toSentenceTerm(typeWordIn(language, descriptor.label), language),
          );
        },
      ).map((descriptor: InventoryTypeDescriptor): string => {
        return `${descriptor.label}: ${sentenceIn(language, descriptor.entityType)}`;
      });

      expect(UNLINKED_TYPES.length).toBeGreaterThanOrEqual(40);
      expect(misnamed).toEqual([]);
    },
  );

  test("English still lowers the label, and keeps the names", () => {
    expect(sentenceIn("en", EntityType.KubernetesPod)).toContain(
      "This Kubernetes pod does not carry its own",
    );
    expect(sentenceIn("en", EntityType.KubernetesDeployment)).toContain(
      "This Kubernetes deployment does not carry its own",
    );
    expect(sentenceIn("en", EntityType.IoTDevice)).toContain(
      "This IoT device does not carry its own",
    );
  });
});

/*
 * Each language of the Dashboard keeps a term as its file writes it exactly
 * when its script has no letter case (or it capitalizes its nouns, as
 * German does). A language added to the Dashboard is checked the day it is
 * added: Hebrew or Thai would fail here until the Translator knows them.
 */
describe("every Dashboard language", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s cases a term the way its script does",
    (language: string) => {
      const keepsLabels: boolean =
        language === "de" || isWrittenWithoutLetterCase(language);

      expect(toSentenceTerm("Kubernetes Pod", language)).toBe(
        keepsLabels ? "Kubernetes Pod" : "Kubernetes pod",
      );
    },
  );

  test("the scripts read from the files are the ones the languages use", () => {
    const caseless: Array<string> = DASHBOARD_LANGUAGES.filter(
      isWrittenWithoutLetterCase,
    );

    expect([...caseless].sort()).toEqual(
      ["ar", "fa", "hi", "ja", "ko", "zh-CN", "zh-TW"].sort(),
    );
  });
});

/*
 * The Dashboard translates outside React through the global i18next
 * instance (getGlobalTranslator), which describeMissingLink reads when no
 * translator is handed to it.
 */
describe("through the global i18next, as the Dashboard draws it", () => {
  beforeAll(async () => {
    await i18next.init({
      lng: "ja",
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        ja: { translation: readDashboardLocale("ja") },
        fa: { translation: readDashboardLocale("fa") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test("Japanese reads このKubernetes Podには", async () => {
    await i18next.changeLanguage("ja");

    const sentence: string = withoutIsolateMarks(
      describeMissingLink(EntityType.KubernetesPod, "incidents"),
    );

    expect(sentence).toContain("このKubernetes Podには独自のものはありません");
    expect(sentence).not.toContain("Kubernetes pod");
  });

  test("Persian reads این Deployment در Kubernetes", async () => {
    await i18next.changeLanguage("fa");

    expect(
      withoutIsolateMarks(
        describeMissingLink(EntityType.KubernetesDeployment, "incidents"),
      ),
    ).toContain("این Deployment در Kubernetes موارد خودش را ندارد");
  });

  test("English reads This Kubernetes pod", async () => {
    await i18next.changeLanguage("en");

    expect(
      describeMissingLink(EntityType.KubernetesPod, "incidents"),
    ).toContain("This Kubernetes pod does not carry its own");
  });
});
