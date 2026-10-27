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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import Steps from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps";
import { GLOBAL_RUNNERS_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import { HTTP_STEP_VARIABLES_HELP } from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookVariableCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import RunbookVariable from "../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * AN HTTP REQUEST STEP NAMES RUNBOOK VARIABLES, on a runbook's Steps page.
 *
 * Bash, JavaScript, SSH and kubectl steps named variables; an HTTP request
 * step's URL, headers and body now do too, and OneUptime fills them in when
 * the step runs - a secret as well, since OneUptime sends the request
 * itself. The step says so under its fields, offers the variables as chips
 * to copy, and says when it names one that is not there.
 *
 * The real page; only the model API is stubbed.
 */

const RUNBOOK_ID: string = "77777777-0000-4000-8000-0000000000f6";
const WAIT: { timeout: number } = { timeout: 20000 };

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const STEPS: Array<RunbookStep> = [
  {
    id: "notify",
    order: 0,
    type: RunbookStepType.HttpRequest,
    title: "Post to the status page",
    config: {
      url: "{{global.variables.STATUSPAGE_API}}/incidents",
      method: "POST",
      headersJson:
        '{ "Authorization": "OAuth {{global.variables.STATUSPAGE_TOKEN}}" }',
      body: '{ "component": "{{local.variables.COMPONENT}}" }',
    },
  },
  {
    id: "typo",
    order: 1,
    type: RunbookStepType.HttpRequest,
    title: "Ping the old hook",
    config: {
      url: "https://hooks.example.com/{{global.variables.HOOK_PATH}}",
      method: "GET",
      headersJson: '{ "X-Key": "{{global.variables.OLD_KEY}}" }',
    },
  },
];

let hasVariables: boolean = true;

function variable(fields: Record<string, unknown>): RunbookVariable {
  return Object.assign(new RunbookVariable(), {
    isAvailableToGlobalRunners: false,
    runners: [],
    ...fields,
  });
}

const GLOBAL_VARIABLES: Array<RunbookVariable> = [
  variable({ _id: "v1", name: "STATUSPAGE_API", isSecret: false }),
  variable({ _id: "v2", name: "STATUSPAGE_TOKEN", isSecret: true }),
];

const LOCAL_VARIABLES: Array<RunbookVariable> = [
  variable({ _id: "v3", name: "COMPONENT", isSecret: false }),
];

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`);
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
        : [];
    } else if (args.modelType === RunbookVariable) {
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

describe("an HTTP request step's variables", () => {
  test("its fields say how to name a variable, and that OneUptime fills in secrets and hides them", async () => {
    await renderSteps();

    const help: HTMLElement = screen.getByTestId(
      "runbook-step-0-http-variables-help",
    );

    expect(help).toHaveTextContent(
      "Use a variable in the URL, the headers or the body as {{global.variables.NAME}}. OneUptime sends the request itself, so it fills in secrets too, and hides them in what the step records.",
    );
    expect(within(help).getByText("{{global.variables.NAME}}").tagName).toBe(
      "CODE",
    );
  });

  test("offers the project's and the runbook's variables to copy", async () => {
    await renderSteps();

    await waitFor(() => {
      expect(
        screen.getByTestId("runbook-step-0-http-variables"),
      ).toBeInTheDocument();
    }, WAIT);

    const chips: HTMLElement = screen.getByTestId(
      "runbook-step-0-http-variables",
    );

    expect(
      within(chips).getByRole("button", {
        name: "Copy {{global.variables.STATUSPAGE_TOKEN}}",
      }),
    ).toBeInTheDocument();
    expect(
      within(chips).getByRole("button", {
        name: "Copy {{local.variables.COMPONENT}}",
      }),
    ).toBeInTheDocument();
  });

  test("a step that names variables the project does not have says which - in the URL and the headers alike", async () => {
    await renderSteps();

    const note: HTMLElement = await screen.findByTestId(
      "runbook-step-1-http-unknown-variables",
      {},
      WAIT,
    );

    expect(note).toHaveTextContent(
      "No variable is named {{global.variables.HOOK_PATH}}, {{global.variables.OLD_KEY}}, so the step will fail when it runs.",
    );
  });

  test("a step whose variables are all there says nothing of the kind", async () => {
    await renderSteps();

    await waitFor(() => {
      expect(
        screen.getByTestId("runbook-step-0-http-variables"),
      ).toBeInTheDocument();
    }, WAIT);

    expect(
      screen.queryByTestId("runbook-step-0-http-unknown-variables"),
    ).toBeNull();
  });

  test("with no variables yet, no chips: the line above says how one is named", async () => {
    hasVariables = false;

    await renderSteps();

    expect(
      screen.getByTestId("runbook-step-0-http-variables-help"),
    ).toBeInTheDocument();

    // The project has none, so nothing is drawn as missing either.
    await waitFor(() => {
      expect(
        screen.getByTestId("runbook-step-1-http-unknown-variables"),
      ).toBeInTheDocument();
    }, WAIT);
    expect(screen.queryByTestId("runbook-step-0-http-variables")).toBeNull();
  });
});

describe("the words", () => {
  test("every Dashboard language has the help, translated, with its one slot", () => {
    const files: Array<string> = fs
      .readdirSync(DASHBOARD_LOCALES)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(DASHBOARD_LOCALES, file), "utf8"),
      );
      const value: string | undefined = locale[HTTP_STEP_VARIABLES_HELP];

      expect([file, typeof value]).toEqual([file, "string"]);

      if (file === "en.json") {
        expect(value).toBe(HTTP_STEP_VARIABLES_HELP);
      } else {
        expect([file, value === HTTP_STEP_VARIABLES_HELP]).toEqual([
          file,
          false,
        ]);
      }

      expect([file, value!.split("{{reference}}").length - 1]).toEqual([
        file,
        1,
      ]);
    }
  });
});
