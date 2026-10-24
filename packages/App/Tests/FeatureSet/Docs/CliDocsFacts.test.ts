import {
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
  COMMANDER_HELP_FLAGS,
  COMMANDER_VERSION_FLAGS,
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
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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
 * this suite until the pages say the new thing. What the pages say the CLI
 * does - where it saves contexts, which credentials win, how it prints, how
 * it exits - is read from the source that does it, and what they say about
 * the API behind it from the API's code. The CLI's own suite
 * (packages/CLI/Tests/CommandReferenceDocs) runs the real program against
 * the same pages: the output they quote is the output it prints.
 */

const CLI: string = "CLI";

const WHITESPACE_RUN: RegExp = /\s+/g;
const SINGULAR_NAME: RegExp = /singularName: "([^"]+)"/;
// toKebabCase's two steps, as ResourceCommands.ts writes them.
const LOWER_THEN_UPPER: RegExp = /([a-z])([A-Z])/g;
const SPACES_AND_UNDERSCORES: RegExp = /[\s_]+/g;
const ENVIRONMENT_READ: RegExp = /process\.env\["([A-Z_]+)"\]/g;
// A member of a numeric enum: "  AuthError = 2,".
const ENUM_MEMBER: RegExp = /^\s+\w+ = (\d+),$/gm;
// A sort order written as a number, which the analytics API does not read.
const NUMERIC_SORT: RegExp = /"createdAt":\s*-?1/;

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

/*
 * The singular names of the models under a folder whose source holds both
 * markers: that the API opens it to tools, and that it has an API path (a
 * database model's @CrudApiEndpoint, an analytics model's crudApiPath).
 */
function modelsMarked(
  folder: string,
  marker: string,
  apiPathMarker: string,
): Array<string> {
  return sourceFilesUnder(folder)
    .filter((file: string): boolean => {
      const source: string = readRepoFile(file);

      return source.includes(marker) && source.includes(apiPathMarker);
    })
    .map((file: string): string => {
      const match: RegExpMatchArray | null =
        readRepoFile(file).match(SINGULAR_NAME);

      if (!match) {
        throw new Error(`${file} has no singular name`);
      }

      return match[1] as string;
    })
    .sort();
}

// A model's name as a command, as the CLI's toKebabCase writes it.
function asCommand(singularName: string): string {
  return singularName
    .replace(LOWER_THEN_UPPER, "$1-$2")
    .replace(SPACES_AND_UNDERSCORES, "-")
    .toLowerCase();
}

// The commands the CLI makes for records, and for telemetry.
function recordCommands(): Array<string> {
  return modelsMarked(
    "Common/Models/DatabaseModels",
    "@EnableMCP()",
    "@CrudApiEndpoint(",
  )
    .map(asCommand)
    .sort();
}

function telemetryCommands(): Array<string> {
  return modelsMarked(
    "Common/Models/AnalyticsModels",
    "enableMCP: true",
    "crudApiPath:",
  )
    .map(asCommand)
    .sort();
}

/*
 * The commands each resources table of the command reference lists: the
 * first table the records, the second the telemetry.
 */
function commandsInResourcesTable(table: number): Array<string> {
  const rows: Array<Array<string>> = (
    tables(englishSection(COMMAND_REFERENCE, "### Resources"))[table] || []
  ).slice(1);

  return rows
    .flatMap((row: Array<string>): Array<string> => {
      return codeIn(row[1] as string);
    })
    .sort();
}

// "`list`, `get` and `count`": operations as the pages list them.
function operationList(operations: ReadonlyArray<string>): string {
  const quoted: Array<string> = operations.map((name: string): string => {
    return `\`${name}\``;
  });

  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

function commandSection(command: CliCommand): string {
  return englishSection(COMMAND_REFERENCE, `### \`oneuptime ${command.path}\``);
}

// What a reader types for an option: its short flag when it has one.
function typedFlag(option: CliOption): string {
  return option.flags.split(",")[0]?.split(" ")[0] as string;
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
        "<resource> list",
        "<resource> get",
        "<resource> create",
        "<resource> update",
        "<resource> delete",
        "<resource> count",
        "help",
      ]),
    );
    expect(cliSource("Commands/ConfigCommands.ts")).toContain(
      '.option("--context-name <name>", "Name for this context", "default")',
    );
    expect(program.operationsByType["database"]).toHaveLength(6);
    expect(program.operationsByType["analytics"]).toEqual([
      "list",
      "create",
      "count",
    ]);
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

      for (const option of command.options) {
        expect(usage).toContain(typedFlag(option));
      }
    },
  );

  it.each(commandsByPath)(
    "gives every option of oneuptime %s a row with its default and whether it is required",
    (_path: string, command: CliCommand) => {
      const text: string = commandSection(command);

      for (const option of command.options) {
        const row: Array<string> = rowOfCode(text, option.flags);

        if (option.defaultValue !== null) {
          expect(row).toContain(`\`${option.defaultValue}\``);
        }

        /*
         * The Required column, where the section's table has one: "Yes" for
         * an option .requiredOption() declares, and only for one ("One of
         * the two" for create's --data and --file, which the action checks).
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

  it("lists exactly the global options on the reference and on the overview", () => {
    const flags: Array<string> = program.globalOptions
      .map((option: CliOption): string => {
        return option.flags;
      })
      .sort();

    expect(flags).toContain(COMMANDER_VERSION_FLAGS);
    expect(flags).toContain(COMMANDER_HELP_FLAGS);
    expect(flags).toContain(outputOptionFlags());

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

  it("says which operations each type of resource takes, as registerResourceCommands gives them", () => {
    const records: ReadonlyArray<string> =
      program.operationsByType["database"] || [];
    const telemetry: ReadonlyArray<string> =
      program.operationsByType["analytics"] || [];
    const resources: string = englishSection(
      COMMAND_REFERENCE,
      "### Resources",
    );

    expect(resources).toContain(`Records take ${operationList(records)}:`);
    expect(resources).toContain(`Telemetry takes ${operationList(telemetry)}:`);

    for (const operation of records) {
      const section: string = englishSection(
        COMMAND_REFERENCE,
        `### \`oneuptime <resource> ${operation}\``,
      );

      expect({
        operation,
        recordsOnly: section.includes(
          `Records only: telemetry has no \`${operation}\`.`,
        ),
      }).toEqual({ operation, recordsOnly: !telemetry.includes(operation) });
    }

    // Resource Operations: the types table and the table of what each can do.
    const types: Array<Array<string>> = tableWithHeader(
      englishSection(RESOURCE_OPERATIONS, "## Find the command for a record"),
      "Type",
    );

    expect(codeIn(rowStartingWith(types, "`database`")[2] as string)).toEqual([
      ...records,
    ]);
    expect(codeIn(rowStartingWith(types, "`analytics`")[2] as string)).toEqual([
      ...telemetry,
    ]);

    const canDo: Array<Array<string>> = tableWithHeader(
      englishSection(RESOURCE_OPERATIONS, "## What each type can do"),
      "Operation",
    );

    expect(
      canDo.map((row: Array<string>): Array<string> => {
        return row;
      }),
    ).toEqual(
      records.map((operation: string): Array<string> => {
        return [
          `\`${operation}\``,
          "Yes",
          telemetry.includes(operation) ? "Yes" : "No",
        ];
      }),
    );
  });

  it("lists every resource command the CLI discovers, records apart from telemetry", () => {
    const discovery: string = cliSource("Commands/ResourceCommands.ts");

    // The CLI makes a command for each model the API opens to tools.
    expect(
      discovery.split("if (tableName && model.enableMCP && apiPath)").length -
        1,
    ).toBe(2);
    expect(discovery).toContain("name: toKebabCase(singularName)");
    expect(discovery).toContain('.replace(/([a-z])([A-Z])/g, "$1-$2")');
    expect(discovery).toContain('.replace(/[\\s_]+/g, "-")');

    /*
     * postmortem-status, the 28th, came with the Postmortems list;
     * security-case-priority and security-case-status with Security Events >
     * Settings.
     */
    expect(recordCommands()).toHaveLength(30);
    expect(telemetryCommands()).toHaveLength(9);
    expect(commandsInResourcesTable(0)).toEqual(recordCommands());
    expect(commandsInResourcesTable(1)).toEqual(telemetryCommands());
    expect(recordCommands()).toEqual(
      expect.arrayContaining([
        "incident",
        "monitor",
        "status-page",
        "on-call-policy",
        "monitor-status-event",
        "scheduled-maintenance-event",
      ]),
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
    expect(policy).toContain('singularName: "On-Call Policy"');
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
    expect(commands).toContain(
      'printSuccess(\n            `Logged in successfully. Context "${context.name}" is now active.`,',
    );
    expect(page).toContain(
      "`oneuptime login` saves an API key and your OneUptime's address as a context, and makes it the current context:",
    );
    expect(page).toContain(
      "| `--context-name <name>` | The name to save the context under. Default: `default` |",
    );
    expect(page).toContain(
      "`login` saves the key without asking OneUptime about it.",
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

    // context current masks the context's key, whoami the key in use.
    for (const [source, key] of [
      [commands, "ctx.apiKey"],
      [utility, "creds.apiKey"],
    ] as Array<[string, string]>) {
      expect(flat(source)).toContain(
        `${key}.length > 8 ? ${key}.substring(0, 4) + "****" + ${key}.substring(${key}.length - 4) : "****";`,
      );
    }

    expect(page).toContain(
      "| `oneuptime context list` | Lists the saved contexts; `*` marks the current one. With `-o json`, each context's `name`, `apiUrl` and `isCurrent`, never its key |",
    );
    expect(page).toContain(
      "Only the first four and the last four characters of the key are shown.",
    );
  });

  it("checks nothing with OneUptime in whoami, and names the context only when its values are the ones in use", () => {
    expect(utility).not.toContain("ApiClient");
    expect(utility).not.toContain("executeApiRequest");
    expect(utility).toContain(
      "if (ctx && ctx.apiKey === creds.apiKey && ctx.apiUrl === creds.apiUrl) {",
    );
    expect(utility).toContain(
      '"Not authenticated. Run `oneuptime login` to authenticate."',
    );
    expect(
      flat(englishSection(AUTHENTICATION, "## Check what the CLI will use")),
    ).toContain(
      "The `Context` line appears only when the URL and the key are that context's own, not values a flag or an environment variable replaced. `whoami` reads your settings without calling OneUptime: it shows what a command will send, not whether OneUptime accepts it.",
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
    const notFound: number = handler.indexOf('message.includes("404")');

    expect(auth).toBeGreaterThan(0);
    expect(notFound).toBeGreaterThan(auth);
    expect(handler).toContain('message.includes("credentials")');
    expect(handler).toContain('message.includes("401")');
    expect(handler).toContain("process.exit(ExitCode.AuthError);");

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
    expect(handler).toContain('message.includes("404")');
    expect(handler).toContain("process.exit(ExitCode.NotFound);");
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
    expect(handler).toContain('if (message.includes("API error")) {');
    expect(
      handler.trim().endsWith("process.exit(ExitCode.GeneralError);\n}"),
    ).toBe(true);

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
    expect(recordCommands()).toContain("label");
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

  it("creates a monitor with the monitorType it needs, and an incident with its severity", () => {
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
    expect(readRepoFile("Common/Models/DatabaseModels/Incident.ts")).toContain(
      "public incidentSeverityId?: ObjectID",
    );
    // An incident starts in the created state and is declared now unless told otherwise.
    expect(readRepoFile("Common/Server/Services/IncidentService.ts")).toContain(
      "createBy.data.declaredAt = OneUptimeDate.getCurrentDate();",
    );

    for (const page of [RESOURCE_OPERATIONS, SCRIPTING]) {
      expect(englishPage(page)).toContain(
        `oneuptime monitor create --data '{"name":"Checkout API","monitorType":"Manual"}'`,
      );
    }

    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      `oneuptime incident create --data '{"title":"Checkout API is down","incidentSeverityId":"<severity-id>"}'`,
    );
  });

  it("creates from --file before --data, and asks for one of them", () => {
    expect(flat(resources)).toContain(
      'if (options.file) { const fileContent: string = fs.readFileSync(options.file, "utf-8"); data = JSON.parse(fileContent) as JSONObject; } else if (options.data) {',
    );
    expect(resources).toContain(
      '"Either --data or --file is required for create."',
    );
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "Give one of the two; given both, the file is used.",
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
    // An update that changes no field is refused, as the troubleshooting says.
    expect(update).toContain("No fields to update.");
    expect(englishSection(RESOURCE_OPERATIONS, "## Troubleshooting")).toContain(
      "`No fields to update` means `--data` held no field to change.",
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
      ".action(async (id: string, _options: { force?: boolean }) => {",
    );
    expect(resources).not.toContain("readline");
    expect(remove).toContain(
      "printSuccess(`${resource.singularName} ${id} deleted successfully.`);",
    );
    expect(
      rowOfCode(
        englishSection(COMMAND_REFERENCE, "### `oneuptime <resource> delete`"),
        "--force",
      )[2],
    ).toBe("Accepted and changes nothing: `delete` never asks to confirm");
  });

  it("asks for every field a key may read, and for telemetry never a column its table lacks", () => {
    const select: string = cliSource("Utils/SelectFieldGenerator.ts");

    expect(resources.split("generateAllFieldsSelect(").length - 1).toBe(2);
    expect(select).toContain("return getAnalyticsSelect(new ModelClass());");
    expect(select).toContain(
      ": ALWAYS_SELECTABLE_COLUMNS.includes(column.key);",
    );
    expect(englishPage(RESOURCE_OPERATIONS)).toContain(
      "A list asks OneUptime for every field of each record that the key may read.",
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

  it("names the commands that take -o: those whose sources add the output option", () => {
    const takers: Array<string> = readCliProgram()
      .commands.filter((command: CliCommand): boolean => {
        return command.options.some((option: CliOption): boolean => {
          return option.flags === outputOptionFlags();
        });
      })
      .map((command: CliCommand): string => {
        return command.path;
      })
      .sort();

    expect(takers).toEqual([
      "<resource> count",
      "<resource> create",
      "<resource> get",
      "<resource> list",
      "<resource> update",
      "context list",
      "resources",
    ]);
    expect(page).toContain(
      "`-o` works on every command that prints records: `list`, `get`, `create`, `update` and `count` of a resource, `oneuptime resources` and `oneuptime context list`.",
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

  it("colours as the printers do, turns colours off with --no-color or NO_COLOR, and writes errors to the standard error", () => {
    expect(flat(formatter)).toContain(
      'return ( process.env["NO_COLOR"] !== undefined || process.argv.includes("--no-color") );',
    );
    expect(formatter).toContain("return useColor ? chalk.cyan(col) : col;");
    expect(formatter).toContain("console.log(chalk.green(message));");
    expect(formatter).toContain("console.log(chalk.blue(message));");
    expect(formatter).toContain("console.error(chalk.red(message));");
    expect(flat(englishSection(OUTPUT_FORMATS, "## Colors"))).toContain(
      "Table headers are cyan; messages are green when something worked, blue for information and red for errors. Turn colors off with `--no-color`, or by setting `NO_COLOR` to any value:",
    );
    expect(page).toContain(
      "Records and counts go to the standard output, and errors to the standard error, so a pipe reads only the answer.",
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

  it("makes a command for each model the MCP server makes tools for", () => {
    expect(cliSource("Commands/ResourceCommands.ts")).toContain(
      "model.enableMCP && apiPath",
    );
    expect(readRepoFile("App/FeatureSet/MCP/Tools/ToolGenerator.ts")).toContain(
      "!model.enableMCP",
    );
    expect(page).toContain(
      "The commands for records come with the CLI: each kind of record the OneUptime API opens to tools has one, the same records the [MCP server](/docs/ai/mcp-server) has tools for.",
    );
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
