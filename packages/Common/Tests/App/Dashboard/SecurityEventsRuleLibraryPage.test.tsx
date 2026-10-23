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
import SecurityCaseApi, {
  SecurityApiError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import { RECOMMENDED_FILTER } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleLibraryUtil";
import RuleLibraryPage, {
  RULE_LIBRARY_CATEGORY_SELECT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/RuleLibrary";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
  TurnOnRecommendedReason,
} from "../../../Types/SecurityEvent/TurnOnRecommended";
import { buildDetectionRuleFromLibrary } from "../../../Utils/SecurityEvent/SecurityTemplateRecords";
import {
  DETECTION_RULE_LIBRARY,
  DETECTION_RULE_LIBRARY_CATEGORIES,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * The Rule Library's recommended rules: marked on their cards, a filter of
 * their own, and one button that adds the ones the project does not have
 * yet - through the same server call as the Overview's "Turn on
 * recommended", which also turns back on any that were turned off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

let ruleNames: Array<string> = [];
// Rules with their Sigma YAML, beside the ones known by name alone.
let ruleRecords: Array<DetectionRule> = [];

beforeEach(() => {
  ruleNames = [];
  ruleRecords = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(ModelAPI, "getList").mockImplementation(async () => {
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
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
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
}

const RECOMMENDED: Array<DetectionRuleLibraryEntry> =
  getRecommendedDetectionRules();

function getCategorySelect(): HTMLSelectElement {
  return screen.getByTestId(
    RULE_LIBRARY_CATEGORY_SELECT_TEST_ID,
  ) as HTMLSelectElement;
}

async function pickCategory(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(getCategorySelect(), { target: { value } });
  });
}

function getShownRuleIds(): Array<string> {
  return DETECTION_RULE_LIBRARY.filter(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return screen.queryByTestId(`rule-library-entry-${entry.id}`) !== null;
    },
  ).map((entry: DetectionRuleLibraryEntry): string => {
    return entry.id;
  });
}

describe("recommended rules in the Rule Library", () => {
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
  });

  test("the Recommended filter lists just them", async () => {
    await renderPage();

    await pickCategory(RECOMMENDED_FILTER);

    expect(getShownRuleIds()).toEqual(
      RECOMMENDED.map((entry: DetectionRuleLibraryEntry): string => {
        return entry.id;
      }),
    );
    expect(getCategorySelect()).toHaveValue(RECOMMENDED_FILTER);
  });

  test("one button adds the recommended rules the project lacks, through the server, then reads the rules again", async () => {
    // Two of them are there already.
    ruleNames = [RECOMMENDED[0]!.title, RECOMMENDED[1]!.title];
    const turnOn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockImplementation(async () => {
        ruleNames = RECOMMENDED.map((entry: DetectionRuleLibraryEntry) => {
          return entry.title;
        });
        return {
          rulesAdded: RECOMMENDED.length - 2,
          rulesTurnedOn: 0,
          logsTurnedOn: false,
          playbookAdded: false,
          playbookTurnedOn: false,
          problems: [],
        };
      });
    await renderPage();

    const button: HTMLElement = await screen.findByRole("button", {
      name: `Add ${RECOMMENDED.length - 2} Recommended Rules`,
    });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(turnOn).toHaveBeenCalledWith({
      logs: false,
      detections: true,
      playbook: false,
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Recommended Rules?$/ }),
      ).toBeNull();
    });
    expect(ModelAPI.getList).toHaveBeenCalledTimes(2);
  });

  test("Recommended reads beside a rule's title, so the title keeps the card's width", async () => {
    await renderPage();

    const entry: DetectionRuleLibraryEntry = RECOMMENDED[0]!;
    const card: HTMLElement = screen.getByTestId(
      `rule-library-entry-${entry.id}`,
    );
    const title: HTMLElement = within(card).getByText(entry.title);
    const mark: HTMLElement = within(card).getByTestId(
      `rule-library-recommended-${entry.id}`,
    );

    // The mark shares the title's line (and wraps under it when the title is long).
    expect(title.parentElement).toBe(mark.parentElement);
    expect(mark).toHaveTextContent("Recommended");
  });

  test("an added rule says Added where its Add Rule button would be; one not added offers Add Rule", async () => {
    ruleNames = [RECOMMENDED[0]!.title];
    await renderPage();

    const added: HTMLElement = await screen.findByTestId(
      `rule-library-entry-${RECOMMENDED[0]!.id}`,
    );
    const notAdded: HTMLElement = screen.getByTestId(
      `rule-library-entry-${RECOMMENDED[1]!.id}`,
    );

    await waitFor(() => {
      expect(
        within(added).getByTestId(`rule-library-added-${RECOMMENDED[0]!.id}`),
      ).toHaveTextContent("Added");
    });
    expect(
      within(added).queryByRole("button", { name: "Add Rule" }),
    ).toBeNull();
    expect(
      within(added).getByRole("button", { name: "View Rule" }),
    ).toBeInTheDocument();

    expect(
      within(notAdded).queryByTestId(
        `rule-library-added-${RECOMMENDED[1]!.id}`,
      ),
    ).toBeNull();
    expect(
      within(notAdded).getByRole("button", { name: "Add Rule" }),
    ).toBeInTheDocument();

    // Added sits in the card's footer, with the buttons, not beside the title.
    const footer: HTMLElement = within(added).getByRole("button", {
      name: "View Rule",
    }).parentElement!;

    expect(
      within(footer).getByTestId(`rule-library-added-${RECOMMENDED[0]!.id}`),
    ).toBeInTheDocument();
  });

  test("the search and one category select share a row, which a phone stacks, with no row of buttons to read as tabs", async () => {
    await renderPage();

    const filters: HTMLElement = screen.getByTestId("rule-library-filters");
    const search: HTMLElement =
      within(filters).getByPlaceholderText("Search rules");
    const select: HTMLElement = within(filters).getByRole("combobox", {
      name: "Rule categories",
    });

    expect(select).toBe(getCategorySelect());
    expect(
      search.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(filters.className).toContain("flex-col");
    expect(filters.className).toContain("sm:flex-row");
    expect(within(filters).queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelectorAll("[aria-pressed]")).toHaveLength(0);
  });

  test("the select offers every rule, the recommended ones, then each category, and opens on every rule", async () => {
    await renderPage();

    const options: Array<HTMLOptionElement> = Array.from(
      getCategorySelect().options,
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
    expect(getCategorySelect()).toHaveValue("");
    expect(getShownRuleIds()).toHaveLength(DETECTION_RULE_LIBRARY.length);
  });

  test("a category lists just its rules, and All categories lists every rule again", async () => {
    await renderPage();

    for (const category of DETECTION_RULE_LIBRARY_CATEGORIES) {
      await pickCategory(category);

      const expected: Array<string> = DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return entry.category === category;
        },
      ).map((entry: DetectionRuleLibraryEntry): string => {
        return entry.id;
      });

      expect(expected.length).toBeGreaterThan(0);
      expect(getShownRuleIds()).toEqual(expected);
      expect(getCategorySelect()).toHaveValue(category);
    }

    await pickCategory("");

    expect(getShownRuleIds()).toHaveLength(DETECTION_RULE_LIBRARY.length);
  });

  test("the search narrows within the picked category", async () => {
    await renderPage();

    const kubernetes: Array<DetectionRuleLibraryEntry> =
      DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return entry.category === DetectionRuleLibraryCategory.Kubernetes;
        },
      );
    const first: DetectionRuleLibraryEntry = kubernetes[0]!;

    await pickCategory(DetectionRuleLibraryCategory.Kubernetes);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search rules"), {
        target: { value: first.title },
      });
    });

    expect(getShownRuleIds()).toContain(first.id);
    for (const id of getShownRuleIds()) {
      expect(
        kubernetes.some((entry: DetectionRuleLibraryEntry): boolean => {
          return entry.id === id;
        }),
      ).toBe(true);
    }
  });

  test("with every recommended rule added there is no button for them", async () => {
    ruleNames = RECOMMENDED.map((entry: DetectionRuleLibraryEntry) => {
      return entry.title;
    });
    await renderPage();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Recommended Rules?$/ }),
      ).toBeNull();
    });
    expect(
      screen.getByRole("button", {
        name: `Add All ${DETECTION_RULE_LIBRARY.length - RECOMMENDED.length} Rules`,
      }),
    ).toBeInTheDocument();
  });
});

describe("adding from the Rule Library", () => {
  const SEQUENCE: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY.find(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return (
        entry.title === "Failed sign-ins, then a success from the same address"
      );
    },
  )!;

  function entryCard(entry: DetectionRuleLibraryEntry): HTMLElement {
    return screen.getByTestId(`rule-library-entry-${entry.id}`);
  }

  function problemRows(): Array<string> {
    return within(screen.getByTestId("rule-library-problems"))
      .queryAllByTestId("security-turn-on-problem")
      .map((row: HTMLElement): string => {
        return (row.textContent || "").trim();
      });
  }

  function problemsPart(testId: string): HTMLElement {
    return within(screen.getByTestId("rule-library-problems")).getByTestId(
      testId,
    );
  }

  // Why an Add could not add this entry, on its own card.
  function cardProblem(entry: DetectionRuleLibraryEntry): HTMLElement | null {
    return within(entryCard(entry)).queryByTestId(
      `rule-library-problem-${entry.id}`,
    );
  }

  /*
   * jsdom draws nothing, so it has no scrollIntoView: the page checks for
   * it, and these record what it brought into view.
   */
  let scrolledIntoView: Array<Element> = [];
  const originalScrollIntoView: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(
      window.HTMLElement.prototype,
      "scrollIntoView",
    );

  beforeEach(() => {
    scrolledIntoView = [];
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: function (this: Element): void {
        scrolledIntoView.push(this);
      },
    });
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(
        window.HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoView,
      );
    } else {
      delete (
        window.HTMLElement.prototype as unknown as {
          scrollIntoView?: unknown;
        }
      ).scrollIntoView;
    }
  });

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

  test("reads every rule with its Sigma YAML, so a rule the team renamed is still known", async () => {
    await renderPage();

    expect(ModelAPI.getList).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { _id: true, name: true, sigmaRuleYaml: true },
      }),
    );
  });

  test("a recommended rule the team renamed reads as Added, and is not offered again", async () => {
    const renamed: DetectionRule = new DetectionRule();
    renamed.name = "Our brute force rule";
    renamed.sigmaRuleYaml = RECOMMENDED[0]!.sigmaRuleYaml;
    ruleRecords = [renamed];

    await renderPage();

    await waitFor(() => {
      expect(
        within(entryCard(RECOMMENDED[0]!)).getByTestId(
          `rule-library-added-${RECOMMENDED[0]!.id}`,
        ),
      ).toHaveTextContent("Added");
    });
    expect(
      within(entryCard(RECOMMENDED[0]!)).queryByRole("button", {
        name: "Add Rule",
      }),
    ).toBeNull();
    // The server would not add it either: it is not counted among the missing.
    expect(
      screen.getByRole("button", {
        name: `Add ${RECOMMENDED.length - 1} Recommended Rules`,
      }),
    ).toBeInTheDocument();
  });

  test("Add Rule creates the very rule Turn on recommended adds: the sequence under its whole 53-character title", async () => {
    const created: Array<DetectionRule> = recordCreates();
    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(entryCard(SEQUENCE)).getByRole("button", { name: "Add Rule" }),
      );
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.name).toBe(SEQUENCE.title);
    expect(created[0]!.name!.length).toBe(53);
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
        within(entryCard(SEQUENCE)).getByTestId(
          `rule-library-added-${SEQUENCE.id}`,
        ),
      ).toHaveTextContent("Added");
    });
    expect(screen.queryByTestId("rule-library-problems")).toBeNull();
  });

  test("Add All adds every rule it can, then says which it could not add and why; adding again adds only those", async () => {
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
    await renderPage();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: `Add All ${DETECTION_RULE_LIBRARY.length} Rules`,
        }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Rules" }));
    });

    // Every other rule was added: it did not stop at the first it could not.
    expect(created).toHaveLength(DETECTION_RULE_LIBRARY.length - 2);
    await waitFor(() => {
      expect(problemsPart("security-turn-on-problems-title")).toHaveTextContent(
        /^2 rules could not be added$/,
      );
    });
    expect(problemRows()).toEqual([
      `${RECOMMENDED[1]!.title} - Something went wrong while adding it.`,
      `${SEQUENCE.title} - OneUptime could not save it: name length cannot be more than 50 characters`,
    ]);
    expect(problemsPart("security-turn-on-problems-note")).toHaveTextContent(
      /^The others were added\.$/,
    );
    expect(screen.getByTestId("rule-library-problems")).toHaveAttribute(
      "role",
      "alert",
    );
    /*
     * The box is brought into view: the confirmation leaves the reader
     * wherever its dialog was opened from.
     */
    expect(scrolledIntoView).toHaveLength(1);
    expect(
      scrolledIntoView[0]!.contains(
        screen.getByTestId("rule-library-problems"),
      ),
    ).toBe(true);
    // Each card it could not add says why too, without a second alert.
    expect(cardProblem(SEQUENCE)).toHaveTextContent(
      "OneUptime could not save it: name length cannot be more than 50 characters",
    );
    expect(cardProblem(SEQUENCE)).not.toHaveAttribute("role");
    expect(cardProblem(RECOMMENDED[1]!)).toHaveTextContent(
      "Something went wrong while adding it.",
    );
    expect(cardProblem(RECOMMENDED[0]!)).toBeNull();
    // The two left out still offer Add Rule; the rest read Added.
    expect(
      within(entryCard(SEQUENCE)).getByRole("button", { name: "Add Rule" }),
    ).toBeInTheDocument();
    expect(
      within(entryCard(RECOMMENDED[0]!)).getByTestId(
        `rule-library-added-${RECOMMENDED[0]!.id}`,
      ),
    ).toBeInTheDocument();

    // Adding again: the two that were left, and nothing twice.
    isFixed = true;
    created.length = 0;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add All 2 Rules" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Rules" }));
    });

    expect(
      created.map((rule: DetectionRule): string => {
        return rule.name!;
      }),
    ).toEqual([RECOMMENDED[1]!.title, SEQUENCE.title]);
    expect(screen.queryByTestId("rule-library-problems")).toBeNull();
    expect(cardProblem(SEQUENCE)).toBeNull();
    expect(cardProblem(RECOMMENDED[1]!)).toBeNull();
  });

  test("Add All that adds none says so, without saying the others were added", async () => {
    recordCreates((): HTTPErrorResponse => {
      return new HTTPErrorResponse(500, { message: "Server Error" }, {});
    });
    await renderPage();
    await pickCategory(RECOMMENDED_FILTER);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: `Add All ${RECOMMENDED.length} Rules`,
        }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Rules" }));
    });

    await waitFor(() => {
      expect(problemsPart("security-turn-on-problems-title").textContent).toBe(
        `${RECOMMENDED.length} rules could not be added`,
      );
    });
    expect(
      within(screen.getByTestId("rule-library-problems")).queryByTestId(
        "security-turn-on-problems-note",
      ),
    ).toBeNull();
    // A server's own message is never the reader's to read.
    expect(screen.getByTestId("rule-library-problems")).not.toHaveTextContent(
      "Server Error",
    );
  });

  test("the header's Add 1 Rule that fails says so in the box above the rules, as Add All does, wherever the card is", async () => {
    recordCreates((): HTTPErrorResponse => {
      return new HTTPErrorResponse(500, { message: "Server Error" }, {});
    });
    await renderPage();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search rules"), {
        target: { value: SEQUENCE.title },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add 1 Rule" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Rules" }));
    });

    await waitFor(() => {
      expect(problemsPart("security-turn-on-problems-title").textContent).toBe(
        "1 rule could not be added",
      );
    });
    expect(problemRows()).toEqual([
      `${SEQUENCE.title} - Something went wrong while adding it.`,
    ]);
    // Nothing was added, so nothing to say about the others.
    expect(
      within(screen.getByTestId("rule-library-problems")).queryByTestId(
        "security-turn-on-problems-note",
      ),
    ).toBeNull();
    expect(scrolledIntoView).toHaveLength(1);
    // The card says why too, without a second alert.
    expect(cardProblem(SEQUENCE)).not.toHaveAttribute("role");
  });

  test("one card's Add Rule that fails says why on that card, where the reader clicked, and nowhere else", async () => {
    recordCreates((): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        422,
        { message: "You do not have permissions to create DetectionRule." },
        {},
      );
    });
    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(entryCard(RECOMMENDED[0]!)).getByRole("button", {
          name: "Add Rule",
        }),
      );
    });

    await waitFor(() => {
      expect(cardProblem(RECOMMENDED[0]!)).toHaveTextContent(
        /^Your role cannot add it\.$/,
      );
    });
    // The only thing said, so it is the alert.
    expect(cardProblem(RECOMMENDED[0]!)).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("rule-library-problems")).toBeNull();
    expect(scrolledIntoView).toEqual([]);
    // Not added: its card still offers Add Rule.
    expect(
      within(entryCard(RECOMMENDED[0]!)).getByRole("button", {
        name: "Add Rule",
      }),
    ).toBeInTheDocument();
  });

  test("the recommended rules through the server: what it could not add is said the same way", async () => {
    jest.spyOn(SecurityCaseApi, "turnOnRecommended").mockResolvedValue({
      rulesAdded: RECOMMENDED.length - 1,
      rulesTurnedOn: 0,
      logsTurnedOn: false,
      playbookAdded: false,
      playbookTurnedOn: false,
      problems: [
        {
          part: TurnOnRecommendedPart.Rule,
          action: TurnOnRecommendedAction.Add,
          name: RECOMMENDED[1]!.title,
          reason: TurnOnRecommendedReason.Failed,
          detail: "",
        },
      ],
    });
    await renderPage();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: `Add ${RECOMMENDED.length} Recommended Rules`,
        }),
      );
    });

    await waitFor(() => {
      expect(problemRows()).toEqual([
        `${RECOMMENDED[1]!.title} - Something went wrong while adding it.`,
      ]);
    });
    expect(problemsPart("security-turn-on-problems-title")).toHaveTextContent(
      /^1 rule could not be added$/,
    );
    expect(problemsPart("security-turn-on-problems-note")).toHaveTextContent(
      /^The others were added\.$/,
    );
    expect(cardProblem(RECOMMENDED[1]!)).toHaveTextContent(
      "Something went wrong while adding it.",
    );
    expect(scrolledIntoView).toHaveLength(1);
  });

  test("a server that cannot be reached: the recommended rules could not be added, in the product's words", async () => {
    jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockRejectedValue(
        new SecurityApiError(
          "Error connecting to server. Please try again in few minutes.",
          502,
        ),
      );
    await renderPage();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: `Add ${RECOMMENDED.length} Recommended Rules`,
        }),
      );
    });

    const box: HTMLElement = await screen.findByTestId("rule-library-problems");

    expect(problemsPart("security-turn-on-problems-title")).toHaveTextContent(
      /^The recommended rules could not be added$/,
    );
    expect(problemsPart("security-turn-on-problems-error")).toHaveTextContent(
      /^Something went wrong\. Try again in a moment\.$/,
    );
    expect(box).not.toHaveTextContent("Error connecting to server");
    expect(
      within(box).queryByTestId("security-turn-on-problems-note"),
    ).toBeNull();
    expect(problemRows()).toEqual([]);
    expect(scrolledIntoView).toHaveLength(1);
  });

  test("a plan that does not include them says so in the server's sentence", async () => {
    jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockRejectedValue(
        new SecurityApiError(
          "Please upgrade your plan to Growth to access this feature",
          402,
        ),
      );
    await renderPage();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: `Add ${RECOMMENDED.length} Recommended Rules`,
        }),
      );
    });

    await screen.findByTestId("rule-library-problems");
    expect(problemsPart("security-turn-on-problems-error")).toHaveTextContent(
      /^Please upgrade your plan to Growth to access this feature$/,
    );
  });
});
