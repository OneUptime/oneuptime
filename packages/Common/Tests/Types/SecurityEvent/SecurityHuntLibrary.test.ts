import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Query from "../../../Types/BaseDatabase/Query";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import { DetectionRuleDataKind } from "../../../Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY_CATEGORIES,
  DetectionRuleLibraryCategory,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  SECURITY_HUNT_DESCRIPTION_MAX_LENGTH,
  SECURITY_HUNT_NAME_MAX_LENGTH,
  getSecurityHuntProblems,
  isSecurityHuntTimeRange,
} from "../../../Types/SecurityEvent/SecurityHunt";
import {
  SECURITY_HUNT_LIBRARY,
  SecurityHuntLibraryEntry,
  getSecurityHuntLibraryCategories,
  getSecurityHuntLibraryEntry,
  isSecurityHuntLibraryId,
} from "../../../Types/SecurityEvent/SecurityHuntLibrary";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { ENRICHMENT_MATCHED_ATTRIBUTE } from "../../../Types/SecurityEvent/ThreatIntelConstants";
import {
  SecurityEventSearchFilters,
  parseSecurityEventSearch,
} from "../../../Utils/SecurityEvent/SecurityEventSearch";
import {
  buildSecurityHuntQuery,
  getSecurityHuntWatchlistNames,
} from "../../../Utils/SecurityEvent/SecurityHuntSearch";
import { describe, expect, test } from "@jest/globals";

/*
 * THE HUNT LIBRARY'S STARTERS (Types/SecurityEvent/SecurityHuntLibrary).
 *
 * Each starter is one click from being a hunt of the project's own, so
 * each must already be one that saves: a name and description a hunt may
 * have, a search that is all filters - no stray word read as a search of
 * the message - written against the columns every source is normalized
 * into, or the source attributes it names with @, and compiled by the very
 * read a scheduled run makes (buildSecurityHuntQuery). Its id is kept on
 * the hunt (SecurityHunt.libraryHuntId), so ids are stable, distinct, and
 * fit the column.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

// The attribute keys a search names with @, as written: `@userIdentity.type:Root`.
function attributeKeysWritten(searchQuery: string): Array<string> {
  const keys: Array<string> = [];

  for (const token of searchQuery.split(/\s+/)) {
    if (!token.startsWith("@")) {
      continue;
    }

    const colon: number = token.indexOf(":");

    if (colon > 1) {
      keys.push(token.slice(1, colon));
    }
  }

  return keys;
}

describe("the starters", () => {
  test("there are starters in every category but Data security, each id distinct, stable and short enough to keep on a hunt", () => {
    const ids: Array<string> = SECURITY_HUNT_LIBRARY.map(
      (entry: SecurityHuntLibraryEntry): string => {
        return entry.id;
      },
    );

    expect(SECURITY_HUNT_LIBRARY.length).toBeGreaterThanOrEqual(15);
    expect(new Set(ids).size).toBe(ids.length);

    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(id.length).toBeLessThanOrEqual(ColumnLength.ShortText);
    }
  });

  test.each(
    SECURITY_HUNT_LIBRARY.map(
      (entry: SecurityHuntLibraryEntry): [string, SecurityHuntLibraryEntry] => {
        return [entry.id, entry];
      },
    ),
  )(
    "%s saves as a hunt: its name, description and search",
    (_id: string, entry: SecurityHuntLibraryEntry) => {
      expect(entry.title.trim()).toBe(entry.title);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.title.length).toBeLessThanOrEqual(
        SECURITY_HUNT_NAME_MAX_LENGTH,
      );
      expect(entry.description.length).toBeLessThanOrEqual(
        SECURITY_HUNT_DESCRIPTION_MAX_LENGTH,
      );
      // A sentence, as the Rule Library's descriptions are.
      expect(entry.description).toMatch(/^[A-Z].*\.$/);
      expect(
        getSecurityHuntProblems({
          name: entry.title,
          description: entry.description,
          searchQuery: entry.searchQuery,
          filters: {},
        }),
      ).toEqual([]);
      expect(isSecurityHuntTimeRange(entry.timeRange)).toBe(true);
      expect(DETECTION_RULE_LIBRARY_CATEGORIES).toContain(entry.category);

      if (entry.dataKind !== null) {
        expect(Object.values(DetectionRuleDataKind)).toContain(entry.dataKind);
      }
    },
  );

  test.each(
    SECURITY_HUNT_LIBRARY.map(
      (entry: SecurityHuntLibraryEntry): [string, SecurityHuntLibraryEntry] => {
        return [entry.id, entry];
      },
    ),
  )(
    "%s searches only by filters: every field a column, every @ an attribute it names, no stray word",
    (_id: string, entry: SecurityHuntLibraryEntry) => {
      const parsed: SecurityEventSearchFilters = parseSecurityEventSearch(
        entry.searchQuery,
      );
      const written: Array<string> = attributeKeysWritten(entry.searchQuery);

      // A word left over would search every event's message for it.
      expect(parsed.freeText).toBeNull();
      /*
       * A field the search bar does not know becomes an attribute: so the
       * attributes read are exactly the ones written with @, and every other
       * field is a column.
       */
      expect(Object.keys(parsed.attributes).sort()).toEqual(
        [...written].sort(),
      );
      expect(
        Object.keys(parsed.fields).length +
          Object.keys(parsed.attributes).length,
      ).toBeGreaterThan(0);
      // A starter reads no watchlist a project may not have.
      expect(getSecurityHuntWatchlistNames(entry.searchQuery)).toEqual([]);
    },
  );

  test.each(
    SECURITY_HUNT_LIBRARY.map(
      (entry: SecurityHuntLibraryEntry): [string, SecurityHuntLibraryEntry] => {
        return [entry.id, entry];
      },
    ),
  )(
    "%s compiles into the read a scheduled run makes, over the project and the window",
    (_id: string, entry: SecurityHuntLibraryEntry) => {
      const query: Query<SecurityEvent> = buildSecurityHuntQuery({
        projectId: PROJECT_ID,
        searchQuery: entry.searchQuery,
        filters: {},
        startTime: new Date("2026-10-28T10:00:00.000Z"),
        endTime: new Date("2026-10-29T10:00:00.000Z"),
      });
      const parsed: SecurityEventSearchFilters = parseSecurityEventSearch(
        entry.searchQuery,
      );
      const read: Record<string, unknown> = query as unknown as Record<
        string,
        unknown
      >;

      expect(read["projectId"]).toEqual(PROJECT_ID);
      expect(read["time"]).toBeDefined();

      for (const column of Object.keys(parsed.fields)) {
        expect(read[column]).toBeDefined();
      }

      if (Object.keys(parsed.attributes).length > 0) {
        expect(read["attributes"]).toBeDefined();
      }
    },
  );

  test("the searches read the values OneUptime stamps: a threat intel match, a request that reached the database", () => {
    expect(
      getSecurityHuntLibraryEntry("threat-intel-matches")!.searchQuery,
    ).toBe(`@${ENRICHMENT_MATCHED_ATTRIBUTE}:true`);
    expect(
      parseSecurityEventSearch(
        getSecurityHuntLibraryEntry("attacks-that-reached-the-database")!
          .searchQuery,
      ).fields["requestOutcome"],
    ).toBe(SecurityEventRequestOutcome.ReachedDatabase);
  });

  test("only a starter that reads any event - a threat intel match is stamped on whatever it matched - names no kind of events", () => {
    expect(
      SECURITY_HUNT_LIBRARY.filter((entry: SecurityHuntLibraryEntry) => {
        return entry.dataKind === null;
      }).map((entry: SecurityHuntLibraryEntry): string => {
        return entry.id;
      }),
    ).toEqual(["threat-intel-matches"]);
  });
});

describe("the library's categories", () => {
  test("in the Rule Library's order, and only those with starters: Data security has none", () => {
    expect(getSecurityHuntLibraryCategories()).toEqual([
      DetectionRuleLibraryCategory.Identity,
      DetectionRuleLibraryCategory.Endpoint,
      DetectionRuleLibraryCategory.Cloud,
      DetectionRuleLibraryCategory.Network,
      DetectionRuleLibraryCategory.Web,
      DetectionRuleLibraryCategory.Kubernetes,
    ]);
  });

  test("the starters are listed category by category, as the filter offers them", () => {
    const order: Array<DetectionRuleLibraryCategory> =
      getSecurityHuntLibraryCategories();
    const positions: Array<number> = SECURITY_HUNT_LIBRARY.map(
      (entry: SecurityHuntLibraryEntry): number => {
        return order.indexOf(entry.category);
      },
    );

    expect(positions).toEqual(
      [...positions].sort((a: number, b: number): number => {
        return a - b;
      }),
    );
  });
});

describe("finding a starter by its id", () => {
  test("a starter's id finds it; anything else finds none", () => {
    expect(getSecurityHuntLibraryEntry("encoded-powershell")?.title).toBe(
      "Encoded PowerShell",
    );
    expect(getSecurityHuntLibraryEntry("Encoded-PowerShell")).toBeUndefined();
    expect(getSecurityHuntLibraryEntry("")).toBeUndefined();
    expect(getSecurityHuntLibraryEntry(undefined)).toBeUndefined();
    expect(getSecurityHuntLibraryEntry(null)).toBeUndefined();
  });

  test("an id is a library id only when it is a starter's, as text", () => {
    expect(isSecurityHuntLibraryId("kubernetes-pod-shells")).toBe(true);
    expect(isSecurityHuntLibraryId("constructor")).toBe(false);
    expect(isSecurityHuntLibraryId("__proto__")).toBe(false);
    expect(isSecurityHuntLibraryId("my-own-hunt")).toBe(false);
    expect(isSecurityHuntLibraryId(42)).toBe(false);
    expect(isSecurityHuntLibraryId(null)).toBe(false);
  });
});
