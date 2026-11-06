import { Command } from "commander";
import * as fs from "fs";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { DataObservabilityCheckApplyResult } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "Common/Types/JSON";
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

/*
 * oneuptime data-checks apply: make a project's data checks match a file in its
 * repository, from CI, so a check is reviewed in the same pull request as the
 * table it checks. --dry-run says what would change and changes nothing, which
 * is what a pull request's build runs. A mistake anywhere in the file exits
 * non-zero with nothing applied.
 */

export const DATA_CHECK_APPLY_PATH: string =
  "/api/data-observability/checks/apply";

export interface DataCheckApplyOptions {
  dryRun?: boolean | undefined;
  prune?: boolean | undefined;
}

export function readManifestFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`There is no file at ${filePath}.`);
  }

  return fs.readFileSync(filePath, "utf8");
}

// What changed, in one line, then each error on its own.
export function describeApplyResult(
  result: DataObservabilityCheckApplyResult,
): string {
  if (result.errors.length > 0) {
    return `Nothing was applied:\n${result.errors
      .map((error: string): string => {
        return `  ${error}`;
      })
      .join("\n")}`;
  }

  const verb: string = result.isDryRun ? "Would apply" : "Applied";
  const summary: string = `${verb}: ${result.created.length} to create, ${result.updated.length} to update, ${result.removed.length} to remove, ${result.unchanged.length} unchanged.`;

  return [summary, ...(result.warnings || [])].join("\n");
}

export async function sendDataCheckManifest(data: {
  apiUrl: string;
  apiKey: string;
  manifest: string;
  isDryRun: boolean;
  shouldPrune: boolean;
}): Promise<DataObservabilityCheckApplyResult> {
  const url: URL = URL.fromString(data.apiUrl);
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: new URL(
        url.protocol,
        url.hostname,
        new Route(DATA_CHECK_APPLY_PATH),
      ),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        APIKey: data.apiKey,
      },
      data: {
        manifest: data.manifest,
        isDryRun: data.isDryRun,
        shouldPrune: data.shouldPrune,
      },
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

  return response.data as unknown as DataObservabilityCheckApplyResult;
}

export function registerDataCheckCommands(program: Command): void {
  const dataChecks: Command = program
    .command("data-checks")
    .description(
      "Keep Data Observability's checks in a file in your repository",
    );

  dataChecks
    .command("apply <file>")
    .description(
      "Make the project's data checks match a YAML file. Nothing is applied unless all of it can be.",
    )
    .option("--dry-run", "Say what would change, and change nothing")
    .option(
      "--prune",
      "Delete checks an earlier apply made that the file no longer names",
    )
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(
      async (file: string, options: DataCheckApplyOptions, cmd: Command) => {
        try {
          const globals: Record<string, unknown> = program.opts();
          const credentials: { apiKey: string; apiUrl: string } =
            getResolvedCredentials({
              apiKey: globals["apiKey"] as string | undefined,
              url: globals["url"] as string | undefined,
              context: globals["context"] as string | undefined,
            });
          const result: DataObservabilityCheckApplyResult =
            await sendDataCheckManifest({
              apiUrl: credentials.apiUrl,
              apiKey: credentials.apiKey,
              manifest: readManifestFile(file),
              isDryRun: options.dryRun === true,
              shouldPrune: options.prune === true,
            });

          if (isJsonOutputRequested(cmd)) {
            // eslint-disable-next-line no-console
            console.log(
              formatOutput(
                result as unknown as JSONObject,
                resolveOutputFormat(cmd),
              ),
            );
          } else if (result.errors.length === 0) {
            printSuccess(describeApplyResult(result));
          }

          if (result.errors.length > 0) {
            throw new Error(describeApplyResult(result));
          }
        } catch (error) {
          handleError(error);
        }
      },
    );
}
