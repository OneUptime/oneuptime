import { Command } from "commander";
import { buildProgram } from "../Program";
import { addResourceSubcommands } from "../Commands/ResourceCommands";
import { formatHelpToFit, HELP_TERM_COLUMN_LIMIT } from "../Core/HelpLayout";
import { addFieldFlags } from "../Utils/FieldFlags";
import { CliRun, runCli } from "./Helpers/RunCli";
import Incident from "Common/Models/DatabaseModels/Incident";
import { CliOperation } from "Common/Utils/DeveloperDocs/CliCommands";

/*
 * --help, laid out to read in a terminal (Core/HelpLayout). A create's
 * longest flag runs past 70 characters; padded to it, as Commander pads
 * every option, each description of `oneuptime incident create --help`
 * started at column 81, and a terminal folded every line back to its
 * first column. These hold the column of flags to what most flags need,
 * with a longer flag on a line of its own and its description under it.
 */

// Where an item starts, and where every description starts after it.
const ITEM_INDENT: number = 2;
const DESCRIPTION_COLUMN: number = ITEM_INDENT + HELP_TERM_COLUMN_LIMIT + 2;

function commandAt(program: Command, path: Array<string>): Command {
  let command: Command = program;

  for (const name of path) {
    command = command.commands.find((child: Command): boolean => {
      return child.name() === name;
    }) as Command;
  }

  return command;
}

// `oneuptime incident create`, with its field flags, as a run makes it.
function incidentCreate(): { program: Command; create: Command } {
  const program: Command = buildProgram();
  const incident: Command = commandAt(program, ["incident"]);

  addResourceSubcommands(incident);

  const create: Command = commandAt(incident, [CliOperation.Create]);

  addFieldFlags({
    command: create,
    modelType: Incident,
    operation: CliOperation.Create,
  });

  return { program, create };
}

function helpAt(command: Command, width: number): string {
  command.configureHelp({ ...command.configureHelp(), helpWidth: width });

  return command.helpInformation();
}

// The lines of a help's section, "Options:" to the blank line after it.
function sectionLines(help: string, heading: string): Array<string> {
  const lines: Array<string> = help.split("\n");
  const start: number = lines.indexOf(heading);
  const end: number = lines.indexOf("", start);

  return lines.slice(start + 1, end);
}

// An item's own line: its flag, argument or command, from the indent.
function isItemLine(line: string): boolean {
  return line.length > ITEM_INDENT && line.charAt(ITEM_INDENT) !== " ";
}

describe("--help laid out for a terminal", () => {
  it("gives every command the layout, those made as the program dispatches included", async () => {
    const { program, create } = incidentCreate();

    expect(program.configureHelp().formatHelp).toBe(formatHelpToFit);
    expect(create.configureHelp().formatHelp).toBe(formatHelpToFit);

    // A run makes them itself: its help is the same.
    const run: CliRun = await runCli(["incident", "create", "--help"]);

    expect(run.exitCode).toBe(0);
    expect(run.printed.join("\n")).toBe(
      helpAt(incidentCreate().create, 80).replace(TRAILING_NEWLINE, ""),
    );
  });

  it("starts every description of a create's flags at one column, wrapped to the width", () => {
    for (const width of [80, 120]) {
      const options: Array<string> = sectionLines(
        helpAt(incidentCreate().create, width),
        "Options:",
      );

      expect(options.length).toBeGreaterThan(30);

      for (const line of options) {
        if (isItemLine(line)) {
          // A flag, and its description beside it at the column.
          const flag: string = line.slice(ITEM_INDENT).split("  ")[0] || "";

          if (flag.length <= HELP_TERM_COLUMN_LIMIT) {
            expect({ line, width, fits: line.length <= width }).toEqual({
              line,
              width,
              fits: true,
            });

            // Its description starts at the column, after a gap.
            expect({
              line,
              gap: line.slice(DESCRIPTION_COLUMN - 2, DESCRIPTION_COLUMN),
              starts: NOT_SPACE.test(line.charAt(DESCRIPTION_COLUMN)),
            }).toEqual({ line, gap: "  ", starts: true });
          }

          continue;
        }

        // A description's line: at the column, and no wider than the width.
        expect({ line, width, indent: line.search(NOT_SPACE) }).toEqual({
          line,
          width,
          indent: DESCRIPTION_COLUMN,
        });
        expect({ line, width, fits: line.length <= width }).toEqual({
          line,
          width,
          fits: true,
        });
      }
    }
  });

  it("puts a flag too long for the column on a line of its own, with its description under it", () => {
    const options: Array<string> = sectionLines(
      helpAt(incidentCreate().create, 80),
      "Options:",
    );
    const long: number = options.findIndex((line: string): boolean => {
      return line.startsWith(
        "  --should-status-page-subscribers-be-notified-on-incident-created",
      );
    });

    expect(long).toBeGreaterThan(-1);
    expect(options[long]).toBe(
      "  --should-status-page-subscribers-be-notified-on-incident-created [true|false]",
    );
    expect(options[long + 1]?.search(NOT_SPACE)).toBe(DESCRIPTION_COLUMN);
    expect(options[long + 1]?.trim()).toMatch(LETTER_FIRST);
  });

  it("keeps a short flag and its description on one line", () => {
    const options: Array<string> = sectionLines(
      helpAt(incidentCreate().create, 120),
      "Options:",
    );
    const title: string | undefined = options.find((line: string): boolean => {
      return line.startsWith("  --title <text>");
    });

    expect(title).toBe(
      `  ${"--title <text>".padEnd(HELP_TERM_COLUMN_LIMIT + 2)}Required. Title of this incident.`,
    );
  });

  it("lays out a help whose items all fit as Commander does", () => {
    const program: Command = buildProgram();
    const incident: Command = commandAt(program, ["incident"]);

    addResourceSubcommands(incident);

    const ours: string = helpAt(incident, 80);

    incident.configureHelp({ helpWidth: 80 });

    // Commander's own layout, with no item past the column.
    expect(ours).toBe(incident.helpInformation());
  });

  it("lists the root's commands at the column, a long one on a line of its own", () => {
    const commands: Array<string> = sectionLines(
      helpAt(buildProgram(), 100),
      "Commands:",
    );
    const login: number = commands.indexOf(
      "  login [options] <api-key> <instance-url>",
    );

    expect(commands.length).toBeGreaterThan(450);
    expect(login).toBeGreaterThan(-1);
    expect(commands[login + 1]?.search(NOT_SPACE)).toBe(DESCRIPTION_COLUMN);
    expect(commands).toContain(
      `  ${"incident".padEnd(HELP_TERM_COLUMN_LIMIT + 2)}Manage Incidents (database)`,
    );
  });
});

const TRAILING_NEWLINE: RegExp = /\n$/;
const NOT_SPACE: RegExp = /\S/;
const LETTER_FIRST: RegExp = /^[A-Z]/;
