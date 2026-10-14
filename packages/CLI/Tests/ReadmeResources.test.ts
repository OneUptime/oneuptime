import { Command } from "commander";
import { buildProgram } from "../Program";
import { discoverResources } from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import * as fs from "fs";
import * as path from "path";

/*
 * The CLI's README is the page npm shows for @oneuptime/cli. Its Supported
 * Resources section listed nine resources as "currently supported" while
 * the CLI had 32 resource commands, and it said every resource takes all
 * six subcommands, which telemetry does not. It now lists every resource
 * command, in a table for records and one for telemetry, and these tests
 * hold it to the resources the program discovers and the subcommands it
 * gives each, so a model that gains or loses MCP fails here until the
 * README says so.
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

// The subcommands each kind of resource takes, in the order the CLI adds them.
const RECORD_SUBCOMMANDS: Array<string> = [
  "list",
  "get",
  "create",
  "update",
  "delete",
  "count",
];
const TELEMETRY_SUBCOMMANDS: Array<string> = ["list", "create", "count"];

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

interface ResourceTable {
  // The sentence above the table, and the commands its rows list.
  intro: string;
  commands: Array<string>;
}

// The tables of Supported Resources, each with the sentence that introduces it.
function resourceTables(): Array<ResourceTable> {
  const blocks: Array<string> = blocksOf(section("## Supported Resources"));
  const tables: Array<ResourceTable> = [];

  blocks.forEach((block: string, index: number): void => {
    if (!block.startsWith("|")) {
      return;
    }

    tables.push({
      intro: blocks[index - 1] || "",
      commands: tableRows(block).flatMap((cells: Array<string>) => {
        return codeSpans(cells[1] || "");
      }),
    });
  });

  return tables;
}

function subcommandsOf(program: Command, name: string): Array<string> {
  const command: Command | undefined = program.commands.find(
    (child: Command): boolean => {
      return child.name() === name;
    },
  );

  if (!command) {
    throw new Error(`The CLI has no command ${name}`);
  }

  return command.commands.map((child: Command): string => {
    return child.name();
  });
}

describe("the CLI README's supported resources", () => {
  let program: Command;
  let resources: Array<ResourceInfo>;

  beforeAll(() => {
    program = buildProgram();
    resources = discoverResources();
  });

  it("are read from the README: a table of records and a table of telemetry", () => {
    const tables: Array<ResourceTable> = resourceTables();

    expect(tables).toHaveLength(2);
    expect(tables[0]!.commands).toEqual(
      expect.arrayContaining(["monitor", "incident", "alert", "status-page"]),
    );
    expect(tables[1]!.commands).toEqual(
      expect.arrayContaining(["log", "metric", "span"]),
    );
  });

  it("list every resource command the CLI has, each once", () => {
    const listed: Array<string> = resourceTables().flatMap(
      (table: ResourceTable): Array<string> => {
        return table.commands;
      },
    );
    const commands: Array<string> = resources.map(
      (resource: ResourceInfo): string => {
        return resource.name;
      },
    );

    expect(commands.length).toBeGreaterThan(30);
    expect([...listed].sort()).toEqual([...commands].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("put records in the first table and telemetry in the second, under the subcommands each takes", () => {
    const [records, telemetry] = resourceTables() as [
      ResourceTable,
      ResourceTable,
    ];

    expect(codeSpans(records.intro)).toEqual(RECORD_SUBCOMMANDS);
    expect(codeSpans(telemetry.intro)).toEqual(TELEMETRY_SUBCOMMANDS);

    for (const resource of resources) {
      const table: ResourceTable =
        resource.modelType === "analytics" ? telemetry : records;

      expect({
        command: resource.name,
        listed: table.commands.includes(resource.name),
        subcommands: subcommandsOf(program, resource.name),
      }).toEqual({
        command: resource.name,
        listed: true,
        subcommands:
          resource.modelType === "analytics"
            ? TELEMETRY_SUBCOMMANDS
            : RECORD_SUBCOMMANDS,
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
});

describe("the CLI README's resource operations", () => {
  let program: Command;

  beforeAll(() => {
    program = buildProgram();
  });

  it("say which subcommands every resource takes, and which only records do", () => {
    const blocks: Array<string> = blocksOf(section("### Resource Operations"));
    const sentence: string = blocks[1] || "";
    const [shared, recordsOnly] = sentence.split(". ") as [string, string];

    expect(codeSpans(shared)).toEqual(TELEMETRY_SUBCOMMANDS);
    expect(codeSpans(recordsOnly)).toEqual(
      RECORD_SUBCOMMANDS.filter((name: string): boolean => {
        return !TELEMETRY_SUBCOMMANDS.includes(name);
      }),
    );
    expect(recordsOnly).toContain("telemetry");
    expect(recordsOnly).toContain("does not");
  });

  it("list in its table every subcommand a record takes, as the CLI writes it", () => {
    const table: string =
      blocksOf(section("### Resource Operations")).find(
        (block: string): boolean => {
          return block.startsWith("|");
        },
      ) || "";
    const subcommands: Array<string> = tableRows(table).map(
      (cells: Array<string>): string => {
        // "`<resource> update <id> --data <json>`" -> "update"
        return (codeSpans(cells[0] || "")[0] || "").split(" ")[1] || "";
      },
    );

    expect(subcommands).toEqual(subcommandsOf(program, "incident"));
    expect(subcommands).toEqual(RECORD_SUBCOMMANDS);
  });

  it("no longer says every resource takes all six, or lists nine as currently supported", () => {
    expect(README).not.toContain("Every discovered resource supports these");
    expect(README).not.toContain("Currently supported:");
    expect(README).not.toContain(
      "Supports all MCP-enabled resources with full CRUD operations",
    );
  });
});
