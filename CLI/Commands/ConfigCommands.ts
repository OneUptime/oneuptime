import { Command } from "commander";
import * as ConfigManager from "../Core/ConfigManager";
import { CLIContext } from "../Types/CLITypes";
import { printSuccess, printError, printInfo } from "../Core/OutputFormatter";
import Table from "cli-table3";
import chalk from "chalk";

export function registerConfigCommands(program: Command): void {
  // Login command
  const loginCmd: Command = program
    .command("login")
    .description("Authenticate with a OneUptime instance")
    .argument("<api-key>", "API key for authentication")
    .argument("<instance-url>", "OneUptime instance URL (e.g. https://oneuptime.com)")
    .option(
      "--context-name <name>",
      "Name for this context",
      "default",
    )
    .action(
      (apiKey: string, instanceUrl: string, options: { contextName: string }) => {
        try {
          const context: CLIContext = {
            name: options.contextName,
            apiUrl: instanceUrl.replace(/\/+$/, ""),
            apiKey: apiKey,
          };

          ConfigManager.addContext(context);
          ConfigManager.setCurrentContext(context.name);

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
    .action(() => {
      const contexts: Array<CLIContext & { isCurrent: boolean }> =
        ConfigManager.listContexts();

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
        head: ["", "Name", "URL"].map((h: string) =>
          noColor ? h : chalk.cyan(h),
        ),
        style: { head: [], border: [] },
      });

      for (const ctx of contexts) {
        table.push([
          ctx.isCurrent ? "*" : "",
          ctx.name,
          ctx.apiUrl,
        ]);
      }

      console.log(table.toString());
    });

  contextCmd
    .command("use <name>")
    .description("Switch to a different context")
    .action((name: string) => {
      try {
        ConfigManager.setCurrentContext(name);
        printSuccess(`Switched to context "${name}".`);
      } catch (error) {
        printError(
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      }
    });

  contextCmd
    .command("current")
    .description("Show the current active context")
    .action(() => {
      const ctx: CLIContext | null = ConfigManager.getCurrentContext();
      if (!ctx) {
        printInfo(
          "No current context set. Run `oneuptime login` to create one.",
        );
        return;
      }

      const maskedKey: string =
        ctx.apiKey.length > 8
          ? ctx.apiKey.substring(0, 4) +
            "****" +
            ctx.apiKey.substring(ctx.apiKey.length - 4)
          : "****";

      console.log(`Context: ${ctx.name}`);
      console.log(`URL:     ${ctx.apiUrl}`);
      console.log(`API Key: ${maskedKey}`);
    });

  contextCmd
    .command("delete <name>")
    .description("Delete a context")
    .action((name: string) => {
      try {
        ConfigManager.removeContext(name);
        printSuccess(`Context "${name}" deleted.`);
      } catch (error) {
        printError(
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      }
    });
}
