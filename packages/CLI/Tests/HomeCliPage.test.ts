import { Command, CommanderError } from "commander";
import { buildProgram } from "../Program";
import { discoverResources } from "../Commands/ResourceCommands";
import * as OutputFormatter from "../Core/OutputFormatter";
import { ResourceInfo } from "../Types/CLITypes";
import {
  CliCommandName,
  CliPackageName,
  CliPageContent,
  CliTerminalStep,
  CliTerminals,
  getCliPageContent,
} from "../../Home/Utils/CliPage";
import {
  ShellWords,
  commandText,
  readPipeline,
} from "../../Home/Tests/Helpers/CliCommandLine";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { spawnSync, SpawnSyncReturns } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * The website's CLI page (packages/Home: Views/cli.ejs, Utils/CliPage.ts),
 * run through the real program. Every command the page shows a visitor - the
 * first three commands and each step of its terminal transcripts - is parsed
 * by the Commander program buildProgram() builds, sends the request the page
 * implies, names only fields its model has, and prints what the transcript
 * shows: directly, or through jq where the transcript pipes to it. The API is
 * answered here, with records shaped as OneUptime sends them; each answer is
 * keyed by the step it answers, so a step added to the page fails until it
 * has one.
 *
 * Home's Tests/CliPage.test.ts holds the same page to the CLI's sources from
 * the website's side. A renamed command or flag, or a changed message, fails
 * here until the page says the new thing.
 *
 * jq runs for real (GitHub's runners have it, as the CLI docs' readers do).
 */

const mockExecuteApiRequest: jest.Mock = jest.fn();

jest.mock("../Core/ApiClient", () => {
  return {
    ...jest.requireActual("../Core/ApiClient"),
    executeApiRequest: (...args: Array<unknown>): unknown => {
      return mockExecuteApiRequest(...args);
    },
  };
});

/*
 * A home of the suite's own, so the page's login never touches the reader's
 * ~/.oneuptime/config.json, and no other suite's. (The factory runs before
 * the imports above, so it only names their types.)
 */
jest.mock("os", () => {
  const actualOs: typeof os = jest.requireActual("os");
  const actualPath: typeof path = jest.requireActual("path");
  const actualFs: typeof fs = jest.requireActual("fs");
  const home: string = actualFs.mkdtempSync(
    actualPath.join(actualOs.tmpdir(), "oneuptime-cli-home-page-"),
  );

  return {
    ...actualOs,
    homedir: (): string => {
      return home;
    },
  };
});

const API_KEY: string = "4f1c3a2e-9b7d-4c1e-8a6f-2d5b7e9c0a13";
const INSTANCE_URL: string = "https://oneuptime.com";
const TRAILING_NEWLINE: RegExp = /\n$/;

// What the reader fills in for the placeholders of the first commands.
const FILLED_IN: Record<string, string> = {
  "<api-key>": API_KEY,
  "<instance-url>": INSTANCE_URL,
};

// The monitor in checkout-api.json, the file the monitors transcript creates from.
const CHECKOUT_API_MONITOR: JSONObject = {
  name: "Checkout API",
  monitorType: "Manual",
};

const CREATED_AT: JSONObject = {
  _type: "DateTime",
  value: "2026-10-14T09:12:44.000Z",
};
const PROJECT_ID: JSONObject = {
  _type: "ObjectID",
  value: "5b8e1f60-2c4d-4e7a-9f1b-3d6c8a2e4f71",
};

const MONITOR_IDS: Record<string, string> = {
  "Checkout API": "6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11",
  "API Gateway": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "Web App": "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  "Payment Service": "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  Database: "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80",
};

// A monitor as get-list and create answer with it: its fields, dates as objects.
function monitor(name: string): JSONObject {
  return {
    _id: MONITOR_IDS[name] as string,
    name: name,
    monitorType: name === "Checkout API" ? "Manual" : "Website",
    projectId: PROJECT_ID,
    createdAt: CREATED_AT,
  };
}

const PAYMENT_SERVICE_DOWN: JSONObject = {
  _id: "0b7d5e2c-8f4a-4d1b-9c3e-5a6f7b8c9d0e",
  title: "Payment Service Down",
  projectId: PROJECT_ID,
  createdAt: CREATED_AT,
  currentIncidentStateId: {
    _type: "ObjectID",
    value: "9e8d7c6b-5a49-4382-b1a0-f9e8d7c6b5a4",
  },
};

// A get-list answer: the records, and the count, skip and limit around them.
function listOf(records: Array<JSONObject>): JSONObject {
  return { data: records, count: records.length, skip: 0, limit: 10 };
}

/*
 * What OneUptime answers each step of each transcript with: a list's page of
 * records, a created record, a count, or the empty object an update and a
 * delete are answered with.
 */
const ANSWERS: Record<string, JSONValue> = {
  "overview[0]": listOf(
    ["API Gateway", "Web App", "Payment Service", "Database"].map(monitor),
  ),
  "overview[1]": listOf([PAYMENT_SERVICE_DOWN]),
  "monitors[0]": { ...monitor("Checkout API"), ...CHECKOUT_API_MONITOR },
  "monitors[1]": listOf(
    [
      "Checkout API",
      "API Gateway",
      "Web App",
      "Payment Service",
      "Database",
    ].map(monitor),
  ),
  "monitors[2]": { count: 5 },
  "incidents[0]": listOf([PAYMENT_SERVICE_DOWN]),
  "incidents[1]": {},
  "incidents[2]": { count: 0 },
  "first command: run": listOf([PAYMENT_SERVICE_DOWN]),
};

const TRANSCRIPT_NAMES: Array<keyof CliTerminals> = [
  "overview",
  "monitors",
  "incidents",
];

interface PageStep {
  label: string;
  text: string;
  // What the page shows the command print; null for a command shown alone.
  output: Array<string> | null;
  isSuccessMessage: boolean;
}

const page: CliPageContent = getCliPageContent();

const pageSteps: Array<PageStep> = [
  ...TRANSCRIPT_NAMES.flatMap((name: keyof CliTerminals): Array<PageStep> => {
    return page.terminals[name].map(
      (step: CliTerminalStep, index: number): PageStep => {
        return {
          label: `${name}[${index}]`,
          text: commandText(step.command),
          output: step.output,
          isSuccessMessage: Boolean(step.isSuccessMessage),
        };
      },
    );
  }),
  {
    label: "first command: login",
    text: page.firstCommands.login,
    output: null,
    isSuccessMessage: false,
  },
  {
    label: "first command: run",
    text: page.firstCommands.run,
    output: null,
    isSuccessMessage: false,
  },
];

interface Run {
  printed: Array<string>;
  errors: Array<string>;
  exitCodes: Array<unknown>;
  requests: Array<JSONObject>;
  successMessages: Array<string>;
}

let resources: Array<ResourceInfo>;

function resourceNamed(name: string): ResourceInfo {
  const resource: ResourceInfo | undefined = resources.find(
    (candidate: ResourceInfo): boolean => {
      return candidate.name === name;
    },
  );

  if (!resource) {
    throw new Error(`The program has no resource command ${name}`);
  }

  return resource;
}

// A blank model of a resource, to read its columns from.
function modelOf(resource: ResourceInfo): BaseModel | AnalyticsBaseModel {
  const models: Array<{ new (): BaseModel | AnalyticsBaseModel }> =
    resource.modelType === "database"
      ? (DatabaseModels as Array<{ new (): BaseModel }>)
      : (AnalyticsModels as Array<{ new (): AnalyticsBaseModel }>);

  for (const ModelClass of models) {
    const model: BaseModel | AnalyticsBaseModel = new ModelClass();

    if (model.tableName === resource.tableName) {
      return model;
    }
  }

  throw new Error(`No model has the table ${resource.tableName}`);
}

/*
 * The fields of JSON a command sends that its model lacks: a field of the
 * record, or of a record it refers to ({"currentIncidentState":
 * {"isResolvedState": false}}). An object with a _type is a value the API
 * reads ({"_type": "Search", ...}), not a record.
 */
function fieldsMissingFrom(
  model: BaseModel | AnalyticsBaseModel,
  json: JSONObject,
): Array<string> {
  const missing: Array<string> = [];

  for (const [field, value] of Object.entries(json)) {
    if (!model.hasColumn(field)) {
      missing.push(`${model.tableName}.${field}`);
      continue;
    }

    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !("_type" in value)
    ) {
      const RelatedModel: { new (): BaseModel } | undefined = (
        model as BaseModel
      ).getTableColumnMetadata(field)?.modelType as
        | { new (): BaseModel }
        | undefined;

      if (!RelatedModel) {
        missing.push(`${model.tableName}.${field} (not a relation)`);
        continue;
      }

      missing.push(
        ...fieldsMissingFrom(new RelatedModel(), value as JSONObject),
      );
    }
  }

  return missing;
}

describe("the website's CLI page, run through the real program", () => {
  let printed: Array<string>;
  let errors: Array<string>;
  let exitCodes: Array<unknown>;
  let successMessages: Array<string>;
  let workingDirectory: string;
  const originalDirectory: string = process.cwd();
  const originalIsTTY: boolean | undefined = process.stdout.isTTY;

  beforeAll(() => {
    resources = discoverResources();

    const jq: SpawnSyncReturns<string> = spawnSync("jq", ["--version"], {
      encoding: "utf8",
    });

    if (jq.status !== 0) {
      throw new Error(
        "jq is needed: the CLI page pipes the CLI's JSON through it.",
      );
    }
  });

  beforeEach(() => {
    printed = [];
    errors = [];
    exitCodes = [];
    successMessages = [];
    process.env["NO_COLOR"] = "1";
    delete process.env["ONEUPTIME_API_KEY"];
    delete process.env["ONEUPTIME_URL"];
    mockExecuteApiRequest.mockReset();

    // The reader's folder: checkout-api.json is there.
    workingDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-cli-page-"),
    );
    fs.writeFileSync(
      path.join(workingDirectory, "checkout-api.json"),
      JSON.stringify(CHECKOUT_API_MONITOR, null, 2),
    );
    process.chdir(workingDirectory);

    jest
      .spyOn(console, "log")
      .mockImplementation((...args: Array<unknown>): void => {
        printed.push(...args.map(String).join(" ").split("\n"));
      });
    jest
      .spyOn(console, "error")
      .mockImplementation((...args: Array<unknown>): void => {
        errors.push(args.map(String).join(" "));
      });
    jest.spyOn(process, "exit").mockImplementation(((code?: number): void => {
      exitCodes.push(code);
    }) as never);
    jest
      .spyOn(OutputFormatter, "printSuccess")
      .mockImplementation((message: string): void => {
        successMessages.push(message);
        printed.push(message);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.chdir(originalDirectory);
    fs.rmSync(workingDirectory, { recursive: true, force: true });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    delete process.env["NO_COLOR"];
  });

  /*
   * One command as the page writes it: its words after "oneuptime", the
   * placeholders a reader fills in filled in, in a terminal or in a pipe.
   */
  async function runPageCommand(
    words: ShellWords,
    isPiped: boolean,
  ): Promise<Run> {
    const built: Command = buildProgram();

    printed = [];
    built.exitOverride();
    built.configureOutput({
      writeErr: (text: string): void => {
        errors.push(text);
      },
      writeOut: (text: string): void => {
        printed.push(text);
      },
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: !isPiped,
      configurable: true,
    });

    await built.parseAsync([
      "node",
      CliCommandName,
      ...words.slice(1).map((word: string): string => {
        return FILLED_IN[word] || word;
      }),
    ]);

    return {
      printed: printed,
      errors: errors,
      exitCodes: exitCodes,
      requests: mockExecuteApiRequest.mock.calls.map(
        (call: Array<unknown>): JSONObject => {
          return call[0] as JSONObject;
        },
      ),
      successMessages: successMessages,
    };
  }

  // Log in as the page's second first command does, before a resource command.
  async function logInAsThePageSays(): Promise<void> {
    const [login] = readPipeline(page.firstCommands.login) as [ShellWords];
    const run: Run = await runPageCommand(login, false);

    expect(run.errors).toEqual([]);
    expect(run.exitCodes).toEqual([]);
    mockExecuteApiRequest.mockReset();
    printed = [];
    successMessages = [];
  }

  it("installs the package this CLI is published as, and runs the command it installs", () => {
    const manifest: { name: string; bin: Record<string, string> } = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
    ) as { name: string; bin: Record<string, string> };

    expect(CliPackageName).toBe(manifest.name);
    expect(Object.keys(manifest.bin)).toEqual([CliCommandName]);
    expect(buildProgram().name()).toBe(CliCommandName);
    expect(page.installCommand).toBe(`npm install -g ${manifest.name}`);
    expect(page.dockerfile).toContain(`RUN npm install -g ${manifest.name}`);
    expect(page.dockerfile).toContain(`ENTRYPOINT ["${CliCommandName}"]`);
  });

  it("answers every step the page shows the API being asked, and no other", () => {
    const asking: Array<string> = pageSteps
      .filter((step: PageStep): boolean => {
        const [cli] = readPipeline(step.text) as [ShellWords];

        return resources.some((resource: ResourceInfo): boolean => {
          return resource.name === cli[1];
        });
      })
      .map((step: PageStep): string => {
        return step.label;
      });

    expect(asking.sort()).toEqual(Object.keys(ANSWERS).sort());
  });

  it("logs in as the page says, without asking OneUptime anything", async () => {
    const [login] = readPipeline(page.firstCommands.login) as [ShellWords];
    const run: Run = await runPageCommand(login, false);

    expect(run.errors).toEqual([]);
    expect(run.exitCodes).toEqual([]);
    expect(run.successMessages).toEqual([
      'Logged in successfully. Context "default" is now active.',
    ]);
    expect(mockExecuteApiRequest).not.toHaveBeenCalled();
  });

  it.each(
    pageSteps
      .filter((step: PageStep): boolean => {
        return step.label !== "first command: login";
      })
      .map((step: PageStep): [string, PageStep] => {
        return [step.label, step];
      }),
  )(
    "%s parses, asks for what it shows, and prints what it shows",
    async (_label: string, step: PageStep) => {
      await logInAsThePageSays();

      const pipeline: Array<ShellWords> = readPipeline(step.text);
      const [cli, ...piped] = pipeline as [ShellWords, ...Array<ShellWords>];
      const resource: ResourceInfo = resourceNamed(cli[1] as string);
      const operation: string = cli[2] as string;

      mockExecuteApiRequest.mockResolvedValueOnce(ANSWERS[step.label]);

      let run: Run;

      try {
        run = await runPageCommand(cli, piped.length > 0);
      } catch (error) {
        // Commander refused the command: an unknown option, a bad value...
        throw new Error(
          `${step.label}: ${error instanceof CommanderError ? error.message : String(error)}`,
        );
      }

      expect({ errors: run.errors, exitCodes: run.exitCodes }).toEqual({
        errors: [],
        exitCodes: [],
      });

      // One request, for this resource, of the operation the page names.
      expect(run.requests).toHaveLength(1);

      const request: JSONObject = run.requests[0] as JSONObject;

      expect([request["apiPath"], request["operation"]]).toEqual([
        resource.apiPath,
        operation === "get" ? "read" : operation,
      ]);

      // What it sends names only fields its model has.
      const model: BaseModel | AnalyticsBaseModel = modelOf(resource);

      for (const sent of [request["query"], request["data"], request["sort"]]) {
        if (sent && typeof sent === "object") {
          expect(fieldsMissingFrom(model, sent as JSONObject)).toEqual([]);
        }
      }

      if (step.output === null) {
        return;
      }

      if (piped.length === 0) {
        // In a terminal: what the CLI prints, a blank line showing as nothing.
        expect(
          run.printed.filter((line: string): boolean => {
            return line.trim() !== "";
          }),
        ).toEqual(step.output);
        expect(run.successMessages.length > 0).toBe(step.isSuccessMessage);
        return;
      }

      // In a pipe: what jq makes of what the CLI prints.
      let text: string = `${run.printed.join("\n")}\n`;

      for (const next of piped) {
        expect(next[0]).toBe("jq");

        const jq: SpawnSyncReturns<string> = spawnSync("jq", next.slice(1), {
          input: text,
          encoding: "utf8",
        });

        expect([jq.status, jq.stderr]).toEqual([0, ""]);
        text = jq.stdout;
      }

      expect(text.replace(TRAILING_NEWLINE, "").split("\n")).toEqual(
        step.output,
      );
    },
  );

  it("sends the JSON the page writes, and reads --file from the reader's folder", async () => {
    await logInAsThePageSays();

    const [incidents, , count] = page.terminals.incidents as [
      CliTerminalStep,
      CliTerminalStep,
      CliTerminalStep,
    ];
    const [create] = page.terminals.monitors as [CliTerminalStep];

    for (const step of [incidents, count]) {
      const [cli] = readPipeline(commandText(step.command)) as [ShellWords];

      mockExecuteApiRequest.mockResolvedValueOnce({ count: 0, data: [] });
      await runPageCommand(cli, false);
    }

    const [cliCreate] = readPipeline(commandText(create.command)) as [
      ShellWords,
    ];

    mockExecuteApiRequest.mockResolvedValueOnce(ANSWERS["monitors[0]"]);
    await runPageCommand(cliCreate, true);

    const requests: Array<JSONObject> = mockExecuteApiRequest.mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      },
    );

    expect(
      requests.map((request: JSONObject): unknown => {
        return request["query"];
      }),
    ).toEqual([
      { currentIncidentState: { isResolvedState: false } },
      { currentIncidentState: { isResolvedState: false } },
      undefined,
    ]);
    // A list asks for the first ten, as the page's list commands do.
    expect([requests[0]?.["limit"], requests[0]?.["skip"]]).toEqual([10, 0]);
    expect(requests[2]?.["data"]).toEqual(CHECKOUT_API_MONITOR);
  });

  it("resolves the incident by writing its state, which is how the API changes one", async () => {
    await logInAsThePageSays();

    const [, resolve] = page.terminals.incidents as [
      CliTerminalStep,
      CliTerminalStep,
    ];
    const [cli] = readPipeline(commandText(resolve.command)) as [ShellWords];

    mockExecuteApiRequest.mockResolvedValueOnce({});
    await runPageCommand(cli, false);

    expect(mockExecuteApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiPath: resourceNamed("incident").apiPath,
        operation: "update",
        id: PAYMENT_SERVICE_DOWN["_id"],
        data: { currentIncidentStateId: "<resolved-state-id>" },
      }),
    );
  });
});
