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
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import {
  LibraryDataFilter,
  LibraryStatusFilter,
  RECOMMENDED_FILTER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryUtil";
import RuleLibraryPage, {
  RULE_LIBRARY_CATEGORY_SELECT_TEST_ID,
  RULE_LIBRARY_DATA_SELECT_TEST_ID,
  RULE_LIBRARY_SEARCH_TEST_ID,
  RULE_LIBRARY_STATUS_SELECT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/RuleLibrary";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import ObjectID from "../../../Types/ObjectID";
import {
  DETECTION_RULE_LIBRARY,
  DETECTION_RULE_LIBRARY_CATEGORIES,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import { buildDetectionRuleFromLibrary } from "../../../Utils/SecurityEvent/SecurityTemplateRecords";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * Security Events > Detections > Rule Library: the library as a list a
 * security engineer scans (one row a rule: what it finds, its ATT&CK tags,
 * the events it reads and whether the project sends them, its severity,
 * Add or Added), narrowed by category, data, status and a search kept in
 * the page's address; a rule's details beside the list; and the header's
 * adds, which say which rules they add before they add them, add each rule
 * on its own and say what they could not add.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const RECOMMENDED: Array<DetectionRuleLibraryEntry> =
  getRecommendedDetectionRules();

function entryTitled(title: string): DetectionRuleLibraryEntry {
  return DETECTION_RULE_LIBRARY.find((entry: DetectionRuleLibraryEntry) => {
    return entry.title === title;
  })!;
}

const BRUTE_FORCE: DetectionRuleLibraryEntry = entryTitled(
  "Brute force from one IP address",
);
const SHADOW_COPIES: DetectionRuleLibraryEntry = entryTitled(
  "Shadow copies deleted",
);
const CLOUDTRAIL_STOPPED: DetectionRuleLibraryEntry = entryTitled(
  "CloudTrail logging stopped",
);
const PORT_SCAN: DetectionRuleLibraryEntry = entryTitled("Port scan");
const SEQUENCE: DetectionRuleLibraryEntry = entryTitled(
  "Failed sign-ins, then a success from the same address",
);

// The project's detection rules, by name alone or as records.
let ruleNames: Array<string> = [];
let ruleRecords: Array<DetectionRule> = [];
let listFailure: HTTPErrorResponse | null = null;

// What the project's events say it sends: Okta's sign-ins and Kubernetes audit logs.
let sentRows: Array<AggregatedModel> = [];
let aggregateFailure: HTTPErrorResponse | null = null;
let aggregateRequests: Array<AggregateBy<SecurityEvent>> = [];

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

function record(
  entry: DetectionRuleLibraryEntry,
  overrides: { name?: string; isEnabled?: boolean } = {},
): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule.name = overrides.name || entry.title;
  rule.sigmaRuleYaml = entry.sigmaRuleYaml;
  rule.isEnabled = overrides.isEnabled !== false;
  return rule;
}

beforeEach(() => {
  ruleNames = [];
  ruleRecords = [];
  listFailure = null;
  sentRows = OKTA_AND_KUBERNETES;
  aggregateFailure = null;
  aggregateRequests = [];
  window.history.replaceState(null, "", "/");
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(ModelAPI, "getList").mockImplementation(async () => {
    if (listFailure) {
      throw listFailure;
    }

    const data: Array<DetectionRule> = [
      ...ruleNames.map((name: string): DetectionRule => {
        const rule: DetectionRule = new DetectionRule();
        rule.name = name;
        return rule;
      }),
      ...ruleRecords,
    ];

    return {
      data,
      count: data.length,
      skip: 0,
      limit: 100,
    } as never;
  });
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

async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  await act(async () => {
    render(
      <MemoryRouter>
        <RuleLibraryPage
          pageRoute={new Route("/dashboard/security-events/rule-library")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  // The rows are drawn once the project's rules are read.
  await waitFor(() => {
    expect(
      screen.queryByTestId(
        `rule-library-entry-${DETECTION_RULE_LIBRARY[0]!.id}`,
      ),
    ).not.toBeNull();
  });
}

function row(entry: DetectionRuleLibraryEntry): HTMLElement {
  return screen.getByTestId(`rule-library-entry-${entry.id}`);
}

function shownRuleIds(): Array<string> {
  return DETECTION_RULE_LIBRARY.filter(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return screen.queryByTestId(`rule-library-entry-${entry.id}`) !== null;
    },
  ).map((entry: DetectionRuleLibraryEntry): string => {
    return entry.id;
  });
}

function select(testId: string): HTMLSelectElement {
  return screen.getByTestId(testId) as HTMLSelectElement;
}

async function pick(testId: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(select(testId), { target: { value } });
  });
}

async function search(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByTestId(RULE_LIBRARY_SEARCH_TEST_ID), {
      target: { value: text },
    });
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

// Each created rule, as the page sent it.
function recordCreates(
  fail: (rule: DetectionRule) => HTTPErrorResponse | null = (): null => {
    return null;
  },
): Array<DetectionRule> {
  const created: Array<DetectionRule> = [];

  jest
    .spyOn(ModelAPI, "create")
    .mockImplementation(async (options: { model: BaseModel }) => {
      const rule: DetectionRule = options.model as DetectionRule;
      const failure: HTTPErrorResponse | null = fail(rule);

      if (failure) {
        throw failure;
      }

      created.push(rule);
      return { data: {} } as never;
    });

  return created;
}

function headerButton(name: string | RegExp): HTMLElement {
  return within(screen.getByTestId("rule-library-toolbar")).getByRole(
    "button",
    { name },
  );
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

describe("the library as a list to scan", () => {
  test("one row a rule, in the library's order, every one in sight at once", async () => {
    await renderPage();

    expect(shownRuleIds()).toEqual(
      DETECTION_RULE_LIBRARY.map((entry: DetectionRuleLibraryEntry) => {
        return entry.id;
      }),
    );
    expect(screen.getByTestId("rule-library-count")).toHaveTextContent(
      `${DETECTION_RULE_LIBRARY.length} rules`,
    );
  });

  test("the columns a security engineer scans: the rule, the data it reads, its severity", async () => {
    await renderPage();

    const headers: Array<string> = Array.from(
      document.querySelectorAll("thead th"),
    ).map((cell: Element): string => {
      return (cell.textContent || "").trim();
    });

    expect(headers.slice(0, 3)).toEqual(["Rule", "Data", "Severity"]);
  });

  test("a row says what the rule finds, its ATT&CK tags, the events it reads and how severe it is", async () => {
    await renderPage();

    const brute: HTMLElement = row(BRUTE_FORCE);

    expect(
      within(brute).getByTestId(`rule-library-name-${BRUTE_FORCE.id}`),
    ).toHaveTextContent(BRUTE_FORCE.title);
    expect(
      within(brute).getByTestId(`rule-library-description-${BRUTE_FORCE.id}`),
    ).toHaveTextContent(BRUTE_FORCE.description);
    expect(
      within(brute).getByTestId(`rule-library-attack-${BRUTE_FORCE.id}`),
    ).toHaveTextContent("Credential Access · T1110.001");
    // Each technique by its name too, under the pointer.
    expect(
      within(brute).getByTestId(`rule-library-attack-${BRUTE_FORCE.id}`),
    ).toHaveAttribute("title", "T1110.001 Brute Force");
    expect(
      within(brute).getByTestId(`rule-library-data-${BRUTE_FORCE.id}`),
    ).toHaveTextContent("Sign-in events");
    expect(
      within(brute).getByTestId(`rule-library-severity-${BRUTE_FORCE.id}`),
    ).toHaveTextContent("High");
    expect(
      within(row(SHADOW_COPIES)).getByTestId(
        `rule-library-severity-${SHADOW_COPIES.id}`,
      ),
    ).toHaveTextContent("Critical");
  });

  test("the ATT&CK tags read in the neutral grey of a row's facts, never the red of an error", async () => {
    await renderPage();

    const line: HTMLElement = within(row(BRUTE_FORCE)).getByTestId(
      `rule-library-attack-${BRUTE_FORCE.id}`,
    );

    expect(line.className).toContain("text-gray-500");
    expect(line.className).not.toMatch(/(?:rose|red)-/);
  });

  test("every recommended rule is marked, and only those", async () => {
    await renderPage();

    const marked: Array<string> = DETECTION_RULE_LIBRARY.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return (
          screen.queryByTestId(`rule-library-recommended-${entry.id}`) !== null
        );
      },
    ).map((entry: DetectionRuleLibraryEntry): string => {
      return entry.id;
    });

    expect(marked).toEqual(
      RECOMMENDED.map((entry: DetectionRuleLibraryEntry): string => {
        return entry.id;
      }),
    );
    // Beside the name, on its line.
    const mark: HTMLElement = screen.getByTestId(
      `rule-library-recommended-${BRUTE_FORCE.id}`,
    );
    expect(mark.parentElement).toBe(
      screen.getByTestId(`rule-library-name-${BRUTE_FORCE.id}`).parentElement,
    );
  });

  test("a rule the project has says Added at the row's end; one it lacks offers Add; one turned off says so", async () => {
    ruleRecords = [
      record(BRUTE_FORCE),
      record(SHADOW_COPIES, { name: "Our shadow copy rule", isEnabled: false }),
    ];
    await renderPage();

    expect(
      within(row(BRUTE_FORCE)).getByTestId(
        `rule-library-added-${BRUTE_FORCE.id}`,
      ),
    ).toHaveTextContent("Added");
    expect(
      within(row(BRUTE_FORCE)).queryByRole("button", { name: "Add" }),
    ).toBeNull();
    expect(
      within(row(BRUTE_FORCE)).queryByTestId(
        `rule-library-off-${BRUTE_FORCE.id}`,
      ),
    ).toBeNull();

    // Renamed and turned off: still the library's rule, added, and Off.
    expect(
      within(row(SHADOW_COPIES)).getByTestId(
        `rule-library-added-${SHADOW_COPIES.id}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(row(SHADOW_COPIES)).getByTestId(
        `rule-library-off-${SHADOW_COPIES.id}`,
      ),
    ).toHaveTextContent("Off");

    expect(
      within(row(PORT_SCAN)).getByTestId(`rule-library-add-${PORT_SCAN.id}`),
    ).toHaveTextContent("Add");
  });

  test("reads every rule with its Sigma YAML and whether it is on, so a renamed rule is still known", async () => {
    await renderPage();

    expect(ModelAPI.getList).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: DetectionRule,
        select: { _id: true, name: true, sigmaRuleYaml: true, isEnabled: true },
      }),
    );
  });

  test("a correlation is marked with its kind, a single rule is not", async () => {
    await renderPage();

    expect(
      within(row(SEQUENCE)).getByTestId(`rule-library-type-${SEQUENCE.id}`),
    ).toHaveTextContent("Sequence");
    expect(
      within(row(BRUTE_FORCE)).queryByTestId(
        `rule-library-type-${BRUTE_FORCE.id}`,
      ),
    ).toBeNull();
  });
});

describe("whether the project sends what each rule reads", () => {
  test("one grouped count of the last week's events, by class, vendor and product", async () => {
    await renderPage();

    expect(aggregateRequests).toHaveLength(1);
    expect(aggregateRequests[0]!.groupBy).toEqual({
      className: true,
      vendorName: true,
      productName: true,
    });
    expect(aggregateRequests[0]!.aggregationInterval).toBe(
      AggregationInterval.Total,
    );
    expect(aggregateRequests[0]!.query).toEqual({ projectId: PROJECT_ID });
  });

  test("a rule whose events arrived says Receiving; one whose did not says Not receiving", async () => {
    await renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(`rule-library-data-status-${BRUTE_FORCE.id}`),
      ).toHaveTextContent("Receiving");
    });
    expect(
      screen.getByTestId(`rule-library-data-status-${BRUTE_FORCE.id}`),
    ).toHaveAttribute("data-status", "received");
    expect(
      screen.getByTestId(`rule-library-data-status-${SHADOW_COPIES.id}`),
    ).toHaveTextContent("Not receiving");
    expect(
      screen.getByTestId(`rule-library-data-status-${SHADOW_COPIES.id}`),
    ).toHaveAttribute(
      "title",
      "No events of this kind arrived in the last 7 days. The rule runs, but finds nothing until they do.",
    );
  });

  test("events that could not be read: said once, the rules listed without it, the Data filter off, and Try again", async () => {
    aggregateFailure = new HTTPErrorResponse(500, { message: "x" }, {});
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("rule-library-data-unknown")).toHaveTextContent(
        "Could not check which events this project sends.",
      );
    });
    expect(
      screen.queryByTestId(`rule-library-data-status-${BRUTE_FORCE.id}`),
    ).toBeNull();
    expect(
      within(row(BRUTE_FORCE)).getByTestId(
        `rule-library-data-${BRUTE_FORCE.id}`,
      ),
    ).toHaveTextContent("Sign-in events");
    expect(select(RULE_LIBRARY_DATA_SELECT_TEST_ID)).toBeDisabled();

    aggregateFailure = null;
    await click(screen.getByTestId("rule-library-data-retry"));

    await waitFor(() => {
      expect(
        screen.getByTestId(`rule-library-data-status-${BRUTE_FORCE.id}`),
      ).toHaveTextContent("Receiving");
    });
    expect(screen.queryByTestId("rule-library-data-unknown")).toBeNull();
    expect(select(RULE_LIBRARY_DATA_SELECT_TEST_ID)).not.toBeDisabled();
    expect(aggregateRequests).toHaveLength(2);
  });

  test("a project that sent nothing this week is told once, with the way to Connections, not on every rule", async () => {
    sentRows = [];
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("rule-library-nothing-sent")).toHaveTextContent(
        "No security events arrived in the last 7 days, so no rule has anything to read yet.",
      );
    });
    expect(
      screen.getByTestId("rule-library-nothing-sent-link"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/security-events/connections"),
    );
    expect(
      document.querySelectorAll('[data-testid^="rule-library-data-status-"]'),
    ).toHaveLength(0);
    expect(select(RULE_LIBRARY_DATA_SELECT_TEST_ID)).toBeDisabled();
  });
});

describe("narrowing the library", () => {
  test("the Category select offers every rule, the recommended ones, then each category, and opens on every rule", async () => {
    await renderPage();

    const options: Array<HTMLOptionElement> = Array.from(
      select(RULE_LIBRARY_CATEGORY_SELECT_TEST_ID).options,
    );

    expect(
      options.map((option: HTMLOptionElement): string => {
        return option.textContent || "";
      }),
    ).toEqual([
      "All categories",
      "Recommended",
      ...DETECTION_RULE_LIBRARY_CATEGORIES,
    ]);
    expect(
      options.map((option: HTMLOptionElement): string => {
        return option.value;
      }),
    ).toEqual(["", RECOMMENDED_FILTER, ...DETECTION_RULE_LIBRARY_CATEGORIES]);
    expect(select(RULE_LIBRARY_CATEGORY_SELECT_TEST_ID)).toHaveValue("");
  });

  test("a category lists just its rules; Recommended the recommended ones", async () => {
    await renderPage();

    for (const category of DETECTION_RULE_LIBRARY_CATEGORIES) {
      await pick(RULE_LIBRARY_CATEGORY_SELECT_TEST_ID, category);

      expect(shownRuleIds()).toEqual(
        DETECTION_RULE_LIBRARY.filter((entry: DetectionRuleLibraryEntry) => {
          return entry.category === category;
        }).map((entry: DetectionRuleLibraryEntry) => {
          return entry.id;
        }),
      );
    }

    await pick(RULE_LIBRARY_CATEGORY_SELECT_TEST_ID, RECOMMENDED_FILTER);
    expect(shownRuleIds()).toEqual(
      RECOMMENDED.map((entry: DetectionRuleLibraryEntry) => {
        return entry.id;
      }),
    );
  });

  test("the Data select lists the rules for the data the project sends, or the others", async () => {
    await renderPage();
    await waitFor(() => {
      expect(select(RULE_LIBRARY_DATA_SELECT_TEST_ID)).not.toBeDisabled();
    });

    expect(
      Array.from(select(RULE_LIBRARY_DATA_SELECT_TEST_ID).options).map(
        (option: HTMLOptionElement): string => {
          return option.textContent || "";
        },
      ),
    ).toEqual(["Any data", "Data you send", "Data you don't send yet"]);

    await pick(RULE_LIBRARY_DATA_SELECT_TEST_ID, LibraryDataFilter.Received);
    expect(shownRuleIds()).toContain(BRUTE_FORCE.id);
    expect(shownRuleIds()).not.toContain(SHADOW_COPIES.id);
    for (const id of shownRuleIds()) {
      expect(
        screen.getByTestId(`rule-library-data-status-${id}`),
      ).toHaveAttribute("data-status", "received");
    }

    await pick(RULE_LIBRARY_DATA_SELECT_TEST_ID, LibraryDataFilter.NotReceived);
    expect(shownRuleIds()).toContain(SHADOW_COPIES.id);
    expect(shownRuleIds()).not.toContain(BRUTE_FORCE.id);
  });

  test("the Status select lists the rules the project has, or the ones it lacks", async () => {
    ruleNames = [BRUTE_FORCE.title, PORT_SCAN.title];
    await renderPage();

    await pick(RULE_LIBRARY_STATUS_SELECT_TEST_ID, LibraryStatusFilter.Added);
    expect(shownRuleIds()).toEqual([BRUTE_FORCE.id, PORT_SCAN.id]);

    await pick(
      RULE_LIBRARY_STATUS_SELECT_TEST_ID,
      LibraryStatusFilter.NotAdded,
    );
    expect(shownRuleIds()).toHaveLength(DETECTION_RULE_LIBRARY.length - 2);
  });

  test("the search narrows by name, description, the events read, ATT&CK and severity", async () => {
    await renderPage();

    await search("T1110");
    expect(shownRuleIds()).toContain(BRUTE_FORCE.id);
    expect(shownRuleIds()).not.toContain(SHADOW_COPIES.id);

    await search("critical");
    expect(shownRuleIds()).toContain(SHADOW_COPIES.id);
    expect(shownRuleIds()).not.toContain(BRUTE_FORCE.id);

    await search("cloudtrail");
    expect(shownRuleIds()).toContain(CLOUDTRAIL_STOPPED.id);
  });

  test("a narrowed list says how many rules are in sight and offers the way back", async () => {
    await renderPage();

    expect(screen.queryByTestId("rule-library-clear-filters")).toBeNull();
    await pick(
      RULE_LIBRARY_CATEGORY_SELECT_TEST_ID,
      DetectionRuleLibraryCategory.Kubernetes,
    );

    const kubernetes: number = DETECTION_RULE_LIBRARY.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return entry.category === DetectionRuleLibraryCategory.Kubernetes;
      },
    ).length;

    expect(screen.getByTestId("rule-library-count")).toHaveTextContent(
      `${kubernetes} rules`,
    );
    // The select that narrows the list is tinted.
    expect(select(RULE_LIBRARY_CATEGORY_SELECT_TEST_ID).className).toContain(
      "bg-indigo-50",
    );

    await click(screen.getByTestId("rule-library-clear-filters"));
    expect(shownRuleIds()).toHaveLength(DETECTION_RULE_LIBRARY.length);
    expect(select(RULE_LIBRARY_CATEGORY_SELECT_TEST_ID)).toHaveValue("");
  });

  test("filters that leave nothing say so, and the way back clears them", async () => {
    ruleNames = DETECTION_RULE_LIBRARY.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return entry.category === DetectionRuleLibraryCategory.Network;
      },
    ).map((entry: DetectionRuleLibraryEntry): string => {
      return entry.title;
    });
    await renderPage();

    await pick(
      RULE_LIBRARY_CATEGORY_SELECT_TEST_ID,
      DetectionRuleLibraryCategory.Network,
    );
    await pick(
      RULE_LIBRARY_STATUS_SELECT_TEST_ID,
      LibraryStatusFilter.NotAdded,
    );

    expect(shownRuleIds()).toEqual([]);
    expect(screen.getByTestId("rule-library-no-match")).toHaveTextContent(
      "No rule matches your search or filters",
    );

    await click(
      within(screen.getByTestId("rule-library-no-match")).getByRole("button", {
        name: "Clear Filters",
      }),
    );
    expect(shownRuleIds()).toHaveLength(DETECTION_RULE_LIBRARY.length);
  });

  test("the filters are written into the page's address, an unset one left out", async () => {
    await renderPage();

    await pick(
      RULE_LIBRARY_CATEGORY_SELECT_TEST_ID,
      DetectionRuleLibraryCategory.Cloud,
    );
    await pick(
      RULE_LIBRARY_STATUS_SELECT_TEST_ID,
      LibraryStatusFilter.NotAdded,
    );
    await search("access key");

    const params: URLSearchParams = new URLSearchParams(window.location.search);

    expect(params.get("category")).toBe(DetectionRuleLibraryCategory.Cloud);
    expect(params.get("status")).toBe(LibraryStatusFilter.NotAdded);
    expect(params.get("search")).toBe("access key");
    expect(params.has("data")).toBe(false);
  });

  test("a page opened on an address with filters opens filtered, its search open", async () => {
    window.history.replaceState(null, "", "/?search=T1110&category=Identity");
    await renderPage();

    expect(screen.getByTestId(RULE_LIBRARY_SEARCH_TEST_ID)).toHaveValue(
      "T1110",
    );
    expect(select(RULE_LIBRARY_CATEGORY_SELECT_TEST_ID)).toHaveValue(
      "Identity",
    );
    for (const id of shownRuleIds()) {
      const entry: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY.find(
        (candidate: DetectionRuleLibraryEntry) => {
          return candidate.id === id;
        },
      )!;
      expect(entry.category).toBe(DetectionRuleLibraryCategory.Identity);
    }
    expect(shownRuleIds()).toContain(BRUTE_FORCE.id);
  });
});

describe("a rule's details", () => {
  test("open beside the list from the rule's name, with what it finds, how severe it is and its category", async () => {
    await renderPage();

    await click(
      screen.getByTestId(`rule-library-name-${CLOUDTRAIL_STOPPED.id}`),
    );

    const panel: HTMLElement = screen.getByTestId("rule-library-details");

    expect(screen.getByTestId("side-over-title")).toHaveTextContent(
      CLOUDTRAIL_STOPPED.title,
    );
    expect(screen.getByTestId("side-over-description")).toHaveTextContent(
      CLOUDTRAIL_STOPPED.description,
    );
    expect(panel).toHaveTextContent("High");
    expect(panel).toHaveTextContent("Recommended");
    expect(panel).toHaveTextContent("Cloud");
  });

  test("open from a click anywhere on the row too", async () => {
    await renderPage();

    await click(
      screen.getByTestId(`rule-library-description-${SHADOW_COPIES.id}`),
    );

    expect(screen.getByTestId("side-over-title")).toHaveTextContent(
      SHADOW_COPIES.title,
    );
  });

  test("a rule whose events do not arrive says so, and how to start sending them, with the way there", async () => {
    await renderPage();
    await waitFor(() => {
      expect(
        screen.getByTestId(`rule-library-data-status-${CLOUDTRAIL_STOPPED.id}`),
      ).toBeInTheDocument();
    });
    await click(
      screen.getByTestId(`rule-library-name-${CLOUDTRAIL_STOPPED.id}`),
    );

    const data: HTMLElement = screen.getByTestId("rule-library-details-data");

    expect(data).toHaveTextContent("AWS CloudTrail");
    expect(
      screen.getByTestId("rule-library-details-data-status"),
    ).toHaveTextContent("Not receiving");
    expect(
      screen.getByTestId("rule-library-details-how-to-send"),
    ).toHaveTextContent(
      "Send CloudTrail to OneUptime as logs and find security events in your logs.",
    );
    expect(
      screen.getByTestId("rule-library-details-send-link"),
    ).toHaveTextContent("Go to Connections");
    // "AWS CloudTrail events" says nothing "AWS CloudTrail" did not.
    expect(screen.queryByTestId("rule-library-details-data-source")).toBeNull();
  });

  test("a network rule's events come from a firewall or a SIEM: the Setup Guide", async () => {
    await renderPage();
    await waitFor(() => {
      expect(
        screen.getByTestId(`rule-library-data-status-${PORT_SCAN.id}`),
      ).toBeInTheDocument();
    });
    await click(screen.getByTestId(`rule-library-name-${PORT_SCAN.id}`));

    expect(
      screen.getByTestId("rule-library-details-send-link"),
    ).toHaveTextContent("Open the Setup Guide");
    expect(
      screen.getByTestId("rule-library-details-send-link"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/security-events/documentation"),
    );
  });

  test("a rule whose events arrive says so, and its own words for them when they say more", async () => {
    await renderPage();
    await waitFor(() => {
      expect(
        screen.getByTestId(`rule-library-data-status-${BRUTE_FORCE.id}`),
      ).toBeInTheDocument();
    });
    await click(screen.getByTestId(`rule-library-name-${BRUTE_FORCE.id}`));

    expect(
      screen.getByTestId("rule-library-details-data-status"),
    ).toHaveTextContent("Receiving");
    expect(
      screen.getByTestId("rule-library-details-data-source"),
    ).toHaveTextContent("Authentication events from any source");
    expect(screen.queryByTestId("rule-library-details-how-to-send")).toBeNull();
  });

  test("how a single rule runs: its schedule, threshold and grouping, and nothing it does not use", async () => {
    await renderPage();
    await click(
      screen.getByTestId(`rule-library-name-${CLOUDTRAIL_STOPPED.id}`),
    );

    const runs: HTMLElement = screen.getByTestId("rule-library-details-runs");

    expect(runs).toHaveTextContent("Runs every");
    expect(runs).toHaveTextContent("5 minutes");
    expect(runs).toHaveTextContent("Fires at");
    expect(runs).toHaveTextContent("1 match");
    // CloudTrail logging stopped groups by nothing and counts nothing distinct.
    expect(within(runs).queryByText("Grouped by")).toBeNull();
    expect(within(runs).queryByText("Counting distinct")).toBeNull();
  });

  test("its ATT&CK tactics and techniques, each a link to its page on attack.mitre.org", async () => {
    await renderPage();
    await click(screen.getByTestId(`rule-library-name-${BRUTE_FORCE.id}`));

    const attack: HTMLElement = screen.getByTestId(
      "rule-library-details-attack",
    );
    const links: Array<HTMLAnchorElement> = Array.from(
      attack.querySelectorAll("a"),
    );

    expect(attack).toHaveTextContent("TA0006");
    expect(attack).toHaveTextContent("Credential Access");
    expect(attack).toHaveTextContent("T1110.001");
    expect(attack).toHaveTextContent("Brute Force");
    expect(
      links.map((link: HTMLAnchorElement): string => {
        return new URL(link.href).pathname;
      }),
    ).toEqual(["/tactics/TA0006/", "/techniques/T1110/001/"]);
    for (const link of links) {
      expect(new URL(link.href).host).toBe("attack.mitre.org");
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  test("its Sigma rule, to read or copy", async () => {
    await renderPage();
    await click(screen.getByTestId(`rule-library-name-${BRUTE_FORCE.id}`));

    const sigma: HTMLElement = screen.getByTestId("rule-library-details-sigma");

    expect(sigma.querySelector("code")?.textContent).toBe(
      BRUTE_FORCE.sigmaRuleYaml,
    );
    expect(
      within(sigma).getByTestId("code-block-copy-button"),
    ).toBeInTheDocument();
  });

  test("Add Rule in the footer adds it, and the details then say it is added", async () => {
    const created: Array<DetectionRule> = recordCreates();
    await renderPage();
    await click(screen.getByTestId(`rule-library-name-${PORT_SCAN.id}`));

    await click(
      within(screen.getByTestId("side-over-footer")).getByRole("button", {
        name: "Add Rule",
      }),
    );

    expect(created).toHaveLength(1);
    expect(created[0]!.name).toBe(PORT_SCAN.title);
    await waitFor(() => {
      expect(
        screen.getByTestId("rule-library-details-added"),
      ).toHaveTextContent("Added");
    });
    expect(
      within(screen.getByTestId("side-over-footer")).queryByRole("button", {
        name: "Add Rule",
      }),
    ).toBeNull();
    // The row says so too.
    expect(
      within(row(PORT_SCAN)).getByTestId(`rule-library-added-${PORT_SCAN.id}`),
    ).toBeInTheDocument();
  });

  test("a rule the team renamed and turned off says under which name, that it is off, and where to turn it on", async () => {
    ruleRecords = [
      record(SHADOW_COPIES, { name: "Shadow copy wipe", isEnabled: false }),
    ];
    await renderPage();
    await click(screen.getByTestId(`rule-library-name-${SHADOW_COPIES.id}`));

    expect(screen.getByTestId("rule-library-details-added")).toHaveTextContent(
      "Added as Shadow copy wipe",
    );
    expect(screen.getByTestId("rule-library-details-off")).toHaveTextContent(
      "Turned off. Turn it on under Detection Rules.",
    );
    expect(
      screen.getByTestId("rule-library-details-rules-link"),
    ).toHaveAttribute("href", expect.stringContaining("/detection-rules"));
  });

  test("a correlation says what it looks for, and its grouping, not the single rule's counting", async () => {
    await renderPage();
    await click(screen.getByTestId(`rule-library-name-${SEQUENCE.id}`));

    expect(
      screen.getByTestId("rule-library-details-summary"),
    ).toHaveTextContent("Sequence");

    const runs: HTMLElement = screen.getByTestId("rule-library-details-runs");

    expect(runs).toHaveTextContent("Grouped by");
    expect(runs).toHaveTextContent("principalIp");
    expect(within(runs).queryByText("Fires at")).toBeNull();
    expect(within(runs).queryByText("Counting distinct")).toBeNull();
  });
});

describe("adding from the library", () => {
  test("a row's Add creates the very rule Turn on recommended adds, and the row then says Added", async () => {
    const created: Array<DetectionRule> = recordCreates();
    await renderPage();

    await click(screen.getByTestId(`rule-library-add-${SEQUENCE.id}`));

    expect(created).toHaveLength(1);
    expect(created[0]!.name).toBe(SEQUENCE.title);
    expect(BaseModel.toJSON(created[0]!, DetectionRule)).toEqual(
      BaseModel.toJSON(
        buildDetectionRuleFromLibrary({
          projectId: PROJECT_ID,
          entry: SEQUENCE,
        }),
        DetectionRule,
      ),
    );
    await waitFor(() => {
      expect(
        within(row(SEQUENCE)).getByTestId(`rule-library-added-${SEQUENCE.id}`),
      ).toBeInTheDocument();
    });
  });

  test("a row's Add that fails says why on that row, as the one alert, and the row still offers Add", async () => {
    recordCreates((): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        422,
        { message: "You do not have permissions to create DetectionRule." },
        {},
      );
    });
    await renderPage();

    await click(screen.getByTestId(`rule-library-add-${BRUTE_FORCE.id}`));

    const why: HTMLElement = await screen.findByTestId(
      `rule-library-problem-${BRUTE_FORCE.id}`,
    );

    expect(why).toHaveTextContent(/^Your role cannot add it\.$/);
    expect(why).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("rule-library-problems")).toBeNull();
    expect(
      screen.getByTestId(`rule-library-add-${BRUTE_FORCE.id}`),
    ).toBeInTheDocument();
  });

  test("Add Recommended Rules says which rules it adds, with the events each reads, before it adds them", async () => {
    ruleNames = [RECOMMENDED[0]!.title, RECOMMENDED[1]!.title];
    const created: Array<DetectionRule> = recordCreates();
    await renderPage();
    await waitFor(() => {
      expect(
        screen.getByTestId(`rule-library-data-status-${BRUTE_FORCE.id}`),
      ).toBeInTheDocument();
    });

    await click(
      headerButton(`Add ${RECOMMENDED.length - 2} Recommended Rules`),
    );

    // Nothing is added yet: the dialog says what will be.
    expect(created).toEqual([]);
    expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
      `Add ${RECOMMENDED.length - 2} recommended rules?`,
    );
    expect(dialog()).toHaveTextContent(
      "They start on and open a security case when they match.",
    );

    const items: Array<HTMLElement> = within(dialog()).getAllByTestId(
      /^rule-library-add-item-/,
    );

    expect(
      items.map((item: HTMLElement): string => {
        return item
          .getAttribute("data-testid")!
          .replace("rule-library-add-item-", "");
      }),
    ).toEqual(
      RECOMMENDED.slice(2).map((entry: DetectionRuleLibraryEntry): string => {
        return entry.id;
      }),
    );
    // The recommended rules reading events this project does not send yet, counted.
    expect(
      within(dialog()).getByTestId("rule-library-add-without-data"),
    ).toHaveTextContent(
      /^\d+ of these read events this project does not send yet, so they find nothing until those arrive\.$/,
    );

    await click(within(dialog()).getByRole("button", { name: "Add Rules" }));

    expect(
      created.map((rule: DetectionRule): string => {
        return rule.name!;
      }),
    ).toEqual(
      RECOMMENDED.slice(2).map((entry: DetectionRuleLibraryEntry): string => {
        return entry.title;
      }),
    );
    await waitFor(() => {
      expect(
        within(screen.getByTestId("rule-library-toolbar")).queryByRole(
          "button",
          {
            name: /Recommended Rules?$/,
          },
        ),
      ).toBeNull();
    });
  });

  test("Add Recommended Rules adds each rule itself and never turns back on one the team turned off", async () => {
    ruleRecords = [record(RECOMMENDED[0]!, { isEnabled: false })];
    const created: Array<DetectionRule> = recordCreates();
    const turnOn: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityCaseApi,
      "turnOnRecommended",
    );
    const update: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ModelAPI,
      "updateById",
    );
    await renderPage();

    await click(
      headerButton(`Add ${RECOMMENDED.length - 1} Recommended Rules`),
    );
    await click(within(dialog()).getByRole("button", { name: "Add Rules" }));

    expect(created).toHaveLength(RECOMMENDED.length - 1);
    expect(
      created.some((rule: DetectionRule): boolean => {
        return rule.name === RECOMMENDED[0]!.title;
      }),
    ).toBe(false);
    expect(turnOn).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    // Still off: the row says so.
    expect(
      screen.getByTestId(`rule-library-off-${RECOMMENDED[0]!.id}`),
    ).toBeInTheDocument();
  });

  test("Cancel adds nothing", async () => {
    const created: Array<DetectionRule> = recordCreates();
    await renderPage();

    await click(headerButton(`Add ${RECOMMENDED.length} Recommended Rules`));
    await click(within(dialog()).getByRole("button", { name: "Cancel" }));

    expect(created).toEqual([]);
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("with every recommended rule added, the main button adds all the rules the project lacks", async () => {
    ruleNames = RECOMMENDED.map((entry: DetectionRuleLibraryEntry) => {
      return entry.title;
    });
    await renderPage();

    expect(
      within(screen.getByTestId("rule-library-toolbar")).queryByRole("button", {
        name: /Recommended Rules?$/,
      }),
    ).toBeNull();
    expect(
      headerButton(
        `Add All ${DETECTION_RULE_LIBRARY.length - RECOMMENDED.length} Rules`,
      ),
    ).toBeInTheDocument();
  });

  test("a narrowed list's add says it adds the matching rules, and adds just those", async () => {
    ruleNames = RECOMMENDED.map((entry: DetectionRuleLibraryEntry) => {
      return entry.title;
    });
    const created: Array<DetectionRule> = recordCreates();
    await renderPage();
    await pick(
      RULE_LIBRARY_CATEGORY_SELECT_TEST_ID,
      DetectionRuleLibraryCategory.Network,
    );

    await click(headerButton("Add 2 Matching Rules"));
    expect(within(dialog()).getByTestId("modal-title")).toHaveTextContent(
      "Add 2 rules?",
    );
    await click(within(dialog()).getByRole("button", { name: "Add Rules" }));

    expect(
      created.map((rule: DetectionRule): string => {
        return rule.name!;
      }),
    ).toEqual(["Port scan", "Network sweep"]);
  });

  test("an add of several that cannot add some names them above the rules, says the others were added, and adding again adds only them", async () => {
    let isFixed: boolean = false;
    const created: Array<DetectionRule> = recordCreates(
      (rule: DetectionRule): HTTPErrorResponse | null => {
        if (isFixed) {
          return null;
        }

        if (rule.name === RECOMMENDED[1]!.title) {
          return new HTTPErrorResponse(500, { message: "Server Error" }, {});
        }

        if (rule.name === SEQUENCE.title) {
          return new HTTPErrorResponse(
            400,
            { message: "name length cannot be more than 50 characters" },
            {},
          );
        }

        return null;
      },
    );
    let scrolledIntoView: number = 0;
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: (): void => {
        scrolledIntoView++;
      },
    });
    await renderPage();

    await click(headerButton(`Add ${RECOMMENDED.length} Recommended Rules`));
    await click(within(dialog()).getByRole("button", { name: "Add Rules" }));

    expect(created).toHaveLength(RECOMMENDED.length - 2);

    const problems: HTMLElement = await screen.findByTestId(
      "rule-library-problems",
    );

    expect(
      within(problems).getByTestId("security-turn-on-problems-title"),
    ).toHaveTextContent(/^2 rules could not be added$/);
    expect(
      within(problems)
        .getAllByTestId("security-turn-on-problem")
        .map((item: HTMLElement): string => {
          return (item.textContent || "").trim();
        }),
    ).toEqual([
      `${RECOMMENDED[1]!.title} - Something went wrong while adding it.`,
      `${SEQUENCE.title} - OneUptime could not save it: name length cannot be more than 50 characters`,
    ]);
    expect(
      within(problems).getByTestId("security-turn-on-problems-note"),
    ).toHaveTextContent(/^The others were added\.$/);
    expect(problems).not.toHaveTextContent("Server Error");
    expect(scrolledIntoView).toBe(1);
    // Each row says why too, without a second alert.
    expect(
      screen.getByTestId(`rule-library-problem-${SEQUENCE.id}`),
    ).not.toHaveAttribute("role");

    isFixed = true;
    created.length = 0;
    await click(headerButton("Add 2 Recommended Rules"));
    await click(within(dialog()).getByRole("button", { name: "Add Rules" }));

    expect(
      created.map((rule: DetectionRule): string => {
        return rule.name!;
      }),
    ).toEqual([RECOMMENDED[1]!.title, SEQUENCE.title]);
    expect(screen.queryByTestId("rule-library-problems")).toBeNull();
    delete (
      window.HTMLElement.prototype as unknown as { scrollIntoView?: unknown }
    ).scrollIntoView;
  });
});

describe("who may add, and a library that cannot be read", () => {
  test("a role that cannot create detection rules sees every add locked, saying why", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "Your role cannot create detection rules.",
    });
    await renderPage();

    expect(
      headerButton(`Add ${RECOMMENDED.length} Recommended Rules`),
    ).toBeDisabled();
    expect(
      screen.getByTestId(`rule-library-add-${BRUTE_FORCE.id}`),
    ).toBeDisabled();

    await click(screen.getByTestId(`rule-library-name-${BRUTE_FORCE.id}`));

    expect(
      within(screen.getByTestId("side-over-footer")).getByRole("button", {
        name: "Add Rule",
      }),
    ).toBeDisabled();
    expect(
      screen.getByTestId("rule-library-details-cannot-add"),
    ).toHaveTextContent("Your role cannot create detection rules.");
  });

  test("the project's rules that cannot be read: the list says so with Try again, and offers no add", async () => {
    listFailure = new HTTPErrorResponse(500, { message: "Server Error" }, {});
    const project: Project = new Project();
    project.id = PROJECT_ID;

    await act(async () => {
      render(
        <MemoryRouter>
          <RuleLibraryPage
            pageRoute={new Route("/dashboard/security-events/rule-library")}
            currentProject={project}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });

    const error: HTMLElement = await screen.findByTestId(
      "rule-library-table-load-error",
    );

    expect(shownRuleIds()).toEqual([]);
    expect(
      within(screen.getByTestId("rule-library-toolbar")).queryByRole("button", {
        name: /Rules?$/,
      }),
    ).toBeNull();

    listFailure = null;
    await click(within(error).getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(shownRuleIds()).toHaveLength(DETECTION_RULE_LIBRARY.length);
    });
  });
});
