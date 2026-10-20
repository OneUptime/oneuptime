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
  CODE_GLOBAL_RUNNER_HELPER_TEXT,
  CODE_GLOBAL_RUNNER_NOT_CONNECTED_TEXT,
  CODE_OWN_RUNNER_HELPER_TEXT,
  CODE_UNKNOWN_RUNNER_HELPER_TEXT,
  GLOBAL_RUNNER_CHOICE_DESCRIPTION,
  GLOBAL_RUNNER_CHOICE_LABEL,
  RunnerPickerModel,
  RunnerPickerOutcome,
  RunnerPickerWork,
  buildRunnerPickerModel,
  canGlobalRunnersRunWork,
  offersGlobalRunner,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import {
  CODE_REPOSITORY_RUNNER_PICKER_TEST_ID,
  CODE_REPOSITORY_RUNNER_VALUE_TEST_ID,
  CodeRepositoryRunnerCopy,
  CodeRepositoryRunnerPicker,
  CodeRepositoryRunnerValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunner";
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
}): ReactElement {
  const [value, setValue] = useState<string>(props.initialValue);

  return (
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
    />
  );
}

function renderPicker(
  props: { value?: string; choices?: RunnerChoices } = {},
): RenderResult {
  return render(
    <Harness
      initialValue={props.value || ""}
      choices={props.choices || choices()}
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

  test("offers Global Runner first, saying it skips the repository's commands, then the project's own Runners", () => {
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

  test("a Runner the project no longer has is named as unknown, with what it means for the repository", () => {
    renderPicker({ value: GONE_ID });

    expect(shown()).toBe(`Unknown Runner (${GONE_ID})`);
    expect(help()).toHaveTextContent(CODE_UNKNOWN_RUNNER_HELPER_TEXT);
    expect(help()).not.toHaveTextContent("step");
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

    expect(runners).toHaveLength(3);
    expect(listCalls[0]!.select["hostInfo"]).toBeUndefined();
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

  test("the field reads the repository's choices, and stores a Runner's id or nothing for Global Runner", async () => {
    const load: jest.SpiedFunction<
      typeof RunnerChoicesLoader.loadForCodeRepository
    > = loads(choices());
    const picked: Array<string | null> = [];

    function Field(): ReactElement {
      const [value, setValue] = useState<string | null>(STAGING_ID);

      return (
        <CodeRepositoryRunnerPicker
          value={value}
          onChange={(runnerId: string | null): void => {
            picked.push(runnerId);
            setValue(runnerId);
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
    expect(help(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)).toHaveTextContent(
      CODE_OWN_RUNNER_HELPER_TEXT,
    );

    fireEvent.click(openMenu(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)[0]!);

    // Global Runner is stored as no Runner at all.
    expect(picked).toEqual([null]);

    fireEvent.click(openMenu(CODE_REPOSITORY_RUNNER_PICKER_TEST_ID)[1]!);

    expect(picked).toEqual([null, BASTION_ID]);
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

  test("a repository on one of the project's Runners names it, linked to its page, with how it is doing", async () => {
    const shownValue: HTMLElement = await value(
      new ObjectID(BASTION_ID),
      choices(),
    );

    expect(shownValue).toHaveTextContent("prod-bastion · Connected");
    expect(within(shownValue).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/runbooks/runners/${BASTION_ID}`,
    );
  });

  test("a repository that picked none shows Global Runner, with how it is doing", async () => {
    expect(await value(null, choices())).toHaveTextContent(
      `${GLOBAL_RUNNER_CHOICE_LABEL} · Connected`,
    );
  });

  test("a pick the project no longer has, and no Runner at all, are said as they are", async () => {
    expect(await value(GONE_ID, choices())).toHaveTextContent(
      CodeRepositoryRunnerCopy.unknownRunner,
    );
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
