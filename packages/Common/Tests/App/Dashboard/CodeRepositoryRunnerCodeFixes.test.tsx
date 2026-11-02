import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import fs from "fs";
import path from "path";

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
import {
  CODE_GLOBAL_RUNNER_NOT_CONNECTED_TEXT,
  CODE_NO_CODE_FIX_GLOBAL_RUNNER_HELPER_TEXT,
  CODE_NO_GLOBAL_RUNNER_HELPER_TEXT,
  CODE_OWN_RUNNER_HELPER_TEXT,
  CODE_PROJECT_DEFAULT_RUNNER_HELPER_TEXT,
  CODE_RUNNER_TAKES_NO_CODE_FIXES_OPTION_TEXT,
  CODE_RUNNER_TAKES_NO_CODE_FIXES_TEXT,
  RunnerPickerModel,
  RunnerPickerOption,
  RunnerPickerOutcome,
  RunnerPickerWork,
  buildRunnerPickerModel,
  getRunnerTakingNoCodeFixes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import {
  CODE_REPOSITORY_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID,
  CODE_REPOSITORY_RUNNER_VALUE_TEST_ID,
  CodeRepositoryRunnerCopy,
  CodeRepositoryRunnerValueView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunner";
import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * A CODE REPOSITORY'S RUNNER, WHEN WHAT IT WORKS ON TAKES NO AI CODE FIXES.
 *
 * A Runner says on every heartbeat whether it takes OneUptime AI's code
 * fixes (Common/Types/Runner/RunnerCodeFixes): a global Runner of a release
 * from before global Runners took them does not, nor does any Runner whose
 * host turned them off (ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false). Code's
 * gate and the queue sweeper count only the ones that do, so the
 * repository's Runner setting does too:
 *
 *   - the picker counts only the global Runners that take code fixes - never
 *     "Global Runner · Connected" while only ones that take none are - and a
 *     server whose global Runners all take none says that, not that it runs
 *     none;
 *   - one of the project's own Runners whose host turned them off says so
 *     in the menu, under the picker and on the settings card, with the
 *     setting and the way out - in place of what AI would do there.
 *
 * A runbook step's picker is untouched: a global Runner that takes no code
 * fixes still runs JavaScript steps.
 */

const PROJECT_ID: string = "dddddddd-0000-4000-8000-000000000003";
const BASTION_ID: string = "aaaaaaaa-0000-4000-8000-000000000031";
const OFFICE_ID: string = "aaaaaaaa-0000-4000-8000-000000000032";
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
        id: OFFICE_ID,
        name: "office-runner",
        liveStatus: RunnerLiveStatus.Connected,
        takesNoCodeFixes: true,
      },
    ],
    globalRunners: [
      {
        id: "00000000-0000-0000-0000-000000000002",
        name: "Global Runner",
        description: "",
        liveStatus: RunnerLiveStatus.Connected,
        runsRunbooks: true,
        takesCodeFixes: true,
      },
    ],
    projectUsesGlobalRunners: true,
    ...overrides,
  };
}

function renderPicker(data: {
  value: string;
  choices: RunnerChoices;
  work?: RunnerPickerWork;
}): RenderResult {
  return render(
    <RunnerPicker
      work={data.work || RunnerPickerWork.CodeRepository}
      stepType={data.work === RunnerPickerWork.RunbookStep ? "Bash" : ""}
      value={data.value}
      onChange={(): void => {}}
      choices={data.choices}
      ownRunnerHelperText={<>{CODE_OWN_RUNNER_HELPER_TEXT}</>}
      dataTestId={PICKER}
    />,
  );
}

function openMenu(): Array<HTMLElement> {
  fireEvent.keyDown(within(screen.getByTestId(PICKER)).getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });

  return screen.getAllByRole("option");
}

function help(): HTMLElement {
  return screen.getByTestId(`${PICKER}-help`);
}

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what a repository's picker loads about code fixes", () => {
  interface ListCall {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    requestOptions?: { overrideRequestUrl?: unknown } | undefined;
  }

  let projectCalls: Array<ListCall> = [];
  let globalCalls: Array<ListCall> = [];

  function runner(data: {
    id: string;
    name: string;
    takesCodeFixes?: boolean | undefined;
    canRunRunbooks?: boolean | undefined;
  }): Runner {
    return Object.assign(new Runner(), {
      _id: data.id,
      name: data.name,
      lastAlive: new Date(),
      ...(data.takesCodeFixes === undefined
        ? {}
        : { takesCodeFixes: data.takesCodeFixes }),
      ...(data.canRunRunbooks === undefined
        ? {}
        : { canRunRunbooks: data.canRunRunbooks }),
    });
  }

  function asList(data: Array<Runner>): ListResult<never> {
    return {
      data: data as Array<never>,
      count: data.length,
      skip: 0,
      limit: 10,
    } as ListResult<never>;
  }

  function stubReads(data: {
    globalRunners: Array<Runner>;
    projectRunners?: Array<Runner> | undefined;
  }): void {
    projectCalls = [];
    globalCalls = [];

    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
        const call: ListCall = args as ListCall;

        if (
          String(call.requestOptions?.overrideRequestUrl || "").endsWith(
            GLOBAL_RUNNERS_ROUTE,
          )
        ) {
          globalCalls.push(call);
          return asList(data.globalRunners);
        }

        projectCalls.push(call);
        return asList(data.projectRunners || []);
      });

    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(new Project() as never);
  }

  test("reads whether each Runner takes code fixes, the global ones and the project's own", async () => {
    stubReads({ globalRunners: [] });

    await RunnerChoicesLoader.loadForCodeRepository(new ObjectID(PROJECT_ID));

    expect(globalCalls[0]!.select["takesCodeFixes"]).toBe(true);
    expect(projectCalls[0]!.select["takesCodeFixes"]).toBe(true);
  });

  test("keeps only the global Runners that take code fixes - one the server did not judge takes them", async () => {
    stubReads({
      globalRunners: [
        runner({
          id: "00000000-0000-0000-0000-000000000002",
          name: "Global Runner",
          takesCodeFixes: false,
        }),
        runner({
          id: "aaaaaaaa-0000-4000-8000-000000000041",
          name: "Global Runner (Frankfurt)",
          takesCodeFixes: true,
        }),
        runner({
          id: "aaaaaaaa-0000-4000-8000-000000000042",
          name: "Global Runner (an older server)",
        }),
      ],
    });

    const loaded: RunnerChoices =
      await RunnerChoicesLoader.loadForCodeRepository(new ObjectID(PROJECT_ID));

    expect(
      loaded.globalRunners.map((row: { name: string }): string => {
        return row.name;
      }),
    ).toEqual(["Global Runner (Frankfurt)", "Global Runner (an older server)"]);
    expect(loaded.globalRunnersTakeNoCodeFixes).toBeUndefined();
  });

  test("a server whose global Runners all take no code fixes is said to have none that does - not none at all", async () => {
    stubReads({
      globalRunners: [
        runner({
          id: "00000000-0000-0000-0000-000000000002",
          name: "Global Runner",
          takesCodeFixes: false,
        }),
      ],
    });

    const loaded: RunnerChoices =
      await RunnerChoicesLoader.loadForCodeRepository(new ObjectID(PROJECT_ID));

    expect(loaded.globalRunners).toEqual([]);
    expect(loaded.globalRunnersTakeNoCodeFixes).toBe(true);
  });

  test("a server that runs no global Runner at all says nothing about code fixes", async () => {
    stubReads({ globalRunners: [] });

    const loaded: RunnerChoices =
      await RunnerChoicesLoader.loadForCodeRepository(new ObjectID(PROJECT_ID));

    expect(loaded.globalRunnersTakeNoCodeFixes).toBeUndefined();
  });

  test("a runbook step's picker keeps a global Runner that takes no code fixes: it still runs JavaScript steps", async () => {
    stubReads({
      globalRunners: [
        runner({
          id: "00000000-0000-0000-0000-000000000002",
          name: "Global Runner",
          takesCodeFixes: false,
        }),
      ],
    });

    const loaded: RunnerChoices = await RunnerChoicesLoader.load(
      new ObjectID(PROJECT_ID),
    );

    expect(loaded.globalRunners).toHaveLength(1);
    expect(loaded.globalRunnersTakeNoCodeFixes).toBeUndefined();
  });

  test("marks a Runner of the project's own whose host turned code fixes off - only that one", async () => {
    stubReads({
      globalRunners: [],
      projectRunners: [
        runner({ id: BASTION_ID, name: "prod-bastion", takesCodeFixes: true }),
        runner({ id: OFFICE_ID, name: "office-runner", takesCodeFixes: false }),
        // An older Runner says nothing: it takes them, as before.
        runner({ id: "aaaaaaaa-0000-4000-8000-000000000033", name: "old-box" }),
      ],
    });

    const loaded: RunnerChoices =
      await RunnerChoicesLoader.loadForCodeRepository(new ObjectID(PROJECT_ID));

    expect(
      loaded.projectRunners.map(
        (row: {
          name: string;
          takesNoCodeFixes?: boolean | undefined;
        }): [string, boolean] => {
          return [row.name, row.takesNoCodeFixes === true];
        },
      ),
    ).toEqual([
      ["prod-bastion", false],
      ["office-runner", true],
      ["old-box", false],
    ]);
  });
});

describe("the picker's rules about code fixes", () => {
  function model(
    value: string,
    overrides: Partial<RunnerChoices> = {},
    work: RunnerPickerWork = RunnerPickerWork.CodeRepository,
  ): RunnerPickerModel {
    const loaded: RunnerChoices = choices(overrides);

    return buildRunnerPickerModel({
      work,
      stepType: work === RunnerPickerWork.RunbookStep ? "JavaScript" : "",
      currentRunnerId: value,
      projectRunners: loaded.projectRunners,
      globalRunners: loaded.globalRunners,
      projectUsesGlobalRunners: loaded.projectUsesGlobalRunners,
    });
  }

  test("a repository's option for a Runner that takes no code fixes says so; the others do not", () => {
    const options: Array<RunnerPickerOption> = model("").options;

    expect(
      options.map((option: RunnerPickerOption): [string, boolean] => {
        return [option.name, option.takesNoCodeFixes === true];
      }),
    ).toEqual([
      ["Global Runner", false],
      ["prod-bastion", false],
      ["office-runner", true],
    ]);
  });

  test("picking it, or following it as the project's default, is a Runner that takes no code fixes", () => {
    expect(getRunnerTakingNoCodeFixes(model(OFFICE_ID))?.name).toBe(
      "office-runner",
    );
    expect(getRunnerTakingNoCodeFixes(model(BASTION_ID))).toBeUndefined();
    expect(getRunnerTakingNoCodeFixes(model(""))).toBeUndefined();

    const followsDefault: RunnerPickerModel = model("", {
      projectRunners: [
        {
          id: OFFICE_ID,
          name: "office-runner",
          liveStatus: RunnerLiveStatus.Connected,
          isProjectDefault: true,
          takesNoCodeFixes: true,
        },
      ],
    });

    expect(followsDefault.outcome).toBe(
      RunnerPickerOutcome.ProjectDefaultRunner,
    );
    expect(getRunnerTakingNoCodeFixes(followsDefault)?.name).toBe(
      "office-runner",
    );
  });

  test("a runbook step's picker never carries it: a step is not a code fix", () => {
    const step: RunnerPickerModel = model(
      OFFICE_ID,
      {},
      RunnerPickerWork.RunbookStep,
    );

    expect(
      step.options.some((option: RunnerPickerOption): boolean => {
        return option.takesNoCodeFixes === true;
      }),
    ).toBe(false);
    expect(getRunnerTakingNoCodeFixes(step)).toBeUndefined();
  });

  test("with no global Runner that takes code fixes there is no global choice", () => {
    const none: RunnerPickerModel = model("", {
      projectRunners: [],
      globalRunners: [],
      globalRunnersTakeNoCodeFixes: true,
    });

    expect(none.outcome).toBe(RunnerPickerOutcome.NoGlobalRunner);
    expect(none.willRun).toBe(false);
  });
});

describe("a repository's Runner picker, when what it works on takes no code fixes", () => {
  test("on a server whose global Runners take none: says so, never that the server runs none", () => {
    renderPicker({
      value: "",
      choices: choices({
        globalRunners: [],
        globalRunnersTakeNoCodeFixes: true,
      }),
    });

    expect(help()).toHaveTextContent(
      CODE_NO_CODE_FIX_GLOBAL_RUNNER_HELPER_TEXT,
    );
    expect(help()).not.toHaveTextContent(CODE_NO_GLOBAL_RUNNER_HELPER_TEXT);
    // Nor that a global Runner is about to connect.
    expect(screen.queryByTestId(`${PICKER}-global-waiting`)).toBeNull();
  });

  test("on a server that runs no global Runner, it says that, as before", () => {
    renderPicker({
      value: "",
      choices: choices({ globalRunners: [] }),
    });

    expect(help()).toHaveTextContent(CODE_NO_GLOBAL_RUNNER_HELPER_TEXT);
  });

  test("the global Runner that takes code fixes is the one whose status the choice shows", () => {
    renderPicker({
      value: "",
      choices: choices({
        globalRunners: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000041",
            name: "Global Runner (Frankfurt)",
            description: "",
            liveStatus: RunnerLiveStatus.Disconnected,
            runsRunbooks: true,
            takesCodeFixes: true,
          },
        ],
      }),
    });

    expect(screen.getByTestId(`${PICKER}-global-waiting`)).toHaveTextContent(
      CODE_GLOBAL_RUNNER_NOT_CONNECTED_TEXT,
    );
  });

  test("its own Runner whose host turned them off: the menu says so under its name, and only there", () => {
    renderPicker({ value: "", choices: choices() });

    const options: Array<HTMLElement> = openMenu();

    expect(options[2]).toHaveTextContent("office-runner · Connected");
    expect(options[2]).toHaveTextContent(
      CODE_RUNNER_TAKES_NO_CODE_FIXES_OPTION_TEXT,
    );
    expect(options[1]).not.toHaveTextContent(
      CODE_RUNNER_TAKES_NO_CODE_FIXES_OPTION_TEXT,
    );
    expect(options[0]).not.toHaveTextContent(
      CODE_RUNNER_TAKES_NO_CODE_FIXES_OPTION_TEXT,
    );
  });

  test("picked: the line under it says so in amber, with the setting and the way out - not what AI would do there", () => {
    renderPicker({ value: OFFICE_ID, choices: choices() });

    const line: HTMLElement = screen.getByTestId(
      `${PICKER}-takes-no-code-fixes`,
    );

    expect(line).toHaveTextContent(CODE_RUNNER_TAKES_NO_CODE_FIXES_TEXT);
    expect(line.className).toContain("text-amber-700");
    expect(help()).not.toHaveTextContent(CODE_OWN_RUNNER_HELPER_TEXT);
  });

  test("followed as the project's default: the same, not the default's own line", () => {
    renderPicker({
      value: "",
      choices: choices({
        projectRunners: [
          {
            id: OFFICE_ID,
            name: "office-runner",
            liveStatus: RunnerLiveStatus.Connected,
            isProjectDefault: true,
            takesNoCodeFixes: true,
          },
        ],
      }),
    });

    expect(help()).toHaveTextContent(CODE_RUNNER_TAKES_NO_CODE_FIXES_TEXT);
    expect(help()).not.toHaveTextContent(
      CODE_PROJECT_DEFAULT_RUNNER_HELPER_TEXT,
    );
  });

  test("another Runner of its own picked: what AI does there, as before", () => {
    renderPicker({ value: BASTION_ID, choices: choices() });

    expect(help()).toHaveTextContent(CODE_OWN_RUNNER_HELPER_TEXT);
    expect(screen.queryByTestId(`${PICKER}-takes-no-code-fixes`)).toBeNull();
  });

  test("a runbook step's picker says nothing about code fixes for the same Runner", () => {
    renderPicker({
      value: OFFICE_ID,
      choices: choices(),
      work: RunnerPickerWork.RunbookStep,
    });

    expect(screen.getByTestId(PICKER)).not.toHaveTextContent(
      CODE_RUNNER_TAKES_NO_CODE_FIXES_TEXT,
    );

    for (const option of openMenu()) {
      expect(option).not.toHaveTextContent(
        CODE_RUNNER_TAKES_NO_CODE_FIXES_OPTION_TEXT,
      );
    }
  });
});

describe("a repository's Runner card, when what it works on takes no code fixes", () => {
  test("on a server whose global Runners take none: None, and why, in amber", () => {
    render(
      <CodeRepositoryRunnerValueView
        runnerId={null}
        choices={choices({
          globalRunners: [],
          globalRunnersTakeNoCodeFixes: true,
        })}
      />,
    );

    const value: HTMLElement = screen.getByTestId(
      CODE_REPOSITORY_RUNNER_VALUE_TEST_ID,
    );

    expect(value).toHaveTextContent(
      CodeRepositoryRunnerCopy.noneNoCodeFixGlobalRunner,
    );
    expect(value).not.toHaveTextContent(
      CodeRepositoryRunnerCopy.noneNoGlobalRunner,
    );
    expect(value.className).toContain("text-amber-700");
  });

  test("on its own Runner whose host turned them off: its name and status, then the line in amber", () => {
    render(
      <CodeRepositoryRunnerValueView
        runnerId={OFFICE_ID}
        choices={choices()}
      />,
    );

    const value: HTMLElement = screen.getByTestId(
      CODE_REPOSITORY_RUNNER_VALUE_TEST_ID,
    );

    expect(value).toHaveTextContent("office-runner");
    expect(value).toHaveTextContent("Connected");

    const line: HTMLElement = screen.getByTestId(
      CODE_REPOSITORY_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID,
    );

    expect(line).toHaveTextContent(CODE_RUNNER_TAKES_NO_CODE_FIXES_TEXT);
    expect(line.className).toContain("text-amber-700");
  });

  test("on a Runner of its own that takes them, or on Global Runner: no such line", () => {
    const view: RenderResult = render(
      <CodeRepositoryRunnerValueView
        runnerId={BASTION_ID}
        choices={choices()}
      />,
    );

    expect(
      screen.queryByTestId(CODE_REPOSITORY_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID),
    ).toBeNull();

    view.rerender(
      <CodeRepositoryRunnerValueView runnerId={null} choices={choices()} />,
    );

    expect(
      screen.queryByTestId(CODE_REPOSITORY_RUNNER_TAKES_NO_CODE_FIXES_TEST_ID),
    ).toBeNull();
  });
});

/*
 * The words, in every language the Dashboard speaks: each locale words each
 * one (never the English left in), keeping {{runner}} and the setting's
 * name, which is the same in every language.
 */
describe("the words, in every language", () => {
  const LOCALES: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );
  const LANGUAGES: Array<string> = [
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ];
  const SENTENCES: Array<string> = [
    CODE_NO_CODE_FIX_GLOBAL_RUNNER_HELPER_TEXT,
    CODE_RUNNER_TAKES_NO_CODE_FIXES_OPTION_TEXT,
    CODE_RUNNER_TAKES_NO_CODE_FIXES_TEXT,
    CodeRepositoryRunnerCopy.noneNoCodeFixGlobalRunner,
  ];

  function read(language: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }

  test("English holds each as itself", () => {
    const english: Record<string, string> = read("en");

    for (const sentence of SENTENCES) {
      expect(english[sentence]).toBe(sentence);
    }
  });

  test.each(LANGUAGES)("%s words each one", (language: string) => {
    const words: Record<string, string> = read(language);

    for (const sentence of SENTENCES) {
      const worded: string | undefined = words[sentence];

      expect(worded).toBeTruthy();
      expect(worded).not.toBe(sentence);

      if (sentence.includes("ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false")) {
        expect(worded).toContain("ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false");
      }
    }
  });
});
