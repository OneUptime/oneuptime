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
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import {
  KubernetesAction,
  KubernetesWorkloadKind,
  RunbookStep,
} from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * SSH AND KUBECTL STEPS TAKE A SCRIPT, ON A RUNBOOK'S STEPS PAGE.
 *
 * The maintainer: "kubectl and ssh steps have too many options. Kubectl
 * steps should take in a script like kubectl commands and not have
 * dropdown options ... Please do the same for SSH as well, it should take a
 * bash script (after ssh into a machine) ... hide advanced options."
 *
 * So, with the real page and pickers (only the model API stubbed):
 *
 *   - a folded step's line says what it does: SSH to deploy@host from a
 *     Runner, a kubectl script's first command on a Runner;
 *   - an SSH step asks for the Runner, the machine as user@host, the secret
 *     it signs in with and the bash script - its port and key passphrase
 *     folded under More fields;
 *   - a kubectl step asks for the Runner, the kubeconfig (or the Runner's
 *     own access) and the script;
 *   - the sign-in and kubeconfig pickers offer secret variables only, and
 *     say when the step's Runner may not use the one picked, and where to
 *     fix it;
 *   - a script that names a variable that is not there says so;
 *   - a step written with a runbook credential still runs, and one button
 *     turns it into a script step;
 *   - Save stores references, never values.
 */

const RUNBOOK_ID: string = "77777777-0000-4000-8000-0000000000a1";
const BASTION_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";

const WAIT: { timeout: number } = { timeout: 20000 };

const STEPS: Array<RunbookStep> = [
  {
    id: "step-ssh",
    order: 0,
    type: RunbookStepType.SSH,
    title: "Restart nginx",
    config: {
      host: "10.0.4.21",
      username: "deploy",
      signIn: "{{global.variables.PROD_DB_SSH_KEY}}",
      script: "sudo systemctl restart nginx",
      agentId: BASTION_ID,
    },
  },
  {
    id: "step-ssh-no-runner",
    order: 1,
    type: RunbookStepType.SSH,
    title: "Check the replica",
    config: {
      host: "db-2",
      username: "root",
      signIn: "",
      script: "uptime",
      agentId: "",
    },
  },
  {
    id: "step-kubectl",
    order: 2,
    type: RunbookStepType.Kubernetes,
    title: "List the pods",
    config: {
      kubeconfig: "",
      script: "# every namespace\nkubectl get pods --all-namespaces",
      agentId: BASTION_ID,
    },
  },
  {
    id: "step-kubectl-no-runner",
    order: 3,
    type: RunbookStepType.Kubernetes,
    title: "Scale the API",
    config: {
      kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
      script: "kubectl scale deployment/api --replicas=3",
      agentId: "",
    },
  },
  {
    id: "step-legacy-ssh",
    order: 4,
    type: RunbookStepType.SSH,
    title: "Old SSH step",
    config: {
      credentialId: "cccccccc-0000-4000-8000-000000000001",
      command: "systemctl restart nginx",
      agentId: BASTION_ID,
    },
  },
  {
    id: "step-legacy-k8s",
    order: 5,
    type: RunbookStepType.Kubernetes,
    title: "Old Kubernetes step",
    config: {
      credentialId: "cccccccc-0000-4000-8000-000000000002",
      action: KubernetesAction.RestartWorkload,
      workloadKind: KubernetesWorkloadKind.Deployment,
      namespace: "web",
      workloadName: "api",
      agentId: BASTION_ID,
    },
  },
];

let saved: Array<RunbookStep> | null = null;
let variablesReadable: boolean = true;
// Whether the project has its variables; off, it has none yet.
let hasVariables: boolean = true;

function runner(id: string, name: string): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    description: "",
    canRunRunbooks: true,
    lastAlive: new Date(),
  });
}

function variable(fields: Record<string, unknown>): RunbookVariable {
  return Object.assign(new RunbookVariable(), {
    isAvailableToGlobalRunners: false,
    runners: [],
    ...fields,
  });
}

const GLOBAL_VARIABLES: Array<RunbookVariable> = [
  variable({ _id: "v1", name: "DB_HOST", isSecret: false }),
  variable({
    _id: "v2",
    name: "PROD_DB_SSH_KEY",
    isSecret: true,
    runners: [runner(BASTION_ID, "prod-bastion")],
  }),
  // A secret no Runner of this page may use.
  variable({ _id: "v3", name: "PROD_KUBECONFIG", isSecret: true }),
];

const LOCAL_VARIABLES: Array<RunbookVariable> = [
  variable({ _id: "v4", name: "NAMESPACE", isSecret: false }),
  variable({ _id: "v5", name: "STAGING_KEY", isSecret: true }),
];

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`);

  saved = null;
  variablesReadable = true;
  hasVariables = true;

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
    runbook.steps = JSON.parse(JSON.stringify(STEPS)) as never;
    return runbook;
  }) as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: unknown;
    query?: Record<string, unknown>;
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
      if (!variablesReadable) {
        throw new Error("Permission denied.");
      }

      data = !hasVariables
        ? []
        : args.query?.["runbookId"] instanceof IsNull
          ? GLOBAL_VARIABLES
          : LOCAL_VARIABLES;
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

function openMenu(testId: string): Array<HTMLElement> {
  fireEvent.keyDown(within(screen.getByTestId(testId)).getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });

  return screen.getAllByRole("option");
}

/*
 * A step's script field: its code editor, and the field around it (label,
 * help, examples, variables). Folded steps keep their fields on the page, so
 * fields are found by the step's own id.
 */
function scriptEditor(id: string): HTMLTextAreaElement {
  const editor: HTMLElement | null = document.getElementById(id);

  if (!editor) {
    throw new Error(`No script field ${id}.`);
  }

  return editor as HTMLTextAreaElement;
}

function scriptField(id: string): HTMLElement {
  const label: Element | null = document.querySelector(`label[for="${id}"]`);

  if (!label || !label.parentElement) {
    throw new Error(`No label for ${id}.`);
  }

  return label.parentElement;
}

async function save(): Promise<Array<RunbookStep>> {
  fireEvent.click(screen.getByRole("button", { name: "Save Steps" }));

  await waitFor(() => {
    expect(saved).not.toBeNull();
  }, WAIT);

  return saved!;
}

// The variables are read after the page draws: wait until a picker has them.
async function waitForVariables(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.getAllByText("Variables — click to copy").length,
    ).toBeGreaterThan(0);
  }, WAIT);
}

describe("a folded step's line says what it does", () => {
  test("an SSH step: the machine, and the Runner it signs in from", async () => {
    await renderSteps();

    expect(header("Restart nginx")).toHaveTextContent(
      "SSH to deploy@10.0.4.21 from prod-bastion",
    );
    expect(header("Check the replica")).toHaveTextContent(
      "SSH to root@db-2, needs a Runner",
    );
  });

  test("a kubectl step: its first command, past comments, and its Runner", async () => {
    await renderSteps();

    expect(header("List the pods")).toHaveTextContent(
      "kubectl get pods --all-namespaces · on prod-bastion",
    );
    expect(header("Scale the API")).toHaveTextContent(
      "kubectl script, needs a Runner",
    );
  });

  test("a step written with a runbook credential says so", async () => {
    await renderSteps();

    expect(header("Old SSH step")).toHaveTextContent(
      "SSH with a runbook credential",
    );
    expect(header("Old Kubernetes step")).toHaveTextContent(
      "Kubernetes action with a runbook credential",
    );
  });
});

describe("an SSH step", () => {
  test("asks for the machine, the secret it signs in with and the script; the rest is folded", async () => {
    await renderSteps();
    open("Restart nginx");
    await waitForVariables();

    expect(screen.getByTestId("runbook-step-0-ssh-target-input")).toHaveValue(
      "deploy@10.0.4.21",
    );
    expect(
      within(screen.getByTestId("runbook-step-0-ssh-sign-in")).getByText(
        "PROD_DB_SSH_KEY",
      ),
    ).toBeInTheDocument();
    expect(scriptEditor("runbook-step-0-ssh-script")).toHaveValue(
      "sudo systemctl restart nginx",
    );
    expect(scriptField("runbook-step-0-ssh-script")).toHaveTextContent(
      "Bash script",
    );
    for (const example of [
      "Check the machine",
      "Restart a service",
      "Check disk space",
      "Tail a log",
    ]) {
      expect(
        within(scriptField("runbook-step-0-ssh-script")).getByRole("button", {
          name: new RegExp(example),
        }),
      ).toBeInTheDocument();
    }

    // Port and key passphrase are under More fields, folded.
    const moreFields: HTMLElement = screen.getByTestId(
      "runbook-step-0-more-fields",
    );
    expect(moreFields).toHaveTextContent("More fields");

    const toggle: HTMLElement = within(moreFields)
      .getAllByRole("button")
      .find((button: HTMLElement): boolean => {
        return button.hasAttribute("aria-expanded");
      })!;
    const body: HTMLElement = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    )!;
    const port: HTMLElement = document.getElementById(
      "runbook-step-0-ssh-port",
    )!;

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(body).toHaveClass("invisible");
    expect(body).toContainElement(port);
    expect(body).toContainElement(
      screen.getByTestId("runbook-step-0-ssh-passphrase"),
    );

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(body).not.toHaveClass("invisible");
    expect(port).toHaveValue("");
    expect(
      document.querySelector('label[for="runbook-step-0-ssh-port"]'),
    ).toHaveTextContent("Port");
    expect(
      screen.getByTestId("runbook-step-0-ssh-passphrase"),
    ).toHaveTextContent("Key passphrase");
  });

  test("the machine is written as after ssh: user@host; a host alone asks for the user", async () => {
    await renderSteps();
    open("Restart nginx");

    const input: HTMLElement = screen.getByTestId(
      "runbook-step-0-ssh-target-input",
    );

    fireEvent.change(input, { target: { value: "10.0.4.99" } });

    expect(
      screen.getByTestId("runbook-step-0-ssh-target-help"),
    ).toHaveTextContent(
      "Add the user to sign in as, before an @: deploy@10.0.4.21.",
    );

    fireEvent.change(input, { target: { value: "admin@10.0.4.99" } });

    expect(
      screen.getByTestId("runbook-step-0-ssh-target-help"),
    ).toHaveTextContent(
      "The user and the machine to sign in to, as you would write them after ssh.",
    );

    const steps: Array<RunbookStep> = await save();

    expect(steps[0]!.config).toMatchObject({
      host: "10.0.4.99",
      username: "admin",
      signIn: "{{global.variables.PROD_DB_SSH_KEY}}",
      script: "sudo systemctl restart nginx",
    });
  });

  test("signs in with secret variables only - the project's and this runbook's own", async () => {
    await renderSteps();
    open("Restart nginx");
    await waitForVariables();

    const options: Array<string> = openMenu("runbook-step-0-ssh-sign-in").map(
      (option: HTMLElement): string => {
        return option.textContent || "";
      },
    );

    expect(options).toEqual([
      "PROD_DB_SSH_KEY",
      "PROD_KUBECONFIG",
      "STAGING_KEY · this runbook",
    ]);
  });

  test("a secret the step's Runner may not use says so, and where to add the Runner", async () => {
    await renderSteps();
    open("Restart nginx");
    await waitForVariables();

    const picked: HTMLElement | undefined = openMenu(
      "runbook-step-0-ssh-sign-in",
    ).find((option: HTMLElement): boolean => {
      return option.textContent === "PROD_KUBECONFIG";
    });
    fireEvent.click(picked!);

    const picker: HTMLElement = screen.getByTestId(
      "runbook-step-0-ssh-sign-in",
    );

    await waitFor(() => {
      expect(picker).toHaveTextContent(
        "The Runner picked above may not use PROD_KUBECONFIG, so the step will fail when it runs. Add the Runner to the variable's Runners under Runbooks › Settings › Global Variables.",
      );
    }, WAIT);
    expect(
      within(picker).getByRole("link", {
        name: "Runbooks › Settings › Global Variables",
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/runbooks/settings/variables`,
    );

    // One of the runbook's own: fixed on the runbook's own Variables page.
    const local: HTMLElement | undefined = openMenu(
      "runbook-step-0-ssh-sign-in",
    ).find((option: HTMLElement): boolean => {
      return option.textContent === "STAGING_KEY · this runbook";
    });
    fireEvent.click(local!);

    await waitFor(() => {
      expect(
        within(picker).getByRole("link", { name: "this runbook's Variables" }),
      ).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/variables`,
      );
    }, WAIT);

    const steps: Array<RunbookStep> = await save();

    // The reference, never a value.
    expect(steps[0]!.config).toMatchObject({
      signIn: "{{local.variables.STAGING_KEY}}",
    });
  });

  test("a script naming a variable that is not there says so before it runs", async () => {
    await renderSteps();
    open("Restart nginx");
    await waitForVariables();

    fireEvent.change(scriptEditor("runbook-step-0-ssh-script"), {
      target: {
        value:
          "psql -h {{global.variables.DB_HOST}} -c 'select 1'\necho {{global.variables.NOT_THERE}}",
      },
    });

    expect(
      await screen.findByTestId(
        "runbook-step-0-ssh-script-unknown-variables",
        {},
        WAIT,
      ),
    ).toHaveTextContent(
      "No variable is named {{global.variables.NOT_THERE}}, so the step will fail when it runs.",
    );
  });

  test("its examples and the variables it can use are one panel under the script", async () => {
    await renderSteps();
    open("Restart nginx");
    await waitForVariables();

    const variables: HTMLElement = screen.getByTestId(
      "runbook-step-0-ssh-script-variables",
    );
    const panel: HTMLElement = variables.parentElement!;

    // One panel: the examples' row, then the variables' row, in one box.
    expect(panel).toHaveClass("rounded-md", "border", "bg-gray-50");
    expect(
      within(panel).getByText("Examples — click to insert"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Variables — click to copy")).toBe(
      within(variables).getByText("Variables — click to copy"),
    );
    expect(
      within(panel).getByRole("button", { name: /Check the machine/ }),
    ).toBeInTheDocument();
    // Each variable is a chip that copies its reference.
    expect(
      within(variables).getByTitle("{{global.variables.PROD_DB_SSH_KEY}}"),
    ).toHaveTextContent("PROD_DB_SSH_KEY");
    expect(
      within(variables).getByTitle("{{local.variables.NAMESPACE}}"),
    ).toHaveTextContent("local.NAMESPACE");
    // Nothing of the panel is a box of its own inside it.
    expect(
      Array.from(panel.querySelectorAll(".rounded-md.border.bg-gray-50")),
    ).toEqual([]);
  });

  test("with no variables yet, the panel says how a script names one", async () => {
    hasVariables = false;

    await renderSteps();
    open("Restart nginx");

    const none: HTMLElement = await screen.findByTestId(
      "runbook-step-0-ssh-script-variables-none",
      {},
      WAIT,
    );

    expect(none).toHaveTextContent(
      "Use a variable in the script as {{global.variables.NAME}}.",
    );
    expect(none.parentElement).toHaveClass("rounded-md", "bg-gray-50");
    expect(
      within(none.parentElement!).getByText("Examples — click to insert"),
    ).toBeInTheDocument();
  });

  test("with no variables it may read, the picker says what reading them takes", async () => {
    variablesReadable = false;

    await renderSteps();
    open("Check the replica");

    expect(
      await screen.findByTestId(
        "runbook-step-1-ssh-sign-in-nothing-to-pick",
        {},
        WAIT,
      ),
    ).toHaveTextContent(
      "The project's variables could not be read: reading them takes Project Admin, Runbook Admin or Read Runbook Variable.",
    );
  });
});

describe("a kubectl step", () => {
  test("asks for the kubeconfig - or the Runner's own access - and the script", async () => {
    await renderSteps();
    open("List the pods");
    await waitForVariables();

    const kubeconfig: HTMLElement = screen.getByTestId(
      "runbook-step-2-kubeconfig",
    );
    expect(kubeconfig).toHaveTextContent("The Runner's own access");
    expect(kubeconfig).toHaveTextContent(
      "kubectl uses the Runner's own kubeconfig, or its service account when the Runner runs in the cluster.",
    );
    expect(scriptEditor("runbook-step-2-kubectl-script")).toHaveValue(
      "# every namespace\nkubectl get pods --all-namespaces",
    );
    expect(scriptField("runbook-step-2-kubectl-script")).toHaveTextContent(
      "kubectl commands, run with bash on the Runner with KUBECONFIG pointing at the cluster.",
    );
    for (const example of [
      "List pods",
      "Restart a deployment",
      "Scale a deployment",
      "Pods that are not running",
      "Roll back",
    ]) {
      expect(
        within(scriptField("runbook-step-2-kubectl-script")).getByRole(
          "button",
          { name: new RegExp(example) },
        ),
      ).toBeInTheDocument();
    }

    // No action, workload kind or replica dropdowns any more.
    expect(screen.queryByText("Workload kind")).toBeNull();
    expect(screen.queryByText("Workload name")).toBeNull();
    expect(screen.queryByText("Replicas")).toBeNull();
  });

  test("with no secret variable yet, the kubeconfig picker says where one is added", async () => {
    hasVariables = false;

    await renderSteps();
    open("List the pods");

    const kubeconfig: HTMLElement = screen.getByTestId(
      "runbook-step-2-kubeconfig",
    );

    // The Runner's own access still works: a hint, not a warning.
    const hint: HTMLElement = await within(kubeconfig).findByTestId(
      "runbook-step-2-kubeconfig-add-variable",
      {},
      WAIT,
    );
    expect(hint).toHaveTextContent(
      "No secret variables yet. Add one under Runbooks › Settings › Global Variables, then pick it here.",
    );
    expect(hint.closest("p")).toHaveClass("text-gray-500");
    expect(
      within(hint).getByRole("link", {
        name: "Runbooks › Settings › Global Variables",
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/runbooks/settings/variables`,
    );
    expect(kubeconfig).toHaveTextContent("The Runner's own access");
    expect(
      within(kubeconfig).queryByTestId(
        "runbook-step-2-kubeconfig-nothing-to-pick",
      ),
    ).toBeNull();
  });

  test("with secret variables to pick, the kubeconfig picker adds no hint", async () => {
    await renderSteps();
    open("List the pods");
    await waitForVariables();

    expect(
      screen.queryByTestId("runbook-step-2-kubeconfig-add-variable"),
    ).toBeNull();
  });

  test("an example is inserted into the script", async () => {
    await renderSteps();
    open("List the pods");

    fireEvent.click(
      within(scriptField("runbook-step-2-kubectl-script")).getByRole("button", {
        name: /Roll back/,
      }),
    );

    expect(scriptEditor("runbook-step-2-kubectl-script")).toHaveValue(
      "kubectl rollout undo deployment/checkout-api --namespace checkout",
    );
  });

  test("picking a kubeconfig stores its reference", async () => {
    await renderSteps();
    open("List the pods");
    await waitForVariables();

    const options: Array<HTMLElement> = openMenu("runbook-step-2-kubeconfig");

    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual([
      "The Runner's own access",
      "PROD_DB_SSH_KEY",
      "PROD_KUBECONFIG",
      "STAGING_KEY · this runbook",
    ]);

    fireEvent.click(options[2]!);

    const steps: Array<RunbookStep> = await save();
    expect(steps[2]!.config).toMatchObject({
      kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
      script: "# every namespace\nkubectl get pods --all-namespaces",
    });
  });
});

describe("a step written with a runbook credential", () => {
  test("an SSH step still shows as it is, and turns into a script step that runs its command", async () => {
    await renderSteps();
    open("Old SSH step");

    expect(screen.getByTestId("runbook-step-4-legacy")).toHaveTextContent(
      "This step signs in with a runbook credential and runs one command. It still runs as it is. Turn it into a script step to sign in with a variable instead.",
    );

    fireEvent.click(screen.getByTestId("runbook-step-4-legacy-convert"));

    expect(
      await screen.findByTestId("runbook-step-4-ssh-target-input", {}, WAIT),
    ).toHaveValue("");
    expect(screen.queryByTestId("runbook-step-4-legacy")).toBeNull();

    const steps: Array<RunbookStep> = await save();
    const config: Record<string, unknown> = steps[4]!.config as Record<
      string,
      unknown
    >;

    expect(config["script"]).toBe("systemctl restart nginx");
    expect(config["agentId"]).toBe(BASTION_ID);
    expect(config).not.toHaveProperty("credentialId");
    expect(config).not.toHaveProperty("command");
  });

  test("its More fields line names only what it folds: no port and no passphrase", async () => {
    await renderSteps();
    open("Old SSH step");

    const moreFields: HTMLElement = screen.getByTestId(
      "runbook-step-4-more-fields",
    );

    // Its credential holds the port and the passphrase; the fold does not.
    expect(moreFields).toHaveTextContent("Description");
    expect(moreFields).toHaveTextContent("Timeouts");
    expect(moreFields).not.toHaveTextContent("Port");
    expect(moreFields).not.toHaveTextContent("Key passphrase");
    expect(document.getElementById("runbook-step-4-ssh-port")).toBeNull();

    // Turned into a script step, it has both again.
    fireEvent.click(screen.getByTestId("runbook-step-4-legacy-convert"));

    await waitFor(() => {
      expect(
        screen.getByTestId("runbook-step-4-more-fields"),
      ).toHaveTextContent("Key passphrase");
    }, WAIT);
    expect(document.getElementById("runbook-step-4-ssh-port")).not.toBeNull();
  });

  test("a Kubernetes step turns into the kubectl script that makes the same change", async () => {
    await renderSteps();
    open("Old Kubernetes step");

    expect(screen.getByTestId("runbook-step-5-legacy")).toHaveTextContent(
      "This step restarts or scales one workload with a runbook credential.",
    );

    fireEvent.click(screen.getByTestId("runbook-step-5-legacy-convert"));

    const steps: Array<RunbookStep> = await save();
    const config: Record<string, unknown> = steps[5]!.config as Record<
      string,
      unknown
    >;

    expect(String(config["script"])).toContain(
      "kubectl patch deployment api --namespace web",
    );
    expect(config["kubeconfig"]).toBe("");
    expect(config).not.toHaveProperty("credentialId");
    expect(config).not.toHaveProperty("action");
  });
});
