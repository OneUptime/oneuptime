import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act, FunctionComponent, ReactElement } from "react";
import {
  BrowserRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Steps from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import API from "../../../UI/Utils/API/API";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import UnsavedChanges from "../../../UI/Utils/NewVersion/UnsavedChanges";
import { afterHistorySteps } from "../../Helpers/HistorySteps";

/*
 * Leaving a runbook's Steps page with unsaved steps (issue #7401). Steps
 * are a draft until Save Steps, and a click in the side menu, a crumb or
 * the browser's Back button dropped every unsaved step without a word -
 * only a new version of OneUptime was held back. Now, while the steps
 * differ from the ones last loaded or saved:
 *
 *   - the side menu (any link into the app) and Back ask first, in the
 *     dashboard's words: "Leave without saving?", Keep Editing stays,
 *     Discard Changes leaves;
 *   - closing or reloading the tab asks through the browser (beforeunload);
 *   - a new version of OneUptime does not reload the page under them.
 *
 * Unsaved is a comparison now, not a flag set by the first change: a
 * change undone - a switch flipped twice, a step moved down and back up,
 * a title typed back - leaves nothing unsaved, so nothing asks. And a
 * runbook whose last step was removed still shows Save Steps, so the
 * removal can be saved rather than asked about for ever.
 *
 * The real Steps page and a side menu entry run inside a real
 * BrowserRouter on jsdom's history; only the model API is stubbed.
 */

jest.setTimeout(120000);

const PROJECT_ID: string = "55555555-5555-4555-8555-555555555551";
const RUNBOOK_ID: string = "55555555-5555-4555-8555-555555555552";
const RUNBOOKS_PATH: string = `/dashboard/${PROJECT_ID}/runbooks`;
const STEPS_PATH: string = `${RUNBOOKS_PATH}/${RUNBOOK_ID}/steps`;
const MONITORS_PATH: string = `/dashboard/${PROJECT_ID}/monitors`;

const WAIT: { timeout: number } = { timeout: 20000 };

const LEAVE_TITLE: string = "Leave without saving?";
const LEAVE_DESCRIPTION: string =
  "You have unsaved changes to this runbook's steps. If you leave now, they will be lost.";
// The dashboard's question, which the runbook's must not borrow.
const DASHBOARD_LEAVE_DESCRIPTION: string =
  "You have unsaved changes to this dashboard. If you leave now, they will be lost.";

const SPACE: { keyCode: number; key: string } = { keyCode: 32, key: " " };
const ARROW_DOWN: { keyCode: number; key: string } = {
  keyCode: 40,
  key: "ArrowDown",
};
const ARROW_UP: { keyCode: number; key: string } = {
  keyCode: 38,
  key: "ArrowUp",
};

function threeSteps(): Array<RunbookStep> {
  return [
    {
      id: "check",
      order: 0,
      type: RunbookStepType.Manual,
      title: "Check the dashboards",
      description: "Confirm the error rate is falling.",
      config: {},
    },
    {
      id: "primary",
      order: 1,
      type: RunbookStepType.JavaScript,
      title: "Work out the new primary",
      config: { script: "return 1;", agentId: "" },
      continueOnFailure: false,
    },
    {
      id: "page",
      order: 2,
      type: RunbookStepType.HttpRequest,
      title: "Page the database team",
      config: {
        method: "POST",
        url: "https://events.example.com/v2/enqueue",
        body: '{ "event_action": "trigger" }',
      },
    },
  ];
}

// One step of every kind, as the approval editor's suite stores them.
function everyKindOfStep(): Array<RunbookStep> {
  return [
    ...threeSteps(),
    {
      id: "http-get",
      order: 3,
      type: RunbookStepType.HttpRequest,
      title: "Read the health endpoint",
      config: { method: "GET", url: "https://status.example.com/health" },
    },
    {
      id: "bash",
      order: 4,
      type: RunbookStepType.Bash,
      title: "Capture state",
      config: { script: "uptime", agentId: "" },
    },
    {
      id: "ssh",
      order: 5,
      type: RunbookStepType.SSH,
      title: "Stop writes",
      config: {
        host: "10.0.4.21",
        username: "deploy",
        signIn: "",
        script: "sudo systemctl stop pgbouncer",
        agentId: "",
      },
      // Saved the old way: an approval after the step before.
      requireApproval: true,
    },
    {
      id: "kubectl",
      order: 6,
      type: RunbookStepType.Kubernetes,
      title: "Promote the replica",
      config: { kubeconfig: "", script: "kubectl get pods", agentId: "" },
      requireApprovalBeforeRunning: true,
    },
    {
      id: "ai",
      order: 7,
      type: RunbookStepType.AI,
      title: "Summarize",
      config: {
        prompt: "Summarize the failover.",
        includePreviousStepContext: true,
        includeTriggerContext: true,
      },
    },
  ];
}

let stored: Array<RunbookStep> = threeSteps();
let saves: Array<Array<RunbookStep>> = [];
let refuseSaves: boolean = false;

/*
 * The app around the page, as the Dashboard app draws it: the router's
 * navigate handed to Navigation (App.tsx), a side menu entry for another
 * page, and the pages themselves.
 */
const AppShell: FunctionComponent = (): ReactElement => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());

  return (
    <div>
      <nav aria-label="Side menu">
        <SideMenuItem
          link={{ title: "Monitors", to: new Route(MONITORS_PATH) }}
        />
      </nav>
      <Routes>
        <RouterRoute
          path="/dashboard/:projectId/runbooks"
          element={<p>All runbooks</p>}
        />
        <RouterRoute
          path="/dashboard/:projectId/runbooks/:id/steps"
          element={
            <Steps
              pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
        <RouterRoute
          path="/dashboard/:projectId/monitors"
          element={<p>All monitors</p>}
        />
      </Routes>
    </div>
  );
};

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 8; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, ms);
    });
  });
}

/*
 * The runbooks list, then the runbook's steps opened from it: Back from
 * the steps has a page of the app to go to.
 */
async function openStepsFromList(): Promise<void> {
  render(
    <BrowserRouter useTransitions={false}>
      <AppShell />
    </BrowserRouter>,
  );

  expect(screen.getByText("All runbooks")).toBeInTheDocument();

  await act(async () => {
    Navigation.navigate(new Route(STEPS_PATH));
  });
  await screen.findByText("Runbook Steps", {}, WAIT);
  await settle();
}

function stepTitles(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[id$="-title"]'),
  )
    .filter((input: HTMLInputElement): boolean => {
      const stepTitleId: RegExp = /^runbook-step-\d+-title$/;
      return stepTitleId.test(input.id);
    })
    .map((input: HTMLInputElement): string => {
      return input.value;
    });
}

function queryLeaveDialog(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: LEAVE_TITLE });
}

function browserAsksBeforeUnload(): boolean {
  const event: Event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

// What the page says while its steps differ from the saved ones.
function showsUnsaved(): boolean {
  return screen.queryByText("Unsaved changes") !== null;
}

function saveStepsButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Save Steps" });
}

async function editTitle(index: number, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(document.getElementById(`runbook-step-${index}-title`)!, {
      target: { value },
    });
  });
}

async function flipContinueOnFailure(index: number): Promise<void> {
  await act(async () => {
    fireEvent.click(
      screen.getByTestId(`runbook-step-${index}-continue-on-failure`),
    );
  });
}

async function press(
  element: HTMLElement,
  key: { keyCode: number; key: string },
): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(element, key);
  });
  await wait(30);
}

// Drags the step at `index` one place down or up from the keyboard.
async function moveStep(index: number, way: "down" | "up"): Promise<void> {
  const grip: HTMLElement = document.querySelectorAll<HTMLElement>(
    "[data-rbd-drag-handle-draggable-id]",
  )[index]!;

  grip.focus();
  await press(grip, SPACE);
  await press(grip, way === "down" ? ARROW_DOWN : ARROW_UP);
  await press(grip, SPACE);
  await wait(400);
  await settle();
}

async function removeStep(title: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: `Delete ${title}` }));
  });
}

async function saveSteps(): Promise<void> {
  await act(async () => {
    fireEvent.click(saveStepsButton()!);
  });
  await settle();
}

async function clickSideMenuMonitors(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByText("Monitors"));
  });
  await settle();
}

async function pressBrowserBack(): Promise<void> {
  await act(async () => {
    window.history.back();
  });
  // The step, the guard's step back in the next frame, and what followed.
  await act(async () => {
    await afterHistorySteps();
  });
  await settle();
}

async function answer(
  button: "Keep Editing" | "Discard Changes",
): Promise<void> {
  await act(async () => {
    fireEvent.click(within(queryLeaveDialog()!).getByText(button));
  });
  await settle();
}

beforeEach(() => {
  LeaveGuard.reset();
  UnsavedChanges.reset();
  window.history.replaceState(null, "", RUNBOOKS_PATH);

  stored = threeSteps();
  saves = [];
  refuseSaves = false;

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (args: {
    modelType: unknown;
  }) => {
    if (args.modelType === Project) {
      return Object.assign(new Project(), {
        _id: PROJECT_ID,
        useGlobalRunners: true,
      });
    }

    const runbook: Runbook = new Runbook();
    runbook._id = RUNBOOK_ID;
    runbook.steps = JSON.parse(JSON.stringify(stored)) as never;
    return runbook;
  }) as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (): Promise<
    ListResult<never>
  > => {
    return { data: [], count: 0, skip: 0, limit: 10 };
  }) as never);

  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (args: {
    data: { steps: Array<RunbookStep> };
  }) => {
    if (refuseSaves) {
      throw new Error("You no longer have permission.");
    }

    saves.push(JSON.parse(JSON.stringify(args.data.steps)));
    return {} as never;
  }) as never);

  // No AI providers: the page carries on without them.
  jest.spyOn(API, "post").mockImplementation((async () => {
    throw new Error("No AI providers here.");
  }) as never);
});

afterEach(async () => {
  cleanup();
  LeaveGuard.reset();
  UnsavedChanges.reset();
  jest.restoreAllMocks();
  // A history step still in flight lands before the next test.
  await settle();
});

describe("a runbook's steps left as they were", () => {
  test("the side menu leaves at once, and nothing asks", async () => {
    await openStepsFromList();

    expect(stepTitles()).toEqual([
      "Check the dashboards",
      "Work out the new primary",
      "Page the database team",
    ]);
    expect(showsUnsaved()).toBe(false);
    expect(saveStepsButton()).toBeDisabled();
    expect(browserAsksBeforeUnload()).toBe(false);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
    expect(window.location.pathname).toBe(MONITORS_PATH);
  });

  test("Back leaves at once, and nothing asks", async () => {
    await openStepsFromList();

    await pressBrowserBack();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All runbooks")).toBeInTheDocument();
    expect(window.location.pathname).toBe(RUNBOOKS_PATH);
  });

  test("a runbook with a step of every kind - one saved the old way among them - opens with nothing unsaved", async () => {
    stored = everyKindOfStep();

    await openStepsFromList();

    expect(stepTitles()).toHaveLength(8);
    expect(showsUnsaved()).toBe(false);
    expect(saveStepsButton()).toBeDisabled();
    expect(browserAsksBeforeUnload()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
  });

  test("a switch flipped and flipped back leaves nothing unsaved: the side menu leaves at once", async () => {
    await openStepsFromList();

    await flipContinueOnFailure(1);
    expect(showsUnsaved()).toBe(true);
    expect(browserAsksBeforeUnload()).toBe(true);

    await flipContinueOnFailure(1);
    expect(showsUnsaved()).toBe(false);
    expect(saveStepsButton()).toBeDisabled();
    expect(browserAsksBeforeUnload()).toBe(false);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
  });

  test("a title typed and typed back leaves nothing unsaved", async () => {
    await openStepsFromList();

    await editTitle(0, "Check the graphs");
    expect(showsUnsaved()).toBe(true);

    await editTitle(0, "Check the dashboards");
    expect(showsUnsaved()).toBe(false);

    await pressBrowserBack();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All runbooks")).toBeInTheDocument();
  });

  test("a step moved down and back up leaves nothing unsaved", async () => {
    await openStepsFromList();

    await moveStep(0, "down");
    expect(stepTitles()).toEqual([
      "Work out the new primary",
      "Check the dashboards",
      "Page the database team",
    ]);
    expect(showsUnsaved()).toBe(true);

    await moveStep(1, "up");
    expect(stepTitles()).toEqual([
      "Check the dashboards",
      "Work out the new primary",
      "Page the database team",
    ]);
    expect(showsUnsaved()).toBe(false);
    expect(browserAsksBeforeUnload()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
  });
});

describe("a runbook with an unsaved change", () => {
  test("the side menu asks first, in its own words, and the page stays", async () => {
    await openStepsFromList();
    await editTitle(0, "Check the graphs");

    await clickSideMenuMonitors();

    const dialog: HTMLElement | null = queryLeaveDialog();
    expect(dialog).not.toBeNull();
    expect(within(dialog!).getByText(LEAVE_DESCRIPTION)).toBeInTheDocument();
    expect(within(dialog!).queryByText(DASHBOARD_LEAVE_DESCRIPTION)).toBeNull();
    expect(within(dialog!).getByText("Keep Editing")).toBeInTheDocument();
    expect(within(dialog!).getByText("Discard Changes")).toBeInTheDocument();

    // Nothing has moved yet.
    expect(screen.queryByText("All monitors")).toBeNull();
    expect(window.location.pathname).toBe(STEPS_PATH);
    expect(stepTitles()[0]).toBe("Check the graphs");
  });

  test("Keep Editing stays with the change; the next try asks again", async () => {
    await openStepsFromList();
    await editTitle(0, "Check the graphs");
    await clickSideMenuMonitors();

    await answer("Keep Editing");

    expect(queryLeaveDialog()).toBeNull();
    expect(window.location.pathname).toBe(STEPS_PATH);
    expect(stepTitles()[0]).toBe("Check the graphs");
    expect(showsUnsaved()).toBe(true);

    await clickSideMenuMonitors();
    expect(queryLeaveDialog()).not.toBeNull();
  });

  test("Discard Changes goes where the side menu was going, and saves nothing", async () => {
    await openStepsFromList();
    await editTitle(0, "Check the graphs");
    await clickSideMenuMonitors();

    await answer("Discard Changes");

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
    expect(window.location.pathname).toBe(MONITORS_PATH);
    expect(ModelAPI.updateById).not.toHaveBeenCalled();
    expect(browserAsksBeforeUnload()).toBe(false);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test("Back asks first, and the steps and their address stay", async () => {
    await openStepsFromList();
    await flipContinueOnFailure(1);

    await pressBrowserBack();

    expect(queryLeaveDialog()).not.toBeNull();
    expect(window.location.pathname).toBe(STEPS_PATH);
    expect(screen.queryByText("All runbooks")).toBeNull();
    expect(showsUnsaved()).toBe(true);
  });

  test("Keep Editing after Back stays; Back again asks again", async () => {
    await openStepsFromList();
    await flipContinueOnFailure(1);
    await pressBrowserBack();

    await answer("Keep Editing");

    expect(window.location.pathname).toBe(STEPS_PATH);
    expect(showsUnsaved()).toBe(true);

    await pressBrowserBack();

    expect(queryLeaveDialog()).not.toBeNull();
    expect(window.location.pathname).toBe(STEPS_PATH);
  });

  test("Discard Changes after Back goes back", async () => {
    await openStepsFromList();
    await flipContinueOnFailure(1);
    await pressBrowserBack();

    await answer("Discard Changes");

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All runbooks")).toBeInTheDocument();
    expect(window.location.pathname).toBe(RUNBOOKS_PATH);
  });

  test("closing or reloading the tab asks through the browser, and a new version waits", async () => {
    await openStepsFromList();

    expect(browserAsksBeforeUnload()).toBe(false);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

    await editTitle(2, "Page the on-call database engineer");

    expect(browserAsksBeforeUnload()).toBe(true);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });

  test("a step moved asks", async () => {
    await openStepsFromList();

    await moveStep(0, "down");

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).not.toBeNull();
    expect(window.location.pathname).toBe(STEPS_PATH);
  });

  test("a step added asks", async () => {
    await openStepsFromList();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Step" }));
    });
    expect(stepTitles()).toHaveLength(4);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).not.toBeNull();
  });

  test("the last step removed asks, and still shows Save Steps, which saves the empty runbook", async () => {
    stored = [threeSteps()[0]!];

    await openStepsFromList();
    await removeStep("Check the dashboards");

    expect(stepTitles()).toEqual([]);
    expect(screen.getByText("Start your runbook")).toBeInTheDocument();
    expect(saveStepsButton()).toBeEnabled();
    expect(browserAsksBeforeUnload()).toBe(true);

    await clickSideMenuMonitors();
    expect(queryLeaveDialog()).not.toBeNull();
    await answer("Keep Editing");

    await saveSteps();

    expect(saves).toEqual([[]]);
    expect(browserAsksBeforeUnload()).toBe(false);
    // Saved and empty: nothing left to save, so no Save Steps either.
    expect(saveStepsButton()).toBeNull();

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
  });

  test("an empty runbook opened as it was shows no Save Steps, and asks nothing", async () => {
    stored = [];

    await openStepsFromList();

    expect(screen.getByText("Start your runbook")).toBeInTheDocument();
    expect(saveStepsButton()).toBeNull();
    expect(browserAsksBeforeUnload()).toBe(false);
  });
});

describe("after Save Steps", () => {
  test("saved steps leave at once: the side menu asks nothing", async () => {
    await openStepsFromList();
    await editTitle(0, "Check the graphs");

    await saveSteps();

    expect(saves).toHaveLength(1);
    expect(saves[0]![0]!.title).toBe("Check the graphs");
    expect(screen.getByRole("dialog", { name: "Saved" })).toBeInTheDocument();
    expect(showsUnsaved()).toBe(false);
    expect(saveStepsButton()).toBeDisabled();
    expect(browserAsksBeforeUnload()).toBe(false);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
  });

  test("saved steps: Back asks nothing", async () => {
    await openStepsFromList();
    await moveStep(0, "down");

    await saveSteps();

    expect(
      saves[0]!.map((step: RunbookStep): string => {
        return `${step.order} ${step.id}`;
      }),
    ).toEqual(["0 primary", "1 check", "2 page"]);

    await pressBrowserBack();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All runbooks")).toBeInTheDocument();
  });

  test("a change after the save is unsaved again, and undoing it is not", async () => {
    await openStepsFromList();
    await editTitle(0, "Check the graphs");
    await saveSteps();

    await editTitle(0, "Check the dashboards");
    expect(showsUnsaved()).toBe(true);
    expect(browserAsksBeforeUnload()).toBe(true);

    await editTitle(0, "Check the graphs");
    expect(showsUnsaved()).toBe(false);
    expect(browserAsksBeforeUnload()).toBe(false);
  });

  test("a save that is refused keeps asking: the steps are still unsaved", async () => {
    refuseSaves = true;

    await openStepsFromList();
    await editTitle(0, "Check the graphs");

    await saveSteps();

    const refusal: HTMLElement = screen.getByRole("dialog", {
      name: "Could not save",
    });
    expect(
      within(refusal).getByText("You no longer have permission."),
    ).toBeInTheDocument();
    expect(showsUnsaved()).toBe(true);
    expect(browserAsksBeforeUnload()).toBe(true);

    await act(async () => {
      fireEvent.click(within(refusal).getByText("Close"));
    });
    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).not.toBeNull();
    expect(window.location.pathname).toBe(STEPS_PATH);
  });

  test("the question opens over the refusal, drawn after it", async () => {
    refuseSaves = true;

    await openStepsFromList();
    await editTitle(0, "Check the graphs");
    await saveSteps();

    await clickSideMenuMonitors();

    const dialogs: Array<HTMLElement> = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    expect(
      within(dialogs[0]!).getByText("You no longer have permission."),
    ).toBeInTheDocument();
    expect(dialogs[1]).toBe(queryLeaveDialog());
  });
});
