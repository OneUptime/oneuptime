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
import { GLOBAL_RUNNER_CHOICE_ID } from "../../../Types/Runner/RunnerChoice";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * WHERE EACH STEP RUNS, ON A RUNBOOK'S STEPS PAGE.
 *
 * Steps open folded, so the line under each title is how a person reads
 * where a runbook's steps run without opening one: "JavaScript on Global
 * Runner", "Bash script on prod-bastion", or that a step still needs a
 * Runner. Open, a step keeps its Runner under its More fields - the
 * maintainer: "have this runner drop down, hidden in More" - named on the
 * folded line ("Runner: Global Runner"), and the fold starts open on a step
 * that still needs one. In a project with a default Runner, a step that
 * picked none runs on it. A JavaScript step on Global Runner offers the
 * timeout range it really gets (5 minutes, not an hour). And a step with
 * nothing to pick links to Runbooks -> Runners in a new tab: when the
 * person comes back, the page reads the Runners again, so the one just
 * added can be picked without a reload that would drop unsaved steps.
 *
 * The real page and picker; only the model API is stubbed.
 */

const RUNBOOK_ID: string = "77777777-0000-4000-8000-0000000000a1";
const BASTION_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const DEFAULT_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
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

// A step's More fields fold.
function moreFields(stepIndex: number): HTMLElement {
  return screen.getByTestId(`runbook-step-${stepIndex}-more-fields`);
}

// What a fold's folded line says the step's Runner is ("Global Runner").
function foldedRunner(stepIndex: number): string {
  const item: HTMLElement | null = moreFields(stepIndex).querySelector(
    '[data-testid="folded-section-item"][data-item-key="runner"]',
  );

  return item?.textContent || "";
}

// Folds or opens a step's More fields, as its header's button does.
function toggleMoreFields(stepIndex: number): void {
  fireEvent.click(
    within(moreFields(stepIndex)).getByTestId("folded-section-header"),
  );
}

function openPicker(stepIndex: number): Array<HTMLElement> {
  fireEvent.keyDown(
    within(screen.getByTestId(`runbook-step-${stepIndex}-runner`)).getByRole(
      "combobox",
    ),
    { key: "ArrowDown", code: "ArrowDown" },
  );

  return screen.getAllByRole("option");
}

describe("each step's Runner sits under its More fields", () => {
  test("the picker is inside the fold - not above the script - for every step that runs on a Runner", async () => {
    await renderSteps();

    for (const index of [0, 1, 2, 3]) {
      const picker: HTMLElement = screen.getByTestId(
        `runbook-step-${index}-runner`,
      );

      expect({ index, inFold: moreFields(index).contains(picker) }).toEqual({
        index,
        inFold: true,
      });
    }
  });

  test("the folded line names the Runner first, whatever it is", async () => {
    await renderSteps();

    expect(foldedRunner(0)).toBe("Runner: Global Runner");
    expect(foldedRunner(2)).toBe("Runner: prod-bastion");
    expect(foldedRunner(3)).toBe("Runner: prod-bastion");

    const firstItem: Element | null = moreFields(0).querySelector(
      '[data-testid="folded-section-item"]',
    );

    expect(firstItem).toHaveAttribute("data-item-key", "runner");
  });

  test("a step that can run as it is starts folded; one that still needs a Runner starts open on it", async () => {
    await renderSteps();

    expect(moreFields(0)).toHaveAttribute("data-collapsed", "true");
    expect(moreFields(2)).toHaveAttribute("data-collapsed", "true");
    expect(moreFields(3)).toHaveAttribute("data-collapsed", "true");

    // The Bash step with no Runner: its Runner is the field to fill.
    expect(moreFields(1)).toHaveAttribute("data-collapsed", "false");
    expect(
      within(moreFields(1)).getByTestId("runbook-step-1-runner-help"),
    ).toHaveTextContent(
      "Bash steps run on a Runner of your own, inside your network: the Global Runner runs JavaScript steps only.",
    );
  });

  test("a step that cannot run as it is says so on its line too, once it is folded", async () => {
    await renderSteps();

    // Open, the fold shows its fields rather than the line.
    expect(foldedRunner(1)).toBe("");

    toggleMoreFields(1);

    expect(moreFields(1)).toHaveAttribute("data-collapsed", "true");
    expect(foldedRunner(1)).toBe("Runner: None");
  });

  test("a Runner that is not connected is said so on the folded line", async () => {
    projectRunners = [
      Object.assign(runner(BASTION_ID, "prod-bastion"), {
        lastAlive: undefined,
      }),
    ];

    await renderSteps();

    expect(foldedRunner(2)).toBe("Runner: prod-bastion · Never connected");
  });

  test("picking a Runner for a step that needed one keeps its fold open, the pick in view", async () => {
    await renderSteps();

    open("Restart the web service");
    fireEvent.click(
      openPicker(1).find((option: HTMLElement): boolean => {
        return (option.textContent || "").includes("prod-bastion");
      })!,
    );

    expect(moreFields(1)).toHaveAttribute("data-collapsed", "false");
    expect(
      within(moreFields(1)).getByTestId("runbook-step-1-runner-help"),
    ).toHaveTextContent("Runs on this Runner, in your own infrastructure.");

    toggleMoreFields(1);

    expect(foldedRunner(1)).toBe("Runner: prod-bastion");
  });
});

describe("a project with a default Runner", () => {
  beforeEach(() => {
    projectRunners = [
      runner(BASTION_ID, "prod-bastion"),
      Object.assign(runner(DEFAULT_ID, "prod-default"), {
        isProjectDefault: true,
      }),
    ];
  });

  test("a step that picked no Runner runs on the default - a Bash step too - and says so, folded", async () => {
    await renderSteps();

    expect(header("Look up the status page")).toHaveTextContent(
      "JavaScript on prod-default",
    );
    expect(header("Restart the web service")).toHaveTextContent(
      "Bash script on prod-default",
    );
    expect(foldedRunner(0)).toBe("Runner: prod-default");
    expect(foldedRunner(1)).toBe("Runner: prod-default");
    // The Bash step can run now: its fold starts folded like the rest.
    expect(moreFields(1)).toHaveAttribute("data-collapsed", "true");
  });

  test("a step that picked one of the project's Runners keeps it", async () => {
    await renderSteps();

    expect(header("Ask the internal API")).toHaveTextContent(
      "JavaScript on prod-bastion",
    );
    expect(header("Clear the cache")).toHaveTextContent(
      "Bash script on prod-bastion",
    );
  });

  test("on the project's own Runner, a JavaScript step may run for an hour, not the global five minutes", async () => {
    await renderSteps();

    open("Look up the status page");

    const step: HTMLElement = screen
      .getByTestId("runbook-step-0-runner")
      .closest("[data-rbd-draggable-id]") as HTMLElement;

    expect(step).toHaveTextContent("Allowed range: 1–3600 seconds.");
  });

  test("saving keeps a step that follows the default picking none, and one moved to the Global Runner picks it itself", async () => {
    const saves: Array<Record<string, unknown>> = [];
    jest.spyOn(ModelAPI, "updateById").mockImplementation((async (args: {
      data: Record<string, unknown>;
    }) => {
      saves.push(args.data);
      return {};
    }) as never);

    await renderSteps();

    open("Look up the status page");
    fireEvent.click(
      openPicker(0).find((option: HTMLElement): boolean => {
        return (option.textContent || "").startsWith("Global Runner");
      })!,
    );

    expect(foldedRunner(0)).toBe("Runner: Global Runner");

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save Steps" }));
    });

    await waitFor(() => {
      expect(saves).toHaveLength(1);
    }, WAIT);

    const saved: Array<RunbookStep> = saves[0]!["steps"] as Array<RunbookStep>;

    expect(
      saved.map((step: RunbookStep): string => {
        return (step.config as { agentId?: string }).agentId || "";
      }),
    ).toEqual([GLOBAL_RUNNER_CHOICE_ID, "", BASTION_ID, BASTION_ID]);
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
