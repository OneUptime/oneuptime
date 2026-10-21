import McpOAuthClient from "Common/Models/DatabaseModels/McpOAuthClient";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import McpOAuthToken from "Common/Models/DatabaseModels/McpOAuthToken";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * OAuth sign-in for the MCP server keeps three tables, and exactly ONE of
 * them is meant to be reachable over the generic CRUD API:
 *
 *   McpOAuthGrant   "this member let this client act for them". Listed on
 *                   Settings > MCP Server and revoked there, so it has a
 *                   @CrudApiEndpoint and must be mounted - a model left out
 *                   of BaseAPI/Index.ts compiles fine and 404s from the
 *                   dashboard, and then nobody can see or disconnect what is
 *                   connected to their project.
 *
 *   McpOAuthToken   the hashes of every authorization code, access token and
 *   McpOAuthClient  refresh token; and client registrations with their
 *                   secret hashes. Nothing outside the authorization server
 *                   has any business reading or writing either, so they must
 *                   NEVER get a CRUD route: no @CrudApiEndpoint on the model,
 *                   and no BaseAPI mount.
 *
 * Booting the whole API router here would pull in every service, so the
 * registration is pinned on the source, whitespace-insensitively, the way
 * MessageQueueBaseAPIRegistration pins the Queues models.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

const GRANT_ROUTE: string = "/mcp-client-authorization";

const INTERNAL_MODELS: Array<{
  model: DatabaseBaseModelType;
  modelName: string;
  serviceName: string;
}> = [
  {
    model: McpOAuthToken,
    modelName: "McpOAuthToken",
    serviceName: "McpOAuthTokenService",
  },
  {
    model: McpOAuthClient,
    modelName: "McpOAuthClient",
    serviceName: "McpOAuthClientService",
  },
];

const WHITESPACE: RegExp = /\s+/g;

function readCompact(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(WHITESPACE, "");
}

function readBaseApiIndex(): string {
  return readCompact(path.join(APP_ROOT, "FeatureSet/BaseAPI/Index.ts"));
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// Every .ts source file directly inside a directory (not its subdirectories).
function listSourceFiles(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return entry.isFile() && entry.name.endsWith(".ts");
    })
    .map((entry: fs.Dirent): string => {
      return path.join(directory, entry.name);
    });
}

describe("MCP client authorizations: the one CRUD API", () => {
  const code: string = readBaseApiIndex();

  test("McpOAuthGrant is imported with its service and mounted exactly once", () => {
    expect(code).toContain(
      'importMcpOAuthGrantfrom"Common/Models/DatabaseModels/McpOAuthGrant";',
    );
    expect(code).toContain(
      'importMcpOAuthGrantService,{ServiceasMcpOAuthGrantServiceType,}from"Common/Server/Services/McpOAuthGrantService";',
    );

    // Prettier may or may not leave a trailing comma after the service.
    const mount: RegExp =
      /newBaseAPI<McpOAuthGrant,McpOAuthGrantServiceType>\(McpOAuthGrant,McpOAuthGrantService,?\)\.getRouter\(\)/g;

    expect(code.match(mount) || []).toHaveLength(1);

    // Mounted under the API prefix like every other BaseAPI.
    expect(
      countOccurrences(
        code,
        "app.use(`/${APP_NAME.toLocaleLowerCase()}`,newBaseAPI<McpOAuthGrant,",
      ),
    ).toBe(1);
  });

  test("it is the plain generic router: no custom API class adds routes of its own", () => {
    // A subclass would be the place a create or update route could slip in.
    expect(code).not.toContain("McpOAuthGrantAPI");
    expect(code).not.toContain("McpClientAuthorizationAPI");
  });

  test(`McpOAuthGrant serves ${GRANT_ROUTE}`, () => {
    const model: BaseModel = new McpOAuthGrant();

    expect(model.crudApiPath?.toString()).toBe(GRANT_ROUTE);
  });

  test("no other model answers on that route", () => {
    const owners: Array<string> = [];

    for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
      const route: string | undefined = new modelType().crudApiPath?.toString();

      if (route === GRANT_ROUTE) {
        owners.push(modelType.name);
      }
    }

    expect(owners).toEqual(["McpOAuthGrant"]);
  });

  test("the router can only read and delete: the model allows nobody to create or update", () => {
    /*
     * Mounting BaseAPI registers the create and update routes too. What makes
     * them inert is the model: with empty create and update lists every such
     * request is refused by the permission layer. A grant is only ever MADE
     * by the consent endpoint.
     */
    const model: BaseModel = new McpOAuthGrant();

    expect(model.getCreatePermissions()).toEqual([]);
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getReadPermissions().length).toBeGreaterThan(0);
    expect(model.getDeletePermissions().length).toBeGreaterThan(0);
  });
});

describe("MCP OAuth tokens and client registrations: never a CRUD API", () => {
  const code: string = readBaseApiIndex();

  test.each(INTERNAL_MODELS)(
    "$modelName declares no CRUD route",
    (data: { model: DatabaseBaseModelType }) => {
      const model: BaseModel = new data.model();

      expect(model.crudApiPath ?? null).toBeNull();
      expect(model.getCrudApiPath()).toBeFalsy();
    },
  );

  test.each(INTERNAL_MODELS)(
    "$modelName is not mounted, imported or mentioned in BaseAPI/Index.ts",
    (data: { modelName: string; serviceName: string }) => {
      expect(code).not.toContain(`BaseAPI<${data.modelName},`);
      expect(code).not.toContain(
        `from"Common/Models/DatabaseModels/${data.modelName}"`,
      );
      expect(code).not.toContain(
        `from"Common/Server/Services/${data.serviceName}"`,
      );
      expect(code).not.toContain(data.modelName);
      expect(code).not.toContain(data.serviceName);
    },
  );

  test.each(INTERNAL_MODELS)(
    "$modelName has no API class of its own in Common/Server/API",
    (data: { modelName: string; serviceName: string }) => {
      /*
       * The other way a model gets routes: `class XAPI extends BaseAPI<X, ...>`
       * in Common/Server/API, mounted by name. None may exist for these.
       */
      const offenders: Array<string> = listSourceFiles(
        path.join(COMMON_ROOT, "Server", "API"),
      ).filter((filePath: string): boolean => {
        const source: string = readCompact(filePath);

        return (
          source.includes(data.modelName) || source.includes(data.serviceName)
        );
      });

      expect(offenders).toEqual([]);
    },
  );

  test.each(INTERNAL_MODELS)(
    "$modelName is still a registered model with a service: only the CRUD API is withheld",
    (data: { model: DatabaseBaseModelType; serviceName: string }) => {
      // The table has to exist and be migrated; that needs the model index.
      expect(AllModelTypes as Array<DatabaseBaseModelType>).toContain(
        data.model,
      );

      const serviceIndex: string = readCompact(
        path.join(COMMON_ROOT, "Server", "Services", "Index.ts"),
      );

      expect(serviceIndex).toContain(
        `import${data.serviceName}from"./${data.serviceName}";`,
      );
    },
  );

  test.each(INTERNAL_MODELS)(
    "$modelName grants no table permission to anybody, so even a mistaken mount would serve nothing",
    (data: { model: DatabaseBaseModelType }) => {
      const model: BaseModel = new data.model();

      expect(model.getCreatePermissions()).toEqual([]);
      expect(model.getReadPermissions()).toEqual([]);
      expect(model.getUpdatePermissions()).toEqual([]);
      expect(model.getDeletePermissions()).toEqual([]);
    },
  );

  test("of the MCP OAuth models, only the grant has a CRUD route", () => {
    const routed: Array<string> = (
      AllModelTypes as Array<DatabaseBaseModelType>
    )
      .filter((modelType: DatabaseBaseModelType): boolean => {
        return modelType.name.startsWith("McpOAuth");
      })
      .filter((modelType: DatabaseBaseModelType): boolean => {
        return Boolean(new modelType().crudApiPath);
      })
      .map((modelType: DatabaseBaseModelType): string => {
        return modelType.name;
      });

    expect(routed).toEqual(["McpOAuthGrant"]);

    // And all three are accounted for: a fourth would have to be decided on.
    expect(
      (AllModelTypes as Array<DatabaseBaseModelType>)
        .map((modelType: DatabaseBaseModelType): string => {
          return modelType.name;
        })
        .filter((name: string): boolean => {
          return name.startsWith("McpOAuth");
        })
        .sort(),
    ).toEqual(["McpOAuthClient", "McpOAuthGrant", "McpOAuthToken"]);
  });
});
