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
  RunnerChoices,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import {
  CODE_HIDDEN_RUNNER_LABEL,
  GLOBAL_RUNNER_CHOICE_LABEL,
  REMEDIATION_HIDDEN_RUNNER_HELPER_TEXT,
  REMEDIATION_NO_RUNNER_CHOICE_DESCRIPTION,
  REMEDIATION_ADD_RUNNER_TEMPLATE,
  REMEDIATION_NO_RUNNER_CHOICE_LABEL,
  REMEDIATION_OWN_RUNNER_HELPER_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import Runner from "../../../Models/DatabaseModels/Runner";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * AN AUTO REMEDIATION RULE'S MORE FIELDS, RENDERED.
 *
 * Runner: the Runner OneUptime AI runs the rule's commands of its own on,
 * picked with the one Runner picker. Its first choice is no Runner - "AI
 * agent on the cluster or host" - never "Global Runner": a global Runner
 * never runs OneUptime AI's commands. The project's own Runners follow,
 * never the in-cluster ones the Kubernetes agent chart installed. Picking
 * one is what lets OneUptime AI run commands on it.
 *
 * Under the picker, a line only where it says something the choice does
 * not: what OneUptime AI may do on a Runner picked, that the reader may not
 * see the Runner a rule picks - and, in a project with no Runner of its
 * own, where one is added. With Runners to pick from, a rule that picks
 * none needs no line: its choice and the field's own line say it.
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

function choices(): RunnerChoices {
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
    globalRunners: [],
    projectUsesGlobalRunners: true,
  };
}

let changes: Array<string | null> = [];

// The form holds the rule's Runner and hands it back, as the field is used.
function RunnerHarness(props: { initialValue: unknown }): ReactElement {
  const [value, setValue] = useState<unknown>(props.initialValue);

  return (
    <AutoRemediationRunnerPicker
      value={value}
      onChange={(runnerId: string | null) => {
        changes.push(runnerId);
        setValue(runnerId);
      }}
    />
  );
}

async function renderRunnerField(initialValue: unknown): Promise<void> {
  render(<RunnerHarness initialValue={initialValue} />);
  await within(
    await screen.findByTestId(AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID),
  ).findByRole("combobox");
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

function help(): HTMLElement {
  return screen.getByTestId(`${AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID}-help`);
}

function noHelp(): void {
  expect(
    screen.queryByTestId(`${AUTO_REMEDIATION_RUNNER_PICKER_TEST_ID}-help`),
  ).toBeNull();
}

let loadSpy: ReturnType<typeof jest.spyOn>;

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

    expect(
      screen.getByTestId(AUTO_REMEDIATION_RUNNER_LOADING_TEST_ID),
    ).toBeInTheDocument();
    expect(String(loadSpy.mock.calls[0]![0])).toBe(PROJECT_ID);

    await act(async () => {
      resolve(choices());
    });

    expect(
      screen.queryByTestId(AUTO_REMEDIATION_RUNNER_LOADING_TEST_ID),
    ).toBeNull();
    expect(shown()).toBe(REMEDIATION_NO_RUNNER_CHOICE_LABEL);
  });

  test("a rule that picked none shows the AI agent, picked, with no line repeating what the choice says", async () => {
    await renderRunnerField(null);

    expect(shown()).toBe("AI agent on the cluster or host");
    noHelp();
  });

  test("a project with no Runner of its own is told where to add one, opened in a new tab", async () => {
    loadSpy.mockResolvedValue({
      ...choices(),
      projectRunners: [],
    } as never);

    await renderRunnerField(null);

    expect(shown()).toBe(REMEDIATION_NO_RUNNER_CHOICE_LABEL);
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
  });

  test("offers the AI agent first, never Global Runner, then the project's own Runners with how each is doing", async () => {
    await renderRunnerField(null);

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent(REMEDIATION_NO_RUNNER_CHOICE_LABEL);
    expect(options[0]).toHaveTextContent(
      REMEDIATION_NO_RUNNER_CHOICE_DESCRIPTION,
    );
    expect(options[1]).toHaveTextContent("prod-eu-runner · Connected");
    expect(options[2]).toHaveTextContent("office-runner · Disconnected");
    for (const option of options) {
      expect(option).not.toHaveTextContent(GLOBAL_RUNNER_CHOICE_LABEL);
    }
  });

  test("picking a Runner stores its id, and the line under it says what OneUptime AI may do there", async () => {
    await renderRunnerField(null);

    fireEvent.click(openMenu()[1]!);

    expect(changes).toEqual([PROD_ID]);
    expect(shown()).toBe("prod-eu-runner · Connected");
    expect(help()).toHaveTextContent(
      "OneUptime AI may also run Bash and SSH commands on this Runner, inside your network.",
    );
    expect(help()).toHaveTextContent(REMEDIATION_OWN_RUNNER_HELPER_TEXT);
  });

  test("picking the AI agent again stores no Runner", async () => {
    await renderRunnerField(OFFICE_ID);

    expect(shown()).toBe("office-runner · Disconnected");

    fireEvent.click(openMenu()[0]!);

    expect(changes).toEqual([null]);
    expect(shown()).toBe(REMEDIATION_NO_RUNNER_CHOICE_LABEL);
  });

  test("a saved rule's Runner, as the form holds it, is shown picked", async () => {
    await renderRunnerField(new ObjectID(PROD_ID));

    expect(shown()).toBe("prod-eu-runner · Connected");
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

  test("without the Runners, it still shows the rule's choice: none - and never says to add a Runner the project may have", async () => {
    loadSpy.mockRejectedValue(new Error("offline") as never);

    await renderRunnerField(null);

    expect(shown()).toBe(REMEDIATION_NO_RUNNER_CHOICE_LABEL);
    noHelp();
    expect(openMenu()).toHaveLength(1);
  });

  test("a reader who may not read Runners is not told to add one either", async () => {
    loadSpy.mockResolvedValue({
      ...choices(),
      projectRunners: [],
      areProjectRunnersUnread: true,
    } as never);

    await renderRunnerField(null);

    expect(shown()).toBe(REMEDIATION_NO_RUNNER_CHOICE_LABEL);
    noHelp();
  });

  test("reads the choices again when the tab comes back, so a Runner just added can be picked", async () => {
    await renderRunnerField(null);
    expect(openMenu()).toHaveLength(3);

    loadSpy.mockResolvedValue({
      ...choices(),
      projectRunners: [
        ...choices().projectRunners,
        {
          id: HIDDEN_ID,
          name: "new-runner",
          liveStatus: RunnerLiveStatus.Connected,
        },
      ],
    } as never);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(loadSpy).toHaveBeenCalledTimes(2);
    });
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    await waitFor(() => {
      expect(openMenu()).toHaveLength(4);
    });
  });
});

/*
 * What the loader reads for a rule: the project's own Runners, without the
 * in-cluster Runners the Kubernetes agent chart installed (their names carry
 * the kubernetes-agent marker), and never the global Runners.
 */
describe("the choices a rule is offered", () => {
  test("are the project's own Runners, without the Kubernetes agent's, and no global one", async () => {
    loadSpy.mockRestore();
    const getList: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (): Promise<ListResult<Runner>> => {
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
        return { data, count: data.length, skip: 0, limit: 100 };
      });

    const loaded: RunnerChoices = await RunnerChoicesLoader.loadForRemediation(
      new ObjectID(PROJECT_ID),
    );

    expect(
      loaded.projectRunners.map((runner: { name: string }) => {
        return runner.name;
      }),
    ).toEqual(["prod-eu-runner"]);
    expect(loaded.globalRunners).toEqual([]);
    expect(loaded.areProjectRunnersUnread).toBe(false);
    // One read, of the project's Runners: never the global Runners' route.
    expect(getList).toHaveBeenCalledTimes(1);
    expect(
      String(
        (
          getList.mock.calls[0]![0] as {
            requestOptions?: { overrideRequestUrl?: unknown };
          }
        ).requestOptions?.overrideRequestUrl || "",
      ),
    ).not.toContain("global-runners");
  });

  test("an unreadable list leaves the rule with no Runner to offer, not an error", async () => {
    loadSpy.mockRestore();
    jest
      .spyOn(ModelAPI, "getList")
      .mockRejectedValue(new Error("forbidden") as never);

    const loaded: RunnerChoices = await RunnerChoicesLoader.loadForRemediation(
      new ObjectID(PROJECT_ID),
    );

    expect(loaded.projectRunners).toEqual([]);
    expect(loaded.globalRunners).toEqual([]);
    // Not known to have none: the picker does not say to add one.
    expect(loaded.areProjectRunnersUnread).toBe(true);
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
