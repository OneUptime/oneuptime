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
import RunbookVariable from "../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import { APPROVAL_AFTER_LAST_STEP_TITLE } from "../../../Types/Runbook/RunbookStepApproval";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A STEP ASKS FOR APPROVAL BEFORE IT RUNS, AND EVERY STEP'S OPTIONS ARE
 * SIMPLER - on a runbook's real Steps page, only the model API stubbed.
 *
 * The maintainer: "Instead of saying 'require approval before running next
 * step,' you can actually say this in the next step, which would say
 * 'require approval before running this step.' Can we please make all the
 * runbook step options simpler, and use the 'More' thing we have on other
 * forms to hide advanced options."
 *
 *   - every automated step's More fields holds "Require approval before
 *     running this step" first, then "Continue on failure", then the rest;
 *   - the switch on draws "Needs approval" on the step's header, and Save
 *     sends requireApprovalBeforeRunning on that step - never the old flag;
 *   - the folded line names it: "Require approval: On";
 *   - a Manual step has its instructions and nothing to fold;
 *   - an HTTP request shows its body only for a method that sends one, and
 *     folds its headers;
 *   - a runbook a client saved with the old approval after a step shows it on
 *     the step it held back, and one after the last step as "Approve the
 *     result" - and Save writes it the new way.
 */

const RUNBOOK_ID: string = "77777777-0000-4000-8000-0000000000b2";
const BASTION_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";

const WAIT: { timeout: number } = { timeout: 20000 };

const SWITCH_TITLE: string = "Require approval before running this step";

function steps(): Array<RunbookStep> {
  return [
    {
      id: "manual",
      order: 0,
      type: RunbookStepType.Manual,
      title: "Check the dashboards",
      description: "Confirm the error rate is falling.",
      config: {},
    },
    {
      id: "javascript",
      order: 1,
      type: RunbookStepType.JavaScript,
      title: "Work out the new primary",
      config: { script: "return 1;", agentId: "" },
      continueOnFailure: false,
      requireApprovalBeforeRunning: false,
    },
    {
      id: "http-get",
      order: 2,
      type: RunbookStepType.HttpRequest,
      title: "Read the health endpoint",
      config: { method: "GET", url: "https://status.example.com/health" },
    },
    {
      id: "http-post",
      order: 3,
      type: RunbookStepType.HttpRequest,
      title: "Page the database team",
      config: {
        method: "POST",
        url: "https://events.pagerduty.com/v2/enqueue",
        headersJson: '{ "Content-Type": "application/json" }',
        body: '{ "event_action": "trigger" }',
      },
    },
    {
      id: "bash",
      order: 4,
      type: RunbookStepType.Bash,
      title: "Capture state",
      config: { script: "uptime", agentId: BASTION_ID },
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
        agentId: BASTION_ID,
      },
    },
    {
      id: "kubectl",
      order: 6,
      type: RunbookStepType.Kubernetes,
      title: "Promote the replica",
      config: {
        kubeconfig: "",
        script: "kubectl get pods",
        agentId: BASTION_ID,
      },
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

// The same runbook as a client still saves it: the old approval after a step.
function stepsSavedTheOldWay(): Array<RunbookStep> {
  return steps().map((step: RunbookStep): RunbookStep => {
    const copy: RunbookStep = { ...step };
    delete copy.requireApprovalBeforeRunning;

    if (step.id === "ssh" || step.id === "ai") {
      copy.requireApproval = true;
    }

    if (step.id === "javascript") {
      copy.requireApproval = false;
    }

    return copy;
  });
}

let stored: Array<RunbookStep> = steps();
let saved: Array<RunbookStep> | null = null;

function runner(id: string, name: string): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    description: "",
    canRunRunbooks: true,
    lastAlive: new Date(),
  });
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`);

  stored = steps();
  saved = null;

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

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: unknown;
    requestOptions?: { overrideRequestUrl?: unknown };
  }): Promise<ListResult<never>> => {
    let data: Array<unknown> = [];

    if (args.modelType === Runner) {
      data = String(args.requestOptions?.overrideRequestUrl || "").endsWith(
        GLOBAL_RUNNERS_ROUTE,
      )
        ? []
        : [runner(BASTION_ID, "prod-bastion")];
    } else if (args.modelType === RunbookVariable) {
      data = [];
    }

    return {
      data: data as Array<never>,
      count: data.length,
      skip: 0,
      limit: 10,
    };
  }) as never);

  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (args: {
    data: { steps: Array<RunbookStep> };
  }) => {
    saved = JSON.parse(JSON.stringify(args.data.steps)) as Array<RunbookStep>;
    return {} as never;
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

function headers(): Array<HTMLElement> {
  return screen.getAllByTestId("runbook-step-header");
}

function header(title: string): HTMLElement {
  const found: HTMLElement | undefined = headers().find(
    (element: HTMLElement): boolean => {
      return (element.textContent || "").includes(title);
    },
  );

  if (!found) {
    throw new Error(`No step titled "${title}".`);
  }

  return found;
}

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

// A step's More fields, opened.
function openMoreFields(index: number): HTMLElement {
  const fold: HTMLElement = screen.getByTestId(
    `runbook-step-${index}-more-fields`,
  );
  const button: HTMLElement = within(fold).getByRole("button", {
    name: "More fields",
  });

  if (button.getAttribute("aria-expanded") === "false") {
    fireEvent.click(button);
  }

  return fold;
}

async function save(): Promise<Array<RunbookStep>> {
  fireEvent.click(screen.getByRole("button", { name: "Save Steps" }));

  await waitFor(() => {
    expect(saved).not.toBeNull();
  }, WAIT);

  return saved!;
}

function savedStep(all: Array<RunbookStep>, id: string): RunbookStep {
  return all.find((step: RunbookStep): boolean => {
    return step.id === id;
  })!;
}

describe("the approval switch is on the step it holds back", () => {
  test("every automated step's More fields holds it first, then Continue on failure", async () => {
    await renderSteps();

    const automated: Array<[number, string]> = [
      [1, "Work out the new primary"],
      [2, "Read the health endpoint"],
      [3, "Page the database team"],
      [4, "Capture state"],
      [5, "Stop writes"],
      [6, "Promote the replica"],
      [7, "Summarize"],
    ];

    for (const [index, title] of automated) {
      open(title);
      const fold: HTMLElement = openMoreFields(index);
      const switches: Array<HTMLElement> = within(fold).getAllByRole("switch");
      const approval: HTMLElement = within(fold).getByRole("switch", {
        name: SWITCH_TITLE,
      });
      const continueOnFailure: HTMLElement = within(fold).getByRole("switch", {
        name: "Continue on failure",
      });

      // The approval first, then Continue on failure, then the rest.
      expect({ title, first: switches[0] === approval }).toEqual({
        title,
        first: true,
      });
      expect({ title, second: switches[1] === continueOnFailure }).toEqual({
        title,
        second: true,
      });
      expect(
        within(fold).getByText(
          "The run stops before this step until someone approves it.",
        ),
      ).toBeInTheDocument();
      expect(
        within(fold).getByText(
          "If this step fails, the run goes on instead of stopping.",
        ),
      ).toBeInTheDocument();
    }

    // The old words are gone.
    expect(
      screen.queryByText("Require approval before running the next step"),
    ).toBeNull();
  });

  test("a step that asks says so on its header, folded or open; the others do not", async () => {
    await renderSteps();

    expect(header("Promote the replica")).toHaveTextContent("Needs approval");
    expect(screen.getAllByText("Needs approval")).toHaveLength(1);
    expect(screen.getByTestId("runbook-step-6-needs-approval")).toBeVisible();

    open("Promote the replica");
    expect(header("Promote the replica")).toHaveTextContent("Needs approval");
  });

  test("the folded line names it, and that it is on", async () => {
    await renderSteps();
    open("Promote the replica");

    const fold: HTMLElement = screen.getByTestId("runbook-step-6-more-fields");

    expect(fold).toHaveTextContent("Require approval: On");
  });

  test("turned on, the step's header says so, and Save sends it on that step only - never the old flag", async () => {
    await renderSteps();
    open("Capture state");
    const fold: HTMLElement = openMoreFields(4);

    fireEvent.click(within(fold).getByRole("switch", { name: SWITCH_TITLE }));

    expect(header("Capture state")).toHaveTextContent("Needs approval");
    expect(
      within(fold).getByRole("switch", { name: SWITCH_TITLE }),
    ).toHaveAttribute("aria-checked", "true");

    const all: Array<RunbookStep> = await save();

    expect(savedStep(all, "bash").requireApprovalBeforeRunning).toBe(true);
    expect(savedStep(all, "kubectl").requireApprovalBeforeRunning).toBe(true);
    for (const id of ["javascript", "http-get", "http-post", "ssh", "ai"]) {
      expect({
        id,
        asks: savedStep(all, id).requireApprovalBeforeRunning === true,
      }).toEqual({ id, asks: false });
    }
    expect(JSON.stringify(all)).not.toContain('"requireApproval"');
  });

  test("turned off, the header drops it, and Save sends it off", async () => {
    await renderSteps();
    open("Promote the replica");
    const fold: HTMLElement = openMoreFields(6);

    fireEvent.click(within(fold).getByRole("switch", { name: SWITCH_TITLE }));

    expect(header("Promote the replica")).not.toHaveTextContent(
      "Needs approval",
    );

    const all: Array<RunbookStep> = await save();

    expect(savedStep(all, "kubectl").requireApprovalBeforeRunning).toBe(false);
  });

  test("a new step starts without an approval, and without the old flag", async () => {
    await renderSteps();

    fireEvent.click(
      within(
        screen.getByText("Add another step").parentElement as HTMLElement,
      ).getByText("Bash"),
    );

    const all: Array<RunbookStep> = await save();
    const added: RunbookStep = all[all.length - 1]!;

    expect(added.type).toBe(RunbookStepType.Bash);
    expect(added.requireApprovalBeforeRunning).toBe(false);
    expect(added.continueOnFailure).toBe(false);
    expect(Object.keys(added)).not.toContain("requireApproval");
  });
});

describe("a runbook a client saved with the old approval after a step", () => {
  test("shows it on the step it held back, and one after the last step as 'Approve the result'", async () => {
    stored = stepsSavedTheOldWay();
    await renderSteps();

    // After "Stop writes" -> before "Promote the replica".
    expect(header("Promote the replica")).toHaveTextContent("Needs approval");
    expect(header("Stop writes")).not.toHaveTextContent("Needs approval");

    // After the last step -> a Manual step at the end.
    expect(headers()).toHaveLength(9);
    expect(headers()[8]).toHaveTextContent(APPROVAL_AFTER_LAST_STEP_TITLE);
    expect(headers()[8]).toHaveTextContent("Manual");

    // Showing it the way it runs is not a change: nothing to save yet.
    expect(screen.getByRole("button", { name: "Save Steps" })).toBeDisabled();
  });

  test("saved, it is written the new way", async () => {
    stored = stepsSavedTheOldWay();
    await renderSteps();

    // Any edit lets Save through; the steps go out as the page shows them.
    open("Capture state");
    fireEvent.change(document.getElementById("runbook-step-4-title")!, {
      target: { value: "Capture the state" },
    });

    const all: Array<RunbookStep> = await save();

    expect(JSON.stringify(all)).not.toContain('"requireApproval"');
    expect(savedStep(all, "kubectl").requireApprovalBeforeRunning).toBe(true);
    expect(savedStep(all, "ssh").requireApprovalBeforeRunning).toBeUndefined();
    expect(savedStep(all, "ai-approval")).toMatchObject({
      type: RunbookStepType.Manual,
      title: APPROVAL_AFTER_LAST_STEP_TITLE,
      order: 8,
    });
  });
});

describe("every step's options are simpler", () => {
  test("a Manual step: its title and the instructions the responder reads, nothing folded, no approval", async () => {
    await renderSteps();
    open("Check the dashboards");

    const label: HTMLElement = document.querySelector(
      'label[for="runbook-step-0-description"]',
    ) as HTMLElement;

    expect(label).toHaveTextContent("Instructions");
    expect(
      document.getElementById("runbook-step-0-description"),
    ).toHaveAttribute(
      "placeholder",
      "What should the responder do or check? Markdown is supported.",
    );
    expect(screen.queryByTestId("runbook-step-0-more-fields")).toBeNull();
    expect(screen.queryByTestId("runbook-step-0-require-approval")).toBeNull();
  });

  test("an HTTP request: no Body for a GET; a POST's body on the card; headers folded under More fields", async () => {
    await renderSteps();
    open("Read the health endpoint");
    open("Page the database team");

    expect(document.getElementById("runbook-step-2-http-body")).toBeNull();
    expect(
      document.getElementById("runbook-step-3-http-body"),
    ).toBeInTheDocument();

    for (const index of [2, 3]) {
      const headersField: HTMLElement | null = document.getElementById(
        `runbook-step-${index}-http-headers`,
      );

      expect(headersField).toBeInTheDocument();
      expect(
        screen
          .getByTestId(`runbook-step-${index}-more-fields`)
          .contains(headersField),
      ).toBe(true);
    }

    // The folded line counts the headers; it never quotes them.
    const headersItem: Element | null = screen
      .getByTestId("runbook-step-3-more-fields")
      .querySelector(
        '[data-testid="folded-section-item"][data-item-key="headersJson"]',
      );

    expect(headersItem).toHaveTextContent("Headers (JSON): 1");
    expect(headersItem).not.toHaveTextContent("application/json");
    expect(headersItem).toHaveAttribute("data-item-set", "true");
  });

  test("an AI step: the prompt and a short line; its provider and context folded", async () => {
    await renderSteps();
    open("Summarize");

    expect(
      screen.getByText(
        "The AI's answer becomes this step's output. AI calls are metered like any other AI feature.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pair with/)).toBeNull();

    const fold: HTMLElement = openMoreFields(7);

    expect(
      within(fold).getByRole("switch", {
        name: "Include previous step context",
      }),
    ).toBeInTheDocument();
    expect(fold).toHaveTextContent(
      "Leave this on Project default unless this step needs a specific model.",
    );
  });

  test("a step on one of the project's Runners says, in one line, where it runs", async () => {
    await renderSteps();
    open("Capture state");

    expect(
      within(screen.getByTestId("runbook-step-4-runner")).getByText(
        "Runs on this Runner, in your own infrastructure.",
      ),
    ).toBeInTheDocument();
  });
});
