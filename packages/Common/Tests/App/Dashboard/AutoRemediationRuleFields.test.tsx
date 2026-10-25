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

import {
  AUTO_REMEDIATION_EVERY_TIME_TEST_ID,
  AUTO_REMEDIATION_OLDER_RULE_TEST_ID,
  AUTO_REMEDIATION_RUNNER_LOADING_TEST_ID,
  AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID,
  AutoRemediationRunnerPicker,
  OlderAutoRemediationRuleNote,
  RunbooksEveryTimeSwitch,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleFields";
import { AUTO_REMEDIATION_OLDER_RULE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleCopy";
import RunnerChoicesLoader, {
  GLOBAL_RUNNERS_ROUTE,
  GlobalRunnerRow,
  RunnerChoices,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import {
  CODE_HIDDEN_RUNNER_LABEL,
  GLOBAL_RUNNER_CHOICE_LABEL,
  PROJECT_DEFAULT_TAG,
  REMEDIATION_GLOBAL_RUNNER_ADD_TEMPLATE,
  REMEDIATION_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  REMEDIATION_GLOBAL_RUNNER_PICK_TEXT,
  REMEDIATION_GLOBAL_RUNNER_TEXT,
  REMEDIATION_HIDDEN_RUNNER_HELPER_TEXT,
  REMEDIATION_ADD_RUNNER_TEMPLATE,
  REMEDIATION_NO_RUNNER_PLACEHOLDER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * AN AI RULE'S MORE FIELDS, RENDERED.
 *
 * Runner: the Runner OneUptime AI runs the rule's Bash commands on, picked
 * with the one Runner picker. It lists the project's own Runners - the
 * default first, tagged - and the Global Runner, which a rule that picks
 * none shows wherever the project uses global Runners and the server has
 * one: "If there are no runners, it should use the global runner by
 * default" - the maintainer. A global Runner never runs a shell (one cannot
 * be kept apart from the other projects on a host every project shares),
 * so the line under the picker says OneUptime AI runs no Bash commands
 * there, and how to have them run: pick one of the project's Runners, or
 * add one where it has none. Picking the Global Runner stores none, as a
 * rule that picked none always did. Without a Global Runner to show - a
 * project that turned them off, a server with none - a rule that picks none
 * reads "No Runner" and can be cleared back to it. Never the in-cluster
 * Runners the Kubernetes agent chart installed, and never "AI agent on the
 * cluster or host": that agent is not a Runner, and commands on the
 * affected cluster or host go through it whatever the rule picks ("why
 * does it see an AI agent on the cluster or host? That doesn't make any
 * sense" - the maintainer). Picking one is what lets OneUptime AI run
 * commands on it.
 *
 * Run them every time: the switch that keeps a rule starting every runbook
 * it names for every match, without OneUptime AI deciding.
 *
 * An older rule's note: what a rule saved before rules were simplified
 * still does, and "Fix like a new rule".
 */

const PROJECT_ID: string = "dddddddd-0000-4000-8000-000000000001";
const PROD_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const OFFICE_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const HIDDEN_ID: string = "cccccccc-0000-4000-8000-000000000001";
const GLOBAL_EU_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";

function globalRunner(
  liveStatus: RunnerLiveStatus = RunnerLiveStatus.Connected,
): GlobalRunnerRow {
  return {
    id: GLOBAL_EU_ID,
    name: "global-eu",
    description: "",
    liveStatus,
    runsRunbooks: true,
  };
}

// A project with two Runners of its own, on a server that runs a global one.
function choices(overrides: Partial<RunnerChoices> = {}): RunnerChoices {
  return {
    projectRunners: [
      {
        id: PROD_ID,
        name: "prod-eu-runner",
        liveStatus: RunnerLiveStatus.Connected,
      },
      {
        id: OFFICE_ID,
        name: "office-runner",
        liveStatus: RunnerLiveStatus.Disconnected,
      },
    ],
    globalRunners: [globalRunner()],
    projectUsesGlobalRunners: true,
    ...overrides,
  };
}

const GLOBAL_RUNNER_SHOWN: string = `${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`;

let changes: Array<string | null> = [];

// The form holds the rule's Runner and hands it back, as the field is used.
function RunnerHarness(props: {
  initialValue: unknown;
  isGlobalRunnerShown?: boolean | undefined;
}): ReactElement {
  const [value, setValue] = useState<unknown>(props.initialValue);

  return (
    <AutoRemediationRunnerPicker
      value={value}
      isGlobalRunnerShown={props.isGlobalRunnerShown}
      onChange={(runnerId: string | null) => {
        changes.push(runnerId);
        setValue(runnerId);
      }}
    />
  );
}

async function renderRunnerField(
  initialValue: unknown,
  options: { isGlobalRunnerShown?: boolean | undefined } = {},
): Promise<void> {
  render(
    <RunnerHarness
      initialValue={initialValue}
      isGlobalRunnerShown={options.isGlobalRunnerShown}
    />,
  );
  // The picker is drawn once the choices are read (disabled with none).
  await screen.findByTestId(AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID);
}

// Whether the picker is drawn but cannot be opened: nothing to pick.
function isPickerDisabled(): boolean {
  return Boolean(
    screen
      .getByTestId(AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID)
      .querySelector(".ou-select__control--is-disabled"),
  );
}

function openMenu(): Array<HTMLElement> {
  fireEvent.keyDown(
    within(
      screen.getByTestId(AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID),
    ).getByRole("combobox"),
    { key: "ArrowDown", code: "ArrowDown" },
  );

  return screen.getAllByRole("option");
}

function shown(): string {
  return (
    screen
      .getByTestId(AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID)
      .querySelector(".ou-select__single-value")?.textContent || ""
  );
}

// What the picker says while nothing is picked.
function placeholder(): string {
  return (
    screen
      .getByTestId(AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID)
      .querySelector(".ou-select__placeholder")?.textContent || ""
  );
}

function clearIndicator(): Element | null {
  return screen
    .getByTestId(AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID)
    .querySelector(".ou-select__clear-indicator");
}

// The picker's clear control: back to no Runner.
function clearPick(): void {
  const clear: Element | null = clearIndicator();

  expect(clear).not.toBeNull();
  fireEvent.mouseDown(clear as Element, { button: 0 });
}

function help(): HTMLElement {
  return screen.getByTestId(`${AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID}-help`);
}

function noHelp(): void {
  expect(
    screen.queryByTestId(`${AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID}-help`),
  ).toBeNull();
}

// Nothing of a step's: a rule never waits on the Global Runner.
function noStepWarnings(): void {
  expect(
    screen.queryByTestId(
      `${AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID}-global-waiting`,
    ),
  ).toBeNull();
  expect(
    screen.queryByTestId(
      `${AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID}-nothing-to-pick`,
    ),
  ).toBeNull();
}

let loadSpy: ReturnType<typeof jest.spyOn>;

/*
 * The choices the next render reads, and what the field handed back so far:
 * read through functions, so tests built in a loop never close over the
 * module's state.
 */
function willLoad(loaded: RunnerChoices): void {
  loadSpy.mockResolvedValue(loaded as never);
}

function handedBack(): Array<string | null> {
  return changes;
}

beforeEach(() => {
  changes = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  loadSpy = jest
    .spyOn(RunnerChoicesLoader, "loadForRemediation")
    .mockResolvedValue(choices() as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a rule's Runner", () => {
  test("waits for the choices at the menu's own height, then reads the current project's", async () => {
    let resolve: (value: RunnerChoices) => void = (): void => {
      return undefined;
    };
    loadSpy.mockReturnValue(
      new Promise<RunnerChoices>((done: (value: RunnerChoices) => void) => {
        resolve = done;
      }) as never,
    );

    render(<RunnerHarness initialValue={null} />);

    const loading: HTMLElement = screen.getByTestId(
      AUTO_REMEDIATION_RUNNER_LOADING_TEST_ID,
    );
    expect(loading).toBeInTheDocument();
    // The menu's own place and height (Dropdown's margins, its 40px box).
    for (const className of ["mt-2", "mb-1", "h-10", "w-full", "rounded-lg"]) {
      expect(loading.classList.contains(className)).toBe(true);
    }
    expect(String(loadSpy.mock.calls[0]![0])).toBe(PROJECT_ID);

    await act(async () => {
      resolve(choices());
    });

    expect(
      screen.queryByTestId(AUTO_REMEDIATION_RUNNER_LOADING_TEST_ID),
    ).toBeNull();
    expect(shown()).toBe(GLOBAL_RUNNER_SHOWN);
  });
});

describe("a rule that picked no Runner, where the project uses a Global Runner", () => {
  test("shows the Global Runner, picked, and says OneUptime AI runs no Bash commands there - pick one of your Runners", async () => {
    await renderRunnerField(null);

    expect(shown()).toBe(GLOBAL_RUNNER_SHOWN);
    expect(placeholder()).toBe("");
    expect(REMEDIATION_GLOBAL_RUNNER_PICK_TEXT).toBe(
      "OneUptime AI runs no Bash commands on the Global Runner, which every project shares. Pick one of your Runners to run them.",
    );
    expect(help()).toHaveTextContent(REMEDIATION_GLOBAL_RUNNER_PICK_TEXT);
    // Nothing is wrong with it: a quiet line, never a warning.
    expect(help().querySelector(".text-amber-700")).toBeNull();
    expect(help()).toHaveClass("text-gray-500");
    // A form's line, at the size of a form's descriptions.
    expect(help()).toHaveClass("text-sm");
    expect(
      screen.getByTestId(AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID),
    ).not.toHaveTextContent("AI agent");
    expect(
      screen.getByTestId(AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID),
    ).not.toHaveTextContent(REMEDIATION_NO_RUNNER_PLACEHOLDER);
    noStepWarnings();
    // Picking the Global Runner is how none is picked: nothing to clear.
    expect(clearIndicator()).toBeNull();
    // Showing it changes nothing the form holds.
    expect(changes).toEqual([]);
  });

  test("a project with no Runner of its own: the Global Runner is the one choice, and the line says where to add one, in a new tab", async () => {
    loadSpy.mockResolvedValue(choices({ projectRunners: [] }) as never);

    await renderRunnerField(null);

    expect(shown()).toBe(GLOBAL_RUNNER_SHOWN);
    // One choice to look at, not a box that cannot open.
    expect(isPickerDisabled()).toBe(false);
    expect(openMenu()).toHaveLength(1);
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    expect(REMEDIATION_GLOBAL_RUNNER_ADD_TEMPLATE).toBe(
      "OneUptime AI runs no Bash commands on the Global Runner, which every project shares. Add a Runner under {{location}} to run them.",
    );
    expect(help()).toHaveTextContent(
      "OneUptime AI runs no Bash commands on the Global Runner, which every project shares. Add a Runner under Runbooks › Runners to run them.",
    );

    const link: HTMLElement = within(help()).getByTestId(
      `${AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID}-runners-link`,
    );
    expect(link).toHaveTextContent("Runbooks › Runners");
    expect(link).toHaveAttribute("target", "_blank");
    // Not "No Runner", and not the add-a-Runner line of a rule with none.
    expect(help()).not.toHaveTextContent("for OneUptime AI to run commands on");
    noStepWarnings();
  });

  test("offers the Global Runner first, saying what it is, then the project's own Runners with how each is doing", async () => {
    await renderRunnerField(null);

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent(GLOBAL_RUNNER_SHOWN);
    expect(options[0]).toHaveTextContent(
      REMEDIATION_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
    );
    expect(REMEDIATION_GLOBAL_RUNNER_CHOICE_DESCRIPTION).toBe(
      "Run by OneUptime for every project. OneUptime AI runs no Bash commands on it.",
    );
    expect(options[1]).toHaveTextContent("prod-eu-runner · Connected");
    expect(options[2]).toHaveTextContent("office-runner · Disconnected");
    for (const option of options) {
      expect(option).not.toHaveTextContent("AI agent");
      expect(option).toHaveAttribute("aria-disabled", "false");
    }
  });

  test("picking a Runner stores its id and drops the line; picking the Global Runner again stores none", async () => {
    await renderRunnerField(null);

    fireEvent.click(openMenu()[1]!);

    expect(changes).toEqual([PROD_ID]);
    expect(shown()).toBe("prod-eu-runner · Connected");
    // The field's own line says what the Runner is for: nothing under it.
    noHelp();

    fireEvent.click(openMenu()[0]!);

    // None, as a rule that picked none always stored: never an id, never "global".
    expect(changes).toEqual([PROD_ID, null]);
    expect(shown()).toBe(GLOBAL_RUNNER_SHOWN);
    expect(help()).toHaveTextContent(REMEDIATION_GLOBAL_RUNNER_PICK_TEXT);
  });

  test("the project's default Runner comes first, tagged, then the Global Runner", async () => {
    loadSpy.mockResolvedValue(
      choices({
        projectRunners: [
          ...choices().projectRunners,
          {
            id: HIDDEN_ID,
            name: "default-runner",
            liveStatus: RunnerLiveStatus.Connected,
            isProjectDefault: true,
          },
        ],
      }) as never,
    );

    await renderRunnerField(null);

    // A rule that picked none never follows the default: the Global Runner.
    expect(shown()).toBe(GLOBAL_RUNNER_SHOWN);

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(4);
    expect(options[0]).toHaveTextContent(
      `default-runner · ${PROJECT_DEFAULT_TAG} · Connected`,
    );
    expect(options[1]).toHaveTextContent(GLOBAL_RUNNER_SHOWN);
    expect(options[2]).toHaveTextContent("prod-eu-runner · Connected");

    fireEvent.click(options[0]!);

    // A rule stores the Runner it picks, by its id.
    expect(changes).toEqual([HIDDEN_ID]);
  });

  test("a Global Runner that is not connected is shown so - and nothing of the rule's is said to wait on it", async () => {
    loadSpy.mockResolvedValue(
      choices({
        globalRunners: [globalRunner(RunnerLiveStatus.NeverConnected)],
      }) as never,
    );

    await renderRunnerField(null);

    expect(shown()).toBe(`${GLOBAL_RUNNER_CHOICE_LABEL} · Never connected`);
    expect(help()).toHaveTextContent(REMEDIATION_GLOBAL_RUNNER_PICK_TEXT);
    noStepWarnings();
  });

  test("a reader who may not read the project's Runners is told no Bash command runs there, and nothing of adding one", async () => {
    loadSpy.mockResolvedValue(
      choices({ projectRunners: [], areProjectRunnersUnread: true }) as never,
    );

    await renderRunnerField(null);

    expect(shown()).toBe(GLOBAL_RUNNER_SHOWN);
    expect(REMEDIATION_GLOBAL_RUNNER_TEXT).toBe(
      "OneUptime AI runs no Bash commands on the Global Runner, which every project shares.",
    );
    expect(help()).toHaveTextContent(REMEDIATION_GLOBAL_RUNNER_TEXT);
    expect(help()).not.toHaveTextContent("Add a Runner");
    expect(help()).not.toHaveTextContent("Pick one of your Runners");
  });

  test("a saved rule's Runner, as the form holds it, is shown picked", async () => {
    await renderRunnerField(new ObjectID(PROD_ID));

    expect(shown()).toBe("prod-eu-runner · Connected");
    noHelp();
  });

  test("a Runner the reader is not shown is named as one they cannot see, not as an id or a broken one", async () => {
    await renderRunnerField(HIDDEN_ID);

    expect(shown()).toBe(CODE_HIDDEN_RUNNER_LABEL);
    expect(shown()).not.toContain(HIDDEN_ID);
    expect(help()).toHaveTextContent(REMEDIATION_HIDDEN_RUNNER_HELPER_TEXT);
    expect(help()).toHaveTextContent(
      "This rule picks a Runner you do not have access to. Pick another Runner to change it.",
    );
  });

  test("an older rule that composes commands reads No Runner: it runs them on the Command Runners it names", async () => {
    await renderRunnerField(null, { isGlobalRunnerShown: false });

    expect(placeholder()).toBe(REMEDIATION_NO_RUNNER_PLACEHOLDER);
    expect(shown()).toBe("");
    noHelp();

    const options: Array<HTMLElement> = openMenu();
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(option).not.toHaveTextContent(GLOBAL_RUNNER_CHOICE_LABEL);
    }
  });

  test("reads the choices again when the tab comes back, so a Runner just added can be picked", async () => {
    loadSpy.mockResolvedValue(choices({ projectRunners: [] }) as never);
    await renderRunnerField(null);
    expect(openMenu()).toHaveLength(1);
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    loadSpy.mockResolvedValue(
      choices({
        projectRunners: [
          {
            id: HIDDEN_ID,
            name: "new-runner",
            liveStatus: RunnerLiveStatus.Connected,
          },
        ],
      }) as never,
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(loadSpy).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(help()).toHaveTextContent(REMEDIATION_GLOBAL_RUNNER_PICK_TEXT);
    });
    await waitFor(() => {
      expect(openMenu()).toHaveLength(2);
    });
  });
});

describe("a rule that picked no Runner, with no Global Runner to show", () => {
  for (const [label, overrides] of [
    [
      "in a project that turned global Runners off",
      { projectUsesGlobalRunners: false },
    ],
    ["on a server that runs none", { globalRunners: [] }],
  ] as Array<[string, Partial<RunnerChoices>]>) {
    test(`${label}, reads No Runner, offers the project's own Runners only, and says nothing more`, async () => {
      willLoad(choices(overrides));

      await renderRunnerField(null);

      expect(placeholder()).toBe(REMEDIATION_NO_RUNNER_PLACEHOLDER);
      expect(placeholder()).toBe("No Runner");
      expect(shown()).toBe("");
      noHelp();

      const options: Array<HTMLElement> = openMenu();
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveTextContent("prod-eu-runner · Connected");
      expect(options[1]).toHaveTextContent("office-runner · Disconnected");
      for (const option of options) {
        expect(option).not.toHaveTextContent(GLOBAL_RUNNER_CHOICE_LABEL);
      }
    });

    test(`${label}, a pick can be cleared back to No Runner`, async () => {
      willLoad(choices(overrides));

      await renderRunnerField(OFFICE_ID);

      expect(shown()).toBe("office-runner · Disconnected");

      clearPick();

      expect(handedBack()).toEqual([null]);
      expect(shown()).toBe("");
      expect(placeholder()).toBe(REMEDIATION_NO_RUNNER_PLACEHOLDER);
    });

    test(`${label}, with no Runner of its own, the empty picker says where to add one, in a new tab`, async () => {
      willLoad(choices({ ...overrides, projectRunners: [] }));

      await renderRunnerField(null);

      expect(placeholder()).toBe(REMEDIATION_NO_RUNNER_PLACEHOLDER);
      expect(isPickerDisabled()).toBe(true);
      expect(REMEDIATION_ADD_RUNNER_TEMPLATE).toBe(
        "Add a Runner under {{location}} for OneUptime AI to run commands on, then pick it here.",
      );
      expect(help()).toHaveTextContent(
        "Add a Runner under Runbooks › Runners for OneUptime AI to run commands on, then pick it here.",
      );

      const link: HTMLElement = within(help()).getByTestId(
        `${AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID}-runners-link`,
      );
      expect(link).toHaveTextContent("Runbooks › Runners");
      expect(link).toHaveAttribute("target", "_blank");
      // Nothing is wrong with a rule that has no Runner: no warning box.
      noStepWarnings();
    });
  }

  test("without the choices at all, it still shows the rule's choice: none - and never says to add a Runner the project may have", async () => {
    loadSpy.mockRejectedValue(new Error("offline") as never);

    await renderRunnerField(null);

    expect(placeholder()).toBe(REMEDIATION_NO_RUNNER_PLACEHOLDER);
    noHelp();
    expect(isPickerDisabled()).toBe(true);
  });

  test("a reader who may not read Runners is not told to add one either", async () => {
    loadSpy.mockResolvedValue(
      choices({
        projectRunners: [],
        globalRunners: [],
        areProjectRunnersUnread: true,
      }) as never,
    );

    await renderRunnerField(null);

    expect(placeholder()).toBe(REMEDIATION_NO_RUNNER_PLACEHOLDER);
    noHelp();
  });
});

/*
 * What the loader reads for a rule: the project's own Runners, without the
 * in-cluster Runners the Kubernetes agent chart installed (their names carry
 * the kubernetes-agent marker); the global Runners that run runbook steps,
 * from their own route; and the project's switch for them - each on its
 * own, so one read failing never hides the others.
 */
describe("the choices a rule is offered", () => {
  interface ListCall {
    modelType: unknown;
    query: Record<string, unknown>;
    requestOptions?: { overrideRequestUrl?: unknown } | undefined;
  }

  let listCalls: Array<ListCall> = [];

  function isGlobalRead(call: ListCall): boolean {
    return String(call.requestOptions?.overrideRequestUrl || "").endsWith(
      GLOBAL_RUNNERS_ROUTE,
    );
  }

  function stubReads(options: {
    projectFails?: boolean;
    globalFails?: boolean;
    switchFails?: boolean;
    usesGlobalRunners?: boolean;
  }): void {
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
        const call: ListCall = args as ListCall;
        listCalls.push(call);

        if (isGlobalRead(call)) {
          if (options.globalFails) {
            throw new Error("Not found");
          }

          const data: Array<Runner> = [
            Object.assign(new Runner(), {
              _id: GLOBAL_EU_ID,
              name: "global-eu",
              canRunRunbooks: true,
              lastAlive: new Date(),
            }),
            Object.assign(new Runner(), {
              _id: "bbbbbbbb-0000-4000-8000-000000000002",
              name: "global-paused",
              canRunRunbooks: false,
            }),
          ];
          return {
            data: data as Array<never>,
            count: data.length,
            skip: 0,
            limit: 100,
          };
        }

        if (options.projectFails) {
          throw new Error("forbidden");
        }

        const data: Array<Runner> = [
          Object.assign(new Runner(), {
            _id: PROD_ID,
            name: "prod-eu-runner",
          }),
          Object.assign(new Runner(), {
            _id: OFFICE_ID,
            name: "kubernetes-agent/prod-us",
          }),
        ];
        return {
          data: data as Array<never>,
          count: data.length,
          skip: 0,
          limit: 100,
        };
      });

    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<never> => {
        if (options.switchFails) {
          throw new Error("forbidden");
        }

        return Object.assign(new Project(), {
          useGlobalRunners: options.usesGlobalRunners !== false,
        }) as never;
      });
  }

  beforeEach(() => {
    listCalls = [];
    loadSpy.mockRestore();
  });

  test("are the project's own Runners without the Kubernetes agent's, the global Runners that run steps, and the project's switch", async () => {
    stubReads({ usesGlobalRunners: false });

    const loaded: RunnerChoices = await RunnerChoicesLoader.loadForRemediation(
      new ObjectID(PROJECT_ID),
    );

    expect(
      loaded.projectRunners.map((runner: { name: string }) => {
        return runner.name;
      }),
    ).toEqual(["prod-eu-runner"]);
    // Only the global Runners that take runbook steps stand for the Global Runner.
    expect(
      loaded.globalRunners.map((runner: GlobalRunnerRow) => {
        return [runner.id, runner.liveStatus];
      }),
    ).toEqual([[GLOBAL_EU_ID, RunnerLiveStatus.Connected]]);
    expect(loaded.projectUsesGlobalRunners).toBe(false);
    expect(loaded.areProjectRunnersUnread).toBe(false);

    // Two reads: the project's own Runners, and the global ones from their route.
    expect(listCalls).toHaveLength(2);
    const ownRead: ListCall | undefined = listCalls.find((call: ListCall) => {
      return !isGlobalRead(call);
    });
    expect(String(ownRead?.query["projectId"])).toBe(PROJECT_ID);
    expect(listCalls.filter(isGlobalRead)).toHaveLength(1);
  });

  test("an unreadable list of the project's Runners still leaves the Global Runner, and is not taken for none", async () => {
    stubReads({ projectFails: true });

    const loaded: RunnerChoices = await RunnerChoicesLoader.loadForRemediation(
      new ObjectID(PROJECT_ID),
    );

    expect(loaded.projectRunners).toEqual([]);
    // Not known to have none: the picker does not say to add one.
    expect(loaded.areProjectRunnersUnread).toBe(true);
    expect(loaded.globalRunners).toHaveLength(1);
    expect(loaded.projectUsesGlobalRunners).toBe(true);
  });

  test("a server that cannot list global Runners leaves the project's own, and No Runner", async () => {
    stubReads({ globalFails: true });

    const loaded: RunnerChoices = await RunnerChoicesLoader.loadForRemediation(
      new ObjectID(PROJECT_ID),
    );

    expect(loaded.globalRunners).toEqual([]);
    expect(loaded.projectRunners).toHaveLength(1);
    expect(loaded.areProjectRunnersUnread).toBe(false);
  });

  test("someone who may not read the project's switch is shown what a project starts with: global Runners on", async () => {
    stubReads({ switchFails: true });

    const loaded: RunnerChoices = await RunnerChoicesLoader.loadForRemediation(
      new ObjectID(PROJECT_ID),
    );

    expect(loaded.projectUsesGlobalRunners).toBe(true);
  });
});

describe("Run them every time", () => {
  function EveryTimeHarness(props: { initialValue: unknown }): ReactElement {
    const [value, setValue] = useState<unknown>(props.initialValue);

    return (
      <RunbooksEveryTimeSwitch
        value={value}
        onChange={(remediationAction: AutoRemediationAction) => {
          changes.push(remediationAction);
          setValue(remediationAction);
        }}
      />
    );
  }

  // The switch itself carries the field's test id.
  function toggle(): HTMLElement {
    return screen.getByTestId(AUTO_REMEDIATION_EVERY_TIME_TEST_ID);
  }

  test("says what it does, beside the switch, which is named by it", () => {
    render(
      <EveryTimeHarness initialValue={AutoRemediationAction.OneUptimeAI} />,
    );

    expect(toggle()).toHaveAttribute("role", "switch");
    expect(toggle()).toHaveAccessibleName("Run them every time");
    expect(toggle()).toHaveAccessibleDescription(
      "Start every runbook above for every match, instead of OneUptime AI deciding.",
    );
  });

  test("off is a OneUptime AI rule; on runs its runbooks every time, and back", () => {
    render(
      <EveryTimeHarness initialValue={AutoRemediationAction.OneUptimeAI} />,
    );

    expect(toggle()).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle());
    expect(changes).toEqual([AutoRemediationAction.Runbooks]);
    expect(toggle()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle());
    expect(changes).toEqual([
      AutoRemediationAction.Runbooks,
      AutoRemediationAction.OneUptimeAI,
    ]);
    expect(toggle()).toHaveAttribute("aria-checked", "false");
  });

  test("a rule saved running its runbooks shows the switch on", () => {
    render(<EveryTimeHarness initialValue={AutoRemediationAction.Runbooks} />);

    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });
});

describe("an older rule's note", () => {
  test("says what the rule still does, with one button to make it fix like a new rule", () => {
    const fixLikeANewRule: Array<string> = [];

    render(
      <OlderAutoRemediationRuleNote
        text={AUTO_REMEDIATION_OLDER_RULE_COPY.commandsOnRunners}
        onFixLikeANewRule={(): void => {
          fixLikeANewRule.push("clicked");
        }}
      />,
    );

    const note: HTMLElement = screen.getByTestId(
      AUTO_REMEDIATION_OLDER_RULE_TEST_ID,
    );
    expect(note).toHaveTextContent(
      "This older rule only has OneUptime AI run commands on its Runners.",
    );

    const button: HTMLElement = within(note).getByRole("button", {
      name: "Fix like a new rule",
    });
    // A button of its own, never one that submits the rule's form.
    expect(button).toHaveAttribute("type", "button");

    fireEvent.click(button);
    expect(fixLikeANewRule).toEqual(["clicked"]);
  });
});
