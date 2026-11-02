import { DatabaseBaseModelType } from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  getInstallScriptUrl,
  InstallScriptName,
  INSTALL_SCRIPT_FILE,
} from "../../Types/InstallScripts/InstallScripts";
import { JSONObject, JSONValue } from "../../Types/JSON";
import { shellQuote } from "./ApiExamples";
import {
  CLI_FIELDS_SUBCOMMAND,
  CliAction,
  CliFieldFlag,
  CliOperation,
  getCliFieldFlagsFor,
  getCliResourceName,
  ONEUPTIME_CLI_COMMAND,
  ONEUPTIME_CLI_PACKAGE,
  ONEUPTIME_URL_ENVIRONMENT_VARIABLE,
} from "./CliCommands";
import { getApiKeyExportCommand } from "./ExampleValues";
import { TerraformValueKind } from "./TerraformSchema";

/*
 * The CLI's side of the dashboard's Developer > CLI pages: commands the
 * CLI takes, for the very requests the API page shows as curl (their data
 * comes from ExampleBuilder, so they are the project's own records). Each
 * comes as the words the CLI is given and as the line a reader copies:
 *
 *   oneuptime incident create \
 *     --title 'Checkout is down' \
 *     --incident-severity-id 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11
 *
 * A field goes in as its flag (CliCommands.ts names them), a person by
 * email address where the page knows it, and a field without a flag in
 * --data. packages/CLI/Tests/DeveloperDocsCommands runs these through the
 * CLI's real program and holds the requests it sends to the API page's.
 *
 * Pure, so every page for every resource is tested without rendering it.
 */

export interface CliExample {
  // What the CLI is given after `oneuptime`, word by word, unquoted.
  args: Array<string>;
  // The command a reader copies, quoted for a POSIX shell.
  command: string;
}

/*
 * How long a command may be on one line; a longer one goes a flag a line,
 * as the curl commands do, so a code block beside the side menu never
 * hides its end behind a sideways scroll.
 */
export const CLI_EXAMPLE_LINE_LIMIT: number = 72;

// A flag's line, after the first, starts here.
const FLAG_INDENT: string = "  ";
const CONTINUATION: string = ` \\\n${FLAG_INDENT}`;

// The words, quoted, on one line or a flag (with its value) a line.
export function formatCliCommand(args: Array<string>): string {
  const words: Array<string> = [ONEUPTIME_CLI_COMMAND, ...args].map(
    (word: string): string => {
      return shellQuote(word);
    },
  );
  const oneLine: string = words.join(" ");

  if (oneLine.length <= CLI_EXAMPLE_LINE_LIMIT) {
    return oneLine;
  }

  const lines: Array<string> = [];

  for (const word of words) {
    if (word.startsWith("--") || lines.length === 0) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${word}`;
    }
  }

  return lines.join(CONTINUATION);
}

// The flags whose values are JSON, whatever the resource.
const JSON_VALUE_FLAGS: ReadonlyArray<string> = ["--query", "--sort", "--data"];

const JSON_INDENT: number = 2;

/*
 * A JSON value too long for its flag's line, written as the curl commands
 * write a body: a key a line, indented under its flag. On one line,
 * --monitor-steps (every criterion of a monitor) ran 14,000 pixels past
 * the code block's edge. The shell hands the CLI the value with its line
 * breaks, and JSON allows them, so the request is the same.
 */
function laidOutJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, JSON_INDENT)
      .split("\n")
      .join(`\n${FLAG_INDENT}`);
  } catch {
    return text;
  }
}

/*
 * The words the CLI is given and the command a reader copies, which reads
 * back as those very words: a long command goes a flag a line, and in it a
 * long JSON value (after one of `jsonFlags`) a key a line.
 */
function example(
  args: Array<string>,
  jsonFlags: ReadonlyArray<string> = JSON_VALUE_FLAGS,
): CliExample {
  if (!formatCliCommand(args).includes("\n")) {
    return { args, command: formatCliCommand(args) };
  }

  const laidOut: Array<string> = args.map(
    (word: string, index: number): string => {
      const flag: string | undefined = args[index - 1];
      const line: string = `${FLAG_INDENT}${flag} ${shellQuote(word)} \\`;

      return flag &&
        jsonFlags.includes(flag) &&
        line.length > CLI_EXAMPLE_LINE_LIMIT
        ? laidOutJson(word)
        : word;
    },
  );

  return { args: laidOut, command: formatCliCommand(laidOut) };
}

// A write's JSON flags: --data, and the flags of fields that hold JSON.
function writeJsonFlags(
  modelType: DatabaseBaseModelType,
  operation: CliOperation.Create | CliOperation.Update,
): Array<string> {
  return [
    ...JSON_VALUE_FLAGS,
    ...getCliFieldFlagsFor(modelType, operation)
      .filter((flag: CliFieldFlag): boolean => {
        return (
          flag.kind === TerraformValueKind.Json ||
          flag.kind === TerraformValueKind.MonitorSteps
        );
      })
      .map((flag: CliFieldFlag): string => {
        return flag.flag;
      }),
  ];
}

export function getCliCommandOf(modelType: DatabaseBaseModelType): string {
  return getCliResourceName(new modelType());
}

const JSON_FLAG: string = "--json";

// An ID as the API's JSON may carry it: "x", {"_id": "x"} or {"value": "x"}.
function idOf(value: JSONValue | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const wrapped: JSONObject = value as JSONObject;
    const id: JSONValue | undefined = wrapped["_id"] ?? wrapped["value"];

    return typeof id === "string" ? id : null;
  }

  return null;
}

const COMMA: string = ",";

/*
 * A field's value as its flag writes it: IDs and words separated by commas
 * (a JSON array when one holds a comma), JSON as JSON, the rest as text.
 * Undefined when the flag cannot carry it, so it goes in --data.
 */
function toFlagText(flag: CliFieldFlag, value: JSONValue): string | undefined {
  switch (flag.kind) {
    case TerraformValueKind.IdSet: {
      if (!Array.isArray(value)) {
        return undefined;
      }

      const ids: Array<string | null> = (value as Array<JSONValue>).map(idOf);

      if (ids.some((id: string | null): boolean => !id)) {
        return undefined;
      }

      return (ids as Array<string>).join(COMMA);
    }
    case TerraformValueKind.StringSet: {
      if (!Array.isArray(value)) {
        return undefined;
      }

      const words: Array<string> = (value as Array<JSONValue>).map(String);

      return words.some((word: string): boolean => word.includes(COMMA))
        ? JSON.stringify(words)
        : words.join(COMMA);
    }
    case TerraformValueKind.Json:
    case TerraformValueKind.MonitorSteps:
      return JSON.stringify(value);
    case TerraformValueKind.Bool:
      return typeof value === "boolean" ? String(value) : undefined;
    case TerraformValueKind.Number:
      return typeof value === "number" ? String(value) : undefined;
    default: {
      if (typeof value === "string") {
        return value;
      }

      // An ID the API wraps, or a value object such as a color.
      const wrapped: string | null = idOf(value);

      return wrapped || undefined;
    }
  }
}

/*
 * A create's or an update's fields as flags. A person whose address the
 * page knows (`emailsById`: the viewer's) is named by it, with the email
 * flag; a field no flag carries goes in --data.
 */
export function getCliWriteArgs(data: {
  modelType: DatabaseBaseModelType;
  operation: CliOperation.Create | CliOperation.Update;
  values: JSONObject;
  emailsById?: Readonly<Record<string, string>> | undefined;
}): Array<string> {
  const flags: Map<string, CliFieldFlag> = new Map(
    getCliFieldFlagsFor(data.modelType, data.operation).map(
      (flag: CliFieldFlag): [string, CliFieldFlag] => {
        return [flag.columnName, flag];
      },
    ),
  );
  const args: Array<string> = [];
  const rest: JSONObject = {};

  for (const [column, value] of Object.entries(data.values)) {
    const flag: CliFieldFlag | undefined = flags.get(column);

    if (!flag || value === undefined || value === null) {
      if (value !== undefined) {
        rest[column] = value;
      }
      continue;
    }

    const id: string | null = flag.person ? idOf(value) : null;
    const email: string | undefined = id ? data.emailsById?.[id] : undefined;

    if (flag.person && !flag.person.isList && email) {
      args.push(flag.person.flag, email);
      continue;
    }

    const text: string | undefined = toFlagText(flag, value);

    if (text === undefined) {
      rest[column] = value;
      continue;
    }

    args.push(flag.flag, text);
  }

  if (Object.keys(rest).length > 0) {
    args.push("--data", JSON.stringify(rest));
  }

  return args;
}

export function getCliCreateExample(data: {
  modelType: DatabaseBaseModelType;
  values: JSONObject;
  emailsById?: Readonly<Record<string, string>> | undefined;
}): CliExample {
  return example(
    [
      getCliCommandOf(data.modelType),
      CliOperation.Create,
      ...getCliWriteArgs({ ...data, operation: CliOperation.Create }),
      JSON_FLAG,
    ],
    writeJsonFlags(data.modelType, CliOperation.Create),
  );
}

export function getCliUpdateExample(data: {
  modelType: DatabaseBaseModelType;
  id: string;
  values: JSONObject;
  emailsById?: Readonly<Record<string, string>> | undefined;
}): CliExample {
  return example(
    [
      getCliCommandOf(data.modelType),
      CliOperation.Update,
      data.id,
      ...getCliWriteArgs({ ...data, operation: CliOperation.Update }),
      JSON_FLAG,
    ],
    writeJsonFlags(data.modelType, CliOperation.Update),
  );
}

// The fields a read asks for, as --fields names them: `_id` always comes.
function fieldsArgs(select: JSONObject | undefined): Array<string> {
  if (!select) {
    return [];
  }

  const names: Array<string> = Object.keys(select).filter(
    (name: string): boolean => {
      return name !== "_id";
    },
  );

  return names.length > 0 ? ["--fields", names.join(COMMA)] : [];
}

const NEWEST_FIRST: JSONObject = { createdAt: "DESC" };

function isNewestFirst(sort: JSONObject | undefined): boolean {
  return !sort || JSON.stringify(sort) === JSON.stringify(NEWEST_FIRST);
}

/*
 * A list: its query and sort as JSON (newest first is the CLI's own
 * order, so it is left out), the fields it asks for, and its page.
 */
export function getCliListExample(data: {
  modelType: DatabaseBaseModelType;
  query?: JSONObject | undefined;
  select?: JSONObject | undefined;
  sort?: JSONObject | undefined;
  limit?: number | undefined;
}): CliExample {
  const args: Array<string> = [
    getCliCommandOf(data.modelType),
    CliOperation.List,
  ];

  if (data.query && Object.keys(data.query).length > 0) {
    args.push("--query", JSON.stringify(data.query));
  }

  if (!isNewestFirst(data.sort)) {
    args.push("--sort", JSON.stringify(data.sort));
  }

  args.push(...fieldsArgs(data.select));

  if (data.limit !== undefined) {
    args.push("--limit", String(data.limit));
  }

  args.push(JSON_FLAG);

  return example(args);
}

export function getCliGetExample(data: {
  modelType: DatabaseBaseModelType;
  id: string;
  select?: JSONObject | undefined;
}): CliExample {
  return example([
    getCliCommandOf(data.modelType),
    CliOperation.Get,
    data.id,
    ...fieldsArgs(data.select),
    JSON_FLAG,
  ]);
}

export function getCliCountExample(data: {
  modelType: DatabaseBaseModelType;
  query?: JSONObject | undefined;
}): CliExample {
  const args: Array<string> = [
    getCliCommandOf(data.modelType),
    CliOperation.Count,
  ];

  if (data.query && Object.keys(data.query).length > 0) {
    args.push("--query", JSON.stringify(data.query));
  }

  return example(args);
}

export function getCliDeleteExample(data: {
  modelType: DatabaseBaseModelType;
  id: string;
}): CliExample {
  return example([
    getCliCommandOf(data.modelType),
    CliOperation.Delete,
    data.id,
  ]);
}

export function getCliFieldsExample(
  modelType: DatabaseBaseModelType,
): CliExample {
  return example([getCliCommandOf(modelType), CLI_FIELDS_SUBCOMMAND]);
}

// A dashboard button, as its command: acknowledge, resolve, add-note.
export function getCliActionExample(data: {
  modelType: DatabaseBaseModelType;
  action: CliAction;
  id: string;
  note?: string | undefined;
  isPublic?: boolean | undefined;
}): CliExample {
  const args: Array<string> = [
    getCliCommandOf(data.modelType),
    data.action,
    data.id,
  ];

  if (data.action === CliAction.AddNote) {
    args.push("--note", data.note || "");

    if (data.isPublic) {
      args.push("--public");
    }
  }

  return example(args);
}

/*
 * INSTALLING AND CONNECTING
 */

/*
 * The CLI's installer, served by the OneUptime the reader uses: it
 * installs the CLI of that OneUptime's version (packages/CLI/Install).
 */
export function getCliInstallScriptCommands(oneuptimeUrl: string): string {
  return [
    `curl -fsSL ${shellQuote(getInstallScriptUrl(oneuptimeUrl, InstallScriptName.Cli))} -o ${INSTALL_SCRIPT_FILE}`,
    `${ONEUPTIME_URL_ENVIRONMENT_VARIABLE}=${shellQuote(oneuptimeUrl)} bash ${INSTALL_SCRIPT_FILE}`,
  ].join("\n");
}

const RELEASE_VERSION: RegExp = /^\d+\.\d+\.\d+$/;
const DEVELOPMENT_VERSION: string = "1.0.0";

/*
 * npm's: the CLI of this OneUptime's version, which knows the resources it
 * has; the newest when the version is not a release's.
 */
export function getCliNpmInstallCommand(
  platformVersion: string | null,
): string {
  const version: string | null =
    platformVersion &&
    RELEASE_VERSION.test(platformVersion.trim()) &&
    platformVersion.trim() !== DEVELOPMENT_VERSION
      ? platformVersion.trim()
      : null;

  return `npm install -g ${ONEUPTIME_CLI_PACKAGE}${version ? `@${version}` : ""}`;
}

/*
 * The key and the address in the environment - the same export the API
 * and Terraform pages make - and the check that OneUptime takes them.
 */
export function getCliConnectCommands(oneuptimeUrl: string): string {
  return [
    getApiKeyExportCommand(),
    `export ${ONEUPTIME_URL_ENVIRONMENT_VARIABLE}=${shellQuote(oneuptimeUrl)}`,
    `${ONEUPTIME_CLI_COMMAND} whoami --check`,
  ].join("\n");
}

// Saving the key as a context instead, for people at a terminal.
export function getCliLoginCommand(oneuptimeUrl: string): string {
  return `${ONEUPTIME_CLI_COMMAND} login <api-key> ${shellQuote(oneuptimeUrl)}`;
}
