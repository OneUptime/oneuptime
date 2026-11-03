import {
  AI_AGENTS,
  AUTHENTICATION,
  CLI_OVERVIEW,
  COMMAND_REFERENCE,
  OUTPUT_FORMATS,
  RESOURCE_OPERATIONS,
  SCRIPTING,
} from "./CliDocsPages";
import {
  CliCommand,
  CliOption,
  CliProgram,
  COMMANDER_HELP_COMMAND,
  COMMANDER_HELP_FLAGS,
  COMMANDER_VERSION_FLAGS,
  RESOURCE_COMMAND,
  everyCommandsOptionFlags,
  jsonOptionFlags,
  operationRegisterFunctions,
  outputOptionFlags,
  readCliProgram,
} from "./CliDocsSupport";
import { scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { escapeRegExp } from "./DocsTranslationChecks";
import {
  codeIn,
  englishPage,
  englishSection,
  readRepoFile,
  rowStartingWith,
  sourceFilesUnder,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import {
  CLI_RESOURCE_COMMANDS_PLACEHOLDER,
  getCliResourceSubcommands,
  getCliResourcesByCommand,
} from "../../../FeatureSet/Docs/Utils/CliCommandsTable";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  InstallScriptName,
  getInstallScriptEntry,
} from "Common/Types/InstallScripts/InstallScripts";
import {
  CLI_ACTIONS,
  CLI_FIELDS_SUBCOMMAND,
  CLI_OPERATIONS,
  CliAction,
  CliFieldFlag,
  CliOperation,
  getCliFieldFlags,
  getCliNoteTarget,
  getCliResourceName,
  getCliStateMachine,
} from "Common/Utils/DeveloperDocs/CliCommands";
import {
  getCliConnectCommands,
  getCliInstallScriptCommands,
} from "Common/Utils/DeveloperDocs/CliExamples";
import {
  CliResource,
  getCliResources,
} from "Common/Utils/DeveloperDocs/CliResources";
import {
  LABEL_NAME_COLUMN,
  LABEL_NAME_SORT_KEY_COLUMN,
  getLabelListSort,
  sortLabelNames,
} from "Common/Utils/LabelOrder";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 29: what the CLI pages say, held to the code that makes
 * it true. CliDocsTranslations holds the 16 translations to these English
 * pages line for line, so a fact that changes here changes in every language
 * with the English.
 *
 * The commands, their arguments, options and defaults are read from the
 * CLI's own sources (CliDocsSupport parses the chains of Commander calls), so
 * renaming a command or a flag, adding an option or changing a default fails
 * this suite until the pages say the new thing. Which resources there are,
 * and the operations and actions of each, are read from Common's
 * CliResources, which the CLI builds its commands from - the command
 * reference lists them from there too ({{CLI_RESOURCE_COMMANDS}}). What the
 * pages say the CLI does - where it saves contexts, which credentials win,
 * how it prints, how it exits - is read from the source that does it, and
 * what they say about the API behind it from the API's code. The CLI's own
 * suite (packages/CLI/Tests/CommandReferenceDocs) runs the real program
 * against the same pages: the output they quote is the output it prints.
 */

const CLI: string = "CLI";
const OUR_ADDRESS: string = "https://oneuptime.com";

/*
 * The first release whose CLI starts once npm has installed it (#4872,
 * fixed by #4900: the CLI is published as one bundled file). Every CLI npm
 * has from before it - 1.0.0, then 10.0.5 to 14.0.63 - dies at start with
 * "Cannot find module 'Common/...'": tsc left the CLI's imports of Common as
 * bare require("Common/...") calls that no installed package could answer.
 */
const FIRST_CLI_THAT_STARTS: string = "14.0.64";

/*
 * How many resources the pages say the CLI has a command for, at least:
 * "450 and more". The CLI had 456 when they first said so.
 */
const RESOURCE_COUNT_CLAIM: number = 450;

// a < b: negative; a = b: 0; a > b: positive. Versions as VERSION writes them.
function compareVersions(a: string, b: string): number {
  const left: Array<number> = a.split(".").map(Number);
  const right: Array<number> = b.split(".").map(Number);

  for (let index: number = 0; index < 3; index++) {
    const difference: number = (left[index] || 0) - (right[index] || 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

const WHITESPACE_RUN: RegExp = /\s+/g;
const ENVIRONMENT_READ: RegExp = /process\.env\["([A-Z_]+)"\]/g;
// A member of a numeric enum: "  AuthError = 2,".
const ENUM_MEMBER: RegExp = /^\s+\w+ = (\d+),$/gm;
// A sort order written as a number, which the analytics API does not read.
const NUMERIC_SORT: RegExp = /"createdAt":\s*-?1/;
// A row of the generated resources table: | `incident` | Incidents | `list`, ... |
const GENERATED_ROW: RegExp = /^\| `([a-z0-9-]+)` \| [^|]+ \| (.+) \|$/;

function cliSource(relativePath: string): string {
  return readRepoFile(`${CLI}/${relativePath}`);
}

// One line of text: a page's paragraph or a source's statement, unwrapped.
function flat(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

// The code blocks of a text, in order: [language, code].
function codeBlocksOf(text: string): Array<[string, string]> {
  return scanMarkdown(text).fences.map(
    (fence: { lang: string; code: string }): [string, string] => {
      return [fence.lang, fence.code];
    },
  );
}

// Every row of every table of a text, header rows included.
function rowsOf(text: string): Array<Array<string>> {
  return tables(text).flat();
}

// The row of a text's tables whose first cell is this code.
function rowOfCode(text: string, code: string): Array<string> {
  return rowStartingWith(rowsOf(text), `\`${code}\``);
}

function commandSection(command: CliCommand): string {
  return englishSection(COMMAND_REFERENCE, `### \`oneuptime ${command.path}\``);
}

// What a reader types for an option: its short flag when it has one.
function typedFlag(option: CliOption): string {
  return option.flags.split(",")[0]?.split(" ")[0] as string;
}

// A command's own options: all but the ones every command takes.
function ownOptions(command: CliCommand): Array<CliOption> {
  return command.options.filter((option: CliOption): boolean => {
    return !everyCommandsOptionFlags().includes(option.flags);
  });
}

function resourceNamed(name: string): CliResource {
  const found: CliResource | undefined = getCliResources().find(
    (resource: CliResource): boolean => {
      return resource.name === name;
    },
  );

  if (!found) {
    throw new Error(`The CLI has no resource ${name}`);
  }

  return found;
}

function flagsOf(modelType: DatabaseBaseModelType): Array<string> {
  return getCliFieldFlags(modelType).map((flag: CliFieldFlag): string => {
    return flag.flag;
  });
}

function incidentHas(relation: string): boolean {
  return readRepoFile("Common/Models/DatabaseModels/Incident.ts").includes(
    `public ${relation}?:`,
  );
}

function commandNamed(program: CliProgram, commandPath: string): CliCommand {
  const found: CliCommand | undefined = program.commands.find(
    (command: CliCommand): boolean => {
      return command.path === commandPath;
    },
  );

  if (!found) {
    throw new Error(`The CLI has no command ${commandPath}`);
  }

  return found;
}

describe("the command reference", () => {
  const program: CliProgram = readCliProgram();
  // Each command by its path, for the tests that run once per command.
  const commandsByPath: Array<[string, CliCommand]> = program.commands.map(
    (command: CliCommand): [string, CliCommand] => {
      return [command.path, command];
    },
  );

  it("reads the CLI's commands from its sources", () => {
    // The reading itself, held to what the CLI's sources plainly build.
    expect(
      program.commands.map((command: CliCommand): string => {
        return command.path;
      }),
    ).toEqual(
      expect.arrayContaining([
        "login",
        "context list",
        "context use",
        "context current",
        "context delete",
        "version",
        "whoami",
        "resources",
        "deploy",
        "<resource> list",
        "<resource> get",
        "<resource> create",
        "<resource> update",
        "<resource> delete",
        "<resource> count",
        "<resource> fields",
        "<resource> acknowledge",
        "<resource> resolve",
        "<resource> start",
        "<resource> end",
        "<resource> add-note",
        "help",
      ]),
    );
    expect(cliSource("Commands/ConfigCommands.ts")).toContain(
      '.option("--context-name <name>", "Name for this context", "default")',
    );

    // A resource's subcommands are Common's operations, fields and actions, each once.
    expect(
      program.commands
        .filter((command: CliCommand): boolean => {
          return command.path.startsWith(`${RESOURCE_COMMAND} `);
        })
        .map((command: CliCommand): string => {
          return command.path.slice(RESOURCE_COMMAND.length + 1);
        }),
    ).toEqual([...CLI_OPERATIONS, CLI_FIELDS_SUBCOMMAND, ...CLI_ACTIONS]);
    expect(Object.keys(operationRegisterFunctions())).toEqual([
      ...CLI_OPERATIONS,
    ]);

    // What only some resources' commands have: --all, and --public.
    const all: CliOption | undefined = commandNamed(
      program,
      "<resource> list",
    ).options.find((option: CliOption): boolean => {
      return option.flags === "--all";
    });
    const note: CliCommand = commandNamed(program, "<resource> add-note");

    expect(all?.onlySome).toBe(true);
    expect(
      note.options.map((option: CliOption): Array<string | boolean> => {
        return [option.flags, option.required, option.onlySome];
      }),
    ).toEqual(
      expect.arrayContaining([
        ["--note <markdown>", true, false],
        ["--public", false, true],
      ]),
    );
  });

  it("has a section for each command, and none for a command the CLI lacks", () => {
    const headings: Array<string> = englishPage(COMMAND_REFERENCE)
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("### `oneuptime ");
      })
      .map((line: string): string => {
        return line.slice("### `oneuptime ".length, -1);
      })
      .sort();

    expect(headings).toEqual(
      program.commands
        .map((command: CliCommand): string => {
          return command.path;
        })
        .sort(),
    );
  });

  it.each(commandsByPath)(
    "writes the usage of oneuptime %s with its arguments and options",
    (_path: string, command: CliCommand) => {
      const usage: string = (codeBlocksOf(commandSection(command))[0] || [
        "",
        "",
      ])[1];

      expect(usage.startsWith(`oneuptime ${command.path}`)).toBe(true);

      for (const argument of command.arguments) {
        expect(usage).toContain(argument);
      }

      for (const option of ownOptions(command)) {
        expect({ option: option.flags, usage }).toEqual({
          option: option.flags,
          usage: expect.stringContaining(typedFlag(option)),
        });
      }
    },
  );

  it.each(commandsByPath)(
    "gives every option of oneuptime %s a row with its default and whether it is required",
    (_path: string, command: CliCommand) => {
      const text: string = commandSection(command);

      for (const option of ownOptions(command)) {
        const row: Array<string> = rowOfCode(text, option.flags);

        if (option.defaultValue !== null) {
          expect(row).toContain(`\`${option.defaultValue}\``);
        }

        /*
         * The Required column, where the section's table has one: "Yes" for
         * an option .requiredOption() declares, and only for one.
         */
        if (tables(text)[0]?.[0]?.[1] === "Required") {
          expect({ option: option.flags, required: row[1] === "Yes" }).toEqual({
            option: option.flags,
            required: option.required,
          });
        }
      }
    },
  );

  it("documents once the options every command takes: every command has -o and --json", () => {
    for (const command of program.commands) {
      if (command.path === COMMANDER_HELP_COMMAND) {
        continue;
      }

      expect({
        command: command.path,
        flags: command.options
          .map((option: CliOption): string => {
            return option.flags;
          })
          .filter((flags: string): boolean => {
            return everyCommandsOptionFlags().includes(flags);
          }),
      }).toEqual({
        command: command.path,
        flags: [outputOptionFlags(), jsonOptionFlags()],
      });
    }

    expect(
      flat(englishSection(COMMAND_REFERENCE, "## Global options")),
    ).toContain(
      "Every command takes `-o` and `--json`, so the tables below leave them out. A command whose answer is a sentence, such as `delete`, prints the sentence unless `-o json` or `--json` asks for JSON",
    );
  });

  it("lists exactly the global options on the reference and on the overview", () => {
    const flags: Array<string> = program.globalOptions
      .map((option: CliOption): string => {
        return option.flags;
      })
      .sort();

    expect(flags).toContain(COMMANDER_VERSION_FLAGS);
    expect(flags).toContain(COMMANDER_HELP_FLAGS);
    expect(flags).toContain(outputOptionFlags());
    expect(flags).toContain(jsonOptionFlags());

    for (const page of [COMMAND_REFERENCE, CLI_OVERVIEW]) {
      const listed: Array<string> = tableWithHeader(
        englishSection(page, "## Global options"),
        "Option",
      )
        .map((row: Array<string>): string => {
          return codeIn(row[0] as string)[0] as string;
        })
        .sort();

      expect({ page, listed }).toEqual({ page, listed: flags });
    }
  });

  it("says the global options go before or after the command, as Commander reads them without positional options", () => {
    expect(cliSource("Program.ts")).not.toContain("enablePositionalOptions");
    expect(cliSource("Core/OutputFormatter.ts")).toContain(
      "enablePositionalOptions, Commander lets the root program consume its\n * global -o wherever it appears on the command line",
    );
    expect(
      flat(englishSection(COMMAND_REFERENCE, "## Global options")),
    ).toContain(
      "The options go before or after the command: `oneuptime --context staging incident list` and `oneuptime incident list --context staging` do the same.",
    );
    expect(englishPage(CLI_OVERVIEW)).toContain(
      "These options work with every command, before or after it:",
    );
  });

  it("lists every resource command from the CLI's own list, with its subcommands, in every language", () => {
    const section: string = englishSection(COMMAND_REFERENCE, "### Resources");

    expect(section.split("\n")).toContain(CLI_RESOURCE_COMMANDS_PLACEHOLDER);

    for (const language of ["en", "de", "fa"]) {
      const rows: Array<[string, Array<string>]> = DocsPlaceholders.render(
        CLI_RESOURCE_COMMANDS_PLACEHOLDER,
        language,
      )
        .split("\n")
        .slice(2)
        .map((line: string): [string, Array<string>] => {
          const match: RegExpMatchArray | null = line.match(GENERATED_ROW);

          if (!match) {
            throw new Error(`Not a row of the resources table: ${line}`);
          }

          return [match[1] as string, codeIn(match[2] as string)];
        });

      expect(rows).toEqual(
        getCliResourcesByCommand().map(
          (resource: CliResource): [string, Array<string>] => {
            return [resource.name, getCliResourceSubcommands(resource)];
          },
        ),
      );
    }

    // The CLI lists them from the same place, by the same names.
    expect(cliSource("Commands/ResourceCommands.ts")).toContain(
      '} from "Common/Utils/DeveloperDocs/CliResources";',
    );
    expect(getCliResources().length).toBeGreaterThanOrEqual(
      RESOURCE_COUNT_CLAIM,
    );
    expect(flat(section)).toContain(
      "Every resource of the OneUptime API is a command, with the operations the API takes for it, `fields`, and the actions of the records that have them:",
    );
  });

  it("says a resource has the operations the API takes for it, most of them all six, and which are only read", () => {
    const all: Array<CliResource> = getCliResources();
    const allSix: number = all.filter((resource: CliResource): boolean => {
      return resource.operations.length === CLI_OPERATIONS.length;
    }).length;

    // The rule the API documents itself by: a record needs a table, its docs and an API path.
    expect(readRepoFile("Common/Utils/DeveloperDocs/CliCommands.ts")).toContain(
      "if (!(model.tableName && model.enableDocumentation && model.crudApiPath)) {",
    );
    expect(allSix).toBeGreaterThan(all.length / 2);
    expect(resourceNamed("email-log").operations).toEqual([
      CliOperation.List,
      CliOperation.Get,
      CliOperation.Count,
    ]);
    expect(
      flat(
        englishSection(RESOURCE_OPERATIONS, "## Find the command for a record"),
      ),
    ).toContain(
      "A resource takes the operations the API takes for it. Most take all six; one that OneUptime writes itself, such as an email log, is read only.",
    );
    expect(
      flat(englishSection(COMMAND_REFERENCE, "## Resource commands")),
    ).toContain(
      "A resource has the operations the API takes for it, most of them all six, and `oneuptime <resource> --help` lists its own.",
    );

    // Both types, records and telemetry, as `oneuptime resources --type` takes them.
    expect(
      tableWithHeader(
        englishSection(RESOURCE_OPERATIONS, "## Find the command for a record"),
        "Type",
      ).map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(["`database`", "`analytics`"]);
    expect(
      [
        ...new Set(
          all.map((resource: CliResource): string => {
            return resource.modelType;
          }),
        ),
      ].sort(),
    ).toEqual(["analytics", "database"]);

    // --all is a record's: telemetry is read a page at a time.
    expect(cliSource("Commands/ResourceCommands.ts")).toContain(
      'if (resource.modelType === "database") {\n    command.addOption(\n      new Option(\n        "--all",',
    );
    expect(
      rowOfCode(
        englishSection(COMMAND_REFERENCE, "### `oneuptime <resource> list`"),
        "--all",
      )[1],
    ).toContain("Records only: telemetry has no `--all`");
  });

  it("names the resources the dashboard's buttons are on, as the CLI's state machines and notes have them", () => {
    const withAction: (action: CliAction) => Array<string> = (
      action: CliAction,
    ): Array<string> => {
      return getCliResources()
        .filter((resource: CliResource): boolean => {
          return resource.actions.includes(action);
        })
        .map((resource: CliResource): string => {
          return resource.name;
        })
        .sort();
    };
    const actions: Array<Array<string>> = tableWithHeader(
      englishSection(
        RESOURCE_OPERATIONS,
        "## Acknowledge, resolve and add notes",
      ),
      "Command",
    );

    expect(withAction(CliAction.Acknowledge)).toEqual([
      "alert",
      "alert-episode",
      "incident",
      "incident-episode",
    ]);
    expect(withAction(CliAction.Resolve)).toEqual(
      withAction(CliAction.Acknowledge),
    );
    expect(withAction(CliAction.Start)).toEqual([
      "scheduled-maintenance-event",
    ]);
    expect(withAction(CliAction.End)).toEqual(withAction(CliAction.Start));
    expect(withAction(CliAction.AddNote)).toHaveLength(5);
    expect(
      actions.map((row: Array<string>): string => {
        return codeIn(row[0] as string)[0]?.split(" ")[0] as string;
      }),
    ).toEqual([...CLI_ACTIONS]);
    expect(
      codeIn(
        rowStartingWith(actions, "`acknowledge <id>`")[2] as string,
      ).sort(),
    ).toEqual(withAction(CliAction.Acknowledge));
    expect(
      codeIn(rowStartingWith(actions, "`start <id>`")[2] as string),
    ).toEqual(withAction(CliAction.Start));

    // Only some records take a public note: alerts take internal notes only.
    expect(getCliNoteTarget("Alert")?.publicNoteModelType).toBeUndefined();
    expect(
      getCliNoteTarget("AlertEpisode")?.publicNoteModelType,
    ).toBeUndefined();
    expect(getCliNoteTarget("Incident")?.publicNoteModelType).toBeDefined();
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "Alerts and alert episodes take internal notes only.",
    );
  });

  it("maps each operation to the request ApiClient sends, with the key in the APIKey header", () => {
    const client: string = cliSource("Core/ApiClient.ts");
    const requests: Array<Array<string>> = tableWithHeader(
      englishSection(COMMAND_REFERENCE, "### API requests"),
      "Operation",
    );
    const expected: Array<[string, string, string]> = [
      [
        "list",
        "`POST /api/<path>/get-list`",
        "fullPath = `/api${apiPath}/get-list`;",
      ],
      [
        "get",
        "`POST /api/<path>/<id>/get-item`",
        "fullPath = `/api${apiPath}/${id}/get-item`;",
      ],
      ["create", "`POST /api/<path>`", "fullPath = `/api${apiPath}`;"],
      [
        "update",
        "`PUT /api/<path>/<id>/`",
        "fullPath = `/api${apiPath}/${id}/`;",
      ],
      [
        "delete",
        "`DELETE /api/<path>/<id>/`",
        "fullPath = `/api${apiPath}/${id}/`;",
      ],
      [
        "count",
        "`POST /api/<path>/count`",
        "fullPath = `/api${apiPath}/count`;",
      ],
    ];

    for (const [operation, request, route] of expected) {
      expect(rowStartingWith(requests, `\`${operation}\``)[1]).toBe(request);
      expect(client).toContain(route);
    }

    // POST for list, get, create and count; PUT to update; DELETE to delete.
    expect(flat(client)).toContain(
      'case "create": case "count": case "list": case "read": response = await API.post(',
    );
    expect(flat(client)).toContain('case "update": response = await API.put(');
    expect(flat(client)).toContain(
      'case "delete": response = await API.delete(',
    );
    expect(client).toContain("APIKey: apiKey,");
    expect(englishSection(COMMAND_REFERENCE, "### API requests")).toContain(
      "with the key in the `APIKey` header",
    );

    // What a list's body holds.
    expect(flat(client)).toContain(
      "query: options.query || {}, select: options.select || {}, skip: options.skip || 0, limit: options.limit || 10, sort: options.sort || {},",
    );
    expect(rowStartingWith(requests, "`list`")[2]).toBe(
      "`query`, `select`, `skip`, `limit` and `sort`",
    );
  });

  it("says which records an action and a note create, and the lookups and retries a command makes", () => {
    const incident: { timeline: string; internal: string; public: string } = {
      timeline: getCliResourceName(
        new (getCliStateMachine("Incident")!.timelineModelType)(),
      ),
      internal: getCliResourceName(
        new (getCliNoteTarget("Incident")!.internalNoteModelType)(),
      ),
      public: getCliResourceName(
        new (getCliNoteTarget("Incident")!.publicNoteModelType!)(),
      ),
    };
    const requests: string = flat(
      englishSection(COMMAND_REFERENCE, "### API requests"),
    );

    expect(incident).toEqual({
      timeline: "incident-state-timeline",
      internal: "incident-internal-note",
      public: "incident-public-note",
    });
    expect(requests).toContain(
      "An action reads your project's states and the record, then creates a row of the record's state timeline, as the dashboard's button does: `acknowledge` on an incident creates an `incident-state-timeline`. `add-note` creates an `incident-internal-note`, or with `--public` an `incident-public-note`.",
    );

    // An email flag: the project's team members with that address.
    expect(flat(cliSource("Utils/People.ts"))).toContain(
      'apiPath: getModelApiPathOf(TeamMember), operation: "list", query: { user: { email } },',
    );
    expect(requests).toContain(
      "An email flag first lists the project's team members with that address.",
    );

    // A refused field: asked again without it.
    expect(cliSource("Commands/ResourceCommands.ts")).toContain(
      "getRefusedSelectColumn(error.message)",
    );
    expect(requests).toContain(
      "When OneUptime refuses a field the key may not read, a list or a get asks again without it.",
    );
  });

  it("gives the API paths of incident and on-call-policy from their models", () => {
    expect(readRepoFile("Common/Models/DatabaseModels/Incident.ts")).toContain(
      '@CrudApiEndpoint(new Route("/incident"))',
    );

    const policy: string = readRepoFile(
      "Common/Models/DatabaseModels/OnCallDutyPolicy.ts",
    );

    expect(policy).toContain(
      '@CrudApiEndpoint(new Route("/on-call-duty-policy"))',
    );
    expect(resourceNamed("on-call-policy").apiPath).toBe(
      "/on-call-duty-policy",
    );
    expect(resourceNamed("incident").apiPath).toBe("/incident");
    expect(englishSection(COMMAND_REFERENCE, "### API requests")).toContain(
      "`/incident` for `incident`, `/on-call-duty-policy` for `on-call-policy`.",
    );
  });

  it("lists the environment variables the CLI reads, and the configuration file", () => {
    const read: Array<string> = [
      ...cliSource("Core/ConfigManager.ts").matchAll(ENVIRONMENT_READ),
      ...cliSource("Core/OutputFormatter.ts").matchAll(ENVIRONMENT_READ),
    ]
      .map((match: RegExpMatchArray): string => {
        return match[1] as string;
      })
      .filter((name: string, index: number, all: Array<string>): boolean => {
        return all.indexOf(name) === index;
      })
      .sort();

    expect(read).toEqual([
      "NO_COLOR",
      "ONEUPTIME_API_KEY",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "ONEUPTIME_URL",
    ]);
    expect(
      tableWithHeader(
        englishSection(COMMAND_REFERENCE, "## Environment variables"),
        "Variable",
      )
        .map((row: Array<string>): string => {
          return codeIn(row[0] as string)[0] as string;
        })
        .sort(),
    ).toEqual(read);
    expect(
      tableWithHeader(englishSection(COMMAND_REFERENCE, "## Files"), "File"),
    ).toEqual([
      [
        "`~/.oneuptime/config.json`",
        "The saved contexts, their API keys, and the current context",
      ],
    ]);
  });

  it("lists the exit codes ErrorHandler exits with", () => {
    const codes: Array<string> = [
      ...cliSource("Core/ErrorHandler.ts").matchAll(ENUM_MEMBER),
    ].map((match: RegExpMatchArray): string => {
      return `\`${match[1] as string}\``;
    });

    expect(codes).toEqual(["`0`", "`1`", "`2`", "`3`"]);

    for (const [page, heading] of [
      [COMMAND_REFERENCE, "## Exit codes"],
      [SCRIPTING, "## Exit codes"],
    ] as Array<[string, string]>) {
      expect(
        tableWithHeader(englishSection(page, heading), "Code").map(
          (row: Array<string>): string => {
            return row[0] as string;
          },
        ),
      ).toEqual(codes);
    }
  });
});

describe("Authentication", () => {
  const config: string = cliSource("Core/ConfigManager.ts");
  const commands: string = cliSource("Commands/ConfigCommands.ts");
  const utility: string = cliSource("Commands/UtilityCommands.ts");
  const page: string = englishPage(AUTHENTICATION);

  it("logs in under 'default' unless a name is given, without asking OneUptime, and makes the context current", () => {
    expect(commands).toContain(
      '.option("--context-name <name>", "Name for this context", "default")',
    );
    expect(commands).not.toContain("ApiClient");
    expect(flat(commands)).toContain(
      "ConfigManager.addContext(context); ConfigManager.setCurrentContext(context.name);",
    );
    expect(flat(commands)).toContain(
      'printSuccess( `Logged in successfully. Context "${context.name}" is now active.`, );',
    );
    expect(page).toContain(
      "`oneuptime login` saves an API key and your OneUptime's address as a context, and makes it the current context:",
    );
    expect(page).toContain(
      "| `--context-name <name>` | The name to save the context under. Default: `default` |",
    );
    expect(page).toContain(
      "`login` saves the key without asking OneUptime about it. Run `oneuptime whoami --check` to see that OneUptime takes it.",
    );
    expect(englishPage(CLI_OVERVIEW)).toContain(
      "The CLI saves them as a context named `default` and uses it from now on:",
    );
  });

  it("removes a slash at the end of the address, and replaces a context saved under the same name", () => {
    expect(commands).toContain('apiUrl: instanceUrl.replace(/\\/+$/, ""),');
    expect(config).toContain("config.contexts[context.name] = context;");
    expect(page).toContain(
      "A slash at the end of the address is removed, and logging in again under the same name replaces that context.",
    );
  });

  it("saves contexts in ~/.oneuptime/config.json, readable and writable by its user alone", () => {
    expect(config).toContain(
      'const CONFIG_DIR: string = path.join(os.homedir(), ".oneuptime");',
    );
    expect(config).toContain(
      'const CONFIG_FILE: string = path.join(CONFIG_DIR, "config.json");',
    );
    expect(config).toContain("mode: 0o600,");
    expect(
      flat(englishSection(AUTHENTICATION, "## The configuration file")),
    ).toContain(
      "`oneuptime login` saves contexts in `~/.oneuptime/config.json`, in your home folder (`%USERPROFILE%\\.oneuptime\\config.json` on Windows). The CLI creates it so that only your user can read and write it (mode `0600`):",
    );
  });

  it("shows the configuration file with the fields CLIConfig and CLIContext have", () => {
    const types: string = cliSource("Types/CLITypes.ts");
    const shown: [string, string] = codeBlocksOf(
      englishSection(AUTHENTICATION, "## The configuration file"),
    )[0] as [string, string];
    const parsed: {
      currentContext: string;
      contexts: Record<string, Record<string, string>>;
    } = JSON.parse(shown[1]) as {
      currentContext: string;
      contexts: Record<string, Record<string, string>>;
    };

    expect(flat(types)).toContain(
      "export interface CLIContext { name: string; apiUrl: string; apiKey: string; }",
    );
    expect(flat(types)).toContain(
      "export interface CLIConfig { currentContext: string; contexts: Record<string, CLIContext>; }",
    );
    expect(Object.keys(parsed)).toEqual(["currentContext", "contexts"]);

    for (const context of Object.values(parsed.contexts)) {
      expect(Object.keys(context)).toEqual(["name", "apiUrl", "apiKey"]);
    }
  });

  it("takes the key and the URL from flags, then the environment, then a named context, then the current one", () => {
    const resolve: string = flat(
      config.slice(config.indexOf("export function getResolvedCredentials")),
    );
    const order: Array<number> = [
      "// Priority 1: CLI flags",
      "// Priority 2: Environment variables",
      "// Priority 3: Specific context if specified via --context flag",
      "// Priority 4: Current context in config file",
    ].map((marker: string): number => {
      return resolve.indexOf(marker);
    });

    expect(
      order.every((at: number): boolean => {
        return at >= 0;
      }),
    ).toBe(true);
    expect(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(order);

    // Each value apart: a flag replaces what the environment or a context gives.
    expect(resolve).toContain(
      "apiKey: cliOptions.apiKey || creds.apiKey, apiUrl: cliOptions.url || creds.apiUrl,",
    );
    expect(resolve).toContain(
      "apiKey: envApiKey || currentCtx.apiKey, apiUrl: envUrl || currentCtx.apiUrl,",
    );

    const diagram: string = scanMarkdown(
      englishSection(AUTHENTICATION, "## Which credentials a command uses"),
    ).fences[0]?.code as string;

    expect(diagram.indexOf("1. Flags on the command")).toBeLessThan(
      diagram.indexOf("2. Environment variables"),
    );
    expect(diagram.indexOf("2. Environment variables")).toBeLessThan(
      diagram.indexOf("3. The context named"),
    );
    expect(diagram.indexOf("3. The context named")).toBeLessThan(
      diagram.indexOf("4. The current context"),
    );
    expect(page).toContain(
      "A command needs an API key and a URL. It takes each of the two from the first of these places that has it:",
    );
  });

  it("deletes a context, and makes the first one left current when it was", () => {
    expect(flat(config)).toContain(
      'if (config.currentContext === name) { const remaining: string[] = Object.keys(config.contexts); config.currentContext = remaining[0] || ""; }',
    );
    expect(
      rowOfCode(
        englishSection(AUTHENTICATION, "## Contexts"),
        "oneuptime context delete <name>",
      )[1],
    ).toBe(
      "Deletes a saved context. If it was the current one, the first context left becomes current",
    );
  });

  it("lists contexts without their keys, and shows a key with all but its first and last four characters hidden", () => {
    expect(flat(commands)).toContain(
      "return { name: ctx.name, apiUrl: ctx.apiUrl, isCurrent: ctx.isCurrent, };",
    );

    // context current masks the context's key, whoami the key in use: maskApiKey both.
    expect(commands).toContain(
      "const maskedKey: string = maskApiKey(ctx.apiKey);",
    );
    expect(flat(utility)).toContain(
      'return apiKey.length > 8 ? apiKey.substring(0, 4) + "****" + apiKey.substring(apiKey.length - 4) : "****";',
    );
    expect(utility).toContain(
      "const maskedKey: string = maskApiKey(creds.apiKey);",
    );

    expect(page).toContain(
      "| `oneuptime context list` | Lists the saved contexts; `*` marks the current one. With `-o json`, each context's `name`, `apiUrl` and `isCurrent`, never its key |",
    );
    expect(page).toContain(
      "Only the first four and the last four characters of the key are shown.",
    );
  });

  it("asks OneUptime nothing in whoami unless --check asks it to, and names the context only when its values are the ones in use", () => {
    const whoami: string = utility.slice(
      utility.indexOf('.command("whoami")'),
      utility.indexOf('.command("resources")'),
    );
    const check: number = whoami.indexOf("if (options.check) {");

    // The one request whoami sends, the key's project, and the version: after --check only.
    expect(utility.split("executeApiRequest(").length - 1).toBe(1);
    expect(utility.indexOf("executeApiRequest(")).toBeGreaterThan(
      utility.indexOf("async function readKeyProject("),
    );
    expect(check).toBeGreaterThan(0);
    expect(whoami.indexOf("await readKeyProject(creds)")).toBeGreaterThan(
      check,
    );
    expect(
      whoami.indexOf("await getServerVersion(creds.apiUrl)"),
    ).toBeGreaterThan(check);
    expect(flat(whoami)).toContain(
      "ctx && ctx.apiKey === creds.apiKey && ctx.apiUrl === creds.apiUrl ? ctx.name : null;",
    );
    expect(utility).toContain(
      '"Not authenticated. Run `oneuptime login` to authenticate."',
    );

    const section: string = flat(
      englishSection(AUTHENTICATION, "## Check what the CLI will use"),
    );

    expect(section).toContain(
      "The `Context` line appears only when the URL and the key are that context's own, not values a flag or an environment variable replaced. On its own, `whoami` reads your settings without calling OneUptime: it shows what a command will send, not whether OneUptime accepts it.",
    );
    expect(section).toContain(
      "`--check` asks OneUptime as well. It adds the key's project, your OneUptime's version and the CLI's, and when the two versions differ, the command that installs the CLI of your OneUptime's version. A key that OneUptime refuses stops it with exit code `2`:",
    );
  });

  it("quotes the messages of a missing credential, a missing context and an unreachable address as the code writes them", () => {
    expect(config).toContain(
      '"No credentials found. Run `oneuptime login` or set ONEUPTIME_API_KEY and ONEUPTIME_URL environment variables."',
    );
    expect(config).toContain('`Context "${name}" does not exist.`');
    expect(readRepoFile("Common/Utils/API.ts")).toContain(
      "throw new APIException(`Request failed to ${url}. ${errorMessage}`, error);",
    );

    const troubleshooting: string = englishSection(
      AUTHENTICATION,
      "## Troubleshooting",
    );

    expect(troubleshooting).toContain(
      "`Authentication error: No credentials found.` means no flag, environment variable or saved context gave the command its API key and URL.",
    );
    expect(troubleshooting).toContain(
      ':::details Context "staging" does not exist',
    );
    expect(troubleshooting).toContain(
      "`Error: Request failed to https://...` means the CLI could not reach OneUptime at that address.",
    );
  });

  it("quotes OneUptime's answers to an invalid key and to a key below its plan", () => {
    expect(
      readRepoFile("Common/Server/Middleware/ProjectAuthorization.ts"),
    ).toContain('throw new BadDataException("Invalid API Key");');
    expect(
      readRepoFile("Common/Types/Billing/PlanCutoffCredentials.ts"),
    ).toContain("return `API keys need the ${planName} plan.");

    const troubleshooting: string = englishSection(
      AUTHENTICATION,
      "## Troubleshooting",
    );

    expect(troubleshooting).toContain(
      ":::details API error (400): Invalid API Key",
    );
    expect(troubleshooting).toContain(
      ":::details API error (402): API keys need the Growth plan",
    );
  });
});

describe("exit codes", () => {
  const handler: string = cliSource("Core/ErrorHandler.ts");

  it("exits with 2 for anything about the API key, any case, before a 404 is read as not found", () => {
    const auth: number = handler.indexOf(
      'message.toLowerCase().includes("api key")',
    );
    const authBranch: number = handler.indexOf("if (isAuthError(message)) {");
    const notFoundBranch: number = handler.indexOf(
      "if (isNotFound(message)) {",
    );

    expect(auth).toBeGreaterThan(0);
    expect(handler).toContain('message.includes("404")');
    expect(handler).toContain('message.includes("credentials")');
    expect(handler).toContain('message.includes("401")');
    expect(authBranch).toBeGreaterThan(0);
    expect(notFoundBranch).toBeGreaterThan(authBranch);
    expect(flat(handler.slice(authBranch, notFoundBranch))).toContain(
      "exitCode: ExitCode.AuthError,",
    );
    expect(handler).toContain("return process.exit(described.exitCode);");

    // OneUptime's answers to a bad key and to a key below its plan name the key.
    expect("Invalid API Key".toLowerCase()).toContain("api key");
    expect("API keys need the Growth plan.".toLowerCase()).toContain("api key");

    expect(
      rowStartingWith(
        tableWithHeader(englishSection(SCRIPTING, "## Exit codes"), "Code"),
        "`2`",
      ),
    ).toEqual([
      "`2`",
      "No usable API key",
      "No credentials found; an invalid API key; a key below its plan (`402`); `401`",
    ]);
  });

  it("exits with 3 when OneUptime answers 404, which it answers for a record a key may not read too", () => {
    const notFoundBranch: number = handler.indexOf(
      "if (isNotFound(message)) {",
    );

    expect(handler).toContain('message.includes("404")');
    expect(flat(handler.slice(notFoundBranch, notFoundBranch + 400))).toContain(
      "exitCode: ExitCode.NotFound,",
    );
    expect(readRepoFile("Common/Server/API/BaseAPI.ts")).toContain(
      '`${new this.entityType().singularName || "Record"} not found.`,',
    );
    expect(
      rowStartingWith(
        tableWithHeader(englishSection(SCRIPTING, "## Exit codes"), "Code"),
        "`3`",
      )[2],
    ).toBe(
      "OneUptime answered `404`: the record does not exist, is in another project, or the key may not read it",
    );
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "An ID that names no record your key may read answers `Not found`, and the command exits with code `3`.",
    );
  });

  it("exits with 1 for a refusal, an invalid value and Commander's own errors, and 0 from whoami and context current with nothing saved", () => {
    const general: string = flat(
      handler.slice(
        handler.lastIndexOf(
          "return {",
          handler.indexOf("export function handleError"),
        ),
      ),
    );

    expect(general).toContain(
      'return { exitCode: ExitCode.GeneralError, line: message.includes("API error") ? message : `Error: ${message}`,',
    );

    const utility: string = cliSource("Commands/UtilityCommands.ts");
    const whoami: string = utility.slice(
      utility.indexOf('.command("whoami")'),
      utility.indexOf('.command("resources")'),
    );

    // Nothing saved: the message, then return - no exit code but 0.
    expect(flat(whoami)).toContain(
      'printInfo( "Not authenticated. Run `oneuptime login` to authenticate.", ); return;',
    );
    expect(flat(cliSource("Commands/ConfigCommands.ts"))).toContain(
      'printInfo( "No current context set. Run `oneuptime login` to create one.", ); return;',
    );
    expect(englishPage(SCRIPTING)).toContain(
      "`whoami` and `context current` exit with `0` even when nothing is saved: they report what is set, they do not check it.",
    );
  });

  it("writes an error asked for JSON as one object on the standard error, with the keys the pages name", () => {
    expect(flat(handler)).toContain(
      "if (isJsonRequested()) { // eslint-disable-next-line no-console console.error( JSON.stringify({ error: { message: described.message, status: described.status, exitCode: described.exitCode, hint: described.hint, }, }), );",
    );

    const shown: [string, string] = codeBlocksOf(
      englishSection(OUTPUT_FORMATS, "## JSON"),
    ).find((block: [string, string]): boolean => {
      return block[1].startsWith('{"error"');
    }) as [string, string];
    const error: Record<string, unknown> = (
      JSON.parse(shown[1]) as { error: Record<string, unknown> }
    ).error;

    expect(Object.keys(error)).toEqual([
      "message",
      "status",
      "exitCode",
      "hint",
    ]);
    expect(englishPage(SCRIPTING)).toContain(
      "With `-o json`, an error is JSON too, with the exit code in it: see [JSON](/docs/cli/output-formats#json).",
    );
  });
});

describe("Resource Operations", () => {
  const resources: string = cliSource("Commands/ResourceCommands.ts");

  it("lists ten records by default, newest first, up to the API's limit of 10,000", () => {
    const limit: string = readRepoFile("Common/Types/Database/LimitMax.ts");
    const databaseService: string = flat(
      readRepoFile("Common/Server/Services/DatabaseService.ts"),
    );

    expect(limit).toContain("export const LIMIT_PER_PROJECT: number = 10000;");
    expect(resources).toContain(
      '.option("--limit <n>", "Max results to return", "10")',
    );
    // A read that asks for no order - the CLI sends {} - comes back newest first.
    expect(databaseService).toContain(
      "protected getReadSort(sort: Sort<TBaseModel> | undefined): Sort<TBaseModel> { if (!sort || Object.keys(sort).length === 0) { return { createdAt: SortOrder.Descending, } as Sort<TBaseModel>; } return sort; }",
    );
    expect(databaseService).toContain(
      "findBy.sort = this.getReadSort(findBy.sort);",
    );
    expect(flat(readRepoFile(`${CLI}/Core/ApiClient.ts`))).toContain(
      "sort: options.sort || {},",
    );
    expect(
      readRepoFile("Common/Server/Services/AnalyticsDatabaseService.ts"),
    ).toContain("[defaultSortColumn]: SortOrder.Descending,");

    for (const page of [RESOURCE_OPERATIONS, COMMAND_REFERENCE]) {
      const row: Array<string> = rowOfCode(englishPage(page), "--limit <n>");

      expect(row.join(" | ")).toContain("up to 10,000");
      expect(row).toContain("`10`");
      expect(rowOfCode(englishPage(page), "--sort <json>")).toContain(
        "Newest first",
      );
    }

    expect(englishPage(CLI_OVERVIEW)).toContain(
      "The ten newest incidents appear as a table.",
    );
  });

  it("reads every page with --all, 100 records at a time and at most 100,000", () => {
    expect(resources).toContain(
      "export const LIST_ALL_PAGE_SIZE: number = 100;",
    );
    expect(resources).toContain(
      "export const LIST_ALL_MAX_RECORDS: number = 100000;",
    );
    expect(resources).toContain('.conflicts(["limit", "skip"]),');
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "`--all` reads every page, 100 records at a time, up to 100,000; `count` says how many there are.",
    );
    expect(
      rowOfCode(
        englishSection(COMMAND_REFERENCE, "### `oneuptime <resource> list`"),
        "--all",
      )[1],
    ).toContain(
      "Every record that matches, 100 at a time, up to 100,000, in place of `--limit` and `--skip`.",
    );
  });

  /*
   * Labels are the one exception: LabelService reads them by name, in
   * natural order, when asked for no order (OneUptime issue #5183), so
   * `oneuptime label list` is not newest first, and both pages say so. A
   * service that takes an order of its own fails this until the pages name
   * it too.
   */
  it("lists labels by name, numbered labels first, unless --sort asks for another order", () => {
    const ownOrders: Array<string> = sourceFilesUnder("Common/Server").filter(
      (file: string): boolean => {
        return readRepoFile(file).includes("override getReadSort(");
      },
    );

    expect(ownOrders).toEqual(["Common/Server/Services/LabelService.ts"]);
    expect(resourceNamed("label").operations).toContain(CliOperation.List);
    expect(
      flat(readRepoFile("Common/Server/Services/LabelService.ts")),
    ).toContain(
      "protected override getReadSort(sort: Sort<Model> | undefined): Sort<Model> { return getLabelListSort( sort as Record<string, SortOrder | undefined> | undefined, ) as Sort<Model>; }",
    );

    // No order asked for, as the CLI sends it: by name, numbered names first.
    expect(getLabelListSort({})).toEqual({
      [LABEL_NAME_SORT_KEY_COLUMN]: SortOrder.Ascending,
      [LABEL_NAME_COLUMN]: SortOrder.Ascending,
    });
    expect(sortLabelNames(["b", "10. Owner", "A", "2. Team"])).toEqual([
      "2. Team",
      "10. Owner",
      "A",
      "b",
    ]);
    // An order asked for with --sort is the order read.
    expect(getLabelListSort({ createdAt: SortOrder.Descending })).toEqual({
      createdAt: SortOrder.Descending,
    });

    expect(englishPage(COMMAND_REFERENCE)).toContain(
      "Lists records, newest first. Labels are listed by name instead, numbered labels first (`2. Team` before `10. Owner`).",
    );
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "Labels are listed by name rather than newest first: labels whose names start with a number come first, in the order of that number (`2. Team` before `10. Owner`), then the others alphabetically. To list them in another order, give `--sort`.",
    );
  });

  it("sorts with ASC and DESC, the API's sort orders", () => {
    const orders: string = readRepoFile(
      "Common/Types/BaseDatabase/SortOrder.ts",
    );

    expect(orders).toContain('Ascending = "ASC",');
    expect(orders).toContain('Descending = "DESC",');
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      '| `--sort <json>` | The order, such as `{"createdAt":"ASC"}`, or `"DESC"` for newest first | Newest first |',
    );
    // No numeric sort order anywhere: the analytics API reads ASC and DESC only.
    for (const entry of [RESOURCE_OPERATIONS, COMMAND_REFERENCE, SCRIPTING]) {
      expect(englishPage(entry)).not.toMatch(NUMERIC_SORT);
    }
  });

  it("filters with the API's query types, through the fields and relations the models have", () => {
    const json: string = readRepoFile("Common/Types/JSON.ts");
    const incident: string = readRepoFile(
      "Common/Models/DatabaseModels/Incident.ts",
    );
    const state: string = readRepoFile(
      "Common/Models/DatabaseModels/IncidentState.ts",
    );
    const filters: Array<Array<string>> = tableWithHeader(
      englishSection(RESOURCE_OPERATIONS, "### Filter a list"),
      "Filter",
    );

    expect(json).toContain('Search = "Search",');
    expect(json).toContain('GreaterThan = "GreaterThan",');
    expect(incident).toContain("public currentIncidentState?: IncidentState");
    expect(incident).toContain("public title?: string");
    expect(state).toContain("public isResolvedState?: boolean");
    expect(state).toContain("public order?: number");
    expect(
      filters.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      '`{"title":"Checkout API is down"}`',
      '`{"title":{"_type":"Search","value":"checkout"}}`',
      '`{"createdAt":{"_type":"GreaterThan","value":"2026-10-01T00:00:00.000Z"}}`',
      '`{"currentIncidentState":{"isResolvedState":false}}`',
    ]);
  });

  it("returns the fields --fields names, a related record's after a dot", () => {
    const select: string = cliSource("Utils/SelectFieldGenerator.ts");

    expect(select).toContain(
      'const [field, nested] = name.split(".") as [string, string | undefined];',
    );
    expect(incidentHas("currentIncidentState")).toBe(true);
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "oneuptime incident list --all --fields title,currentIncidentState.name,createdAt -o json",
    );
  });

  it("creates a monitor and an incident with the flags their fields have", () => {
    const monitor: string = readRepoFile(
      "Common/Models/DatabaseModels/Monitor.ts",
    );
    const monitorType: string = monitor.slice(
      monitor.lastIndexOf(
        "@TableColumn",
        monitor.indexOf("public monitorType?"),
      ),
      monitor.indexOf("public monitorType?"),
    );

    expect(monitorType).toContain("required: true,");
    expect(readRepoFile("Common/Types/Monitor/MonitorType.ts")).toContain(
      'Manual = "Manual",',
    );
    expect(flagsOf(Monitor)).toEqual(
      expect.arrayContaining(["--name", "--monitor-type", "--monitor-steps"]),
    );
    expect(flagsOf(Incident)).toEqual(
      expect.arrayContaining([
        "--title",
        "--incident-severity-id",
        "--labels",
        "--is-visible-on-status-page",
        "--root-cause",
        "--current-incident-state-id",
      ]),
    );
    // An incident starts in the created state and is declared now unless told otherwise.
    expect(readRepoFile("Common/Server/Services/IncidentService.ts")).toContain(
      "createBy.data.declaredAt = OneUptimeDate.getCurrentDate();",
    );

    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      'oneuptime monitor create --name "Checkout API" --monitor-type Manual',
    );
    expect(englishPage(SCRIPTING)).toContain(
      "MONITOR_ID=$(oneuptime monitor create --name \"Checkout API\" --monitor-type Manual -o json | jq -r '._id')",
    );
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      'oneuptime incident create --title "Checkout API is down" --incident-severity-id <severity-id>',
    );
  });

  it("names a person by email address beside the ID, among the project's members and invitees", () => {
    const member: CliFieldFlag | undefined = getCliFieldFlags(TeamMember).find(
      (flag: CliFieldFlag): boolean => {
        return flag.columnName === "userId";
      },
    );

    expect(member?.flag).toBe("--user-id");
    expect(member?.person?.flag).toBe("--user-email");
    expect(member?.person?.invitesByEmail).toBe(true);
    expect(
      getCliResources().some((resource: CliResource): boolean => {
        return resource.name.endsWith("-owner-rule");
      }),
    ).toBe(true);
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "A field that names a person by user ID has a second flag that names them by email address: `--user-email` beside `--user-id`, `--owner-user-emails` beside `--owner-users`.",
    );
    expect(cliSource("Utils/People.ts")).toContain(
      "No one in this project, or invited to it, has the email address ${email}.",
    );
  });

  it("creates from --file before --data, with the flags on top, and asks for a field when none is given", () => {
    expect(flat(resources)).toContain(
      'if (options.file) { const fileContent: string = fs.readFileSync(options.file, "utf-8"); return JSON.parse(fileContent) as JSONObject; } if (options.data) { return parseJsonArg(options.data); } return {};',
    );
    expect(flat(resources)).toContain(
      "const fields: JSONObject = { ...readDataOptions(data.options), ...readFieldFlags(data.command, data.options), }; if (Object.keys(fields).length === 0) { throw new Error(data.missingMessage); }",
    );
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "Given both, the file is used, and flags go on top of either.",
    );
    expect(englishSection(RESOURCE_OPERATIONS, "## Troubleshooting")).toContain(
      "A command that gives no field at all is refused before it is sent, with the flags to give.",
    );
  });

  it("says an update is answered with an empty object, as BaseAPI answers it", () => {
    const api: string = readRepoFile("Common/Server/API/BaseAPI.ts");
    const update: string = api.slice(
      api.indexOf("public async updateItem("),
      api.indexOf("public async createItem("),
    );

    expect(update).toContain(
      "return Response.sendEmptySuccessResponse(req, res);",
    );
    expect(readRepoFile("Common/Server/Utils/Response.ts")).toContain(
      "oneUptimeResponse.status(200).send({} as EmptyResponse);",
    );
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "OneUptime answers an update with an empty object: the CLI prints an empty line, or `{}` with `-o json`.",
    );
  });

  it("deletes without asking, whatever --force says", () => {
    const remove: string = resources.slice(
      resources.indexOf("function registerDeleteCommand("),
      resources.indexOf("function registerCountCommand("),
    );

    expect(remove).toContain('.option("--force", "Skip confirmation")');
    // The action never reads the option, and nothing asks the terminal.
    expect(remove).toContain(
      ".action(async (id: string, _options: { force?: boolean }, cmd: Command) => {",
    );
    expect(resources).not.toContain("readline");
    expect(remove).toContain(
      "printSuccess(`${resource.singularName} ${id} deleted successfully.`);",
    );
    expect(remove).toContain(
      "formatOutput({ _id: id, deleted: true }, resolveOutputFormat(cmd)),",
    );
    expect(
      rowOfCode(
        englishSection(COMMAND_REFERENCE, "### `oneuptime <resource> delete`"),
        "--force",
      )[2],
    ).toBe("Accepted and changes nothing: `delete` never asks to confirm");
  });

  it("asks for every field a key may read, for telemetry never a column its table lacks, and leaves out a refused one", () => {
    const select: string = cliSource("Utils/SelectFieldGenerator.ts");

    expect(resources.split("generateAllFieldsSelect(").length - 1).toBe(1);
    expect(select).toContain("return getAnalyticsSelect(new ModelClass());");
    expect(select).toContain(
      ": ALWAYS_SELECTABLE_COLUMNS.includes(column.key);",
    );
    expect(resources).toContain(
      '`Left out fields this API key may not read: ${leftOut.join(", ")}.`',
    );
    // A field asked for with --fields is the reader's: a refusal of it is the answer.
    expect(resources).toContain("!data.isChosen && error instanceof Error");
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "A list asks OneUptime for every field of each record that the key may read.",
    );
    expect(englishSection(RESOURCE_OPERATIONS, "## Troubleshooting")).toContain(
      ":::details Left out fields this API key may not read",
    );
  });

  it("lists a resource's fields from the models, with no key and no request", () => {
    const fields: string = cliSource("Utils/ResourceFields.ts");

    expect(fields).not.toContain("executeApiRequest");
    expect(fields).toContain("export interface DescribedField {");

    for (const key of [
      "name",
      "title",
      "type",
      "description",
      "required",
      "create",
      "update",
      "read",
      "flag",
      "emailFlag",
      "relatedResource",
    ]) {
      expect({
        key,
        inPage: englishSection(
          RESOURCE_OPERATIONS,
          "## See a resource's fields",
        ).includes(`\`${key}\``),
      }).toEqual({ key, inPage: true });
    }

    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "`fields` lists a resource's fields from the CLI itself, with no API key and no request:",
    );
  });
});

describe("Output Formats", () => {
  const formatter: string = cliSource("Core/OutputFormatter.ts");
  const page: string = englishPage(OUTPUT_FORMATS);

  it("offers json, table and wide, and picks JSON when the output is not a terminal", () => {
    const types: string = cliSource("Types/CLITypes.ts");

    expect(flat(types)).toContain(
      'export enum OutputFormat { JSON = "json", Table = "table", Wide = "wide", }',
    );
    expect(formatter).toContain(".choices(Object.values(OutputFormat));");
    expect(flat(formatter)).toContain(
      "if (!process.stdout.isTTY) { return OutputFormat.JSON; } return OutputFormat.Table;",
    );
    expect(page).toContain('T -->|"no: a pipe or a file"| J["json"]');
  });

  it("says -o and --json work on every command, and a sentence stays a sentence unless JSON is asked for", () => {
    const program: CliProgram = readCliProgram();

    for (const command of program.commands) {
      if (command.path === COMMANDER_HELP_COMMAND) {
        continue;
      }

      expect({
        command: command.path,
        output: command.options.some((option: CliOption): boolean => {
          return option.flags === outputOptionFlags();
        }),
        json: command.options.some((option: CliOption): boolean => {
          return option.flags === jsonOptionFlags();
        }),
      }).toEqual({ command: command.path, output: true, json: true });
    }

    expect(jsonOptionFlags()).toBe("--json");
    expect(flat(formatter)).toContain(
      "if (options.json) { return OutputFormat.JSON; }",
    );
    expect(page).toContain(
      "`-o` and `--json` work on every command, anywhere on the command line. A command that prints records chooses its format as the diagram shows. A command whose answer is a sentence, such as `delete` or `acknowledge`, prints the sentence, in a terminal and in a pipe alike, unless `-o json` or `--json` asks for JSON.",
    );
  });

  it("lays out a table as formatTable does: six columns, the priority ones first, values cut to 57 characters and '...'", () => {
    expect(formatter).toContain("if (!wide && columns.length > 6) {");
    expect(formatter).toContain(
      "columns = [...prioritized, ...remaining].slice(0, 6);",
    );
    expect(flat(formatter)).toContain(
      'const priority: string[] = [ "_id", "name", "title", "status", "createdAt", "updatedAt", ];',
    );
    expect(formatter).toContain(
      "function truncateValue(val: JSONValue, maxLen: number = 60): string {",
    );
    expect(formatter).toContain('return str.substring(0, maxLen - 3) + "...";');
    expect(formatter).toContain(
      "const firstItem: JSONObject = items[0] as JSONObject;",
    );
    expect(page).toContain(
      "For a list of records, a table shows up to six columns: `_id`, `name`, `title`, `status`, `createdAt` and `updatedAt` first, those of them the records have, then the records' next fields in order. The columns are taken from the first record. A value longer than 60 characters is cut to its first 57, followed by `...`.",
    );
  });

  it("indents JSON by two spaces, and prints the messages the page lists", () => {
    expect(formatter).toContain("return JSON.stringify(data, null, 2);");
    expect(formatter).toContain('return "No results found.";');
    expect(page).toContain(
      "| `json` | The answer as OneUptime sent it, indented by two spaces | Scripts, `jq` and files |",
    );
    expect(page).toContain(
      "| A `list` that finds nothing | `No results found.` | `[]` |",
    );
  });

  it("says OneUptime sends dates and other records' IDs as objects with a _type and a value", () => {
    const json: string = readRepoFile("Common/Types/JSON.ts");

    expect(json).toContain('DateTime = "DateTime",');
    expect(json).toContain('ObjectID = "ObjectID",');
    expect(
      readRepoFile(
        "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel.ts",
      ),
    ).toContain("return JSONFunctions.serialize(json);");
    expect(page).toContain(
      'OneUptime sends dates and the IDs of other records as objects, such as `{"_type":"DateTime","value":"2026-10-14T09:12:44.000Z"}`, and a table shows them as that text.',
    );
    expect(
      readRepoFile(
        "App/FeatureSet/Docs/Content/en/api-reference/api-reference.md",
      ),
    ).toContain(
      'Dates and IDs other than `_id` come back wrapped, as `{ "_type": "DateTime", "value": "..." }` and `{ "_type": "ObjectID", "value": "..." }`: read them from `value`.',
    );
  });

  it("colours as the printers do, turns colours off with --no-color or NO_COLOR, and writes errors and warnings to the standard error", () => {
    expect(flat(formatter)).toContain(
      'return ( process.env["NO_COLOR"] !== undefined || process.argv.includes("--no-color") );',
    );
    expect(formatter).toContain("return useColor ? chalk.cyan(col) : col;");
    expect(formatter).toContain("console.log(chalk.green(message));");
    expect(formatter).toContain("console.log(chalk.blue(message));");
    expect(formatter).toContain("console.error(chalk.red(message));");
    // A warning and a hint: yellow, on the standard error.
    expect(
      formatter.split("console.error(chalk.yellow(message));").length - 1,
    ).toBe(2);
    expect(flat(englishSection(OUTPUT_FORMATS, "## Colors"))).toContain(
      "Table headers are cyan; messages are green when something worked, blue for information, yellow for warnings and for what to do about an error, and red for errors. Turn colors off with `--no-color`, or by setting `NO_COLOR` to any value:",
    );
    expect(page).toContain(
      "Records and counts go to the standard output, and errors and warnings to the standard error, so a pipe reads only the answer.",
    );
  });
});

describe("the overview", () => {
  const page: string = englishPage(CLI_OVERVIEW);

  it("installs the package the CLI publishes, whose bin is oneuptime, released with OneUptime under its version", () => {
    const manifest: {
      name: string;
      version: string;
      bin: Record<string, string>;
    } = JSON.parse(readRepoFile("CLI/package.json")) as {
      name: string;
      version: string;
      bin: Record<string, string>;
    };

    expect(manifest.name).toBe("@oneuptime/cli");
    expect(Object.keys(manifest.bin)).toEqual(["oneuptime"]);
    expect(manifest.version).toBe(readRepoFile("../VERSION").trim());
    expect(readRepoFile("../Scripts/NPM/PublishAllPackages.sh")).toContain(
      'publish_to_npm "packages/CLI"',
    );
    expect(page).toContain(
      `npm install -g ${manifest.name}\noneuptime --version`,
    );
    expect(page).toContain(
      "The CLI is released with OneUptime and has the same version number.",
    );
  });

  it("installs with the script every OneUptime serves, as the dashboard's CLI page does", () => {
    const entry: ReturnType<typeof getInstallScriptEntry> =
      getInstallScriptEntry(InstallScriptName.Cli);
    const installer: string = readRepoFile("CLI/Install/install.sh");

    expect(entry?.sourceDirectory).toBe("packages/CLI/Install");

    for (const shown of [CLI_OVERVIEW, AI_AGENTS]) {
      expect({
        shown,
        commands: codeBlocksOf(englishPage(shown)).some(
          (block: [string, string]): boolean => {
            return block[1] === getCliInstallScriptCommands(OUR_ADDRESS);
          },
        ),
      }).toEqual({ shown, commands: true });
    }

    // What the page says the script does: the server's version, with npm.
    expect(installer).toContain('"${ONEUPTIME_URL}/api/version"');
    expect(installer).toContain(
      'npm install --global --no-fund --no-audit "$SPEC"',
    );
    expect(englishSection(CLI_OVERVIEW, "## Install the CLI")).toContain(
      "It asks your OneUptime for its version, and installs the CLI of the same version with npm:",
    );
  });

  it("warns that the CLI versions before the bundled one stop at start, with the error they print, and says how to upgrade", () => {
    const manifest: {
      dependencies?: Record<string, string>;
      files: Array<string>;
      scripts: Record<string, string>;
    } = JSON.parse(readRepoFile("CLI/package.json")) as {
      dependencies?: Record<string, string>;
      files: Array<string>;
      scripts: Record<string, string>;
    };

    // What made the CLI start: npm publishes one bundle, needing nothing beside it.
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.files).toEqual([
      "build/dist/Index.js",
      "build/dist/THIRD-PARTY-LICENSES.txt",
    ]);
    expect(manifest.scripts["prepack"]).toBe("npm run build");
    expect(manifest.scripts["build"]).toBe("node esbuild.config.js");

    // The module the error names is the one the CLI's resource commands import.
    expect(cliSource("Commands/ResourceCommands.ts")).toContain(
      '} from "Common/Utils/DeveloperDocs/CliResources";',
    );
    expect(
      readRepoFile("Common/Utils/DeveloperDocs/CliResources.ts"),
    ).toContain(
      'import DatabaseModels from "../../Models/DatabaseModels/Index";',
    );

    // That release is out, so @latest is it or a later one.
    expect(
      compareVersions(readRepoFile("../VERSION").trim(), FIRST_CLI_THAT_STARTS),
    ).toBeGreaterThanOrEqual(0);

    expect(englishSection(CLI_OVERVIEW, "## Install the CLI")).toContain(
      [
        "> [!WARNING]",
        `> CLI versions before ${FIRST_CLI_THAT_STARTS} stop as soon as they start, with an error such as \`Cannot find module 'Common/Models/DatabaseModels/Index'\`. Install ${FIRST_CLI_THAT_STARTS} or later with \`npm install -g @oneuptime/cli@latest\`. On a self-hosted OneUptime older than ${FIRST_CLI_THAT_STARTS}, [upgrade OneUptime](/docs/installation/upgrading#how-to-upgrade) first, then install the CLI of the version you upgraded to.`,
      ].join("\n"),
    );

    // It comes right after the advice it qualifies: the CLI of your OneUptime's version.
    const section: string = englishSection(CLI_OVERVIEW, "## Install the CLI");

    expect(section.indexOf("> [!WARNING]")).toBeGreaterThan(
      section.indexOf("npm install -g @oneuptime/cli@<your-oneuptime-version>"),
    );

    // The upgrade guide has the heading it links to.
    expect(
      readRepoFile(
        "App/FeatureSet/Docs/Content/en/installation/upgrading.md",
      ).split("\n"),
    ).toContain("## How to upgrade");
  });

  it("says the same on the CLI's README, the page npm shows: the version advice, then the warning, as npm can draw it", () => {
    const section: Array<string> = englishSection(
      CLI_OVERVIEW,
      "## Install the CLI",
    ).split("\n");
    const warning: string = (
      section[section.indexOf("> [!WARNING]") + 1] as string
    ).slice("> ".length);
    const advice: string = section.find((line: string): boolean => {
      return line.startsWith("The CLI is released with OneUptime");
    }) as string;
    const readme: Array<string> = readRepoFile("CLI/README.md").split("\n");

    expect(
      warning.startsWith(`CLI versions before ${FIRST_CLI_THAT_STARTS}`),
    ).toBe(true);

    /*
     * npm prints GitHub's [!WARNING] as text, so the README says Warning in
     * bold; and npm's page would resolve /docs/... against itself, so the
     * link there is the docs' whole address.
     */
    const readmeWarning: string = `> **Warning:** ${warning
      .split("](/docs/")
      .join("](https://oneuptime.com/docs/")}`;

    expect(readme).toContain(readmeWarning);
    expect(readme).toContain(advice);
    expect(readme.indexOf(advice)).toBeLessThan(readme.indexOf(readmeWarning));
    expect(readme).toContain(
      "npm install -g @oneuptime/cli@<your-oneuptime-version>",
    );
  });

  it("lists every command at a glance, and no other", () => {
    /*
     * A row names one command ("oneuptime login <api-key> <instance-url>")
     * or a group and its subcommands ("oneuptime context list", then "use",
     * "current" and "delete").
     */
    const covered: Array<string> = tableWithHeader(
      englishSection(CLI_OVERVIEW, "## Commands at a glance"),
      "Command",
    )
      .flatMap((row: Array<string>): Array<string> => {
        const [head, ...more] = codeIn(row[0] as string) as [
          string,
          ...Array<string>,
        ];
        const words: Array<string> = head.split(" ");
        const group: string = words[1] as string;
        const sub: string | undefined = words[2];

        if (!sub || sub.startsWith("<") || sub.startsWith("[")) {
          return [group];
        }

        return [sub, ...more].map((name: string): string => {
          return `${group} ${name}`;
        });
      })
      .sort();

    expect(covered).toEqual(
      readCliProgram()
        .commands.map((command: CliCommand): string => {
          return command.path;
        })
        .sort(),
    );
  });

  it("makes a command for every resource of the API, 450 and more, the examples among them", () => {
    expect(getCliResources().length).toBeGreaterThanOrEqual(
      RESOURCE_COUNT_CLAIM,
    );

    for (const name of [
      "incident",
      "monitor",
      "status-page-subscriber",
      "telemetry-ingestion-key",
    ]) {
      expect(resourceNamed(name).name).toBe(name);
    }

    expect(page).toContain(
      "Every resource of the OneUptime API is a command, 450 and more of them, from `incident` and `monitor` to `status-page-subscriber` and `telemetry-ingestion-key`, each with the operations the API takes for it.",
    );
    // The MCP server's tools are for fewer: those that set enableMCP.
    expect(readRepoFile("App/FeatureSet/MCP/Tools/ToolGenerator.ts")).toContain(
      "!model.enableMCP",
    );
    expect(page).not.toContain("the same records the [MCP server]");
  });

  it("sends the reader to API keys where the API reference creates one", () => {
    expect(page).toContain(
      "Create one in **Project Settings → Advanced → API Keys** with **Create API Key**: see [Create an API key](/docs/api-reference/api-reference#create-an-api-key).",
    );
    expect(
      readRepoFile(
        "App/FeatureSet/Docs/Content/en/api-reference/api-reference.md",
      ),
    ).toContain(
      "Open **Project Settings → Advanced → API Keys** and click **Create API Key**.",
    );
    expect(page).not.toMatch(new RegExp(escapeRegExp("left nav"), "i"));
  });
});

describe("the CLI for AI agents", () => {
  const page: string = englishPage(AI_AGENTS);

  it("connects with the key and the address in the environment, as the dashboard's CLI page does, then checks them in JSON", () => {
    expect(
      codeBlocksOf(page).some((block: [string, string]): boolean => {
        return block[1] === `${getCliConnectCommands(OUR_ADDRESS)} -o json`;
      }),
    ).toBe(true);
  });

  it("needs the Node.js the CLI's package asks for", () => {
    const manifest: { engines: Record<string, string> } = JSON.parse(
      readRepoFile("CLI/package.json"),
    ) as { engines: Record<string, string> };

    expect(manifest.engines).toEqual({ node: ">=22" });
    expect(
      rowStartingWith(
        tableWithHeader(
          englishSection(AI_AGENTS, "## The CLI or the MCP server"),
          "",
        ),
        "The agent needs",
      )[1],
    ).toBe("A shell, and Node.js 22 or later");
  });

  it("says the CLI reaches every resource of the API, which the MCP server has tools for fewer of", () => {
    expect(getCliResources().length).toBeGreaterThanOrEqual(
      RESOURCE_COUNT_CLAIM,
    );
    expect(
      rowStartingWith(
        tableWithHeader(
          englishSection(AI_AGENTS, "## The CLI or the MCP server"),
          "",
        ),
        "It reaches",
      )[1],
    ).toBe("Every resource of the API, 450 and more");
  });

  it("finds its way with commands that need no key and send no request", () => {
    const commands: Array<string> = tableWithHeader(
      englishSection(AI_AGENTS, "## How an agent finds its way"),
      "Command",
    ).map((row: Array<string>): string => {
      return codeIn(row[0] as string)[0] as string;
    });

    expect(commands).toEqual([
      "oneuptime resources -o json",
      "oneuptime incident fields -o json",
      "oneuptime incident create --help",
    ]);
    expect(cliSource("Commands/UtilityCommands.ts")).toContain(
      "operations: r.operations,",
    );
    expect(cliSource("Utils/ResourceFields.ts")).not.toContain(
      "executeApiRequest",
    );
  });

  it("shows an action's JSON with the keys the CLI answers with", () => {
    const shown: [string, string] = codeBlocksOf(
      englishSection(AI_AGENTS, "## Read the answers"),
    ).find((block: [string, string]): boolean => {
      return block[0] === "json";
    }) as [string, string];
    const answer: Record<string, unknown> = JSON.parse(shown[1]) as Record<
      string,
      unknown
    >;

    expect(Object.keys(answer)).toEqual(["_id", "action", "changed", "state"]);
    expect(Object.keys(answer["state"] as Record<string, unknown>)).toEqual([
      "_id",
      "name",
    ]);
    expect(flat(cliSource("Commands/ActionCommands.ts"))).toContain(
      "export interface StateChangeResult { // The record's ID. _id: string; action: string; // False when it was in the state, or past it, already. changed: boolean; // The state it is in now. state: { _id: string; name: string }; }",
    );
  });
});
