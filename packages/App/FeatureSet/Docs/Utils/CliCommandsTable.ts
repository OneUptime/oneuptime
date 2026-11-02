import { TranslateFn, makeT } from "./I18n";
import { toTableCell } from "./PermissionsTable";
import { CLI_FIELDS_SUBCOMMAND } from "Common/Utils/DeveloperDocs/CliCommands";
import {
  CliResource,
  getCliResources,
} from "Common/Utils/DeveloperDocs/CliResources";

/*
 * The CLI command reference's table of resources: every resource command
 * of the oneuptime CLI, with its subcommands, worked out by the code the
 * CLI builds its commands with (Common/Utils/DeveloperDocs/CliResources).
 * Written down, the page listed 52 commands when the CLI had 456, and fell
 * behind each time OneUptime gained a resource; read from there, it lists
 * exactly the commands of the release that serves it, as `oneuptime
 * resources` does.
 *
 * Only the headers are translated. A command and its subcommands are what a
 * reader types, in every language, and a resource's name is its model's, as
 * the API reference and the permission tables write it.
 */

export const CLI_RESOURCE_COMMANDS_PLACEHOLDER: string =
  "{{CLI_RESOURCE_COMMANDS}}";

// Built once per language: the resources are the same for every request.
const tablesByLanguage: Map<string, string> = new Map();

/*
 * A resource's subcommands, in the order its command has them: its
 * operations, `fields`, then its actions (the CLI's getResourceSubcommands).
 */
export function getCliResourceSubcommands(
  resource: CliResource,
): Array<string> {
  return [...resource.operations, CLI_FIELDS_SUBCOMMAND, ...resource.actions];
}

// Every resource, by its command, as `oneuptime resources` lists them.
export function getCliResourcesByCommand(): Array<CliResource> {
  return [...getCliResources()].sort((a: CliResource, b: CliResource) => {
    return a.name.localeCompare(b.name);
  });
}

export function getCliResourceCommandsMarkdown(lang: string): string {
  const cached: string | undefined = tablesByLanguage.get(lang);

  if (cached !== undefined) {
    return cached;
  }

  const t: TranslateFn = makeT(lang);
  const lines: Array<string> = [
    `| ${t("ui.cliResourcesColCommand")} | ${t("ui.cliResourcesColResource")} | ${t("ui.cliResourcesColSubcommands")} |`,
    "| --- | --- | --- |",
  ];

  for (const resource of getCliResourcesByCommand()) {
    const subcommands: string = getCliResourceSubcommands(resource)
      .map((subcommand: string): string => {
        return `\`${subcommand}\``;
      })
      .join(", ");

    lines.push(
      `| \`${resource.name}\` | ${toTableCell(resource.pluralName)} | ${subcommands} |`,
    );
  }

  const markdown: string = lines.join("\n");

  tablesByLanguage.set(lang, markdown);

  return markdown;
}
