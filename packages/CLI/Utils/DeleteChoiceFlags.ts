import { Command, Option } from "commander";
import { ResourceInfo } from "../Types/CLITypes";
import {
  CliDeleteChoiceFlag,
  getCliDeleteChoiceFlagName,
  getCliDeleteChoiceFlags,
  ONEUPTIME_CLI_COMMAND,
  toCommanderAttributeName,
} from "Common/Utils/DeveloperDocs/CliCommands";
import { getCliDeleteChoiceWays } from "Common/Utils/DeveloperDocs/CliExamples";
import {
  CliResource,
  getCliResourceByTableName,
} from "Common/Utils/DeveloperDocs/CliResources";
import {
  DeleteChoicesOfTable,
  getDeleteChoiceExampleValue,
  getDeleteChoices,
  isRefusedForDeleteChoices,
  readDeleteChoices,
} from "Common/Utils/DeveloperDocs/DeleteChoices";
import { JSONObject } from "Common/Types/JSON";

/*
 * WHAT A DELETE SAYS BESIDES THE RECORD, ON THE COMMAND LINE (#9949)
 *
 * OneUptime deletes a custom role that workflows run as only when the
 * delete says what they run as instead, in the DELETE's body
 * (miscDataProps), and refuses one that does not, naming the workflows
 * (Common/Utils/DeveloperDocs/DeleteChoices.ts). `delete` sent no body, so
 * the CLI could not delete such a role at all.
 *
 * Now a resource whose delete takes choices has a flag for each on its
 * `delete` (CliCommands.getCliDeleteChoiceFlags):
 *
 *   oneuptime custom-role delete <id> --workflows-run-as Default
 *   oneuptime custom-role delete <id> --workflows-run-as CustomRole \
 *     --workflows-run-as-custom-role-id <custom-role-id>
 *
 * They are read as the server reads them, and what it would refuse -
 * Project Owner, a value it does not take, an ID that is not one, the role
 * being deleted, half of the pair - is refused before a request is sent
 * (readDeleteChoices). A delete given none sends no body: the delete it
 * always was. When OneUptime refuses a delete for the choices it needs, the
 * error is its own words, naming the workflows, and the hint says which
 * flags give them.
 */

// Commander's width when the output is not a terminal (Core/HelpLayout).
const HELP_WIDTH: number = 80;

// A choice's flag, by its key.
function flagOf(key: string): string {
  return getCliDeleteChoiceFlagName(key);
}

// The command of the resource a choice's ID names: custom-role.
function relatedResourceOf(flag: CliDeleteChoiceFlag): string | null {
  if (!flag.relatedTableName) {
    return null;
  }

  const related: CliResource | null = getCliResourceByTableName(
    flag.relatedTableName,
  );

  return related ? related.name : null;
}

// A flag's help: what it is, and for an ID, where to find one.
export function getDeleteChoiceFlagHelp(flag: CliDeleteChoiceFlag): string {
  const related: string | null = relatedResourceOf(flag);

  return related
    ? `${flag.description} An ID from \`${ONEUPTIME_CLI_COMMAND} ${related} list\`.`
    : flag.description;
}

/*
 * Each way of giving the choices, as the flags that say it:
 * "--workflows-run-as Default", "--workflows-run-as CustomRole
 * --workflows-run-as-custom-role-id <custom-role-id>". Written by Common's
 * CliExamples, as the dashboard's CLI pages show them (#10031).
 */
export function getDeleteChoiceFlagWays(tableName: string): Array<string> {
  return getCliDeleteChoiceWays(tableName).map((way: Array<string>): string => {
    return way.join(" ");
  });
}

// The resource's delete, with each way of giving its choices: for its help.
export function getDeleteChoiceExamples(resource: ResourceInfo): Array<string> {
  return getDeleteChoiceFlagWays(resource.tableName).map(
    (way: string): string => {
      return `${ONEUPTIME_CLI_COMMAND} ${resource.name} delete <id> ${way}`;
    },
  );
}

/*
 * Adds the flags of the choices a resource's delete takes to its `delete`,
 * and after its help, when they are needed, with an example of each way.
 * A resource whose delete takes none is left as it was.
 */
export function addDeleteChoiceFlags(
  command: Command,
  resource: ResourceInfo,
): void {
  const choices: DeleteChoicesOfTable | null = getDeleteChoices(
    resource.tableName,
  );

  if (!choices) {
    return;
  }

  for (const flag of getCliDeleteChoiceFlags(resource.tableName)) {
    command.addOption(
      new Option(
        `${flag.flag} ${flag.valueName}`,
        getDeleteChoiceFlagHelp(flag),
      ),
    );
  }

  command.addHelpText("after", (): string => {
    return [
      "",
      // Wrapped as the help above it is, to the terminal's width.
      command
        .createHelp()
        .wrap(
          choices.whenNeeded,
          (process.stdout.isTTY && process.stdout.columns) || HELP_WIDTH,
          0,
        ),
      "",
      "Examples:",
      ...getDeleteChoiceExamples(resource).map((example: string): string => {
        return `  ${example}`;
      }),
    ].join("\n");
  });
}

/*
 * The delete's miscDataProps from its flags, as the API takes them; {}
 * when none was given, so the delete sends no body. Throws a
 * DeleteChoiceError, before anything is sent, for what the server would
 * refuse.
 */
export function readDeleteChoiceFlags(data: {
  resource: ResourceInfo;
  options: Record<string, unknown>;
  // The record being deleted, which a choice may not name.
  id: string;
}): JSONObject {
  const given: Record<string, unknown> = {};

  for (const flag of getCliDeleteChoiceFlags(data.resource.tableName)) {
    given[flag.key] = data.options[toCommanderAttributeName(flag.flag)];
  }

  return readDeleteChoices({
    tableName: data.resource.tableName,
    given,
    deletedId: data.id,
    nameOf: flagOf,
  });
}

/*
 * What to do next when OneUptime refused a delete for the choices it
 * needs, which it was not given: the flags that give them. The refusal is
 * the API's own words, naming the workflows and miscDataProps, which a
 * command line never writes. Null for any other error, and for a delete
 * that gave a choice: it was refused for what the refusal says.
 */
export function getDeleteChoicesRefusalHint(data: {
  error: unknown;
  resource: ResourceInfo;
  // The miscDataProps the delete sent.
  sent: JSONObject;
}): string | null {
  if (
    !(data.error instanceof Error) ||
    !isRefusedForDeleteChoices({
      tableName: data.resource.tableName,
      refusal: data.error.message,
      sent: data.sent,
    })
  ) {
    return null;
  }

  const ways: Array<string> = getDeleteChoiceFlagWays(data.resource.tableName);

  if (ways.length === 0) {
    return null;
  }

  // Where an ID a way needs comes from: <custom-role-id>, from `oneuptime custom-role list`.
  const finding: Array<string> = getCliDeleteChoiceFlags(
    data.resource.tableName,
  )
    .filter((flag: CliDeleteChoiceFlag): boolean => {
      return Boolean(relatedResourceOf(flag));
    })
    .map((flag: CliDeleteChoiceFlag): string => {
      return ` Find ${getDeleteChoiceExampleValue(flag)} with \`${ONEUPTIME_CLI_COMMAND} ${relatedResourceOf(flag)} list\`.`;
    });

  return `Run it again with ${ways.join(", or with ")}.${finding.join("")}`;
}
