import { Command, Option } from "commander";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CliFieldFlag,
  CliOperation,
  getCliFieldFlagHelp,
  getCliFieldFlagsFor,
  parseCliFieldValue,
} from "Common/Utils/DeveloperDocs/CliCommands";
import { JSONObject } from "Common/Types/JSON";

/*
 * A create's and an update's flags for the fields of a record, one per
 * field the API's schema takes (Common/Utils/DeveloperDocs/CliCommands):
 *
 *   oneuptime incident create --title "Checkout is down" \
 *     --incident-severity-id 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11
 *
 * A person is named by user ID or by email address (--user-id or
 * --user-email); People.ts finds the address's person.
 *
 * A command gets its flags when it is about to run (or show its help): the
 * CLI has about 450 resources, and making every create's and update's
 * flags at start would cost every command a tenth of a second. So the
 * resource command adds them to the subcommand it dispatches to
 * (addFieldFlags in a preSubcommand hook).
 */

// What a flag sets, by the attribute Commander stores its value under.
interface AddedFlag {
  flag: CliFieldFlag;
  // The email address companion of a person's flag, not the ID.
  isPersonEmail: boolean;
}

const ADDED: WeakMap<Command, Map<string, AddedFlag>> = new WeakMap();

// Adds a record's field flags to its create or update command, once.
export function addFieldFlags(data: {
  command: Command;
  modelType: DatabaseBaseModelType;
  operation: CliOperation.Create | CliOperation.Update;
}): void {
  if (ADDED.has(data.command)) {
    return;
  }

  const added: Map<string, AddedFlag> = new Map();

  for (const flag of getCliFieldFlagsFor(data.modelType, data.operation)) {
    const option: Option = new Option(
      `${flag.flag} ${flag.valueName}`,
      getCliFieldFlagHelp(flag, data.operation),
    );

    data.command.addOption(option);
    added.set(option.attributeName(), { flag, isPersonEmail: false });

    if (flag.person) {
      const emailOption: Option = new Option(
        `${flag.person.flag} ${flag.person.valueName}`,
        flag.person.description,
      );

      data.command.addOption(emailOption);
      added.set(emailOption.attributeName(), { flag, isPersonEmail: true });
    }
  }

  ADDED.set(data.command, added);
  keepOutputOptionsLast(data.command);
}

// The flags every printing command has, which its help lists last.
const OUTPUT_OPTION_FLAGS: ReadonlyArray<string> = ["--output", "--json"];

/*
 * The fields' flags are added after the command's own, so its help would
 * list them after -o and --json; the output options go back to the end,
 * where every other command's help has them.
 */
function keepOutputOptionsLast(command: Command): void {
  const options: Array<Option> = command.options as Array<Option>;
  const output: Array<Option> = options.filter((option: Option): boolean => {
    return OUTPUT_OPTION_FLAGS.includes(option.long || "");
  });

  if (output.length === 0) {
    return;
  }

  const rest: Array<Option> = options.filter((option: Option): boolean => {
    return !output.includes(option);
  });

  options.splice(0, options.length, ...rest, ...output);
}

/*
 * The fields the flags on the command line set, in the API's shape
 * (parseCliFieldValue), with people named by address under their
 * companion's name (`userEmail`, `ownerUserEmails`), for People.ts.
 */
export function readFieldFlags(
  command: Command,
  options: Record<string, unknown>,
): JSONObject {
  const added: Map<string, AddedFlag> | undefined = ADDED.get(command);
  const data: JSONObject = {};

  if (!added) {
    return data;
  }

  for (const [attribute, { flag, isPersonEmail }] of added) {
    const value: unknown = options[attribute];

    if (value === undefined) {
      continue;
    }

    if (isPersonEmail && flag.person) {
      data[flag.person.columnName] = flag.person.isList
        ? String(value)
            .split(",")
            .map((email: string): string => {
              return email.trim();
            })
            .filter((email: string): boolean => {
              return email.length > 0;
            })
        : String(value).trim();
      continue;
    }

    data[flag.columnName] = parseCliFieldValue(flag, value as string | boolean);
  }

  return data;
}

// The flags a command has been given, by field: for the tests and the help.
export function getAddedFieldFlags(command: Command): Array<CliFieldFlag> {
  const added: Map<string, AddedFlag> | undefined = ADDED.get(command);

  if (!added) {
    return [];
  }

  return Array.from(added.values())
    .filter((item: AddedFlag): boolean => {
      return !item.isPersonEmail;
    })
    .map((item: AddedFlag): CliFieldFlag => {
      return item.flag;
    });
}
