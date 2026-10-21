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
  SecurityOverview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import { SECURITY_ALL_QUIET_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityAllQuiet";
import { SECURITY_GETTING_STARTED_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityGettingStarted";
import SecurityPipeline, {
  SECURITY_PIPELINE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityPipeline";
import {
  SecuritySetupStatus,
  SecuritySetupTestResult,
  TurnOnRecommendedResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel";
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
import SecurityCasePriority from "../../../Types/SecurityCase/SecurityCasePriority";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import type { SpyInstance } from "jest-mock";

/*
 * The Security Overview as a new project meets it and as a working one
 * does: "Get started" alone until Security is set up (its one click, its
 * test attack, and the main button moving to whatever is next), the
 * pipeline across the top once it is, "All quiet" when nothing needs
 * anybody, the queue tiles when something does, and the charts only once
 * there is something to chart. SecurityCaseApi is the page's only door to
 * the server, so it is what is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: string = "44444444-4444-4444-8444-444444444444";

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
    ...top,
  };
}

let statusAnswers: Array<SecuritySetupStatus | Error> = [];
let overviewAnswers: Array<SecurityOverview> = [];
let allowed: (
  model: PermissionCheckableModel,
  action: ModelAction,
) => PermissionGateResult = (): PermissionGateResult => {
  return { isAllowed: true };
};

function answerStatus(...answers: Array<SecuritySetupStatus | Error>): void {
  statusAnswers = answers;
}

function answerOverview(...answers: Array<SecurityOverview>): void {
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
      return overviewAnswers.length > 1
        ? overviewAnswers.shift()!
        : overviewAnswers[0]!;
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
    expect(screen.queryByTestId(SECURITY_ALL_QUIET_ID)).toBeNull();
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
    // The case is open now: the queue shows it, nobody has picked it up.
    expect(
      screen.getByText("open case nobody has picked up"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-getting-started-done"));
    });

    expect(screen.queryByTestId(SECURITY_GETTING_STARTED_ID)).toBeNull();
    expect(stage("cases")).toHaveTextContent("1 open case");
    // Done is for this visit; a project that is set up never shows the card again anyway.
    expect(window.localStorage.getItem(DISMISS_KEY)).toBeNull();
  });

  test("a failed click says why, in the card", async () => {
    jest
      .spyOn(SecurityCaseApi, "turnOnRecommended")
      .mockRejectedValue(new Error("You may not add detection rules."));
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
});

describe("the pipeline", () => {
  function renderPipeline(
    value: SecuritySetupStatus,
    openCasesDetail?: string,
  ): void {
    render(
      <MemoryRouter>
        <SecurityPipeline status={value} openCasesDetail={openCasesDetail} />
      </MemoryRouter>,
    );
  }

  test("marks every stage not set up, the cases ready, each a link to its page", () => {
    renderPipeline(status());

    const pipeline: HTMLElement = screen.getByTestId(SECURITY_PIPELINE_ID);

    expect(pipeline).toHaveAttribute("aria-label", "How Security works here");
    expect(
      ["sources", "detections", "cases", "playbooks"].map((key: string) => {
        return [key, stage(key).getAttribute("data-ready")];
      }),
    ).toEqual([
      ["sources", "false"],
      ["detections", "false"],
      ["cases", "true"],
      ["playbooks", "false"],
    ]);
    expect(stage("sources")).toHaveTextContent("Not set up");
    expect(stage("sources")).toHaveTextContent("No events in 24 hours");
    expect(stage("detections")).toHaveTextContent("0 of 19 recommended");
    expect(stage("cases")).toHaveTextContent("None open");
    expect(stage("cases")).toHaveTextContent("Nothing waiting");
    expect(within(stage("sources")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_CONNECTIONS),
    );
    expect(within(stage("detections")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_DETECTION_RULES),
    );
    expect(within(stage("playbooks")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_PLAYBOOKS),
    );
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

  test("under the open cases: what the page says about them, or that they wait for a person", () => {
    renderPipeline(status({ ...SET_UP, openCases: 4 }), "2 critical · 1 high");

    expect(stage("cases")).toHaveTextContent("4 open cases");
    expect(stage("cases")).toHaveTextContent("2 critical · 1 high");
    expect(stage("cases")).not.toHaveTextContent("Waiting for a person");

    cleanup();
    renderPipeline(status({ ...SET_UP, openCases: 4 }));

    expect(stage("cases")).toHaveTextContent("Waiting for a person");
  });
});

describe("a project with Security set up", () => {
  test("nothing waiting: All quiet, with the test attack, and no Get started or charts", async () => {
    answerStatus(status(SET_UP));
    await renderPage();

    const quiet: HTMLElement = await screen.findByTestId(SECURITY_ALL_QUIET_ID);

    expect(
      within(quiet).getByRole("heading", { name: "All quiet" }),
    ).toBeInTheDocument();
    expect(
      within(quiet).getByTestId("security-run-setup-test"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(SECURITY_GETTING_STARTED_ID)).toBeNull();
    expect(screen.queryByText("open case nobody has picked up")).toBeNull();
    expect(stage("sources")).toHaveTextContent("1 source");
    expect(stage("sources")).toHaveTextContent("1,234 events in 24 hours");
    expect(stage("playbooks")).toHaveTextContent("1 playbook on");
  });

  test("something waiting: the queue tiles and the charts, and the cases stage asks for a person while none is urgent", async () => {
    answerStatus(status({ ...SET_UP, openCases: 3 }));
    answerOverview(
      overview(
        {
          openCases: 3,
          unassignedOpenCases: 2,
          casesOpenedInWindow: 5,
          detectionsInWindow: 9,
          openByPriority: { [SecurityCasePriority.Medium]: 3 },
        },
        { myOpenCases: 1, runsWaitingForApproval: 1 },
      ),
    );
    await renderPage();

    expect(
      await screen.findByText("open case assigned to you"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("open cases nobody has picked up"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("playbook step waiting for approval"),
    ).toBeInTheDocument();
    expect(figures()).toBeInTheDocument();
    expect(screen.getByText("Cases Opened")).toBeInTheDocument();
    expect(screen.queryByTestId(SECURITY_ALL_QUIET_ID)).toBeNull();
    expect(stage("cases")).toHaveTextContent("3 open cases");
    // "0 critical · 0 high" would say nothing.
    expect(stage("cases")).toHaveTextContent("Waiting for a person");
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
          openByPriority: { [SecurityCasePriority.Medium]: 3 },
        },
        { myOpenCases: 1, runsWaitingForApproval: 1 },
      ),
    );
    await renderPage();

    const tile: (words: string) => HTMLElement | null = (
      words: string,
    ): HTMLElement | null => {
      return screen.getByText(words).closest("a");
    };

    await screen.findByText("open case assigned to you");

    expect(tile("open case assigned to you")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_CASES_ASSIGNED_TO_ME),
    );
    expect(tile("open cases nobody has picked up")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_CASES_UNASSIGNED),
    );
    expect(tile("playbook step waiting for approval")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL),
    );
    // The cases stage still opens the queue itself, at its old address.
    expect(within(stage("cases")).getByRole("link")).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_CASES),
    );
  });

  test("urgent cases read on the pipeline, and the figures below keep to the timings instead of counting the open cases a third time", async () => {
    answerStatus(status({ ...SET_UP, openCases: 4 }));
    answerOverview(
      overview({
        openCases: 4,
        unassignedOpenCases: 1,
        casesOpenedInWindow: 4,
        openByPriority: {
          [SecurityCasePriority.Critical]: 2,
          [SecurityCasePriority.High]: 1,
          [SecurityCasePriority.Low]: 1,
        },
      }),
    );
    await renderPage();

    expect(stage("cases")).toHaveTextContent("4 open cases");
    expect(stage("cases")).toHaveTextContent("2 critical · 1 high");
    expect(within(figures()).queryByText("Open Cases")).toBeNull();
    expect(
      within(figures()).getByText("Mean Time to Acknowledge"),
    ).toBeVisible();
    expect(within(figures()).getByText("Mean Time to Contain")).toBeVisible();
    expect(within(figures()).getByText("Mean Time to Close")).toBeVisible();
  });

  test("a SIEM the events are sent to is named under the pipeline", async () => {
    answerStatus(status({ ...SET_UP, destinations: 1 }));
    await renderPage();

    expect(
      screen.getByTestId("security-pipeline-destinations"),
    ).toHaveTextContent("Security events are also sent to 1 SIEM.");
  });
});

describe("a server that cannot answer the set-up figures", () => {
  test("leaves the pipeline and Get started out, never the page", async () => {
    answerStatus(new Error("Not found"));
    await renderPage();

    expect(
      await screen.findByTestId(SECURITY_ALL_QUIET_ID),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(SECURITY_PIPELINE_ID)).toBeNull();
    expect(screen.queryByTestId(SECURITY_GETTING_STARTED_ID)).toBeNull();
  });

  test("still counts the open cases, in the figures, when there is no pipeline to count them", async () => {
    answerStatus(new Error("Not found"));
    answerOverview(
      overview({
        openCases: 2,
        unassignedOpenCases: 2,
        casesOpenedInWindow: 2,
        openByPriority: { [SecurityCasePriority.High]: 2 },
      }),
    );
    await renderPage();

    expect(screen.queryByTestId(SECURITY_PIPELINE_ID)).toBeNull();
    expect(within(figures()).getByText("Open Cases")).toBeVisible();
    expect(figures()).toHaveTextContent("0 critical · 2 high");
  });
});
