import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";

/*
 * The rule library as the page lists it: filtered by category and search,
 * and each entry marked when the project already has a rule of its name -
 * the name is what an added rule keeps, and what a person sees if they
 * renamed it to something else they meant to.
 *
 * React-free so the filtering is pinned in a plain test.
 */

export interface LibraryRuleView {
  entry: DetectionRuleLibraryEntry;
  isAdded: boolean;
}

function normalizeName(name: string): string {
  return (name || "").trim().toLowerCase();
}

export function isLibraryRuleAdded(
  entry: DetectionRuleLibraryEntry,
  existingRuleNames: Array<string>,
): boolean {
  const title: string = normalizeName(entry.title);

  return existingRuleNames.some((name: string): boolean => {
    return normalizeName(name) === title;
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

  const haystack: string = [
    entry.title,
    entry.description,
    entry.dataSource,
    entry.category,
  ]
    .join(" ")
    .toLowerCase();

  return words.every((word: string): boolean => {
    return haystack.includes(word);
  });
}

export function getLibraryRuleViews(data: {
  category: DetectionRuleLibraryCategory | "";
  search: string;
  existingRuleNames: Array<string>;
}): Array<LibraryRuleView> {
  return DETECTION_RULE_LIBRARY.filter(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return (
        (!data.category || entry.category === data.category) &&
        matchesLibrarySearch(entry, data.search)
      );
    },
  ).map((entry: DetectionRuleLibraryEntry): LibraryRuleView => {
    return {
      entry,
      isAdded: isLibraryRuleAdded(entry, data.existingRuleNames),
    };
  });
}
