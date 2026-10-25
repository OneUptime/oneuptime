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
  SecurityOverview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import { SECURITY_GETTING_STARTED_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityGettingStarted";
import {
  SECURITY_OVERVIEW_STATUS_ID,
  SECURITY_STATUS_HEADLINE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatus";
import {
  SecurityHeadlineKind,
  SecurityOverviewQueue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatusModel";
import SecurityPipeline, {
  SECURITY_PIPELINE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityPipeline";
import {
  SecuritySetupStatus,
  SecuritySetupTestResult,
  TurnOnRecommendedProblem,
  TurnOnRecommendedResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel";
import { MAX_PROBLEMS_SHOWN } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityTurnOnProblems";
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
  TurnOnRecommendedReason,
} from "../../../Types/SecurityEvent/TurnOnRecommended";
import SecurityOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Overview";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
} from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage, {
  SECURITY_CASE_STAGE_FLAGS,
} from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  DEFAULT_SECURITY_CASE_PRIORITIES,
  DefaultSecurityCasePriority,
} from "../../../Utils/SecurityCase/SecurityCasePriorities";
import {
  DEFAULT_SECURITY_CASE_STATUSES,
  DefaultSecurityCaseStatus,
} from "../../../Utils/SecurityCase/SecurityCaseStatuses";
import { SecurityOverviewValue } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApiTypes";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
} from "../../Helpers/SecurityCaseValues";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import type { SpyInstance } from "jest-mock";
import { resolveSpacing } from "../../ResponsiveSpacing";
import { WIDTHS_IN_PX } from "../../RenderedMarkup";

/*
 * The Security Overview as a new project meets it and as a working one
 * does: "Get started" alone until Security is set up (its one click, its
 * test attack, and the main button moving to whatever is next), then one
 * card at the top - a band that says what needs someone (each count a link),
 * that every open case is in hand, that nothing is watched yet, or "All
 * quiet", and under it the pipeline, each part a link with how it is doing -
 * and the charts only once there is something to chart. Every state is
 * drawn: the first reads in flight, a read that failed with Try again, a
 * project nothing watches. SecurityCaseApi is the page's only door to the
 * server, so it is what is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: string = "44444444-4444-4444-8444-444444444444";

// A new project's case priorities and statuses, as the overview sends them.
const PRIORITY_VALUES: Array<SecurityOverviewValue> =
  DEFAULT_SECURITY_CASE_PRIORITIES.map(
    (priority: DefaultSecurityCasePriority): SecurityOverviewValue => {
      return {
        _id: TEST_PRIORITY_IDS[priority.level],
        name: priority.name,
        color: priority.color.toString(),
        order: priority.order,
        isArchived: false,
        [SECURITY_CASE_PRIORITY_LEVEL_FLAGS[priority.level]]: true,
      };
    },
  );

const STATUS_VALUES: Array<SecurityOverviewValue> =
  DEFAULT_SECURITY_CASE_STATUSES.map(
    (status: DefaultSecurityCaseStatus): SecurityOverviewValue => {
      return {
        _id: TEST_STATUS_IDS[status.stage],
        name: status.name,
        color: status.color.toString(),
        order: status.order,
        isArchived: false,
        [SECURITY_CASE_STAGE_FLAGS[status.stage]]: true,
      };
    },
  );

// The id of a new project's priority of a level: what the counts are keyed by.
function priorityId(level: SecurityCasePriorityLevel): string {
  return TEST_PRIORITY_IDS[level];
}

function status(
  overrides: Partial<SecuritySetupStatus> = {},
): SecuritySetupStatus {
  return {
    connections: 0,
    logsSourceEnabled: false,
    eventsLast24Hours: 0,
    lastEventAt: null,
    enabledRules: 0,
    recommendedRules: 19,
    recommendedRulesOn: 0,
    threatIntelFeeds: 0,
    openCases: 0,
    enabledPlaybooks: 0,
    destinations: 0,
    ...overrides,
  };
}

const SET_UP: Partial<SecuritySetupStatus> = {
  logsSourceEnabled: true,
  eventsLast24Hours: 1234,
  enabledRules: 19,
  recommendedRulesOn: 19,
  enabledPlaybooks: 1,
};

function overview(
  overrides: Partial<SecurityOverview["metrics"]> = {},
  top: Partial<SecurityOverview> = {},
): SecurityOverview {
  return {
    generatedAt: new Date("2026-10-19T12:00:00Z"),
    caseWindowInDays: 30,
    detectionWindowInDays: 14,
    myOpenCases: 0,
    runsWaitingForApproval: 0,
    isTruncated: false,
    metrics: {
      openCases: 0,
      unassignedOpenCases: 0,
      openByPriority: {},
      openByStatus: {},
      criticalOpenCases: 0,
      highOpenCases: 0,
      casesOpenedInWindow: 0,
      casesClosedInWindow: 0,
      verdictsInWindow: {},
      meanTimeToAcknowledgeInMinutes: null,
      meanTimeToContainInMinutes: null,
      meanTimeToCloseInMinutes: null,
      casesOpenedPerDay: [],
      detectionsPerDay: [],
      detectionsInWindow: 0,
      topRules: [],
      topTactics: [],
      ...overrides,
    },
    priorities: PRIORITY_VALUES,
    statuses: STATUS_VALUES,
    ...top,
  };
}

let statusAnswers: Array<SecuritySetupStatus | Error> = [];
let overviewAnswers: Array<SecurityOverview | Error> = [];
let allowed: (
  model: PermissionCheckableModel,
  action: ModelAction,
) => PermissionGateResult = (): PermissionGateResult => {
  return { isAllowed: true };
};

function answerStatus(...answers: Array<SecuritySetupStatus | Error>): void {
  statusAnswers = answers;
}

function answerOverview(...answers: Array<SecurityOverview | Error>): void {
  overviewAnswers = answers;
}

beforeEach(() => {
  // Get started's Dismiss is remembered in the browser, per project.
  window.localStorage.clear();
  statusAnswers = [status()];
  overviewAnswers = [overview()];
  allowed = (): PermissionGateResult => {
    return { isAllowed: true };
  };

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation(
      (model: PermissionCheckableModel, action: ModelAction) => {
        return allowed(model, action);
      },
    );
  jest
    .spyOn(SecurityCaseApi, "getSetupStatus")
    .mockImplementation(async (): Promise<SecuritySetupStatus> => {
      // The last answer repeats for every later read.
      const answer: SecuritySetupStatus | Error =
        statusAnswers.length > 1 ? statusAnswers.shift()! : statusAnswers[0]!;

      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    });
  jest
    .spyOn(SecurityCaseApi, "getOverview")
    .mockImplementation(async (): Promise<SecurityOverview> => {
      // The last answer repeats for every later read.
      const answer: SecurityOverview | Error =
        overviewAnswers.length > 1
          ? overviewAnswers.shift()!
          : overviewAnswers[0]!;

      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    });
  jest.spyOn(SecurityCaseApi, "getTopEntities").mockResolvedValue([]);
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
        <SecurityOverviewPage
          pageRoute={new Route("/dashboard/security-events/overview")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  // The skeleton goes once both reads have answered.
  await waitFor(() => {
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
}

function stage(key: string): HTMLElement {
  return screen.getByTestId(`security-pipeline-${key}`);
}

// The band at the top of the card: what the reader should know first.
function band(): HTMLElement {
  return screen.getByTestId(SECURITY_STATUS_HEADLINE_ID);
}

function card(): HTMLElement {
  return screen.getByTestId(SECURITY_OVERVIEW_STATUS_ID);
}

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

function queueOf(
  overrides: Partial<SecurityOverviewQueue> = {},
): SecurityOverviewQueue {
  return {
    openCases: 0,
    criticalOpenCases: 0,
    highOpenCases: 0,
    myOpenCases: 0,
    unassignedOpenCases: 0,
    runsWaitingForApproval: 0,
    ...overrides,
  };
}

function step(key: string): HTMLElement {
  return screen.getByTestId(`security-setup-step-${key}`);
}

function routeFor(page: PageMap, modelId?: string): string {
  return RouteUtil.populateRouteParams(
    RouteMap[page] as Route,
    modelId ? { modelId } : undefined,
  ).toString();
}

function actions(): HTMLElement {
  return screen.getByTestId("security-getting-started-actions");
}

function buttonTitles(container: HTMLElement): Array<string> {
  return within(container)
    .getAllByRole("button")
    .map((button: HTMLElement): string => {
      return (button.textContent || "").trim();
    });
}

function figures(): HTMLElement {
  return screen.getByRole("group", { name: "Security operations figures" });
}

const DISMISS_KEY: string = `security-get-started-dismissed-${PROJECT_ID.toString()}`;

describe("a project that has not set Security up", () => {
  test("sees Get started alone: one card, its next step first, and no pipeline telling the same story above it", async () => {
    await renderPage();

    const card: HTMLElement = screen.getByTestId(SECURITY_GETTING_STARTED_ID);

    expect(screen.queryByTestId(SECURITY_PIPELINE_ID)).toBeNull();
    expect(
      within(card).getByRole("heading", {
        name: "Set up Security in a minute",
      }),
    ).toBeInTheDocument();
    // The buttons sit under the sentence that explains them, the main one first.
    expect(buttonTitles(actions())).toEqual([
      "Turn on recommended",
      "Send a test attack",
    ]);
    expect(screen.queryByTestId("security-getting-started-locked")).toBeNull();
  });

  test("offers Get started with four steps, none done, and no charts of nothing", async () => {
    await renderPage();

    const card: HTMLElement = screen.getByTestId(SECURITY_GETTING_STARTED_ID);

    expect(card).toHaveTextContent("0 of 4 done");
    expect(
      ["sources", "detections", "responses", "test"].map((key: string) => {
        return step(key).getAttribute("data-done");
      }),
    ).toEqual(["false", "false", "false", "false"]);
    expect(within(step("sources")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_CONNECTIONS),
    );
    expect(within(step("detections")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_RULE_LIBRARY),
    );

    // Nothing to chart, and "All quiet" would say nothing before set-up.
    expect(screen.queryByTestId(SECURITY_OVERVIEW_STATUS_ID)).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Security operations figures" }),
    ).toBeNull();
    expect(screen.queryByText("Cases Opened")).toBeNull();
  });

  test("Turn on recommended turns it all on in one call, says what it did, and hands the main button to the test", async () => {
    const turnOn: SpyInstance<typeof SecurityCaseApi.turnOnRecommended> = jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockResolvedValue({
        rulesAdded: 19,
        rulesTurnedOn: 0,
        logsTurnedOn: true,
        playbookAdded: true,
        playbookTurnedOn: false,
        problems: [],
      } as TurnOnRecommendedResult);
    answerStatus(status(), status(SET_UP));
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-turn-on-recommended"));
    });

    expect(turnOn).toHaveBeenCalledTimes(1);
    expect(turnOn).toHaveBeenCalledWith();
    expect(await screen.findByTestId("security-turned-on")).toHaveTextContent(
      "Done. 19 detection rules are on, your logs are checked for security events and every new case is enriched.",
    );

    await waitFor(() => {
      expect(step("sources")).toHaveAttribute("data-done", "true");
    });
    expect(SecurityCaseApi.getSetupStatus).toHaveBeenCalledTimes(2);
    expect(step("detections")).toHaveAttribute("data-done", "true");
    expect(step("responses")).toHaveAttribute("data-done", "true");
    expect(step("test")).toHaveAttribute("data-done", "false");
    // Set up now, yet the card stays for the visit, so the test is one click away.
    expect(screen.getByTestId(SECURITY_GETTING_STARTED_ID)).toHaveTextContent(
      "3 of 4 done",
    );
    // Nothing is left to turn on: the test is the next step, and the only button.
    expect(buttonTitles(actions())).toEqual(["Send a test attack"]);
    expect(screen.queryByTestId("security-turn-on-recommended")).toBeNull();
    // The card is still the story; the pipeline waits until it is put away.
    expect(screen.queryByTestId(SECURITY_PIPELINE_ID)).toBeNull();
  });

  test("the test attack names the case it opened and links to it; Done puts the card away and the pipeline takes its place", async () => {
    const test: SpyInstance<typeof SecurityCaseApi.runSetupTest> = jest
      .spyOn(SecurityCaseApi, "runSetupTest")
      .mockResolvedValue({
        eventsSent: 12,
        caseId: CASE_ID,
        caseNumber: "#7",
        ruleAdded: false,
      } as SecuritySetupTestResult);
    answerOverview(
      overview(),
      overview({ openCases: 1, unassignedOpenCases: 1 }),
    );
    // Not set up at first, so Get started shows; set up after the test.
    answerStatus(status(), status({ ...SET_UP, openCases: 1 }));
    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(SECURITY_GETTING_STARTED_ID)).getByTestId(
          "security-run-setup-test",
        ),
      );
    });

    expect(test).toHaveBeenCalledTimes(1);

    const result: HTMLElement = await screen.findByTestId(
      "security-setup-test-result",
    );

    expect(result).toHaveTextContent(
      "The test opened case #7: a brute force attempt from one address.",
    );
    expect(
      within(result).getByRole("link", { name: /Open the case/ }),
    ).toHaveAttribute("href", routeFor(PageMap.SECURITY_CASE_VIEW, CASE_ID));

    const card: HTMLElement = screen.getByTestId(SECURITY_GETTING_STARTED_ID);

    await waitFor(() => {
      expect(card).toHaveTextContent("Security is set up");
    });
    expect(card).toHaveTextContent("4 of 4 done");
    // All done: Done is the one button, and there is nothing to dismiss.
    expect(buttonTitles(actions())).toEqual(["Done"]);
    expect(screen.queryByTestId("security-getting-started-dismiss")).toBeNull();
    /*
     * The case is open now: under the card, the band alone says nobody has
     * picked it up - the pipeline waits until the card is put away.
     */
    expect(
      screen.getByRole("link", { name: "1 open case nobody has picked up" }),
    ).toBeInTheDocument();
    expect(band()).toHaveAttribute(
      "data-kind",
      SecurityHeadlineKind.NeedsAttention,
    );
    expect(screen.queryByTestId(SECURITY_PIPELINE_ID)).toBeNull();
    // Get started first, the band under it.
    expect(
      screen
        .getByTestId(SECURITY_GETTING_STARTED_ID)
        .compareDocumentPosition(
          screen.getByTestId(SECURITY_OVERVIEW_STATUS_ID),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-getting-started-done"));
    });

    expect(screen.queryByTestId(SECURITY_GETTING_STARTED_ID)).toBeNull();
    expect(stage("cases")).toHaveTextContent("1 open case");
    // Done is for this visit; a project that is set up never shows the card again anyway.
    expect(window.localStorage.getItem(DISMISS_KEY)).toBeNull();
  });

  test("a failed click says why, in the card", async () => {
    // A refusal the server words for people, as SecurityCaseApi throws it.
    jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockRejectedValue(
        new SecurityApiError("You may not add detection rules.", 403),
      );
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-turn-on-recommended"));
    });

    expect(
      await within(screen.getByTestId(SECURITY_GETTING_STARTED_ID)).findByText(
        "You may not add detection rules.",
      ),
    ).toBeInTheDocument();
  });

  test("whoever may not add rules sees both buttons locked, and is told who can set Security up", async () => {
    allowed = (model: PermissionCheckableModel): PermissionGateResult => {
      return model.singularName === new DetectionRule().singularName
        ? {
            isAllowed: false,
            disabledReason: "You need Security Admin to add detection rules.",
          }
        : { isAllowed: true };
    };
    const turnOn: SpyInstance<typeof SecurityCaseApi.turnOnRecommended> =
      jest.spyOn(SecurityCaseApi, "turnOnRecommended");
    await renderPage();

    const turnOnButton: HTMLElement = screen.getByTestId(
      "security-turn-on-recommended",
    );
    const testButton: HTMLElement = screen.getByTestId(
      "security-run-setup-test",
    );

    expect(turnOnButton).toBeDisabled();
    expect(testButton).toBeDisabled();
    expect(
      screen.getByTestId("security-getting-started-locked"),
    ).toHaveTextContent(
      "Ask a Project Owner, Project Admin or Security Admin to set Security up.",
    );

    fireEvent.click(turnOnButton);
    expect(turnOn).not.toHaveBeenCalled();
  });

  test("a Security Member may send the test but not turn things on: the one click is locked, the test is not, and the note says who can", async () => {
    allowed = (model: PermissionCheckableModel): PermissionGateResult => {
      return model.singularName === new SecurityLogSource().singularName
        ? {
            isAllowed: false,
            disabledReason: "You need Security Admin to turn on your logs.",
          }
        : { isAllowed: true };
    };
    await renderPage();

    expect(screen.getByTestId("security-turn-on-recommended")).toBeDisabled();
    expect(screen.getByTestId("security-run-setup-test")).toBeEnabled();
    expect(
      screen.getByTestId("security-getting-started-locked"),
    ).toBeInTheDocument();
  });

  test("Dismiss puts the card away for good: the pipeline takes its place, and the next visit opens without it", async () => {
    answerStatus(status({ logsSourceEnabled: true, enabledRules: 4 }));
    await renderPage();

    expect(screen.queryByTestId(SECURITY_PIPELINE_ID)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-getting-started-dismiss"));
    });

    expect(screen.queryByTestId(SECURITY_GETTING_STARTED_ID)).toBeNull();
    // What is still missing reads on the pipeline now: no playbook responds.
    expect(stage("sources")).toHaveAttribute("data-ready", "true");
    expect(stage("playbooks")).toHaveAttribute("data-ready", "false");
    expect(stage("playbooks")).toHaveTextContent("Not set up");
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("true");

    cleanup();
    await renderPage();

    expect(screen.queryByTestId(SECURITY_GETTING_STARTED_ID)).toBeNull();
    expect(screen.getByTestId(SECURITY_PIPELINE_ID)).toBeInTheDocument();
  });

  test("Dismiss hangs over the title's line, so the description keeps its 4px under the title", async () => {
    await renderPage();

    const card: HTMLElement = screen.getByTestId(SECURITY_GETTING_STARTED_ID);
    const title: HTMLElement = within(card).getByRole("heading", {
      name: "Set up Security in a minute",
    });
    const dismiss: HTMLElement = screen.getByTestId(
      "security-getting-started-dismiss",
    );
    const row: HTMLElement = title.parentElement!;
    const description: HTMLElement = row.nextElementSibling as HTMLElement;

    // The title, Dismiss beside it, then the description after their row.
    expect(row).toContainElement(dismiss);
    expect(description.tagName).toBe("P");
    expect(description).toHaveClass("mt-1");

    /*
     * Dismiss is 28px: a 20px line (text-sm) between 4px paddings (Small).
     * Its box hangs 2px over the title's 24px line (text-base) above and
     * below, so the row is the title's line and the description follows
     * the title by its own 4px - not 8px.
     */
    expect(dismiss).toHaveClass("text-sm", "py-1");
    expect(title).toHaveClass("text-base");
    const box: HTMLElement = dismiss.parentElement!;
    expect(box.parentElement).toBe(row);

    for (const width of WIDTHS_IN_PX) {
      const margin: { top: number; bottom: number } = resolveSpacing(
        box.getAttribute("class"),
        width,
        "margin",
      );
      const padding: { top: number; bottom: number } = resolveSpacing(
        dismiss.getAttribute("class"),
        width,
        "padding",
      );

      expect(margin).toMatchObject({ top: -2, bottom: -2 });
      expect(
        20 + padding.top + padding.bottom + margin.top + margin.bottom,
      ).toBe(24);
    }
  });
});

describe("when Turn on recommended cannot do everything", () => {
  function result(
    overrides: Partial<TurnOnRecommendedResult> = {},
  ): TurnOnRecommendedResult {
    return {
      rulesAdded: 0,
      rulesTurnedOn: 0,
      logsTurnedOn: false,
      playbookAdded: false,
      playbookTurnedOn: false,
      problems: [],
      ...overrides,
    };
  }

  function problem(
    overrides: Partial<TurnOnRecommendedProblem> = {},
  ): TurnOnRecommendedProblem {
    return {
      part: TurnOnRecommendedPart.Rule,
      action: TurnOnRecommendedAction.Add,
      name: "Password spraying",
      reason: TurnOnRecommendedReason.Failed,
      detail: "",
      ...overrides,
    };
  }

  function problemsBox(): HTMLElement {
    return within(screen.getByTestId(SECURITY_GETTING_STARTED_ID)).getByTestId(
      "security-turn-on-problems",
    );
  }

  function rows(box: HTMLElement): Array<string> {
    return within(box)
      .queryAllByTestId("security-turn-on-problem")
      .map((row: HTMLElement): string => {
        return (row.textContent || "").trim();
      });
  }

  async function clickTurnOn(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByTestId("security-turn-on-recommended"));
    });
  }

  test("names what it could not do and why, says the rest is on, and Try again - the main button now - does the rest", async () => {
    const turnOn: SpyInstance<typeof SecurityCaseApi.turnOnRecommended> = jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockResolvedValueOnce(
        result({
          rulesAdded: 18,
          logsTurnedOn: true,
          problems: [
            problem(),
            problem({
              part: TurnOnRecommendedPart.Playbook,
              name: "Enrich New Cases",
              reason: TurnOnRecommendedReason.NotAllowed,
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        result({ rulesAdded: 1, playbookAdded: true, problems: [] }),
      );
    answerStatus(
      status(),
      status({ logsSourceEnabled: true, enabledRules: 18 }),
      status(SET_UP),
    );
    await renderPage();

    await clickTurnOn();

    const box: HTMLElement = await within(
      screen.getByTestId(SECURITY_GETTING_STARTED_ID),
    ).findByTestId("security-turn-on-problems");

    expect(box).toHaveAttribute("role", "alert");
    expect(box).toHaveTextContent("Not everything could be turned on");
    expect(rows(box)).toEqual([
      "Password spraying - Something went wrong while adding it.",
      "Enrich New Cases - Your role cannot add it.",
    ]);
    expect(box).toHaveTextContent(
      "Everything else is on. Try again turns on only what is still missing.",
    );
    // Not done, so no Done line; and no grey sentence alone under the buttons.
    expect(screen.queryByTestId("security-turned-on")).toBeNull();
    await waitFor(() => {
      expect(step("sources")).toHaveAttribute("data-done", "true");
    });
    expect(step("responses")).toHaveAttribute("data-done", "false");
    expect(buttonTitles(actions())).toEqual([
      "Try again",
      "Send a test attack",
    ]);
    expect(screen.queryByTestId("security-turn-on-recommended")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-turn-on-try-again"));
    });

    // The same call, which does only what is still missing.
    expect(turnOn).toHaveBeenCalledTimes(2);
    expect(turnOn).toHaveBeenNthCalledWith(2);
    expect(await screen.findByTestId("security-turned-on")).toHaveTextContent(
      "Done. 19 detection rules are on, your logs are checked for security events and every new case is enriched.",
    );
    expect(
      within(screen.getByTestId(SECURITY_GETTING_STARTED_ID)).queryByTestId(
        "security-turn-on-problems",
      ),
    ).toBeNull();
    expect(buttonTitles(actions())).toEqual(["Send a test attack"]);
  });

  test("a click that fails whole says so in the card, with the server's sentence, and offers Try again", async () => {
    jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockRejectedValue(
        new SecurityApiError(
          "Turning on detection rules takes a role that can create them.",
          403,
        ),
      );
    await renderPage();

    await clickTurnOn();

    const box: HTMLElement = await within(
      screen.getByTestId(SECURITY_GETTING_STARTED_ID),
    ).findByTestId("security-turn-on-problems");

    expect(
      within(box).getByTestId("security-turn-on-problems-title"),
    ).toHaveTextContent("Turn on recommended did not finish");
    expect(
      within(box).getByTestId("security-turn-on-problems-error"),
    ).toHaveTextContent(
      "Turning on detection rules takes a role that can create them.",
    );
    // Why it did not finish, and nothing more: no note a role would make untrue.
    expect(
      within(box).queryByTestId("security-turn-on-problems-note"),
    ).toBeNull();
    expect(box).not.toHaveTextContent("Everything else is on.");
    expect(rows(box)).toEqual([]);
    expect(buttonTitles(actions())).toEqual([
      "Try again",
      "Send a test attack",
    ]);

    // The old centred grey line is gone from the card.
    expect(
      screen
        .getByTestId(SECURITY_GETTING_STARTED_ID)
        .querySelector(".text-center.my-10"),
    ).toBeNull();
  });

  test.each([
    {
      name: "a failure on OneUptime's side",
      error: new SecurityApiError("Server Error", 500),
      raw: "Server Error",
    },
    {
      name: "a gateway that could not reach the server",
      error: new SecurityApiError(
        "Error connecting to server. Please try again in few minutes.",
        502,
      ),
      raw: "Error connecting to server",
    },
    {
      name: "a request that never got an answer",
      error: new Error(
        "Request failed to https://oneuptime.example/api/security-case/setup/turn-on-recommended. Network error",
      ),
      raw: "Request failed",
    },
  ])(
    "a click that fails whole with $name says so in the product's words, never the raw message",
    async ({ error, raw }: { error: Error; raw: string }) => {
      jest.spyOn(SecurityCaseApi, "turnOnRecommended").mockRejectedValue(error);
      await renderPage();

      await clickTurnOn();

      const box: HTMLElement = await within(
        screen.getByTestId(SECURITY_GETTING_STARTED_ID),
      ).findByTestId("security-turn-on-problems");

      expect(
        within(box).getByTestId("security-turn-on-problems-error"),
      ).toHaveTextContent("Something went wrong. Try again in a moment.");
      expect(box).not.toHaveTextContent(raw);
      expect(buttonTitles(actions())).toEqual([
        "Try again",
        "Send a test attack",
      ]);
    },
  );

  test("each click's answer is drawn afresh: a Try again that comes back with the same thing missing is announced again", async () => {
    const turnOn: SpyInstance<typeof SecurityCaseApi.turnOnRecommended> = jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockResolvedValue(result({ rulesAdded: 18, problems: [problem()] }));
    await renderPage();

    await clickTurnOn();
    const first: HTMLElement = await within(
      screen.getByTestId(SECURITY_GETTING_STARTED_ID),
    ).findByTestId("security-turn-on-problems");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-turn-on-try-again"));
    });

    expect(turnOn).toHaveBeenCalledTimes(2);
    const second: HTMLElement = problemsBox();
    // The same words, in a new alert - not the old one left standing.
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(second).toHaveAttribute("role", "alert");
    expect(rows(second)).toEqual([
      "Password spraying - Something went wrong while adding it.",
    ]);
  });

  test("the box reads as a title, a list of what is missing and a note", async () => {
    jest.spyOn(SecurityCaseApi, "turnOnRecommended").mockResolvedValue(
      result({
        rulesAdded: 18,
        problems: [
          problem(),
          problem({
            part: TurnOnRecommendedPart.Playbook,
            name: "Enrich New Cases",
          }),
        ],
      }),
    );
    await renderPage();

    await clickTurnOn();

    await waitFor(() => {
      expect(problemsBox()).toBeInTheDocument();
    });
    expect(
      within(problemsBox()).getByTestId("security-turn-on-problems-title"),
    ).toHaveTextContent(/^Not everything could be turned on$/);
    // A list a screen reader counts, one item per thing that is missing.
    expect(within(problemsBox()).getByRole("list")).toBeInTheDocument();
    expect(within(problemsBox()).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(problemsBox()).getByTestId("security-turn-on-problems-note"),
    ).toHaveTextContent(
      /^Everything else is on\. Try again turns on only what is still missing\.$/,
    );
    // Nothing more to open when every row is shown.
    expect(
      within(problemsBox()).queryByTestId("security-turn-on-problems-more"),
    ).toBeNull();
  });

  test("a click that turned nothing on does not say the rest is on", async () => {
    jest.spyOn(SecurityCaseApi, "turnOnRecommended").mockResolvedValue(
      result({
        problems: [
          problem({
            action: TurnOnRecommendedAction.Check,
            name: "",
            reason: TurnOnRecommendedReason.NotAllowed,
          }),
        ],
      }),
    );
    await renderPage();

    await clickTurnOn();

    await waitFor(() => {
      expect(problemsBox()).toBeInTheDocument();
    });
    expect(rows(problemsBox())).toEqual([
      "The recommended detection rules - Your role cannot read what the project already has, so nothing was added.",
    ]);
    expect(problemsBox()).not.toHaveTextContent("Everything else is on.");
    expect(problemsBox()).toHaveTextContent(
      "Try again turns on only what is still missing.",
    );
  });

  test("a record OneUptime would not save says why in its own words; a plan says its own sentence; your logs read by their switch", async () => {
    jest.spyOn(SecurityCaseApi, "turnOnRecommended").mockResolvedValue(
      result({
        rulesAdded: 17,
        problems: [
          problem({
            part: TurnOnRecommendedPart.Logs,
            name: "",
            action: TurnOnRecommendedAction.TurnOn,
            reason: TurnOnRecommendedReason.NotAllowed,
          }),
          problem({
            name: "Failed sign-ins, then a success from the same address",
            reason: TurnOnRecommendedReason.Refused,
            detail: "Sigma rule YAML is required.",
          }),
          problem({
            name: "Port scan",
            reason: TurnOnRecommendedReason.Plan,
            detail: "Please upgrade your plan to Growth to access this feature",
          }),
        ],
      }),
    );
    await renderPage();

    await clickTurnOn();

    await waitFor(() => {
      expect(problemsBox()).toBeInTheDocument();
    });
    expect(rows(problemsBox())).toEqual([
      "Find security events in your logs - It is turned off, and your role cannot turn it back on.",
      "Failed sign-ins, then a success from the same address - OneUptime could not save it: Sigma rule YAML is required.",
      "Port scan - Please upgrade your plan to Growth to access this feature",
    ]);
  });

  test(`more than ${MAX_PROBLEMS_SHOWN} things: the first ${MAX_PROBLEMS_SHOWN}, and Show N more opens the rest`, async () => {
    jest.spyOn(SecurityCaseApi, "turnOnRecommended").mockResolvedValue(
      result({
        problems: Array.from({ length: MAX_PROBLEMS_SHOWN + 2 }).map(
          (_value: unknown, index: number): TurnOnRecommendedProblem => {
            return problem({ name: `Rule ${index + 1}` });
          },
        ),
      }),
    );
    await renderPage();

    await clickTurnOn();

    await waitFor(() => {
      expect(problemsBox()).toBeInTheDocument();
    });
    expect(rows(problemsBox())).toHaveLength(MAX_PROBLEMS_SHOWN);
    expect(rows(problemsBox())[0]).toBe(
      "Rule 1 - Something went wrong while adding it.",
    );

    const more: HTMLElement = within(problemsBox()).getByTestId(
      "security-turn-on-problems-more",
    );
    expect(more.tagName).toBe("BUTTON");
    expect(more).toHaveTextContent(/^Show 2 more$/);
    expect(more).toHaveAttribute("aria-expanded", "false");
    // It names the list it opens.
    expect(more.getAttribute("aria-controls")).toBe(
      within(problemsBox()).getByRole("list").id,
    );

    fireEvent.click(more);

    expect(rows(problemsBox())).toHaveLength(MAX_PROBLEMS_SHOWN + 2);
    expect(rows(problemsBox())[MAX_PROBLEMS_SHOWN + 1]).toBe(
      `Rule ${MAX_PROBLEMS_SHOWN + 2} - Something went wrong while adding it.`,
    );
    expect(more).toHaveTextContent(/^Show less$/);
    expect(more).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(more);

    expect(rows(problemsBox())).toHaveLength(MAX_PROBLEMS_SHOWN);
    expect(more).toHaveTextContent(/^Show 2 more$/);
  });

  test("a test attack that completes the steps while something is still missing: Done leads, and Try again stays beside it", async () => {
    jest.spyOn(SecurityCaseApi, "turnOnRecommended").mockResolvedValue(
      result({
        rulesAdded: 19,
        logsTurnedOn: true,
        playbookAdded: true,
        problems: [problem()],
      }),
    );
    jest.spyOn(SecurityCaseApi, "runSetupTest").mockResolvedValue({
      eventsSent: 12,
      caseId: CASE_ID,
      caseNumber: "#7",
      ruleAdded: false,
    } as SecuritySetupTestResult);
    answerStatus(
      status(),
      status({ ...SET_UP, enabledRules: 19 }),
      status({ ...SET_UP, enabledRules: 19, openCases: 1 }),
    );
    await renderPage();

    await clickTurnOn();
    await waitFor(() => {
      expect(problemsBox()).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-run-setup-test"));
    });

    await waitFor(() => {
      expect(screen.getByTestId(SECURITY_GETTING_STARTED_ID)).toHaveTextContent(
        "Security is set up",
      );
    });
    // The rule still missing is still said, and can still be tried again.
    expect(rows(problemsBox())).toEqual([
      "Password spraying - Something went wrong while adding it.",
    ]);
    expect(buttonTitles(actions())).toEqual(["Done", "Try again"]);
    expect(screen.getByTestId("security-turn-on-try-again")).toBeEnabled();
  });

  test("a test attack that fails says so in the card, in the same box", async () => {
    jest
      .spyOn(SecurityCaseApi, "runSetupTest")
      .mockRejectedValue(
        new SecurityApiError(
          "Running a test takes a role that can read cases.",
          403,
        ),
      );
    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(SECURITY_GETTING_STARTED_ID)).getByTestId(
          "security-run-setup-test",
        ),
      );
    });

    const box: HTMLElement = await screen.findByTestId(
      "security-setup-test-error",
    );

    expect(box).toHaveAttribute("role", "alert");
    expect(box).toHaveTextContent("The test attack could not be sent");
    expect(box).toHaveTextContent(
      "Running a test takes a role that can read cases.",
    );
    // The one click is untouched: nothing to try again there.
    expect(buttonTitles(actions())).toEqual([
      "Turn on recommended",
      "Send a test attack",
    ]);
  });

  test("a test attack that fails on OneUptime's side says so in the product's words", async () => {
    jest
      .spyOn(SecurityCaseApi, "runSetupTest")
      .mockRejectedValue(new SecurityApiError("Server Error", 500));
    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(SECURITY_GETTING_STARTED_ID)).getByTestId(
          "security-run-setup-test",
        ),
      );
    });

    const box: HTMLElement = await screen.findByTestId(
      "security-setup-test-error",
    );

    expect(
      within(box).getByTestId("security-turn-on-problems-error"),
    ).toHaveTextContent("Something went wrong. Try again in a moment.");
    expect(box).not.toHaveTextContent("Server Error");
  });

  test("the box and the test's box can show together, and neither carries an id the other repeats", async () => {
    jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockResolvedValue(result({ rulesAdded: 18, problems: [problem()] }));
    jest
      .spyOn(SecurityCaseApi, "runSetupTest")
      .mockRejectedValue(new SecurityApiError("Server Error", 500));
    await renderPage();

    await clickTurnOn();
    await act(async () => {
      fireEvent.click(screen.getByTestId("security-run-setup-test"));
    });

    await screen.findByTestId("security-setup-test-error");
    expect(problemsBox()).toBeInTheDocument();

    const ids: Array<string> = Array.from(
      screen.getByTestId(SECURITY_GETTING_STARTED_ID).querySelectorAll("[id]"),
    ).map((element: Element): string => {
      return element.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the pipeline", () => {
  function renderPipeline(
    value: SecuritySetupStatus,
    queue: Partial<SecurityOverviewQueue> = {},
  ): void {
    render(
      <MemoryRouter>
        <SecurityPipeline
          status={value}
          queue={queueOf(queue)}
          now={new Date()}
        />
      </MemoryRouter>,
    );
  }

  test("marks every part not set up in grey with what to do, the cases ready, each cell a link to where it is done", () => {
    renderPipeline(status());

    const pipeline: HTMLElement = screen.getByTestId(SECURITY_PIPELINE_ID);

    expect(pipeline).toHaveAttribute("aria-label", "How Security works here");
    expect(
      ["sources", "detections", "cases", "playbooks"].map((key: string) => {
        return [
          key,
          stage(key).getAttribute("data-ready"),
          stage(key).getAttribute("data-tone"),
        ];
      }),
    ).toEqual([
      ["sources", "false", "neutral"],
      ["detections", "false", "neutral"],
      ["cases", "true", "success"],
      ["playbooks", "false", "neutral"],
    ]);
    expect(stage("sources")).toHaveTextContent("Not set up");
    expect(stage("sources")).toHaveTextContent("Connect a source");
    expect(stage("detections")).toHaveTextContent("Turn on rules");
    expect(stage("cases")).toHaveTextContent("None open");
    expect(stage("cases")).toHaveTextContent("All clear");
    expect(stage("playbooks")).toHaveTextContent("Add a playbook");
    // Grey, never the amber card that competed with the band above it.
    expect(
      screen.getByTestId("security-pipeline-playbooks-figure"),
    ).toHaveClass("text-gray-500");
    expect(stage("playbooks").className).not.toMatch(/amber/);
    expect(within(stage("sources")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_CONNECTIONS),
    );
    // No rule on: the cell opens the library, where rules are added.
    expect(within(stage("detections")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_RULE_LIBRARY),
    );
    expect(within(stage("cases")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_CASES),
    );
    expect(within(stage("playbooks")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_PLAYBOOKS),
    );
  });

  test("a part set up opens its own page: Detections the project's rules", () => {
    renderPipeline(status(SET_UP));

    expect(within(stage("detections")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_DETECTION_RULES),
    );
  });

  test("one card's row of cells on a hairline grid, two by two until a wide screen, a chevron on each line between them only when they are one row", () => {
    renderPipeline(status(SET_UP));

    const list: HTMLElement = screen
      .getByTestId(SECURITY_PIPELINE_ID)
      .querySelector("ol")!;

    expect(list).toHaveClass(
      "grid",
      "grid-cols-2",
      "lg:grid-cols-4",
      "gap-px",
      "bg-gray-200",
    );
    expect(list.children).toHaveLength(4);

    const arrows: Array<HTMLElement> = screen.getAllByTestId(
      "security-pipeline-arrow",
    );

    // Between the four cells, never after the last.
    expect(arrows).toHaveLength(3);
    expect(
      within(stage("playbooks")).queryByTestId("security-pipeline-arrow"),
    ).toBeNull();
    for (const arrow of arrows) {
      expect(arrow).toHaveAttribute("aria-hidden", "true");
      expect(arrow).toHaveClass("max-lg:hidden", "pointer-events-none");
      /*
       * On the cell's end edge and pointing on, in either reading
       * direction: the left edge, pointing left, in a right-to-left page.
       */
      expect(arrow).toHaveClass(
        "end-0",
        "translate-x-1/2",
        "rtl:-translate-x-1/2",
      );
      expect(arrow.className).not.toMatch(/(^| )right-0( |$)/);
      expect(arrow.querySelector("svg")).toHaveClass("rtl:rotate-180");
    }
    // Every cell is one link, the whole cell.
    for (const key of ["sources", "detections", "cases", "playbooks"]) {
      expect(within(stage(key)).getAllByRole("link")).toHaveLength(1);
    }
  });

  test("words each figure short enough to sit on one line beside the side menu", () => {
    renderPipeline(
      status({
        ...SET_UP,
        connections: 1,
        eventsLast24Hours: 18432,
        enabledRules: 6,
        recommendedRulesOn: 3,
        enabledPlaybooks: 3,
      }),
    );

    expect(stage("sources")).toHaveTextContent("2 sources");
    expect(stage("sources")).toHaveTextContent("18,432 events in 24 hours");
    expect(stage("detections")).toHaveTextContent("6 rules on");
    expect(stage("detections")).toHaveTextContent("3 of 19 recommended");
    expect(stage("detections")).not.toHaveTextContent("recommended rules on");
    expect(stage("playbooks")).toHaveTextContent("3 playbooks on");
  });

  test("under the open cases: the critical and high ones in red, or that none of them is urgent", () => {
    renderPipeline(status({ ...SET_UP, openCases: 4 }), {
      openCases: 4,
      criticalOpenCases: 2,
      highOpenCases: 1,
    });

    expect(stage("cases")).toHaveTextContent("4 open cases");
    expect(stage("cases")).toHaveTextContent("2 critical · 1 high");
    expect(stage("cases")).toHaveAttribute("data-tone", "danger");

    cleanup();
    renderPipeline(status({ ...SET_UP, openCases: 4 }), { openCases: 4 });

    expect(stage("cases")).toHaveTextContent("None critical or high");
    // "0 critical · 0 high" would say nothing.
    expect(stage("cases")).not.toHaveTextContent("0 critical");
  });

  test("sources gone quiet say when they last sent, in amber; a step held for an approval reads under the playbooks", () => {
    renderPipeline(
      status({
        ...SET_UP,
        eventsLast24Hours: 0,
        lastEventAt: new Date(Date.now() - 3 * DAY_IN_MS),
      }),
      { runsWaitingForApproval: 1 },
    );

    expect(stage("sources")).toHaveTextContent("Last event 3 days ago");
    expect(stage("sources")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByTestId("security-pipeline-sources-status")).toHaveClass(
      "text-amber-700",
    );
    expect(stage("playbooks")).toHaveTextContent("1 step to approve");
    expect(stage("playbooks")).toHaveAttribute("data-tone", "warning");
  });
});

describe("a project with Security set up", () => {
  test("nothing waiting: All quiet, with the test attack beside it, and no Get started or charts", async () => {
    answerStatus(status(SET_UP));
    await renderPage();

    const quiet: HTMLElement = band();

    expect(quiet).toHaveAttribute("data-kind", SecurityHeadlineKind.Quiet);
    expect(quiet).toHaveClass("bg-emerald-50");
    expect(
      within(quiet).getByRole("heading", { name: "All quiet" }),
    ).toBeInTheDocument();
    expect(
      within(quiet).getByTestId("security-status-summary"),
    ).toHaveTextContent(
      "No open case and nothing waiting for an approval. When a rule finds a threat, its case opens here and your playbooks run on it.",
    );
    expect(
      within(quiet).getByTestId("security-run-setup-test"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(SECURITY_GETTING_STARTED_ID)).toBeNull();
    expect(
      screen.queryByRole("link", { name: /nobody has picked up/ }),
    ).toBeNull();
    expect(stage("sources")).toHaveTextContent("1 source");
    expect(stage("sources")).toHaveTextContent("1,234 events in 24 hours");
    expect(stage("playbooks")).toHaveTextContent("1 playbook on");
    expect(stage("playbooks")).toHaveTextContent("Nothing waiting");
  });

  test("something waiting: Needs attention lists each count, the charts follow, and the cases cell says none is urgent", async () => {
    answerStatus(status({ ...SET_UP, openCases: 3 }));
    answerOverview(
      overview(
        {
          openCases: 3,
          unassignedOpenCases: 2,
          casesOpenedInWindow: 5,
          detectionsInWindow: 9,
          openByPriority: { [priorityId(SecurityCasePriorityLevel.Medium)]: 3 },
        },
        { myOpenCases: 1, runsWaitingForApproval: 1 },
      ),
    );
    await renderPage();

    const attention: HTMLElement = band();

    expect(attention).toHaveAttribute(
      "data-kind",
      SecurityHeadlineKind.NeedsAttention,
    );
    // Amber: nothing critical or high is open.
    expect(attention).toHaveClass("bg-amber-50");
    expect(
      within(attention).getByRole("heading", { name: "Needs attention" }),
    ).toBeInTheDocument();
    expect(
      within(attention)
        .getByRole("list", { name: "What needs someone now" })
        .querySelectorAll("li"),
    ).toHaveLength(3);
    expect(
      within(attention)
        .getAllByRole("link")
        .map((link: HTMLElement): string => {
          return (link.textContent || "").trim();
        }),
    ).toEqual([
      "1 open case assigned to you",
      "2 open cases nobody has picked up",
      "1 playbook step waiting for approval",
    ]);
    // Nothing to send a test attack for: something is already here.
    expect(
      within(attention).queryByTestId("security-run-setup-test"),
    ).toBeNull();
    expect(figures()).toBeInTheDocument();
    expect(screen.getByText("Cases Opened")).toBeInTheDocument();
    expect(stage("cases")).toHaveTextContent("3 open cases");
    expect(stage("cases")).toHaveTextContent("None critical or high");
    expect(stage("playbooks")).toHaveTextContent("1 step to approve");
  });

  test("each count opens the page that lists exactly what it counts", async () => {
    /*
     * The queue's views and the runs' views are pages of their own: the
     * cases assigned to you open Assigned to Me, the ones nobody has
     * picked up open Unassigned, the held steps open Waiting for Approval.
     */
    answerStatus(status({ ...SET_UP, openCases: 3 }));
    answerOverview(
      overview(
        {
          openCases: 3,
          unassignedOpenCases: 2,
          casesOpenedInWindow: 5,
          detectionsInWindow: 9,
          openByPriority: { [priorityId(SecurityCasePriorityLevel.Medium)]: 3 },
        },
        { myOpenCases: 1, runsWaitingForApproval: 1 },
      ),
    );
    await renderPage();

    const tile: (name: string) => HTMLElement = (name: string): HTMLElement => {
      return screen.getByRole("link", { name });
    };

    expect(tile("1 open case assigned to you")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_CASES_ASSIGNED_TO_ME),
    );
    expect(tile("2 open cases nobody has picked up")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_CASES_UNASSIGNED),
    );
    expect(tile("1 playbook step waiting for approval")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL),
    );
    // The cases stage still opens the queue itself, at its old address.
    expect(within(stage("cases")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_CASES),
    );
  });

  test("urgent cases read on the pipeline and turn the band red, and the figures below keep to the timings instead of counting the open cases again", async () => {
    answerStatus(status({ ...SET_UP, openCases: 4 }));
    answerOverview(
      overview({
        openCases: 4,
        unassignedOpenCases: 1,
        casesOpenedInWindow: 4,
        openByPriority: {
          [priorityId(SecurityCasePriorityLevel.Critical)]: 2,
          [priorityId(SecurityCasePriorityLevel.High)]: 1,
          [priorityId(SecurityCasePriorityLevel.Low)]: 1,
        },
        // As the server counts them, by the project's priorities.
        criticalOpenCases: 2,
        highOpenCases: 1,
      }),
    );
    await renderPage();

    expect(stage("cases")).toHaveTextContent("4 open cases");
    expect(stage("cases")).toHaveTextContent("2 critical · 1 high");
    expect(band()).toHaveAttribute("data-tone", "danger");
    expect(band()).toHaveClass("bg-red-50");
    expect(within(figures()).queryByText("Open Cases")).toBeNull();
    expect(
      within(figures()).getByText("Mean Time to Acknowledge"),
    ).toBeVisible();
    expect(within(figures()).getByText("Mean Time to Contain")).toBeVisible();
    expect(within(figures()).getByText("Mean Time to Close")).toBeVisible();
  });

  test("a SIEM the events are sent to is named at the card's foot, a link to Connections", async () => {
    answerStatus(status({ ...SET_UP, destinations: 1 }));
    await renderPage();

    const foot: HTMLElement = screen.getByTestId(
      "security-pipeline-destinations",
    );

    expect(foot).toHaveTextContent("Security events are also sent to 1 SIEM.");
    expect(card()).toContainElement(foot);
    expect(within(foot).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_CONNECTIONS),
    );
  });

  test("without a SIEM, the card has no foot", async () => {
    answerStatus(status(SET_UP));
    await renderPage();

    expect(screen.queryByTestId("security-pipeline-destinations")).toBeNull();
  });
});

describe("the charts below the card", () => {
  test("every card fills its row, so each row of cards ends on one line", async () => {
    answerStatus(status({ ...SET_UP, openCases: 3 }));
    answerOverview(
      overview({
        openCases: 3,
        casesOpenedInWindow: 5,
        detectionsInWindow: 9,
        topTactics: [{ tacticId: "TA0006", count: 4 }],
      }),
    );
    await renderPage();

    for (const title of [
      "Cases Opened",
      "Detections",
      "Open Cases",
      "Verdicts",
      "MITRE ATT&CK Tactics",
      "Top Detections",
      "Riskiest Entities",
    ]) {
      const heading: HTMLElement | undefined = screen
        .getAllByText(title)
        .find((candidate: HTMLElement): boolean => {
          return Boolean(candidate.closest('[data-testid="card"]'));
        });
      const card: HTMLElement = heading!.closest(
        '[data-testid="card"]',
      ) as HTMLElement;

      expect([title, card.className.includes("h-full")]).toEqual([title, true]);
    }
  });

  test("a tactic behind the cases opens ATT&CK Coverage on that tactic", async () => {
    answerStatus(status({ ...SET_UP, openCases: 3 }));
    answerOverview(
      overview({
        openCases: 3,
        casesOpenedInWindow: 5,
        detectionsInWindow: 9,
        topTactics: [{ tacticId: "TA0006", count: 4 }],
      }),
    );
    await renderPage();

    const tactic: HTMLElement = screen
      .getByText("TA0006 Credential Access")
      .closest("a") as HTMLElement;

    expect(tactic.getAttribute("href")).toContain(
      "/security-events/attack-coverage?tactic=TA0006",
    );
  });
});

describe("a server that cannot answer the set-up figures", () => {
  test("says so in the pipeline's place, with Try again - never leaves the page, never claims nothing is watched", async () => {
    answerStatus(new Error("Not found"));
    await renderPage();

    expect(band()).toHaveAttribute("data-kind", SecurityHeadlineKind.Quiet);
    expect(screen.queryByTestId(SECURITY_PIPELINE_ID)).toBeNull();
    expect(screen.queryByTestId(SECURITY_GETTING_STARTED_ID)).toBeNull();

    const failed: HTMLElement = screen.getByTestId("security-pipeline-error");

    expect(card()).toContainElement(failed);
    expect(failed).toHaveTextContent(
      "We could not load how Security is set up.",
    );
    expect(failed).not.toHaveTextContent("Not found");
    expect(
      within(failed).getByTestId("security-pipeline-try-again"),
    ).toBeEnabled();
  });

  test("Try again reads both again, and the pipeline takes the error's place", async () => {
    answerStatus(new Error("Not found"), status(SET_UP));
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-pipeline-try-again"));
    });

    await waitFor(() => {
      expect(screen.getByTestId(SECURITY_PIPELINE_ID)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("security-pipeline-error")).toBeNull();
    expect(SecurityCaseApi.getSetupStatus).toHaveBeenCalledTimes(2);
    expect(SecurityCaseApi.getOverview).toHaveBeenCalledTimes(2);
    expect(stage("sources")).toHaveTextContent("1 source");
  });

  test("still counts the open cases, in the figures, when there is no pipeline to count them", async () => {
    answerStatus(new Error("Not found"));
    answerOverview(
      overview({
        openCases: 2,
        unassignedOpenCases: 2,
        casesOpenedInWindow: 2,
        openByPriority: { [priorityId(SecurityCasePriorityLevel.High)]: 2 },
        highOpenCases: 2,
      }),
    );
    await renderPage();

    expect(screen.queryByTestId(SECURITY_PIPELINE_ID)).toBeNull();
    expect(within(figures()).getByText("Open Cases")).toBeVisible();
    expect(figures()).toHaveTextContent("0 critical · 2 high");
  });

  test("writes the figures' numbers the reader's way", async () => {
    answerStatus(new Error("Not found"));
    answerOverview(
      overview({
        openCases: 2500,
        unassignedOpenCases: 0,
        casesOpenedInWindow: 2500,
        openByPriority: {
          [priorityId(SecurityCasePriorityLevel.Critical)]: 1500,
          [priorityId(SecurityCasePriorityLevel.High)]: 1000,
        },
        criticalOpenCases: 1500,
        highOpenCases: 1000,
      }),
    );
    await renderPage();

    expect(figures()).toHaveTextContent("1,500 critical · 1,000 high");
  });

  test("draws the open cases by the project's own priorities and statuses, as it names them", async () => {
    answerStatus(new Error("Not found"));
    answerOverview(
      overview(
        {
          openCases: 3,
          unassignedOpenCases: 0,
          casesOpenedInWindow: 3,
          openByPriority: {
            [priorityId(SecurityCasePriorityLevel.Critical)]: 1,
            "c1000000-0000-4000-8000-0000000000e1": 2,
          },
          openByStatus: {
            [TEST_STATUS_IDS[SecurityCaseStage.New]]: 1,
            "c2000000-0000-4000-8000-0000000000a2": 2,
          },
          criticalOpenCases: 3,
        },
        {
          priorities: [
            {
              _id: "c1000000-0000-4000-8000-0000000000e1",
              name: "Emergency",
              color: "#000000",
              order: 0,
              isArchived: false,
            },
            ...PRIORITY_VALUES.map((value: SecurityOverviewValue) => {
              return value._id ===
                priorityId(SecurityCasePriorityLevel.Critical)
                ? { ...value, name: "Sev 1" }
                : value;
            }),
          ],
          statuses: [
            ...STATUS_VALUES.map((value: SecurityOverviewValue) => {
              return value._id === TEST_STATUS_IDS[SecurityCaseStage.Closed]
                ? { ...value, order: 5 }
                : value;
            }),
            {
              _id: "c2000000-0000-4000-8000-0000000000a2",
              name: "Eradicating",
              color: "#123456",
              order: 4,
              isArchived: false,
            },
          ],
        },
      ),
    );
    await renderPage();

    const openCases: HTMLElement = screen
      .getByRole("heading", { name: "Open Cases" })
      .closest("section, div[class*='rounded']") as HTMLElement;
    const text: string = openCases.textContent || "";

    // The project's own names, most urgent first.
    expect(text.indexOf("Emergency")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Emergency")).toBeLessThan(text.indexOf("Sev 1"));
    // Its own open status among the open ones; a closed one never drawn.
    expect(text).toContain("Eradicating");
    expect(text).not.toContain("Closed");
    expect(figures()).toHaveTextContent("3 critical · 0 high");
  });
});

describe("the top card", () => {
  test("is one card named by its headline: the band first, the pipeline under it", async () => {
    answerStatus(status(SET_UP));
    await renderPage();

    const top: HTMLElement = card();
    const heading: HTMLElement = within(band()).getByRole("heading", {
      level: 2,
    });

    expect(top.tagName).toBe("SECTION");
    expect(top).toHaveAttribute("aria-labelledby", heading.id);
    expect(heading).toHaveTextContent("All quiet");
    expect(
      Array.from(top.children).map((child: Element) => {
        return child.getAttribute("data-testid");
      }),
    ).toEqual([SECURITY_STATUS_HEADLINE_ID, SECURITY_PIPELINE_ID]);
    // One card, not four bordered tiles and a banner beside them.
    expect(top).toHaveClass("rounded-xl", "border", "overflow-hidden");
    for (const key of ["sources", "detections", "cases", "playbooks"]) {
      expect(stage(key).className).not.toMatch(/(^| )border( |$)|rounded/);
    }
  });

  test("a project nothing watches, with Get started put away: the band says so in grey, and Set up Security brings the card back for good", async () => {
    window.localStorage.setItem(DISMISS_KEY, "true");
    answerStatus(status({ enabledPlaybooks: 1 }));
    await renderPage();

    expect(screen.queryByTestId(SECURITY_GETTING_STARTED_ID)).toBeNull();

    const notWatching: HTMLElement = band();

    expect(notWatching).toHaveAttribute(
      "data-kind",
      SecurityHeadlineKind.NotSetUp,
    );
    expect(notWatching).toHaveClass("bg-gray-50");
    expect(
      within(notWatching).getByRole("heading", {
        name: "Nothing is being watched for threats yet",
      }),
    ).toBeInTheDocument();
    // Never "All quiet" over nothing looking, and no test attack to send.
    expect(notWatching).not.toHaveTextContent("All quiet");
    expect(
      within(notWatching).queryByTestId("security-run-setup-test"),
    ).toBeNull();
    expect(stage("sources")).toHaveTextContent("Connect a source");

    await act(async () => {
      fireEvent.click(
        within(notWatching).getByTestId("security-status-set-up"),
      );
    });

    expect(screen.getByTestId(SECURITY_GETTING_STARTED_ID)).toBeInTheDocument();
    expect(screen.queryByTestId(SECURITY_OVERVIEW_STATUS_ID)).toBeNull();
    // Remembered no more: the next visit opens on Get started too.
    expect(window.localStorage.getItem(DISMISS_KEY)).toBeNull();
  });

  test("a project whose connected product opens cases, with no rule of OneUptime's, is watched: All quiet, never Set up Security", async () => {
    /*
     * A connection's alerts open cases from High up by default, so a team
     * that brings CrowdStrike or Google SecOps alerts and turns on no rule
     * of OneUptime's is not told nothing is being watched, nor pushed back
     * to Get started.
     */
    window.localStorage.setItem(DISMISS_KEY, "true");
    answerStatus(
      status({
        connections: 1,
        eventsLast24Hours: 40,
        lastEventAt: new Date(),
      }),
    );
    await renderPage();

    expect(band()).toHaveAttribute("data-kind", SecurityHeadlineKind.Quiet);
    expect(band()).not.toHaveTextContent("Nothing is being watched");
    expect(within(band()).queryByTestId("security-status-set-up")).toBeNull();
    expect(
      within(band()).getByTestId("security-run-setup-test"),
    ).toBeInTheDocument();
    // OneUptime's own rules are still offered where they live.
    expect(stage("detections")).toHaveTextContent("Not set up");
    expect(stage("detections")).toHaveTextContent("Turn on rules");
  });

  test("a project with a source and a rule but no playbook is quiet, and promises no playbook", async () => {
    window.localStorage.setItem(DISMISS_KEY, "true");
    answerStatus(
      status({
        logsSourceEnabled: true,
        enabledRules: 3,
        recommendedRulesOn: 3,
      }),
    );
    await renderPage();

    expect(band()).toHaveAttribute("data-kind", SecurityHeadlineKind.Quiet);
    expect(
      within(band()).getByTestId("security-status-summary"),
    ).toHaveTextContent(
      "No open case and nothing waiting for an approval. When a rule finds a threat, its case opens here.",
    );
    expect(band()).not.toHaveTextContent("playbooks run");
    expect(stage("playbooks")).toHaveTextContent("Not set up");
    expect(stage("playbooks")).toHaveTextContent("Add a playbook");
  });

  test("sources gone quiet for days: All quiet says when the last security event came, and the Sources cell says it in amber", async () => {
    answerStatus(
      status({
        ...SET_UP,
        eventsLast24Hours: 0,
        lastEventAt: new Date(Date.now() - 3 * DAY_IN_MS),
      }),
    );
    await renderPage();

    expect(band()).toHaveAttribute("data-kind", SecurityHeadlineKind.Quiet);
    expect(
      within(band()).getByTestId("security-status-summary"),
    ).toHaveTextContent(
      "No open case and nothing waiting for an approval, but the last security event arrived 3 days ago.",
    );
    expect(stage("sources")).toHaveTextContent("Last event 3 days ago");
    expect(stage("sources")).toHaveAttribute("data-tone", "warning");
  });

  test("every open case someone else's: in hand, in indigo, with nothing to press and no number the pipeline already shows", async () => {
    answerStatus(status({ ...SET_UP, openCases: 3 }));
    answerOverview(
      overview(
        {
          openCases: 3,
          casesOpenedInWindow: 3,
          openByPriority: { [priorityId(SecurityCasePriorityLevel.Medium)]: 3 },
        },
        { myOpenCases: 0, runsWaitingForApproval: 0 },
      ),
    );
    await renderPage();

    const inHand: HTMLElement = band();

    expect(inHand).toHaveAttribute("data-kind", SecurityHeadlineKind.InHand);
    expect(inHand).toHaveClass("bg-indigo-50");
    expect(inHand).toHaveTextContent("Every open case is picked up");
    expect(inHand).toHaveTextContent(
      "Each one is assigned, and no playbook step is waiting for an approval.",
    );
    expect(within(inHand).queryAllByRole("link")).toHaveLength(0);
    expect(within(inHand).queryAllByRole("button")).toHaveLength(0);
    expect(stage("cases")).toHaveTextContent("3 open cases");
  });

  test("only what has a count is listed: a step waiting for an approval alone, in amber", async () => {
    answerStatus(status(SET_UP));
    answerOverview(overview({}, { runsWaitingForApproval: 1 }));
    await renderPage();

    expect(band()).toHaveAttribute(
      "data-kind",
      SecurityHeadlineKind.NeedsAttention,
    );
    expect(band()).toHaveAttribute("data-tone", "warning");
    expect(
      within(band())
        .getAllByRole("link")
        .map((link: HTMLElement): string => {
          return (link.textContent || "").trim();
        }),
    ).toEqual(["1 playbook step waiting for approval"]);
    expect(
      screen.getByTestId("security-attention-approvals"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("security-attention-mine")).toBeNull();
    expect(screen.queryByTestId("security-attention-unassigned")).toBeNull();
  });

  test("the test attack from the quiet band: its case turns the band to Needs attention, and the line linking to the case stays", async () => {
    const runTest: SpyInstance<typeof SecurityCaseApi.runSetupTest> = jest
      .spyOn(SecurityCaseApi, "runSetupTest")
      .mockResolvedValue({
        eventsSent: 12,
        caseId: CASE_ID,
        caseNumber: "#7",
        ruleAdded: false,
      } as SecuritySetupTestResult);
    answerStatus(status(SET_UP), status({ ...SET_UP, openCases: 1 }));
    answerOverview(
      overview(),
      overview({
        openCases: 1,
        unassignedOpenCases: 1,
        casesOpenedInWindow: 1,
        openByPriority: { [priorityId(SecurityCasePriorityLevel.Medium)]: 1 },
      }),
    );
    await renderPage();

    await act(async () => {
      fireEvent.click(within(band()).getByTestId("security-run-setup-test"));
    });

    expect(runTest).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(band()).toHaveAttribute(
        "data-kind",
        SecurityHeadlineKind.NeedsAttention,
      );
    });

    const result: HTMLElement = within(band()).getByTestId(
      "security-setup-test-result",
    );

    expect(result).toHaveTextContent("The test opened case #7");
    expect(
      within(result).getByRole("link", { name: /Open the case/ }),
    ).toHaveAttribute("href", routeFor(PageMap.SECURITY_CASE_VIEW, CASE_ID));
    expect(
      within(band()).getByRole("link", {
        name: "1 open case nobody has picked up",
      }),
    ).toBeInTheDocument();
    expect(stage("cases")).toHaveTextContent("1 open case");
  });

  test("a test attack that fails from the band says why in the amber box: a failure on OneUptime's side in the product's words, a role's sentence as the server words it", async () => {
    jest
      .spyOn(SecurityCaseApi, "runSetupTest")
      .mockRejectedValueOnce(new SecurityApiError("Server Error", 500))
      .mockRejectedValueOnce(
        new SecurityApiError(
          "Running a test takes a role that can read cases.",
          403,
        ),
      );
    answerStatus(status(SET_UP));
    await renderPage();

    await act(async () => {
      fireEvent.click(within(band()).getByTestId("security-run-setup-test"));
    });

    const box: HTMLElement = await within(band()).findByTestId(
      "security-setup-test-error",
    );

    expect(box).toHaveAttribute("role", "alert");
    expect(box).toHaveClass("bg-amber-50");
    expect(box).toHaveTextContent("The test attack could not be sent");
    expect(
      within(box).getByTestId("security-turn-on-problems-error"),
    ).toHaveTextContent("Something went wrong. Try again in a moment.");
    expect(box).not.toHaveTextContent("Server Error");

    await act(async () => {
      fireEvent.click(within(band()).getByTestId("security-run-setup-test"));
    });

    await waitFor(() => {
      expect(
        within(band()).getByTestId("security-setup-test-error"),
      ).toHaveTextContent("Running a test takes a role that can read cases.");
    });
    // Still quiet: nothing opened.
    expect(band()).toHaveAttribute("data-kind", SecurityHeadlineKind.Quiet);
  });

  test("the band's disc steps aside on a phone, so its words take the width", async () => {
    answerStatus(status(SET_UP));
    await renderPage();

    const disc: Element = band().querySelector('[aria-hidden="true"]')!;

    expect(disc).toHaveClass("max-sm:hidden", "rounded-full", "bg-emerald-500");
  });

  test("the band pads as the cells do, and keeps its button under its words until a wide screen", async () => {
    answerStatus(status(SET_UP));
    await renderPage();

    /*
     * The cells' own padding - 20px from sm up, 16px across on a phone -
     * so the disc lines up with their names. Side by side only from lg:
     * beside the side menu at md, the button squeezed the words into a
     * column five lines deep.
     */
    expect(band()).toHaveClass("px-4", "py-5", "sm:px-5");
    expect(band().className).not.toMatch(/(^| )md:px-6( |$)/);
    for (const key of ["sources", "detections", "cases", "playbooks"]) {
      const cell: HTMLElement = within(stage(key)).getByRole("link");

      expect(cell).toHaveClass("px-4", "py-4", "sm:px-5");
      /*
       * No letter-spacing on a phone, where two cells share the width: a
       * long name (SICHERHEITSFAELLE) fits whole instead of breaking.
       */
      expect(cell.firstElementChild).toHaveClass("sm:tracking-wide");
      expect(cell.firstElementChild).not.toHaveClass("tracking-wide");
    }

    const row: HTMLElement = band().firstElementChild as HTMLElement;

    expect(row).toHaveClass(
      "flex",
      "flex-col",
      "lg:flex-row",
      "lg:items-center",
      "lg:justify-between",
    );
    expect(row.className).not.toMatch(/(^| )md:flex-row( |$)/);

    const action: HTMLElement = within(band()).getByTestId(
      "security-run-setup-test",
    ).parentElement as HTMLElement;

    // At the right edge in both layouts, as a card keeps its actions.
    expect(action).toHaveClass("self-end", "lg:self-auto");
  });
});

describe("before the first reads land, and when they cannot", () => {
  function renderWithoutWaiting(): void {
    const project: Project = new Project();
    project.id = PROJECT_ID;

    render(
      <MemoryRouter>
        <SecurityOverviewPage
          pageRoute={new Route("/dashboard/security-events/overview")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  }

  test("while the reads are in flight, the card's shape stands in: a band and four cells, busy", async () => {
    jest
      .spyOn(SecurityCaseApi, "getOverview")
      .mockImplementation((): Promise<SecurityOverview> => {
        return new Promise<SecurityOverview>(() => {
          // Never answers: the page stays on its first frame.
        });
      });

    await act(async () => {
      renderWithoutWaiting();
    });

    const loading: HTMLElement = screen.getByTestId(
      "security-overview-loading",
    );

    expect(loading).toHaveAttribute("aria-busy", "true");
    // The band's disc and lines, then the four cells, as the card lays them out.
    const cells: Element | null = loading.querySelector(
      '[class~="lg:grid-cols-4"]',
    );

    expect(cells).not.toBeNull();
    expect(cells!.children).toHaveLength(4);
    expect(screen.queryByTestId(SECURITY_OVERVIEW_STATUS_ID)).toBeNull();
  });

  test("an overview that cannot be read says so in the card's place, in the product's words, and Try again reads it again", async () => {
    answerOverview(new SecurityApiError("Server Error", 500), overview());
    answerStatus(status(SET_UP));
    await renderPage();

    const failed: HTMLElement = screen.getByTestId("security-overview-error");

    expect(failed).toHaveAttribute("role", "alert");
    expect(failed).toHaveTextContent("We could not load the Security overview");
    expect(
      screen.getByTestId("security-overview-error-message"),
    ).toHaveTextContent("Something went wrong. Try again in a moment.");
    expect(failed).not.toHaveTextContent("Server Error");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-overview-try-again"));
    });

    await waitFor(() => {
      expect(card()).toBeInTheDocument();
    });
    expect(screen.queryByTestId("security-overview-error")).toBeNull();
    expect(SecurityCaseApi.getOverview).toHaveBeenCalledTimes(2);
    expect(band()).toHaveAttribute("data-kind", SecurityHeadlineKind.Quiet);
  });

  test("a role the server refuses reads as the server words it", async () => {
    answerOverview(
      new SecurityApiError(
        "Reading the security overview takes a Security role, or Project Owner or Project Admin.",
        403,
      ),
    );
    await renderPage();

    expect(
      screen.getByTestId("security-overview-error-message"),
    ).toHaveTextContent(
      "Reading the security overview takes a Security role, or Project Owner or Project Admin.",
    );
  });

  test("a project not set up whose first read failed still meets Get started once Try again reads it", async () => {
    answerOverview(new SecurityApiError("Bad Gateway", 502), overview());
    answerStatus(status());
    await renderPage();

    expect(screen.queryByTestId(SECURITY_GETTING_STARTED_ID)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-overview-try-again"));
    });

    expect(
      await screen.findByTestId(SECURITY_GETTING_STARTED_ID),
    ).toBeInTheDocument();
  });

  test("a read again that fails keeps what the page already shows", async () => {
    jest.spyOn(SecurityCaseApi, "runSetupTest").mockResolvedValue({
      eventsSent: 12,
      caseId: null,
      caseNumber: null,
      ruleAdded: false,
    } as SecuritySetupTestResult);
    answerStatus(status(SET_UP), new Error("Gateway Timeout"));
    answerOverview(overview(), new SecurityApiError("Gateway Timeout", 504));
    await renderPage();

    await act(async () => {
      fireEvent.click(within(band()).getByTestId("security-run-setup-test"));
    });

    await waitFor(() => {
      expect(SecurityCaseApi.getOverview).toHaveBeenCalledTimes(2);
    });
    // The quiet read before stays; no error replaces the page or the pipeline.
    expect(screen.queryByTestId("security-overview-error")).toBeNull();
    expect(screen.queryByTestId("security-pipeline-error")).toBeNull();
    expect(screen.getByTestId(SECURITY_PIPELINE_ID)).toBeInTheDocument();
    expect(band()).toHaveAttribute("data-kind", SecurityHeadlineKind.Quiet);
  });
});
