import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  getLocalePath,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  ExistingRule,
  LibraryDataFilter,
  LibraryRuleDataStatus,
  LibraryRuleView,
  LibraryStatusFilter,
  NO_RULE_LIBRARY_FILTERS,
  RECOMMENDED_FILTER,
  RULE_LIBRARY_QUERY_KEYS,
  RuleLibraryFilters,
  RuleLibraryHeaderAction,
  countEntriesWithoutData,
  getFilteredLibraryRuleViews,
  getLibraryRuleAttack,
  getLibraryRuleDataStatus,
  getLibraryRuleSeverity,
  getLibraryRuleTacticNames,
  getLibraryRuleView,
  getLibraryRuleViews,
  getNotAddedEntries,
  getRecommendedRulesNotAdded,
  getRuleLibraryHeaderActions,
  getRuleLibraryQueryParams,
  isLibraryRuleAdded,
  isNothingSent,
  isRuleLibraryFiltered,
  matchesLibrarySearch,
  readRuleLibraryFilters,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryUtil";
import * as RuleLibraryCopy from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryCopy";
import {
  DATA_KIND_HOW_TO_SEND,
  DATA_KIND_SEND_PAGE,
  DATA_KIND_TITLES,
  GO_TO_CONNECTIONS,
  OPEN_SETUP_GUIDE,
  getDataKindSendLinkText,
  getDataSourceDetail,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryCopy";
import {
  RULE_LIBRARY_DATA_GROUP_LIMIT,
  RULE_LIBRARY_DATA_WINDOW_IN_DAYS,
  buildSecurityEventKindsAggregateBy,
  readSecurityEventKindsSeen,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryData";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import {
  DETECTION_RULE_DATA_KINDS_IN_ORDER,
  DetectionRuleDataKind,
  SecurityEventKindsSeen,
} from "Common/Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY,
  DETECTION_RULE_LIBRARY_CATEGORIES,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
  isRecommendedDetectionRule,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import { DetectionRuleType } from "Common/Types/SecurityEvent/SigmaCorrelation";

/*
 * The Rule Library's model: what each rule says about itself as the page
 * draws it (added, turned off, recommended, whether its events arrive, its
 * severity and ATT&CK tags), the filters and search a security engineer
 * narrows the library with, the header's adds, the page's address, the one
 * grouped count that says what the project sends, and the words - in every
 * language the Dashboard speaks.
 */

function entryTitled(title: string): DetectionRuleLibraryEntry {
  const entry: DetectionRuleLibraryEntry | undefined =
    DETECTION_RULE_LIBRARY.find((candidate: DetectionRuleLibraryEntry) => {
      return candidate.title === title;
    });

  if (!entry) {
    throw new Error(`No library rule titled ${title}`);
  }

  return entry;
}

function ids(views: Array<LibraryRuleView>): Array<string> {
  return views.map((view: LibraryRuleView): string => {
    return view.entry.id;
  });
}

function idsOf(entries: Array<DetectionRuleLibraryEntry>): Array<string> {
  return entries.map((entry: DetectionRuleLibraryEntry): string => {
    return entry.id;
  });
}

const BRUTE_FORCE: DetectionRuleLibraryEntry = entryTitled(
  "Brute force from one IP address",
);
const SHADOW_COPIES: DetectionRuleLibraryEntry = entryTitled(
  "Shadow copies deleted",
);
const API_TOKEN: DetectionRuleLibraryEntry = entryTitled("API token created");
const SEQUENCE: DetectionRuleLibraryEntry = entryTitled(
  "Failed sign-ins, then a success from the same address",
);
const FIRST_SEEN: DetectionRuleLibraryEntry = entryTitled(
  "First shell in a namespace by a user",
);
const PORT_SCAN: DetectionRuleLibraryEntry = entryTitled("Port scan");

// What a project that sends Okta and Kubernetes audit logs stored this week.
const OKTA_AND_KUBERNETES: SecurityEventKindsSeen = {
  classNames: ["Authentication", "API Activity"],
  vendorNames: ["Okta", "Kubernetes"],
  productNames: ["Okta System Log", "Kubernetes audit log"],
};

const NOTHING: SecurityEventKindsSeen = {
  classNames: [],
  vendorNames: [],
  productNames: [],
};

function filters(overrides: Partial<RuleLibraryFilters>): RuleLibraryFilters {
  return { ...NO_RULE_LIBRARY_FILTERS, ...overrides };
}

describe("one rule as the page draws it", () => {
  test("a rule the project does not have is not added, not off, and has no other name", () => {
    const view: LibraryRuleView = getLibraryRuleView(BRUTE_FORCE, []);

    expect(view.isAdded).toBe(false);
    expect(view.isTurnedOff).toBe(false);
    expect(view.addedAsName).toBeNull();
  });

  test("a rule of its name is added; of its Sigma id it is added whatever the team renamed it to", () => {
    expect(getLibraryRuleView(BRUTE_FORCE, [BRUTE_FORCE.title]).isAdded).toBe(
      true,
    );
    expect(
      getLibraryRuleView(BRUTE_FORCE, [
        {
          name: "Our brute force rule",
          sigmaRuleYaml: BRUTE_FORCE.sigmaRuleYaml,
          isEnabled: true,
        },
      ]),
    ).toEqual(
      expect.objectContaining({
        isAdded: true,
        isTurnedOff: false,
        addedAsName: "Our brute force rule",
      }),
    );
  });

  test("the project's copy under the library's own name, whatever its case, has no other name to say", () => {
    expect(
      getLibraryRuleView(BRUTE_FORCE, [
        {
          name: `  ${BRUTE_FORCE.title.toUpperCase()} `,
          sigmaRuleYaml: BRUTE_FORCE.sigmaRuleYaml,
          isEnabled: true,
        },
      ]).addedAsName,
    ).toBeNull();
  });

  test("a copy the team turned off is added and off; one whose on/off is not known is on", () => {
    expect(
      getLibraryRuleView(BRUTE_FORCE, [
        {
          name: BRUTE_FORCE.title,
          sigmaRuleYaml: BRUTE_FORCE.sigmaRuleYaml,
          isEnabled: false,
        },
      ]),
    ).toEqual(expect.objectContaining({ isAdded: true, isTurnedOff: true }));
    expect(
      getLibraryRuleView(BRUTE_FORCE, [BRUTE_FORCE.title]).isTurnedOff,
    ).toBe(false);
  });

  test("recommended as the catalog says, for every rule", () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      expect(getLibraryRuleView(entry, []).isRecommended).toBe(
        isRecommendedDetectionRule(entry),
      );
    }
  });

  test("its severity is its Sigma level, as OCSF names it", () => {
    expect(getLibraryRuleSeverity(SHADOW_COPIES)).toBe(OcsfSeverity.Critical);
    expect(getLibraryRuleSeverity(BRUTE_FORCE)).toBe(OcsfSeverity.High);
    expect(getLibraryRuleSeverity(entryTitled("Account locked out"))).toBe(
      OcsfSeverity.Medium,
    );
    expect(getLibraryRuleSeverity(API_TOKEN)).toBe(OcsfSeverity.Low);
  });

  test("every rule has a severity of the five Sigma levels", () => {
    const levels: Array<OcsfSeverity> = [
      OcsfSeverity.Informational,
      OcsfSeverity.Low,
      OcsfSeverity.Medium,
      OcsfSeverity.High,
      OcsfSeverity.Critical,
    ];

    for (const entry of DETECTION_RULE_LIBRARY) {
      expect([
        entry.title,
        levels.includes(getLibraryRuleSeverity(entry)),
      ]).toEqual([entry.title, true]);
    }
  });

  test("its ATT&CK tags: the tactics as ids, the techniques as written", () => {
    expect(getLibraryRuleAttack(BRUTE_FORCE)).toEqual({
      tacticIds: ["TA0006"],
      techniqueIds: ["T1110.001"],
    });
    expect(
      getLibraryRuleTacticNames(getLibraryRuleAttack(BRUTE_FORCE)),
    ).toEqual(["Credential Access"]);
    // Two tactics and two techniques, in the order the tags name them.
    expect(
      getLibraryRuleAttack(entryTitled("Encoded PowerShell command")),
    ).toEqual({
      tacticIds: ["TA0002", "TA0005"],
      techniqueIds: ["T1059.001", "T1027"],
    });
  });

  test("every rule is tagged with at least one tactic and one technique", () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      const attack: ReturnType<typeof getLibraryRuleAttack> =
        getLibraryRuleAttack(entry);

      expect([entry.title, attack.tacticIds.length > 0]).toEqual([
        entry.title,
        true,
      ]);
      expect([entry.title, attack.techniqueIds.length > 0]).toEqual([
        entry.title,
        true,
      ]);
    }
  });

  test("a sequence and a first-seen rule have their kind; a single rule has none to mark", () => {
    expect(getLibraryRuleView(SEQUENCE, []).shape?.type).toBe(
      DetectionRuleType.TemporalOrdered,
    );
    expect(getLibraryRuleView(FIRST_SEEN, []).shape?.type).toBe(
      DetectionRuleType.NewValue,
    );
    expect(getLibraryRuleView(BRUTE_FORCE, []).shape?.isCorrelation).toBe(
      false,
    );
  });

  test("whether its events arrive: not known until read, then by its kind", () => {
    expect(getLibraryRuleView(BRUTE_FORCE, []).dataStatus).toBe(
      LibraryRuleDataStatus.Unknown,
    );
    expect(
      getLibraryRuleView(BRUTE_FORCE, [], OKTA_AND_KUBERNETES).dataStatus,
    ).toBe(LibraryRuleDataStatus.Received);
    expect(
      getLibraryRuleView(SHADOW_COPIES, [], OKTA_AND_KUBERNETES).dataStatus,
    ).toBe(LibraryRuleDataStatus.NotReceived);
    expect(
      getLibraryRuleDataStatus(DetectionRuleDataKind.KubernetesAuditLogs, null),
    ).toBe(LibraryRuleDataStatus.Unknown);
  });
});

describe("narrowing the library", () => {
  test("no filter lists every rule, in the library's order", () => {
    expect(
      ids(
        getFilteredLibraryRuleViews({
          filters: NO_RULE_LIBRARY_FILTERS,
          existingRules: [],
        }),
      ),
    ).toEqual(idsOf([...DETECTION_RULE_LIBRARY]));
    expect(isRuleLibraryFiltered(NO_RULE_LIBRARY_FILTERS)).toBe(false);
  });

  test("a category lists its rules, the recommended filter the recommended ones", () => {
    for (const category of DETECTION_RULE_LIBRARY_CATEGORIES) {
      const shown: Array<LibraryRuleView> = getFilteredLibraryRuleViews({
        filters: filters({ category }),
        existingRules: [],
      });

      expect(shown.length).toBeGreaterThan(0);
      expect(
        shown.every((view: LibraryRuleView): boolean => {
          return view.entry.category === category;
        }),
      ).toBe(true);
    }

    expect(
      ids(
        getFilteredLibraryRuleViews({
          filters: filters({ category: RECOMMENDED_FILTER }),
          existingRules: [],
        }),
      ),
    ).toEqual(idsOf(getRecommendedDetectionRules()));
  });

  test("the data filter lists the rules whose events arrive, or the others", () => {
    const received: Array<LibraryRuleView> = getFilteredLibraryRuleViews({
      filters: filters({ data: LibraryDataFilter.Received }),
      existingRules: [],
      seen: OKTA_AND_KUBERNETES,
    });
    const notReceived: Array<LibraryRuleView> = getFilteredLibraryRuleViews({
      filters: filters({ data: LibraryDataFilter.NotReceived }),
      existingRules: [],
      seen: OKTA_AND_KUBERNETES,
    });

    expect(received.length).toBeGreaterThan(0);
    expect(notReceived.length).toBeGreaterThan(0);
    expect(received.length + notReceived.length).toBe(
      DETECTION_RULE_LIBRARY.length,
    );
    expect(
      received.every((view: LibraryRuleView): boolean => {
        return [
          DetectionRuleDataKind.SignIns,
          DetectionRuleDataKind.AccountChanges,
          DetectionRuleDataKind.OktaSystemLog,
          DetectionRuleDataKind.KubernetesAuditLogs,
        ].includes(view.entry.dataKind);
      }),
    ).toBe(true);
    expect(ids(received)).toContain(BRUTE_FORCE.id);
    expect(ids(notReceived)).toContain(SHADOW_COPIES.id);
    expect(ids(notReceived)).toContain(PORT_SCAN.id);
  });

  test("before the events are read, the data filter narrows nothing", () => {
    expect(
      getFilteredLibraryRuleViews({
        filters: filters({ data: LibraryDataFilter.Received }),
        existingRules: [],
        seen: null,
      }),
    ).toHaveLength(DETECTION_RULE_LIBRARY.length);
  });

  test("the status filter lists the rules the project has, or the others", () => {
    const existing: Array<ExistingRule> = [
      BRUTE_FORCE.title,
      {
        name: "Renamed",
        sigmaRuleYaml: SHADOW_COPIES.sigmaRuleYaml,
        isEnabled: false,
      },
    ];

    expect(
      ids(
        getFilteredLibraryRuleViews({
          filters: filters({ status: LibraryStatusFilter.Added }),
          existingRules: existing,
        }),
      ),
    ).toEqual([BRUTE_FORCE.id, SHADOW_COPIES.id]);
    expect(
      getFilteredLibraryRuleViews({
        filters: filters({ status: LibraryStatusFilter.NotAdded }),
        existingRules: existing,
      }),
    ).toHaveLength(DETECTION_RULE_LIBRARY.length - 2);
  });

  test("filters and a search narrow together", () => {
    const shown: Array<LibraryRuleView> = getFilteredLibraryRuleViews({
      filters: filters({
        category: DetectionRuleLibraryCategory.Identity,
        status: LibraryStatusFilter.NotAdded,
        data: LibraryDataFilter.Received,
        search: "okta",
      }),
      existingRules: [entryTitled("MFA push fatigue").title],
      seen: OKTA_AND_KUBERNETES,
    });

    expect(shown.length).toBeGreaterThan(0);
    for (const view of shown) {
      expect(view.entry.category).toBe(DetectionRuleLibraryCategory.Identity);
      expect(view.isAdded).toBe(false);
      expect(view.dataStatus).toBe(LibraryRuleDataStatus.Received);
    }
    expect(ids(shown)).not.toContain(entryTitled("MFA push fatigue").id);
  });

  test("isRuleLibraryFiltered: any filter, or a search with words", () => {
    expect(isRuleLibraryFiltered(filters({ search: "   " }))).toBe(false);
    expect(isRuleLibraryFiltered(filters({ search: "okta" }))).toBe(true);
    expect(
      isRuleLibraryFiltered(filters({ category: RECOMMENDED_FILTER })),
    ).toBe(true);
    expect(
      isRuleLibraryFiltered(filters({ data: LibraryDataFilter.NotReceived })),
    ).toBe(true);
    expect(
      isRuleLibraryFiltered(filters({ status: LibraryStatusFilter.Added })),
    ).toBe(true);
  });
});

describe("the search", () => {
  test("every word, in any order and case, of the title, the description or the events it reads", () => {
    expect(matchesLibrarySearch(BRUTE_FORCE, "IP brute")).toBe(true);
    expect(matchesLibrarySearch(BRUTE_FORCE, "guessing PASSWORDS")).toBe(true);
    expect(matchesLibrarySearch(BRUTE_FORCE, "authentication events")).toBe(
      true,
    );
    expect(matchesLibrarySearch(BRUTE_FORCE, "brute kubernetes-only")).toBe(
      false,
    );
    expect(matchesLibrarySearch(BRUTE_FORCE, "   ")).toBe(true);
  });

  test("an ATT&CK technique's id finds its rules, a sub-technique's rules by the parent's id too", () => {
    const byParent: Array<string> = ids(
      getLibraryRuleViews({ category: "", search: "T1110", existingRules: [] }),
    );

    // Brute force is tagged T1110.001, password spraying T1110.003.
    expect(byParent).toEqual(
      expect.arrayContaining([
        BRUTE_FORCE.id,
        entryTitled("Password spraying").id,
        entryTitled("Account locked out").id,
      ]),
    );
    expect(byParent).not.toContain(SHADOW_COPIES.id);
    expect(matchesLibrarySearch(BRUTE_FORCE, "t1110.001")).toBe(true);
    expect(matchesLibrarySearch(BRUTE_FORCE, "T1110.003")).toBe(false);
  });

  test("a tactic's name or id, and a technique's name, find their rules", () => {
    expect(matchesLibrarySearch(BRUTE_FORCE, "credential access")).toBe(true);
    expect(matchesLibrarySearch(BRUTE_FORCE, "TA0006")).toBe(true);
    expect(matchesLibrarySearch(BRUTE_FORCE, "brute force")).toBe(true);
    expect(matchesLibrarySearch(SHADOW_COPIES, "inhibit system recovery")).toBe(
      true,
    );
    expect(matchesLibrarySearch(PORT_SCAN, "credential access")).toBe(false);
  });

  test("a severity finds its rules", () => {
    const critical: Array<LibraryRuleView> = getLibraryRuleViews({
      category: "",
      search: "critical",
      existingRules: [],
    });

    expect(ids(critical)).toContain(SHADOW_COPIES.id);
    expect(
      critical.every((view: LibraryRuleView): boolean => {
        return (
          view.severity === OcsfSeverity.Critical ||
          `${view.entry.title} ${view.entry.description}`
            .toLowerCase()
            .includes("critical")
        );
      }),
    ).toBe(true);
  });

  test("a correlation is found by its kind", () => {
    expect(matchesLibrarySearch(SEQUENCE, "sequence")).toBe(true);
    expect(matchesLibrarySearch(FIRST_SEEN, "first seen")).toBe(true);
  });
});

describe("what the header adds", () => {
  test("the recommended rules the project lacks, in the library's order", () => {
    const recommended: Array<DetectionRuleLibraryEntry> =
      getRecommendedDetectionRules();

    expect(idsOf(getRecommendedRulesNotAdded([]))).toEqual(idsOf(recommended));
    expect(idsOf(getRecommendedRulesNotAdded([recommended[0]!.title]))).toEqual(
      idsOf(recommended.slice(1)),
    );
    /*
     * One the team turned off is still added: the library adds what is
     * missing, and never turns a rule back on.
     */
    expect(
      idsOf(
        getRecommendedRulesNotAdded([
          {
            name: recommended[0]!.title,
            sigmaRuleYaml: recommended[0]!.sigmaRuleYaml,
            isEnabled: false,
          },
        ]),
      ),
    ).toEqual(idsOf(recommended.slice(1)));
  });

  test("the rules in sight the project lacks", () => {
    const views: Array<LibraryRuleView> = getLibraryRuleViews({
      category: DetectionRuleLibraryCategory.Kubernetes,
      search: "",
      existingRules: [entryTitled("Shell opened in a pod").title],
    });

    expect(idsOf(getNotAddedEntries(views))).toEqual(
      ids(views).filter((id: string): boolean => {
        return id !== entryTitled("Shell opened in a pod").id;
      }),
    );
  });

  test("how many of them read events the project does not send yet; none while that is not known", () => {
    const entries: Array<DetectionRuleLibraryEntry> = [
      BRUTE_FORCE,
      SHADOW_COPIES,
      PORT_SCAN,
    ];

    expect(countEntriesWithoutData(entries, OKTA_AND_KUBERNETES)).toBe(2);
    expect(countEntriesWithoutData(entries, NOTHING)).toBe(3);
    expect(countEntriesWithoutData(entries, null)).toBe(0);
  });

  test("the main button is the recommended rules while any is missing, with the rest in the ⋯", () => {
    expect(
      getRuleLibraryHeaderActions({
        recommendedNotAdded: 3,
        shownNotAdded: 28,
      }),
    ).toEqual({
      main: RuleLibraryHeaderAction.AddRecommended,
      more: [RuleLibraryHeaderAction.AddShown],
    });
    expect(
      getRuleLibraryHeaderActions({ recommendedNotAdded: 3, shownNotAdded: 0 }),
    ).toEqual({ main: RuleLibraryHeaderAction.AddRecommended, more: [] });
  });

  test("then the rules in sight; nothing to add, no button", () => {
    expect(
      getRuleLibraryHeaderActions({ recommendedNotAdded: 0, shownNotAdded: 4 }),
    ).toEqual({ main: RuleLibraryHeaderAction.AddShown, more: [] });
    expect(
      getRuleLibraryHeaderActions({ recommendedNotAdded: 0, shownNotAdded: 0 }),
    ).toEqual({ main: null, more: [] });
  });

  test("a project that sent nothing at all is told once", () => {
    expect(isNothingSent(NOTHING)).toBe(true);
    expect(isNothingSent(OKTA_AND_KUBERNETES)).toBe(false);
    expect(isNothingSent({ ...NOTHING, productNames: ["sudo"] })).toBe(false);
    // Not read yet, or not readable: not known to be nothing.
    expect(isNothingSent(null)).toBe(false);
    expect(isNothingSent(undefined)).toBe(false);
  });
});

describe("the filters in the page's address", () => {
  test("read back as they were written", () => {
    const written: RuleLibraryFilters = {
      category: DetectionRuleLibraryCategory.Cloud,
      data: LibraryDataFilter.NotReceived,
      status: LibraryStatusFilter.NotAdded,
      search: "access key",
    };
    const params: URLSearchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(
      getRuleLibraryQueryParams(written),
    )) {
      if (value) {
        params.set(key, value);
      }
    }

    expect(readRuleLibraryFilters(`?${params.toString()}`)).toEqual(written);
  });

  test("an unset filter is left out of the address", () => {
    expect(getRuleLibraryQueryParams(NO_RULE_LIBRARY_FILTERS)).toEqual({
      [RULE_LIBRARY_QUERY_KEYS.category]: null,
      [RULE_LIBRARY_QUERY_KEYS.data]: null,
      [RULE_LIBRARY_QUERY_KEYS.status]: null,
      [RULE_LIBRARY_QUERY_KEYS.search]: null,
    });
    expect(
      getRuleLibraryQueryParams(filters({ search: "   " }))[
        RULE_LIBRARY_QUERY_KEYS.search
      ],
    ).toBeNull();
  });

  test("an address with values the page does not know reads as no filter", () => {
    expect(
      readRuleLibraryFilters(
        "?category=Mainframe&data=sometimes&status=pending&search=",
      ),
    ).toEqual(NO_RULE_LIBRARY_FILTERS);
    expect(readRuleLibraryFilters("")).toEqual(NO_RULE_LIBRARY_FILTERS);
  });

  test("ATT&CK Coverage's link opens the library on a technique's search", () => {
    expect(readRuleLibraryFilters("?search=T1110").search).toBe("T1110");
    expect(
      readRuleLibraryFilters(`?${RULE_LIBRARY_QUERY_KEYS.category}=recommended`)
        .category,
    ).toBe(RECOMMENDED_FILTER);
  });
});

describe("what the project sends, in one grouped count", () => {
  const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
  const PROJECT_ID: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000001",
  );

  test("the last week's events of the project, counted by class, vendor and product over the whole window", () => {
    const aggregateBy: AggregateBy<SecurityEvent> =
      buildSecurityEventKindsAggregateBy({ projectId: PROJECT_ID, now: NOW });

    expect(aggregateBy.query).toEqual({ projectId: PROJECT_ID });
    expect(aggregateBy.aggregationType).toBe(AggregationType.Count);
    expect(aggregateBy.aggregateColumnName).toBe("eventUid");
    expect(aggregateBy.aggregationTimestampColumnName).toBe("time");
    expect(aggregateBy.aggregationInterval).toBe(AggregationInterval.Total);
    expect(aggregateBy.groupBy).toEqual({
      className: true,
      vendorName: true,
      productName: true,
    });
    expect(aggregateBy.endTimestamp).toEqual(NOW);
    expect(NOW.getTime() - aggregateBy.startTimestamp.getTime()).toBe(
      RULE_LIBRARY_DATA_WINDOW_IN_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(RULE_LIBRARY_DATA_WINDOW_IN_DAYS).toBe(7);
    expect(aggregateBy.sort).toEqual({ eventUid: SortOrder.Descending });
    expect(aggregateBy.limit).toBe(RULE_LIBRARY_DATA_GROUP_LIMIT);
    expect(aggregateBy.skip).toBe(0);
  });

  test("its rows as what the project sends: each value once, without the empty ones or the ones with no event", () => {
    const rows: Array<AggregatedModel> = [
      {
        className: "Authentication",
        vendorName: "Okta",
        productName: "Okta System Log",
        value: 120,
        timestamp: NOW,
      },
      {
        className: "Authentication",
        vendorName: " OpenSSH ",
        productName: "SSH",
        value: 4,
        timestamp: NOW,
      },
      {
        className: "Process Activity",
        vendorName: "",
        productName: "",
        value: 9,
        timestamp: NOW,
      },
      {
        className: "Network Activity",
        vendorName: "Palo Alto",
        productName: "PAN-OS",
        value: 0,
        timestamp: NOW,
      },
      {
        className: "Account Change",
        vendorName: "Okta",
        productName: "Okta System Log",
        value: Number.NaN,
        timestamp: NOW,
      },
    ];

    expect(readSecurityEventKindsSeen(rows)).toEqual({
      classNames: ["Authentication", "Process Activity"],
      vendorNames: ["Okta", "OpenSSH"],
      productNames: ["Okta System Log", "SSH"],
    });
    expect(readSecurityEventKindsSeen([])).toEqual(NOTHING);
  });
});

describe("the library's words", () => {
  test("every kind of event has its name, how to start sending it and where", () => {
    for (const kind of DETECTION_RULE_DATA_KINDS_IN_ORDER) {
      expect([kind, Boolean(DATA_KIND_TITLES[kind])]).toEqual([kind, true]);
      expect([kind, Boolean(DATA_KIND_HOW_TO_SEND[kind])]).toEqual([
        kind,
        true,
      ]);
      expect([
        kind,
        [
          PageMap.SECURITY_EVENTS_CONNECTIONS,
          PageMap.SECURITY_EVENTS_DOCUMENTATION,
        ].includes(DATA_KIND_SEND_PAGE[kind]),
      ]).toEqual([kind, true]);
    }
  });

  test("network events come from a firewall or a SIEM: the Setup Guide; everything else is connected or read from your logs", () => {
    for (const kind of DETECTION_RULE_DATA_KINDS_IN_ORDER) {
      const isNetwork: boolean = kind === DetectionRuleDataKind.NetworkActivity;

      expect([kind, DATA_KIND_SEND_PAGE[kind]]).toEqual([
        kind,
        isNetwork
          ? PageMap.SECURITY_EVENTS_DOCUMENTATION
          : PageMap.SECURITY_EVENTS_CONNECTIONS,
      ]);
      expect([kind, getDataKindSendLinkText(kind)]).toEqual([
        kind,
        isNetwork ? OPEN_SETUP_GUIDE : GO_TO_CONNECTIONS,
      ]);
    }
  });

  test("a rule's own words for its events show only when they say more than its kind", () => {
    const shown: Array<string> = [];

    for (const entry of DETECTION_RULE_LIBRARY) {
      const detail: string | null = getDataSourceDetail(entry);

      if (detail) {
        shown.push(detail);
      }
    }

    // "AWS CloudTrail events", "Okta System Log", "sudo logs", "Kubernetes audit logs": nothing more.
    expect(getDataSourceDetail(entryTitled("CloudTrail logging stopped"))).toBe(
      null,
    );
    expect(getDataSourceDetail(entryTitled("MFA push fatigue"))).toBe(null);
    expect(
      getDataSourceDetail(entryTitled("First sudo on a host by a user")),
    ).toBe(null);
    expect(getDataSourceDetail(entryTitled("Shell opened in a pod"))).toBe(
      null,
    );
    // Which process events, and from which sign-ins: kept.
    expect(getDataSourceDetail(SHADOW_COPIES)).toBe(
      "Process events from an EDR, Sysmon or Windows",
    );
    expect(getDataSourceDetail(BRUTE_FORCE)).toBe(
      "Authentication events from any source",
    );
    expect(shown.length).toBeGreaterThan(0);
  });
});

/*
 * Every sentence and label of the library's copy (RuleLibraryCopy): the
 * strings and the plurals' two sentences.
 */
function copyKeys(): Array<string> {
  const keys: Array<string> = [];

  const add: (value: unknown) => void = (value: unknown): void => {
    if (typeof value === "string") {
      keys.push(value);
      return;
    }

    if (value && typeof value === "object") {
      const record: Record<string, unknown> = value as Record<string, unknown>;

      if (
        typeof record["one"] === "string" &&
        typeof record["other"] === "string"
      ) {
        keys.push(record["other"] as string);
        keys.push(`${record["other"] as string}_one`);
        return;
      }

      for (const nested of Object.values(record)) {
        add(nested);
      }
    }
  };

  for (const [name, value] of Object.entries(RuleLibraryCopy)) {
    // Page names and functions are not words.
    if (name === "DATA_KIND_SEND_PAGE" || typeof value === "function") {
      continue;
    }

    add(value);
  }

  return Array.from(new Set(keys));
}

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(getLocalePath(code), "utf8"));
}

// The Dashboard's folder, from where its locale files are.
const DASHBOARD_DIRECTORY: string = path.join(
  path.dirname(getLocalePath("en")),
  "..",
  "..",
);

// English a language reads as English does: the global list and the language's own.
function readSameAsEnglish(code: string): Array<string> {
  const globalList: Array<string> = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_DIRECTORY, "i18n", "SameAsEnglish.json"),
      "utf8",
    ),
  );
  const progress: { sameAsEnglish?: Array<string> } = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_DIRECTORY, "i18n", "Progress", `${code}.json`),
      "utf8",
    ),
  );

  return [...globalList, ...(progress.sameAsEnglish || [])];
}

const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

/*
 * Labels the library shares with the rest of the product - the side menu's
 * "Rule Library", the categories, Severity, Rule, MITRE ATT&CK - which
 * every language already words as it does elsewhere (some keep English:
 * "MITRE ATT&CK" and "Sigma Rule" in most). Held only to be in every file;
 * the library's own words are held to be translated.
 */
const REUSED_LABELS: Array<string> = [
  "Rule Library",
  "Identity",
  "Endpoint",
  "Cloud",
  "Network",
  "Kubernetes",
  "Recommended",
  "Added",
  "Off",
  "Add",
  "Rule",
  "Severity",
  "Sigma Rule",
  "MITRE ATT&CK",
  "AWS CloudTrail",
  "Kubernetes audit logs",
  "Rule categories",
  "All categories",
  "Add {{count}} Recommended Rules",
  "Add {{count}} Recommended Rules_one",
  "Add All {{count}} Rules",
  "Add All {{count}} Rules_one",
];

describe("the library's words in every language", () => {
  const keys: Array<string> = copyKeys();

  test("the walk reaches the page's words", () => {
    for (const expected of [
      "Rule Library",
      "Receiving",
      "Not receiving",
      "Data you send",
      "Add {{count}} Matching Rules",
      "Add {{count}} Matching Rules_one",
      "Connect Okta to read its System Log.",
      "No security events arrived in the last 7 days, so no rule has anything to read yet.",
    ]) {
      expect([expected, keys.includes(expected)]).toEqual([expected, true]);
    }
  });

  test("en.json has every one, each plural with its one sentence", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const key of keys) {
      expect([key, typeof english[key]]).toEqual([key, "string"]);
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s words every one, or keeps the English it records as its own",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);
      const english: Record<string, unknown> = readLocale("en");
      const sameAsEnglish: Array<string> = readSameAsEnglish(code);

      expect(
        keys.filter((key: string): boolean => {
          return typeof locale[key] !== "string";
        }),
      ).toEqual([]);

      expect(
        keys.filter((key: string): boolean => {
          if (REUSED_LABELS.includes(key)) {
            return false;
          }
          if (key.endsWith("_one") && WITHOUT_ONE_FORM.includes(code)) {
            return false;
          }
          return (
            locale[key] === english[key] &&
            !sameAsEnglish.includes(String(english[key]))
          );
        }),
      ).toEqual([]);
    },
  );

  test("a count and a name keep their place in every language", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const code of TRANSLATED_LOCALES) {
      const locale: Record<string, unknown> = readLocale(code);

      for (const key of keys) {
        const englishValue: string = String(english[key]);

        for (const placeholder of ["{{count}}", "{{name}}"]) {
          if (englishValue.includes(placeholder)) {
            expect([
              code,
              key,
              String(locale[key]).includes(placeholder),
            ]).toEqual([code, key, true]);
          }
        }
      }
    }
  });
});
