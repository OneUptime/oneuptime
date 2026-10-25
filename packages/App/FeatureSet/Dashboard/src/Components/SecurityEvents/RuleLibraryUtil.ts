import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import Dictionary from "Common/Types/Dictionary";
import {
  DetectionRuleDataKind,
  SecurityEventKindsSeen,
  isDetectionRuleDataKindSeen,
} from "Common/Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY,
  DETECTION_RULE_LIBRARY_CATEGORIES,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
  isRecommendedDetectionRule,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import {
  getMitreTactic,
  getMitreTechnique,
  resolveMitreTacticId,
} from "Common/Types/SecurityEvent/MitreAttack";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import SigmaRule, {
  SIGMA_DEFAULT_LEVEL,
  SIGMA_LEVEL_TO_OCSF_SEVERITY,
  SigmaLevel,
} from "Common/Types/SecurityEvent/SigmaRule";
import {
  TurnOnRecommendedPart,
  TurnOnRecommendedProblem,
} from "Common/Types/SecurityEvent/TurnOnRecommended";
import SigmaRuleSetParser, {
  detectionRuleHeader,
} from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { isRuleFromLibraryEntry } from "Common/Utils/SecurityEvent/SecurityTemplateRecords";
import {
  DetectionRuleShape,
  readDetectionRuleShape,
} from "./DetectionRuleShape";

/*
 * The rule library as the page lists it: each rule with what a security
 * engineer scans a library for - whether the project has it already (and
 * whether it is on), whether it is one of the recommended ones, whether the
 * project sends the events it reads, how severe its findings are and the
 * ATT&CK tactics and techniques it is tagged with - and the filters, the
 * search and the bulk adds over them.
 *
 * A rule counts as added when the project has a detection rule whose Sigma
 * YAML carries the rule's id, however the team renamed it, or one of its
 * name. The server's Turn on recommended knows a project's rule the same
 * way (SecurityTemplateRecords), so the page never offers to add a rule
 * the server would count as there, and adding twice adds nothing.
 *
 * React-free so the whole of it is pinned in plain tests.
 */

/*
 * A rule the project has, as the library reads it: the rule (its name,
 * Sigma YAML and whether it is on), or just its name.
 */
export type ExistingRule =
  | string
  | Pick<DetectionRule, "name" | "sigmaRuleYaml" | "isEnabled">;

// Whether the project sends the events a rule reads.
export enum LibraryRuleDataStatus {
  // Events of its kind arrived in the window the page looks at.
  Received = "received",
  // None arrived in that window.
  NotReceived = "not-received",
  // Not known: the events have not been read yet, or could not be.
  Unknown = "unknown",
}

export interface LibraryRuleAttack {
  // The tactics the rule's Sigma tags name, as ids (TA0006), in tag order.
  tacticIds: Array<string>;
  // The techniques its tags name, as written (T1110.001), in tag order.
  techniqueIds: Array<string>;
}

export interface LibraryRuleView {
  entry: DetectionRuleLibraryEntry;
  isAdded: boolean;
  // Added, and turned off under Detection Rules.
  isTurnedOff: boolean;
  /*
   * The project's rule of it, by the name the project gave it, when that
   * is not the library's title (a rule the team renamed); null otherwise.
   */
  addedAsName: string | null;
  /*
   * One of the rules "Turn on recommended" adds: they find what most
   * projects can see in data OneUptime already has (sign-ins, shells,
   * cloud changes, web attacks).
   */
  isRecommended: boolean;
  dataStatus: LibraryRuleDataStatus;
  // How severe its findings are: its Sigma level, as OCSF names it.
  severity: OcsfSeverity;
  attack: LibraryRuleAttack;
  // A sequence or a first-seen rule; null for a single rule or one that does not read.
  shape: DetectionRuleShape | null;
}

// The library's own filter beside its categories: the recommended rules.
export type RecommendedFilter = "recommended";

export const RECOMMENDED_FILTER: RecommendedFilter = "recommended";

// What the Category select narrows the library to.
export type LibraryRuleFilter =
  | DetectionRuleLibraryCategory
  | RecommendedFilter
  | "";

// What the Data select narrows the library to.
export enum LibraryDataFilter {
  Any = "",
  // The rules whose events the project sends.
  Received = "received",
  // The rules whose events it does not send yet.
  NotReceived = "not-received",
}

// What the Status select narrows the library to.
export enum LibraryStatusFilter {
  Any = "",
  NotAdded = "not-added",
  Added = "added",
}

export const LIBRARY_DATA_FILTERS: ReadonlyArray<LibraryDataFilter> = [
  LibraryDataFilter.Any,
  LibraryDataFilter.Received,
  LibraryDataFilter.NotReceived,
];

export const LIBRARY_STATUS_FILTERS: ReadonlyArray<LibraryStatusFilter> = [
  LibraryStatusFilter.Any,
  LibraryStatusFilter.NotAdded,
  LibraryStatusFilter.Added,
];

// Every rule, the recommended ones, or one category - in the order the select offers them.
export const LIBRARY_RULE_FILTERS: ReadonlyArray<LibraryRuleFilter> = [
  "",
  RECOMMENDED_FILTER,
  ...DETECTION_RULE_LIBRARY_CATEGORIES,
];

export interface RuleLibraryFilters {
  category: LibraryRuleFilter;
  data: LibraryDataFilter;
  status: LibraryStatusFilter;
  search: string;
}

export const NO_RULE_LIBRARY_FILTERS: RuleLibraryFilters = {
  category: "",
  data: LibraryDataFilter.Any,
  status: LibraryStatusFilter.Any,
  search: "",
};

// Whether anything narrows the list: a filter, or a search with words in it.
export function isRuleLibraryFiltered(filters: RuleLibraryFilters): boolean {
  return (
    Boolean(filters.category) ||
    Boolean(filters.data) ||
    Boolean(filters.status) ||
    filters.search.trim().length > 0
  );
}

/*
 * The filters as they narrow the list: the data filter only while the page
 * offers it - while the project's events are read and some arrived. A data
 * filter kept from the address while the events could not be read, or
 * when none arrived this week, narrows nothing, and the page says nothing
 * of it ("Add N Matching Rules", "Clear all").
 */
export function getEffectiveRuleLibraryFilters(
  filters: RuleLibraryFilters,
  isDataFilterOffered: boolean,
): RuleLibraryFilters {
  return isDataFilterOffered
    ? filters
    : { ...filters, data: LibraryDataFilter.Any };
}

// How many of the filter chips hold a value: the count beside "Filter".
export function countRuleLibraryChipFilters(
  filters: RuleLibraryFilters,
  isDataFilterOffered: boolean,
): number {
  const effective: RuleLibraryFilters = getEffectiveRuleLibraryFilters(
    filters,
    isDataFilterOffered,
  );

  return [effective.category, effective.data, effective.status].filter(
    (value: string): boolean => {
      return Boolean(value);
    },
  ).length;
}

// What a rule's Sigma header says, read once per rule: the library never changes.
interface LibraryRuleHeader {
  level: SigmaLevel;
  attack: LibraryRuleAttack;
}

const HEADERS: Map<string, LibraryRuleHeader> = new Map();

function readLibraryRuleHeader(
  entry: DetectionRuleLibraryEntry,
): LibraryRuleHeader {
  const known: LibraryRuleHeader | undefined = HEADERS.get(entry.id);

  if (known) {
    return known;
  }

  let header: LibraryRuleHeader = {
    level: SIGMA_DEFAULT_LEVEL,
    attack: { tacticIds: [], techniqueIds: [] },
  };

  try {
    const rule: SigmaRule = detectionRuleHeader(
      SigmaRuleSetParser.parse(entry.sigmaRuleYaml),
    );
    const tacticIds: Array<string> = [];
    const techniqueIds: Array<string> = [];

    for (const tag of rule.mitreTactics || []) {
      const id: string | undefined = resolveMitreTacticId(tag);

      if (id && !tacticIds.includes(id)) {
        tacticIds.push(id);
      }
    }

    for (const tag of rule.mitreTechniques || []) {
      const id: string = tag.trim().toUpperCase();

      if (id && !techniqueIds.includes(id)) {
        techniqueIds.push(id);
      }
    }

    header = { level: rule.level, attack: { tacticIds, techniqueIds } };
  } catch {
    // Every library rule reads (its tests parse each one); a default if not.
  }

  HEADERS.set(entry.id, header);

  return header;
}

// The severity of a library rule's findings: its Sigma level, as OCSF names it.
export function getLibraryRuleSeverity(
  entry: DetectionRuleLibraryEntry,
): OcsfSeverity {
  return SIGMA_LEVEL_TO_OCSF_SEVERITY[readLibraryRuleHeader(entry).level];
}

export function getLibraryRuleAttack(
  entry: DetectionRuleLibraryEntry,
): LibraryRuleAttack {
  const attack: LibraryRuleAttack = readLibraryRuleHeader(entry).attack;

  return {
    tacticIds: [...attack.tacticIds],
    techniqueIds: [...attack.techniqueIds],
  };
}

// The tactics' names, for a row and for the search: "Credential Access".
export function getLibraryRuleTacticNames(
  attack: LibraryRuleAttack,
): Array<string> {
  return attack.tacticIds.map((id: string): string => {
    return getMitreTactic(id)?.name || id;
  });
}

function findProjectRule(
  entry: DetectionRuleLibraryEntry,
  existingRules: ReadonlyArray<ExistingRule>,
): ExistingRule | undefined {
  return existingRules.find((rule: ExistingRule): boolean => {
    return isRuleFromLibraryEntry(
      typeof rule === "string" ? { name: rule } : rule,
      entry,
    );
  });
}

export function isLibraryRuleAdded(
  entry: DetectionRuleLibraryEntry,
  existingRules: ReadonlyArray<ExistingRule>,
): boolean {
  return Boolean(findProjectRule(entry, existingRules));
}

/*
 * Whether the project sent no security event at all in the window: a new
 * project, or one whose sources all stopped. Every rule would read "Not
 * receiving" - the page says it once instead.
 */
export function isNothingSent(
  seen: SecurityEventKindsSeen | null | undefined,
): boolean {
  return Boolean(
    seen &&
      seen.classNames.length === 0 &&
      seen.vendorNames.length === 0 &&
      seen.productNames.length === 0,
  );
}

/*
 * Whether the project sends what a rule reads: Unknown until the events
 * have been read (seen is null), then whether any of its kind arrived.
 */
export function getLibraryRuleDataStatus(
  dataKind: DetectionRuleDataKind,
  seen: SecurityEventKindsSeen | null | undefined,
): LibraryRuleDataStatus {
  if (!seen) {
    return LibraryRuleDataStatus.Unknown;
  }

  return isDetectionRuleDataKindSeen(dataKind, seen)
    ? LibraryRuleDataStatus.Received
    : LibraryRuleDataStatus.NotReceived;
}

// One rule as the page draws it.
export function getLibraryRuleView(
  entry: DetectionRuleLibraryEntry,
  existingRules: ReadonlyArray<ExistingRule>,
  seen?: SecurityEventKindsSeen | null | undefined,
): LibraryRuleView {
  const projectRule: ExistingRule | undefined = findProjectRule(
    entry,
    existingRules,
  );
  const projectRuleName: string =
    typeof projectRule === "string"
      ? projectRule.trim()
      : (projectRule?.name || "").trim();

  return {
    entry,
    isAdded: Boolean(projectRule),
    isTurnedOff:
      Boolean(projectRule) &&
      typeof projectRule !== "string" &&
      projectRule?.isEnabled === false,
    addedAsName:
      projectRule &&
      projectRuleName &&
      projectRuleName.toLowerCase() !== entry.title.trim().toLowerCase()
        ? projectRuleName
        : null,
    isRecommended: isRecommendedDetectionRule(entry),
    dataStatus: getLibraryRuleDataStatus(entry.dataKind, seen),
    severity: getLibraryRuleSeverity(entry),
    attack: getLibraryRuleAttack(entry),
    shape: readDetectionRuleShape(entry.sigmaRuleYaml),
  };
}

/*
 * True when every word of the search is in what the rule says: its title,
 * description and the events it reads, its category and kind ("sequence",
 * "first seen"), its severity, and its ATT&CK tactics and techniques - by
 * id or name, a sub-technique by its parent's too ("T1110", "credential
 * access", "brute force").
 */
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

  const shape: DetectionRuleShape | null = readDetectionRuleShape(
    entry.sigmaRuleYaml,
  );
  const attack: LibraryRuleAttack = getLibraryRuleAttack(entry);
  const techniqueWords: Array<string> = attack.techniqueIds.flatMap(
    (id: string): Array<string> => {
      const parentId: string = id.split(".")[0] || id;

      return [id, parentId, getMitreTechnique(id)?.name || ""];
    },
  );

  const haystack: string = [
    entry.title,
    entry.description,
    entry.dataSource,
    entry.category,
    shape && shape.isCorrelation ? shape.typeTitle : "",
    getLibraryRuleSeverity(entry),
    ...attack.tacticIds,
    ...getLibraryRuleTacticNames(attack),
    ...techniqueWords,
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

function matchesDataFilter(
  view: LibraryRuleView,
  filter: LibraryDataFilter | undefined,
): boolean {
  if (!filter) {
    return true;
  }

  // Until the events are read, the filter cannot tell: it narrows nothing.
  if (view.dataStatus === LibraryRuleDataStatus.Unknown) {
    return true;
  }

  return filter === LibraryDataFilter.Received
    ? view.dataStatus === LibraryRuleDataStatus.Received
    : view.dataStatus === LibraryRuleDataStatus.NotReceived;
}

function matchesStatusFilter(
  view: LibraryRuleView,
  filter: LibraryStatusFilter | undefined,
): boolean {
  if (!filter) {
    return true;
  }

  return filter === LibraryStatusFilter.Added ? view.isAdded : !view.isAdded;
}

/*
 * The rules the page lists, in the library's order (by category, the
 * recommended ones among the first of each), narrowed by the filters and
 * the search.
 */
export function getLibraryRuleViews(data: {
  category: LibraryRuleFilter;
  search: string;
  existingRules: ReadonlyArray<ExistingRule>;
  data?: LibraryDataFilter | undefined;
  status?: LibraryStatusFilter | undefined;
  seen?: SecurityEventKindsSeen | null | undefined;
}): Array<LibraryRuleView> {
  return DETECTION_RULE_LIBRARY.filter(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return (
        matchesLibraryFilter(entry, data.category) &&
        matchesLibrarySearch(entry, data.search)
      );
    },
  )
    .map((entry: DetectionRuleLibraryEntry): LibraryRuleView => {
      return getLibraryRuleView(entry, data.existingRules, data.seen);
    })
    .filter((view: LibraryRuleView): boolean => {
      return (
        matchesDataFilter(view, data.data) &&
        matchesStatusFilter(view, data.status)
      );
    });
}

// The rules the filters leave in sight.
export function getFilteredLibraryRuleViews(data: {
  filters: RuleLibraryFilters;
  existingRules: ReadonlyArray<ExistingRule>;
  seen?: SecurityEventKindsSeen | null | undefined;
}): Array<LibraryRuleView> {
  return getLibraryRuleViews({
    category: data.filters.category,
    search: data.filters.search,
    data: data.filters.data,
    status: data.filters.status,
    existingRules: data.existingRules,
    seen: data.seen,
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

// The rules of these the project has no rule of yet, in their order.
export function getNotAddedEntries(
  views: ReadonlyArray<LibraryRuleView>,
): Array<DetectionRuleLibraryEntry> {
  return views
    .filter((view: LibraryRuleView): boolean => {
      return !view.isAdded;
    })
    .map((view: LibraryRuleView): DetectionRuleLibraryEntry => {
      return view.entry;
    });
}

/*
 * How many of these rules read events the project does not send yet: they
 * would run, and find nothing until those arrive. Unknown counts as none.
 */
export function countEntriesWithoutData(
  entries: ReadonlyArray<DetectionRuleLibraryEntry>,
  seen: SecurityEventKindsSeen | null | undefined,
): number {
  return entries.filter((entry: DetectionRuleLibraryEntry): boolean => {
    return (
      getLibraryRuleDataStatus(entry.dataKind, seen) ===
      LibraryRuleDataStatus.NotReceived
    );
  }).length;
}

/*
 * What an Add could not do for one library entry, if anything: the problem
 * named by the entry's title (or, from the server, by the name of the
 * project's rule of it), so its row can say why where the reader clicked.
 */
export function findLibraryEntryProblem(
  entry: DetectionRuleLibraryEntry,
  problems: ReadonlyArray<TurnOnRecommendedProblem>,
): TurnOnRecommendedProblem | undefined {
  return problems.find((problem: TurnOnRecommendedProblem): boolean => {
    return (
      problem.part === TurnOnRecommendedPart.Rule &&
      Boolean(problem.name) &&
      isRuleFromLibraryEntry({ name: problem.name }, entry)
    );
  });
}

/*
 * The header's buttons. The main one is the next step: the recommended
 * rules while any is missing, else adding the rules in sight. Adding the
 * rules in sight waits in the ⋯ while the recommended ones take the main
 * button. Nothing to add, no button.
 */
export enum RuleLibraryHeaderAction {
  AddRecommended = "add-recommended",
  AddShown = "add-shown",
}

export interface RuleLibraryHeaderActions {
  main: RuleLibraryHeaderAction | null;
  more: Array<RuleLibraryHeaderAction>;
}

export function getRuleLibraryHeaderActions(data: {
  recommendedNotAdded: number;
  shownNotAdded: number;
}): RuleLibraryHeaderActions {
  if (data.recommendedNotAdded > 0) {
    return {
      main: RuleLibraryHeaderAction.AddRecommended,
      more: data.shownNotAdded > 0 ? [RuleLibraryHeaderAction.AddShown] : [],
    };
  }

  return {
    main: data.shownNotAdded > 0 ? RuleLibraryHeaderAction.AddShown : null,
    more: [],
  };
}

/*
 * The filters in the page's address, so a filtered library can be linked
 * to (ATT&CK Coverage opens it on a technique) and survives a reload.
 * Unknown values read as no filter.
 */
export const RULE_LIBRARY_QUERY_KEYS: {
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

export function readRuleLibraryFilters(
  queryString: string,
): RuleLibraryFilters {
  const params: URLSearchParams = new URLSearchParams(queryString);
  const category: string = params.get(RULE_LIBRARY_QUERY_KEYS.category) || "";
  const data: string = params.get(RULE_LIBRARY_QUERY_KEYS.data) || "";
  const status: string = params.get(RULE_LIBRARY_QUERY_KEYS.status) || "";

  return {
    category: LIBRARY_RULE_FILTERS.includes(category as LibraryRuleFilter)
      ? (category as LibraryRuleFilter)
      : "",
    data: LIBRARY_DATA_FILTERS.includes(data as LibraryDataFilter)
      ? (data as LibraryDataFilter)
      : LibraryDataFilter.Any,
    status: LIBRARY_STATUS_FILTERS.includes(status as LibraryStatusFilter)
      ? (status as LibraryStatusFilter)
      : LibraryStatusFilter.Any,
    search: params.get(RULE_LIBRARY_QUERY_KEYS.search) || "",
  };
}

// The address's parameters for the filters: an unset filter is left out.
export function getRuleLibraryQueryParams(
  filters: RuleLibraryFilters,
): Dictionary<string | null> {
  return {
    [RULE_LIBRARY_QUERY_KEYS.category]: filters.category || null,
    [RULE_LIBRARY_QUERY_KEYS.data]: filters.data || null,
    [RULE_LIBRARY_QUERY_KEYS.status]: filters.status || null,
    [RULE_LIBRARY_QUERY_KEYS.search]: filters.search.trim() || null,
  };
}
