import { Command, Option } from "commander";
import * as fs from "fs";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { ResolvedCredentials, ResourceInfo } from "../Types/CLITypes";
import { getResolvedCredentials } from "../Core/ConfigManager";
import { handleError } from "../Core/ErrorHandler";
import {
  createJsonOption,
  createOutputOption,
  formatOutput,
  isJsonOutputRequested,
  printSuccess,
  resolveOutputFormat,
} from "../Core/OutputFormatter";
import { getParentOptions } from "../Utils/CommandOptions";

/*
 * WHAT THE CLOUDS COST, BROKEN DOWN AND EXPORTED, FROM THE CLI (#11009)
 *
 *   oneuptime cloud-cost breakdown --by group --view <id> --period last-month
 *   oneuptime cloud-cost breakdown --by service --period last-week --csv
 *   oneuptime cloud-cost export --period last-month --file focus.csv
 *
 * `breakdown` answers what Cloud > Costs' "Where the money goes" shows -
 * the period's spend by service, Region, account, resource, App Platforms
 * environment or app, a tag's value, or a cost view's groups - with the
 * period before beside it (POST /cloud-cost/breakdown); --csv prints the
 * file the page's Download CSV gives. `export` writes every cost of the
 * period as a FOCUS 1.2 file (POST /cloud-cost/export). Both read as the
 * key may read the costs.
 */

export const CLOUD_COST_BREAKDOWN_PATH: string = "/api/cloud-cost/breakdown";
export const CLOUD_COST_EXPORT_PATH: string = "/api/cloud-cost/export";

export interface CloudCostBreakdownOptions {
  by?: string | undefined;
  tagKey?: string | undefined;
  view?: string | undefined;
  period?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  account?: Array<string> | undefined;
  currency?: string | undefined;
  basis?: string | undefined;
  compare?: boolean | undefined;
  csv?: boolean | undefined;
}

export interface CloudCostExportOptions {
  period?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  account?: Array<string> | undefined;
  file?: string | undefined;
}

// The request body a breakdown's flags make.
export function toBreakdownBody(options: CloudCostBreakdownOptions): JSONObject {
  const body: JSONObject = {
    by: options.by || "service",
    compareWithPrevious: options.compare !== false,
  };

  if (options.tagKey) {
    body["tagKey"] = options.tagKey;
  }

  if (options.view) {
    body["cloudCostViewId"] = options.view;
  }

  if (options.startDate || options.endDate) {
    if (!options.startDate || !options.endDate) {
      throw new Error(
        "Give both --start-date and --end-date, such as --start-date 2026-11-01 --end-date 2026-11-30.",
      );
    }

    body["startDate"] = options.startDate;
    body["endDate"] = options.endDate;
  } else {
    body["period"] = options.period || "this-month";
  }

  if (options.account && options.account.length > 0) {
    body["cloudAccountIds"] = options.account;
  }

  if (options.currency) {
    body["currency"] = options.currency;
  }

  if (options.basis) {
    body["basis"] = options.basis;
  }

  if (options.csv) {
    body["format"] = "csv";
  }

  return body;
}

// The request body an export's flags make.
export function toExportBody(options: CloudCostExportOptions): JSONObject {
  const body: JSONObject = {};

  if (options.startDate || options.endDate) {
    if (!options.startDate || !options.endDate) {
      throw new Error(
        "Give both --start-date and --end-date, such as --start-date 2026-11-01 --end-date 2026-11-30.",
      );
    }

    body["startDate"] = options.startDate;
    body["endDate"] = options.endDate;
  } else {
    body["period"] = options.period || "last-month";
  }

  if (options.account && options.account.length > 0) {
    body["cloudAccountIds"] = options.account;
  }

  return body;
}

// Posts to one of the routes, as the key: its answer, or why not.
export async function postCloudCost(data: {
  apiUrl: string;
  apiKey: string;
  path: string;
  body: JSONObject;
  isText: boolean;
}): Promise<JSONValue> {
  const url: URL = URL.fromString(data.apiUrl);
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: new URL(url.protocol, url.hostname, new Route(data.path)),
      headers: {
        "Content-Type": "application/json",
        Accept: data.isText ? "text/csv" : "application/json",
        APIKey: data.apiKey,
      },
      data: data.body,
      options: {
        // The key is in the headers: a redirect elsewhere would hand it over.
        sameServerRedirectsOnly: true,
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw new Error(
      `API error (${response.statusCode}): ${response.message || "Unknown error"}`,
    );
  }

  // A text answer - the CSV, the FOCUS file - is held as { data: <text> }.
  if (response.isText) {
    return String((response.data as JSONObject)["data"] ?? "");
  }

  return response.data as unknown as JSONValue;
}

// A change in percent, or "" with nothing to compare with.
export function toChangePercent(amount: number, previous: number): string {
  if (!Number.isFinite(previous) || Math.abs(previous) < 0.005) {
    return "";
  }

  return `${(((amount - previous) / Math.abs(previous)) * 100).toFixed(1)}%`;
}

/*
 * A breakdown's answer as rows for the table: each share and the rest,
 * with the period before and the change between them.
 */
export function toBreakdownRows(answer: JSONObject): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  const hasPrevious: boolean = typeof answer["previousTotal"] === "number";

  for (const list of ["shares", "rest"]) {
    const items: unknown = answer[list];

    if (!Array.isArray(items)) {
      continue;
    }

    for (const item of items as Array<JSONObject>) {
      const amount: number = Number(item["amount"]) || 0;
      const previous: number = Number(item["previousAmount"]) || 0;

      rows.push({
        name: String(item["name"] ?? ""),
        key: String(item["key"] ?? item["kind"] ?? ""),
        amount: Math.round(amount * 100) / 100,
        ...(hasPrevious
          ? {
              previousAmount: Math.round(previous * 100) / 100,
              change: toChangePercent(amount, previous),
            }
          : {}),
      });
    }
  }

  return rows;
}

function credentialsOf(cmd: Command): ResolvedCredentials {
  return getResolvedCredentials(getParentOptions(cmd));
}

/*
 * `breakdown` and `export` under `oneuptime cloud-cost`, beside its list,
 * get and count.
 */
export function registerCloudCostCommands(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  if (resource.name !== "cloud-cost") {
    return;
  }

  registerCloudCostBreakdownCommand(resourceCmd);
  registerCloudCostExportCommand(resourceCmd);
}

// `oneuptime cloud-cost breakdown`: POST /cloud-cost/breakdown.
export function registerCloudCostBreakdownCommand(resourceCmd: Command): void {
  resourceCmd
    .command("breakdown")
    .description(
      "What the clouds cost in a period by service, Region, account, resource, environment, app, tag or cost group, with the period before",
    )
    .addOption(
      new Option("--by <dimension>", "What to break the spend down by")
        .choices([
          "service",
          "region",
          "account",
          "resource",
          "environment",
          "app",
          "tag",
          "group",
        ])
        .default("service"),
    )
    .option("--tag-key <key>", "The tag, for --by tag, such as team")
    .option("--view <id>", "The cost view whose groups --by group is by")
    .addOption(
      new Option("--period <period>", "The days to read")
        .choices(["this-month", "last-month", "last-week", "last-30-days"])
        .default("this-month"),
    )
    .option("--start-date <date>", "The first day, such as 2026-11-01")
    .option("--end-date <date>", "The last day, such as 2026-11-30")
    // One or more, as `--account a b` or `--account a --account b`.
    .option("--account <id...>", "Only these cloud accounts' costs")
    .option("--currency <code>", "The currency, such as USD")
    .addOption(
      new Option("--basis <basis>", "The cost basis").choices([
        "billed",
        "amortized",
        "net",
      ]),
    )
    .option("--no-compare", "Leave out the period before")
    .option("--csv", "Print the CSV the Costs page's Download CSV gives")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(async (options: CloudCostBreakdownOptions, cmd: Command) => {
      try {
        const credentials: ResolvedCredentials = credentialsOf(cmd);
        const answer: JSONValue = await postCloudCost({
          apiUrl: credentials.apiUrl,
          apiKey: credentials.apiKey,
          path: CLOUD_COST_BREAKDOWN_PATH,
          body: toBreakdownBody(options),
          isText: Boolean(options.csv),
        });

        if (options.csv) {
          process.stdout.write(String(answer ?? ""));
          return;
        }

        if (isJsonOutputRequested(cmd)) {
          // eslint-disable-next-line no-console
          console.log(formatOutput(answer, resolveOutputFormat(cmd)));
          return;
        }

        const result: JSONObject = (answer || {}) as JSONObject;

        // eslint-disable-next-line no-console
        console.log(
          formatOutput(
            toBreakdownRows(result) as unknown as JSONValue,
            resolveOutputFormat(cmd),
          ),
        );
        printSuccess(
          `${String(result["start"] || "")} to ${String(result["lastDay"] || "")}, ${String(result["basis"] || "")}: ${String(result["total"] ?? "")} ${String(result["currency"] || "")}${
            typeof result["previousTotal"] === "number"
              ? ` (before: ${String(result["previousTotal"])})`
              : ""
          }`,
        );
      } catch (error) {
        handleError(error);
      }
    });
}

// `oneuptime cloud-cost export`: POST /cloud-cost/export, a FOCUS 1.2 file.
export function registerCloudCostExportCommand(resourceCmd: Command): void {
  resourceCmd
    .command("export")
    .description(
      "Every cost of a period as a FOCUS 1.2 file, for finance tools that read FOCUS",
    )
    .addOption(
      new Option("--period <period>", "The days to export")
        .choices(["this-month", "last-month", "last-week", "last-30-days"])
        .default("last-month"),
    )
    .option("--start-date <date>", "The first day, such as 2026-11-01")
    .option("--end-date <date>", "The last day, such as 2026-11-30")
    .option("--account <id...>", "Only these cloud accounts' costs")
    .option("--file <path>", "Write the file here instead of to standard output")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(async (options: CloudCostExportOptions, cmd: Command) => {
      try {
        const credentials: ResolvedCredentials = credentialsOf(cmd);
        const text: string = String(
          (await postCloudCost({
            apiUrl: credentials.apiUrl,
            apiKey: credentials.apiKey,
            path: CLOUD_COST_EXPORT_PATH,
            body: toExportBody(options),
            isText: true,
          })) ?? "",
        );
        if (options.file) {
          fs.writeFileSync(options.file, text, "utf8");

          if (isJsonOutputRequested(cmd)) {
            // eslint-disable-next-line no-console
            console.log(
              formatOutput(
                {
                  file: options.file,
                  focusVersion: "1.2",
                  bytes: Buffer.byteLength(text, "utf8"),
                },
                resolveOutputFormat(cmd),
              ),
            );
            return;
          }

          printSuccess(`Wrote the FOCUS 1.2 file to ${options.file}.`);
          return;
        }

        // The file itself is what is asked for: as it is, whatever -o says.
        process.stdout.write(text);
      } catch (error) {
        handleError(error);
      }
    });
}
