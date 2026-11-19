import { matchesSearch } from "../utils/search";

/*
 * The values the filter sheet offers in each section - the project's states,
 * severities, labels, monitors, teams and people - and which of them a
 * section shows at a time. Pure, so the rules are unit tested
 * (filterOptions.test.ts).
 */

export interface FilterOption {
  id: string;
  label: string;
  // The value's own colour, as the project set it (a state's, a label's).
  dotColor?: string;
  // More to search by and to read out: a person's email.
  detail?: string;
}

// One section's values, and whether they are still on their way.
export interface FilterOptionList {
  options: Array<FilterOption>;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  // What the section says when the project has none: "No labels yet."
  emptyMessage?: string;
}

export interface FilterSheetOptions {
  people: FilterOptionList;
  teams: FilterOptionList;
  states: FilterOptionList;
  severities: FilterOptionList;
  labels: FilterOptionList;
  monitors: FilterOptionList;
  monitorTypes: FilterOptionList;
}

export const NO_OPTIONS: FilterOptionList = {
  options: [],
  isLoading: false,
  isError: false,
};

export interface VisibleOptions {
  options: Array<FilterOption>;
  // Matches left out to keep the section short; search finds them.
  hiddenCount: number;
  // Whether the section has enough values to need a search of its own.
  searchable: boolean;
}

/*
 * Up to `limit` values a section shows: the picked ones first, always, so a
 * choice never disappears from under the reader's finger; then the values
 * matching the search, in the project's own order. A section with more
 * values than it shows gets a search.
 */
export function getVisibleOptions(
  options: Array<FilterOption>,
  selectedIds: Array<string>,
  search: string,
  limit: number = 16,
): VisibleOptions {
  const selected: Set<string> = new Set(selectedIds);
  const searchable: boolean = options.length > limit;
  const term: string = searchable ? search.trim() : "";

  const picked: Array<FilterOption> = options.filter(
    (option: FilterOption): boolean => {
      return selected.has(option.id);
    },
  );
  const matching: Array<FilterOption> = options.filter(
    (option: FilterOption): boolean => {
      return (
        !selected.has(option.id) &&
        (term.length === 0 ||
          matchesSearch(term, [option.label, option.detail]))
      );
    },
  );
  const room: number = Math.max(0, limit - picked.length);
  return {
    options: [...picked, ...matching.slice(0, room)],
    hiddenCount: Math.max(0, matching.length - room),
    searchable: searchable,
  };
}

// The names of the picked values, in the order the project lists them.
export function getSelectedNames(
  options: Array<FilterOption>,
  selectedIds: Array<string>,
): Array<string> {
  const selected: Set<string> = new Set(selectedIds);
  return options
    .filter((option: FilterOption): boolean => {
      return selected.has(option.id);
    })
    .map((option: FilterOption): string => {
      return option.label;
    });
}
