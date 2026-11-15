import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
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
  sentenceForRelationship,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";

/*
 * THE TOPOLOGY DRAWER'S RELATIONSHIP SENTENCES (#7326).
 *
 * The details drawer of the maps and the infrastructure explorer lists
 * what a resource is connected to as sentences naming both ends. It used
 * to glue them from English pieces - "{{from}} " + the verb + " {{to}}" -
 * with English word order in every language, and only "runs on" and
 * "depends on" were keys: "member of", "hosted on", "part of" and
 * "instance of" read in English in all seventeen languages. Each type is
 * one sentence of the locale now, which a language words with both ends
 * where its grammar puts them. (The drawer rendered in five languages:
 * Common's EntityDetailPanelRelationshipsInLocale.test.tsx.)
 */

const ALL_TYPES: Array<EntityRelationshipType> = Object.values(
  EntityRelationshipType,
);

const ENDS: Array<string> = ["{{from}}", "{{to}}"];

const SENTENCES: Array<string> = [
  ...ALL_TYPES.map((relationshipType: EntityRelationshipType): string => {
    return sentenceForRelationship(relationshipType);
  }),
  RELATED_TO_RELATIONSHIP_SENTENCE,
];

const ENGLISH: Record<string, string> = readDashboardLocale("en");

const PANEL: string = fs
  .readFileSync(
    path.join(
      __dirname,
      "../../FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel.tsx",
    ),
    "utf8",
  )
  .replace(/\s+/g, " ");

describe("each relationship type is one sentence", () => {
  test("every type has its own, naming both ends once, source first", () => {
    expect(Object.keys(RELATIONSHIP_SENTENCES).sort()).toEqual(
      [...ALL_TYPES].sort(),
    );
    expect(new Set(SENTENCES).size).toBe(SENTENCES.length);

    for (const sentence of SENTENCES) {
      expect(placeholdersOf(sentence)).toEqual(ENDS.slice().sort());
      expect(sentence.startsWith("{{from}} ")).toBe(true);
      expect(sentence.endsWith(" {{to}}")).toBe(true);
      expect(sentence).not.toContain("-");
    }
  });

  test("a few read exactly so", () => {
    expect(sentenceForRelationship(EntityRelationshipType.RunsOn)).toBe(
      "{{from}} runs on {{to}}",
    );
    expect(sentenceForRelationship(EntityRelationshipType.MemberOf)).toBe(
      "{{from}} is a member of {{to}}",
    );
    expect(sentenceForRelationship(EntityRelationshipType.HostedOn)).toBe(
      "{{from}} is hosted on {{to}}",
    );
  });

  test("a type this Dashboard does not know reads as its words between the ends", () => {
    expect(sentenceForRelationship("talks-to")).toBe(
      "{{from}} talks to {{to}}",
    );
    expect(sentenceForRelationship("{{x}}-of")).toBe("{{from}} x of {{to}}");
    expect(
      dashboardTranslator("de").translateTemplate(
        sentenceForRelationship("talks-to"),
        { from: "web", to: "db" },
      ),
    ).toBe("web talks to db");
  });

  test("an edge with no type, or one with no words, is related", () => {
    expect(RELATED_TO_RELATIONSHIP_SENTENCE).toBe(
      "{{from}} is related to {{to}}",
    );
    expect(sentenceForRelationship(undefined)).toBe(
      RELATED_TO_RELATIONSHIP_SENTENCE,
    );
    expect(sentenceForRelationship("")).toBe(RELATED_TO_RELATIONSHIP_SENTENCE);
    expect(sentenceForRelationship("-")).toBe(RELATED_TO_RELATIONSHIP_SENTENCE);
  });
});

describe("every sentence, in every language", () => {
  test("each is a key of the Dashboard's English file", () => {
    expect(
      SENTENCES.filter((sentence: string): boolean => {
        return ENGLISH[sentence] !== sentence;
      }),
    ).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each its own way, with both ends in it once",
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
          fromOnce: worded.split("{{from}}").length,
          toOnce: worded.split("{{to}}").length,
        }).toEqual({
          language,
          sentence,
          worded: true,
          differs: true,
          placeholders: ENDS.slice().sort(),
          fromOnce: 2,
          toOnce: 2,
        });
      }
    },
  );

  test.each([
    ["de", "web hängt von orders-db ab"],
    ["fa", "web به orders-db وابسته است"],
    ["ja", "web は orders-db に依存"],
  ])("%s: %s", (language: string, sentence: string) => {
    expect(
      withoutIsolateMarks(
        dashboardTranslator(language).translateTemplate(
          sentenceForRelationship(EntityRelationshipType.DependsOn),
          { from: "web", to: "orders-db" },
        ),
      ),
    ).toBe(sentence);
  });
});

describe("the drawer draws the sentence whole", () => {
  test("filled with the edge's source and target, whichever end it is about", () => {
    expect(PANEL).toContain(
      'const ends: { from: string; to: string } = row.direction === "out" ? { from: displayName, to: otherLabel } : { from: otherLabel, to: displayName };',
    );
    expect(PANEL).toContain(
      "<TranslatedSentence template={sentenceForRelationship(row.relationshipType)} slots={{ from: <IsolatedText text={ends.from} breaksLikeAName={true} />, to: <IsolatedText text={ends.to} breaksLikeAName={true} />, }} />",
    );
  });

  /*
   * Each name is drawn in an isolate inside the sentence, so a pod's
   * hyphens stay where they are in an Arabic one, and the sentence reads
   * the way its own words do: a type this Dashboard does not know is
   * worded in English, and on a Persian page it kept its English order.
   */
  test("the sentence takes its direction from its own words, never a name's", () => {
    expect(PANEL).toContain(
      '<span dir="auto" data-testid="entity-connection-sentence"> <TranslatedSentence',
    );
  });

  test("the arrow that opens the other end is the shared one, pointing on in a line read right to left", () => {
    expect(PANEL).toContain(
      "{sentence} <DirectionArrow isDecorative={true} />",
    );
    expect(PANEL).not.toContain("rtl:-scale-x-100");
  });

  test("never glues a verb between two names", () => {
    expect(PANEL).not.toContain("labelForRelationship");
    expect(PANEL).not.toMatch(/`\$\{displayName\} \$\{verb\}/);
    expect(PANEL).not.toMatch(/`\$\{otherLabel\} \$\{verb\}/);
  });
});
