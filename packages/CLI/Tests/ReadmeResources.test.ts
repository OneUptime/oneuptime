import { Command } from "commander";
import { buildProgram } from "../Program";
import {
  addAllResourceSubcommands,
  discoverResources,
} from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import { CliRun, runCli } from "./Helpers/RunCli";
import {
  ShownCommand,
  commandAt,
  commandPathOf,
  helpFlags,
  shownCommandsIn,
} from "./Helpers/ShownCommands";
import {
  CLI_ACTIONS,
  CLI_FIELDS_SUBCOMMAND,
  CLI_OPERATIONS,
  CliAction,
  CliOperation,
} from "Common/Utils/DeveloperDocs/CliCommands";
import * as fs from "fs";
import * as path from "path";

/*
 * The CLI's README is the page npm shows for @oneuptime/cli. It listed the
 * 52 MCP-enabled resources, a table for records and one for telemetry,
 * when the CLI was those 52. The CLI is now every resource of the API -
 * 456 of them, worked out from the models by the API's own rule, and
 * ApiParity holds it to the API - so the README says that rule and shows
 * some by area, and these tests hold what it says to the program: the
 * commands it names are ones the CLI has, the subcommands it lists are the
 * ones resources take, and every command it shows runs with the flags it
 * shows.
 */

const README: string = fs.readFileSync(
  path.join(__dirname, "..", "README.md"),
  "utf-8",
);
const NAV: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "App",
    "FeatureSet",
    "Docs",
    "Utils",
    "Nav.ts",
  ),
  "utf-8",
);
const DOCS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);

const HEADING: RegExp = /^(#{1,6})\s/;
const CODE_SPAN: RegExp = /`([^`]+)`/g;
// A table's separator row: | --- | --- |
const TABLE_SEPARATOR: RegExp = /^\|\s*-/;
const MARKDOWN_LINK: RegExp =
  /\]\((https:\/\/oneuptime\.com\/docs\/[^)\s]+)\)/g;
// "450 and more of them": the number the README claims.
const RESOURCE_COUNT_CLAIM: RegExp = /(?<!\d)(\d+) and more of them/;
/*
 * The name #6817 retired for one record of Scheduled Maintenance, in any
 * case: a Maintenance Event. Not the command, scheduled-maintenance-event.
 */
const SCHEDULED_MAINTENANCE_EVENT: RegExp =
  /\bscheduled\s+maintenance\s+events?\b/i;

// A section of the README: its heading line and everything up to the next heading of its level or higher.
function section(heading: string): string {
  const lines: Array<string> = README.split("\n");
  const start: number = lines.indexOf(heading);

  if (start === -1) {
    throw new Error(`No heading "${heading}" in the README`);
  }

  const level: number = (heading.match(HEADING)?.[1] || "").length;
  const found: Array<string> = [heading];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(HEADING);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    found.push(line);
  }

  return found.join("\n");
}

function codeSpans(text: string): Array<string> {
  return Array.from(text.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// A section's paragraphs and tables, split on blank lines.
function blocksOf(text: string): Array<string> {
  return text.split("\n\n").map((block: string): string => {
    return block.trim();
  });
}

// The body rows of a table, as their cells.
function tableRows(table: string): Array<Array<string>> {
  return table
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|") && !TABLE_SEPARATOR.test(line);
    })
    .slice(1)
    .map((line: string): Array<string> => {
      return line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

// The first table of a section.
function firstTable(text: string): string {
  return (
    blocksOf(text).find((block: string): boolean => {
      return block.startsWith("|");
    }) || ""
  );
}

function namesOf(resources: Array<ResourceInfo>): Array<string> {
  return resources
    .map((resource: ResourceInfo): string => {
      return resource.name;
    })
    .sort();
}

describe("the CLI README's supported resources", () => {
  let resources: Array<ResourceInfo>;

  beforeAll(() => {
    resources = discoverResources();
  });

  it("say every resource of the API is a command, and no more of them than the CLI has", () => {
    const text: string = section("## Supported Resources");
    const claim: RegExpMatchArray | null = text.match(RESOURCE_COUNT_CLAIM);

    expect(text).toContain(
      "Every resource of the OneUptime REST API is a command: `oneuptime <resource> <subcommand>`",
    );
    expect(claim).not.toBeNull();
    expect(resources.length).toBeGreaterThanOrEqual(
      Number((claim as RegExpMatchArray)[1]),
    );
    // The CLI it replaced had 52; the claim says what changed.
    expect(Number((claim as RegExpMatchArray)[1])).toBeGreaterThan(52);
  });

  it("name by area only commands the CLI has, each once, telemetry under Telemetry", () => {
    const rows: Array<Array<string>> = tableRows(
      firstTable(section("## Supported Resources")),
    );
    const listed: Array<string> = rows.flatMap(
      (cells: Array<string>): Array<string> => {
        return codeSpans(cells[1] || "");
      },
    );
    const telemetry: Array<string> = namesOf(
      resources.filter((resource: ResourceInfo): boolean => {
        return resource.modelType === "analytics";
      }),
    );

    expect(listed).toEqual(
      expect.arrayContaining(["monitor", "incident", "alert", "status-page"]),
    );
    expect(new Set(listed).size).toBe(listed.length);
    expect(
      listed.filter((name: string): boolean => {
        return !namesOf(resources).includes(name);
      }),
    ).toEqual([]);

    for (const [area, commands] of rows.map(
      (cells: Array<string>): [string, Array<string>] => {
        return [cells[0] || "", codeSpans(cells[1] || "")];
      },
    )) {
      // Telemetry's row is all telemetry, and no other row has any.
      expect({
        area,
        telemetry: commands.filter((name: string): boolean => {
          return telemetry.includes(name);
        }),
      }).toEqual({
        area,
        telemetry: area === "Telemetry" ? commands : [],
      });
    }
  });

  it("name the --type values the resources command filters by", () => {
    const intro: string = blocksOf(section("## Supported Resources"))[1] || "";
    const types: Array<string> = [
      ...new Set(
        resources.map((resource: ResourceInfo): string => {
          return resource.modelType;
        }),
      ),
    ].sort();

    expect(types).toEqual(["analytics", "database"]);
    expect(intro).toContain("`oneuptime resources`");
    expect(intro).toContain("`--type database` for records");
    expect(intro).toContain("`--type analytics` for telemetry");
  });

  it("link to the docs' command reference, a page the docs serve", () => {
    const links: Array<string> = Array.from(
      section("## Supported Resources").matchAll(MARKDOWN_LINK),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(links).toEqual(["https://oneuptime.com/docs/cli/command-reference"]);
    expect(NAV).toContain('url: "/docs/cli/command-reference"');
    expect(
      fs.existsSync(path.join(DOCS_DIR, "cli", "command-reference.md")),
    ).toBe(true);
  });

  it("no longer say the CLI is the MCP-enabled resources, or telemetry takes three subcommands", () => {
    expect(README).not.toContain("MCP-enabled");
    expect(README).not.toContain(
      "Telemetry takes `list`, `create` and `count`",
    );
    expect(README).not.toContain("Records take `list`, `get`, `create`");
  });
});

describe("the CLI README's resource operations", () => {
  let program: Command;
  let resources: Array<ResourceInfo>;

  beforeAll(() => {
    program = addAllResourceSubcommands(buildProgram());
    resources = discoverResources();
  });

  function tableSubcommands(): Array<string> {
    return tableRows(firstTable(section("### Resource Operations"))).map(
      (cells: Array<string>): string => {
        // "`<resource> update <id> [--<field> <value>]`" -> "update"
        return (codeSpans(cells[0] || "")[0] || "").split(" ")[1] || "";
      },
    );
  }

  function describedAs(subcommand: string): string {
    const row: Array<string> | undefined = tableRows(
      firstTable(section("### Resource Operations")),
    ).find((cells: Array<string>): boolean => {
      return (codeSpans(cells[0] || "")[0] || "").split(" ")[1] === subcommand;
    });

    return row?.[1] || "";
  }

  function withAction(action: CliAction): Array<string> {
    return namesOf(
      resources.filter((resource: ResourceInfo): boolean => {
        return resource.actions.includes(action);
      }),
    );
  }

  it("list in its table every subcommand a resource can take, in the order the CLI adds them", () => {
    expect(tableSubcommands()).toEqual([
      ...CLI_OPERATIONS,
      CLI_FIELDS_SUBCOMMAND,
      ...CLI_ACTIONS,
    ]);
  });

  it("are the subcommands each resource has: its own, in the table's order", () => {
    const order: Array<string> = tableSubcommands();

    for (const resource of resources) {
      const command: Command = program.commands.find(
        (child: Command): boolean => {
          return child.name() === resource.name;
        },
      ) as Command;
      const subcommands: Array<string> = command.commands.map(
        (child: Command): string => {
          return child.name();
        },
      );

      expect({ resource: resource.name, subcommands }).toEqual({
        resource: resource.name,
        subcommands: order.filter((name: string): boolean => {
          return subcommands.includes(name);
        }),
      });
    }
  });

  it("say which resources the dashboard's buttons are on", () => {
    expect(withAction(CliAction.Acknowledge)).toEqual([
      "alert",
      "alert-episode",
      "incident",
      "incident-episode",
    ]);
    expect(withAction(CliAction.Resolve)).toEqual(
      withAction(CliAction.Acknowledge),
    );
    expect(describedAs("acknowledge")).toBe(
      "Acknowledge an incident, an alert, or an episode of either",
    );

    expect(withAction(CliAction.Start)).toEqual([
      "scheduled-maintenance-event",
    ]);
    expect(withAction(CliAction.End)).toEqual(withAction(CliAction.Start));
    // The command keeps the API's name, so the row names it beside the record's.
    expect(describedAs("start")).toBe(
      "Start a maintenance event (`scheduled-maintenance-event`)",
    );

    expect(withAction(CliAction.AddNote)).toEqual(
      [
        ...withAction(CliAction.Acknowledge),
        ...withAction(CliAction.Start),
      ].sort(),
    );
    expect(describedAs("add-note")).toContain("any of those");
  });

  it("no longer say scheduled maintenance event: one is a maintenance event (#6817)", () => {
    expect(README).not.toMatch(SCHEDULED_MAINTENANCE_EVENT);
  });

  it("say what the subcommands are for, that most take all six, and which are read only", () => {
    const sentence: string =
      blocksOf(section("### Resource Operations"))[1] || "";
    const allSix: number = resources.filter(
      (resource: ResourceInfo): boolean => {
        return resource.operations.length === CLI_OPERATIONS.length;
      },
    ).length;
    const emailLog: ResourceInfo | undefined = resources.find(
      (resource: ResourceInfo): boolean => {
        return resource.name === "email-log";
      },
    );

    expect(codeSpans(sentence)).toEqual([
      CliOperation.List,
      CliOperation.Get,
      CliOperation.Count,
      CliOperation.Create,
      CliOperation.Update,
      CliOperation.Delete,
      "oneuptime <resource> --help",
    ]);
    expect(sentence).toContain("Most resources take all six.");
    expect(allSix).toBeGreaterThan(resources.length / 2);
    expect(sentence).toContain("such as an email log, are read only");
    expect(emailLog?.operations).toEqual([
      CliOperation.List,
      CliOperation.Get,
      CliOperation.Count,
    ]);
  });
});

// Every `oneuptime ...` command line of the README's bash blocks.
function shownCommands(): Array<ShownCommand> {
  return shownCommandsIn(README, ["bash"]);
}

describe("the commands the CLI README shows", () => {
  let program: Command;

  beforeAll(() => {
    program = addAllResourceSubcommands(buildProgram());
  });

  it("are read from its bash blocks: quick start, contexts, scripting, people and deploy", () => {
    const lines: Array<string> = shownCommands().map(
      (command: ShownCommand): string => {
        return command.line;
      },
    );

    expect(lines.length).toBeGreaterThan(20);
    expect(lines).toEqual(
      expect.arrayContaining([
        "oneuptime whoami --check",
        "oneuptime incident list | jq '.[].title'",
        "oneuptime context use staging",
      ]),
    );
    expect(
      shownCommands().find((command: ShownCommand): boolean => {
        return command.words[0] === "deploy";
      })?.words,
    ).toEqual(
      expect.arrayContaining(["--service", "--service-version", "--commit"]),
    );
  });

  it("are commands the CLI has, with the flags its help lists for them", async () => {
    for (const shown of shownCommands()) {
      const commandPath: Array<string> = commandPathOf(program, shown.words);
      const command: Command = commandAt(program, commandPath);
      const run: CliRun = await runCli([...commandPath, "--help"]);
      const flags: Array<string> = shown.words.filter(
        (word: string): boolean => {
          return word.startsWith("-");
        },
      );
      // A word that is not a flag names a command: `oneuptime --version` names none.
      const namesCommand: boolean = !(shown.words[0] || "-").startsWith("-");

      /*
       * The command it names is one the CLI runs, not a group of them: a
       * misspelled subcommand stops the path at its group.
       */
      expect({
        line: shown.line,
        namesCommand: commandPath.length > 0,
        runsCommand: command.commands.length === 0,
      }).toEqual({
        line: shown.line,
        namesCommand,
        runsCommand: namesCommand,
      });
      expect({ line: shown.line, exitCode: run.exitCode }).toEqual({
        line: shown.line,
        exitCode: 0,
      });

      const listed: Array<string> = helpFlags(run.printed.join("\n"));

      for (const flag of flags) {
        expect({
          line: shown.line,
          flag,
          listed: listed.includes(flag),
        }).toEqual({ line: shown.line, flag, listed: true });
      }
    }
  });

  it("name in Create and Update flags the CLI gives, as its help writes them", async () => {
    const paragraph: string =
      blocksOf(section("### Create and Update"))[1] || "";
    const shownFlags: Array<string> = codeSpans(paragraph).filter(
      (span: string): boolean => {
        return span.startsWith("--") && span.includes(" ");
      },
    );
    const helps: string = [
      ...(await runCli(["incident", "create", "--help"])).printed,
      ...(await runCli(["monitor", "create", "--help"])).printed,
    ].join("\n");

    expect(shownFlags.length).toBeGreaterThanOrEqual(5);

    for (const flag of shownFlags) {
      /*
       * "--labels <ids>" as the help prints it: "  --labels <ids>   ...",
       * or alone on its line when it is too long to keep its description
       * beside it (Core/HelpLayout).
       */
      const listed: boolean = helps
        .split("\n")
        .some((line: string): boolean => {
          return line === `  ${flag}` || line.startsWith(`  ${flag} `);
        });

      expect({ flag, listed }).toEqual({ flag, listed: true });
    }
  });

  it("name in Create and Update the email flags beside the ID flags they stand for", async () => {
    const paragraph: string =
      blocksOf(section("### Create and Update"))[2] || "";
    const teamMember: string = (
      await runCli(["team-member", "create", "--help"])
    ).printed.join("\n");
    const ownerRule: string = (
      await runCli(["incident-owner-rule", "create", "--help"])
    ).printed.join("\n");

    expect(codeSpans(paragraph)).toEqual([
      "--user-email",
      "--user-id",
      "--owner-user-emails",
      "--owner-users",
    ]);
    expect(teamMember).toContain("--user-email <email>");
    expect(teamMember).toContain("--user-id <id>");
    expect(teamMember).toContain("Someone who is not in the project");
    expect(ownerRule).toContain("--owner-user-emails <emails>");
    expect(ownerRule).toContain("--owner-users <ids>");
  });
});
