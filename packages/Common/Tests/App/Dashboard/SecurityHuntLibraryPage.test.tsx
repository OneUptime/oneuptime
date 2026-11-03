import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import HuntLibraryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/HuntLibrary";
import { HUNTS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import { LibraryStatusFilter } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryUtil";
import { BUTTON_DISABLED_CLASS_NAME } from "../../../UI/Components/Button/Button";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import ObjectID from "../../../Types/ObjectID";
import { DetectionRuleLibraryCategory } from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import { SecurityHuntSchedule } from "../../../Types/SecurityEvent/SecurityHunt";
import {
  SECURITY_HUNT_LIBRARY,
  SecurityHuntLibraryEntry,
  getSecurityHuntLibraryEntry,
} from "../../../Types/SecurityEvent/SecurityHuntLibrary";
import TimeRange from "../../../Types/Time/TimeRange";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * SECURITY EVENTS > EVENTS > HUNT LIBRARY: ready-made hunts listed as the
 * Rule Library lists its rules - one row a starter: what it finds, its
 * search as typed on Events, the events it reads and whether the project
 * sends them, then Try it and Add, or Added and Open - narrowed by
 * category, data, status and a search kept in the page's address. Try it
 * opens the search on Events, nothing saved; Add saves it as a hunt of the
 * project's at once, in the reader's words, opened by hand.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ADDED_HUNT_ID: string = "3b000000-0000-4000-8000-000000000009";

function starter(id: string): SecurityHuntLibraryEntry {
  return getSecurityHuntLibraryEntry(id)!;
}

const FAILED_SIGN_INS: SecurityHuntLibraryEntry = starter("failed-sign-ins");
const ENCODED_POWERSHELL: SecurityHuntLibraryEntry =
  starter("encoded-powershell");
const POD_SHELLS: SecurityHuntLibraryEntry = starter("kubernetes-pod-shells");
const THREAT_INTEL: SecurityHuntLibraryEntry = starter("threat-intel-matches");

// The project's hunts, as the library reads them.
let hunts: Array<SecurityHunt> = [];
let huntReads: Array<Record<string, unknown>> = [];
let listFailure: HTTPErrorResponse | null = null;

// What the project's events say it sends: Okta's sign-ins and Kubernetes audit logs.
let sentRows: Array<AggregatedModel> = [];
let aggregateFailure: HTTPErrorResponse | null = null;
let aggregateRequests: Array<AggregateBy<SecurityEvent>> = [];
let navigated: Array<string> = [];

const OKTA_AND_KUBERNETES: Array<AggregatedModel> = [
  {
    className: "Authentication",
    vendorName: "Okta",
    productName: "Okta System Log",
    value: 4812,
    timestamp: new Date(),
  },
  {
    className: "API Activity",
    vendorName: "Kubernetes",
    productName: "Kubernetes audit log",
    value: 20114,
    timestamp: new Date(),
  },
];

function huntOf(libraryHuntId: string | null, id: string): SecurityHunt {
  const hunt: SecurityHunt = new SecurityHunt();
  hunt._id = id;
  hunt.libraryHuntId = libraryHuntId || undefined;
  return hunt;
}

beforeEach(() => {
  hunts = [];
  huntReads = [];
  listFailure = null;
  sentRows = OKTA_AND_KUBERNETES;
  aggregateFailure = null;
  aggregateRequests = [];
  navigated = [];
  window.history.replaceState(null, "", "/");
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(Navigation, "navigate").mockImplementation(((
    to: Route | { toString: () => string },
  ): void => {
    navigated.push(to.toString());
  }) as never);
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    options: Record<string, unknown>,
  ) => {
    huntReads.push(options);

    if (listFailure) {
      throw listFailure;
    }

    return {
      data: hunts,
      count: hunts.length,
      skip: 0,
      limit: 100,
    };
  }) as never);
  jest
    .spyOn(AnalyticsModelAPI, "aggregate")
    .mockImplementation(async (...args: Array<unknown>) => {
      aggregateRequests.push(
        (args[0] as { aggregateBy: AggregateBy<SecurityEvent> }).aggregateBy,
      );

      if (aggregateFailure) {
        throw aggregateFailure;
      }

      return { data: sentRows } as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

// The page, drawn once the project's hunts are read: `shown` is a starter in sight then.
async function renderPage(
  shown: SecurityHuntLibraryEntry = SECURITY_HUNT_LIBRARY[0]!,
): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  await act(async () => {
    render(
      <MemoryRouter>
        <HuntLibraryPage
          pageRoute={new Route("/dashboard/security-events/hunt-library")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  // The rows are drawn once the project's hunts are read.
  await waitFor(() => {
    expect(
      screen.queryByTestId(`${HUNTS_TEST_IDS.libraryEntry}-${shown.id}`),
    ).not.toBeNull();
  });
}

function row(entry: SecurityHuntLibraryEntry): HTMLElement {
  return screen.getByTestId(`${HUNTS_TEST_IDS.libraryEntry}-${entry.id}`);
}

function shownIds(): Array<string> {
  return SECURITY_HUNT_LIBRARY.filter(
    (entry: SecurityHuntLibraryEntry): boolean => {
      return (
        screen.queryByTestId(`${HUNTS_TEST_IDS.libraryEntry}-${entry.id}`) !==
        null
      );
    },
  ).map((entry: SecurityHuntLibraryEntry): string => {
    return entry.id;
  });
}

// The chip's own button - not its clear x - which opens its list.
function chipButton(testId: string): HTMLElement {
  return within(screen.getByTestId(testId)).getAllByRole("button")[0]!;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function pick(testId: string, optionName: string): Promise<void> {
  await click(chipButton(testId));
  await click(screen.getByRole("option", { name: optionName }));
}

async function chipOptions(testId: string): Promise<Array<string>> {
  await click(chipButton(testId));

  const names: Array<string> = screen
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return (option.textContent || "").trim();
    });

  await click(chipButton(testId));

  return names;
}

async function search(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByTestId(HUNTS_TEST_IDS.librarySearch), {
      target: { value: text },
    });
  });
}

// Each hunt Add created, as the page sent it.
function recordCreates(
  fail: (hunt: SecurityHunt) => HTTPErrorResponse | null = (): null => {
    return null;
  },
): Array<SecurityHunt> {
  const created: Array<SecurityHunt> = [];

  jest
    .spyOn(ModelAPI, "create")
    .mockImplementation(async (options: { model: BaseModel }) => {
      const hunt: SecurityHunt = options.model as SecurityHunt;
      const failure: HTTPErrorResponse | null = fail(hunt);

      if (failure) {
        throw failure;
      }

      created.push(hunt);
      return { data: { _id: ADDED_HUNT_ID } } as never;
    });

  return created;
}

describe("the library as a list to scan", () => {
  test("one row a starter, in the library's order, every one in sight, counted", async () => {
    await renderPage();

    expect(shownIds()).toEqual(
      SECURITY_HUNT_LIBRARY.map((entry: SecurityHuntLibraryEntry) => {
        return entry.id;
      }),
    );
    expect(screen.getByTestId(HUNTS_TEST_IDS.libraryCount)).toHaveTextContent(
      `${SECURITY_HUNT_LIBRARY.length} hunts`,
    );
  });

  test("reads the project's hunts once, with the starter each was added from", async () => {
    await renderPage();

    expect(huntReads).toHaveLength(1);
    expect(huntReads[0]!["modelType"]).toBe(SecurityHunt);
    expect(huntReads[0]!["select"]).toEqual({
      _id: true,
      libraryHuntId: true,
    });
    expect(huntReads[0]!["query"]).toEqual({ projectId: PROJECT_ID });
  });

  test("a row says what the starter finds, and its search exactly as it would be typed on Events", async () => {
    await renderPage();

    const hunt: HTMLElement = within(row(ENCODED_POWERSHELL)).getByTestId(
      `${HUNTS_TEST_IDS.libraryEntry}-hunt-${ENCODED_POWERSHELL.id}`,
    );

    expect(hunt).toHaveTextContent(ENCODED_POWERSHELL.title);
    expect(hunt).toHaveTextContent(ENCODED_POWERSHELL.description);

    const searchLine: HTMLElement = within(hunt).getByTestId(
      `${HUNTS_TEST_IDS.libraryEntry}-search-${ENCODED_POWERSHELL.id}`,
    );

    expect(searchLine.tagName).toBe("CODE");
    expect(searchLine).toHaveTextContent(ENCODED_POWERSHELL.searchQuery);
    // A search reads left to right, whatever the page's direction.
    expect(searchLine).toHaveAttribute("dir", "ltr");
    expect(searchLine).toHaveAttribute("title", ENCODED_POWERSHELL.searchQuery);
  });

  test("a starter the project has says Added and opens its hunt; one it lacks offers Try it and Add", async () => {
    hunts = [
      huntOf("encoded-powershell", ADDED_HUNT_ID),
      huntOf(null, "3b000000-0000-4000-8000-000000000001"),
    ];
    await renderPage();

    expect(row(ENCODED_POWERSHELL)).toHaveAttribute("data-added", "true");
    expect(
      within(row(ENCODED_POWERSHELL)).getByTestId(
        `${HUNTS_TEST_IDS.libraryAdded}-${ENCODED_POWERSHELL.id}`,
      ),
    ).toHaveTextContent("Added");
    expect(
      within(row(ENCODED_POWERSHELL)).getByTestId(
        `${HUNTS_TEST_IDS.libraryOpen}-${ENCODED_POWERSHELL.id}`,
      ),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/security-events/hunts/${ADDED_HUNT_ID}`),
    );
    expect(
      within(row(ENCODED_POWERSHELL)).queryByTestId(
        `${HUNTS_TEST_IDS.libraryAdd}-${ENCODED_POWERSHELL.id}`,
      ),
    ).toBeNull();

    expect(row(FAILED_SIGN_INS)).toHaveAttribute("data-added", "false");
    expect(
      within(row(FAILED_SIGN_INS)).getByTestId(
        `${HUNTS_TEST_IDS.libraryTry}-${FAILED_SIGN_INS.id}`,
      ),
    ).toHaveTextContent("Try it");
    expect(
      within(row(FAILED_SIGN_INS)).getByTestId(
        `${HUNTS_TEST_IDS.libraryAdd}-${FAILED_SIGN_INS.id}`,
      ),
    ).toHaveTextContent("Add");
  });
});

describe("whether the project sends what each starter reads", () => {
  test("one grouped count of the last week's events, as the Rule Library reads it", async () => {
    await renderPage();

    expect(aggregateRequests).toHaveLength(1);
    expect(aggregateRequests[0]!.groupBy).toEqual({
      className: true,
      vendorName: true,
      productName: true,
    });
    expect(aggregateRequests[0]!.query).toEqual({ projectId: PROJECT_ID });
  });

  test("a starter whose events arrived says Receiving; one whose did not says Not receiving, in words of a hunt", async () => {
    await renderPage();

    const dataStatus: (entry: SecurityHuntLibraryEntry) => HTMLElement = (
      entry: SecurityHuntLibraryEntry,
    ): HTMLElement => {
      return screen.getByTestId(
        `${HUNTS_TEST_IDS.libraryEntry}-data-status-${entry.id}`,
      );
    };

    await waitFor(() => {
      expect(dataStatus(FAILED_SIGN_INS)).toHaveTextContent("Receiving");
    });
    expect(dataStatus(POD_SHELLS)).toHaveAttribute("data-status", "received");
    expect(dataStatus(ENCODED_POWERSHELL)).toHaveTextContent("Not receiving");
    // A starter is no rule that runs: its dot says what a hunt finds.
    expect(dataStatus(ENCODED_POWERSHELL)).toHaveAttribute(
      "title",
      "No events of this kind arrived in the last 7 days. The hunt finds nothing until they do.",
    );
    expect(dataStatus(FAILED_SIGN_INS)).toHaveAttribute(
      "title",
      "Events of this kind arrived in the last 7 days.",
    );
    // A threat intel match is stamped on any event: any event will do.
    expect(
      screen.getByTestId(
        `${HUNTS_TEST_IDS.libraryEntry}-data-${THREAT_INTEL.id}`,
      ),
    ).toHaveTextContent("Any security events");
    expect(dataStatus(THREAT_INTEL)).toHaveTextContent("Receiving");
  });

  test("events that could not be read: said once, the starters listed without it, no Data chip, and Try again", async () => {
    aggregateFailure = new HTTPErrorResponse(500, { message: "x" }, {});
    await renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(HUNTS_TEST_IDS.libraryDataUnknown),
      ).toHaveTextContent("Could not check which events this project sends.");
    });
    expect(
      document.querySelectorAll(
        `[data-testid^="${HUNTS_TEST_IDS.libraryEntry}-data-status-"]`,
      ),
    ).toHaveLength(0);
    expect(screen.queryByTestId(HUNTS_TEST_IDS.libraryDataFilter)).toBeNull();
    expect(shownIds()).toHaveLength(SECURITY_HUNT_LIBRARY.length);

    aggregateFailure = null;
    await click(
      screen.getByTestId(`${HUNTS_TEST_IDS.libraryDataUnknown}-retry`),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${HUNTS_TEST_IDS.libraryEntry}-data-status-${FAILED_SIGN_INS.id}`,
        ),
      ).toHaveTextContent("Receiving");
    });
    expect(screen.queryByTestId(HUNTS_TEST_IDS.libraryDataUnknown)).toBeNull();
    expect(
      screen.getByTestId(HUNTS_TEST_IDS.libraryDataFilter),
    ).toBeInTheDocument();
    expect(aggregateRequests).toHaveLength(2);
  });

  test("a project that sent nothing this week is told once, with the way to Connections - and offered no Data chip", async () => {
    sentRows = [];
    await renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(HUNTS_TEST_IDS.libraryNothingSent),
      ).toHaveTextContent(
        "No security events arrived in the last 7 days, so no hunt has anything to find yet.",
      );
    });
    expect(
      screen.getByTestId(`${HUNTS_TEST_IDS.libraryNothingSent}-link`),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/security-events/connections"),
    );
    expect(
      document.querySelectorAll(
        `[data-testid^="${HUNTS_TEST_IDS.libraryEntry}-data-status-"]`,
      ),
    ).toHaveLength(0);
    expect(screen.queryByTestId(HUNTS_TEST_IDS.libraryDataFilter)).toBeNull();
  });
});

describe("narrowing the library", () => {
  test("the chips every list has: Hunt category, Data and Status, none picked at first", async () => {
    await renderPage();

    const filters: HTMLElement = screen.getByTestId(
      HUNTS_TEST_IDS.libraryFilters,
    );

    expect(filters).toHaveAttribute("role", "group");
    expect(filters).toHaveAttribute("aria-label", "Filters");
    expect(
      [
        HUNTS_TEST_IDS.libraryCategoryFilter,
        HUNTS_TEST_IDS.libraryDataFilter,
        HUNTS_TEST_IDS.libraryStatusFilter,
      ].map((testId: string): string => {
        return (chipButton(testId).textContent || "").trim();
      }),
    ).toEqual(["Hunt category", "Data", "Status"]);
    expect(within(filters).queryAllByTestId("filter-chip-clear")).toHaveLength(
      0,
    );
  });

  test("the category chip offers the categories with starters, in the Rule Library's order", async () => {
    await renderPage();

    expect(await chipOptions(HUNTS_TEST_IDS.libraryCategoryFilter)).toEqual([
      "Identity",
      "Endpoint",
      "Cloud",
      "Network",
      "Web",
      "Kubernetes",
    ]);
  });

  test("a category lists just its starters, and says how many", async () => {
    await renderPage();

    await pick(
      HUNTS_TEST_IDS.libraryCategoryFilter,
      DetectionRuleLibraryCategory.Kubernetes,
    );

    expect(shownIds()).toEqual([POD_SHELLS.id]);
    expect(screen.getByTestId(HUNTS_TEST_IDS.libraryCount)).toHaveTextContent(
      "1 hunt",
    );
    expect(chipButton(HUNTS_TEST_IDS.libraryCategoryFilter)).toHaveTextContent(
      "Hunt category · Kubernetes",
    );
  });

  test("Data lists the starters whose events arrive, or the others", async () => {
    await renderPage();
    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${HUNTS_TEST_IDS.libraryEntry}-data-status-${FAILED_SIGN_INS.id}`,
        ),
      ).toBeInTheDocument();
    });

    await pick(HUNTS_TEST_IDS.libraryDataFilter, "Receiving");

    expect(shownIds()).toEqual(
      expect.arrayContaining([
        FAILED_SIGN_INS.id,
        POD_SHELLS.id,
        THREAT_INTEL.id,
      ]),
    );
    expect(shownIds()).not.toContain(ENCODED_POWERSHELL.id);
  });

  test("Status lists the starters the project has, or the ones it lacks", async () => {
    hunts = [huntOf("encoded-powershell", ADDED_HUNT_ID)];
    await renderPage();

    await pick(HUNTS_TEST_IDS.libraryStatusFilter, "Added");
    expect(shownIds()).toEqual([ENCODED_POWERSHELL.id]);

    await pick(HUNTS_TEST_IDS.libraryStatusFilter, "Not added");
    expect(shownIds()).toHaveLength(SECURITY_HUNT_LIBRARY.length - 1);
    expect(shownIds()).not.toContain(ENCODED_POWERSHELL.id);
  });

  test("the search narrows by what a starter finds and its search, and nothing found says so with the way back", async () => {
    await renderPage();

    await search("powershell");
    expect(shownIds()).toEqual([ENCODED_POWERSHELL.id]);

    await search("no starter looks for this");
    expect(shownIds()).toEqual([]);

    const empty: HTMLElement = screen.getByTestId(
      HUNTS_TEST_IDS.libraryNoMatch,
    );

    // The title, as every list's empty state draws one: without its full stop.
    expect(empty).toHaveTextContent("No hunt matches your search or filters");

    await click(within(empty).getByRole("button", { name: "Clear Search" }));
    expect(shownIds()).toHaveLength(SECURITY_HUNT_LIBRARY.length);
    expect(screen.getByTestId(HUNTS_TEST_IDS.librarySearch)).toHaveValue("");
  });

  test("the filters are written into the page's address, an unset one left out", async () => {
    await renderPage();

    await pick(
      HUNTS_TEST_IDS.libraryCategoryFilter,
      DetectionRuleLibraryCategory.Cloud,
    );
    await pick(HUNTS_TEST_IDS.libraryStatusFilter, "Not added");
    await search("root");

    const params: URLSearchParams = new URLSearchParams(window.location.search);

    expect(params.get("category")).toBe(DetectionRuleLibraryCategory.Cloud);
    expect(params.get("status")).toBe(LibraryStatusFilter.NotAdded);
    expect(params.get("search")).toBe("root");
    expect(params.has("data")).toBe(false);
  });

  test("a page opened on an address with filters opens filtered, its search open", async () => {
    window.history.replaceState(null, "", "/?search=aws&category=Cloud");
    await renderPage(starter("aws-root-account-activity"));

    expect(screen.getByTestId(HUNTS_TEST_IDS.librarySearch)).toHaveValue("aws");
    expect(chipButton(HUNTS_TEST_IDS.libraryCategoryFilter)).toHaveTextContent(
      "Hunt category · Cloud",
    );

    for (const id of shownIds()) {
      expect(starter(id).category).toBe(DetectionRuleLibraryCategory.Cloud);
    }

    expect(shownIds().length).toBeGreaterThan(0);
  });
});

describe("Try it", () => {
  test("opens the starter's search on Events, over its window, nothing saved", async () => {
    const created: Array<SecurityHunt> = recordCreates();
    await renderPage();

    await click(
      screen.getByTestId(
        `${HUNTS_TEST_IDS.libraryTry}-${ENCODED_POWERSHELL.id}`,
      ),
    );

    expect(navigated).toHaveLength(1);

    const [path, query] = navigated[0]!.split("?");
    const params: URLSearchParams = new URLSearchParams(query || "");

    expect(path!.endsWith(`/${PROJECT_ID.toString()}/security-events`)).toBe(
      true,
    );
    expect(params.get("search")).toBe(ENCODED_POWERSHELL.searchQuery);
    expect(params.get("range")).toBe(TimeRange.PAST_ONE_WEEK);
    expect(created).toEqual([]);
  });
});

describe("Add", () => {
  test("saves the starter as a hunt of the project's - its words, its search over its window, opened by hand - and the row says Added", async () => {
    const created: Array<SecurityHunt> = recordCreates();
    await renderPage();

    await click(
      screen.getByTestId(
        `${HUNTS_TEST_IDS.libraryAdd}-${ENCODED_POWERSHELL.id}`,
      ),
    );

    expect(created).toHaveLength(1);
    expect(created[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(created[0]!.name).toBe(ENCODED_POWERSHELL.title);
    expect(created[0]!.description).toBe(ENCODED_POWERSHELL.description);
    expect(created[0]!.searchQuery).toBe(ENCODED_POWERSHELL.searchQuery);
    expect(created[0]!.timeRange).toBe(ENCODED_POWERSHELL.timeRange);
    expect(created[0]!.schedule).toBe(SecurityHuntSchedule.NotScheduled);
    expect(created[0]!.libraryHuntId).toBe(ENCODED_POWERSHELL.id);

    await waitFor(() => {
      expect(
        within(row(ENCODED_POWERSHELL)).getByTestId(
          `${HUNTS_TEST_IDS.libraryOpen}-${ENCODED_POWERSHELL.id}`,
        ),
      ).toHaveAttribute(
        "href",
        expect.stringContaining(`/security-events/hunts/${ADDED_HUNT_ID}`),
      );
    });
    expect(row(ENCODED_POWERSHELL)).toHaveAttribute("data-added", "true");
  });

  test("while one Add is on its way, the other rows' Adds wait", async () => {
    let finishCreate: () => void = (): void => {
      // Replaced below.
    };
    jest.spyOn(ModelAPI, "create").mockImplementation((() => {
      return new Promise((resolve: (value: unknown) => void) => {
        finishCreate = () => {
          resolve({ data: { _id: ADDED_HUNT_ID } });
        };
      });
    }) as never);
    await renderPage();

    await click(
      screen.getByTestId(`${HUNTS_TEST_IDS.libraryAdd}-${FAILED_SIGN_INS.id}`),
    );

    const other: HTMLElement = screen.getByTestId(
      `${HUNTS_TEST_IDS.libraryAdd}-${POD_SHELLS.id}`,
    );

    expect(other).toBeDisabled();
    expect(other.className).toContain(BUTTON_DISABLED_CLASS_NAME);

    await act(async () => {
      finishCreate();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId(`${HUNTS_TEST_IDS.libraryAdd}-${POD_SHELLS.id}`),
      ).not.toBeDisabled();
    });
  });

  test("an Add that fails says why on its row, as an alert, and the row still offers Add", async () => {
    recordCreates((): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        400,
        { message: "This project keeps 200 hunts already." },
        {},
      );
    });
    await renderPage();

    await click(
      screen.getByTestId(`${HUNTS_TEST_IDS.libraryAdd}-${POD_SHELLS.id}`),
    );

    const why: HTMLElement = await screen.findByTestId(
      `${HUNTS_TEST_IDS.libraryProblem}-${POD_SHELLS.id}`,
    );

    expect(why).toHaveTextContent("This project keeps 200 hunts already.");
    expect(why).toHaveAttribute("role", "alert");
    expect(row(POD_SHELLS)).toHaveAttribute("data-added", "false");
    expect(
      screen.getByTestId(`${HUNTS_TEST_IDS.libraryAdd}-${POD_SHELLS.id}`),
    ).not.toBeDisabled();
  });

  test("a role that may not add hunts sees every Add locked, and may still Try it", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "Your role cannot create hunts.",
    });
    await renderPage();

    const add: HTMLElement = screen.getByTestId(
      `${HUNTS_TEST_IDS.libraryAdd}-${FAILED_SIGN_INS.id}`,
    );

    expect(add).toBeDisabled();
    expect(add.className).toContain(BUTTON_DISABLED_CLASS_NAME);
    expect(
      screen.getByTestId(`${HUNTS_TEST_IDS.libraryTry}-${FAILED_SIGN_INS.id}`),
    ).not.toBeDisabled();
  });
});

describe("a library whose hunts cannot be read", () => {
  test("says so with Try again, lists nothing to add, and lists again once read", async () => {
    listFailure = new HTTPErrorResponse(500, { message: "Server Error" }, {});
    const project: Project = new Project();
    project.id = PROJECT_ID;

    await act(async () => {
      render(
        <MemoryRouter>
          <HuntLibraryPage
            pageRoute={new Route("/dashboard/security-events/hunt-library")}
            currentProject={project}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });

    const error: HTMLElement = await screen.findByTestId(
      `${HUNTS_TEST_IDS.libraryTable}-load-error`,
    );

    expect(shownIds()).toEqual([]);
    // No count over a list that is not there.
    expect(screen.queryByTestId(HUNTS_TEST_IDS.libraryCount)).toBeNull();

    listFailure = null;
    await click(within(error).getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(shownIds()).toHaveLength(SECURITY_HUNT_LIBRARY.length);
    });
  });
});
