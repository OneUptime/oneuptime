import { Command } from "commander";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  getResolvedIngestionKey,
  getResolvedInstanceUrl,
} from "../Core/ConfigManager";
import { handleError } from "../Core/ErrorHandler";
import { printSuccess } from "../Core/OutputFormatter";

/*
 * oneuptime deploy: record a deploy - or another change - from a pipeline,
 * so it is drawn on the service's charts and read by OneUptime AI when it
 * investigates an incident. It posts to the change-events ingest API with a
 * telemetry ingestion key, as every other telemetry is written.
 */

export const CHANGE_EVENTS_INGEST_PATH: string =
  "/telemetry/change-events/v1/ingest";

export interface DeployOptions {
  service?: string | undefined;
  serviceVersion?: string | undefined;
  previousVersion?: string | undefined;
  commit?: string | undefined;
  repository?: string | undefined;
  branch?: string | undefined;
  pullRequest?: string | undefined;
  environment?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  type?: string | undefined;
  time?: string | undefined;
  attribute?: Array<string> | undefined;
  ingestionKey?: string | undefined;
}

// "team=payments" -> ["team", "payments"]; the value may hold "=" itself.
export function parseAttribute(pair: string): [string, string] {
  const index: number = pair.indexOf("=");

  if (index <= 0) {
    throw new Error(`--attribute takes key=value, and "${pair}" is not one.`);
  }

  return [pair.slice(0, index).trim(), pair.slice(index + 1)];
}

// The change event the options describe, as the ingest API takes it.
export function buildDeployEvent(options: DeployOptions): JSONObject {
  const type: string = (options.type || "deployment").trim() || "deployment";
  const version: string | undefined = options.serviceVersion?.trim();

  let title: string | undefined = options.title?.trim();

  if (!title) {
    if (type !== "deployment") {
      throw new Error(`A ${type} change needs a --title.`);
    }

    title = version ? `Deploy ${version}` : "Deploy";
  }

  const event: JSONObject = { title, eventType: type };

  const fields: Array<[string, string | undefined]> = [
    ["serviceName", options.service],
    ["description", options.description],
    ["version", version],
    ["previousVersion", options.previousVersion],
    ["commit", options.commit],
    ["repository", options.repository],
    ["branch", options.branch],
    ["pullRequest", options.pullRequest],
    ["environment", options.environment],
  ];

  for (const [field, value] of fields) {
    if (value && value.trim()) {
      event[field] = value.trim();
    }
  }

  if (options.time) {
    const time: Date = new Date(options.time);

    if (Number.isNaN(time.getTime())) {
      throw new Error(
        `--time takes a date and time, such as 2026-10-19T10:00:00Z, and "${options.time}" is not one.`,
      );
    }

    event["time"] = time.toISOString();
  }

  if (options.attribute && options.attribute.length > 0) {
    const attributes: JSONObject = {};

    for (const pair of options.attribute) {
      const [key, value] = parseAttribute(pair);
      attributes[key] = value;
    }

    event["attributes"] = attributes;
  }

  return event;
}

// What was recorded, in one line.
export function describeRecorded(event: JSONObject): string {
  const service: string = event["serviceName"]
    ? ` of ${event["serviceName"] as string}`
    : "";
  const version: string = event["version"]
    ? ` ${event["version"] as string}`
    : "";

  if (event["eventType"] === "deployment") {
    return `Recorded the deploy${service}${version}.`;
  }

  return `Recorded the ${event["eventType"] as string} change "${event["title"] as string}"${service}.`;
}

// Posts the events with the ingestion key; resolves to what OneUptime stored.
export async function sendChangeEvents(data: {
  instanceUrl: string;
  ingestionKey: string;
  events: Array<JSONObject>;
}): Promise<JSONObject> {
  const url: URL = URL.fromString(data.instanceUrl);
  const requestUrl: URL = new URL(
    url.protocol,
    url.hostname,
    new Route(CHANGE_EVENTS_INGEST_PATH),
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: requestUrl,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-oneuptime-token": data.ingestionKey,
      },
      data: { events: data.events },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw new Error(
      `API error (${response.statusCode}): ${response.message || "Unknown error"}`,
    );
  }

  return response.data;
}

export function registerDeployCommands(program: Command): void {
  program
    .command("deploy")
    .description(
      "Record a deploy, or another change, on a service's charts and for OneUptime AI's investigations",
    )
    .option(
      "--service <name>",
      "The service deployed (none: a project-wide change)",
    )
    .option("--service-version <version>", "The version deployed")
    .option("--previous-version <version>", "The version it replaced")
    .option("--commit <sha>", "The commit deployed")
    .option("--repository <url>", "The repository of the commit")
    .option("--branch <name>", "The branch deployed")
    .option("--pull-request <number>", "The pull request deployed")
    .option("--environment <name>", "The environment deployed to")
    .option("--title <title>", "The change's title (default: Deploy <version>)")
    .option("--description <text>", "Details of the change")
    .option("--type <type>", "The kind of change", "deployment")
    .option("--time <time>", "When it happened (default: now)")
    .option("--attribute <key=value...>", "More attributes, as key=value")
    .option(
      "--ingestion-key <key>",
      "A telemetry ingestion key (default: ONEUPTIME_TELEMETRY_INGESTION_KEY)",
    )
    .action(async (options: DeployOptions) => {
      try {
        const globals: Record<string, unknown> = program.opts();
        const instanceUrl: string = getResolvedInstanceUrl({
          url: globals["url"] as string | undefined,
          context: globals["context"] as string | undefined,
        });
        const ingestionKey: string = getResolvedIngestionKey(
          options.ingestionKey,
        );
        const event: JSONObject = buildDeployEvent(options);

        const result: JSONObject = await sendChangeEvents({
          instanceUrl,
          ingestionKey,
          events: [event],
        });

        if (Number(result["ingested"] || 0) < 1) {
          throw new Error("OneUptime did not record the change.");
        }

        printSuccess(describeRecorded(event));
      } catch (error) {
        handleError(error);
      }
    });
}
