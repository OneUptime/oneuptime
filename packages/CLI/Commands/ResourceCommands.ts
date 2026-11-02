import { Command, Option } from "commander";
import { ResourceInfo, ResolvedCredentials } from "../Types/CLITypes";
import { executeApiRequest, ApiOperation } from "../Core/ApiClient";
import { CLIOptions, getResolvedCredentials } from "../Core/ConfigManager";
import {
  createJsonOption,
  createOutputOption,
  formatOutput,
  isJsonOutputRequested,
  printSuccess,
  printWarning,
  resolveOutputFormat,
} from "../Core/OutputFormatter";
import { handleError } from "../Core/ErrorHandler";
import {
  generateAllFieldsSelect,
  generateSelectFromFields,
  getRefusedSelectColumn,
} from "../Utils/SelectFieldGenerator";
import { addFieldFlags, readFieldFlags } from "../Utils/FieldFlags";
import { resolvePeople, ResolvedPeople } from "../Utils/People";
import { printResourceFields } from "../Utils/ResourceFieldsTable";
import { describeResource } from "../Utils/ResourceFields";
import { getParentOptions } from "../Utils/CommandOptions";
import { registerActionCommands } from "./ActionCommands";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CLI_FIELDS_SUBCOMMAND,
  CliOperation,
} from "Common/Utils/DeveloperDocs/CliCommands";
import {
  CliResource,
  getCliDatabaseModelType,
  getCliResource,
  getCliResources,
} from "Common/Utils/DeveloperDocs/CliResources";
import { withIndefiniteArticle } from "Common/Utils/DeveloperDocs/ExampleValues";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import * as fs from "fs";

/*
 * THE RESOURCE COMMANDS
 *
 * One command for every resource of the OneUptime REST API, and under it a
 * subcommand for every request the API takes for it - list, get, create,
 * update, delete, count - then `fields`, and the dashboard's buttons on it
 * (acknowledge, resolve, add-note: ActionCommands.ts). Which resources and
 * which subcommands come from the models, by the API's own rule
 * (Common/Utils/DeveloperDocs/CliCommands and CliResources), so a model the
 * API gains is a command here with nothing written for it, and
 * Tests/ApiParity fails if the two ever part.
 */

function toResourceInfo(resource: CliResource): ResourceInfo {
  return {
    name: resource.name,
    singularName: resource.singularName,
    pluralName: resource.pluralName,
    apiPath: resource.apiPath,
    tableName: resource.tableName,
    modelType: resource.modelType,
    operations: resource.operations,
    actions: resource.actions,
  };
}

// Every resource command, by name.
export function discoverResources(): ResourceInfo[] {
  return getCliResources()
    .map(toResourceInfo)
    .sort((a: ResourceInfo, b: ResourceInfo): number => {
      return a.name.localeCompare(b.name);
    });
}

export function parseJsonArg(value: string): JSONObject {
  try {
    return JSON.parse(value) as JSONObject;
  } catch {
    throw new Error(`Invalid JSON: ${value}`);
  }
}

const WHOLE_NUMBER: RegExp = /^\d+$/;

// --limit and --skip: a whole number, as written.
function parseCount(flag: string, value: string): number {
  if (!WHOLE_NUMBER.test(value.trim())) {
    throw new Error(
      `${flag} takes a whole number, such as 10, and "${value}" is not one.`,
    );
  }

  return parseInt(value.trim(), 10);
}

// The rows of a list's answer: the client unwraps the envelope, or not.
function rowsOf(result: JSONValue): JSONValue {
  return result && typeof result === "object" && !Array.isArray(result)
    ? ((result as JSONObject)["data"] as JSONValue) || result
    : result;
}

/*
 * How many times a list or a get leaves out a field the key may not read
 * and asks again. A key that may read none of a record's fields gives up
 * long before: the server refuses one field at a time.
 */
const MAX_SELECT_RETRIES: number = 25;

/*
 * Runs a read with the default select - every field the key may read -
 * and, when OneUptime refuses a field the key may not read ("You do not
 * have permissions to select on - <field>"), asks again without it, as the
 * MCP server and the Terraform provider do, so a key with fewer
 * permissions still reads what it may. Fields asked for with --fields are
 * the reader's choice: a refusal of one is the answer.
 */
async function readWithSelect(data: {
  select: JSONObject;
  isChosen: boolean;
  read: (select: JSONObject) => Promise<JSONValue>;
}): Promise<JSONValue> {
  const select: JSONObject = { ...data.select };
  const leftOut: Array<string> = [];

  for (let attempt: number = 0; ; attempt++) {
    try {
      // A copy each time: what one request sent stays as it was sent.
      const result: JSONValue = await data.read({ ...select });

      if (leftOut.length > 0) {
        printWarning(
          `Left out fields this API key may not read: ${leftOut.join(", ")}.`,
        );
      }

      return result;
    } catch (error) {
      const column: string | null =
        !data.isChosen && error instanceof Error
          ? getRefusedSelectColumn(error.message)
          : null;

      if (
        !column ||
        select[column] === undefined ||
        attempt >= MAX_SELECT_RETRIES
      ) {
        throw error;
      }

      delete select[column];
      leftOut.push(column);
    }
  }
}

function selectFor(
  resource: ResourceInfo,
  fields: string | undefined,
): { select: JSONObject; isChosen: boolean } {
  if (fields) {
    return {
      select: generateSelectFromFields({
        tableName: resource.tableName,
        modelType: resource.modelType,
        resourceName: resource.name,
        fields,
      }),
      isChosen: true,
    };
  }

  return {
    select: generateAllFieldsSelect(resource.tableName, resource.modelType),
    isChosen: false,
  };
}

const FIELDS_OPTION_DESCRIPTION: string =
  "The fields to return, separated by commas, such as name,createdAt (default: every field the key may read)";

/*
 * --all: page size, and how many records it reads at most - more than
 * any project lists, and a stop should a server ever answer every page
 * the same.
 */
export const LIST_ALL_PAGE_SIZE: number = 100;
export const LIST_ALL_MAX_RECORDS: number = 100000;

async function listAll(data: {
  read: (skip: number, limit: number) => Promise<JSONValue>;
}): Promise<Array<JSONValue>> {
  const records: Array<JSONValue> = [];

  for (;;) {
    const page: JSONValue = rowsOf(
      await data.read(records.length, LIST_ALL_PAGE_SIZE),
    );
    const rows: Array<JSONValue> = Array.isArray(page)
      ? (page as Array<JSONValue>)
      : [];

    records.push(...rows);

    if (rows.length < LIST_ALL_PAGE_SIZE) {
      return records;
    }

    if (records.length >= LIST_ALL_MAX_RECORDS) {
      printWarning(
        `Stopped after ${LIST_ALL_MAX_RECORDS} records. Narrow the list with --query, or page with --limit and --skip.`,
      );
      return records;
    }
  }
}

function registerListCommand(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  const command: Command = resourceCmd
    .command("list")
    .description(`List ${resource.pluralName}`)
    .option("--query <json>", "Filter query as JSON")
    .option("--limit <n>", "Max results to return", "10")
    .option("--skip <n>", "Number of results to skip", "0")
    .option("--sort <json>", "Sort order as JSON")
    .option("--fields <names>", FIELDS_OPTION_DESCRIPTION);

  /*
   * Records only: a telemetry table holds millions of rows, so it is read
   * a page at a time, filtered by time.
   */
  if (resource.modelType === "database") {
    command.addOption(
      new Option(
        "--all",
        "Every record that matches, page after page, in place of --limit and --skip",
      ).conflicts(["limit", "skip"]),
    );
  }

  command
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(
      async (
        options: {
          query?: string;
          limit: string;
          skip: string;
          sort?: string;
          fields?: string;
          all?: boolean;
        },
        cmd: Command,
      ) => {
        try {
          const parentOpts: CLIOptions = getParentOptions(resourceCmd);
          const creds: ResolvedCredentials = getResolvedCredentials(parentOpts);
          const { select, isChosen } = selectFor(resource, options.fields);
          const query: JSONObject | undefined = options.query
            ? parseJsonArg(options.query)
            : undefined;
          const sort: JSONObject | undefined = options.sort
            ? parseJsonArg(options.sort)
            : undefined;

          const read: (
            skip: number,
            limit: number,
          ) => Promise<JSONValue> = (
            skip: number,
            limit: number,
          ): Promise<JSONValue> => {
            return readWithSelect({
              select,
              isChosen,
              read: (chosen: JSONObject): Promise<JSONValue> => {
                return executeApiRequest({
                  apiUrl: creds.apiUrl,
                  apiKey: creds.apiKey,
                  apiPath: resource.apiPath,
                  operation: "list" as ApiOperation,
                  query,
                  select: chosen,
                  skip,
                  limit,
                  sort,
                });
              },
            });
          };

          const responseData: JSONValue = options.all
            ? ((await listAll({ read })) as JSONValue)
            : rowsOf(
                await read(
                  parseCount("--skip", options.skip),
                  parseCount("--limit", options.limit),
                ),
              );

          // eslint-disable-next-line no-console
          console.log(formatOutput(responseData, resolveOutputFormat(cmd)));
        } catch (error) {
          handleError(error, {
            resource: resource.name,
            operation: CliOperation.List,
          });
        }
      },
    );
}

function registerGetCommand(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  resourceCmd
    .command("get <id>")
    .description(`Get a single ${resource.singularName} by ID`)
    .option("--fields <names>", FIELDS_OPTION_DESCRIPTION)
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(async (id: string, options: { fields?: string }, cmd: Command) => {
      try {
        const parentOpts: CLIOptions = getParentOptions(resourceCmd);
        const creds: ResolvedCredentials = getResolvedCredentials(parentOpts);
        const { select, isChosen } = selectFor(resource, options.fields);

        const result: JSONValue = await readWithSelect({
          select,
          isChosen,
          read: (chosen: JSONObject): Promise<JSONValue> => {
            return executeApiRequest({
              apiUrl: creds.apiUrl,
              apiKey: creds.apiKey,
              apiPath: resource.apiPath,
              operation: "read" as ApiOperation,
              id,
              select: chosen,
            });
          },
        });

        // eslint-disable-next-line no-console
        console.log(formatOutput(result, resolveOutputFormat(cmd)));
      } catch (error) {
        handleError(error, {
          resource: resource.name,
          operation: CliOperation.Get,
        });
      }
    });
}

// The JSON --file holds, else --data's, else nothing.
function readDataOptions(options: {
  data?: string;
  file?: string;
}): JSONObject {
  if (options.file) {
    const fileContent: string = fs.readFileSync(options.file, "utf-8");
    return JSON.parse(fileContent) as JSONObject;
  }

  if (options.data) {
    return parseJsonArg(options.data);
  }

  return {};
}

// The record's model, for its people named by email address.
function databaseModelOf(
  resource: ResourceInfo,
): DatabaseBaseModelType | null {
  const found: CliResource | null = getCliResource(resource.name);

  return found ? getCliDatabaseModelType(found) : null;
}

/*
 * The fields a create or an update sends: --file's or --data's JSON, with
 * the field flags on top, and every person named by address named by ID.
 */
async function getWriteData(data: {
  resource: ResourceInfo;
  command: Command;
  options: { data?: string; file?: string } & Record<string, unknown>;
  credentials: ResolvedCredentials;
  missingMessage: string;
}): Promise<ResolvedPeople> {
  const fields: JSONObject = {
    ...readDataOptions(data.options),
    ...readFieldFlags(data.command, data.options),
  };

  if (Object.keys(fields).length === 0) {
    throw new Error(data.missingMessage);
  }

  const modelType: DatabaseBaseModelType | null = databaseModelOf(
    data.resource,
  );

  if (!modelType) {
    return { data: fields, miscDataProps: {} };
  }

  return resolvePeople({
    modelType,
    credentials: data.credentials,
    data: fields,
  });
}

function registerCreateCommand(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  resourceCmd
    .command("create")
    .description(`Create a new ${resource.singularName}`)
    .option("--data <json>", "Resource data as JSON")
    .option("--file <path>", "Read resource data from a JSON file")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(
      async (
        options: { data?: string; file?: string } & Record<string, unknown>,
        cmd: Command,
      ) => {
        try {
          const parentOpts: CLIOptions = getParentOptions(resourceCmd);
          const creds: ResolvedCredentials = getResolvedCredentials(parentOpts);
          const write: ResolvedPeople = await getWriteData({
            resource,
            command: cmd,
            options,
            credentials: creds,
            missingMessage: `Give the new ${resource.singularName}'s fields: with their flags (\`oneuptime ${resource.name} create --help\` lists them), or as JSON with --data or --file.`,
          });

          const result: JSONValue = await executeApiRequest({
            apiUrl: creds.apiUrl,
            apiKey: creds.apiKey,
            apiPath: resource.apiPath,
            operation: "create" as ApiOperation,
            data: write.data,
            miscDataProps: write.miscDataProps,
          });

          // eslint-disable-next-line no-console
          console.log(formatOutput(result, resolveOutputFormat(cmd)));
        } catch (error) {
          handleError(error, {
            resource: resource.name,
            operation: CliOperation.Create,
          });
        }
      },
    );
}

function registerUpdateCommand(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  resourceCmd
    .command("update <id>")
    .description(`Update an existing ${resource.singularName}`)
    .option("--data <json>", "Fields to update as JSON")
    .option("--file <path>", "Read the fields to update from a JSON file")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(
      async (
        id: string,
        options: { data?: string; file?: string } & Record<string, unknown>,
        cmd: Command,
      ) => {
        try {
          const parentOpts: CLIOptions = getParentOptions(resourceCmd);
          const creds: ResolvedCredentials = getResolvedCredentials(parentOpts);
          const write: ResolvedPeople = await getWriteData({
            resource,
            command: cmd,
            options,
            credentials: creds,
            missingMessage: `Give the fields to change: with their flags (\`oneuptime ${resource.name} update --help\` lists them), or as JSON with --data or --file.`,
          });

          const result: JSONValue = await executeApiRequest({
            apiUrl: creds.apiUrl,
            apiKey: creds.apiKey,
            apiPath: resource.apiPath,
            operation: "update" as ApiOperation,
            id,
            data: write.data,
          });

          // eslint-disable-next-line no-console
          console.log(formatOutput(result, resolveOutputFormat(cmd)));
        } catch (error) {
          handleError(error, {
            resource: resource.name,
            operation: CliOperation.Update,
          });
        }
      },
    );
}

function registerDeleteCommand(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  resourceCmd
    .command("delete <id>")
    .description(`Delete ${withIndefiniteArticle(resource.singularName)}`)
    .option("--force", "Skip confirmation")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(async (id: string, _options: { force?: boolean }, cmd: Command) => {
      try {
        const parentOpts: CLIOptions = getParentOptions(resourceCmd);
        const creds: ResolvedCredentials = getResolvedCredentials(parentOpts);

        await executeApiRequest({
          apiUrl: creds.apiUrl,
          apiKey: creds.apiKey,
          apiPath: resource.apiPath,
          operation: "delete" as ApiOperation,
          id,
        });

        if (isJsonOutputRequested(cmd)) {
          // eslint-disable-next-line no-console
          console.log(
            formatOutput({ _id: id, deleted: true }, resolveOutputFormat(cmd)),
          );
          return;
        }

        printSuccess(`${resource.singularName} ${id} deleted successfully.`);
      } catch (error) {
        handleError(error, {
          resource: resource.name,
          operation: CliOperation.Delete,
        });
      }
    });
}

function registerCountCommand(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  resourceCmd
    .command("count")
    .description(`Count ${resource.pluralName}`)
    .option("--query <json>", "Filter query as JSON")
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(async (options: { query?: string }, cmd: Command) => {
      try {
        const parentOpts: CLIOptions = getParentOptions(resourceCmd);
        const creds: ResolvedCredentials = getResolvedCredentials(parentOpts);

        const result: JSONValue = await executeApiRequest({
          apiUrl: creds.apiUrl,
          apiKey: creds.apiKey,
          apiPath: resource.apiPath,
          operation: "count" as ApiOperation,
          query: options.query ? parseJsonArg(options.query) : undefined,
        });

        // Count response is typically { count: number }; print just the number
        const count: JSONValue =
          result &&
          typeof result === "object" &&
          !Array.isArray(result) &&
          "count" in (result as JSONObject)
            ? ((result as JSONObject)["count"] as JSONValue)
            : result;

        // eslint-disable-next-line no-console
        console.log(formatOutput(count, resolveOutputFormat(cmd)));
      } catch (error) {
        handleError(error, {
          resource: resource.name,
          operation: CliOperation.Count,
        });
      }
    });
}

/*
 * `fields`: what the resource's fields are, from the models - no key, no
 * request. What an agent reads before it writes a create.
 */
function registerFieldsCommand(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  resourceCmd
    .command(CLI_FIELDS_SUBCOMMAND)
    .description(
      `List the fields of ${withIndefiniteArticle(resource.singularName)}: what each is for, and the flag that sets it`,
    )
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action((_options: unknown, cmd: Command) => {
      printResourceFields(describeResource(resource), resolveOutputFormat(cmd));
    });
}

// The subcommand each operation is, in the order the API's requests go.
const OPERATION_COMMANDS: Readonly<
  Record<CliOperation, (resourceCmd: Command, resource: ResourceInfo) => void>
> = {
  [CliOperation.List]: registerListCommand,
  [CliOperation.Get]: registerGetCommand,
  [CliOperation.Create]: registerCreateCommand,
  [CliOperation.Update]: registerUpdateCommand,
  [CliOperation.Delete]: registerDeleteCommand,
  [CliOperation.Count]: registerCountCommand,
};

/*
 * A create's and an update's field flags, added as the resource command
 * dispatches to it (FieldFlags.ts says why not at start).
 */
function addFieldFlagsWhenRun(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  if (resource.modelType !== "database") {
    return;
  }

  resourceCmd.hook(
    "preSubcommand",
    (_thisCommand: Command, subcommand: Command): void => {
      const name: string = subcommand.name();

      if (name !== CliOperation.Create && name !== CliOperation.Update) {
        return;
      }

      const modelType: DatabaseBaseModelType | null =
        databaseModelOf(resource);

      if (modelType) {
        addFieldFlags({ command: subcommand, modelType, operation: name });
      }
    },
  );
}

const RESOURCES_OF: WeakMap<Command, ResourceInfo> = new WeakMap();

/*
 * A resource command's subcommands - its operations, fields, actions - in
 * the order the API's requests go. Once per command.
 */
export function addResourceSubcommands(resourceCmd: Command): void {
  const resource: ResourceInfo | undefined = RESOURCES_OF.get(resourceCmd);

  if (!resource || resourceCmd.commands.length > 0) {
    return;
  }

  for (const operation of resource.operations) {
    OPERATION_COMMANDS[operation](resourceCmd, resource);
  }

  registerFieldsCommand(resourceCmd, resource);
  registerActionCommands(resourceCmd, resource);
  addFieldFlagsWhenRun(resourceCmd, resource);
}

/*
 * Every resource command with all its subcommands, for the tests and the
 * docs, which read the whole program. The CLI itself makes the
 * subcommands of the one command it runs (registerResourceCommands).
 */
export function addAllResourceSubcommands(program: Command): Command {
  for (const command of program.commands) {
    addResourceSubcommands(command);
  }

  return program;
}

/*
 * A command for every resource. Its subcommands are made when the program
 * dispatches to it - for a run, `--help` or `help <resource>` alike: 456
 * resources' 3,700 subcommands and their options took a tenth of a second
 * of every start, for the one resource a command uses.
 */
export function registerResourceCommands(program: Command): void {
  for (const resource of discoverResources()) {
    const resourceCmd: Command = program
      .command(resource.name)
      .description(`Manage ${resource.pluralName} (${resource.modelType})`);

    RESOURCES_OF.set(resourceCmd, resource);
  }

  program.hook(
    "preSubcommand",
    (_thisCommand: Command, subcommand: Command): void => {
      addResourceSubcommands(subcommand);
    },
  );
}
