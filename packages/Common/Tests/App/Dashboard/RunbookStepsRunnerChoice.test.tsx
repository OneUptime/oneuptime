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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import Steps from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps";
import { GLOBAL_RUNNERS_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * WHERE EACH STEP RUNS, ON A RUNBOOK'S STEPS PAGE.
 *
 * Steps open folded, so the line under each title is how a person reads
 * where a runbook's steps run without opening one: "JavaScript on Global
 * Runner", "Bash script on prod-bastion", or that a step still needs a
 * Runner. A JavaScript step on Global Runner offers the timeout range it
 * really gets (5 minutes, not an hour). And a step with nothing to pick
 * links to Runbooks -> Runners in a new tab: when the person comes back,
 * the page reads the Runners again, so the one just added can be picked
 * without a reload that would drop unsaved steps.
 *
 * The real page and picker; only the model API is stubbed.
 */

const RUNBOOK_ID: string = "77777777-0000-4000-8000-0000000000a1";
const BASTION_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const GLOBAL_EU_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";

const WAIT: { timeout: number } = { timeout: 20000 };

// The Execution timeout field, by its label ("Execution timeout seconds").
const EXECUTION_TIMEOUT_LABEL: RegExp = /^Execution timeout/;

const STEPS: Array<RunbookStep> = [
  {
    id: "step-js-global",
    order: 0,
    type: RunbookStepType.JavaScript,
    title: "Look up the status page",
    config: { script: "return 1;", agentId: "" },
  },
  {
    id: "step-bash-none",
    order: 1,
    type: RunbookStepType.Bash,
    title: "Restart the web service",
    config: { script: "systemctl restart web", agentId: "" },
  },
  {
    id: "step-js-own",
    order: 2,
    type: RunbookStepType.JavaScript,
    title: "Ask the internal API",
    config: { script: "return 2;", agentId: BASTION_ID },
  },
  {
    id: "step-bash-own",
    order: 3,
    type: RunbookStepType.Bash,
    title: "Clear the cache",
    config: { script: "rm -rf /tmp/cache", agentId: BASTION_ID },
  },
];

let projectRunners: Array<Runner> = [];
let globalRunners: Array<Runner> = [];
let usesGlobalRunners: boolean = true;
let projectRunnerReads: number = 0;

function runner(id: string, name: string): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    description: "",
    canRunRunbooks: true,
    lastAlive: new Date(),
  });
}

function readsGlobalRunners(args: unknown): boolean {
  const options: { requestOptions?: { overrideRequestUrl?: unknown } } =
    args as { requestOptions?: { overrideRequestUrl?: unknown } };

  return String(options.requestOptions?.overrideRequestUrl || "").endsWith(
    GLOBAL_RUNNERS_ROUTE,
  );
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`);

  projectRunners = [runner(BASTION_ID, "prod-bastion")];
  globalRunners = [runner(GLOBAL_EU_ID, "Global Runner")];
  usesGlobalRunners = true;
  projectRunnerReads = 0;

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (args: {
    modelType: unknown;
  }) => {
    if (args.modelType === Project) {
      return Object.assign(new Project(), {
        _id: PROJECT_ID,
        useGlobalRunners: usesGlobalRunners,
      });
    }

    const runbook: Runbook = new Runbook();
    runbook._id = RUNBOOK_ID;
    runbook.steps = JSON.parse(JSON.stringify(STEPS)) as never;
    return runbook;
  }) as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: unknown;
  }): Promise<ListResult<never>> => {
    let data: Array<Runner> = [];

    if (args.modelType === Runner) {
      if (readsGlobalRunners(args)) {
        data = globalRunners;
      } else {
        projectRunnerReads++;
        data = projectRunners;
      }
    }

    return {
      data: data as Array<never>,
      count: data.length,
      skip: 0,
      limit: 10,
    };
  }) as never);

  // No AI providers: the page carries on without them.
  jest.spyOn(API, "post").mockImplementation((async () => {
    throw new Error("No AI providers here.");
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderSteps(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <Steps
          pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  await screen.findAllByTestId("runbook-step-header", {}, WAIT);
}

function header(title: string): HTMLElement {
  const found: HTMLElement | undefined = screen
    .getAllByTestId("runbook-step-header")
    .find((element: HTMLElement): boolean => {
      return (element.textContent || "").includes(title);
    });

  if (!found) {
    throw new Error(`No step titled "${title}".`);
  }

  return found;
}

// The open/close button: the header's button that says aria-expanded.
function open(title: string): void {
  const toggle: HTMLElement | undefined = within(header(title))
    .getAllByRole("button")
    .find((button: HTMLElement): boolean => {
      return button.getAttribute("aria-expanded") === "false";
    });

  if (toggle) {
    fireEvent.click(toggle);
  }
}

describe("the line under a folded step's title says where it runs", () => {
  test("a JavaScript step that picked no Runner runs on Global Runner, and one that picked yours on it", async () => {
    await renderSteps();

    expect(header("Look up the status page")).toHaveTextContent(
      "JavaScript on Global Runner",
    );
    expect(header("Ask the internal API")).toHaveTextContent(
      "JavaScript on prod-bastion",
    );
  });

  test("a Bash step names its Runner, or says it still needs one", async () => {
    await renderSteps();

    expect(header("Clear the cache")).toHaveTextContent(
      "Bash script on prod-bastion",
    );
    expect(header("Restart the web service")).toHaveTextContent(
      "Bash script, needs a Runner",
    );
  });

  test("in a project that turned global Runners off, a JavaScript step with no pick needs a Runner too", async () => {
    usesGlobalRunners = false;

    await renderSteps();

    expect(header("Look up the status page")).toHaveTextContent(
      "JavaScript, needs a Runner",
    );
    expect(header("Ask the internal API")).toHaveTextContent(
      "JavaScript on prod-bastion",
    );
  });

  test("on a server with no global Runner, the same", async () => {
    globalRunners = [];

    await renderSteps();

    expect(header("Look up the status page")).toHaveTextContent(
      "JavaScript, needs a Runner",
    );
  });

  test("negative control: never the old line that named no Runner", async () => {
    await renderSteps();

    for (const element of screen.getAllByTestId("runbook-step-header")) {
      expect(element).not.toHaveTextContent("on a Runner");
    }
  });
});

describe("a JavaScript step's Execution timeout offers the range it really gets", () => {
  test("on Global Runner: up to 300 seconds, and longer is said to be cut short", async () => {
    await renderSteps();

    open("Look up the status page");

    const step: HTMLElement = (
      await screen.findByTestId("runbook-step-0-runner", {}, WAIT)
    ).closest("[data-rbd-draggable-id]") as HTMLElement;

    expect(step).toHaveTextContent("Allowed range: 1–300 seconds.");

    const timeout: HTMLElement = within(step).getByLabelText(
      EXECUTION_TIMEOUT_LABEL,
    );

    fireEvent.change(timeout, { target: { value: "600" } });

    expect(step).toHaveTextContent("Maximum is 300 seconds (5 minutes).");
    expect(step).toHaveTextContent(
      "Values outside the range are clamped when the step runs.",
    );
  });

  test("on one of your Runners: up to an hour, as before", async () => {
    await renderSteps();

    open("Ask the internal API");

    const step: HTMLElement = (
      await screen.findByTestId("runbook-step-2-runner", {}, WAIT)
    ).closest("[data-rbd-draggable-id]") as HTMLElement;

    expect(step).toHaveTextContent("Allowed range: 1–3600 seconds.");
    expect(step).not.toHaveTextContent("Allowed range: 1–300 seconds.");
  });
});

describe("a Runner added in another tab can be picked on coming back", () => {
  test("the page reads the Runners again when the window gets focus, and the Bash step offers the new one", async () => {
    projectRunners = [];

    await renderSteps();

    open("Restart the web service");

    const box: HTMLElement = await screen.findByTestId(
      "runbook-step-1-runner-nothing-to-pick",
      {},
      WAIT,
    );
    const link: HTMLElement = within(box).getByRole("link", {
      name: "Runbooks › Runners",
    });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/runbooks/runners`,
    );
    expect(link).toHaveAttribute("target", "_blank");

    // The person adds a Runner in the other tab, then comes back.
    projectRunners = [runner(BASTION_ID, "prod-bastion")];
    const readsBefore: number = projectRunnerReads;

    await act(async (): Promise<void> => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(projectRunnerReads).toBeGreaterThan(readsBefore);
    }, WAIT);
    await waitFor(() => {
      expect(
        screen.queryByTestId("runbook-step-1-runner-nothing-to-pick"),
      ).toBeNull();
    }, WAIT);
    expect(
      within(screen.getByTestId("runbook-step-1-runner")).getByRole("combobox"),
    ).toBeInTheDocument();
  });

  test("a read that fails on coming back keeps what the page had", async () => {
    await renderSteps();

    expect(header("Ask the internal API")).toHaveTextContent(
      "JavaScript on prod-bastion",
    );

    jest
      .spyOn(ModelAPI, "getList")
      .mockRejectedValue(new Error("The network is down.") as never);

    await act(async (): Promise<void> => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(header("Ask the internal API")).toHaveTextContent(
      "JavaScript on prod-bastion",
    );
  });

  test("leaving the page stops listening", async () => {
    await renderSteps();

    cleanup();

    const readsBefore: number = projectRunnerReads;

    await act(async (): Promise<void> => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(projectRunnerReads).toBe(readsBefore);
  });
});
