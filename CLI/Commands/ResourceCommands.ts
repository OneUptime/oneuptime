import { Command } from "commander";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { ResourceInfo } from "../Types/CLITypes";
import { executeApiRequest, ApiOperation } from "../Core/ApiClient";
import { CLIOptions, getResolvedCredentials } from "../Core/ConfigManager";
import { ResolvedCredentials } from "../Types/CLITypes";
import { formatOutput, printSuccess } from "../Core/OutputFormatter";
import { handleError } from "../Core/ErrorHandler";
import { generateAllFieldsSelect } from "../Utils/SelectFieldGenerator";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import * as fs from "fs";

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function parseJsonArg(value: string): JSONObject {
  try {
    return JSON.parse(value) as JSONObject;
  } catch {
    throw new Error(`Invalid JSON: ${value}`);
  }
}

export function discoverResources(): ResourceInfo[] {
  const resources: ResourceInfo[] = [];

  // Database models
  for (const ModelClass of DatabaseModels) {
    try {
      const model: BaseModel = new ModelClass();
      const tableName: string = model.tableName || ModelClass.name;
      const singularName: string = model.singularName || tableName;
      const pluralName: string = model.pluralName || `${singularName}s`;
      const apiPath: string | undefined = model.crudApiPath?.toString();

      if (tableName && model.enableMCP && apiPath) {
        resources.push({
          name: toKebabCase(singularName),
          singularName,
          pluralName,
          apiPath,
          tableName,
          modelType: "database",
        });
      }
    } catch {
      // Skip models that fail to instantiate
    }
  }

  // Analytics models
  for (const ModelClass of AnalyticsModels) {
    try {
      const model: AnalyticsBaseModel = new ModelClass();
      const tableName: string = model.tableName || ModelClass.name;
      const singularName: string = model.singularName || tableName;
      const pluralName: string = model.pluralName || `${singularName}s`;
      const apiPath: string | undefined = model.crudApiPath?.toString();

      if (tableName && model.enableMCP && apiPath) {
        resources.push({
          name: toKebabCase(singularName),
          singularName,
          pluralName,
          apiPath,
          tableName,
          modelType: "analytics",
        });
      }
    } catch {
      // Skip models that fail to instantiate
    }
  }

  return resources;
}

function getParentOptions(cmd: Command): CLIOptions {
  // Walk up to root program to get global options
  let current: Command | null = cmd;
  while (current?.parent) {
    current = current.parent;
  }
  const opts: Record<string, unknown> = current?.opts() || {};
  return {
    apiKey: opts["apiKey"] as string | undefined,
    url: opts["url"] as string | undefined,
    context: opts["context"] as string | undefined,
  };
}

function registerListCommand(
  resourceCmd: Command,
  resource: ResourceInfo,
): void {
  resourceCmd
    .command("list")
    .description(`List ${resource.pluralName}`)
    .option("--query <json>", "Filter query as JSON")
    .option("--limit <n>", "Max results to return", "10")
    .option("--skip <n>", "Number of results to skip", "0")
    .option("--sort <json>", "Sort order as JSON")
    .option("-o, --output <format>", "Output format: json, table, wide")
    .action(
      async (options: {
        query?: string;
        limit: string;
        skip: string;
        sort?: string;
        output?: string;
      }) => {
        try {
          const parentOpts: CLIOptions = getParentOptions(resourceCmd);
          const creds: ResolvedCredentials =
            getResolvedCredentials(parentOpts);
          const select: JSONObject = generateAllFieldsSelect(
            resource.tableName,
            resource.modelType,
          );

          const result: JSONValue = await executeApiRequest({
            apiUrl: creds.apiUrl,
            apiKey: creds.apiKey,
            apiPath: resource.apiPath,
            operation: "list" as ApiOperation,
            query: options.query
              ? parseJsonArg(options.query)
              : undefined,
            select,
            skip: parseInt(options.skip, 10),
            limit: parseInt(options.limit, 10),
            sort: options.sort
              ? parseJsonArg(options.sort)
              : undefined,
          });

          // Extract data array from response
          const responseData: JSONValue =
            result && typeof result === "object" && !Array.isArray(result)
              ? ((result as JSONObject)["data"] as JSONValue) || result
              : result;

          console.log(formatOutput(responseData, options.output));
        } catch (error) {
          handleError(error);
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
    .option("-o, --output <format>", "Output format: json, table, wide")
    .action(async (id: string, options: { output?: string }) => {
      try {
        const parentOpts: CLIOptions = getParentOptions(resourceCmd);
        const creds: ResolvedCredentials =
          getResolvedCredentials(parentOpts);
        const select: JSONObject = generateAllFieldsSelect(
          resource.tableName,
          resource.modelType,
        );

        const result: JSONValue = await executeApiRequest({
          apiUrl: creds.apiUrl,
          apiKey: creds.apiKey,
          apiPath: resource.apiPath,
          operation: "read" as ApiOperation,
          id,
          select,
        });

        console.log(formatOutput(result, options.output));
      } catch (error) {
        handleError(error);
      }
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
    .option("-o, --output <format>", "Output format: json, table, wide")
    .action(
      async (options: {
        data?: string;
        file?: string;
        output?: string;
      }) => {
        try {
          let data: JSONObject;

          if (options.file) {
            const fileContent: string = fs.readFileSync(
              options.file,
              "utf-8",
            );
            data = JSON.parse(fileContent) as JSONObject;
          } else if (options.data) {
            data = parseJsonArg(options.data);
          } else {
            throw new Error(
              "Either --data or --file is required for create.",
            );
          }

          const parentOpts: CLIOptions = getParentOptions(resourceCmd);
          const creds: ResolvedCredentials =
            getResolvedCredentials(parentOpts);

          const result: JSONValue = await executeApiRequest({
            apiUrl: creds.apiUrl,
            apiKey: creds.apiKey,
            apiPath: resource.apiPath,
            operation: "create" as ApiOperation,
            data,
          });

          console.log(formatOutput(result, options.output));
        } catch (error) {
          handleError(error);
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
    .requiredOption("--data <json>", "Fields to update as JSON")
    .option("-o, --output <format>", "Output format: json, table, wide")
    .action(
      async (
        id: string,
        options: { data: string; output?: string },
      ) => {
        try {
          const data: JSONObject = parseJsonArg(options.data);
          const parentOpts: CLIOptions = getParentOptions(resourceCmd);
          const creds: ResolvedCredentials =
            getResolvedCredentials(parentOpts);

          const result: JSONValue = await executeApiRequest({
            apiUrl: creds.apiUrl,
            apiKey: creds.apiKey,
            apiPath: resource.apiPath,
            operation: "update" as ApiOperation,
            id,
            data,
          });

          console.log(formatOutput(result, options.output));
        } catch (error) {
          handleError(error);
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
    .description(`Delete a ${resource.singularName}`)
    .option("--force", "Skip confirmation")
    .action(async (id: string, _options: { force?: boolean }) => {
      try {
        const parentOpts: CLIOptions = getParentOptions(resourceCmd);
        const creds: ResolvedCredentials =
          getResolvedCredentials(parentOpts);

        await executeApiRequest({
          apiUrl: creds.apiUrl,
          apiKey: creds.apiKey,
          apiPath: resource.apiPath,
          operation: "delete" as ApiOperation,
          id,
        });

        printSuccess(
          `${resource.singularName} ${id} deleted successfully.`,
        );
      } catch (error) {
        handleError(error);
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
    .action(async (options: { query?: string }) => {
      try {
        const parentOpts: CLIOptions = getParentOptions(resourceCmd);
        const creds: ResolvedCredentials =
          getResolvedCredentials(parentOpts);

        const result: JSONValue = await executeApiRequest({
          apiUrl: creds.apiUrl,
          apiKey: creds.apiKey,
          apiPath: resource.apiPath,
          operation: "count" as ApiOperation,
          query: options.query
            ? parseJsonArg(options.query)
            : undefined,
        });

        // Count response is typically { count: number }
        if (
          result &&
          typeof result === "object" &&
          !Array.isArray(result) &&
          "count" in (result as JSONObject)
        ) {
          console.log((result as JSONObject)["count"]);
        } else {
          console.log(result);
        }
      } catch (error) {
        handleError(error);
      }
    });
}

export function registerResourceCommands(program: Command): void {
  const resources: ResourceInfo[] = discoverResources();

  for (const resource of resources) {
    const resourceCmd: Command = program
      .command(resource.name)
      .description(
        `Manage ${resource.pluralName} (${resource.modelType})`,
      );

    // Database models get full CRUD
    if (resource.modelType === "database") {
      registerListCommand(resourceCmd, resource);
      registerGetCommand(resourceCmd, resource);
      registerCreateCommand(resourceCmd, resource);
      registerUpdateCommand(resourceCmd, resource);
      registerDeleteCommand(resourceCmd, resource);
      registerCountCommand(resourceCmd, resource);
    }

    // Analytics models get create, list, count
    if (resource.modelType === "analytics") {
      registerListCommand(resourceCmd, resource);
      registerCreateCommand(resourceCmd, resource);
      registerCountCommand(resourceCmd, resource);
    }
  }
}
