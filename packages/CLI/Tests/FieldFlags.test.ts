import { Command, Option } from "commander";
import { ApiRequestOptions } from "../Core/ApiClient";

const mockExecuteApiRequest: jest.Mock = jest.fn();
jest.mock("../Core/ApiClient", () => {
  return {
    ...jest.requireActual("../Core/ApiClient"),
    executeApiRequest: (...args: unknown[]): unknown => {
      return mockExecuteApiRequest(...args);
    },
  };
});

import { buildProgram } from "../Program";
import {
  addAllResourceSubcommands,
  discoverResources,
} from "../Commands/ResourceCommands";
import { addFieldFlags, getAddedFieldFlags } from "../Utils/FieldFlags";
import { ResourceInfo } from "../Types/CLITypes";
import {
  clearTestCredentials,
  CliRun,
  INCIDENT_ID,
  MONITOR_ID,
  OTHER_MONITOR_ID,
  printedJson,
  runCli,
  SEVERITY_ID,
  useTestCredentials,
} from "./Helpers/RunCli";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CLI_RESERVED_FLAGS,
  CliFieldFlag,
  CliOperation,
  getCliFieldFlagsFor,
} from "Common/Utils/DeveloperDocs/CliCommands";
import { describePersonEmail } from "Common/Utils/DeveloperDocs/PeopleByEmail";

/*
 * A create's and an update's flags: one per field the API's schema takes,
 * worked out from the model (Common/Utils/DeveloperDocs/CliCommands), and
 * added to the command the program runs. These run the real program.
 */

function modelType(tableName: string): DatabaseBaseModelType {
  return DatabaseModels.find((candidate: DatabaseBaseModelType): boolean => {
    return new candidate().tableName === tableName;
  }) as DatabaseBaseModelType;
}

function subcommand(program: Command, path: Array<string>): Command {
  let command: Command = program;

  for (const name of path) {
    command = command.commands.find((child: Command): boolean => {
      return child.name() === name;
    }) as Command;
  }

  return command;
}

function lastRequest(): ApiRequestOptions {
  const calls: Array<Array<unknown>> = mockExecuteApiRequest.mock.calls;

  return calls[calls.length - 1]?.[0] as ApiRequestOptions;
}

describe("field flags", () => {
  beforeEach(() => {
    mockExecuteApiRequest.mockReset();
    mockExecuteApiRequest.mockResolvedValue({ _id: INCIDENT_ID });
    useTestCredentials();
  });

  afterEach(() => {
    clearTestCredentials();
  });

  it("are made for every create and update of every record, none clashing with another option", () => {
    const program: Command = addAllResourceSubcommands(buildProgram());
    let count: number = 0;

    for (const resource of discoverResources()) {
      if (resource.modelType !== "database") {
        continue;
      }

      for (const operation of [CliOperation.Create, CliOperation.Update] as const) {
        if (!resource.operations.includes(operation)) {
          continue;
        }

        const command: Command = subcommand(program, [resource.name, operation]);
        const model: DatabaseBaseModelType = modelType(resource.tableName);

        // Commander refuses an option whose flag another already has.
        expect(() => {
          addFieldFlags({ command, modelType: model, operation });
        }).not.toThrow();

        count += getAddedFieldFlags(command).length;
      }
    }

    expect(count).toBeGreaterThan(3000);
  });

  it("never take a flag the CLI uses itself, nor one Commander would read as turning an option off", () => {
    for (const model of DatabaseModels) {
      for (const operation of [CliOperation.Create, CliOperation.Update] as const) {
        for (const flag of getCliFieldFlagsFor(model, operation)) {
          const flags: Array<string> = [flag.flag, ...(flag.person ? [flag.person.flag] : [])];

          for (const name of flags) {
            expect({ table: new model().tableName, name, reserved: CLI_RESERVED_FLAGS.includes(name) }).toEqual({
              table: new model().tableName,
              name,
              reserved: false,
            });
            expect(name.startsWith("--no-")).toBe(false);
          }
        }
      }
    }
  });

  it("are added to the subcommand the program runs, when it runs", () => {
    const program: Command = addAllResourceSubcommands(buildProgram());
    const create: Command = subcommand(program, ["monitor", "create"]);

    // Made but not run: no field flags yet.
    expect(getAddedFieldFlags(create)).toEqual([]);
  });

  it("give a monitor's create its name, type, steps and labels, and never its project", async () => {
    const run: CliRun = await runCli(["monitor", "create", "--help"]);
    const help: string = run.printed.join("\n");

    expect(help).toContain("--name <text>");
    expect(help).toContain("--monitor-type <text>");
    expect(help).toContain("--monitor-steps <json>");
    expect(help).toContain("--labels <ids>");
    expect(help).toContain("IDs separated by commas, from `oneuptime label list`.");
    expect(help).not.toContain("--project-id");
    // The output options come last, as on every other command.
    expect(help.indexOf("--json")).toBeGreaterThan(help.indexOf("--monitor-type"));
  });

  it("send each field as the API takes it: IDs as records, switches as booleans, dates as ISO 8601, JSON parsed", async () => {
    const run: CliRun = await runCli([
      "incident",
      "create",
      "--title",
      "Checkout is down",
      "--incident-severity-id",
      SEVERITY_ID,
      "--monitors",
      `${MONITOR_ID}, ${OTHER_MONITOR_ID}`,
      "--is-visible-on-status-page",
      "false",
      "--enable-reminders",
      "--declared-at",
      "2026-11-01T10:00:00Z",
      "--custom-fields",
      '{"region":"eu"}',
      "--json",
    ]);

    expect(run.exitCode).toBeUndefined();
    expect(lastRequest().operation).toBe("create");
    expect(lastRequest().data).toEqual({
      title: "Checkout is down",
      incidentSeverityId: SEVERITY_ID,
      monitors: [{ _id: MONITOR_ID }, { _id: OTHER_MONITOR_ID }],
      isVisibleOnStatusPage: false,
      enableReminders: true,
      declaredAt: "2026-11-01T10:00:00.000Z",
      customFields: { region: "eu" },
    });
    expect(printedJson(run)).toEqual({ _id: INCIDENT_ID });
  });

  it("go on top of --data: a flag replaces the field it names, the rest of the JSON stays", async () => {
    await runCli([
      "incident",
      "create",
      "--data",
      '{"title":"From JSON","description":"Kept"}',
      "--title",
      "From the flag",
    ]);

    expect(lastRequest().data).toEqual({
      title: "From the flag",
      description: "Kept",
    });
  });

  it("go on top of --file the same way, on an update too", async () => {
    const fs: typeof import("fs") = jest.requireActual("fs");
    const os: typeof import("os") = jest.requireActual("os");
    const path: typeof import("path") = jest.requireActual("path");
    const file: string = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "cli-field-flags-")),
      "incident.json",
    );

    fs.writeFileSync(file, JSON.stringify({ title: "From the file", rootCause: "A deploy" }));

    await runCli(["incident", "update", INCIDENT_ID, "--file", file, "--title", "Renamed"]);

    expect(lastRequest().operation).toBe("update");
    expect(lastRequest().id).toBe(INCIDENT_ID);
    expect(lastRequest().data).toEqual({ title: "Renamed", rootCause: "A deploy" });
  });

  it("send only what an update gives", async () => {
    await runCli(["incident", "update", INCIDENT_ID, "--title", "Renamed"]);

    expect(lastRequest().data).toEqual({ title: "Renamed" });
  });

  it("refuse a create or an update with no field at all, before asking OneUptime", async () => {
    const create: CliRun = await runCli(["incident", "create"]);
    const update: CliRun = await runCli(["incident", "update", INCIDENT_ID]);

    expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    expect(create.exitCode).toBe(1);
    expect(create.errors.join("\n")).toContain(
      "Give the new Incident's fields: with their flags (`oneuptime incident create --help` lists them), or as JSON with --data or --file.",
    );
    expect(update.exitCode).toBe(1);
    expect(update.errors.join("\n")).toContain(
      "Give the fields to change: with their flags (`oneuptime incident update --help` lists them), or as JSON with --data or --file.",
    );
  });

  it.each([
    [
      ["--incident-severity-id", "critical"],
      'takes an ID, such as 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11, and "critical" is not one. Find them with `oneuptime incident-severity list`.',
    ],
    [["--monitors", "api,web"], "--monitors takes IDs"],
    [["--is-visible-on-status-page", "maybe"], '--is-visible-on-status-page takes true or false, and "maybe" is neither.'],
    [["--declared-at", "yesterday"], "--declared-at takes a date and time, such as 2026-11-01T10:00:00Z"],
    [["--custom-fields", "{region: eu}"], "--custom-fields takes JSON"],
  ])("refuse %j with what the flag takes", async (flags: Array<string>, message: string) => {
    const run: CliRun = await runCli(["incident", "create", "--title", "X", ...flags]);

    expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    expect(run.exitCode).toBe(1);
    expect(run.errors.join("\n")).toContain(message);
  });

  it("take a label's color, while the program's own --no-color stays its own", async () => {
    await runCli(["label", "create", "--name", "Team: payments", "--color", "#32a852"]);

    expect(lastRequest().data).toEqual({ name: "Team: payments", color: "#32a852" });

    await runCli(["--no-color", "label", "create", "--name", "Plain", "--color", "#000000"]);

    expect(lastRequest().data).toEqual({ name: "Plain", color: "#000000" });
  });

  it("leave a field named like the CLI's own options to --data: a data source's url is not OneUptime's address", async () => {
    const run: CliRun = await runCli(["data-source", "create", "--help"]);
    const help: string = run.printed.join("\n");

    // The only --url is the program's, which the root reads.
    expect(help).not.toContain("--url <url>");

    await runCli([
      "data-source",
      "create",
      "--data",
      '{"name":"Prometheus","url":"https://prometheus.example.com"}',
    ]);

    expect(lastRequest().apiUrl).toBe("https://oneuptime.example.com");
    expect(lastRequest().data).toEqual(
      expect.objectContaining({ url: "https://prometheus.example.com" }),
    );
  });

  it("are not given to telemetry, which takes its record in --data", async () => {
    const run: CliRun = await runCli(["log", "create", "--help"]);
    const help: string = run.printed.join("\n");

    expect(help).toContain("--data <json>");
    expect(help).not.toContain("--body");
    expect(help).not.toContain("--severity-text");
  });

  it("say a create must give a required field, or its person's address instead", async () => {
    const run: CliRun = await runCli(["team-member", "create", "--help"]);
    const help: string = run.printed.join(" ").replace(/\s+/g, " ");
    const flags: Array<CliFieldFlag> = getCliFieldFlagsFor(
      modelType("TeamMember"),
      CliOperation.Create,
    );
    const user: CliFieldFlag | undefined = flags.find((flag: CliFieldFlag) => {
      return flag.columnName === "userId";
    });

    expect(help).toContain("--team-id <id> Required.");
    expect(help).toContain("--user-id <id> Required, or --user-email.");
    expect(user?.person?.flag).toBe("--user-email");
    // The provider's, the dashboard's and the CLI's one sentence.
    expect(help).toContain(
      describePersonEmail({ idName: "--user-id", isList: false, invitesByEmail: true }),
    );
  });

  it("are Commander options whose stored value names their field", () => {
    for (const resource of discoverResources().filter((candidate: ResourceInfo) => {
      return ["incident", "monitor", "team-member", "on-call-policy"].includes(candidate.name);
    })) {
      const model: DatabaseBaseModel = new (modelType(resource.tableName))();

      for (const flag of getCliFieldFlagsFor(modelType(resource.tableName), CliOperation.Create)) {
        const option: Option = new Option(`${flag.flag} ${flag.valueName}`);

        expect(option.long).toBe(flag.flag);
        expect(model.getTableColumns().columns).toContain(flag.columnName);
      }
    }
  });
});
