import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
  isRecommendedDetectionRule,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import { isRuleFromLibraryEntry } from "Common/Utils/SecurityEvent/SecurityTemplateRecords";
import {
  DetectionRuleShape,
  readDetectionRuleShape,
} from "./DetectionRuleShape";

/*
 * The rule library as the page lists it: filtered by category and search,
 * and each entry marked when the project already has its rule - one whose
 * Sigma YAML carries the entry's id, however the team renamed it, or one
 * of its name. The server's Turn on recommended knows a project's rule the
 * same way (SecurityTemplateRecords), so the page never offers to add a
 * rule the server would count as there, and adding twice adds nothing.
 *
 * React-free so the filtering is pinned in a plain test.
 */

/*
 * A rule the project has, as the library reads it: the rule (its name and
 * Sigma YAML), or just its name.
 */
export type ExistingRule = string | Pick<DetectionRule, "name" | "sigmaRuleYaml">;

export interface LibraryRuleView {
  entry: DetectionRuleLibraryEntry;
  isAdded: boolean;
  /*
   * One of the rules "Turn on recommended" adds: they find what most
   * projects can see in data OneUptime already has (sign-ins, shells,
   * cloud changes, web attacks).
   */
  isRecommended: boolean;
}

// The library's own filter beside its categories: the recommended rules.
export type RecommendedFilter = "recommended";

export const RECOMMENDED_FILTER: RecommendedFilter = "recommended";

export type LibraryRuleFilter =
  | DetectionRuleLibraryCategory
  | RecommendedFilter
  | "";

export function isLibraryRuleAdded(
  entry: DetectionRuleLibraryEntry,
  existingRules: ReadonlyArray<ExistingRule>,
): boolean {
  return existingRules.some((rule: ExistingRule): boolean => {
    return isRuleFromLibraryEntry(
      typeof rule === "string" ? { name: rule } : rule,
      entry,
    );
  });
}

// True when every word of the search is in the entry's title, description or data source.
export function matchesLibrarySearch(
  entry: DetectionRuleLibraryEntry,
  search: string,
): boolean {
  const words: Array<string> = search
    .toLowerCase()
    .split(" ")
    .map((word: string): string => {
      return word.trim();
    })
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  if (words.length === 0) {
    return true;
  }

  // A correlation is found by its kind too: "sequence", "first seen".
  const shape: DetectionRuleShape | null = readDetectionRuleShape(
    entry.sigmaRuleYaml,
  );

  const haystack: string = [
    entry.title,
    entry.description,
    entry.dataSource,
    entry.category,
    shape && shape.isCorrelation ? shape.typeTitle : "",
  ]
    .join(" ")
    .toLowerCase();

  return words.every((word: string): boolean => {
    return haystack.includes(word);
  });
}

function matchesLibraryFilter(
  entry: DetectionRuleLibraryEntry,
  filter: LibraryRuleFilter,
): boolean {
  if (!filter) {
    return true;
  }

  if (filter === RECOMMENDED_FILTER) {
    return isRecommendedDetectionRule(entry);
  }

  return entry.category === filter;
}

export function getLibraryRuleViews(data: {
  category: LibraryRuleFilter;
  search: string;
  existingRules: ReadonlyArray<ExistingRule>;
}): Array<LibraryRuleView> {
  return DETECTION_RULE_LIBRARY.filter(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return (
        matchesLibraryFilter(entry, data.category) &&
        matchesLibrarySearch(entry, data.search)
      );
    },
  ).map((entry: DetectionRuleLibraryEntry): LibraryRuleView => {
    return {
      entry,
      isAdded: isLibraryRuleAdded(entry, data.existingRules),
      isRecommended: isRecommendedDetectionRule(entry),
    };
  });
}

// The recommended rules the project has no rule of yet.
export function getRecommendedRulesNotAdded(
  existingRules: ReadonlyArray<ExistingRule>,
): Array<DetectionRuleLibraryEntry> {
  return DETECTION_RULE_LIBRARY.filter(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return (
        isRecommendedDetectionRule(entry) &&
        !isLibraryRuleAdded(entry, existingRules)
      );
    },
  );
}
