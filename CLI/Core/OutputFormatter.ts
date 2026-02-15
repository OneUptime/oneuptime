import { OutputFormat } from "../Types/CLITypes";
import { JSONValue, JSONObject, JSONArray } from "Common/Types/JSON";
import Table from "cli-table3";
import chalk from "chalk";

function isColorDisabled(): boolean {
  return (
    process.env["NO_COLOR"] !== undefined ||
    process.argv.includes("--no-color")
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
  if (!data) {
    return "No data returned.";
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
    const prioritized: string[] = priority.filter((col: string) =>
      columns.includes(col),
    );
    const remaining: string[] = columns.filter(
      (col: string) => !priority.includes(col),
    );
    columns = [...prioritized, ...remaining].slice(0, 6);
  }

  const useColor: boolean = !isColorDisabled();

  const table: Table.Table = new Table({
    head: columns.map((col: string) =>
      useColor ? chalk.cyan(col) : col,
    ),
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
    console.log(chalk.green(message));
  } else {
    console.log(message);
  }
}

export function printError(message: string): void {
  const useColor: boolean = !isColorDisabled();
  if (useColor) {
    console.error(chalk.red(message));
  } else {
    console.error(message);
  }
}

export function printWarning(message: string): void {
  const useColor: boolean = !isColorDisabled();
  if (useColor) {
    console.error(chalk.yellow(message));
  } else {
    console.error(message);
  }
}

export function printInfo(message: string): void {
  const useColor: boolean = !isColorDisabled();
  if (useColor) {
    console.log(chalk.blue(message));
  } else {
    console.log(message);
  }
}
