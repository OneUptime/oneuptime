import { Command } from "commander";
import {
  CLIContext,
  ResolvedCredentials,
  ResourceInfo,
} from "../Types/CLITypes";
import {
  getCurrentContext,
  CLIOptions,
  getResolvedCredentials,
} from "../Core/ConfigManager";
import { printInfo, printError } from "../Core/OutputFormatter";
import { discoverResources } from "./ResourceCommands";
import Table from "cli-table3";
import chalk from "chalk";

export function registerUtilityCommands(program: Command): void {
  // Version command
  program
    .command("version")
    .description("Print CLI version")
    .action(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const pkg: { version: string } = require("../package.json") as {
          version: string;
        };
        // eslint-disable-next-line no-console
        console.log(pkg.version);
      } catch {
        // Fallback if package.json can't be loaded at runtime
        // eslint-disable-next-line no-console
        console.log("1.0.0");
      }
    });

  // Whoami command
  program
    .command("whoami")
    .description("Show current authentication info")
    .action(() => {
      try {
        const ctx: CLIContext | null = getCurrentContext();
        const opts: Record<string, unknown> = program.opts();
        const cliOpts: CLIOptions = {
          apiKey: opts["apiKey"] as string | undefined,
          url: opts["url"] as string | undefined,
          context: opts["context"] as string | undefined,
        };

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
        if (ctx) {
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
    .action((options: { type?: string }) => {
      const resources: ResourceInfo[] = discoverResources();

      const filtered: ResourceInfo[] = options.type
        ? resources.filter((r: ResourceInfo) => {
            return r.modelType === options.type;
          })
        : resources;

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
