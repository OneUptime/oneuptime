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
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import RunnerPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPicker";
import RunnerChoicesLoader, {
  GLOBAL_RUNNERS_ROUTE,
  RunnerChoices,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import { GLOBAL_RUNNER_MAX_MINUTES } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/GlobalRunnersCopy";
import {
  GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  GLOBAL_RUNNER_CHOICE_LABEL,
  GLOBAL_RUNNER_NOT_CONNECTED_TEXT,
  GLOBAL_RUNNER_STEP_TYPE_UNAVAILABLE_TEXT,
  GLOBAL_RUNNER_TURNED_OFF_UNAVAILABLE_TEXT,
  PICKED_GLOBAL_RUNNER_NEEDS_OWN_TEXT,
  STEP_NO_GLOBAL_RUNNER_HELPER_TEXT,
  CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  CODE_GLOBAL_RUNNER_HELPER_TEXT,
  REMEDIATION_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  REMEDIATION_NO_RUNNER_PLACEHOLDER,
  RunnerPickerWork,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import { GLOBAL_RUNNER_CHOICE_ID } from "../../../Types/Runner/RunnerChoice";
import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS } from "../../../Types/Runner/GlobalRunnerWork";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * THE ONE RUNNER PICKER, RENDERED.
 *
 * Runbooks -> a runbook -> Steps picks each step's Runner with it. A
 * JavaScript step that picked none shows "Global Runner" - the Runners
 * OneUptime runs for every project - picked, first, with what it means
 * under it; the project's own Runners follow. In a project with a default
 * Runner, a step that picked none shows that Runner first, tagged as the
 * project default, with the Global Runner a choice of its own after it. A
 * Bash, SSH or kubectl step is shown the Global Runner last, never picked,
 * saying it runs JavaScript steps only. A step with nothing to pick gets
 * one sentence that says what to do, never an empty box. What it loads
 * (RunnerChoicesLoader) is read here too: the project's own Runners - which
 * is the default - the global ones from their own route, and the
 * project's switch.
 */

const PROJECT_ID: string = "dddddddd-0000-4000-8000-000000000001";

const BASTION_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const STAGING_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const DEFAULT_ID: string = "aaaaaaaa-0000-4000-8000-000000000003";
const GONE_ID: string = "cccccccc-0000-4000-8000-000000000001";

const OWN_RUNNER_HELP: string = "The step runs on the Runner you picked.";

const GLOBAL_HELP: string = `Runs in a sandbox that reaches the internet only, for up to ${GLOBAL_RUNNER_MAX_MINUTES} minutes. To reach your network, pick one of your Runners.`;

function choices(overrides: Partial<RunnerChoices> = {}): RunnerChoices {
  return {
    projectRunners: [
      {
        id: BASTION_ID,
        name: "prod-bastion",
        liveStatus: RunnerLiveStatus.Connected,
      },
      {
        id: STAGING_ID,
        name: "staging-runner",
        liveStatus: RunnerLiveStatus.Disconnected,
      },
    ],
    globalRunners: [
      {
        id: "bbbbbbbb-0000-4000-8000-000000000001",
        name: "global-eu",
        description: "",
        liveStatus: RunnerLiveStatus.Connected,
        runsRunbooks: true,
      },
    ],
    projectUsesGlobalRunners: true,
    ...overrides,
  };
}

// The same, with prod-default as the project's default Runner.
function choicesWithDefault(
  defaultLiveStatus: RunnerLiveStatus = RunnerLiveStatus.Connected,
): RunnerChoices {
  return choices({
    projectRunners: [
      {
        id: BASTION_ID,
        name: "prod-bastion",
        liveStatus: RunnerLiveStatus.Connected,
      },
      {
        id: DEFAULT_ID,
        name: "prod-default",
        liveStatus: defaultLiveStatus,
        isProjectDefault: true,
      },
    ],
  });
}

/*
 * The step editor keeps the step's pick and hands it back, as the picker
 * is used there.
 */
let changes: Array<string> = [];

// What the picker handed back so far (read from tests built in a loop).
function recordedChanges(): Array<string> {
  return changes;
}

// Keeps what the picker hands back (handed to pickers built in a loop).
function recordChange(next: string): void {
  changes.push(next);
}

function Harness(props: {
  stepType: string;
  initialValue: string;
  choices: RunnerChoices;
}): ReactElement {
  const [value, setValue] = useState<string>(props.initialValue);

  return (
    <RunnerPicker
      stepType={props.stepType}
      value={value}
      onChange={(next: string) => {
        changes.push(next);
        setValue(next);
      }}
      choices={props.choices}
      ownRunnerHelperText={<>{OWN_RUNNER_HELP}</>}
      dataTestId="runbook-step-0-runner"
    />
  );
}

function renderPicker(props: {
  stepType: string;
  value?: string;
  choices?: RunnerChoices;
}): RenderResult {
  return render(
    <Harness
      stepType={props.stepType}
      initialValue={props.value || ""}
      choices={props.choices || choices()}
    />,
  );
}

function openMenu(): Array<HTMLElement> {
  fireEvent.keyDown(
    within(screen.getByTestId("runbook-step-0-runner")).getByRole("combobox"),
    { key: "ArrowDown", code: "ArrowDown" },
  );

  return screen.getAllByRole("option");
}

function help(): HTMLElement {
  return screen.getByTestId("runbook-step-0-runner-help");
}

function shown(): string {
  return (
    screen
      .getByTestId("runbook-step-0-runner")
      .querySelector(".ou-select__single-value")?.textContent || ""
  );
}

beforeEach(() => {
  changes = [];
  // The link to Runbooks -> Runners is the current project's.
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a JavaScript step", () => {
  test("that picked no Runner shows Global Runner, picked, and what it means", () => {
    renderPicker({ stepType: RunbookStepType.JavaScript });

    expect(shown()).toBe(`${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`);
    expect(help()).toHaveTextContent(GLOBAL_HELP);
    expect(GLOBAL_RUNNER_MAX_MINUTES).toBe(
      GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS / 60000,
    );
    expect(GLOBAL_RUNNER_MAX_MINUTES).toBe(5);
    expect(
      screen.queryByTestId("runbook-step-0-runner-nothing-to-pick"),
    ).toBeNull();
  });

  test("offers Global Runner first, saying what it is, then the project's own Runners with how each is doing", () => {
    renderPicker({ stepType: RunbookStepType.JavaScript });

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent(
      `${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`,
    );
    expect(options[0]).toHaveTextContent(GLOBAL_RUNNER_CHOICE_DESCRIPTION);
    expect(options[1]).toHaveTextContent("prod-bastion · Connected");
    expect(options[2]).toHaveTextContent("staging-runner · Disconnected");
  });

  test("picking one of the project's Runners stores its ID, and the line under the picker becomes the step's own", () => {
    renderPicker({ stepType: RunbookStepType.JavaScript });

    fireEvent.click(openMenu()[2]!);

    expect(changes).toEqual([STAGING_ID]);
    expect(shown()).toBe("staging-runner · Disconnected");
    expect(help()).toHaveTextContent(OWN_RUNNER_HELP);
  });

  test("picking Global Runner again stores no Runner", () => {
    renderPicker({ stepType: RunbookStepType.JavaScript, value: BASTION_ID });

    expect(shown()).toBe("prod-bastion · Connected");

    fireEvent.click(openMenu()[0]!);

    expect(changes).toEqual([""]);
    expect(shown()).toBe(`${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`);
    expect(help()).toHaveTextContent(GLOBAL_HELP);
  });

  test("the picker cannot be cleared to nothing: a JavaScript step always shows what it runs on", () => {
    renderPicker({ stepType: RunbookStepType.JavaScript, value: BASTION_ID });

    expect(
      screen
        .getByTestId("runbook-step-0-runner")
        .querySelector(".ou-select__clear-indicator"),
    ).toBeNull();
  });

  test("a Runner that is not the project's any more is named as unknown, with a warning", () => {
    renderPicker({ stepType: RunbookStepType.JavaScript, value: GONE_ID });

    expect(shown()).toBe(`Unknown Runner (${GONE_ID})`);
    expect(help()).toHaveTextContent(
      "This step picked a Runner that is not one of this project's Runners any more, so it will fail when it runs. Pick another Runner.",
    );
  });

  test("on a project that turned global Runners off, with Runners of its own, it waits for a pick - the Global Runner drawn last, not open, saying why", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choices({ projectUsesGlobalRunners: false }),
    });

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("prod-bastion");
    expect(options[2]).toHaveTextContent(GLOBAL_RUNNER_CHOICE_LABEL);
    expect(options[2]).toHaveTextContent(
      GLOBAL_RUNNER_TURNED_OFF_UNAVAILABLE_TEXT,
    );
    expect(options[2]).toHaveAttribute("aria-disabled", "true");
    expect(shown()).toBe("");
  });

  test("on a project that turned global Runners off, the line under the picker says why there is no global choice", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choices({ projectUsesGlobalRunners: false }),
    });

    expect(help()).toHaveTextContent(
      "This project does not use global Runners: pick one of your Runners for this step.",
    );
    expect(help()).not.toHaveTextContent(OWN_RUNNER_HELP);

    // Once one of the project's own is picked, the line is the step's own.
    openMenu();
    fireEvent.click(screen.getByText("prod-bastion · Connected"));

    expect(help()).toHaveTextContent(OWN_RUNNER_HELP);
  });

  test("a Bash step, which global Runners never run, is told so whatever the project's switch, and how to go on", () => {
    renderPicker({
      stepType: RunbookStepType.Bash,
      choices: choices({ projectUsesGlobalRunners: false }),
    });

    expect(help()).toHaveTextContent(
      "Bash steps run on a Runner of your own, inside your network: the Global Runner runs JavaScript steps only. Pick one, or make one the project default under Runbooks › Runners.",
    );
    expect(help()).not.toHaveTextContent(OWN_RUNNER_HELP);
  });

  test("on a server with no global Runner, a JavaScript step that picked none is told to pick one of the project's own", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choices({ globalRunners: [] }),
    });

    expect(shown()).toBe("");
    expect(help()).toHaveTextContent(STEP_NO_GLOBAL_RUNNER_HELPER_TEXT);
  });

  test("on a project that turned global Runners off, with none of its own, it says how to go on", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choices({
        projectUsesGlobalRunners: false,
        projectRunners: [],
      }),
    });

    expect(
      screen.getByTestId("runbook-step-0-runner-nothing-to-pick"),
    ).toHaveTextContent(
      "This project does not use global Runners. Add a Runner of your own under Runbooks › Runners, or turn global Runners on there.",
    );
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  test("on a server with no global Runner, and none of the project's own, it says how to go on", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choices({ globalRunners: [], projectRunners: [] }),
    });

    expect(
      screen.getByTestId("runbook-step-0-runner-nothing-to-pick"),
    ).toHaveTextContent(
      "Add a Runner under Runbooks › Runners to run this step, then pick it here.",
    );
  });
});

describe("Bash, SSH and Kubernetes steps", () => {
  for (const stepType of [
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
  ]) {
    /*
     * The maintainer's "Why can't I select a global runner here when I have
     * one?": it is there, last, saying it runs JavaScript steps only - and
     * it cannot be picked.
     */
    test(`a ${stepType} step is offered the project's own Runners, and shown the Global Runner last as not open to it`, () => {
      renderPicker({ stepType });

      const options: Array<HTMLElement> = openMenu();

      expect(options).toHaveLength(3);
      expect(options[0]).toHaveTextContent("prod-bastion · Connected");
      expect(options[1]).toHaveTextContent("staging-runner · Disconnected");
      expect(options[2]).toHaveTextContent(GLOBAL_RUNNER_CHOICE_LABEL);
      expect(options[2]).toHaveTextContent(
        GLOBAL_RUNNER_STEP_TYPE_UNAVAILABLE_TEXT,
      );
      expect(options[2]).not.toHaveTextContent("Connected");
      expect(options[2]).toHaveAttribute("aria-disabled", "true");

      // Picking it does nothing: the step keeps no Runner.
      fireEvent.click(options[2]!);

      expect(recordedChanges()).toEqual([]);
      expect(shown()).toBe("");
    });

    test(`a ${stepType} step that picked none says why the Global Runner is not open to it, and the two ways on`, () => {
      renderPicker({ stepType });

      expect(help()).toHaveTextContent(
        `${stepType} steps run on a Runner of your own, inside your network: the Global Runner runs JavaScript steps only. Pick one, or make one the project default under Runbooks › Runners.`,
      );
      expect(
        within(help()).getByRole("link", { name: "Runbooks › Runners" }),
      ).toHaveAttribute("target", "_blank");
      expect(help().firstElementChild).toHaveClass("text-amber-700");
    });

    test(`a ${stepType} step that picked the Global Runner itself shows it, and is told to pick one of the project's own`, () => {
      renderPicker({ stepType, value: GLOBAL_RUNNER_CHOICE_ID });

      expect(shown()).toBe(GLOBAL_RUNNER_CHOICE_LABEL);
      expect(help()).toHaveTextContent(PICKED_GLOBAL_RUNNER_NEEDS_OWN_TEXT);
    });

    test(`a ${stepType} step with no Runner of the project's own says it needs one, even with global Runners`, () => {
      renderPicker({ stepType, choices: choices({ projectRunners: [] }) });

      expect(
        screen.getByTestId("runbook-step-0-runner-nothing-to-pick"),
      ).toHaveTextContent(
        `${stepType} steps run on a Runner of your own, inside your network: the Global Runner runs JavaScript steps only. Add one under Runbooks › Runners, then pick it here.`,
      );
      expect(screen.queryByText(/No Runners/)).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
    });
  }
});

describe("a step in a project with a default Runner", () => {
  test("a JavaScript step that picked none shows the default, tagged, and the step's own line", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choicesWithDefault(),
    });

    expect(shown()).toBe("prod-default · Project default · Connected");
    expect(help()).toHaveTextContent(OWN_RUNNER_HELP);
  });

  test("offers the default first, then the Global Runner as a choice of its own, then the rest", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choicesWithDefault(),
    });

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent(
      "prod-default · Project default · Connected",
    );
    expect(options[1]).toHaveTextContent(
      `${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`,
    );
    expect(options[1]).toHaveTextContent(GLOBAL_RUNNER_CHOICE_DESCRIPTION);
    expect(options[2]).toHaveTextContent("prod-bastion · Connected");
  });

  test("picking the Global Runner stores 'global', and picking the default again stores no Runner", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choicesWithDefault(),
    });

    fireEvent.click(openMenu()[1]!);

    expect(changes).toEqual([GLOBAL_RUNNER_CHOICE_ID]);
    expect(shown()).toBe(`${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`);

    fireEvent.click(openMenu()[0]!);

    expect(changes).toEqual([GLOBAL_RUNNER_CHOICE_ID, ""]);
    expect(shown()).toBe("prod-default · Project default · Connected");
  });

  test("a Bash step that picked none runs on the default; the Global Runner is drawn last, not open", () => {
    renderPicker({
      stepType: RunbookStepType.Bash,
      choices: choicesWithDefault(),
    });

    expect(shown()).toBe("prod-default · Project default · Connected");
    expect(help()).toHaveTextContent(OWN_RUNNER_HELP);

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(3);
    expect(options[2]).toHaveTextContent(GLOBAL_RUNNER_CHOICE_LABEL);
    expect(options[2]).toHaveAttribute("aria-disabled", "true");
  });

  test("a default that is not connected is shown so, and the step is said to fail if it does not come back", () => {
    renderPicker({
      stepType: RunbookStepType.Bash,
      choices: choicesWithDefault(RunnerLiveStatus.NeverConnected),
    });

    expect(shown()).toBe("prod-default · Project default · Never connected");
    expect(
      screen.getByTestId("runbook-step-0-runner-runner-waiting"),
    ).toHaveTextContent(
      "prod-default is not connected right now. The step fails if this Runner does not pick it up within its claim timeout.",
    );
  });

  test("negative control: a connected default, or the Global Runner, says nothing of the kind", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choicesWithDefault(),
    });

    expect(
      screen.queryByTestId("runbook-step-0-runner-runner-waiting"),
    ).toBeNull();
  });
});

describe("a step on one of the project's own Runners that is not connected", () => {
  test("says the step fails if the Runner does not pick it up", () => {
    renderPicker({ stepType: RunbookStepType.Bash, value: STAGING_ID });

    expect(
      screen.getByTestId("runbook-step-0-runner-runner-waiting"),
    ).toHaveTextContent(
      "staging-runner is not connected right now. The step fails if this Runner does not pick it up within its claim timeout.",
    );
    expect(
      screen.getByTestId("runbook-step-0-runner-runner-waiting"),
    ).toHaveClass("text-amber-700");
  });

  test("negative control: a connected pick says nothing", () => {
    renderPicker({ stepType: RunbookStepType.Bash, value: BASTION_ID });

    expect(
      screen.queryByTestId("runbook-step-0-runner-runner-waiting"),
    ).toBeNull();
  });
});

describe("where to add a Runner, when a step has nothing to pick", () => {
  function runnersLink(): HTMLElement {
    return within(
      screen.getByTestId("runbook-step-0-runner-nothing-to-pick"),
    ).getByRole("link", { name: "Runbooks › Runners" });
  }

  const RUNNERS_PAGE: string = `/dashboard/${PROJECT_ID}/runbooks/runners`;

  test("a Bash step's box links to Runbooks › Runners, in a new tab, so the steps being edited stay", () => {
    renderPicker({
      stepType: RunbookStepType.Bash,
      choices: choices({ projectRunners: [] }),
    });

    expect(runnersLink()).toHaveAttribute("href", RUNNERS_PAGE);
    expect(runnersLink()).toHaveAttribute("target", "_blank");
    expect(runnersLink()).toHaveAttribute(
      "data-testid",
      "runbook-step-0-runner-runners-link",
    );
  });

  test("a project that turned global Runners off is linked to the same page, where the switch is", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choices({
        projectUsesGlobalRunners: false,
        projectRunners: [],
      }),
    });

    expect(runnersLink()).toHaveAttribute("href", RUNNERS_PAGE);
    expect(runnersLink()).toHaveAttribute("target", "_blank");
  });

  test("a server with no global Runner is linked there too", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choices({ globalRunners: [], projectRunners: [] }),
    });

    expect(runnersLink()).toHaveAttribute("href", RUNNERS_PAGE);
  });

  test("negative control: a step with something to pick has no box and no link", () => {
    renderPicker({ stepType: RunbookStepType.JavaScript });

    expect(
      screen.queryByTestId("runbook-step-0-runner-nothing-to-pick"),
    ).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("a step on Global Runner while no global Runner is connected", () => {
  function waiting(): HTMLElement | null {
    return screen.queryByTestId("runbook-step-0-runner-global-waiting");
  }

  for (const liveStatus of [
    RunnerLiveStatus.Disconnected,
    RunnerLiveStatus.NeverConnected,
  ]) {
    test(`says the step waits and fails after its claim timeout (${liveStatus})`, () => {
      renderPicker({
        stepType: RunbookStepType.JavaScript,
        choices: choices({
          globalRunners: [
            {
              id: "bbbbbbbb-0000-4000-8000-000000000001",
              name: "global-eu",
              description: "",
              liveStatus,
              runsRunbooks: true,
            },
          ],
        }),
      });

      expect(help()).toHaveTextContent(GLOBAL_HELP);
      expect(waiting()).toHaveTextContent(GLOBAL_RUNNER_NOT_CONNECTED_TEXT);
      expect(waiting()).toHaveClass("text-amber-700");
    });
  }

  test("one connected global Runner is enough: no warning", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choices({
        globalRunners: [
          {
            id: "bbbbbbbb-0000-4000-8000-000000000001",
            name: "global-eu",
            description: "",
            liveStatus: RunnerLiveStatus.Disconnected,
            runsRunbooks: true,
          },
          {
            id: "bbbbbbbb-0000-4000-8000-000000000002",
            name: "global-us",
            description: "",
            liveStatus: RunnerLiveStatus.Connected,
            runsRunbooks: true,
          },
        ],
      }),
    });

    expect(waiting()).toBeNull();
  });

  test("negative control: a step on one of the project's own Runners never shows it", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      value: BASTION_ID,
      choices: choices({
        globalRunners: [
          {
            id: "bbbbbbbb-0000-4000-8000-000000000001",
            name: "global-eu",
            description: "",
            liveStatus: RunnerLiveStatus.Disconnected,
            runsRunbooks: true,
          },
        ],
      }),
    });

    expect(waiting()).toBeNull();
  });
});

describe("what the picker loads", () => {
  interface ListCall {
    modelType: unknown;
    query: Record<string, unknown>;
    requestOptions?: { overrideRequestUrl?: unknown } | undefined;
  }

  let listCalls: Array<ListCall> = [];

  function runnerRow(
    id: string,
    name: string,
    canRunRunbooks: boolean,
  ): Runner {
    return Object.assign(new Runner(), {
      _id: id,
      name,
      description: `${name} description`,
      canRunRunbooks,
      lastAlive: new Date(),
    });
  }

  function stubLists(options: { globalFails?: boolean } = {}): void {
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
        const call: ListCall = args as ListCall;
        listCalls.push(call);

        const isGlobal: boolean = String(
          call.requestOptions?.overrideRequestUrl || "",
        ).endsWith(GLOBAL_RUNNERS_ROUTE);

        if (isGlobal && options.globalFails) {
          throw new Error("Not found");
        }

        const data: Array<Runner> = isGlobal
          ? [
              runnerRow(
                "bbbbbbbb-0000-4000-8000-000000000001",
                "global-eu",
                true,
              ),
              runnerRow(
                "bbbbbbbb-0000-4000-8000-000000000002",
                "global-paused",
                false,
              ),
            ]
          : [runnerRow(BASTION_ID, "prod-bastion", true)];

        return {
          data: data as Array<never>,
          count: data.length,
          skip: 0,
          limit: 10,
        };
      });
  }

  beforeEach(() => {
    listCalls = [];
  });

  test("the project's own Runners by the project, the global ones from their route, and the project's switch", async () => {
    stubLists();
    // What the test reads of the spy: the calls it was made with.
    const getItem: { mock: { calls: Array<Array<unknown>> } } = jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<never> => {
        return Object.assign(new Project(), {
          useGlobalRunners: false,
        }) as never;
      });

    const loaded: RunnerChoices = await RunnerChoicesLoader.load(
      new ObjectID(PROJECT_ID),
    );

    expect(GLOBAL_RUNNERS_ROUTE).toBe("/runner/global-runners");
    expect(loaded.projectRunners).toEqual([
      {
        id: BASTION_ID,
        name: "prod-bastion",
        liveStatus: RunnerLiveStatus.Connected,
      },
    ]);
    // Only the global Runners that take runbook steps are offered.
    expect(
      loaded.globalRunners.map((runner: { name: string }) => {
        return runner.name;
      }),
    ).toEqual(["global-eu"]);
    expect(loaded.projectUsesGlobalRunners).toBe(false);

    const ownRead: ListCall | undefined = listCalls.find((call: ListCall) => {
      return !call.requestOptions?.overrideRequestUrl;
    });

    expect(String(ownRead?.query["projectId"])).toBe(PROJECT_ID);

    const switchRead: { modelType: unknown; select: unknown } = getItem.mock
      .calls[0]![0] as unknown as { modelType: unknown; select: unknown };

    expect(switchRead.modelType).toBe(Project);
    expect(switchRead.select).toEqual({ useGlobalRunners: true });
  });

  test("a server that cannot list global Runners leaves the project's own to pick from", async () => {
    stubLists({ globalFails: true });
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(new Project() as never);

    const loaded: RunnerChoices = await RunnerChoicesLoader.load(
      new ObjectID(PROJECT_ID),
    );

    expect(loaded.globalRunners).toEqual([]);
    expect(loaded.projectRunners).toHaveLength(1);
    // A project that never touched the switch uses them.
    expect(loaded.projectUsesGlobalRunners).toBe(true);
  });

  test("only a project default that may be it is marked: the rule the server reads it by", async () => {
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
        const call: ListCall = args as ListCall;
        listCalls.push(call);

        const data: Array<Runner> = String(
          call.requestOptions?.overrideRequestUrl || "",
        ).endsWith(GLOBAL_RUNNERS_ROUTE)
          ? []
          : [
              Object.assign(runnerRow(BASTION_ID, "prod-bastion", true), {
                isProjectDefault: true,
              }),
              // Marked in the database, but it does not run runbooks: passed over.
              Object.assign(runnerRow(STAGING_ID, "staging-runner", false), {
                isProjectDefault: true,
              }),
            ];

        return {
          data: data as Array<never>,
          count: data.length,
          skip: 0,
          limit: 10,
        };
      });
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(new Project() as never);

    const loaded: RunnerChoices = await RunnerChoicesLoader.load(
      new ObjectID(PROJECT_ID),
    );

    expect(
      loaded.projectRunners.map(
        (runner: { name: string; isProjectDefault?: boolean | undefined }) => {
          return [runner.name, runner.isProjectDefault === true];
        },
      ),
    ).toEqual([
      ["prod-bastion", true],
      ["staging-runner", false],
    ]);

    // Read with what decides it.
    const ownRead: ListCall | undefined = listCalls.find((call: ListCall) => {
      return !call.requestOptions?.overrideRequestUrl;
    });
    const select: Record<string, unknown> = (
      ownRead as unknown as { select: Record<string, unknown> }
    ).select;

    expect(select["isProjectDefault"]).toBe(true);
    expect(select["canRunRunbooks"]).toBe(true);
    expect(select["hostInfo"]).toBe(true);
  });

  test("the project's default Runner is read on its own, by its id and name, and only one that may be it", async () => {
    let rows: Array<Runner> = [
      Object.assign(runnerRow(DEFAULT_ID, "prod-default", true), {
        isProjectDefault: true,
      }),
    ];

    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
        listCalls.push(args as ListCall);

        return {
          data: rows as Array<never>,
          count: rows.length,
          skip: 0,
          limit: 1,
        };
      });

    expect(
      await RunnerChoicesLoader.loadProjectDefaultRunner(
        new ObjectID(PROJECT_ID),
      ),
    ).toEqual({ id: DEFAULT_ID, name: "prod-default" });

    const read: { query: Record<string, unknown>; limit: number } =
      listCalls[0] as unknown as {
        query: Record<string, unknown>;
        limit: number;
      };

    expect(String(read.query["projectId"])).toBe(PROJECT_ID);
    expect(read.query["isProjectDefault"]).toBe(true);
    expect(read.limit).toBe(1);

    // None, a row that is not the default, and one that may not be it: no default.
    for (const next of [
      [],
      [runnerRow(DEFAULT_ID, "prod-default", true)],
      [
        Object.assign(runnerRow(DEFAULT_ID, "kubernetes-agent/prod", true), {
          isProjectDefault: true,
        }),
      ],
    ]) {
      rows = next;
      expect(
        await RunnerChoicesLoader.loadProjectDefaultRunner(
          new ObjectID(PROJECT_ID),
        ),
      ).toBeNull();
    }
  });

  test("someone who may not read the project's switch is shown what a project starts with", async () => {
    stubLists();
    jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValue(new Error("Permission denied") as never);

    const loaded: RunnerChoices = await RunnerChoicesLoader.load(
      new ObjectID(PROJECT_ID),
    );

    expect(loaded.projectUsesGlobalRunners).toBe(true);
  });
});

/*
 * "If there are no runners, it should use the global runner by default" -
 * the maintainer, of an AI rule's Runner that read "No Runner". In a
 * project with no Runner of its own, every Runner field opens on the Global
 * Runner wherever global Runners can run its work, saying what runs there;
 * where they cannot - a Bash, SSH or kubectl step, an AI rule's Bash
 * commands - it says what happens instead and how to add a Runner, never
 * running a shell on a host every project shares.
 */
describe("in a project with no Runner of its own, every Runner field", () => {
  const NO_OWN_RUNNERS: RunnerChoices = {
    projectRunners: [],
    globalRunners: [
      {
        id: "bbbbbbbb-0000-4000-8000-000000000001",
        name: "global-eu",
        description: "",
        liveStatus: RunnerLiveStatus.Connected,
        runsRunbooks: true,
      },
    ],
    projectUsesGlobalRunners: true,
  };

  const PICKER_TEST_ID: string = "runner-field";

  function renderField(data: {
    work?: RunnerPickerWork | undefined;
    stepType: string;
  }): void {
    render(
      <RunnerPicker
        work={data.work}
        stepType={data.stepType}
        value=""
        onChange={recordChange}
        choices={NO_OWN_RUNNERS}
        isFormField={data.work !== undefined}
        dataTestId={PICKER_TEST_ID}
      />,
    );
  }

  function fieldShown(): string {
    return (
      screen
        .getByTestId(PICKER_TEST_ID)
        .querySelector(".ou-select__single-value")?.textContent || ""
    );
  }

  function fieldLine(): string {
    return (
      screen.getByTestId(`${PICKER_TEST_ID}-help`).textContent || ""
    ).trim();
  }

  function fieldMenu(): Array<HTMLElement> {
    fireEvent.keyDown(
      within(screen.getByTestId(PICKER_TEST_ID)).getByRole("combobox"),
      { key: "ArrowDown", code: "ArrowDown" },
    );

    return screen.getAllByRole("option");
  }

  test("a JavaScript step runs on the Global Runner, saying it reaches the internet only", () => {
    renderField({ stepType: RunbookStepType.JavaScript });

    expect(fieldShown()).toBe(`${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`);
    expect(fieldLine()).toBe(
      `Runs in a sandbox that reaches the internet only, for up to ${GLOBAL_RUNNER_MAX_MINUTES} minutes. To reach your network, pick one of your Runners.`,
    );
    expect(fieldMenu()[0]).toHaveTextContent(GLOBAL_RUNNER_CHOICE_DESCRIPTION);
    expect(recordedChanges()).toEqual([]);
  });

  for (const [stepType, stepTypeName, article] of [
    [RunbookStepType.Bash, "Bash", "a"],
    [RunbookStepType.SSH, "SSH", "an"],
    [RunbookStepType.Kubernetes, "kubectl", "a"],
  ] as Array<[string, string, string]>) {
    test(`${article} ${stepTypeName} step never runs on it: one sentence says it needs a Runner of your own, and where to add one`, () => {
      render(
        <RunnerPicker
          stepType={stepType}
          stepTypeName={stepTypeName}
          value=""
          onChange={recordChange}
          choices={NO_OWN_RUNNERS}
          dataTestId={PICKER_TEST_ID}
        />,
      );

      const box: HTMLElement = screen.getByTestId(
        `${PICKER_TEST_ID}-nothing-to-pick`,
      );
      expect(box).toHaveTextContent(
        `${stepTypeName} steps run on a Runner of your own, inside your network: the Global Runner runs JavaScript steps only. Add one under Runbooks › Runners, then pick it here.`,
      );
      // No menu to put the Global Runner in front of it.
      expect(
        within(screen.getByTestId(PICKER_TEST_ID)).queryByRole("combobox"),
      ).toBeNull();
    });
  }

  test("a code repository works on the Global Runner, saying it does not build or test the change", () => {
    renderField({ work: RunnerPickerWork.CodeRepository, stepType: "" });

    expect(fieldShown()).toBe(`${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`);
    expect(fieldLine()).toBe(CODE_GLOBAL_RUNNER_HELPER_TEXT);
    expect(fieldMenu()[0]).toHaveTextContent(
      CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
    );
  });

  test("an AI rule shows the Global Runner, saying OneUptime AI runs no Bash commands there, and where to add a Runner that will", () => {
    renderField({ work: RunnerPickerWork.AutoRemediation, stepType: "" });

    expect(fieldShown()).toBe(`${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`);
    expect(fieldShown()).not.toContain(REMEDIATION_NO_RUNNER_PLACEHOLDER);
    expect(fieldLine()).toBe(
      "OneUptime AI runs no Bash commands on the Global Runner, which every project shares. Add a Runner under Runbooks › Runners to run them.",
    );
    expect(
      within(screen.getByTestId(`${PICKER_TEST_ID}-help`)).getByRole("link", {
        name: "Runbooks › Runners",
      }),
    ).toHaveAttribute("target", "_blank");
    expect(fieldMenu()[0]).toHaveTextContent(
      REMEDIATION_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
    );
    // Never said to wait on it, as a step on it is: nothing of the rule's runs there.
    expect(screen.queryByTestId(`${PICKER_TEST_ID}-global-waiting`)).toBeNull();
    expect(recordedChanges()).toEqual([]);
  });
});

/*
 * How each Runner field draws what it shows and the line under it.
 *
 * The Global Runner's label is the product's own words ("Global Runner ·
 * Connected"), so the box lays it out the page's way: read by its own
 * direction, the Persian "Runner سراسری · متصل" - which starts with a Latin
 * word - was laid out left to right, its words out of order. A Runner's own
 * name keeps reading its own direction, so an English name on a Persian
 * page keeps its start in view (#5145).
 *
 * The line under the box: a step's is the step editor's size, a code
 * repository's the size of its form's descriptions, and an AI rule's reads
 * like the hints under the rule's other pickers - small, close under its
 * box, a field's gap before the next field, its link underlined only.
 */
describe("what a Runner field shows, and its line", () => {
  const PICKER_TEST_ID: string = "runner-field";

  function renderField(data: {
    work?: RunnerPickerWork | undefined;
    stepType: string;
    value?: string | undefined;
    choices?: RunnerChoices | undefined;
  }): void {
    render(
      <RunnerPicker
        work={data.work}
        stepType={data.stepType}
        value={data.value || ""}
        onChange={recordChange}
        choices={data.choices || choices()}
        isFormField={data.work !== undefined}
        dataTestId={PICKER_TEST_ID}
      />,
    );
  }

  function valueLabel(): HTMLElement {
    return within(screen.getByTestId(PICKER_TEST_ID)).getByTestId(
      "dropdown-value-label",
    );
  }

  function fieldLine(): HTMLElement {
    return screen.getByTestId(`${PICKER_TEST_ID}-help`);
  }

  function hasClasses(element: HTMLElement, classNames: Array<string>): void {
    for (const className of classNames) {
      expect({ className, has: element.classList.contains(className) }).toEqual(
        { className, has: true },
      );
    }
  }

  for (const [label, work, stepType] of [
    ["a JavaScript step", undefined, RunbookStepType.JavaScript],
    ["a code repository", RunnerPickerWork.CodeRepository, ""],
    ["an AI rule", RunnerPickerWork.AutoRemediation, ""],
  ] as Array<[string, RunnerPickerWork | undefined, string]>) {
    test(`${label} on the Global Runner lays its label out the page's way`, () => {
      renderField({ work, stepType });

      expect(valueLabel()).toHaveTextContent(
        `${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`,
      );
      expect(valueLabel()).not.toHaveAttribute("dir");
    });

    test(`${label} on one of the project's Runners keeps the name's own direction`, () => {
      renderField({ work, stepType, value: BASTION_ID });

      expect(valueLabel()).toHaveTextContent("prod-bastion · Connected");
      // Read the way most of its letters do: an English name, left to right.
      expect(valueLabel()).toHaveAttribute("dir", "ltr");
    });
  }

  test("a step on the project's default Runner keeps the name's own direction", () => {
    renderField({
      stepType: RunbookStepType.JavaScript,
      choices: choicesWithDefault(),
    });

    expect(valueLabel()).toHaveTextContent("prod-default");
    expect(valueLabel()).toHaveAttribute("dir", "ltr");
  });

  for (const [label, work] of [
    ["a code repository", RunnerPickerWork.CodeRepository],
    ["an AI rule", RunnerPickerWork.AutoRemediation],
  ] as Array<[string, RunnerPickerWork]>) {
    test(`${label}'s pick the reader is not shown is said in the product's words, the page's way`, () => {
      renderField({ work, stepType: "", value: GONE_ID });

      expect(valueLabel()).toHaveTextContent(
        "A Runner you do not have access to",
      );
      expect(valueLabel()).not.toHaveAttribute("dir");
    });
  }

  test("a step's pick that is gone is said in the product's words too, the page's way", () => {
    renderField({ stepType: RunbookStepType.JavaScript, value: GONE_ID });

    expect(valueLabel()).toHaveTextContent(`Unknown Runner (${GONE_ID})`);
    expect(valueLabel()).not.toHaveAttribute("dir");
  });

  test("a Bash step that picked the Global Runner, not open to it, shows its name the page's way too", () => {
    renderField({
      stepType: RunbookStepType.Bash,
      value: GLOBAL_RUNNER_CHOICE_ID,
    });

    expect(valueLabel()).toHaveTextContent(GLOBAL_RUNNER_CHOICE_LABEL);
    expect(valueLabel()).not.toHaveAttribute("dir");
  });

  test("a step's line is the step editor's size, close under the box", () => {
    renderField({ stepType: RunbookStepType.JavaScript });

    hasClasses(fieldLine(), ["text-xs", "mt-1.5", "text-gray-500"]);
    expect(fieldLine()).not.toHaveClass("mb-2");
  });

  test("a code repository's line is the size of its form's descriptions", () => {
    renderField({ work: RunnerPickerWork.CodeRepository, stepType: "" });

    hasClasses(fieldLine(), ["text-sm", "mt-2", "text-gray-500"]);
    expect(fieldLine()).not.toHaveClass("text-xs");
  });

  test("an AI rule's line reads like the hints under the rule's other pickers, its link underlined only", () => {
    renderField({
      work: RunnerPickerWork.AutoRemediation,
      stepType: "",
      choices: choices({ projectRunners: [] }),
    });

    hasClasses(fieldLine(), ["text-xs", "mt-1.5", "mb-2", "text-gray-500"]);
    expect(fieldLine()).not.toHaveClass("text-sm");

    const link: HTMLElement = within(fieldLine()).getByRole("link", {
      name: "Runbooks › Runners",
    });
    expect(link).toHaveClass("underline");
    expect(link).not.toHaveClass("font-semibold");
  });

  test("negative control: a step's link to Runbooks › Runners stays bold in its box", () => {
    renderField({
      stepType: RunbookStepType.Bash,
      choices: choices({ projectRunners: [] }),
    });

    const link: HTMLElement = within(
      screen.getByTestId(`${PICKER_TEST_ID}-nothing-to-pick`),
    ).getByRole("link", { name: "Runbooks › Runners" });
    expect(link).toHaveClass("font-semibold", "underline");
  });
});
