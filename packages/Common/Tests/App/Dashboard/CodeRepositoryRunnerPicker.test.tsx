import "@testing-library/jest-dom";
/*
 * jest itself is the global one: @jest/globals types jest.spyOn() as a mock
 * the global jest.SpiedFunction annotations here do not accept.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
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

import RunnerPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPicker";
import RunnerChoicesLoader, {
  GLOBAL_CODE_RUNNERS_ROUTE,
  RunnerChoices,
  readGlobalCodeRunnerLiveStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import {
  CODE_GLOBAL_RUNNERS_OFF_HELPER_TEXT,
  CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION_BRANCH,
  CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION_MERGE_REQUEST,
  CODE_GLOBAL_RUNNER_HELPER_TEXT,
  CODE_GLOBAL_RUNNER_HELPER_TEXT_BRANCH,
  CODE_GLOBAL_RUNNER_HELPER_TEXT_MERGE_REQUEST,
  CODE_GLOBAL_RUNNER_NOT_CONNECTED_TEXT,
  CODE_HIDDEN_RUNNER_HELPER_TEXT,
  CODE_HIDDEN_RUNNER_LABEL,
  CODE_NO_GLOBAL_RUNNER_HELPER_TEXT,
  CODE_OWN_RUNNER_HELPER_TEXT,
  CODE_OWN_RUNNER_HELPER_TEXT_BRANCH,
  CODE_OWN_RUNNER_HELPER_TEXT_MERGE_REQUEST,
  CODE_PROJECT_DEFAULT_RUNNER_HELPER_TEXT,
  GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  GLOBAL_RUNNER_CHOICE_LABEL,
  GLOBAL_RUNNER_PICK_VALUE,
  RunnerPickerModel,
  RunnerPickerOutcome,
  RunnerPickerWork,
  buildRunnerPickerModel,
  canGlobalRunnersRunWork,
  offersGlobalRunner,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import {
  CODE_REPOSITORY_RUNNER_DEFAULT_TAG_TEST_ID,
  CODE_REPOSITORY_RUNNER_LOADING_TEST_ID,
  CODE_REPOSITORY_RUNNER_PICKER_TEST_ID,
  CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID,
  CODE_REPOSITORY_RUNNER_VALUE_TEST_ID,
  CodeRepositoryRunnerCopy,
  CodeRepositoryRunnerPicker,
  CodeRepositoryRunnerValue,
  CodeRepositoryRunnerValueView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunner";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { PillSize } from "../../../UI/Components/Pill/Pill";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * A CODE REPOSITORY'S RUNNER SETTING, RENDERED.
 *
 * Code -> a repository -> Settings picks the Runner AI works in the
 * repository on, with the one Runner picker: "Global Runner" - the one
 * OneUptime runs for every project - first, and what a repository that
 * picked none shows; then the project's own Runners, which AI clones the
 * repository on and runs its setup, build and test commands on. What it
 * loads (RunnerChoicesLoader.loadForCodeRepository) is read here too: the
 * project's own Runners but the in-cluster ones the Kubernetes agent chart
 * installed, the global Runners for code from their own route, and the
 * project's switch for global Runners. The settings card shows what the
 * repository runs on, with how it is doing.
 */

const PROJECT_ID: string = "dddddddd-0000-4000-8000-000000000002";

const BASTION_ID: string = "aaaaaaaa-0000-4000-8000-000000000011";
const STAGING_ID: string = "aaaaaaaa-0000-4000-8000-000000000012";
const GONE_ID: string = "cccccccc-0000-4000-8000-000000000011";

const PICKER: string = "code-repository-runner";

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
        id: "",
        name: "Global Runner",
        description: "",
        liveStatus: RunnerLiveStatus.Connected,
        runsRunbooks: false,
      },
    ],
    projectUsesGlobalRunners: true,
    ...overrides,
  };
}

let changes: Array<string> = [];

function Harness(props: {
  initialValue: string;
  choices: RunnerChoices;
  isFormField?: boolean | undefined;
}): ReactElement {
  const [value, setValue] = useState<string>(props.initialValue);

  return (
    <>
      {props.isFormField ? (
        <span id="form-runner-label">Runner field</span>
      ) : (
        <></>
      )}
      <RunnerPicker
        work={RunnerPickerWork.CodeRepository}
        stepType=""
        value={value}
        onChange={(next: string) => {
          changes.push(next);
          setValue(next);
        }}
        choices={props.choices}
        ownRunnerHelperText={<>{CODE_OWN_RUNNER_HELPER_TEXT}</>}
        dataTestId={PICKER}
        isFormField={props.isFormField}
        ariaLabelledby={props.isFormField ? "form-runner-label" : undefined}
      />
    </>
  );
}

function renderPicker(
  props: {
    value?: string;
    choices?: RunnerChoices;
    isFormField?: boolean;
  } = {},
): RenderResult {
  return render(
    <Harness
      initialValue={props.value || ""}
      choices={props.choices || choices()}
      isFormField={props.isFormField}
    />,
  );
}

function openMenu(testId: string = PICKER): Array<HTMLElement> {
  fireEvent.keyDown(within(screen.getByTestId(testId)).getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });

  return screen.getAllByRole("option");
}

function help(testId: string = PICKER): HTMLElement {
  return screen.getByTestId(`${testId}-help`);
}

function shown(testId: string = PICKER): string {
  return (
    screen.getByTestId(testId).querySelector(".ou-select__single-value")
      ?.textContent || ""
  );
}

beforeEach(() => {
  changes = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the picker's rules for a repository", () => {
  function model(
    overrides: Partial<RunnerChoices> = {},
    value: string = "",
  ): RunnerPickerModel {
    const loaded: RunnerChoices = choices(overrides);

    return buildRunnerPickerModel({
      work: RunnerPickerWork.CodeRepository,
      stepType: "",
      currentRunnerId: value,
      projectRunners: loaded.projectRunners,
      globalRunners: loaded.globalRunners,
      projectUsesGlobalRunners: loaded.projectUsesGlobalRunners,
    });
  }

  test("global Runners take any repository's work: no step type is asked", () => {
    expect(
      canGlobalRunnersRunWork({
        work: RunnerPickerWork.CodeRepository,
        stepType: "",
      }),
    ).toBe(true);
    expect(
      offersGlobalRunner({
        work: RunnerPickerWork.CodeRepository,
        stepType: "Bash",
        globalRunners: choices().globalRunners,
        projectUsesGlobalRunners: true,
      }),
    ).toBe(true);
    // A Bash step is still never theirs.
    expect(canGlobalRunnersRunWork({ stepType: "Bash" })).toBe(false);
  });

  test("a repository is never told it needs a Runner of its own because of a step type", () => {
    const empty: RunnerPickerModel = model({
      projectRunners: [],
      globalRunners: [],
    });

    expect(empty.outcome).toBe(RunnerPickerOutcome.NoGlobalRunner);
    expect(empty.willRun).toBe(false);
    expect(model({ projectUsesGlobalRunners: false }).outcome).toBe(
      RunnerPickerOutcome.GlobalRunnersOff,
    );
  });

  test("a pick of the project's own Runner wins over the global choice", () => {
    const picked: RunnerPickerModel = model({}, BASTION_ID.toUpperCase());

    expect(picked.outcome).toBe(RunnerPickerOutcome.ProjectRunner);
    expect(picked.selected?.name).toBe("prod-bastion");
    expect(picked.willRun).toBe(true);
  });
});

describe("a repository's Runner picker", () => {
  test("a repository that picked no Runner shows Global Runner, picked, and what it means for AI's work", () => {
    renderPicker();

    expect(shown()).toBe(`${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`);
    expect(help()).toHaveTextContent(CODE_GLOBAL_RUNNER_HELPER_TEXT);
    expect(help()).not.toHaveTextContent("sandbox");
  });

  test("offers Global Runner first, saying it does not build or test AI's change, then the project's own Runners", () => {
    renderPicker();

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent(
      `${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`,
    );
    expect(options[0]).toHaveTextContent(CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION);
    expect(options[0]).not.toHaveTextContent(GLOBAL_RUNNER_CHOICE_DESCRIPTION);
    expect(options[1]).toHaveTextContent("prod-bastion · Connected");
    expect(options[2]).toHaveTextContent("staging-runner · Disconnected");
  });

  test("picking one of the project's Runners stores its ID, and the line under it says what AI does there", () => {
    renderPicker();

    fireEvent.click(openMenu()[1]!);

    expect(changes).toEqual([BASTION_ID]);
    expect(shown()).toBe("prod-bastion · Connected");
    expect(help()).toHaveTextContent(CODE_OWN_RUNNER_HELPER_TEXT);
  });

  test("picking Global Runner again stores no Runner", () => {
    renderPicker({ value: STAGING_ID });

    fireEvent.click(openMenu()[0]!);

    expect(changes).toEqual([""]);
    expect(help()).toHaveTextContent(CODE_GLOBAL_RUNNER_HELPER_TEXT);
  });

  /*
   * A repository can only pick one of its project's Runners, and a deleted
   * one leaves it on Global Runner (SET NULL): a pick the picker was not
   * shown is a Runner the reader may not see - said so, in the value's own
   * colour, never as an id or as a Runner that is gone.
   */
  test("a pick the reader is not shown is a Runner they do not have access to - not an id, not a warning", () => {
    renderPicker({ value: GONE_ID });

    expect(shown()).toBe(CODE_HIDDEN_RUNNER_LABEL);
    expect(shown()).not.toContain(GONE_ID);
    expect(help()).toHaveTextContent(CODE_HIDDEN_RUNNER_HELPER_TEXT);
    expect(help()).not.toHaveTextContent("step");
    expect(help().querySelector(".text-amber-700")).toBeNull();
    expect(help().className).toContain("text-gray-500");
  });

  test("a repository that picked none on a server with no global Runner is told to pick one of its own - not what a picked Runner does", () => {
    renderPicker({ choices: choices({ globalRunners: [] }) });

    expect(shown()).toBe("");
    expect(help()).toHaveTextContent(CODE_NO_GLOBAL_RUNNER_HELPER_TEXT);
    expect(help()).not.toHaveTextContent(CODE_OWN_RUNNER_HELPER_TEXT);
    expect(openMenu()).toHaveLength(2);
  });

  test("a project that turned global Runners off is told to pick one of its own, for this repository", () => {
    renderPicker({ choices: choices({ projectUsesGlobalRunners: false }) });

    expect(openMenu()).toHaveLength(2);
    expect(help()).toHaveTextContent(CODE_GLOBAL_RUNNERS_OFF_HELPER_TEXT);
  });

  test("Global Runner while no global Runner is connected says AI waits for one", () => {
    renderPicker({
      choices: choices({
        globalRunners: [
          {
            id: "",
            name: "Global Runner",
            description: "",
            liveStatus: RunnerLiveStatus.Disconnected,
            runsRunbooks: false,
          },
        ],
      }),
    });

    expect(screen.getByTestId(`${PICKER}-global-waiting`)).toHaveTextContent(
      CODE_GLOBAL_RUNNER_NOT_CONNECTED_TEXT,
    );
  });

  /*
   * In the repository's settings form the picker is a field like the
   * others: the form draws its title and description, the picker no label
   * of its own, and its lines are the form's size, not the step editor's.
   */
  test("as a form field: no label of its own, named by the form's label, and lines at the form's size", () => {
    renderPicker({ isFormField: true });

    const picker: HTMLElement = screen.getByTestId(PICKER);

    expect(picker.querySelector("label")).toBeNull();
    expect(within(picker).getByRole("combobox")).toHaveAttribute(
      "aria-labelledby",
      "form-runner-label",
    );
    expect(help().className).toContain("text-sm");
    expect(help().className).not.toContain("text-xs");
  });

  test("negative control: in a runbook step it keeps its own small label and lines", () => {
    renderPicker();

    const picker: HTMLElement = screen.getByTestId(PICKER);

    expect(picker.querySelector("label")).toHaveTextContent("Runner");
    expect(help().className).toContain("text-xs");
  });

  test("as a form field with no global Runner connected, the waiting line is the form's size too", () => {
    renderPicker({
      isFormField: true,
      choices: choices({
        globalRunners: [
          {
            id: "",
            name: "Global Runner",
            description: "",
            liveStatus: RunnerLiveStatus.Disconnected,
            runsRunbooks: false,
          },
        ],
      }),
    });

    expect(screen.getByTestId(`${PICKER}-global-waiting`).className).toContain(
      "text-sm",
    );
  });

  test("with nothing to pick, it says how AI gets a Runner for this repository", () => {
    renderPicker({
      choices: choices({ projectRunners: [], globalRunners: [] }),
    });

    const box: HTMLElement = screen.getByTestId(`${PICKER}-nothing-to-pick`);

    expect(box).toHaveTextContent(
      "Add a Runner under Runbooks › Runners for AI to work in this repository, then pick it here.",
    );
    expect(within(box).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/runbooks/runners`,
    );
  });
});

describe("what a repository's picker loads", () => {
  interface ListCall {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
  }

  let listCalls: Array<ListCall> = [];

  function runnerRow(data: {
    id: string;
    name: string;
    hostInfo?: JSONObject;
  }): Runner {
    return Object.assign(new Runner(), {
      _id: data.id,
      name: data.name,
      lastAlive: new Date(),
      ...(data.hostInfo ? { hostInfo: data.hostInfo } : {}),
    });
  }

  function stubReads(globalAnswer: HTTPResponse<JSONObject> | Error): void {
    listCalls = [];

    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
        listCalls.push(args as ListCall);

        const data: Array<Runner> = [
          runnerRow({ id: BASTION_ID, name: "prod-bastion" }),
          runnerRow({
            id: "aaaaaaaa-0000-4000-8000-000000000013",
            name: "kubernetes-agent/prod-eu",
          }),
          runnerRow({
            id: "aaaaaaaa-0000-4000-8000-000000000014",
            name: "renamed-in-cluster",
            hostInfo: {
              kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
            },
          }),
        ];

        return {
          data: data as Array<never>,
          count: data.length,
          skip: 0,
          limit: 10,
        };
      });

    jest.spyOn(API, "post").mockImplementation((async () => {
      if (globalAnswer instanceof Error) {
        throw globalAnswer;
      }

      return globalAnswer;
    }) as never);

    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(new Project() as never);
  }

  test("the project's own Runners but the Kubernetes agent's, the global Runners for code by how each is doing, and the switch", async () => {
    stubReads(
      new HTTPResponse<JSONObject>(
        200,
        {
          globalRunners: [
            { liveStatus: RunnerLiveStatus.Disconnected },
            { liveStatus: RunnerLiveStatus.Connected },
          ],
        },
        {},
      ),
    );

    const loaded: RunnerChoices =
      await RunnerChoicesLoader.loadForCodeRepository(new ObjectID(PROJECT_ID));

    expect(
      loaded.projectRunners.map((runner: { name: string }) => {
        return runner.name;
      }),
    ).toEqual(["prod-bastion"]);
    expect(
      loaded.globalRunners.map((runner: { liveStatus: RunnerLiveStatus }) => {
        return runner.liveStatus;
      }),
    ).toEqual([RunnerLiveStatus.Disconnected, RunnerLiveStatus.Connected]);
    expect(loaded.projectUsesGlobalRunners).toBe(true);

    // The posture is read, to leave the agent's Runners out.
    expect(listCalls[0]!.select["hostInfo"]).toBe(true);
    expect(String(listCalls[0]!.query["projectId"])).toBe(PROJECT_ID);

    const post: { mock: { calls: Array<Array<unknown>> } } =
      API.post as unknown as { mock: { calls: Array<Array<unknown>> } };
    const url: string = String(
      (post.mock.calls[0]![0] as { url: unknown }).url,
    );

    expect(GLOBAL_CODE_RUNNERS_ROUTE).toBe("/runner/global-code-runners");
    expect(url.endsWith(GLOBAL_CODE_RUNNERS_ROUTE)).toBe(true);
  });

  test("a server that cannot say leaves the project's own Runners to pick from", async () => {
    for (const answer of [
      new Error("offline"),
      new HTTPErrorResponse(404, { message: "Not found" }, {}),
      new HTTPResponse<JSONObject>(200, { globalRunners: "none" }, {}),
    ]) {
      stubReads(answer as HTTPResponse<JSONObject> | Error);

      const loaded: RunnerChoices =
        await RunnerChoicesLoader.loadForCodeRepository(
          new ObjectID(PROJECT_ID),
        );

      expect(loaded.globalRunners).toEqual([]);
      expect(loaded.projectRunners).toHaveLength(1);

      jest.restoreAllMocks();
    }
  });

  /*
   * Someone who may change a repository's settings but not read Runners (a
   * Settings Member): the project's Runners cannot be read, but the global
   * Runners and the switch still can - the repository is on Global Runner,
   * not on a server that runs none.
   */
  test("a project Runner read that is refused still loads the global Runners and the switch", async () => {
    stubReads(
      new HTTPResponse<JSONObject>(
        200,
        { globalRunners: [{ liveStatus: RunnerLiveStatus.Connected }] },
        {},
      ),
    );
    jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
      throw new Error("You do not have permission to read");
    }) as never);

    const loaded: RunnerChoices =
      await RunnerChoicesLoader.loadForCodeRepository(new ObjectID(PROJECT_ID));

    expect(loaded.projectRunners).toEqual([]);
    expect(loaded.globalRunners).toHaveLength(1);
    expect(loaded.globalRunners[0]!.liveStatus).toBe(
      RunnerLiveStatus.Connected,
    );
    expect(loaded.projectUsesGlobalRunners).toBe(true);
  });

  test("a status the server does not name reads as never connected", () => {
    expect(readGlobalCodeRunnerLiveStatus("connected")).toBe(
      RunnerLiveStatus.Connected,
    );
    expect(readGlobalCodeRunnerLiveStatus("online!")).toBe(
      RunnerLiveStatus.NeverConnected,
    );
    expect(readGlobalCodeRunnerLiveStatus(undefined)).toBe(
      RunnerLiveStatus.NeverConnected,
    );
  });

  test("negative control: a runbook step's picker still lists every Runner of the project", async () => {
    stubReads(new HTTPResponse<JSONObject>(200, { globalRunners: [] }, {}));

    const runners: Array<{ name: string }> =
      await RunnerChoicesLoader.loadProjectRunners(new ObjectID(PROJECT_ID));

    // The in-cluster Runner the Kubernetes agent chart installed included.
    expect(runners).toHaveLength(3);
    /*
     * Read with what decides which of them may be the project's default
     * Runner - the posture among it - for a step's picker as for a
     * repository's.
     */
    expect(listCalls[0]!.select["isProjectDefault"]).toBe(true);
    expect(listCalls[0]!.select["hostInfo"]).toBe(true);
  });
});

describe("the Settings page's Runner field and value", () => {
  function loads(
    loaded: RunnerChoices,
  ): jest.SpiedFunction<typeof RunnerChoicesLoader.loadForCodeRepository> {
    return jest
      .spyOn(RunnerChoicesLoader, "loadForCodeRepository")
      .mockResolvedValue(loaded);
  }

  test("the field reads the repository's choices, and holds a Runner's id or none for Global Runner", async () => {
    const load: jest.SpiedFunction<
      typeof RunnerChoicesLoader.loadForCodeRepository
    > = loads(choices());
    const picked: Array<string> = [];

    function Field(): ReactElement {
      const [value, setValue] = useState<string>(STAGING_ID);

      return (
        <CodeRepositoryRunnerPicker
          value={value}
          onChange={(choice: string): void => {
            picked.push(choice);
            setValue(choice);
          }}
        />
      );
    }

    render(<Field />);

    await waitFor(() => {
      expect(
        screen.getByTestId(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID),
      ).toBeInTheDocument();
    });

    expect(String(load.mock.calls[0]![0])).toBe(PROJECT_ID);
    expect(shown(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)).toBe(
      "staging-runner · Disconnected",
    );
    // A field of the form: the form draws its label.
    expect(
      screen
        .getByTestId(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)
        .querySelector("label"),
    ).toBeNull();
    expect(help(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)).toHaveTextContent(
      CODE_OWN_RUNNER_HELPER_TEXT,
    );

    fireEvent.click(openMenu(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)[0]!);

    /*
     * Global Runner, with no default Runner in the project, is no Runner at
     * all - the choice "" (CodeRepositoryRunnerChoice), which follows a
     * default the project makes later.
     */
    expect(picked).toEqual([""]);

    fireEvent.click(openMenu(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)[1]!);

    expect(picked).toEqual(["", BASTION_ID]);
  });

  test("beside the project's default Runner, the field holds none for the default and the Global Runner's own pick", async () => {
    loads(
      choices({
        projectRunners: [
          {
            id: BASTION_ID,
            name: "prod-bastion",
            liveStatus: RunnerLiveStatus.Connected,
            isProjectDefault: true,
          },
          {
            id: STAGING_ID,
            name: "staging-runner",
            liveStatus: RunnerLiveStatus.Disconnected,
          },
        ],
      }),
    );
    const picked: Array<string> = [];

    function Field(): ReactElement {
      const [value, setValue] = useState<string>("");

      return (
        <CodeRepositoryRunnerPicker
          value={value}
          onChange={(choice: string): void => {
            picked.push(choice);
            setValue(choice);
          }}
        />
      );
    }

    render(<Field />);

    await waitFor(() => {
      expect(
        screen.getByTestId(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID),
      ).toBeInTheDocument();
    });

    // Picked none: the default, by name and tagged, which it follows.
    expect(shown(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)).toBe(
      "prod-bastion · Project default · Connected",
    );
    expect(help(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)).toHaveTextContent(
      CODE_PROJECT_DEFAULT_RUNNER_HELPER_TEXT,
    );

    const options: Array<HTMLElement> = openMenu(
      CODE_REPOSITORY_RUNNER_PICKER_TEST_ID,
    );

    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual([
      "prod-bastion · Project default · Connected",
      expect.stringContaining("Global Runner · Connected"),
      "staging-runner · Disconnected",
    ]);

    fireEvent.click(options[1]!);
    expect(picked).toEqual([GLOBAL_RUNNER_PICK_VALUE]);
    expect(help(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)).toHaveTextContent(
      CODE_GLOBAL_RUNNER_HELPER_TEXT,
    );

    fireEvent.click(openMenu(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)[0]!);
    expect(picked).toEqual([GLOBAL_RUNNER_PICK_VALUE, ""]);
  });

  test("the words for a repository that follows the default say it moves with it", () => {
    expect(CODE_PROJECT_DEFAULT_RUNNER_HELPER_TEXT).toBe(
      "AI works on the project's default Runner, and moves with it when another Runner becomes the default. It builds and tests its change there the way the repository's AGENTS.md says.",
    );
  });

  test("the field reads the choices again when the person comes back to the tab", async () => {
    const load: jest.SpiedFunction<
      typeof RunnerChoicesLoader.loadForCodeRepository
    > = loads(choices());

    render(<CodeRepositoryRunnerPicker value={null} onChange={() => {}} />);

    await waitFor(() => {
      expect(load).toHaveBeenCalled();
    });

    const before: number = load.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(load.mock.calls.length).toBeGreaterThan(before);
    });
  });

  async function value(
    runnerId: unknown,
    loaded: RunnerChoices,
  ): Promise<HTMLElement> {
    loads(loaded);

    render(<CodeRepositoryRunnerValue runnerId={runnerId} />);

    return await screen.findByTestId(CODE_REPOSITORY_RUNNER_VALUE_TEST_ID);
  }

  // What the status dot says, as a screen reader reads it.
  function statusOf(element: HTMLElement): string {
    return within(element).getByRole("status").getAttribute("aria-label") || "";
  }

  test("a repository on one of the project's Runners names it, linked to its page, with how it is doing as the Runners page draws it", async () => {
    const shownValue: HTMLElement = await value(
      new ObjectID(BASTION_ID),
      choices(),
    );

    const link: HTMLElement = within(shownValue).getByRole("link");

    expect(link).toHaveTextContent("prod-bastion");
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/runbooks/runners/${BASTION_ID}`,
    );
    expect(statusOf(shownValue)).toBe("Status: Connected");
    // A settings value: the connected dot stays still.
    expect(shownValue.querySelector(".motion-safe\\:animate-ping")).toBeNull();
  });

  test("a disconnected Runner is said so, beside its name", async () => {
    const shownValue: HTMLElement = await value(STAGING_ID, choices());

    expect(within(shownValue).getByRole("link")).toHaveTextContent(
      "staging-runner",
    );
    expect(statusOf(shownValue)).toBe("Status: Disconnected");
  });

  test("a repository that picked none shows Global Runner, with how it is doing", async () => {
    const shownValue: HTMLElement = await value(null, choices());

    expect(shownValue).toHaveTextContent(GLOBAL_RUNNER_CHOICE_LABEL);
    expect(within(shownValue).queryByRole("link")).toBeNull();
    expect(statusOf(shownValue)).toBe("Status: Connected");
  });

  /*
   * A repository that picks none follows the project's default Runner: the
   * card names it, linked to its page, tagged as the default, with how it
   * is doing - and no line about a Runner that does not build or test.
   */
  test("a repository that picked none, in a project with a default Runner, names the default - linked, tagged, with its status", async () => {
    const withDefault: RunnerChoices = choices({
      projectRunners: [
        {
          id: BASTION_ID,
          name: "prod-bastion",
          liveStatus: RunnerLiveStatus.Disconnected,
          isProjectDefault: true,
        },
      ],
    });

    const shownValue: HTMLElement = await value(null, withDefault);
    const link: HTMLElement = within(shownValue).getByRole("link");

    expect(link).toHaveTextContent("prod-bastion");
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/runbooks/runners/${BASTION_ID}`,
    );
    expect(
      within(shownValue).getByTestId(
        CODE_REPOSITORY_RUNNER_DEFAULT_TAG_TEST_ID,
      ),
    ).toHaveTextContent("Project default");
    expect(statusOf(shownValue)).toBe("Status: Disconnected");
    expect(
      within(shownValue).queryByTestId(CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID),
    ).toBeNull();
  });

  /*
   * "Project default" is the tag Runbooks -> Runners draws beside the
   * default's name - a small green pill - not loose grey words between the
   * name and its status.
   */
  test("the default's tag is the pill the Runners list draws beside the default's name", async () => {
    const shownValue: HTMLElement = await value(
      null,
      choices({
        projectRunners: [
          {
            id: BASTION_ID,
            name: "prod-bastion",
            liveStatus: RunnerLiveStatus.Connected,
            isProjectDefault: true,
          },
        ],
      }),
    );

    const tag: HTMLElement = within(shownValue).getByTestId(
      CODE_REPOSITORY_RUNNER_DEFAULT_TAG_TEST_ID,
    );
    const pill: HTMLElement = within(tag).getByTestId("pill");

    expect(pill).toHaveTextContent("Project default");
    // The Runners list's: Small, and toned (not the minimal outline).
    expect(pill.style.fontSize).toBe(PillSize.Small.toString());
    expect(pill).toHaveAttribute("data-ou-pill", "");
    expect(tag.className).not.toContain("text-gray-500");
    // Beside the name, before the status.
    const link: HTMLElement = within(shownValue).getByRole("link");
    expect(
      link.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      tag.compareDocumentPosition(within(shownValue).getByRole("status")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a repository that picked the Global Runner beside a default shows Global Runner, not the default", async () => {
    loads(
      choices({
        projectRunners: [
          {
            id: BASTION_ID,
            name: "prod-bastion",
            liveStatus: RunnerLiveStatus.Connected,
            isProjectDefault: true,
          },
        ],
      }),
    );

    render(
      <CodeRepositoryRunnerValue runnerId={null} isGlobalRunnerPicked={true} />,
    );

    const shownValue: HTMLElement = await screen.findByTestId(
      CODE_REPOSITORY_RUNNER_VALUE_TEST_ID,
    );

    expect(shownValue).toHaveTextContent(GLOBAL_RUNNER_CHOICE_LABEL);
    expect(shownValue).not.toHaveTextContent("prod-bastion");
    expect(within(shownValue).queryByRole("link")).toBeNull();
    expect(
      within(shownValue).getByTestId(CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID),
    ).toHaveTextContent(CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION);
  });

  /*
   * Global Runner runs no command: AI's change is not built or tested
   * before its pull request opens - what a Runner of the project's own
   * does, the way the repository's AGENTS.md says. The value says so under
   * "Global Runner" on every repository on it, commands set or not.
   */
  test("on Global Runner, the value says it does not build or test AI's change", async () => {
    const shownValue: HTMLElement = await value(null, choices());

    expect(
      within(shownValue).getByTestId(CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID),
    ).toHaveTextContent(CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION);
    expect(CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION).toBe(
      "Run by OneUptime for every project. It does not build or test AI's change before the pull request opens.",
    );
  });

  test("negative controls: one of the project's own Runners, or no global Runner at all, and nothing is said about it", async () => {
    await value(BASTION_ID, choices());
    expect(
      screen.queryByTestId(CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID),
    ).toBeNull();
    cleanup();

    // No global Runner to run on: the value says that, not what one does.
    await value(null, choices({ projectUsesGlobalRunners: false }));
    expect(
      screen.queryByTestId(CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID),
    ).toBeNull();
  });

  test("the picker's words for a repository speak of the repository's AGENTS.md, never of commands typed into OneUptime", () => {
    expect(CODE_OWN_RUNNER_HELPER_TEXT).toBe(
      "AI clones the repository on this Runner, builds and tests its change there the way the repository's AGENTS.md says, and opens the pull request.",
    );
    expect(CODE_GLOBAL_RUNNER_HELPER_TEXT).toBe(
      "AI works on a Runner OneUptime runs for every project, which does not build or test its change. Pick one of your Runners to have AI build and test it before the pull request opens.",
    );

    for (const words of [
      CODE_OWN_RUNNER_HELPER_TEXT,
      CODE_GLOBAL_RUNNER_HELPER_TEXT,
      CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
    ]) {
      expect(words).not.toContain("your setup, build and test commands");
      // Nor a promise about CI a repository may not have.
      expect(words).not.toContain("CI");
    }
  });

  test("while the choices are on their way, a line's room - not the page loader", async () => {
    jest
      .spyOn(RunnerChoicesLoader, "loadForCodeRepository")
      .mockImplementation(() => {
        return new Promise<RunnerChoices>(() => {});
      });

    render(<CodeRepositoryRunnerValue runnerId={null} />);

    const loading: HTMLElement = screen.getByTestId(
      CODE_REPOSITORY_RUNNER_LOADING_TEST_ID,
    );

    expect(loading.className).toContain("h-4");
    expect(screen.queryByTestId("component-loader")).toBeNull();
    expect(
      screen.queryByTestId(CODE_REPOSITORY_RUNNER_VALUE_TEST_ID),
    ).toBeNull();
  });

  /*
   * The Settings page reads the choices once - for the Runner card and for
   * what its folded More settings says of the Runner - and draws the value
   * from them (CodeRepositoryRunnerValueView): it reads nothing itself,
   * holds a line's room while the page's read is on its way, and says what
   * the self-reading value says once it is in.
   */
  test("the value drawn from the page's choices reads none itself, and says the same", async () => {
    const load: jest.SpiedFunction<
      typeof RunnerChoicesLoader.loadForCodeRepository
    > = jest.spyOn(RunnerChoicesLoader, "loadForCodeRepository");

    const view: RenderResult = render(
      <CodeRepositoryRunnerValueView runnerId={STAGING_ID} choices={null} />,
    );

    expect(
      screen.getByTestId(CODE_REPOSITORY_RUNNER_LOADING_TEST_ID).className,
    ).toContain("h-4");
    expect(
      screen.queryByTestId(CODE_REPOSITORY_RUNNER_VALUE_TEST_ID),
    ).toBeNull();

    view.rerender(
      <CodeRepositoryRunnerValueView
        runnerId={STAGING_ID}
        choices={choices()}
      />,
    );

    const shownValue: HTMLElement = screen.getByTestId(
      CODE_REPOSITORY_RUNNER_VALUE_TEST_ID,
    );
    expect(within(shownValue).getByRole("link")).toHaveTextContent(
      "staging-runner",
    );
    expect(statusOf(shownValue)).toBe("Status: Disconnected");
    expect(
      screen.queryByTestId(CODE_REPOSITORY_RUNNER_LOADING_TEST_ID),
    ).toBeNull();
    expect(load).not.toHaveBeenCalled();

    // What the self-reading value draws for the same choices, word for word.
    const drawnByView: string = shownValue.textContent || "";
    cleanup();
    const selfRead: HTMLElement = await value(STAGING_ID, choices());
    expect(selfRead.textContent).toBe(drawnByView);
  });

  /*
   * A GitLab repository's Merge Requests card says merge request, as GitLab
   * does; its Runner lines say it too. On a Git server AI opens no request
   * at all - it pushes a branch - and the lines say that.
   */
  test("on GitLab, the Global Runner's line says merge request; on a Git server, the pushed branch", async () => {
    loads(choices());
    render(
      <CodeRepositoryRunnerValue
        runnerId={null}
        provider={CodeRepositoryType.GitLab}
      />,
    );
    expect(
      await screen.findByTestId(CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID),
    ).toHaveTextContent(CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION_MERGE_REQUEST);
    expect(CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION_MERGE_REQUEST).toBe(
      "Run by OneUptime for every project. It does not build or test AI's change before the merge request opens.",
    );
    cleanup();

    loads(choices());
    render(
      <CodeRepositoryRunnerValue
        runnerId={null}
        provider={CodeRepositoryType.Git}
      />,
    );
    expect(
      await screen.findByTestId(CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID),
    ).toHaveTextContent(CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION_BRANCH);
    expect(CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION_BRANCH).toBe(
      "Run by OneUptime for every project. It does not build or test AI's change before the branch is pushed.",
    );
    cleanup();

    // Negative control: GitHub, and a host not read yet, say pull request.
    for (const provider of [CodeRepositoryType.GitHub, undefined]) {
      loads(choices());
      render(<CodeRepositoryRunnerValue runnerId={null} provider={provider} />);
      expect(
        await screen.findByTestId(CODE_REPOSITORY_RUNNER_SKIPS_TEST_ID),
      ).toHaveTextContent(CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION);
      cleanup();
    }
  });

  test("the field's menu and lines speak the host's word: merge request on GitLab, the branch on a Git server", async () => {
    function field(
      provider: CodeRepositoryType | undefined,
      initial: string,
    ): void {
      loads(choices());

      function Field(): ReactElement {
        const [current, setCurrent] = useState<string>(initial);

        return (
          <CodeRepositoryRunnerPicker
            value={current}
            provider={provider}
            onChange={(choice: string): void => {
              setCurrent(choice);
            }}
          />
        );
      }

      render(<Field />);
    }

    const cases: Array<{
      provider: CodeRepositoryType | undefined;
      globalDescription: string;
      globalHelp: string;
      ownHelp: string;
    }> = [
      {
        provider: CodeRepositoryType.GitLab,
        globalDescription: CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION_MERGE_REQUEST,
        globalHelp: CODE_GLOBAL_RUNNER_HELPER_TEXT_MERGE_REQUEST,
        ownHelp: CODE_OWN_RUNNER_HELPER_TEXT_MERGE_REQUEST,
      },
      {
        provider: CodeRepositoryType.Git,
        globalDescription: CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION_BRANCH,
        globalHelp: CODE_GLOBAL_RUNNER_HELPER_TEXT_BRANCH,
        ownHelp: CODE_OWN_RUNNER_HELPER_TEXT_BRANCH,
      },
      {
        provider: CodeRepositoryType.Forgejo,
        globalDescription: CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
        globalHelp: CODE_GLOBAL_RUNNER_HELPER_TEXT,
        ownHelp: CODE_OWN_RUNNER_HELPER_TEXT,
      },
      {
        provider: undefined,
        globalDescription: CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION,
        globalHelp: CODE_GLOBAL_RUNNER_HELPER_TEXT,
        ownHelp: CODE_OWN_RUNNER_HELPER_TEXT,
      },
    ];

    for (const each of cases) {
      // On the Global Runner: its line under the picker and in the menu.
      field(each.provider, "");
      await screen.findByTestId(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID);
      expect(help(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID).textContent).toBe(
        each.globalHelp,
      );
      const options: Array<HTMLElement> = openMenu(
        CODE_REPOSITORY_RUNNER_PICKER_TEST_ID,
      );
      expect(options[0]).toHaveTextContent(each.globalDescription);
      cleanup();

      // On one of the project's own Runners.
      field(each.provider, BASTION_ID);
      await screen.findByTestId(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID);
      expect(help(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID).textContent).toBe(
        each.ownHelp,
      );
      cleanup();
    }
  });

  test("the field holds a menu's room while its choices are on their way", () => {
    jest
      .spyOn(RunnerChoicesLoader, "loadForCodeRepository")
      .mockImplementation(() => {
        return new Promise<RunnerChoices>(() => {});
      });

    render(<CodeRepositoryRunnerPicker value={null} onChange={() => {}} />);

    expect(
      screen.getByTestId(CODE_REPOSITORY_RUNNER_LOADING_TEST_ID).className,
    ).toContain("h-10");
    expect(screen.queryByTestId("component-loader")).toBeNull();
  });

  test("a pick the reader is not shown, and no Runner at all, are said as they are", async () => {
    const hidden: HTMLElement = await value(GONE_ID, choices());

    expect(hidden).toHaveTextContent(CodeRepositoryRunnerCopy.hiddenRunner);
    expect(CodeRepositoryRunnerCopy.hiddenRunner).toBe(
      "A Runner you do not have access to",
    );
    // Nothing is wrong with it: no warning colour, no id.
    expect(hidden.className).not.toContain("amber");
    expect(hidden).not.toHaveTextContent(GONE_ID);
    cleanup();

    expect(
      await value(null, choices({ projectUsesGlobalRunners: false })),
    ).toHaveTextContent(CodeRepositoryRunnerCopy.noneGlobalRunnersOff);
    cleanup();

    expect(await value(null, choices({ globalRunners: [] }))).toHaveTextContent(
      CodeRepositoryRunnerCopy.noneNoGlobalRunner,
    );
  });
});
