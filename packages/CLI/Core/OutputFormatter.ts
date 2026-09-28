import { OutputFormat } from "../Types/CLITypes";
import { JSONValue, JSONObject, JSONArray } from "Common/Types/JSON";
import { Command, Option } from "commander";
import Table from "cli-table3";
import chalk from "chalk";

/*
 * The -o/--output option. Declared globally on the root program, and again
 * on each command that prints data so it shows up in that command's --help.
 */
export function createOutputOption(): Option {
  return new Option(
    "-o, --output <format>",
    "Output format; defaults to table on a terminal, json when piped",
  ).choices(Object.values(OutputFormat));
}

/*
 * The output format a command should print in. Without
 * enablePositionalOptions, Commander lets the root program consume its
 * global -o wherever it appears on the command line, so the -o a command
 * declares for its own --help never receives a value in the real CLI.
 * optsWithGlobals() merges the command's options with its ancestors', so
 * this reads the global value there and the command's own value in
 * programs built without the global option.
 */
export function resolveOutputFormat(cmd: Command): OutputFormat {
  return detectOutputFormat(cmd.optsWithGlobals<{ output?: string }>().output);
}

function isColorDisabled(): boolean {
  return (
    process.env["NO_COLOR"] !== undefined || process.argv.includes("--no-color")
  );
}

function detectOutputFormat(cliFormat?: string): OutputFormat {
  if (cliFormat) {
    if (cliFormat === "json") {
      return OutputFormat.JSON;
    }
    if (cliFormat === "wide") {
      return OutputFormat.Wide;
    }
    if (cliFormat === "table") {
      return OutputFormat.Table;
    }
  }

  // If stdout is not a TTY (piped), default to JSON
  if (!process.stdout.isTTY) {
    return OutputFormat.JSON;
  }

  return OutputFormat.Table;
}

function formatJson(data: JSONValue): string {
  return JSON.stringify(data, null, 2);
}

function formatTable(data: JSONValue, wide: boolean): string {
  if (data === null || data === undefined || data === "") {
    return "No data returned.";
  }

  // Scalars such as a count have no columns to lay out.
  if (typeof data !== "object") {
    return String(data);
  }

  // Handle single object
  if (!Array.isArray(data)) {
    return formatSingleObject(data as JSONObject);
  }

  const items: JSONArray = data as JSONArray;
  if (items.length === 0) {
    return "No results found.";
  }

  // Get all keys from the first item
  const firstItem: JSONObject = items[0] as JSONObject;
  if (!firstItem || typeof firstItem !== "object") {
    return formatJson(data);
  }

  let columns: string[] = Object.keys(firstItem);

  // In non-wide mode, limit columns to keep the table readable
  if (!wide && columns.length > 6) {
    // Prioritize common fields
    const priority: string[] = [
      "_id",
      "name",
      "title",
      "status",
      "createdAt",
      "updatedAt",
    ];
    const prioritized: string[] = priority.filter((col: string) => {
      return columns.includes(col);
    });
    const remaining: string[] = columns.filter((col: string) => {
      return !priority.includes(col);
    });
    columns = [...prioritized, ...remaining].slice(0, 6);
  }

  const useColor: boolean = !isColorDisabled();

  const table: Table.Table = new Table({
    head: columns.map((col: string) => {
      return useColor ? chalk.cyan(col) : col;
    }),
    style: {
      head: [],
      border: [],
    },
    wordWrap: true,
  });

  for (const item of items) {
    const row: string[] = columns.map((col: string) => {
      const val: JSONValue = (item as JSONObject)[col] as JSONValue;
      return truncateValue(val);
    });
    table.push(row);
  }

  return table.toString();
}

function formatSingleObject(obj: JSONObject): string {
  const useColor: boolean = !isColorDisabled();

  const table: Table.Table = new Table({
    style: { head: [], border: [] },
  });

  for (const [key, value] of Object.entries(obj)) {
    const label: string = useColor ? chalk.cyan(key) : key;
    table.push({ [label]: truncateValue(value as JSONValue) });
  }

  return table.toString();
}

function truncateValue(val: JSONValue, maxLen: number = 60): string {
  if (val === null || val === undefined) {
    return "";
  }

  if (typeof val === "object") {
    const str: string = JSON.stringify(val);
    if (str.length > maxLen) {
      return str.substring(0, maxLen - 3) + "...";
    }
    return str;
  }

  const str: string = String(val);
  if (str.length > maxLen) {
    return str.substring(0, maxLen - 3) + "...";
  }
  return str;
}

export function formatOutput(data: JSONValue, format?: string): string {
  const outputFormat: OutputFormat = detectOutputFormat(format);

  switch (outputFormat) {
    case OutputFormat.JSON:
      return formatJson(data);
    case OutputFormat.Wide:
      return formatTable(data, true);
    case OutputFormat.Table:
    default:
      return formatTable(data, false);
  }
}

export function printSuccess(message: string): void {
  const useColor: boolean = !isColorDisabled();
  if (useColor) {
    // eslint-disable-next-line no-console
    console.log(chalk.green(message));
  } else {
    // eslint-disable-next-line no-console
    console.log(message);
  }
}

export function printError(message: string): void {
  const useColor: boolean = !isColorDisabled();
  if (useColor) {
    // eslint-disable-next-line no-console
    console.error(chalk.red(message));
  } else {
    // eslint-disable-next-line no-console
    console.error(message);
  }
}

export function printWarning(message: string): void {
  const useColor: boolean = !isColorDisabled();
  if (useColor) {
    // eslint-disable-next-line no-console
    console.error(chalk.yellow(message));
  } else {
    // eslint-disable-next-line no-console
    console.error(message);
  }
}

export function printInfo(message: string): void {
  const useColor: boolean = !isColorDisabled();
  if (useColor) {
    // eslint-disable-next-line no-console
    console.log(chalk.blue(message));
  } else {
    // eslint-disable-next-line no-console
    console.log(message);
  }
}
