import { Command } from "commander";
import { CLIContext } from "../Types/CLITypes";
import { getCurrentContext, CLIOptions, getResolvedCredentials } from "../Core/ConfigManager";
import { ResolvedCredentials } from "../Types/CLITypes";
import { printInfo, printError } from "../Core/OutputFormatter";
import { discoverResources } from "./ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import Table from "cli-table3";
import chalk from "chalk";

export function registerUtilityCommands(program: Command): void {
  // Version command
  program
    .command("version")
    .description("Print CLI version")
    .action(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg: { version: string } = require("../package.json") as { version: string };
        console.log(pkg.version);
      } catch {
        // Fallback if package.json can't be loaded at runtime
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
          printInfo("Not authenticated. Run `oneuptime login` to authenticate.");
          return;
        }

        const maskedKey: string =
          creds.apiKey.length > 8
            ? creds.apiKey.substring(0, 4) +
              "****" +
              creds.apiKey.substring(creds.apiKey.length - 4)
            : "****";

        console.log(`URL:     ${creds.apiUrl}`);
        console.log(`API Key: ${maskedKey}`);
        if (ctx) {
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
        ? resources.filter((r: ResourceInfo) => r.modelType === options.type)
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
          (h: string) => (noColor ? h : chalk.cyan(h)),
        ),
        style: { head: [], border: [] },
      });

      for (const r of filtered) {
        table.push([r.name, r.singularName, r.pluralName, r.modelType, r.apiPath]);
      }

      console.log(table.toString());
      console.log(`\nTotal: ${filtered.length} resources`);
    });
}
