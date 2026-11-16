import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import i18next from "i18next";
import {
  INVENTORY_TYPE_DESCRIPTORS,
  InventoryTypeDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTypeCatalog";
import {
  canHaveLinkedResource,
  describeMissingLink,
  INVENTORY_LINKED_SIGNALS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/LinkedResource";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * AN INVENTORY ITEM'S EMPTY STATE, IN EVERY LANGUAGE (#7950).
 *
 * An inventory item that never carries incidents, alerts or maintenance
 * windows of its own says why on its tab: "Incidents are raised against
 * services, hosts and Kubernetes clusters. This Kubernetes pod does not
 * carry its own - look at the service or host it belongs to, which you can
 * find under Connections." Only Arabic, Persian and Japanese worded it: on
 * an otherwise German or Korean page the tab said why it was empty in
 * English. Both sentences - the one that names the item's type and the one
 * for an item of no known type - are worded in every language now, each
 * with the type and the signal in the reader's words. A language with
 * grammatical gender says "this item (pod)", so its words agree whatever
 * the type is.
 */

const ITEM_SENTENCE: string =
  "{{signal}} are raised against services, hosts and Kubernetes clusters. This item does not carry its own — look at the service or host it belongs to, which you can find under Connections.";
const TYPE_SENTENCE: string =
  "{{signal}} are raised against services, hosts and Kubernetes clusters. This {{type}} does not carry its own — look at the service or host it belongs to, which you can find under Connections.";

// A lower-case letter at the very start of a sentence.
const LOWER_CASE_START: RegExp = /^\p{Ll}/u;

// What the English sentence says, which no other language's may.
const ENGLISH_WORDS: ReadonlyArray<string> = [
  "are raised against",
  "does not carry its own",
  "which you can find under Connections",
];

const UNLINKED_TYPES: ReadonlyArray<InventoryTypeDescriptor> =
  INVENTORY_TYPE_DESCRIPTORS.filter(
    (descriptor: InventoryTypeDescriptor): boolean => {
      return !canHaveLinkedResource(descriptor.entityType);
    },
  );

const englishLeftIn: (sentence: string) => Array<string> = (
  sentence: string,
): Array<string> => {
  return ENGLISH_WORDS.filter((words: string): boolean => {
    return sentence.includes(words);
  });
};

describe("both sentences, in every Dashboard language's file", () => {
  test("they are the two keys the empty state looks up", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(english[ITEM_SENTENCE]).toBe(ITEM_SENTENCE);
    expect(english[TYPE_SENTENCE]).toBe(TYPE_SENTENCE);
    expect(
      describeMissingLink(EntityType.KubernetesPod, "incidents"),
    ).toContain("This Kubernetes pod does not carry its own");
    expect(describeMissingLink(undefined, "incidents")).toContain(
      "This item does not carry its own",
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words both, with their placeholders",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of [ITEM_SENTENCE, TYPE_SENTENCE]) {
        expect({ language, key, worded: words[key] !== key }).toEqual({
          language,
          key,
          worded: true,
        });
        expect(englishLeftIn(words[key] || "")).toEqual([]);
      }

      expect(words[ITEM_SENTENCE]).toContain("{{signal}}");
      expect(words[ITEM_SENTENCE]).not.toContain("{{type}}");
      expect(words[TYPE_SENTENCE]).toContain("{{signal}}");
      expect(words[TYPE_SENTENCE]).toContain("{{type}}");
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s: every type and every signal, drawn in a sentence with no English left",
    (language: string) => {
      for (const signal of INVENTORY_LINKED_SIGNALS) {
        for (const descriptor of UNLINKED_TYPES) {
          const sentence: string = withoutIsolateMarks(
            describeMissingLink(
              descriptor.entityType,
              signal,
              dashboardTranslator(language),
            ),
          );

          expect({
            language,
            type: descriptor.label,
            signal,
            english: englishLeftIn(sentence),
            startsWithLowerCase: LOWER_CASE_START.test(sentence),
          }).toEqual({
            language,
            type: descriptor.label,
            signal,
            english: [],
            startsWithLowerCase: false,
          });
        }
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s: an item of no known type, every signal, drawn in a sentence with no English left",
    (language: string) => {
      for (const signal of INVENTORY_LINKED_SIGNALS) {
        const sentence: string = withoutIsolateMarks(
          describeMissingLink(undefined, signal, dashboardTranslator(language)),
        );

        expect({
          language,
          signal,
          english: englishLeftIn(sentence),
          startsWithLowerCase: LOWER_CASE_START.test(sentence),
          unfilled: sentence.includes("{{"),
        }).toEqual({
          language,
          signal,
          english: [],
          startsWithLowerCase: false,
          unfilled: false,
        });
      }
    },
  );

  /*
   * Nothing capitalises the sentence once the Translator has filled it
   * (#7861): the Translator gives a term its capital where the sentence
   * starts with it (#7772). These languages open the sentence with the
   * signal, which their file writes in lower case, as it reads in the
   * middle of a sentence - so the capital is the Translator's.
   */
  test.each([
    ["da", "Advarsler registreres"],
    ["nl", "Waarschuwingen worden"],
    ["no", "Varsler registreres"],
    ["ru", "Оповещения регистрируются"],
    ["sv", "Larm registreras"],
  ])(
    "%s gives the signal, lower case in its file, its capital where it opens the sentence: %s",
    (language: string, opening: string) => {
      const word: string = readDashboardLocale(language)["alerts"] || "";

      expect(LOWER_CASE_START.test(word)).toBe(true);

      for (const entityType of [EntityType.KubernetesPod, undefined]) {
        expect(
          withoutIsolateMarks(
            describeMissingLink(
              entityType,
              "alerts",
              dashboardTranslator(language),
            ),
          ).startsWith(`${opening} `),
        ).toBe(true);
      }
    },
  );

  /*
   * Where a language's demonstrative agrees with its noun, the sentence
   * names the item and puts the type in brackets: the words agree
   * whatever the type's gender.
   */
  test.each([
    ["de", "Dieses Element (Kubernetes-Pod)"],
    ["fr", "Cet élément (pod Kubernetes)"],
    ["es", "este elemento (pod de Kubernetes)"],
    ["it", "questo elemento (pod Kubernetes)"],
    ["pt", "este item (pod do Kubernetes)"],
    ["ru", "У этого элемента (под Kubernetes)"],
    ["nl", "Dit item (Kubernetes-pod)"],
    ["sv", "Det här objektet (Kubernetes-podd)"],
    ["no", "Dette elementet (Kubernetes-pod)"],
    ["da", "Dette element (Kubernetes-pod)"],
  ])(
    "%s says this item, then the type: %s",
    (language: string, named: string) => {
      expect(
        withoutIsolateMarks(
          describeMissingLink(
            EntityType.KubernetesPod,
            "incidents",
            dashboardTranslator(language),
          ),
        ),
      ).toContain(named);
    },
  );
});

/*
 * Through the global i18next the Dashboard sets up, which describeMissingLink
 * reads when no translator is handed to it: a pod's empty state in German
 * and in Korean.
 */
describe("through the Dashboard's i18next, for a pod in German and Korean", () => {
  beforeAll(async () => {
    await i18next.init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        de: { translation: readDashboardLocale("de") },
        ko: { translation: readDashboardLocale("ko") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test("English reads as it always has (the control)", async () => {
    await i18next.changeLanguage("en");

    expect(describeMissingLink(EntityType.KubernetesPod, "incidents")).toBe(
      "Incidents are raised against services, hosts and Kubernetes clusters. This Kubernetes pod does not carry its own — look at the service or host it belongs to, which you can find under Connections.",
    );
  });

  test("German: both sentences, the signal and the type in German", async () => {
    await i18next.changeLanguage("de");

    const withType: string = withoutIsolateMarks(
      describeMissingLink(EntityType.KubernetesPod, "incidents"),
    );
    const withoutType: string = withoutIsolateMarks(
      describeMissingLink(undefined, "alerts"),
    );

    expect(withType).toBe(
      "Vorfälle werden für Dienste, Hosts und Kubernetes-Cluster erfasst. Dieses Element (Kubernetes-Pod) hat keine eigenen — sehen Sie sich den Dienst oder Host an, zu dem es gehört; Sie finden ihn unter Verbindungen.",
    );
    expect(withoutType).toBe(
      "Warnungen werden für Dienste, Hosts und Kubernetes-Cluster erfasst. Dieses Element hat keine eigenen — sehen Sie sich den Dienst oder Host an, zu dem es gehört; Sie finden ihn unter Verbindungen.",
    );
  });

  test("Korean: both sentences, the signal and the type in Korean", async () => {
    await i18next.changeLanguage("ko");

    const withType: string = withoutIsolateMarks(
      describeMissingLink(EntityType.KubernetesPod, "maintenance windows"),
    );
    const withoutType: string = withoutIsolateMarks(
      describeMissingLink(undefined, "incidents"),
    );

    expect(withType).toContain("유지 관리 시간대");
    expect(withType).toContain("이 Kubernetes 파드에는 따로 발생하지 않습니다");
    expect(withoutType).toContain("인시던트");
    expect(withoutType).toContain("이 항목에는 따로 발생하지 않습니다");

    for (const sentence of [withType, withoutType]) {
      expect(englishLeftIn(sentence)).toEqual([]);
      expect(sentence).toContain("연결에서 찾을 수 있습니다");
    }
  });
});
