import { Command } from "commander";
import { buildProgram } from "../Program";
import {
  LIST_ALL_MAX_RECORDS,
  addAllResourceSubcommands,
  discoverResources,
} from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import {
  CliRun,
  INCIDENT_ID,
  clearTestCredentials,
  runCli,
  useTestCredentials,
} from "./Helpers/RunCli";
import {
  CodeBlock,
  ShownCommand,
  codeBlocksIn,
  commandAt,
  commandPathOf,
  helpFlags,
  shownCommandsIn,
  spanCommandsIn,
} from "./Helpers/ShownCommands";
import {
  CliAction,
  CliOperation,
} from "Common/Utils/DeveloperDocs/CliCommands";
import * as fs from "fs";
import * as path from "path";

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
 * The coding agent plugin OneUptime lists for Claude Code and Cursor
 * (App/FeatureSet/MCP/CodingAgentPlugin) has a skill an agent reads before
 * it writes a script or a pipeline that runs this CLI: use-oneuptime-cli.
 * App's CodingAgentPlugin suite holds it to the CLI's sources. These hold
 * it to the program: every command it shows is one the CLI runs, with
 * flags its help lists, the buttons it names are on the resources it says,
 * and the error it quotes is the one the CLI writes.
 */

const SKILL: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "App",
    "FeatureSet",
    "MCP",
    "CodingAgentPlugin",
    "skills",
    "use-oneuptime-cli",
    "SKILL.md",
  ),
  "utf-8",
);

const CODE_SPAN: RegExp = /`([^`]+)`/g;
/*
 * The name #6817 retired for one record of Scheduled Maintenance, in any
 * case: a Maintenance Event. Not the command, scheduled-maintenance-event.
 */
const SCHEDULED_MAINTENANCE_EVENT: RegExp =
  /\bscheduled\s+maintenance\s+events?\b/i;

// The commands the skill shows: in its shell and pipeline blocks, and in its text.
function shownCommands(): Array<ShownCommand> {
  return [
    ...shownCommandsIn(SKILL, ["bash", "yaml"]),
    ...spanCommandsIn(SKILL),
  ];
}

function codeSpansOf(line: string): Array<string> {
  return Array.from(line.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The skill's line that starts with these words.
function lineStartingWith(start: string): string {
  return (
    SKILL.split("\n").find((line: string): boolean => {
      return line.startsWith(start);
    }) || ""
  );
}

function namesWith(
  resources: Array<ResourceInfo>,
  action: CliAction,
): Array<string> {
  return resources
    .filter((resource: ResourceInfo): boolean => {
      return resource.actions.includes(action);
    })
    .map((resource: ResourceInfo): string => {
      return resource.name;
    })
    .sort();
}

describe("the coding agent plugin's CLI skill", () => {
  let program: Command;
  let resources: Array<ResourceInfo>;

  beforeAll(() => {
    program = addAllResourceSubcommands(buildProgram());
    resources = discoverResources();
  });

  afterEach(() => {
    clearTestCredentials();
    mockExecuteApiRequest.mockReset();
  });

  it("shows commands in its shell blocks, its pipeline and its text", () => {
    const lines: Array<string> = shownCommands().map(
      (command: ShownCommand): string => {
        return command.line;
      },
    );

    expect(lines).toEqual(
      expect.arrayContaining([
        "oneuptime whoami --check",
        "oneuptime resources --json",
        'oneuptime monitor create --name "Checkout API" --monitor-type Manual --json',
        "oneuptime incident acknowledge <incident-id> --json",
        // The pipeline's, inside $(...).
        'OPEN=$(oneuptime incident count --query \'{"currentIncidentState":{"isResolvedState":false}}\')',
      ]),
    );
    expect(
      shownCommands().find((command: ShownCommand): boolean => {
        return command.line.startsWith("OPEN=");
      })?.words,
    ).toEqual([
      "incident",
      "count",
      "--query",
      '{"currentIncidentState":{"isResolvedState":false}}',
    ]);
  });

  it("runs only commands the CLI has, with the flags their help lists", async () => {
    for (const shown of shownCommands()) {
      const commandPath: Array<string> = commandPathOf(program, shown.words);
      const command: Command = commandAt(program, commandPath);
      const run: CliRun = await runCli([...commandPath, "--help"]);
      const listed: Array<string> = helpFlags(run.printed.join("\n"));

      // A command the CLI runs, not a group of them: a misspelled subcommand stops at its group.
      expect({
        line: shown.line,
        runsCommand: commandPath.length > 0 && command.commands.length === 0,
        exitCode: run.exitCode,
      }).toEqual({ line: shown.line, runsCommand: true, exitCode: 0 });

      for (const flag of shown.words.filter((word: string): boolean => {
        return word.startsWith("-");
      })) {
        expect({
          line: shown.line,
          flag,
          listed: listed.includes(flag),
        }).toEqual({ line: shown.line, flag, listed: true });
      }
    }
  });

  it("names the email flags beside the ID flags they stand for, as the help writes them", async () => {
    const teamMember: string = (
      await runCli(["team-member", "create", "--help"])
    ).printed.join("\n");
    const ownerRule: string = (
      await runCli(["incident-owner-rule", "create", "--help"])
    ).printed.join("\n");

    expect(
      codeSpansOf(lineStartingWith("- A field that names a person")),
    ).toEqual([
      "--user-email",
      "--user-id",
      "--owner-user-emails",
      "--owner-users",
    ]);
    expect(teamMember).toContain("--user-email <email>");
    expect(teamMember).toContain("--user-id <id>");
    expect(ownerRule).toContain("--owner-user-emails <emails>");
    expect(ownerRule).toContain("--owner-users <ids>");
  });

  it("says what a list reads: ten records, or every page of them up to the CLI's limit", async () => {
    const list: string = (
      await runCli(["incident", "list", "--help"])
    ).printed.join("\n");
    const logs: Array<string> = helpFlags(
      (await runCli(["log", "list", "--help"])).printed.join("\n"),
    );

    expect(lineStartingWith("- `--limit` defaults to 10.")).toContain(
      `\`--all\` reads every page of records, up to ${LIST_ALL_MAX_RECORDS.toLocaleString("en-US")} of them.`,
    );
    expect(list).toContain('(default: "10")');
    expect(helpFlags(list)).toEqual(
      expect.arrayContaining(["--limit", "--all", "--fields"]),
    );
    // Telemetry pages with --limit and --skip only.
    expect(logs).toContain("--fields");
    expect(logs).not.toContain("--all");
  });

  it("says which resources are read only, by one the CLI has as read only", () => {
    const emailLog: ResourceInfo | undefined = resources.find(
      (resource: ResourceInfo): boolean => {
        return resource.name === "email-log";
      },
    );

    expect(SKILL).toContain("such as an email log, are read only");
    expect(emailLog?.operations).toEqual([
      CliOperation.List,
      CliOperation.Get,
      CliOperation.Count,
    ]);
  });

  it("says which resources the dashboard's buttons are on, and which can post a note publicly", async () => {
    const acknowledged: Array<string> = namesWith(
      resources,
      CliAction.Acknowledge,
    );

    expect(acknowledged).toEqual([
      "alert",
      "alert-episode",
      "incident",
      "incident-episode",
    ]);
    expect(namesWith(resources, CliAction.Resolve)).toEqual(acknowledged);
    expect(namesWith(resources, CliAction.Start)).toEqual([
      "scheduled-maintenance-event",
    ]);
    expect(namesWith(resources, CliAction.End)).toEqual([
      "scheduled-maintenance-event",
    ]);
    expect(namesWith(resources, CliAction.AddNote)).toEqual(
      [...acknowledged, "scheduled-maintenance-event"].sort(),
    );
    // The command keeps the API's name, so the skill names it beside the record's.
    expect(SKILL).toContain(
      "Alerts and the episodes of incidents and alerts take the same three, and a maintenance event (`scheduled-maintenance-event`) takes `start`, `end` and `add-note`.",
    );
    expect(SKILL).toContain("Alerts and their episodes have no public notes.");

    for (const [resource, hasPublic] of [
      ["incident", true],
      ["incident-episode", true],
      ["scheduled-maintenance-event", true],
      ["alert", false],
      ["alert-episode", false],
    ] as Array<[string, boolean]>) {
      const flags: Array<string> = helpFlags(
        (await runCli([resource, "add-note", "--help"])).printed.join("\n"),
      );

      expect({ resource, public: flags.includes("--public") }).toEqual({
        resource,
        public: hasPublic,
      });
    }
  });

  it("no longer says scheduled maintenance event: one is a maintenance event (#6817)", () => {
    expect(SKILL).not.toMatch(SCHEDULED_MAINTENANCE_EVENT);
  });

  it("quotes an error asked for JSON as the CLI writes it", async () => {
    useTestCredentials();
    mockExecuteApiRequest.mockRejectedValueOnce(
      new Error("API error (404): Incident not found."),
    );

    const run: CliRun = await runCli([
      "incident",
      "get",
      INCIDENT_ID,
      "--json",
    ]);

    expect(run.exitCode).toBe(3);
    expect(run.printed).toEqual([]);
    // One line on standard error; the skill lays it out, as prettier formats a JSON block.
    expect(run.errors).toHaveLength(1);
    expect(JSON.parse(run.errors[0] as string)).toEqual(
      JSON.parse(
        (
          codeBlocksIn(SKILL).find((block: CodeBlock): boolean => {
            return block.language === "json";
          }) as CodeBlock
        ).body,
      ),
    );
  });
});
