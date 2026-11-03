import {
  DATA_KIND_TITLES,
  RULE_LIBRARY_CATEGORY_TITLES,
} from "../RuleLibraryCopy";
import {
  LibraryDataFilter,
  LibraryRuleDataStatus,
  LibraryStatusFilter,
  getLibraryRuleDataStatus,
  isNothingSent,
} from "../RuleLibraryUtil";
import { getSecurityEventsRoute } from "./HuntsModel";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import { SecurityEventKindsSeen } from "Common/Types/SecurityEvent/DetectionRuleDataKind";
import { DetectionRuleLibraryCategory } from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import { SecurityHuntSchedule } from "Common/Types/SecurityEvent/SecurityHunt";
import {
  SECURITY_HUNT_LIBRARY,
  SecurityHuntLibraryEntry,
  getSecurityHuntLibraryCategories,
} from "Common/Types/SecurityEvent/SecurityHuntLibrary";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { SECURITY_EVENTS_RANGE_PARAM } from "../SecurityEventsTimeRange";

/*
 * THE HUNT LIBRARY, as its page lists it (Pages/SecurityEvents/HuntLibrary):
 * each starter (Common/Types/SecurityEvent/SecurityHuntLibrary) with what a
 * security engineer scans a library for - whether the project has it as a
 * hunt already, and whether the project sends the events it reads - and the
 * filters and the search over them, kept in the page's address as the Rule
 * Library keeps its own (the same parameter names, the same chips).
 *
 * A starter counts as added when the project has a hunt that keeps its id
 * (SecurityHunt.libraryHuntId), however the team renamed or changed it.
 *
 * React-free, so the whole of it is pinned in plain tests.
 */

// A hunt of the project's, as the library reads it.
export interface ExistingHunt {
  id: string;
  libraryHuntId: string | null;
}

// One starter as the page draws it.
export interface HuntLibraryView {
  entry: SecurityHuntLibraryEntry;
  // The project's hunt of it, to open; null while it has none.
  addedHuntId: string | null;
  // Whether the project sends the events it reads; a starter that reads any event follows any event.
  dataStatus: LibraryRuleDataStatus;
}

export interface HuntLibraryFilters {
  // A category, or "" for all of them.
  category: DetectionRuleLibraryCategory | "";
  data: LibraryDataFilter;
  status: LibraryStatusFilter;
  search: string;
}

export const NO_HUNT_LIBRARY_FILTERS: HuntLibraryFilters = {
  category: "",
  data: LibraryDataFilter.Any,
  status: LibraryStatusFilter.Any,
  search: "",
};

// The address's parameters, named as the Rule Library names its own.
export const HUNT_LIBRARY_QUERY_KEYS: {
  category: string;
  data: string;
  status: string;
  search: string;
} = {
  category: "category",
  data: "data",
  status: "status",
  search: "search",
};

export function readHuntLibraryFilters(
  queryString: string,
): HuntLibraryFilters {
  const params: URLSearchParams = new URLSearchParams(queryString);
  const category: string = params.get(HUNT_LIBRARY_QUERY_KEYS.category) || "";
  const data: string = params.get(HUNT_LIBRARY_QUERY_KEYS.data) || "";
  const status: string = params.get(HUNT_LIBRARY_QUERY_KEYS.status) || "";

  return {
    category: getSecurityHuntLibraryCategories().includes(
      category as DetectionRuleLibraryCategory,
    )
      ? (category as DetectionRuleLibraryCategory)
      : "",
    data: (Object.values(LibraryDataFilter) as Array<string>).includes(data)
      ? (data as LibraryDataFilter)
      : LibraryDataFilter.Any,
    status: (Object.values(LibraryStatusFilter) as Array<string>).includes(
      status,
    )
      ? (status as LibraryStatusFilter)
      : LibraryStatusFilter.Any,
    search: params.get(HUNT_LIBRARY_QUERY_KEYS.search) || "",
  };
}

// The address's parameters for the filters: an unset filter is left out.
export function getHuntLibraryQueryParams(
  filters: HuntLibraryFilters,
): Dictionary<string | null> {
  return {
    [HUNT_LIBRARY_QUERY_KEYS.category]: filters.category || null,
    [HUNT_LIBRARY_QUERY_KEYS.data]: filters.data || null,
    [HUNT_LIBRARY_QUERY_KEYS.status]: filters.status || null,
    [HUNT_LIBRARY_QUERY_KEYS.search]: filters.search.trim() || null,
  };
}

// Whether anything narrows the list: a filter, or a search with words in it.
export function isHuntLibraryFiltered(filters: HuntLibraryFilters): boolean {
  return (
    Boolean(filters.category) ||
    Boolean(filters.data) ||
    Boolean(filters.status) ||
    filters.search.trim().length > 0
  );
}

/*
 * The filters as they narrow the list: the data filter only while the page
 * offers it - while the project's events are read and some arrived.
 */
export function getEffectiveHuntLibraryFilters(
  filters: HuntLibraryFilters,
  isDataFilterOffered: boolean,
): HuntLibraryFilters {
  return isDataFilterOffered
    ? filters
    : { ...filters, data: LibraryDataFilter.Any };
}

// How many of the filter chips hold a value: the count beside "Filters".
export function countHuntLibraryChipFilters(
  filters: HuntLibraryFilters,
  isDataFilterOffered: boolean,
): number {
  const effective: HuntLibraryFilters = getEffectiveHuntLibraryFilters(
    filters,
    isDataFilterOffered,
  );

  return [effective.category, effective.data, effective.status].filter(
    (value: string): boolean => {
      return Boolean(value);
    },
  ).length;
}

/*
 * Whether the project sends what a starter reads: as the Rule Library
 * says it of a rule; a starter that reads any event has something to read
 * once any event arrived.
 */
export function getHuntLibraryDataStatus(
  entry: SecurityHuntLibraryEntry,
  seen: SecurityEventKindsSeen | null | undefined,
): LibraryRuleDataStatus {
  if (!seen) {
    return LibraryRuleDataStatus.Unknown;
  }

  if (entry.dataKind === null) {
    return isNothingSent(seen)
      ? LibraryRuleDataStatus.NotReceived
      : LibraryRuleDataStatus.Received;
  }

  return getLibraryRuleDataStatus(entry.dataKind, seen);
}

// The project's hunt of a starter, if it has one: the first saved with its id.
export function findHuntOfStarter(
  entry: SecurityHuntLibraryEntry,
  existingHunts: ReadonlyArray<ExistingHunt>,
): ExistingHunt | undefined {
  return existingHunts.find((hunt: ExistingHunt): boolean => {
    return hunt.libraryHuntId === entry.id;
  });
}

export function getHuntLibraryView(
  entry: SecurityHuntLibraryEntry,
  existingHunts: ReadonlyArray<ExistingHunt>,
  seen?: SecurityEventKindsSeen | null | undefined,
): HuntLibraryView {
  return {
    entry,
    addedHuntId: findHuntOfStarter(entry, existingHunts)?.id || null,
    dataStatus: getHuntLibraryDataStatus(entry, seen),
  };
}

/*
 * The words a starter is found by: its title and what it finds - as written
 * and in the reader's language - its search, its category and the events it
 * reads. Compared without regard to case.
 */
export function getHuntLibrarySearchText(
  entry: SecurityHuntLibraryEntry,
  translator?: Translator | undefined,
): string {
  const words: Array<string> = [
    entry.title,
    entry.description,
    entry.searchQuery,
    RULE_LIBRARY_CATEGORY_TITLES[entry.category],
    entry.dataKind ? DATA_KIND_TITLES[entry.dataKind] : "",
  ];

  if (translator) {
    words.push(
      translator.translateText(entry.title) || "",
      translator.translateText(entry.description) || "",
      translator.translateText(RULE_LIBRARY_CATEGORY_TITLES[entry.category]) ||
        "",
      entry.dataKind
        ? translator.translateText(DATA_KIND_TITLES[entry.dataKind]) || ""
        : "",
    );
  }

  return words.join("\n").toLowerCase();
}

function matchesSearch(
  entry: SecurityHuntLibraryEntry,
  search: string,
  translator?: Translator | undefined,
): boolean {
  const terms: Array<string> = search
    .trim()
    .toLowerCase()
    .split(" ")
    .filter((term: string): boolean => {
      return Boolean(term);
    });

  if (terms.length === 0) {
    return true;
  }

  const text: string = getHuntLibrarySearchText(entry, translator);

  return terms.every((term: string): boolean => {
    return text.includes(term);
  });
}

/*
 * The starters the filters and the search leave in sight, in the library's
 * own order (by category, as the Rule Library lists its rules).
 */
export function getFilteredHuntLibraryViews(data: {
  filters: HuntLibraryFilters;
  existingHunts: ReadonlyArray<ExistingHunt>;
  seen: SecurityEventKindsSeen | null | undefined;
  translator?: Translator | undefined;
}): Array<HuntLibraryView> {
  return SECURITY_HUNT_LIBRARY.map(
    (entry: SecurityHuntLibraryEntry): HuntLibraryView => {
      return getHuntLibraryView(entry, data.existingHunts, data.seen);
    },
  ).filter((view: HuntLibraryView): boolean => {
    if (
      data.filters.category &&
      view.entry.category !== data.filters.category
    ) {
      return false;
    }

    if (
      data.filters.data === LibraryDataFilter.Received &&
      view.dataStatus !== LibraryRuleDataStatus.Received
    ) {
      return false;
    }

    if (
      data.filters.data === LibraryDataFilter.NotReceived &&
      view.dataStatus !== LibraryRuleDataStatus.NotReceived
    ) {
      return false;
    }

    if (
      data.filters.status === LibraryStatusFilter.Added &&
      !view.addedHuntId
    ) {
      return false;
    }

    if (
      data.filters.status === LibraryStatusFilter.NotAdded &&
      view.addedHuntId
    ) {
      return false;
    }

    return matchesSearch(view.entry, data.filters.search, data.translator);
  });
}

/*
 * A starter as the hunt it becomes: named and described in the words of
 * whoever adds it, searching what the starter searches, over its window,
 * opened by hand until someone gives it a schedule - as every new hunt is -
 * and keeping the starter's id, so the library knows the project has it.
 */
export function buildHuntFromLibrary(data: {
  entry: SecurityHuntLibraryEntry;
  projectId: ObjectID;
  translator: Translator;
}): SecurityHunt {
  const hunt: SecurityHunt = new SecurityHunt();
  hunt.projectId = data.projectId;
  hunt.name =
    data.translator.translateText(data.entry.title) || data.entry.title;
  hunt.description =
    data.translator.translateText(data.entry.description) ||
    data.entry.description;
  hunt.searchQuery = data.entry.searchQuery;
  hunt.filters = {};
  hunt.timeRange = data.entry.timeRange;
  hunt.schedule = SecurityHuntSchedule.NotScheduled;
  hunt.libraryHuntId = data.entry.id;
  return hunt;
}

/*
 * Where Try it opens a starter: Events, searching what it searches over its
 * window, as a link a person could paste - nothing is saved.
 */
export function getHuntLibraryTryRoute(entry: SecurityHuntLibraryEntry): Route {
  return new Route(getSecurityEventsRoute().toString()).addQueryParams({
    search: encodeURIComponent(entry.searchQuery),
    [SECURITY_EVENTS_RANGE_PARAM]: encodeURIComponent(entry.timeRange),
  });
}
