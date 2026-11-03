import { Argument, Command, Help, Option } from "commander";

/*
 * --help, laid out to read in a terminal.
 *
 * Commander pads every option to its longest one, and a create's or an
 * update's longest flag runs past 70 characters
 * (--should-status-page-subscribers-be-notified-on-incident-created
 * [true|false]). Every description of `oneuptime incident create --help`
 * then started at column 81: too far right for Commander to wrap it, so a
 * terminal folded each line back to its first column, and the flags and
 * their descriptions ran together.
 *
 * Here the column of flags is as wide as most flags need, and a longer flag
 * has a line of its own, with its description on the next line, where the
 * others' start:
 *
 *   --title <text>                        Required. Title of this incident.
 *   --should-status-page-subscribers-be-notified-on-incident-created [true|false]
 *                                         Should subscribers be notified...
 *
 * The rest is Commander's own layout (its Help.formatHelp, 12.x): the same
 * sections, in the same order, wrapped to the terminal's width.
 */

// The widest flag, argument or command that keeps its description beside it.
export const HELP_TERM_COLUMN_LIMIT: number = 36;

// How far an item is indented, and the gap between it and its description.
const ITEM_INDENT: number = 2;
const ITEM_SEPARATOR: number = 2;

// Commander's width when the output is not a terminal.
const DEFAULT_HELP_WIDTH: number = 80;

const LINE_START: RegExp = /^/gm;

export function formatHelpToFit(cmd: Command, helper: Help): string {
  const termWidth: number = Math.min(
    helper.padWidth(cmd, helper),
    HELP_TERM_COLUMN_LIMIT,
  );
  const helpWidth: number = helper.helpWidth || DEFAULT_HELP_WIDTH;
  const descriptionColumn: number = termWidth + ITEM_SEPARATOR;

  const formatItem: (term: string, description: string) => string = (
    term: string,
    description: string,
  ): string => {
    if (!description) {
      return term;
    }

    if (term.length <= termWidth) {
      return helper.wrap(
        `${term.padEnd(descriptionColumn)}${description}`,
        helpWidth - ITEM_INDENT,
        descriptionColumn,
      );
    }

    // Too long for the column: the term alone, the description under it.
    return `${term}\n${helper.wrap(
      `${" ".repeat(descriptionColumn)}${description}`,
      helpWidth - ITEM_INDENT,
      descriptionColumn,
    )}`;
  };

  const formatList: (items: Array<string>) => string = (
    items: Array<string>,
  ): string => {
    return items.join("\n").replace(LINE_START, " ".repeat(ITEM_INDENT));
  };

  let output: Array<string> = [`Usage: ${helper.commandUsage(cmd)}`, ""];

  const commandDescription: string = helper.commandDescription(cmd);

  if (commandDescription.length > 0) {
    output = output.concat([helper.wrap(commandDescription, helpWidth, 0), ""]);
  }

  const argumentList: Array<string> = helper
    .visibleArguments(cmd)
    .map((argument: Argument): string => {
      return formatItem(
        helper.argumentTerm(argument),
        helper.argumentDescription(argument),
      );
    });

  if (argumentList.length > 0) {
    output = output.concat(["Arguments:", formatList(argumentList), ""]);
  }

  const optionList: Array<string> = helper
    .visibleOptions(cmd)
    .map((option: Option): string => {
      return formatItem(
        helper.optionTerm(option),
        helper.optionDescription(option),
      );
    });

  if (optionList.length > 0) {
    output = output.concat(["Options:", formatList(optionList), ""]);
  }

  if (helper.showGlobalOptions) {
    const globalOptionList: Array<string> = helper
      .visibleGlobalOptions(cmd)
      .map((option: Option): string => {
        return formatItem(
          helper.optionTerm(option),
          helper.optionDescription(option),
        );
      });

    if (globalOptionList.length > 0) {
      output = output.concat([
        "Global Options:",
        formatList(globalOptionList),
        "",
      ]);
    }
  }

  const commandList: Array<string> = helper
    .visibleCommands(cmd)
    .map((subcommand: Command): string => {
      return formatItem(
        helper.subcommandTerm(subcommand),
        helper.subcommandDescription(subcommand),
      );
    });

  if (commandList.length > 0) {
    output = output.concat(["Commands:", formatList(commandList), ""]);
  }

  return output.join("\n");
}

/*
 * Lays out the help of a program and of every command made under it: a
 * command made with .command() takes its parent's help settings, the
 * resources' subcommands too, made as the program dispatches to them.
 */
export function useHelpLayout(program: Command): Command {
  return program.configureHelp({
    ...program.configureHelp(),
    formatHelp: formatHelpToFit,
  });
}
