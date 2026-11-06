import {
  ExistingHunt,
  HUNT_LIBRARY_QUERY_KEYS,
  HuntLibraryFilters,
  HuntLibraryView,
  NO_HUNT_LIBRARY_FILTERS,
  buildHuntFromLibrary,
  countHuntLibraryChipFilters,
  findHuntOfStarter,
  getEffectiveHuntLibraryFilters,
  getFilteredHuntLibraryViews,
  getHuntLibraryDataStatus,
  getHuntLibraryQueryParams,
  getHuntLibrarySearchText,
  getHuntLibraryTryRoute,
  getHuntLibraryView,
  isHuntLibraryFiltered,
  readHuntLibraryFilters,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntLibraryModel";
import {
  LibraryDataFilter,
  LibraryRuleDataStatus,
  LibraryStatusFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryUtil";
import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEventKindsSeen } from "../../../Types/SecurityEvent/DetectionRuleDataKind";
import { DetectionRuleLibraryCategory } from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import { SecurityHuntSchedule } from "../../../Types/SecurityEvent/SecurityHunt";
import {
  SECURITY_HUNT_LIBRARY,
  SecurityHuntLibraryEntry,
  getSecurityHuntLibraryEntry,
} from "../../../Types/SecurityEvent/SecurityHuntLibrary";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE HUNT LIBRARY'S SMALL RULES, React-free (HuntLibraryModel): which
 * starters the project has as hunts already, whether it sends what each
 * reads, the filters and the search over them - kept in the page's address
 * as the Rule Library keeps its own - the hunt Add saves, and where Try it
 * opens.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

function starter(id: string): SecurityHuntLibraryEntry {
  const entry: SecurityHuntLibraryEntry | undefined =
    getSecurityHuntLibraryEntry(id);

  expect(entry).toBeDefined();
  return entry!;
}

const FAILED_SIGN_INS: SecurityHuntLibraryEntry = starter("failed-sign-ins");
const ENCODED_POWERSHELL: SecurityHuntLibraryEntry =
  starter("encoded-powershell");
const THREAT_INTEL: SecurityHuntLibraryEntry = starter("threat-intel-matches");
const POD_SHELLS: SecurityHuntLibraryEntry = starter("kubernetes-pod-shells");

// What the project's events say it sends: Okta's sign-ins and Kubernetes audit logs.
const OKTA_AND_KUBERNETES: SecurityEventKindsSeen = {
  classNames: ["Authentication", "API Activity"],
  vendorNames: ["Okta", "Kubernetes"],
  productNames: ["Okta System Log", "Kubernetes audit log"],
};

const NOTHING_SENT: SecurityEventKindsSeen = {
  classNames: [],
  vendorNames: [],
  productNames: [],
};

// A translator into a language of its own: each key, marked.
const german: Translator = {
  translateText: (text: string): string => {
    const words: Record<string, string> = {
      "Encoded PowerShell": "Kodiertes PowerShell",
      [ENCODED_POWERSHELL.description]:
        "PowerShell wurde mit einem kodierten Befehl gestartet.",
      Endpoint: "Endgerät",
      "Process events": "Prozessereignisse",
    };

    return words[text] || text;
  },
} as unknown as Translator;

function filters(values: Partial<HuntLibraryFilters> = {}): HuntLibraryFilters {
  return { ...NO_HUNT_LIBRARY_FILTERS, ...values };
}

function shownIds(views: Array<HuntLibraryView>): Array<string> {
  return views.map((view: HuntLibraryView): string => {
    return view.entry.id;
  });
}

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a starter the project has", () => {
  test("is known by the id its hunt keeps, however the team renamed it", () => {
    const hunts: Array<ExistingHunt> = [
      { id: "h-1", libraryHuntId: null },
      { id: "h-2", libraryHuntId: "encoded-powershell" },
      { id: "h-3", libraryHuntId: "encoded-powershell" },
    ];

    expect(findHuntOfStarter(ENCODED_POWERSHELL, hunts)?.id).toBe("h-2");
    expect(findHuntOfStarter(FAILED_SIGN_INS, hunts)).toBeUndefined();
    expect(getHuntLibraryView(ENCODED_POWERSHELL, hunts).addedHuntId).toBe(
      "h-2",
    );
    expect(getHuntLibraryView(FAILED_SIGN_INS, hunts).addedHuntId).toBeNull();
  });
});

describe("whether the project sends what a starter reads", () => {
  test("not known until the events are read", () => {
    expect(getHuntLibraryDataStatus(FAILED_SIGN_INS, null)).toBe(
      LibraryRuleDataStatus.Unknown,
    );
    expect(getHuntLibraryDataStatus(THREAT_INTEL, undefined)).toBe(
      LibraryRuleDataStatus.Unknown,
    );
  });

  test("then whether events of its kind arrived, as the Rule Library says it of a rule", () => {
    expect(getHuntLibraryDataStatus(FAILED_SIGN_INS, OKTA_AND_KUBERNETES)).toBe(
      LibraryRuleDataStatus.Received,
    );
    expect(getHuntLibraryDataStatus(POD_SHELLS, OKTA_AND_KUBERNETES)).toBe(
      LibraryRuleDataStatus.Received,
    );
    expect(
      getHuntLibraryDataStatus(ENCODED_POWERSHELL, OKTA_AND_KUBERNETES),
    ).toBe(LibraryRuleDataStatus.NotReceived);
  });

  test("a starter that reads any event has something to read once any event arrived", () => {
    expect(getHuntLibraryDataStatus(THREAT_INTEL, OKTA_AND_KUBERNETES)).toBe(
      LibraryRuleDataStatus.Received,
    );
    expect(getHuntLibraryDataStatus(THREAT_INTEL, NOTHING_SENT)).toBe(
      LibraryRuleDataStatus.NotReceived,
    );
  });
});

describe("the filters in the page's address", () => {
  test("read as the Rule Library's: category, data, status and search, under the same names", () => {
    expect(HUNT_LIBRARY_QUERY_KEYS).toEqual({
      category: "category",
      data: "data",
      status: "status",
      search: "search",
    });
    expect(
      readHuntLibraryFilters(
        "?category=Endpoint&data=not-received&status=added&search=powershell",
      ),
    ).toEqual({
      category: DetectionRuleLibraryCategory.Endpoint,
      data: LibraryDataFilter.NotReceived,
      status: LibraryStatusFilter.Added,
      search: "powershell",
    });
  });

  test("a value the library does not offer reads as no filter - Data security has no starter", () => {
    expect(
      readHuntLibraryFilters(
        "?category=Data%20security&data=sometimes&status=maybe",
      ),
    ).toEqual(NO_HUNT_LIBRARY_FILTERS);
    expect(readHuntLibraryFilters("")).toEqual(NO_HUNT_LIBRARY_FILTERS);
    expect(readHuntLibraryFilters("?category=Recommended").category).toBe("");
  });

  test("are written with an unset filter left out, and a blank search none", () => {
    expect(getHuntLibraryQueryParams(NO_HUNT_LIBRARY_FILTERS)).toEqual({
      category: null,
      data: null,
      status: null,
      search: null,
    });
    expect(
      getHuntLibraryQueryParams(
        filters({
          category: DetectionRuleLibraryCategory.Cloud,
          status: LibraryStatusFilter.NotAdded,
          search: "  root  ",
        }),
      ),
    ).toEqual({
      category: DetectionRuleLibraryCategory.Cloud,
      data: null,
      status: LibraryStatusFilter.NotAdded,
      search: "root",
    });
    expect(
      getHuntLibraryQueryParams(filters({ search: "   " }))["search"],
    ).toBeNull();
  });

  test("a written address reads back as the same filters", () => {
    const written: HuntLibraryFilters = filters({
      category: DetectionRuleLibraryCategory.Kubernetes,
      data: LibraryDataFilter.Received,
      status: LibraryStatusFilter.NotAdded,
      search: "pod shell",
    });
    const params: URLSearchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(
      getHuntLibraryQueryParams(written),
    )) {
      if (value) {
        params.set(key, value);
      }
    }

    expect(readHuntLibraryFilters(`?${params.toString()}`)).toEqual(written);
  });

  test("narrow the list by a chip, or a search with words in it", () => {
    expect(isHuntLibraryFiltered(NO_HUNT_LIBRARY_FILTERS)).toBe(false);
    expect(isHuntLibraryFiltered(filters({ search: "  " }))).toBe(false);
    expect(isHuntLibraryFiltered(filters({ search: "aws" }))).toBe(true);
    expect(
      isHuntLibraryFiltered(
        filters({ category: DetectionRuleLibraryCategory.Web }),
      ),
    ).toBe(true);
    expect(
      isHuntLibraryFiltered(filters({ status: LibraryStatusFilter.Added })),
    ).toBe(true);
  });

  test("the Data chip narrows, and counts, only while it is offered", () => {
    const withData: HuntLibraryFilters = filters({
      category: DetectionRuleLibraryCategory.Identity,
      data: LibraryDataFilter.Received,
    });

    expect(countHuntLibraryChipFilters(withData, true)).toBe(2);
    expect(countHuntLibraryChipFilters(withData, false)).toBe(1);
    expect(getEffectiveHuntLibraryFilters(withData, false).data).toBe(
      LibraryDataFilter.Any,
    );
    expect(getEffectiveHuntLibraryFilters(withData, true)).toBe(withData);
    // The search is not a chip.
    expect(countHuntLibraryChipFilters(filters({ search: "aws" }), true)).toBe(
      0,
    );
  });
});

describe("the starters in sight", () => {
  function shown(
    values: Partial<HuntLibraryFilters>,
    options: {
      existingHunts?: Array<ExistingHunt>;
      seen?: SecurityEventKindsSeen | null;
      translator?: Translator;
    } = {},
  ): Array<string> {
    return shownIds(
      getFilteredHuntLibraryViews({
        filters: filters(values),
        existingHunts: options.existingHunts || [],
        seen: options.seen === undefined ? OKTA_AND_KUBERNETES : options.seen,
        translator: options.translator,
      }),
    );
  }

  test("with no filter, every starter, in the library's own order", () => {
    expect(shown({})).toEqual(
      SECURITY_HUNT_LIBRARY.map((entry: SecurityHuntLibraryEntry): string => {
        return entry.id;
      }),
    );
  });

  test("a category, its starters alone", () => {
    expect(
      shown({ category: DetectionRuleLibraryCategory.Kubernetes }),
    ).toEqual(["kubernetes-pod-shells"]);
    for (const id of shown({ category: DetectionRuleLibraryCategory.Cloud })) {
      expect(starter(id).category).toBe(DetectionRuleLibraryCategory.Cloud);
    }
  });

  test("Data: the starters whose events arrive, or the others", () => {
    const received: Array<string> = shown({ data: LibraryDataFilter.Received });
    const notReceived: Array<string> = shown({
      data: LibraryDataFilter.NotReceived,
    });

    expect(received).toEqual(
      expect.arrayContaining([
        "failed-sign-ins",
        "okta-admin-privileges-granted",
        "kubernetes-pod-shells",
        "threat-intel-matches",
      ]),
    );
    expect(received).not.toContain("encoded-powershell");
    expect(notReceived).toContain("encoded-powershell");
    expect(received.length + notReceived.length).toBe(
      SECURITY_HUNT_LIBRARY.length,
    );
    // Not known: none is either, so a Data chip narrows to nothing.
    expect(shown({ data: LibraryDataFilter.Received }, { seen: null })).toEqual(
      [],
    );
  });

  test("Status: the starters the project has, or the ones it lacks", () => {
    const existingHunts: Array<ExistingHunt> = [
      { id: "h-1", libraryHuntId: "encoded-powershell" },
      { id: "h-2", libraryHuntId: null },
    ];

    expect(
      shown({ status: LibraryStatusFilter.Added }, { existingHunts }),
    ).toEqual(["encoded-powershell"]);
    expect(
      shown({ status: LibraryStatusFilter.NotAdded }, { existingHunts }),
    ).not.toContain("encoded-powershell");
    expect(
      shown({ status: LibraryStatusFilter.NotAdded }, { existingHunts }),
    ).toHaveLength(SECURITY_HUNT_LIBRARY.length - 1);
  });

  test("the search: every word, in any case, over the title, what it finds, its search, category and events", () => {
    expect(shown({ search: "POWERSHELL encoded" })).toEqual([
      "encoded-powershell",
    ]);
    // Its search as typed on Events.
    expect(shown({ search: "commandline:-enc" })).toEqual([
      "encoded-powershell",
    ]);
    // Its category and the events it reads.
    expect(shown({ search: "kubernetes" })).toEqual(["kubernetes-pod-shells"]);
    expect(shown({ search: "cloudtrail" }).length).toBeGreaterThan(0);
    expect(shown({ search: "no starter says this" })).toEqual([]);
  });

  test("the search finds a starter in the reader's language as well as in English", () => {
    expect(shown({ search: "kodiertes" }, { translator: german })).toEqual([
      "encoded-powershell",
    ]);
    expect(
      shown({ search: "prozessereignisse" }, { translator: german }),
    ).toEqual(expect.arrayContaining(["encoded-powershell"]));
    expect(shown({ search: "encoded" }, { translator: german })).toEqual([
      "encoded-powershell",
    ]);
    expect(getHuntLibrarySearchText(ENCODED_POWERSHELL, german)).toContain(
      "endgerät",
    );
  });

  test("filters together narrow together", () => {
    expect(
      shown({
        category: DetectionRuleLibraryCategory.Identity,
        data: LibraryDataFilter.Received,
        search: "okta",
      }),
    ).toEqual(["okta-admin-privileges-granted"]);
  });
});

describe("Add", () => {
  test("saves the starter as a hunt of the project's: in the reader's words, its search over its window, opened by hand, keeping the starter's id", () => {
    const hunt: SecurityHunt = buildHuntFromLibrary({
      entry: ENCODED_POWERSHELL,
      projectId: new ObjectID(PROJECT_ID),
      translator: german,
    });

    expect(hunt.projectId?.toString()).toBe(PROJECT_ID);
    expect(hunt.name).toBe("Kodiertes PowerShell");
    expect(hunt.description).toBe(
      "PowerShell wurde mit einem kodierten Befehl gestartet.",
    );
    // A search is what a person types: never translated.
    expect(hunt.searchQuery).toBe(ENCODED_POWERSHELL.searchQuery);
    expect(hunt.filters).toEqual({});
    expect(hunt.timeRange).toBe(TimeRange.PAST_ONE_WEEK);
    expect(hunt.schedule).toBe(SecurityHuntSchedule.NotScheduled);
    expect(hunt.libraryHuntId).toBe("encoded-powershell");
  });

  test("in English, the starter's own words", () => {
    const hunt: SecurityHunt = buildHuntFromLibrary({
      entry: FAILED_SIGN_INS,
      projectId: new ObjectID(PROJECT_ID),
      translator: {
        translateText: (text: string): string => {
          return text;
        },
      } as unknown as Translator,
    });

    expect(hunt.name).toBe(FAILED_SIGN_INS.title);
    expect(hunt.description).toBe(FAILED_SIGN_INS.description);
    expect(hunt.timeRange).toBe(FAILED_SIGN_INS.timeRange);
  });
});

describe("Try it", () => {
  test("opens Events searching what the starter searches, over its window - a link a person could paste", () => {
    const route: string = getHuntLibraryTryRoute(ENCODED_POWERSHELL).toString();
    const [path, query] = route.split("?");
    const params: URLSearchParams = new URLSearchParams(query || "");

    expect(path!.endsWith(`/${PROJECT_ID}/security-events`)).toBe(true);
    expect(params.get("search")).toBe(ENCODED_POWERSHELL.searchQuery);
    expect(params.get("range")).toBe(TimeRange.PAST_ONE_WEEK);
  });

  test("a search with quotes, colons and brackets arrives as written", () => {
    for (const entry of SECURITY_HUNT_LIBRARY) {
      const query: string =
        getHuntLibraryTryRoute(entry).toString().split("?")[1] || "";

      expect(new URLSearchParams(query).get("search")).toBe(entry.searchQuery);
      expect(new URLSearchParams(query).get("range")).toBe(entry.timeRange);
    }
  });
});
