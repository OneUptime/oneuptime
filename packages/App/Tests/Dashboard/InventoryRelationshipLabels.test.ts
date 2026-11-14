import { describe, expect, test } from "@jest/globals";
import {
  ExtractedString,
  scanSourceRoots,
  SOURCE_ROOTS,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import { Translator } from "Common/Types/Translator";
import {
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { withoutIsolateMarks } from "Common/Tests/Helpers/IsolateMarks";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  RELATED_TO_RELATIONSHIP_SENTENCE,
  RELATIONSHIP_SENTENCES,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
import {
  RELATED_TO_SENTENCE,
  RELATIONSHIP_ITEM_SLOT,
  RELATIONSHIP_PHRASINGS,
  RelationshipDirection,
  RelationshipPhrasing,
  getRelationshipPhrase,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryRelationshipLabels";

/*
 * A stored edge is directed and its type is named from the source's end:
 * `runs-on` means "the from-entity runs on the to-entity". The relationships
 * list renders edges pointing both ways, so rendering an incoming edge with
 * the stored label states the inverse of the truth — a node claiming it
 * "runs-on" the pod scheduled on it.
 *
 * These tests pin that every type has a distinct reading in each direction,
 * which is the property that makes the inversion impossible.
 *
 * Each reading is a whole sentence about this item with the other item in
 * it as {{item}} (#7326). The incoming readings used to be bare words looked
 * up on their own - "runs", "hosts" - which read as nouns: "hosts" is the
 * host lists' noun too (LogsCrossSignalPivot), so German said "Hosts:
 * checkout-pod" where it meant "this node runs checkout-pod". Every
 * language now words each sentence as a verb, and these tests read the
 * shipped locale files to say so.
 */

const ALL_TYPES: Array<EntityRelationshipType> = Object.values(
  EntityRelationshipType,
);

const DIRECTIONS: Array<RelationshipDirection> = ["outgoing", "incoming"];

const ITEM_PLACEHOLDER: string = `{{${RELATIONSHIP_ITEM_SLOT}}}`;

const ENGLISH: Record<string, string> = readDashboardLocale("en");

// Every sentence the list draws: both readings of each type, and the fallback.
const SENTENCES: Array<string> = [
  ...ALL_TYPES.flatMap((relationshipType: EntityRelationshipType) => {
    return DIRECTIONS.map((direction: RelationshipDirection): string => {
      return getRelationshipPhrase(relationshipType, direction);
    });
  }),
  RELATED_TO_SENTENCE,
];

// A sentence's words, without the other item: what the language says of it.
function wordsAround(sentence: string): string {
  return sentence.split(ITEM_PLACEHOLDER).join(" ").replace(/\s+/g, " ").trim();
}

describe("every relationship type reads in both directions", () => {
  test("there are relationship types to cover", () => {
    expect(ALL_TYPES.length).toBeGreaterThan(0);
    expect(Object.keys(RELATIONSHIP_PHRASINGS).sort()).toEqual(
      [...ALL_TYPES].sort(),
    );
  });

  test.each(ALL_TYPES)(
    "%s has a sentence in both directions, with the other item in it once",
    (relationshipType: EntityRelationshipType) => {
      for (const direction of DIRECTIONS) {
        const phrase: string = getRelationshipPhrase(
          relationshipType,
          direction,
        );

        expect(placeholdersOf(phrase)).toEqual([ITEM_PLACEHOLDER]);
        expect(phrase.split(ITEM_PLACEHOLDER)).toHaveLength(2);
        expect(wordsAround(phrase).length).toBeGreaterThan(0);
        // A hyphen means the raw wire value leaked through the fallback.
        expect(phrase).not.toContain("-");
      }
    },
  );

  test.each(ALL_TYPES)(
    "%s reads differently each way round",
    (relationshipType: EntityRelationshipType) => {
      /*
       * Identical phrasings would mean the direction is not actually being
       * expressed, which is the bug this module exists to prevent.
       */
      expect(getRelationshipPhrase(relationshipType, "outgoing")).not.toBe(
        getRelationshipPhrase(relationshipType, "incoming"),
      );
    },
  );

  test("the readings are all distinct, each way round and across types", () => {
    expect(new Set(SENTENCES).size).toBe(SENTENCES.length);
  });

  test("a few readings are exactly right", () => {
    expect(
      getRelationshipPhrase(EntityRelationshipType.RunsOn, "outgoing"),
    ).toBe("runs on {{item}}");
    expect(
      getRelationshipPhrase(EntityRelationshipType.RunsOn, "incoming"),
    ).toBe("runs {{item}}");
    expect(
      getRelationshipPhrase(EntityRelationshipType.HostedOn, "incoming"),
    ).toBe("hosts {{item}}");
    expect(
      getRelationshipPhrase(EntityRelationshipType.MemberOf, "incoming"),
    ).toBe("has member {{item}}");
    expect(
      getRelationshipPhrase(EntityRelationshipType.DependsOn, "incoming"),
    ).toBe("is depended on by {{item}}");
  });

  test("filled in English, a reading says what it said before, with the item after it", () => {
    const english: Translator = dashboardTranslator("en");

    expect(
      english.translateTemplate(
        getRelationshipPhrase(EntityRelationshipType.RunsOn, "incoming"),
        { [RELATIONSHIP_ITEM_SLOT]: "checkout-pod" },
      ),
    ).toBe("runs checkout-pod");
    expect(
      english.translateTemplate(
        getRelationshipPhrase(EntityRelationshipType.PartOf, "outgoing"),
        { [RELATIONSHIP_ITEM_SLOT]: "prod" },
      ),
    ).toBe("is part of prod");
  });
});

describe("unknown and missing types degrade readably", () => {
  test("an unknown type renders as words, not as a hyphenated slug", () => {
    expect(getRelationshipPhrase("talks-to-sometimes", "outgoing")).toBe(
      "talks to sometimes {{item}}",
    );
    expect(getRelationshipPhrase("talks-to-sometimes", "incoming")).toBe(
      "talks to sometimes {{item}}",
    );
  });

  test("an unknown type is no key: it reads in English in every language, with the item in it", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        sentence: dashboardTranslator(language).translateTemplate(
          getRelationshipPhrase("talks-to", "outgoing"),
          { [RELATIONSHIP_ITEM_SLOT]: "checkout-pod" },
        ),
      }).toEqual({ language, sentence: "talks to checkout-pod" });
    }
  });

  test("an unknown type's braces never make a placeholder of their own", () => {
    expect(getRelationshipPhrase("{{secret}}-of", "outgoing")).toBe(
      "secret of {{item}}",
    );
    expect(
      placeholdersOf(getRelationshipPhrase("x-{{y}}", "incoming")),
    ).toEqual([ITEM_PLACEHOLDER]);
  });

  test("a missing type, or one with no words, falls back to a neutral sentence", () => {
    expect(RELATED_TO_SENTENCE).toBe("is related to {{item}}");
    expect(getRelationshipPhrase(undefined, "outgoing")).toBe(
      RELATED_TO_SENTENCE,
    );
    expect(getRelationshipPhrase("", "incoming")).toBe(RELATED_TO_SENTENCE);
    expect(getRelationshipPhrase("--", "incoming")).toBe(RELATED_TO_SENTENCE);
    expect(getRelationshipPhrase("{}", "outgoing")).toBe(RELATED_TO_SENTENCE);
  });
});

describe("every reading, in every language", () => {
  test("each sentence is a key of the Dashboard's English file", () => {
    expect(
      SENTENCES.filter((sentence: string): boolean => {
        return ENGLISH[sentence] !== sentence;
      }),
    ).toEqual([]);
  });

  test("the bare words the list read before are no keys any more", () => {
    /*
     * "runs" was drawn by nothing else; "hosts" stays, as the host lists'
     * noun, and is no reading of an edge.
     */
    for (const old of [
      "runs on",
      "runs",
      "is a member of",
      "has member",
      "is hosted on",
      "is part of",
      "is an instance of",
      "has instance",
      "depends on",
      "is depended on by",
      "is related to",
    ]) {
      expect({ old, isKey: old in ENGLISH }).toEqual({ old, isKey: false });
    }
    expect(ENGLISH["hosts"]).toBe("hosts");
    expect(SENTENCES).not.toContain("hosts");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every reading its own way, with the other item in it once",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of SENTENCES) {
        const worded: string = words[sentence] || "";

        expect({
          language,
          sentence,
          worded: isWordedInDashboardLocale(sentence, language),
          differs: worded !== sentence,
          placeholders: placeholdersOf(worded),
          once: worded.split(ITEM_PLACEHOLDER).length,
        }).toEqual({
          language,
          sentence,
          worded: true,
          differs: true,
          placeholders: [ITEM_PLACEHOLDER],
          once: 2,
        });
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s reads each type differently each way round",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const relationshipType of ALL_TYPES) {
        const phrasing: RelationshipPhrasing =
          RELATIONSHIP_PHRASINGS[relationshipType];

        expect({
          language,
          relationshipType,
          same: words[phrasing.outgoing] === words[phrasing.incoming],
        }).toEqual({ language, relationshipType, same: false });
      }
    },
  );
});

describe("an incoming edge reads as a verb, never as the host lists' noun (#7326)", () => {
  /*
   * The languages the issue showed, and every other: what an incoming
   * runs-on or hosted-on sentence says around the item is never the word
   * "hosts" says on its own, nor that word with a colon after it.
   */
  const INCOMING_VERBS: Array<string> = [
    getRelationshipPhrase(EntityRelationshipType.RunsOn, "incoming"),
    getRelationshipPhrase(EntityRelationshipType.HostedOn, "incoming"),
  ];

  test.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
    const words: Record<string, string> = readDashboardLocale(language);
    const noun: string = (words["hosts"] || "").toLowerCase();

    expect(noun.length).toBeGreaterThan(0);
    for (const sentence of INCOMING_VERBS) {
      const said: string = wordsAround(words[sentence] || "").toLowerCase();

      expect({ language, sentence, said, isNoun: said === noun }).toEqual({
        language,
        sentence,
        said,
        isNoun: false,
      });
      expect(said.replace(/[:：]$/, "")).not.toBe(noun);
    }
  });

  test.each([
    ["de", "führt checkout-pod aus", "hostet checkout-pod", "Hosts"],
    ["fr", "exécute checkout-pod", "héberge checkout-pod", "hôtes"],
    [
      "fa",
      "checkout-pod را اجرا می‌کند",
      "میزبان checkout-pod است",
      "میزبان‌ها",
    ],
  ])(
    "in %s, this node runs and hosts checkout-pod",
    (language: string, runs: string, hosts: string, noun: string) => {
      const translator: Translator = dashboardTranslator(language);
      const values: Record<string, string> = {
        [RELATIONSHIP_ITEM_SLOT]: "checkout-pod",
      };

      expect(
        withoutIsolateMarks(
          translator.translateTemplate(
            getRelationshipPhrase(EntityRelationshipType.RunsOn, "incoming"),
            values,
          ),
        ),
      ).toBe(runs);
      expect(
        withoutIsolateMarks(
          translator.translateTemplate(
            getRelationshipPhrase(EntityRelationshipType.HostedOn, "incoming"),
            values,
          ),
        ),
      ).toBe(hosts);
      // The host lists keep their noun.
      expect(translator.translateText("hosts")).toBe(noun);
    },
  );

  test("the check tells a noun from a verb (control)", () => {
    // What German said for "this node runs checkout-pod" before #7326.
    expect(wordsAround("Hosts {{item}}").toLowerCase()).toBe(
      (readDashboardLocale("de")["hosts"] || "").toLowerCase(),
    );
  });
});

/*
 * Each reading is a key of its own: no other source draws it, so no noun
 * shares its wording (#7326). Read from every source npm run i18n:extract
 * reads, as the extractor finds them.
 */
describe("each reading is a key no other source draws", () => {
  const LABELS_FILE: string =
    "packages/App/FeatureSet/Dashboard/src/Components/Inventory/InventoryRelationshipLabels.ts";
  const TOPOLOGY_FILE: string =
    "packages/App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta.ts";

  const DRAWN_BY: Map<string, Set<string>> = new Map<string, Set<string>>();
  scanSourceRoots(SOURCE_ROOTS).strings.forEach((found: ExtractedString) => {
    for (const key of [found.text, found.pluralOne]) {
      if (!key) {
        continue;
      }
      const files: Set<string> = DRAWN_BY.get(key) || new Set<string>();
      files.add(found.file);
      DRAWN_BY.set(key, files);
    }
  });

  function filesDrawing(key: string): Array<string> {
    return Array.from(DRAWN_BY.get(key) || []).sort();
  }

  test("the scan reads the Dashboard's sources", () => {
    expect(DRAWN_BY.size).toBeGreaterThan(10000);
  });

  test.each(SENTENCES)(
    "%s is drawn by the relationship readings alone",
    (sentence: string) => {
      expect(filesDrawing(sentence)).toEqual([LABELS_FILE]);
    },
  );

  test("the drawer's sentences are drawn by the topology's module alone", () => {
    for (const sentence of [
      ...Object.values(RELATIONSHIP_SENTENCES),
      RELATED_TO_RELATIONSHIP_SENTENCE,
    ]) {
      expect({ sentence, files: filesDrawing(sentence) }).toEqual({
        sentence,
        files: [TOPOLOGY_FILE],
      });
    }
  });

  test("hosts stays the host lists' noun, drawn elsewhere and never by the readings", () => {
    const files: Array<string> = filesDrawing("hosts");

    expect(files.length).toBeGreaterThan(0);
    expect(files).not.toContain(LABELS_FILE);
    expect(files).toContain(
      "packages/App/FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot.ts",
    );
  });

  test("nothing draws the bare runs any more", () => {
    expect(filesDrawing("runs")).toEqual([]);
    expect(filesDrawing("runs on")).toEqual([]);
    expect(filesDrawing("depends on")).toEqual([]);
  });
});
