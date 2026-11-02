import { Command } from "commander";
import {
  CLIContext,
  OutputFormat,
  ResolvedCredentials,
  ResourceInfo,
} from "../Types/CLITypes";
import {
  getCurrentContext,
  load,
  CLIOptions,
  getResolvedCredentials,
} from "../Core/ConfigManager";
import { executeApiRequest, getServerVersion } from "../Core/ApiClient";
import { handleError } from "../Core/ErrorHandler";
import {
  createJsonOption,
  createOutputOption,
  formatOutput,
  isJsonOutputRequested,
  printInfo,
  printError,
  printWarning,
  resolveOutputFormat,
} from "../Core/OutputFormatter";
import { discoverResources } from "./ResourceCommands";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import Project from "Common/Models/DatabaseModels/Project";
import {
  ONEUPTIME_CLI_PACKAGE,
  getModelApiPathOf,
} from "Common/Utils/DeveloperDocs/CliCommands";
import Table from "cli-table3";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";

export const CLI_PACKAGE_NAME: string = ONEUPTIME_CLI_PACKAGE;

/*
 * The CLI's version, from its own package.json. This file runs from its
 * TypeScript source (npm start, the tests) and, once installed, from the
 * bundle at build/dist/Index.js (esbuild.config.js), which sit at different
 * depths below package.json. So walk up from here to the first package.json
 * that is the CLI's: one of another name (a project the CLI is installed
 * into, a scope folder) is not the CLI's version.
 */
export function readCliVersion(startDirectory: string = __dirname): string {
  let directory: string = path.resolve(startDirectory);

  for (;;) {
    try {
      const parsed: { name?: unknown; version?: unknown } = JSON.parse(
        fs.readFileSync(path.join(directory, "package.json"), "utf-8"),
      ) as { name?: unknown; version?: unknown };

      if (
        parsed.name === CLI_PACKAGE_NAME &&
        typeof parsed.version === "string" &&
        parsed.version
      ) {
        return parsed.version;
      }
    } catch {
      // No readable package.json here: keep walking up.
    }

    const parent: string = path.dirname(directory);

    if (parent === directory) {
      return "1.0.0";
    }

    directory = parent;
  }
}

/*
 * The version a development build reports, from its source: it names no
 * release, so it is never compared with OneUptime's.
 */
const DEVELOPMENT_VERSION: string = "1.0.0";

// "4f1c****0a13": all but the first four and last four characters hidden.
export function maskApiKey(apiKey: string): string {
  return apiKey.length > 8
    ? apiKey.substring(0, 4) + "****" + apiKey.substring(apiKey.length - 4)
    : "****";
}

/*
 * Whether the CLI and the OneUptime it talks to are of one release. Null
 * when either does not say, or is a development build.
 */
export function versionsMatch(
  cliVersion: string,
  serverVersion: string | null,
): boolean | null {
  if (
    !serverVersion ||
    cliVersion === DEVELOPMENT_VERSION ||
    serverVersion === DEVELOPMENT_VERSION
  ) {
    return null;
  }

  return cliVersion === serverVersion;
}

// What to do when they are not: install the CLI of OneUptime's version.
export function getVersionMismatchWarning(
  cliVersion: string,
  serverVersion: string,
): string {
  return `This CLI is ${cliVersion}, and the OneUptime it talks to is ${serverVersion}. Install the CLI of your OneUptime's version, so its commands match the resources your server has: npm install -g ${CLI_PACKAGE_NAME}@${serverVersion}`;
}

// The project an API key belongs to: the one project it may read.
async function readKeyProject(
  creds: ResolvedCredentials,
): Promise<{ _id: string; name: string } | null> {
  try {
    const result: JSONValue = await executeApiRequest({
      apiUrl: creds.apiUrl,
      apiKey: creds.apiKey,
      apiPath: getModelApiPathOf(Project),
      operation: "list",
      query: {},
      select: { _id: true, name: true },
      skip: 0,
      limit: 1,
    });
    const rows: JSONValue = Array.isArray(result)
      ? result
      : ((result as JSONObject | null)?.["data"] as JSONValue);
    const first: JSONObject | undefined = Array.isArray(rows)
      ? (rows[0] as JSONObject | undefined)
      : undefined;

    if (!first) {
      return null;
    }

    const id: JSONValue | undefined = first["_id"];

    return {
      _id:
        typeof id === "string"
          ? id
          : String((id as JSONObject | undefined)?.["value"] || ""),
      name: String(first["name"] || ""),
    };
  } catch (error) {
    /*
     * A key that may not read its project still signed in: a 422 is a
     * refusal of what it asked, after OneUptime took the key. Anything
     * else - an invalid key, an unreachable address - is the answer.
     */
    if (error instanceof Error && error.message.startsWith("API error (422)")) {
      return null;
    }

    throw error;
  }
}

export function registerUtilityCommands(program: Command): void {
  // Version command
  program
    .command("version")
    .description("Print CLI version")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action((_options: unknown, cmd: Command) => {
      if (isJsonOutputRequested(cmd)) {
        // eslint-disable-next-line no-console
        console.log(
          formatOutput({ version: readCliVersion() }, resolveOutputFormat(cmd)),
        );
        return;
      }

      // eslint-disable-next-line no-console
      console.log(readCliVersion());
    });

  // Whoami command
  program
    .command("whoami")
    .description("Show current authentication info")
    .option(
      "--check",
      "Ask OneUptime whether it takes the key, and show the key's project and OneUptime's version",
    )
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(async (options: { check?: boolean }, cmd: Command) => {
      const asJson: boolean = isJsonOutputRequested(cmd);

      try {
        const opts: Record<string, unknown> = program.opts();
        const cliOpts: CLIOptions = {
          apiKey: opts["apiKey"] as string | undefined,
          url: opts["url"] as string | undefined,
          context: opts["context"] as string | undefined,
        };
        const ctx: CLIContext | null = cliOpts.context
          ? load().contexts[cliOpts.context] || null
          : getCurrentContext();

        let creds: ResolvedCredentials;
        try {
          creds = getResolvedCredentials(cliOpts);
        } catch (error) {
          // Asked to check, a missing key is the answer: exit 2, below.
          if (options.check) {
            throw error;
          }

          if (asJson) {
            // eslint-disable-next-line no-console
            console.log(
              formatOutput({ authenticated: false }, resolveOutputFormat(cmd)),
            );
            return;
          }

          printInfo(
            "Not authenticated. Run `oneuptime login` to authenticate.",
          );
          return;
        }

        const maskedKey: string = maskApiKey(creds.apiKey);
        const contextName: string | null =
          ctx && ctx.apiKey === creds.apiKey && ctx.apiUrl === creds.apiUrl
            ? ctx.name
            : null;
        const cliVersion: string = readCliVersion();
        const answer: JSONObject = {
          authenticated: true,
          url: creds.apiUrl,
          apiKey: maskedKey,
          context: contextName,
          cliVersion,
        };
        let warning: string | null = null;

        if (options.check) {
          const project: { _id: string; name: string } | null =
            await readKeyProject(creds);
          let serverVersion: string | null = null;

          try {
            serverVersion = await getServerVersion(creds.apiUrl);
          } catch {
            serverVersion = null;
          }

          const match: boolean | null = versionsMatch(cliVersion, serverVersion);

          answer["project"] = project;
          answer["serverVersion"] = serverVersion;
          answer["versionsMatch"] = match;

          if (match === false && serverVersion) {
            warning = getVersionMismatchWarning(cliVersion, serverVersion);
          }
        }

        if (asJson) {
          // eslint-disable-next-line no-console
          console.log(formatOutput(answer, resolveOutputFormat(cmd)));
        } else {
          // eslint-disable-next-line no-console
          console.log(`URL:     ${creds.apiUrl}`);
          // eslint-disable-next-line no-console
          console.log(`API Key: ${maskedKey}`);
          if (contextName) {
            // eslint-disable-next-line no-console
            console.log(`Context: ${contextName}`);
          }

          if (options.check) {
            const project: JSONObject | null =
              (answer["project"] as JSONObject | null) || null;

            // eslint-disable-next-line no-console
            console.log(
              project
                ? `Project: ${String(project["name"])} (${String(project["_id"])})`
                : "Project: this key may not read its project",
            );
            // eslint-disable-next-line no-console
            console.log(
              `Server:  ${String(answer["serverVersion"] || "did not say its version")}`,
            );
            // eslint-disable-next-line no-console
            console.log(`CLI:     ${cliVersion}`);
          }
        }

        if (warning) {
          printWarning(warning);
        }
      } catch (error) {
        if (options.check) {
          handleError(error);
        }

        printError(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Resources command
  program
    .command("resources")
    .description("List all available resource types")
    .option("--type <type>", "Filter by model type: database, analytics")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action((options: { type?: string }, cmd: Command) => {
      const resources: ResourceInfo[] = discoverResources();

      const filtered: ResourceInfo[] = options.type
        ? resources.filter((r: ResourceInfo) => {
            return r.modelType === options.type;
          })
        : resources;

      const outputFormat: OutputFormat = resolveOutputFormat(cmd);

      if (outputFormat === OutputFormat.JSON) {
        const rows: Array<JSONObject> = filtered.map(
          (r: ResourceInfo): JSONObject => {
            return {
              name: r.name,
              singularName: r.singularName,
              pluralName: r.pluralName,
              modelType: r.modelType,
              apiPath: r.apiPath,
              operations: r.operations,
              actions: r.actions,
            };
          },
        );
        // eslint-disable-next-line no-console
        console.log(formatOutput(rows, outputFormat));
        return;
      }

      if (filtered.length === 0) {
        printInfo("No resources found.");
        return;
      }

      const noColor: boolean =
        process.env["NO_COLOR"] !== undefined ||
        process.argv.includes("--no-color");

      const table: Table.Table = new Table({
        head: ["Command", "Singular", "Plural", "Type", "API Path"].map(
          (h: string) => {
            return noColor ? h : chalk.cyan(h);
          },
        ),
        style: { head: [], border: [] },
      });

      for (const r of filtered) {
        table.push([
          r.name,
          r.singularName,
          r.pluralName,
          r.modelType,
          r.apiPath,
        ]);
      }

      // eslint-disable-next-line no-console
      console.log(table.toString());
      // eslint-disable-next-line no-console
      console.log(`\nTotal: ${filtered.length} resources`);
    });
}
