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
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS } from "../../../Types/Runner/GlobalRunnerWork";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * THE ONE RUNNER PICKER, RENDERED.
 *
 * Runbooks -> a runbook -> Steps picks each step's Runner with it. A
 * JavaScript step that picked none shows "Global Runner" - the Runners
 * OneUptime runs for every project - picked, first, with what it means
 * under it; the project's own Runners follow. A step with nothing to pick
 * gets one sentence that says what to do, never an empty box. What it
 * loads (RunnerChoicesLoader) is read here too: the project's own Runners,
 * the global ones from their own route, and the project's switch.
 */

const PROJECT_ID: string = "dddddddd-0000-4000-8000-000000000001";

const BASTION_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const STAGING_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const GONE_ID: string = "cccccccc-0000-4000-8000-000000000001";

const OWN_RUNNER_HELP: string = "The step runs on the Runner you picked.";

const GLOBAL_HELP: string = `Runs on a global Runner, in a sandbox that can reach the internet but not your network, for ${GLOBAL_RUNNER_MAX_MINUTES} minutes at most. Pick one of your own Runners for anything on your network.`;

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

/*
 * The step editor keeps the step's pick and hands it back, as the picker
 * is used there.
 */
let changes: Array<string> = [];

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

  test("on a project that turned global Runners off, with Runners of its own, it waits for a pick", () => {
    renderPicker({
      stepType: RunbookStepType.JavaScript,
      choices: choices({ projectUsesGlobalRunners: false }),
    });

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("prod-bastion");
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

  test("negative control: a Bash step, which global Runners never run, keeps the step's own line", () => {
    renderPicker({
      stepType: RunbookStepType.Bash,
      choices: choices({ projectUsesGlobalRunners: false }),
    });

    expect(help()).toHaveTextContent(OWN_RUNNER_HELP);
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
    test(`a ${stepType} step is offered the project's own Runners only`, () => {
      renderPicker({ stepType });

      const options: Array<HTMLElement> = openMenu();

      expect(options).toHaveLength(2);
      expect(options[0]).toHaveTextContent("prod-bastion · Connected");
      expect(
        options.some((option: HTMLElement) => {
          return (option.textContent || "").includes(
            GLOBAL_RUNNER_CHOICE_LABEL,
          );
        }),
      ).toBe(false);
    });

    test(`a ${stepType} step with no Runner of the project's own says it needs one, even with global Runners`, () => {
      renderPicker({ stepType, choices: choices({ projectRunners: [] }) });

      expect(
        screen.getByTestId("runbook-step-0-runner-nothing-to-pick"),
      ).toHaveTextContent(
        `${stepType} steps run on a Runner of your own, inside your network. Add one under Runbooks › Runners, then pick it here.`,
      );
      expect(screen.queryByText(/No Runners/)).toBeNull();
    });
  }
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
    const getItem: jest.SpiedFunction<typeof ModelAPI.getItem> = jest
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
