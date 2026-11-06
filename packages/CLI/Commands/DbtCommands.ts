import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  trimDbtManifest,
  trimDbtRunResults,
} from "Common/Types/DataObservability/DbtArtifact";
import {
  getResolvedIngestionKey,
  getResolvedInstanceUrl,
} from "../Core/ConfigManager";
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
 * oneuptime dbt upload: send a dbt project's artifacts after a build, from
 * CI or a dbt Cloud job, so Data Observability shows its models on the
 * tables they build, their lineage, their tests beside its checks, and each
 * build as a run of the project's pipeline. It reads target/manifest.json
 * and target/run_results.json, sends only what is read of them (a manifest
 * runs to tens of megabytes, mostly compiled SQL), and writes with a
 * telemetry ingestion key, as every other telemetry is written.
 */

export const DBT_ARTIFACTS_INGEST_PATH: string = "/telemetry/dbt/v1/artifacts";

export const DEFAULT_DBT_TARGET_PATH: string = "target";

export interface DbtUploadOptions {
  targetPath?: string | undefined;
  manifest?: string | undefined;
  runResults?: string | undefined;
  project?: string | undefined;
  ingestionKey?: string | undefined;
}

export interface DbtArtifactPaths {
  manifestPath: string;
  runResultsPath: string;
  // Whether each was named: a file named and missing is an error, a default one is not.
  isManifestNamed: boolean;
  isRunResultsNamed: boolean;
}

export function resolveDbtArtifactPaths(
  options: DbtUploadOptions,
): DbtArtifactPaths {
  const targetPath: string = options.targetPath || DEFAULT_DBT_TARGET_PATH;

  return {
    manifestPath: options.manifest || path.join(targetPath, "manifest.json"),
    runResultsPath:
      options.runResults || path.join(targetPath, "run_results.json"),
    isManifestNamed: Boolean(options.manifest),
    isRunResultsNamed: Boolean(options.runResults),
  };
}

// An artifact as JSON; null when a default path holds none.
export function readDbtArtifact(
  filePath: string,
  isNamed: boolean,
): JSONObject | null {
  if (!fs.existsSync(filePath)) {
    if (isNamed) {
      throw new Error(`There is no file at ${filePath}.`);
    }

    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`${filePath} is not a JSON file dbt wrote.`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath} is not a JSON file dbt wrote.`);
  }

  return parsed as JSONObject;
}

// What is sent: each artifact trimmed to what Data Observability reads.
export function buildDbtUpload(data: {
  manifest: JSONObject | null;
  runResults: JSONObject | null;
  project?: string | undefined;
}): JSONObject {
  const upload: JSONObject = {};

  if (data.manifest) {
    upload["manifest"] = trimDbtManifest(data.manifest);
  }

  if (data.runResults) {
    upload["run_results"] = trimDbtRunResults(data.runResults);
  }

  if (data.project && data.project.trim()) {
    upload["project"] = data.project.trim();
  }

  return upload;
}

// What OneUptime took, in one line.
export function describeDbtUpload(summary: JSONObject): string {
  const parts: Array<string> = [];

  if (Number(summary["tables"] || 0) > 0) {
    parts.push(
      `${Number(summary["matchedTables"] || 0)} of ${Number(summary["tables"])} models, seeds, snapshots and sources matched watched tables`,
    );
  }

  if (Number(summary["tests"] || 0) > 0) {
    parts.push(
      `${Number(summary["matchedTests"] || 0)} of ${Number(summary["tests"])} tests are on them`,
    );
  }

  if (Number(summary["testResults"] || 0) > 0) {
    parts.push(`${Number(summary["testResults"])} test results recorded`);
  }

  if (summary["run"]) {
    parts.push(
      summary["run"] === "FAIL"
        ? "the build is recorded as failed"
        : "the build is recorded",
    );
  }

  const project: string = String(summary["projectName"] || "the project");

  return parts.length > 0
    ? `Uploaded dbt project ${project}: ${parts.join(", ")}.`
    : `Uploaded dbt project ${project}.`;
}

/*
 * Posts the artifacts with the ingestion key; resolves to what OneUptime
 * took. The key is in the headers, so a redirect is followed only on the
 * server it was sent to: one pointing anywhere else would hand the key over.
 */
export async function sendDbtArtifacts(data: {
  instanceUrl: string;
  ingestionKey: string;
  upload: JSONObject;
}): Promise<JSONObject> {
  const url: URL = URL.fromString(data.instanceUrl);
  const requestUrl: URL = new URL(
    url.protocol,
    url.hostname,
    new Route(DBT_ARTIFACTS_INGEST_PATH),
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: requestUrl,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-oneuptime-token": data.ingestionKey,
      },
      data: data.upload,
      options: {
        sameServerRedirectsOnly: true,
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw new Error(
      `API error (${response.statusCode}): ${response.message || "Unknown error"}`,
    );
  }

  return response.data;
}

export function registerDbtCommands(program: Command): void {
  const dbt: Command = program
    .command("dbt")
    .description("Send a dbt project's artifacts to Data Observability");

  dbt
    .command("upload")
    .description(
      "Upload a dbt project's manifest and run results after a build: its models, lineage, tests and run",
    )
    .option(
      "--target-path <dir>",
      "The folder dbt wrote its artifacts to",
      DEFAULT_DBT_TARGET_PATH,
    )
    .option(
      "--manifest <file>",
      "The manifest (default: manifest.json in the target folder)",
    )
    .option(
      "--run-results <file>",
      "The run results (default: run_results.json in the target folder)",
    )
    .option(
      "--project <name>",
      "The dbt project's name, when no manifest is sent",
    )
    .option(
      "--ingestion-key <key>",
      "A telemetry ingestion key (default: ONEUPTIME_TELEMETRY_INGESTION_KEY)",
    )
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(async (options: DbtUploadOptions, cmd: Command) => {
      try {
        const globals: Record<string, unknown> = program.opts();
        const instanceUrl: string = getResolvedInstanceUrl({
          url: globals["url"] as string | undefined,
          context: globals["context"] as string | undefined,
        });
        const ingestionKey: string = getResolvedIngestionKey(
          options.ingestionKey,
        );
        const paths: DbtArtifactPaths = resolveDbtArtifactPaths(options);
        const manifest: JSONObject | null = readDbtArtifact(
          paths.manifestPath,
          paths.isManifestNamed,
        );
        const runResults: JSONObject | null = readDbtArtifact(
          paths.runResultsPath,
          paths.isRunResultsNamed,
        );

        if (!manifest && !runResults) {
          throw new Error(
            `There are no dbt artifacts in ${options.targetPath || DEFAULT_DBT_TARGET_PATH}: run dbt build first, or name them with --manifest and --run-results.`,
          );
        }

        const summary: JSONObject = await sendDbtArtifacts({
          instanceUrl,
          ingestionKey,
          upload: buildDbtUpload({
            manifest,
            runResults,
            project: options.project,
          }),
        });

        if (isJsonOutputRequested(cmd)) {
          // eslint-disable-next-line no-console
          console.log(formatOutput(summary, resolveOutputFormat(cmd)));
          return;
        }

        printSuccess(describeDbtUpload(summary));
      } catch (error) {
        handleError(error);
      }
    });
}
