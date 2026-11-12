import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * CARRYING THE NEXT STEP WITH THE PERSON (issue #6803): after a Welcome
 * checklist step's record is created on a plain page - a monitor, a status
 * page, an on-call policy - the page it lands on says, in one quiet line,
 * what was done, what is next, and the way back. Nowhere else: not on the
 * create form, not in another project, not after an hour, not once closed.
 */

let currentPath: string = "/";

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPath: () => {
        return {
          toString: () => {
            return currentPath;
          },
        };
      },
      isOnThisPage: () => {
        return false;
      },
      navigate: () => {},
    },
  };
});

const navigateCompleteMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to: { toString: () => string };
        children: React.ReactNode;
        onNavigateComplete?: () => void;
        className?: string;
      }) => {
        return (
          <a
            href={props.to.toString()}
            className={props.className}
            onClick={(event: React.MouseEvent) => {
              event.preventDefault();
              navigateCompleteMock();
              props.onNavigateComplete?.();
            }}
          >
            {props.children}
          </a>
        );
      },
    };
  },
);

/*
 * Since the guided setups (#6804, #6805, #6806) took the monitor, on-call,
 * telemetry and status page steps over, no step of the catalog lands on a
 * record's page of its own any more. The line is kept for the next step
 * that does, and is held here to what it did for the on-call step before
 * its guided setup: Create On-Call Policy, landing on the policy's
 * Escalation Rules.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistCatalog",
  () => {
    type Entry = {
      step: string;
      guidedSetupPage?: unknown;
      landing?: { pageMap: string; doneText: string } | undefined;
    };
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistCatalog",
    ) as Record<string, unknown>;
    const withLanding: (entry: Entry) => Entry = (entry: Entry): Entry => {
      return entry.step === "on_call"
        ? {
            ...entry,
            guidedSetupPage: undefined,
            landing: {
              pageMap: "ON_CALL_DUTY_POLICY_VIEW_ESCALATION",
              doneText:
                "On-call policy created. The step ticks off once an on-call rule runs it and it reaches someone.",
            },
          }
        : entry;
    };
    const steps: Array<Entry> = (actual["WELCOME_STEPS"] as Array<Entry>).map(
      withLanding,
    );

    return {
      __esModule: true,
      ...actual,
      WELCOME_STEPS: steps,
      getWelcomeStepEntry: (step: string): Entry => {
        return steps.find((entry: Entry): boolean => {
          return entry.step === step;
        })!;
      },
    };
  },
);

import WelcomeNextStep from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeNextStep";
import {
  STEP_IN_PROGRESS_KEY,
  STEP_IN_PROGRESS_TTL_MS,
  forgetWelcomeStepInProgress,
  getWelcomeNextStepLine,
  isPathOnRoute,
  readWelcomeStepInProgress,
  rememberWelcomeStepStarted,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeStepInProgress";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { WelcomeStep } from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "65f00000-0000-4000-8000-00000000abcd";
const OTHER_PROJECT_ID: string = "65f00000-0000-4000-8000-00000000ffff";
const MONITOR_ID: string = "11111111-2222-4333-8444-555555555555";

function pathOf(pageMap: PageMap, id?: string): string {
  return RouteMap[pageMap]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", id || MONITOR_ID);
}

beforeEach(() => {
  window.sessionStorage.clear();
  currentPath = "/";
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  navigateCompleteMock.mockReset();
});

describe("which page is a step's landing page", () => {
  const monitorView: Route = RouteMap[PageMap.MONITOR_VIEW] as Route;

  test("a monitor's page, in this project", () => {
    expect(
      isPathOnRoute({
        path: pathOf(PageMap.MONITOR_VIEW),
        route: monitorView,
        projectId: PROJECT_ID,
      }),
    ).toBe(true);
    expect(
      isPathOnRoute({
        path: `${pathOf(PageMap.MONITOR_VIEW)}/`,
        route: monitorView,
        projectId: PROJECT_ID,
      }),
    ).toBe(true);
    expect(
      isPathOnRoute({
        path: `${pathOf(PageMap.MONITOR_VIEW)}?tab=1`,
        route: monitorView,
        projectId: PROJECT_ID,
      }),
    ).toBe(true);
  });

  test("never the create form, whose address has a word where the id goes", () => {
    expect(
      isPathOnRoute({
        path: pathOf(PageMap.MONITOR_CREATE),
        route: monitorView,
        projectId: PROJECT_ID,
      }),
    ).toBe(false);
  });

  test("never a page under the record, or another project's", () => {
    expect(
      isPathOnRoute({
        path: `${pathOf(PageMap.MONITOR_VIEW)}/settings`,
        route: monitorView,
        projectId: PROJECT_ID,
      }),
    ).toBe(false);
    expect(
      isPathOnRoute({
        path: pathOf(PageMap.MONITOR_VIEW).replace(
          PROJECT_ID,
          OTHER_PROJECT_ID,
        ),
        route: monitorView,
        projectId: PROJECT_ID,
      }),
    ).toBe(false);
  });
});

describe("what is carried", () => {
  test("a started step, with the one after it, for an hour", () => {
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.OnCall,
      nextStep: WelcomeStep.StatusPage,
      now: 1_000,
    });

    expect(readWelcomeStepInProgress(1_000 + 60_000)).toEqual({
      projectId: PROJECT_ID,
      step: WelcomeStep.OnCall,
      nextStep: WelcomeStep.StatusPage,
      startedAt: 1_000,
    });
    expect(
      readWelcomeStepInProgress(1_000 + STEP_IN_PROGRESS_TTL_MS + 1),
    ).toBeNull();
  });

  test("only a step with a page to land on; any other forgets what was carried", () => {
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.OnCall,
      nextStep: null,
    });
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.Team,
      nextStep: null,
    });

    expect(readWelcomeStepInProgress()).toBeNull();
  });

  test("something that is not a step reads as nothing", () => {
    window.sessionStorage.setItem(
      STEP_IN_PROGRESS_KEY,
      JSON.stringify({
        projectId: PROJECT_ID,
        step: "teleport",
        startedAt: Date.now(),
      }),
    );
    expect(readWelcomeStepInProgress()).toBeNull();

    window.sessionStorage.setItem(STEP_IN_PROGRESS_KEY, "not json");
    expect(readWelcomeStepInProgress()).toBeNull();
  });

  test("forgetting clears it", () => {
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.StatusPage,
      nextStep: null,
    });
    forgetWelcomeStepInProgress();

    expect(readWelcomeStepInProgress()).toBeNull();
  });

  /*
   * Create your first monitor opens its guided setup (#6804), which says
   * what is next itself: nothing is carried, and the monitor's page shows
   * no line.
   */
  test("a step that opens a guided setup carries nothing", () => {
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.StatusPage,
      nextStep: null,
    });
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.Monitor,
      nextStep: WelcomeStep.OnCall,
    });

    expect(readWelcomeStepInProgress()).toBeNull();
    expect(
      getWelcomeNextStepLine({
        inProgress: {
          projectId: PROJECT_ID,
          step: WelcomeStep.Monitor,
          nextStep: WelcomeStep.OnCall,
          startedAt: Date.now(),
        },
        path: pathOf(PageMap.MONITOR_VIEW),
        projectId: PROJECT_ID,
      }),
    ).toBeNull();
  });

  /*
   * The status page step opens its guided setup (#6806), which says what
   * is next itself: a status page it lands on carries no line.
   */
  test("a status page started from the checklist carries no line: its guided setup says what is next", () => {
    expect(
      getWelcomeNextStepLine({
        inProgress: {
          projectId: PROJECT_ID,
          step: WelcomeStep.StatusPage,
          nextStep: WelcomeStep.Team,
          startedAt: Date.now(),
        },
        path: pathOf(PageMap.STATUS_PAGE_VIEW),
        projectId: PROJECT_ID,
      }),
    ).toBeNull();
  });

  test.each([
    [WelcomeStep.OnCall, PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION],
  ])("%s lands on %s", (step: WelcomeStep, pageMap: PageMap) => {
    expect(
      getWelcomeNextStepLine({
        inProgress: {
          projectId: PROJECT_ID,
          step: step,
          nextStep: WelcomeStep.Team,
          startedAt: Date.now(),
        },
        path: pathOf(pageMap),
        projectId: PROJECT_ID,
      })?.step.step,
    ).toBe(step);
  });

  test("the line belongs to the project the step was started in", () => {
    expect(
      getWelcomeNextStepLine({
        inProgress: {
          projectId: OTHER_PROJECT_ID,
          step: WelcomeStep.OnCall,
          nextStep: null,
          startedAt: Date.now(),
        },
        path: pathOf(PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION),
        projectId: PROJECT_ID,
      }),
    ).toBeNull();
  });
});

describe("the line", () => {
  test("on the policy's page: what was done, what is next, and the way back to Home", async () => {
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.OnCall,
      nextStep: WelcomeStep.StatusPage,
    });
    currentPath = pathOf(PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION);

    await act(async () => {
      render(<WelcomeNextStep />);
    });

    expect(screen.getByTestId("welcome-next-step-done")).toHaveTextContent(
      "On-call policy created. The step ticks off once an on-call rule runs it and it reaches someone.",
    );
    expect(screen.getByTestId("welcome-next-step-next")).toHaveTextContent(
      "Next: Publish a status page.",
    );
    expect(
      screen.getByTestId("welcome-next-step-back").closest("a"),
    ).toHaveAttribute(
      "href",
      RouteMap[PageMap.HOME]!.toString().replace(":projectId", PROJECT_ID),
    );
    expect(screen.getByTestId("welcome-next-step")).toHaveAttribute(
      "role",
      "status",
    );
  });

  test("says so when that was the last step", async () => {
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.OnCall,
      nextStep: null,
    });
    currentPath = pathOf(PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION);

    await act(async () => {
      render(<WelcomeNextStep />);
    });

    expect(screen.getByTestId("welcome-next-step-done")).toHaveTextContent(
      "On-call policy created.",
    );
    expect(screen.getByTestId("welcome-next-step-next")).toHaveTextContent(
      "That was the last step.",
    );
  });

  test("is nowhere else: not on the list, not with nothing started", async () => {
    currentPath = pathOf(PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION);

    await act(async () => {
      render(<WelcomeNextStep />);
    });
    expect(screen.queryByTestId("welcome-next-step")).toBeNull();

    cleanup();
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.OnCall,
      nextStep: null,
    });
    currentPath = pathOf(PageMap.ON_CALL_DUTY_POLICIES);

    await act(async () => {
      render(<WelcomeNextStep />);
    });
    expect(screen.queryByTestId("welcome-next-step")).toBeNull();
  });

  test("closing it forgets the step", async () => {
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.OnCall,
      nextStep: null,
    });
    currentPath = pathOf(PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION);

    await act(async () => {
      render(<WelcomeNextStep />);
    });

    fireEvent.click(screen.getByTestId("welcome-next-step-close"));

    expect(screen.queryByTestId("welcome-next-step")).toBeNull();
    expect(readWelcomeStepInProgress()).toBeNull();
  });

  test("Back to setup forgets it too", async () => {
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.OnCall,
      nextStep: WelcomeStep.StatusPage,
    });
    currentPath = pathOf(PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION);

    await act(async () => {
      render(<WelcomeNextStep />);
    });

    fireEvent.click(screen.getByTestId("welcome-next-step-back"));

    expect(navigateCompleteMock).toHaveBeenCalledTimes(1);
    expect(readWelcomeStepInProgress()).toBeNull();
  });

  test("a step started after one was closed gets its own line", async () => {
    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.OnCall,
      nextStep: null,
      now: Date.now() - 10_000,
    });
    currentPath = pathOf(PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION);

    let rerender: (ui: React.ReactElement) => void = () => {};

    await act(async () => {
      rerender = render(<WelcomeNextStep />).rerender;
    });

    fireEvent.click(screen.getByTestId("welcome-next-step-close"));

    rememberWelcomeStepStarted({
      projectId: PROJECT_ID,
      step: WelcomeStep.OnCall,
      nextStep: null,
    });
    currentPath = pathOf(PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION);

    await act(async () => {
      rerender(<WelcomeNextStep />);
    });

    expect(screen.getByTestId("welcome-next-step-done")).toHaveTextContent(
      "On-call policy created.",
    );
  });
});
