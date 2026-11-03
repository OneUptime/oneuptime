import { Argument, Command, CommanderError, Help, Option } from "commander";
import { buildProgram } from "../Program";
import * as ConfigManager from "../Core/ConfigManager";
import { createJsonOption, createOutputOption } from "../Core/OutputFormatter";
import {
  addAllResourceSubcommands,
  discoverResources,
} from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import { getResourceSubcommands } from "../Utils/ResourceFields";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * The CLI's docs (App/FeatureSet/Docs/Content/en/cli), held to the program
 * itself: the Commander program buildProgram() builds, the resources it
 * discovers, and what its commands print. A renamed command or flag, a new
 * option, a changed default or a changed message fails here until the docs
 * say the new thing - and App's CliDocsFacts holds the same pages to the
 * CLI's sources from the docs suite. The 16 translations keep every command,
 * flag and output block as English writes them (App's CliDocsTranslations).
 *
 * A resource's subcommands are made as the program dispatches to it, so
 * these read the program with every resource's subcommands made
 * (addAllResourceSubcommands). -o and --json are on every command, and the
 * reference documents them once, with the global options.
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

const DOCS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
  "cli",
);
// In this file's throwaway home (Tests/Setup/ThrowawayHome.ts).
const CONFIG_FILE: string = path.join(
  os.homedir(),
  ".oneuptime",
  "config.json",
);

// The keys and addresses the pages' examples use.
const PRODUCTION_KEY: string = "4f1c3a2e-9b7d-4c1e-8a6f-2d5b7e9c0a13";
const STAGING_KEY: string = "7d2e8b14-5c3a-4f6e-9d1b-8a4c2e6f0b57";
const PRODUCTION_URL: string = "https://oneuptime.com";
const STAGING_URL: string = "https://oneuptime.example.com";
const EXAMPLE_ID: string = "6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11";
// The state the pages' examples move an incident to, and the one it was in.
const ACKNOWLEDGED_STATE_ID: string = "0b7d5e2c-8f4a-4d1b-9c3e-5a6f7b8c9d0e";
const CREATED_STATE_ID: string = "1c8e6f3d-9a5b-4e2c-8d4f-6b7a8c9d0e1f";

const HEADING: RegExp = /^(#{1,6})\s+(.*)$/;
const FENCE: RegExp = /^\s*```(\S*)/;
const COMMAND_HEADING: RegExp = /^### `oneuptime ([^`]+)`$/;
const CODE_SPAN: RegExp = /`([^`]+)`/g;
// A table's separator row: | --- | --- |
const TABLE_SEPARATOR: RegExp = /^\|\s*-/;
const BACKTICK: RegExp = /`/g;

interface CodeBlock {
  lang: string;
  code: string;
}

function docsPage(name: string): string {
  return fs.readFileSync(path.join(DOCS_DIR, `${name}.md`), "utf-8");
}

/*
 * A heading's section: its line and every line after it, up to the next
 * heading of the same level or higher. Headings inside code blocks are code.
 */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const found: Array<string> = [];
  let inFence: boolean = false;
  let level: number = 0;

  for (const line of lines) {
    const isFence: boolean = FENCE.test(line);
    const match: RegExpMatchArray | null =
      !inFence && !isFence ? line.match(HEADING) : null;

    if (isFence) {
      inFence = !inFence;
    }

    if (level === 0) {
      if (match && line === heading) {
        level = (match[1] as string).length;
        found.push(line);
      }
      continue;
    }

    if (match && (match[1] as string).length <= level) {
      break;
    }

    found.push(line);
  }

  if (level === 0) {
    throw new Error(`No heading "${heading}"`);
  }

  return found.join("\n");
}

function codeBlocks(markdown: string): Array<CodeBlock> {
  const blocks: Array<CodeBlock> = [];
  let current: CodeBlock | null = null;
  const lines: Array<string> = [];

  for (const line of markdown.split("\n")) {
    const fence: RegExpMatchArray | null = line.match(FENCE);

    if (fence && !current) {
      current = { lang: fence[1] as string, code: "" };
      lines.length = 0;
      continue;
    }

    if (fence && current) {
      current.code = lines.join("\n");
      blocks.push(current);
      current = null;
      continue;
    }

    if (current) {
      lines.push(line);
    }
  }

  return blocks;
}

// The body rows of the tables in a text, as their cells.
function tableRows(markdown: string): Array<Array<string>> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|") && !TABLE_SEPARATOR.test(line);
    })
    .map((line: string): Array<string> => {
      return line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

// The row of a section's tables whose first cell is this code.
function rowFor(markdown: string, code: string): Array<string> {
  const row: Array<string> | undefined = tableRows(markdown).find(
    (cells: Array<string>): boolean => {
      return cells[0] === `\`${code}\``;
    },
  );

  if (!row) {
    throw new Error(`No table row for \`${code}\``);
  }

  return row;
}

function codeSpans(text: string): Array<string> {
  return Array.from(text.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

let discovered: Array<ResourceInfo> | null = null;

// The resources the program has commands for, discovered once.
function resources(): Array<ResourceInfo> {
  if (!discovered) {
    discovered = discoverResources();
  }

  return discovered;
}

function isResourceCommand(name: string): boolean {
  return resources().some((resource: ResourceInfo): boolean => {
    return resource.name === name;
  });
}

function subcommand(command: Command, name: string): Command {
  const found: Command | undefined = command.commands.find(
    (child: Command): boolean => {
      return child.name() === name;
    },
  );

  if (!found) {
    throw new Error(`No command ${name} under ${command.name()}`);
  }

  return found;
}

// The options every command takes, which the reference documents once.
const EVERY_COMMANDS_FLAGS: ReadonlyArray<string> = [
  createOutputOption().flags,
  createJsonOption().flags,
];

/*
 * Every command a reader types, by the words after "oneuptime": the root's
 * own commands and their subcommands, the implicit help command, and each
 * resource's subcommands as "<resource> <subcommand>" - every resource's
 * that has it, since some have options others lack (--all, --public).
 */
function documentedCommandPaths(program: Command): Map<string, Array<Command>> {
  const paths: Map<string, Array<Command>> = new Map();
  const help: Help = program.createHelp();
  const add: (key: string, command: Command) => void = (
    key: string,
    command: Command,
  ): void => {
    paths.set(key, [...(paths.get(key) || []), command]);
  };

  for (const command of help.visibleCommands(program)) {
    if (isResourceCommand(command.name())) {
      for (const subcommand of command.commands) {
        add(`<resource> ${subcommand.name()}`, subcommand);
      }
      continue;
    }

    if (command.commands.length > 0) {
      for (const child of command.commands) {
        add(`${command.name()} ${child.name()}`, child);
      }
      continue;
    }

    add(command.name(), command);
  }

  return paths;
}

// The options of every command at a path, each once, by its flags.
function optionsAt(commands: Array<Command>): Array<Option> {
  const byFlags: Map<string, Option> = new Map();

  for (const command of commands) {
    for (const option of command.options) {
      byFlags.set(option.flags, option);
    }
  }

  return [...byFlags.values()];
}

// How a reader writes an argument: <name> when required, [name] otherwise.
function argumentSpec(argument: Argument): string {
  return argument.required ? `<${argument.name()}>` : `[${argument.name()}]`;
}

function referenceHeadings(): Array<string> {
  return docsPage("command-reference")
    .split("\n")
    .map((line: string): string | null => {
      return line.match(COMMAND_HEADING)?.[1] || null;
    })
    .filter((found: string | null): found is string => {
      return found !== null;
    });
}

describe("the CLI docs hold the real program", () => {
  let program: Command;

  beforeAll(() => {
    program = addAllResourceSubcommands(buildProgram());
  });

  describe("the command reference", () => {
    it("has one section for each command, and none for a command the program lacks", () => {
      const commands: Array<string> = [
        ...documentedCommandPaths(program).keys(),
      ].sort();

      expect(commands).toEqual(
        expect.arrayContaining([
          "login",
          "context list",
          "help",
          "<resource> list",
          "<resource> count",
          "<resource> fields",
          "<resource> acknowledge",
          "<resource> add-note",
        ]),
      );
      expect([...referenceHeadings()].sort()).toEqual(commands);
    });

    it("writes each command's usage with every argument it takes", () => {
      for (const [commandPath, commands] of documentedCommandPaths(program)) {
        const command: Command = commands[0] as Command;
        const usage: string = (
          codeBlocks(
            section(
              docsPage("command-reference"),
              `### \`oneuptime ${commandPath}\``,
            ),
          )[0] as CodeBlock
        ).code;

        expect(usage.startsWith(`oneuptime ${commandPath}`)).toBe(true);

        for (const argument of command.registeredArguments) {
          expect({ commandPath, usage }).toEqual({
            commandPath,
            usage: expect.stringContaining(argumentSpec(argument)),
          });
        }
      }
    });

    it("names every option of a command in its usage and in a row of its table, with its default, its choices and whether it is required", () => {
      for (const [commandPath, commands] of documentedCommandPaths(program)) {
        const text: string = section(
          docsPage("command-reference"),
          `### \`oneuptime ${commandPath}\``,
        );
        const usage: string = (codeBlocks(text)[0] as CodeBlock).code;
        const own: Array<Option> = optionsAt(commands).filter(
          (option: Option): boolean => {
            return !EVERY_COMMANDS_FLAGS.includes(option.flags);
          },
        );

        for (const option of own) {
          const short: string | undefined = option.short;
          const named: string = short || (option.long as string);

          expect({ commandPath, option: named, inUsage: true }).toEqual({
            commandPath,
            option: named,
            inUsage: usage.includes(named),
          });

          const hasDefault: boolean = typeof option.defaultValue === "string";
          // Every option has a row of its own, under its full flags.
          const row: Array<string> = rowFor(text, option.flags);

          if (hasDefault) {
            expect(row).toContain(`\`${option.defaultValue as string}\``);
          }

          if (option.mandatory) {
            expect(row[1]).toBe("Yes");
          }

          for (const choice of option.argChoices || []) {
            expect(codeSpans(row.join(" | "))).toContain(choice);
          }
        }
      }
    });

    it("documents once the options every command takes, -o and --json, which every command has", () => {
      for (const [commandPath, commands] of documentedCommandPaths(program)) {
        if (commandPath === "help") {
          continue;
        }

        for (const command of commands) {
          expect({
            commandPath,
            flags: command.options
              .map((option: Option): string => {
                return option.flags;
              })
              .filter((flags: string): boolean => {
                return EVERY_COMMANDS_FLAGS.includes(flags);
              }),
          }).toEqual({ commandPath, flags: [...EVERY_COMMANDS_FLAGS] });
        }
      }

      expect(
        section(docsPage("command-reference"), "## Global options"),
      ).toContain(
        "Every command takes `-o` and `--json`, so the tables below leave them out.",
      );
    });

    it("lists the global options, Commander's version and help flags among them, and no other", () => {
      const flags: Array<string> = program
        .createHelp()
        .visibleOptions(program)
        .map((option: Option): string => {
          return option.flags;
        });

      expect(flags).toEqual(
        expect.arrayContaining([
          "-V, --version",
          "-h, --help",
          "--api-key <key>",
          "--url <url>",
          "--context <name>",
          "-o, --output <format>",
          "--json",
          "--no-color",
        ]),
      );

      for (const page of ["command-reference", "index"]) {
        const listed: Array<string> = tableRows(
          section(docsPage(page), "## Global options"),
        )
          .slice(1)
          .map((cells: Array<string>): string => {
            return (cells[0] as string).replace(BACKTICK, "");
          });

        expect({ page, listed: [...listed].sort() }).toEqual({
          page,
          listed: [...flags].sort(),
        });
      }
    });

    it("lists every resource from the CLI's own list, whose subcommands are the program's", () => {
      const reference: string = docsPage("command-reference");
      const resourcesSection: string = section(reference, "### Resources");

      // The docs render the table from the list the program builds its commands from.
      expect(resourcesSection.split("\n")).toContain(
        "{{CLI_RESOURCE_COMMANDS}}",
      );

      for (const resource of resources()) {
        expect({
          name: resource.name,
          subcommands: subcommand(program, resource.name).commands.map(
            (child: Command): string => {
              return child.name();
            },
          ),
        }).toEqual({
          name: resource.name,
          subcommands: getResourceSubcommands(resource),
        });
      }

      // Telemetry takes the operations the API takes for it, as records do.
      for (const operation of ["get", "update", "delete"]) {
        expect(
          section(reference, `### \`oneuptime <resource> ${operation}\``),
        ).not.toContain("Records only: telemetry has no");
      }

      expect(
        resources().some((resource: ResourceInfo): boolean => {
          return (
            resource.modelType === "analytics" &&
            resource.operations.some((operation: string): boolean => {
              return operation === "get";
            })
          );
        }),
      ).toBe(true);
    });

    it("gives the output option's choices as the program does", () => {
      const choices: Array<string> = createOutputOption().argChoices || [];

      expect(choices).toEqual(["json", "table", "wide"]);
      expect(
        rowFor(
          section(docsPage("command-reference"), "## Global options"),
          "-o, --output <format>",
        )[1],
      ).toBe("`json`, `table` or `wide`");
      expect(
        tableRows(
          section(docsPage("output-formats"), "## How the format is chosen"),
        )
          .slice(1)
          .map((cells: Array<string>): string => {
            return cells[0] as string;
          })
          .sort(),
      ).toEqual(
        choices
          .map((choice: string): string => {
            return `\`${choice}\``;
          })
          .sort(),
      );
    });
  });

  describe("what the commands print, as the pages quote it", () => {
    let printed: Array<string>;

    beforeEach(() => {
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }

      printed = [];
      process.env["NO_COLOR"] = "1";
      delete process.env["ONEUPTIME_API_KEY"];
      delete process.env["ONEUPTIME_URL"];
      mockExecuteApiRequest.mockReset();
      jest
        .spyOn(console, "log")
        .mockImplementation((...args: Array<unknown>) => {
          printed.push(args.map(String).join(" "));
        });
      jest
        .spyOn(console, "error")
        .mockImplementation((...args: Array<unknown>) => {
          printed.push(args.map(String).join(" "));
        });
      jest.spyOn(process, "exit").mockImplementation((() => {
        // A command that exits stops here in the real CLI.
      }) as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      delete process.env["NO_COLOR"];
      delete process.env["ONEUPTIME_API_KEY"];
      delete process.env["ONEUPTIME_URL"];
    });

    async function run(args: Array<string>): Promise<Array<string>> {
      printed = [];
      await buildProgram().parseAsync(["node", "oneuptime", ...args]);
      return printed;
    }

    async function loginToBoth(): Promise<void> {
      await run([
        "login",
        PRODUCTION_KEY,
        `${PRODUCTION_URL}/`,
        "--context-name",
        "production",
      ]);
      await run([
        "login",
        STAGING_KEY,
        STAGING_URL,
        "--context-name",
        "staging",
      ]);
    }

    it("logs in as the pages say, under the default name unless one is given", async () => {
      expect(await run(["login", PRODUCTION_KEY, PRODUCTION_URL])).toEqual([
        'Logged in successfully. Context "default" is now active.',
      ]);
      expect(docsPage("index")).toContain(
        'It answers `Logged in successfully. Context "default" is now active.`',
      );

      expect(
        await run([
          "login",
          PRODUCTION_KEY,
          `${PRODUCTION_URL}/`,
          "--context-name",
          "production",
        ]),
      ).toEqual([
        'Logged in successfully. Context "production" is now active.',
      ]);
      expect(docsPage("authentication")).toContain(
        'It answers `Logged in successfully. Context "production" is now active.` A slash at the end of the address is removed',
      );
      expect(ConfigManager.load().contexts["production"]?.apiUrl).toBe(
        PRODUCTION_URL,
      );
    });

    it("lists contexts as the authentication page shows, the last login current", async () => {
      await loginToBoth();

      const table: string = (
        await run(["context", "list", "-o", "table"])
      ).join("\n");
      const shown: Array<CodeBlock> = codeBlocks(
        section(docsPage("authentication"), "### List them"),
      );

      expect(
        shown.map((block: CodeBlock): string => {
          return block.lang;
        }),
      ).toEqual(["bash", "text"]);
      expect((shown[0] as CodeBlock).code).toBe("oneuptime context list");
      expect(table).toBe((shown[1] as CodeBlock).code);
    });

    it("switches contexts, and whoami shows the switched-to context as the page does", async () => {
      await loginToBoth();

      expect(await run(["context", "use", "production"])).toEqual([
        'Switched to context "production".',
      ]);
      expect(docsPage("authentication")).toContain(
        'It answers `Switched to context "production".`',
      );

      const whoami: string = (await run(["whoami"])).join("\n");
      const shown: Array<CodeBlock> = codeBlocks(
        section(docsPage("authentication"), "## Check what the CLI will use"),
      );

      expect(whoami).toBe((shown[1] as CodeBlock).code);
      // The key is masked to its first four and last four characters.
      expect(whoami).toContain(
        `${PRODUCTION_KEY.slice(0, 4)}****${PRODUCTION_KEY.slice(-4)}`,
      );
    });

    it("says it is not authenticated, as the page quotes, when nothing is saved or set", async () => {
      const answer: Array<string> = await run(["whoami"]);
      const shown: Array<CodeBlock> = codeBlocks(
        section(docsPage("authentication"), "## Check what the CLI will use"),
      );

      expect(answer.join("\n")).toBe((shown[2] as CodeBlock).code);
    });

    it("saves the configuration file the authentication page shows, readable only by its user", async () => {
      await loginToBoth();
      await run(["context", "use", "production"]);

      const saved: Record<string, unknown> = JSON.parse(
        fs.readFileSync(CONFIG_FILE, "utf-8"),
      ) as Record<string, unknown>;
      const shown: CodeBlock = codeBlocks(
        section(docsPage("authentication"), "## The configuration file"),
      )[0] as CodeBlock;
      const documented: Record<string, unknown> = JSON.parse(
        shown.code,
      ) as Record<string, unknown>;

      expect(shown.lang).toBe("json");
      // The page writes <api-key> where the file holds the key itself.
      expect(
        JSON.parse(
          JSON.stringify(saved)
            .split(PRODUCTION_KEY)
            .join("<api-key>")
            .split(STAGING_KEY)
            .join("<api-key>"),
        ),
      ).toEqual(documented);

      if (process.platform !== "win32") {
        expect(fs.statSync(CONFIG_FILE).mode & 0o777).toBe(0o600);
      }
    });

    it("prints the analytics resources table the output formats page shows", async () => {
      const table: string = (
        await run(["resources", "--type", "analytics", "-o", "table"])
      ).join("\n");
      const shown: CodeBlock = codeBlocks(
        section(docsPage("output-formats"), "## Table"),
      )[0] as CodeBlock;

      expect(shown.lang).toBe("text");
      expect(table).toBe(shown.code);
    });

    it("refuses an output format it does not have with the error the page quotes", async () => {
      let error: string = "";
      const built: Command = buildProgram();

      built.exitOverride();
      built.configureOutput({
        writeErr: (text: string): void => {
          error += text;
        },
        writeOut: (): void => {
          // Nothing is printed on the way to the error.
        },
      });

      await expect(
        built.parseAsync([
          "node",
          "oneuptime",
          "incident",
          "list",
          "-o",
          "yaml",
        ]),
      ).rejects.toBeInstanceOf(CommanderError);

      const shown: CodeBlock = codeBlocks(
        section(docsPage("output-formats"), "## How the format is chosen"),
      ).find((block: CodeBlock): boolean => {
        return block.lang === "text";
      }) as CodeBlock;

      expect(error.trim()).toBe(shown.code);
      expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    });

    it("prints what each operation prints, as the output formats page lists it", async () => {
      await loginToBoth();
      const printedFor: Array<[Array<string>, unknown, Array<string>]> = [];

      for (const [args, answer] of [
        [["incident", "list", "-o", "table"], { data: [] }],
        [["incident", "list", "-o", "json"], { data: [] }],
        [["incident", "count", "-o", "table"], { count: 12 }],
        [["incident", "count", "-o", "json"], { count: 12 }],
        [
          [
            "incident",
            "update",
            EXAMPLE_ID,
            "--data",
            '{"title":"x"}',
            "-o",
            "table",
          ],
          {},
        ],
        [
          [
            "incident",
            "update",
            EXAMPLE_ID,
            "--data",
            '{"title":"x"}',
            "-o",
            "json",
          ],
          {},
        ],
        [["monitor", "delete", EXAMPLE_ID, "-o", "table"], {}],
        [["monitor", "delete", EXAMPLE_ID, "-o", "json"], {}],
      ] as Array<[Array<string>, unknown]>) {
        mockExecuteApiRequest.mockResolvedValueOnce(answer);
        printedFor.push([args, answer, await run(args)]);
      }

      const lines: Array<Array<string>> = printedFor.map(
        (entry: [Array<string>, unknown, Array<string>]): Array<string> => {
          return entry[2];
        },
      );

      expect(lines).toEqual([
        ["No results found."],
        ["[]"],
        ["12"],
        ["12"],
        [""],
        ["{}"],
        [`Monitor ${EXAMPLE_ID} deleted successfully.`],
        [JSON.stringify({ _id: EXAMPLE_ID, deleted: true }, null, 2)],
      ]);

      const table: string = section(
        docsPage("output-formats"),
        "## What each command prints",
      );

      expect(table).toContain(
        "| A `list` that finds nothing | `No results found.` | `[]` |",
      );
      expect(table).toContain("| An `update` | An empty line | `{}` |");
      expect(table).toContain(
        '| A `delete` | `Monitor <id> deleted successfully.` | The record\'s `_id` and `"deleted": true` |',
      );
      expect(docsPage("resource-operations")).toContain(
        `It answers \`Monitor ${EXAMPLE_ID} deleted successfully.\``,
      );
    });

    it("deletes without asking, whether or not --force is given", async () => {
      await loginToBoth();

      for (const args of [
        ["monitor", "delete", EXAMPLE_ID],
        ["monitor", "delete", EXAMPLE_ID, "--force"],
      ]) {
        mockExecuteApiRequest.mockResolvedValueOnce({});
        expect(await run(args)).toEqual([
          `Monitor ${EXAMPLE_ID} deleted successfully.`,
        ]);
      }

      expect(mockExecuteApiRequest).toHaveBeenCalledTimes(2);
      expect(docsPage("resource-operations")).toContain(
        "The CLI does not ask you to confirm, and there is no undo. It accepts `--force`, for scripts written with it, and `--force` changes nothing.",
      );
    });

    it("lists ten records, from the first, unless told otherwise, as the list tables say", async () => {
      await loginToBoth();
      mockExecuteApiRequest.mockResolvedValueOnce({ data: [] });
      await run(["incident", "list", "-o", "json"]);

      expect(mockExecuteApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "list", limit: 10, skip: 0 }),
      );

      for (const page of ["command-reference", "resource-operations"]) {
        const text: string = docsPage(page);

        expect(rowFor(text, "--limit <n>")).toContain("`10`");
        expect(rowFor(text, "--skip <n>")).toContain("`0`");
      }
    });

    // What OneUptime answers an acknowledge with: the state, the incident, the timeline row.
    function answerAcknowledge(): void {
      mockExecuteApiRequest
        .mockResolvedValueOnce({
          data: [
            {
              _id: ACKNOWLEDGED_STATE_ID,
              name: "Acknowledged",
              order: 2,
              isAcknowledgedState: true,
              isResolvedState: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          _id: EXAMPLE_ID,
          currentIncidentState: {
            _id: CREATED_STATE_ID,
            name: "Created",
            order: 1,
            isAcknowledgedState: false,
            isResolvedState: false,
          },
        })
        .mockResolvedValueOnce({ _id: "a-timeline-row" });
    }

    it("acknowledges as the pages quote it, in a sentence and in JSON", async () => {
      await loginToBoth();

      answerAcknowledge();
      expect(await run(["incident", "acknowledge", EXAMPLE_ID])).toEqual([
        `Incident ${EXAMPLE_ID} acknowledged: it is in Acknowledged now.`,
      ]);
      expect(docsPage("resource-operations")).toContain(
        `\`acknowledge\` answers \`Incident ${EXAMPLE_ID} acknowledged: it is in Acknowledged now.\``,
      );

      answerAcknowledge();

      const json: string = (
        await run(["incident", "acknowledge", EXAMPLE_ID, "-o", "json"])
      ).join("\n");
      const shown: CodeBlock = codeBlocks(
        section(docsPage("ai-agents"), "## Read the answers"),
      ).find((block: CodeBlock): boolean => {
        return block.lang === "json";
      }) as CodeBlock;

      expect(json).toBe(shown.code);
      expect(
        codeBlocks(section(docsPage("ai-agents"), "## Read the answers"))[0]
          ?.code,
      ).toBe(`oneuptime incident acknowledge ${EXAMPLE_ID} -o json`);
    });

    it("writes an error asked for JSON as the output formats page shows it", async () => {
      const argv: Array<string> = process.argv;
      const args: Array<string> = ["incident", "get", EXAMPLE_ID, "--json"];

      await loginToBoth();
      mockExecuteApiRequest.mockRejectedValueOnce(
        new Error("API error (404): Incident not found."),
      );

      let answer: Array<string> = [];

      try {
        // The error handler reads the command line as the CLI is given it.
        process.argv = ["node", "oneuptime", ...args];
        answer = await run(args);
      } finally {
        process.argv = argv;
      }

      const blocks: Array<CodeBlock> = codeBlocks(
        section(docsPage("output-formats"), "## JSON"),
      );
      const command: number = blocks.findIndex((block: CodeBlock): boolean => {
        return block.code === `oneuptime ${args.join(" ")}`;
      });

      expect(command).toBeGreaterThan(-1);
      expect(answer.join("\n")).toBe((blocks[command + 1] as CodeBlock).code);
      expect(process.exit).toHaveBeenCalledWith(3);
    });

    it("uses a flag before an environment variable, and an environment variable before a context", async () => {
      await loginToBoth();
      process.env["ONEUPTIME_API_KEY"] = "env-key-0000";

      mockExecuteApiRequest.mockResolvedValue({ count: 1 });
      await run(["incident", "count", "-o", "json"]);
      await run([
        "incident",
        "count",
        "--api-key",
        "flag-key-0000",
        "-o",
        "json",
      ]);

      // The environment's key with the current context's URL, then the flag's.
      expect(mockExecuteApiRequest.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          apiKey: "env-key-0000",
          apiUrl: STAGING_URL,
        }),
      );
      expect(mockExecuteApiRequest.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          apiKey: "flag-key-0000",
          apiUrl: STAGING_URL,
        }),
      );
      expect(docsPage("authentication")).toContain(
        "So you can mix them: an API key from an environment variable with the URL of the current context, for example.",
      );
    });
  });
});
