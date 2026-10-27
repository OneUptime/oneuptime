import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ENTITY_LOOKUP_BUTTON,
  ENTITY_LOOKUP_DESCRIPTION,
  ENTITY_LOOKUP_HOURS,
  ENTITY_LOOKUP_NOT_SEEN,
  ENTITY_LOOKUP_PLACEHOLDER,
  ENTITY_LOOKUP_TEST_IDS,
  ENTITY_LOOKUP_TITLE,
  ENTITY_RISK_EMPTY_TITLE,
  ENTITY_RISK_TABLE_DESCRIPTION,
  OPEN_IN_CORRELATE,
  RISKIEST_ENTITIES_DESCRIPTION,
  RISKIEST_ENTITIES_READ_FAILED,
  RISKIEST_ENTITIES_TEST_IDS,
  RISKIEST_ENTITIES_TITLE,
  RISKIEST_ENTITIES_VIEW_ALL,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import {
  DETECTION_RULES_EMPTY_DESCRIPTION,
  DETECTION_RULES_EMPTY_TITLE,
  OPEN_RULE_LIBRARY,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityDetectionsCopy";
import { TRANSLATED_LOCALES } from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { isSaidInLocale, readDashboardLocale } from "./SecurityLocaleSentences";

/*
 * The words about entities on Security Events, and where an empty Detection
 * Rules list leads (the Rule Library). React-free parts, pinned in a plain
 * test.
 *
 * "Riskiest" means one thing: Entity Risk's scores. The Overview's
 * Riskiest Entities is the top of Entity Risk's list, and the Entities page
 * - which ranked values by how many findings named them, a second riskiest
 * list - folded into Entity Risk, with its Look Up an Entity under the list.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(DASHBOARD_SRC, relativePath), "utf8");
}

describe("the Overview's Riskiest Entities", () => {
  test("say they are Entity Risk's ranking, over Entity Risk's week, and what a reader does next", () => {
    expect(RISKIEST_ENTITIES_TITLE).toBe("Riskiest Entities");
    expect(RISKIEST_ENTITIES_DESCRIPTION).toContain("as Entity Risk ranks them");
    expect(RISKIEST_ENTITIES_DESCRIPTION).toContain("in the last 7 days");
    // The week is Entity Risk's own.
    expect(ENTITY_RISK_TABLE_DESCRIPTION).toContain("in the last 7 days");
    expect(RISKIEST_ENTITIES_DESCRIPTION).toContain("Open one to see why.");
    // Never the old count of findings.
    expect(RISKIEST_ENTITIES_DESCRIPTION).not.toContain("most findings");
    expect(RISKIEST_ENTITIES_DESCRIPTION).not.toContain("findings name");
  });

  test("offer the whole list in the count Entity Risk lists, in both plural forms", () => {
    expect(RISKIEST_ENTITIES_VIEW_ALL).toEqual({
      one: "View {{count}} entity",
      other: "View all {{count}} entities",
    });
  });

  test("an empty list says what Entity Risk's empty list says", () => {
    expect(ENTITY_RISK_EMPTY_TITLE).toBe(
      "No user, host or address has any risk yet.",
    );
    expect(RISKIEST_ENTITIES_READ_FAILED).toBe(
      "We could not load the riskiest entities.",
    );
  });

  test("have test ids of their own", () => {
    expect(Object.values(RISKIEST_ENTITIES_TEST_IDS)).toEqual([
      "security-overview-riskiest-entities",
      "security-overview-riskiest-entities-all",
      "security-overview-riskiest-entities-error",
      "security-overview-riskiest-entities-try-again",
    ]);
  });

  test("the Overview draws them from the overview's own answer, under the title the docs name", () => {
    const overview: string = source("Pages/SecurityEvents/Overview.tsx");

    expect(overview).toContain('title="Riskiest Entities"');
    expect(overview).toContain("description={RISKIEST_ENTITIES_DESCRIPTION}");
    expect(overview).toContain("riskiest={overview.riskiestEntities}");
    // No second read of a ranking by findings.
    expect(overview).not.toContain("getTopEntities");
    expect(overview).not.toContain("findingCount");
  });
});

describe("Look Up an Entity, under Entity Risk's list", () => {
  test("reads any value across 30 days of security events", () => {
    expect(ENTITY_LOOKUP_HOURS).toBe(30 * 24);
    expect(ENTITY_LOOKUP_TITLE).toBe("Look Up an Entity");
    expect(ENTITY_LOOKUP_DESCRIPTION).toContain("domain or file hash");
    expect(ENTITY_LOOKUP_DESCRIPTION).toContain("over the last 30 days");
    expect(ENTITY_LOOKUP_NOT_SEEN).toBe("Not seen in the last 30 days.");
    expect(ENTITY_LOOKUP_BUTTON).toBe("Look Up");
    expect(OPEN_IN_CORRELATE).toBe("Open in Correlate");
    expect(ENTITY_LOOKUP_TEST_IDS).toEqual({
      card: "security-entity-lookup",
      input: "security-entity-lookup-input",
      result: "security-entity-lookup-result",
    });
  });

  test("is on Entity Risk, under its list, and the Entities page is gone", () => {
    const entityRisk: string = source("Pages/SecurityEvents/EntityRisk.tsx");

    expect(entityRisk).toContain("<EntityLookupCard />");
    expect(entityRisk.indexOf("<EntityLookupCard />")).toBeGreaterThan(
      entityRisk.indexOf("<ModelTable<SecurityEntityRisk>"),
    );
    expect(
      fs.existsSync(path.resolve(DASHBOARD_SRC, "Pages/SecurityEvents/Entities.tsx")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(
          DASHBOARD_SRC,
          "Components/SecurityEvents/SecurityEntitiesCopy.ts",
        ),
      ),
    ).toBe(false);
  });
});

describe("the words", () => {
  const SENTENCES: Array<string> = [
    RISKIEST_ENTITIES_TITLE,
    ENTITY_RISK_EMPTY_TITLE,
    ENTITY_LOOKUP_TITLE,
    ENTITY_LOOKUP_DESCRIPTION,
    ENTITY_LOOKUP_PLACEHOLDER,
    ENTITY_LOOKUP_BUTTON,
    ENTITY_LOOKUP_NOT_SEEN,
    OPEN_IN_CORRELATE,
    DETECTION_RULES_EMPTY_TITLE,
    DETECTION_RULES_EMPTY_DESCRIPTION,
    OPEN_RULE_LIBRARY,
  ];

  test("where an empty rules list goes", () => {
    expect(DETECTION_RULES_EMPTY_DESCRIPTION).toContain("Rule Library");
    // A heading: no full stop.
    expect(DETECTION_RULES_EMPTY_TITLE.endsWith(".")).toBe(false);
  });

  test("are in every Dashboard locale, said in the language", () => {
    for (const locale of TRANSLATED_LOCALES) {
      const entries: Record<string, unknown> = readDashboardLocale(locale);

      for (const sentence of [
        ...SENTENCES,
        RISKIEST_ENTITIES_DESCRIPTION,
        RISKIEST_ENTITIES_READ_FAILED,
        RISKIEST_ENTITIES_VIEW_ALL.other,
        `${RISKIEST_ENTITIES_VIEW_ALL.other}_one`,
      ]) {
        expect([locale, sentence, typeof entries[sentence]]).toEqual([
          locale,
          sentence,
          "string",
        ]);
      }

      // The Overview's new sentences, said in the language.
      for (const sentence of [
        RISKIEST_ENTITIES_DESCRIPTION,
        RISKIEST_ENTITIES_READ_FAILED,
        RISKIEST_ENTITIES_VIEW_ALL.other,
      ]) {
        expect([
          locale,
          sentence,
          isSaidInLocale(locale, sentence, entries[sentence]),
        ]).toEqual([locale, sentence, true]);
      }

      // "View all 9 entities" keeps its count, wherever the language puts it.
      expect([
        locale,
        String(entries[RISKIEST_ENTITIES_VIEW_ALL.other]).includes(
          "{{count}}",
        ),
      ]).toEqual([locale, true]);
    }
  });

  test("the lookup's example keeps its values as written, in every language", () => {
    for (const locale of TRANSLATED_LOCALES) {
      const entries: Record<string, unknown> = readDashboardLocale(locale);

      expect([
        locale,
        isSaidInLocale(
          locale,
          ENTITY_LOOKUP_DESCRIPTION,
          entries[ENTITY_LOOKUP_DESCRIPTION],
        ),
      ]).toEqual([locale, true]);

      for (const value of ["alice@example.com", "web-01", "203.0.113.7"]) {
        expect([locale, String(entries[ENTITY_LOOKUP_PLACEHOLDER])]).toEqual([
          locale,
          expect.stringContaining(value),
        ]);
      }
    }
  });
});
