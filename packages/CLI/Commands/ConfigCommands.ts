import { Command } from "commander";
import * as ConfigManager from "../Core/ConfigManager";
import { CLIContext, OutputFormat } from "../Types/CLITypes";
import {
  createJsonOption,
  createOutputOption,
  formatOutput,
  isJsonOutputRequested,
  printSuccess,
  printError,
  printInfo,
  resolveOutputFormat,
} from "../Core/OutputFormatter";
import { maskApiKey } from "./UtilityCommands";
import { JSONObject } from "Common/Types/JSON";
import Table from "cli-table3";
import chalk from "chalk";

export function registerConfigCommands(program: Command): void {
  // Login command
  const loginCmd: Command = program
    .command("login")
    .description("Authenticate with a OneUptime instance")
    .argument("<api-key>", "API key for authentication")
    .argument(
      "<instance-url>",
      "OneUptime instance URL (e.g. https://oneuptime.com)",
    )
    .option("--context-name <name>", "Name for this context", "default")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(
      (
        apiKey: string,
        instanceUrl: string,
        options: { contextName: string },
        cmd: Command,
      ) => {
        try {
          const context: CLIContext = {
            name: options.contextName,
            apiUrl: instanceUrl.replace(/\/+$/, ""),
            apiKey: apiKey,
          };

          ConfigManager.addContext(context);
          ConfigManager.setCurrentContext(context.name);

          if (isJsonOutputRequested(cmd)) {
            // eslint-disable-next-line no-console
            console.log(
              formatOutput(
                { name: context.name, apiUrl: context.apiUrl, isCurrent: true },
                resolveOutputFormat(cmd),
              ),
            );
            return;
          }

          printSuccess(
            `Logged in successfully. Context "${context.name}" is now active.`,
          );
        } catch (error) {
          printError(
            `Login failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          process.exit(1);
        }
      },
    );

  // Suppress unused variable warning - loginCmd is used for registration
  void loginCmd;

  // Context commands
  const contextCmd: Command = program
    .command("context")
    .description("Manage CLI contexts (environments/projects)");

  contextCmd
    .command("list")
    .description("List all configured contexts")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action((_options: unknown, cmd: Command) => {
      const contexts: Array<CLIContext & { isCurrent: boolean }> =
        ConfigManager.listContexts();

      const outputFormat: OutputFormat = resolveOutputFormat(cmd);

      if (outputFormat === OutputFormat.JSON) {
        // Same fields as the table; API keys are never printed.
        const rows: Array<JSONObject> = contexts.map(
          (ctx: CLIContext & { isCurrent: boolean }): JSONObject => {
            return {
              name: ctx.name,
              apiUrl: ctx.apiUrl,
              isCurrent: ctx.isCurrent,
            };
          },
        );
        // eslint-disable-next-line no-console
        console.log(formatOutput(rows, outputFormat));
        return;
      }

      if (contexts.length === 0) {
        printInfo(
          "No contexts configured. Run `oneuptime login` to create one.",
        );
        return;
      }

      const noColor: boolean =
        process.env["NO_COLOR"] !== undefined ||
        process.argv.includes("--no-color");

      const table: Table.Table = new Table({
        head: ["", "Name", "URL"].map((h: string) => {
          return noColor ? h : chalk.cyan(h);
        }),
        style: { head: [], border: [] },
      });

      for (const ctx of contexts) {
        table.push([ctx.isCurrent ? "*" : "", ctx.name, ctx.apiUrl]);
      }

      // eslint-disable-next-line no-console
      console.log(table.toString());
    });

  contextCmd
    .command("use <name>")
    .description("Switch to a different context")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action((name: string, _options: unknown, cmd: Command) => {
      try {
        ConfigManager.setCurrentContext(name);

        if (isJsonOutputRequested(cmd)) {
          // eslint-disable-next-line no-console
          console.log(
            formatOutput({ name, isCurrent: true }, resolveOutputFormat(cmd)),
          );
          return;
        }

        printSuccess(`Switched to context "${name}".`);
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  contextCmd
    .command("current")
    .description("Show the current active context")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action((_options: unknown, cmd: Command) => {
      const ctx: CLIContext | null = ConfigManager.getCurrentContext();
      const asJson: boolean = isJsonOutputRequested(cmd);

      if (!ctx) {
        if (asJson) {
          // eslint-disable-next-line no-console
          console.log(formatOutput(null, resolveOutputFormat(cmd)));
          return;
        }

        printInfo(
          "No current context set. Run `oneuptime login` to create one.",
        );
        return;
      }

      const maskedKey: string = maskApiKey(ctx.apiKey);

      if (asJson) {
        // eslint-disable-next-line no-console
        console.log(
          formatOutput(
            { name: ctx.name, apiUrl: ctx.apiUrl, apiKey: maskedKey },
            resolveOutputFormat(cmd),
          ),
        );
        return;
      }

      // eslint-disable-next-line no-console
      console.log(`Context: ${ctx.name}`);
      // eslint-disable-next-line no-console
      console.log(`URL:     ${ctx.apiUrl}`);
      // eslint-disable-next-line no-console
      console.log(`API Key: ${maskedKey}`);
    });

  contextCmd
    .command("delete <name>")
    .description("Delete a context")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action((name: string, _options: unknown, cmd: Command) => {
      try {
        ConfigManager.removeContext(name);

        if (isJsonOutputRequested(cmd)) {
          // eslint-disable-next-line no-console
          console.log(
            formatOutput({ name, deleted: true }, resolveOutputFormat(cmd)),
          );
          return;
        }

        printSuccess(`Context "${name}" deleted.`);
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
