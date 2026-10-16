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
import {
  createOutputOption,
  formatOutput,
  printInfo,
  printError,
  resolveOutputFormat,
} from "../Core/OutputFormatter";
import { discoverResources } from "./ResourceCommands";
import { JSONObject } from "Common/Types/JSON";
import Table from "cli-table3";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";

export const CLI_PACKAGE_NAME: string = "@oneuptime/cli";

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

export function registerUtilityCommands(program: Command): void {
  // Version command
  program
    .command("version")
    .description("Print CLI version")
    .action(() => {
      // eslint-disable-next-line no-console
      console.log(readCliVersion());
    });

  // Whoami command
  program
    .command("whoami")
    .description("Show current authentication info")
    .action(() => {
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
        } catch {
          printInfo(
            "Not authenticated. Run `oneuptime login` to authenticate.",
          );
          return;
        }

        const maskedKey: string =
          creds.apiKey.length > 8
            ? creds.apiKey.substring(0, 4) +
              "****" +
              creds.apiKey.substring(creds.apiKey.length - 4)
            : "****";

        // eslint-disable-next-line no-console
        console.log(`URL:     ${creds.apiUrl}`);
        // eslint-disable-next-line no-console
        console.log(`API Key: ${maskedKey}`);
        if (ctx && ctx.apiKey === creds.apiKey && ctx.apiUrl === creds.apiUrl) {
          // eslint-disable-next-line no-console
          console.log(`Context: ${ctx.name}`);
        }
      } catch (error) {
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
