import { Command } from "commander";
import { buildProgram } from "../Program";
import {
  addResourceSubcommands,
  discoverResources,
} from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import OpenAPIUtil from "Common/Server/Utils/OpenAPI";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import {
  CliOperation,
  getCliResourceName,
  toCliCommandName,
} from "Common/Utils/DeveloperDocs/CliCommands";
import { CLIENT_RESOURCE_NAMES } from "Common/Utils/DeveloperDocs/ClientResourceNames";
import {
  CliResource,
  getCliResources,
} from "Common/Utils/DeveloperDocs/CliResources";

/*
 * THE CLI DOES EVERYTHING THE API DOES
 *
 * Builds the OpenAPI spec the server publishes (Common/Server/Utils/
 * OpenAPI.ts, the document the API reference and the Terraform provider are
 * made from) and holds the CLI to it, request by request: for every path
 * and method the API documents, the CLI has the resource command and its
 * subcommand, and the CLI has no subcommand the API does not take.
 *
 * The CLI's commands come from the models by the same rule
 * (Common/Utils/DeveloperDocs/CliCommands), so a new model is a new command
 * with nothing written for it - and this fails if anyone ever gives the API
 * a request by another rule, or the CLI a resource the API lacks.
 *
 * One kind of request is left out, on purpose, and named here: the list and
 * count of a resource only its own user may read (a user's sessions, their
 * two-factor keys). The spec documents those two for every model, but the
 * API refuses them to every API key, so the CLI makes no command a key
 * could never run.
 */

interface SpecRequest {
  method: string;
  path: string;
  // The resource's path: /incident.
  apiPath: string;
  operation: CliOperation;
}

const ID_SEGMENT: string = "/{id}";

// A path and method of the spec, as the CLI's operation on a resource.
function toSpecRequest(method: string, path: string): SpecRequest {
  const at: (suffix: string) => string = (suffix: string): string => {
    return path.slice(0, path.length - suffix.length);
  };

  if (method === "post" && path.endsWith("/get-list")) {
    return {
      method,
      path,
      apiPath: at("/get-list"),
      operation: CliOperation.List,
    };
  }

  if (method === "post" && path.endsWith("/count")) {
    return {
      method,
      path,
      apiPath: at("/count"),
      operation: CliOperation.Count,
    };
  }

  if (method === "post" && path.endsWith(`${ID_SEGMENT}/get-item`)) {
    return {
      method,
      path,
      apiPath: at(`${ID_SEGMENT}/get-item`),
      operation: CliOperation.Get,
    };
  }

  if (method === "put" && path.endsWith(ID_SEGMENT)) {
    return {
      method,
      path,
      apiPath: at(ID_SEGMENT),
      operation: CliOperation.Update,
    };
  }

  if (method === "delete" && path.endsWith(ID_SEGMENT)) {
    return {
      method,
      path,
      apiPath: at(ID_SEGMENT),
      operation: CliOperation.Delete,
    };
  }

  if (method === "post") {
    return { method, path, apiPath: path, operation: CliOperation.Create };
  }

  throw new Error(
    `The spec documents ${method.toUpperCase()} ${path}, a request the CLI has no operation for: give the CLI one (packages/CLI/Commands/ResourceCommands.ts).`,
  );
}

// Whether a list of read permissions names nobody an API key can be.
function readsOnlyForItsUser(
  permissions: Array<Permission> | undefined,
): boolean {
  return (permissions || []).every((permission: Permission): boolean => {
    return (
      permission === Permission.CurrentUser || permission === Permission.Public
    );
  });
}

describe("the CLI and the API", () => {
  let requests: Array<SpecRequest>;
  let resources: Array<ResourceInfo>;
  let byApiPath: Map<string, ResourceInfo>;

  beforeAll(() => {
    const spec: JSONObject = OpenAPIUtil.buildOpenAPISpec();
    const paths: JSONObject = spec["paths"] as JSONObject;

    requests = Object.entries(paths).flatMap(
      ([path, item]: [string, unknown]): Array<SpecRequest> => {
        return Object.keys(item as JSONObject).map(
          (method: string): SpecRequest => {
            return toSpecRequest(method, path);
          },
        );
      },
    );
    resources = discoverResources();
    byApiPath = new Map(
      resources.map((resource: ResourceInfo): [string, ResourceInfo] => {
        return [resource.apiPath, resource];
      }),
    );
  }, 120000);

  it("reads the spec: thousands of requests, of hundreds of resources", () => {
    expect(requests.length).toBeGreaterThan(2000);
    expect(
      new Set(
        requests.map((request: SpecRequest) => {
          return request.apiPath;
        }),
      ).size,
    ).toBeGreaterThan(400);
    expect(resources.length).toBeGreaterThan(400);
  });

  it("has a command and a subcommand for every request the API documents", () => {
    const missing: Array<string> = [];
    const readOnlyByItsUser: Set<string> = new Set<string>();

    for (const request of requests) {
      const resource: ResourceInfo | undefined = byApiPath.get(request.apiPath);

      if (resource && resource.operations.includes(request.operation)) {
        continue;
      }

      /*
       * The list and count of a resource the spec has no read of: one only
       * its own user may read. Checked below that it is.
       */
      const hasRead: boolean = requests.some((other: SpecRequest): boolean => {
        return (
          other.apiPath === request.apiPath &&
          other.operation === CliOperation.Get
        );
      });

      if (
        !hasRead &&
        (request.operation === CliOperation.List ||
          request.operation === CliOperation.Count)
      ) {
        readOnlyByItsUser.add(request.apiPath);
        continue;
      }

      missing.push(`${request.method.toUpperCase()} ${request.path}`);
    }

    expect(missing).toEqual([]);

    // Each one left out is a resource no API key may read.
    for (const apiPath of readOnlyByItsUser) {
      const model: DatabaseBaseModel | undefined = DatabaseModels.map(
        (modelType: new () => DatabaseBaseModel): DatabaseBaseModel => {
          return new modelType();
        },
      ).find((candidate: DatabaseBaseModel): boolean => {
        return (
          `/${(candidate.crudApiPath?.toString() || "").replace(/^\/+/, "")}` ===
          apiPath
        );
      });

      expect({
        apiPath,
        isUserOwned: readsOnlyForItsUser(model?.readRecordPermissions),
      }).toEqual({
        apiPath,
        isUserOwned: true,
      });
    }

    expect(readOnlyByItsUser.size).toBeGreaterThan(0);
  });

  it("has no subcommand for a request the API does not document", () => {
    const documented: Set<string> = new Set(
      requests.map((request: SpecRequest): string => {
        return `${request.apiPath} ${request.operation}`;
      }),
    );
    const extra: Array<string> = resources.flatMap(
      (resource: ResourceInfo): Array<string> => {
        return resource.operations
          .filter((operation: CliOperation): boolean => {
            return !documented.has(`${resource.apiPath} ${operation}`);
          })
          .map((operation: CliOperation): string => {
            return `oneuptime ${resource.name} ${operation}`;
          });
      },
    );

    expect(extra).toEqual([]);
  });

  it("names every resource the way its model says, and no two alike", () => {
    const names: Array<string> = resources.map(
      (resource: ResourceInfo): string => {
        return resource.name;
      },
    );

    expect(new Set(names).size).toBe(names.length);

    /*
     * No resource fell back to its table's name (CliResources' uniqueName):
     * a new model sharing another's singular name needs a name of its own
     * in Common's ClientResourceNames, which every client reads. A model
     * renamed on screen keeps its command by the name the API keeps
     * (apiSingularName), so that name is read here as the CLI reads it.
     */
    const modelsByTable: Map<
      string,
      {
        singularName: string;
        tableName: string;
        apiSingularName?: string | null | undefined;
      }
    > = new Map();

    for (const modelType of DatabaseModels) {
      const model: DatabaseBaseModel = new modelType();
      modelsByTable.set(model.tableName || "", {
        singularName: model.singularName || "",
        tableName: model.tableName || "",
        apiSingularName: model.apiSingularName,
      });
    }

    for (const modelType of AnalyticsModels) {
      const model: AnalyticsBaseModel = new modelType();
      modelsByTable.set(model.tableName, {
        singularName: model.singularName,
        tableName: model.tableName,
      });
    }

    for (const resource of getCliResources()) {
      expect({
        table: resource.tableName,
        name: resource.name,
      }).toEqual({
        table: resource.tableName,
        name: getCliResourceName(
          modelsByTable.get(resource.tableName) as {
            singularName: string;
            tableName: string;
            apiSingularName?: string | null | undefined;
          },
        ),
      });
    }
  });

  it("names the resources whose own names read poorly as ones as every client does", () => {
    for (const [tableName, clientName] of Object.entries(
      CLIENT_RESOURCE_NAMES,
    )) {
      const resource: CliResource | undefined = getCliResources().find(
        (candidate: CliResource): boolean => {
          return candidate.tableName === tableName;
        },
      );

      expect({ tableName, name: resource?.name }).toEqual({
        tableName,
        name: toCliCommandName(clientName),
      });
    }
  });

  it("gives every resource command its subcommands in the program the CLI runs", () => {
    const program: Command = buildProgram();

    for (const resource of resources) {
      const command: Command | undefined = program.commands.find(
        (candidate: Command): boolean => {
          return candidate.name() === resource.name;
        },
      );

      expect(command).toBeDefined();
      addResourceSubcommands(command as Command);

      const subcommands: Array<string> = (command as Command).commands.map(
        (child: Command): string => {
          return child.name();
        },
      );

      expect({
        resource: resource.name,
        has: subcommands.slice(0, resource.operations.length),
      }).toEqual({
        resource: resource.name,
        has: resource.operations,
      });
    }
  });

  it("reads and writes telemetry as the API does, with get, update and delete where its permissions allow", () => {
    const log: ResourceInfo | undefined = resources.find(
      (resource: ResourceInfo) => {
        return resource.name === "log";
      },
    );
    const auditLog: ResourceInfo | undefined = resources.find(
      (resource: ResourceInfo) => {
        return resource.name === "audit-log";
      },
    );

    expect(log?.operations).toEqual([
      CliOperation.List,
      CliOperation.Get,
      CliOperation.Create,
      CliOperation.Update,
      CliOperation.Delete,
      CliOperation.Count,
    ]);
    // Audit logs are read only: the server writes them.
    expect(auditLog?.operations).toEqual([
      CliOperation.List,
      CliOperation.Get,
      CliOperation.Count,
    ]);
  });
});
