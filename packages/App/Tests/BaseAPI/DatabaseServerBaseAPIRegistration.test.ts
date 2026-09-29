import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "Common/Models/DatabaseModels/DatabaseServerEndpoint";
import DatabaseServerFeed from "Common/Models/DatabaseModels/DatabaseServerFeed";
import DatabaseServerLabelRule from "Common/Models/DatabaseModels/DatabaseServerLabelRule";
import DatabaseServerOwnerRule from "Common/Models/DatabaseModels/DatabaseServerOwnerRule";
import DatabaseServerOwnerTeam from "Common/Models/DatabaseModels/DatabaseServerOwnerTeam";
import DatabaseServerOwnerUser from "Common/Models/DatabaseModels/DatabaseServerOwnerUser";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Databases resource type exposes seven models over the generic CRUD
 * API. A model's @CrudApiEndpoint route only answers once BaseAPI/Index.ts
 * mounts `new BaseAPI<Model, ServiceType>(Model, Service)` for it — a model
 * left out there compiles fine and 404s from the dashboard. Booting the
 * whole API router here would pull in every service, so the registration
 * is pinned on the source, whitespace-insensitively, the same way
 * SloLabelOwnerRulesWiring pins the SLO rule models.
 */

const APP_ROOT: string = path.join(__dirname, "../..");

interface Registration {
  model: DatabaseBaseModelType;
  modelName: string;
  serviceName: string;
  route: string;
}

const REGISTRATIONS: Array<Registration> = [
  {
    model: DatabaseServer,
    modelName: "DatabaseServer",
    serviceName: "DatabaseServerService",
    route: "/database-server",
  },
  {
    model: DatabaseServerEndpoint,
    modelName: "DatabaseServerEndpoint",
    serviceName: "DatabaseServerEndpointService",
    route: "/database-server-endpoint",
  },
  {
    model: DatabaseServerFeed,
    modelName: "DatabaseServerFeed",
    serviceName: "DatabaseServerFeedService",
    route: "/database-server-feed",
  },
  {
    model: DatabaseServerOwnerTeam,
    modelName: "DatabaseServerOwnerTeam",
    serviceName: "DatabaseServerOwnerTeamService",
    route: "/database-server-owner-team",
  },
  {
    model: DatabaseServerOwnerUser,
    modelName: "DatabaseServerOwnerUser",
    serviceName: "DatabaseServerOwnerUserService",
    route: "/database-server-owner-user",
  },
  {
    model: DatabaseServerLabelRule,
    modelName: "DatabaseServerLabelRule",
    serviceName: "DatabaseServerLabelRuleService",
    route: "/database-server-label-rule",
  },
  {
    model: DatabaseServerOwnerRule,
    modelName: "DatabaseServerOwnerRule",
    serviceName: "DatabaseServerOwnerRuleService",
    route: "/database-server-owner-rule",
  },
];

function readBaseApiIndex(): string {
  return fs
    .readFileSync(path.join(APP_ROOT, "FeatureSet/BaseAPI/Index.ts"), "utf8")
    .replace(/\s+/g, "");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("Databases CRUD API registration", () => {
  const code: string = readBaseApiIndex();

  test.each(REGISTRATIONS)(
    "$modelName is imported with its service and mounted exactly once",
    (registration: Registration) => {
      const { modelName, serviceName } = registration;

      expect(code).toContain(
        `import${modelName}from"Common/Models/DatabaseModels/${modelName}";`,
      );
      expect(code).toContain(
        `import${serviceName},{Serviceas${serviceName}Type,}from"Common/Server/Services/${serviceName}";`,
      );

      // Prettier may or may not leave a trailing comma after the service.
      const mount: RegExp = new RegExp(
        `newBaseAPI<${modelName},${serviceName}Type>\\(${modelName},${serviceName},?\\)\\.getRouter\\(\\)`,
        "g",
      );
      expect(code.match(mount) || []).toHaveLength(1);

      // Mounted under the API prefix like every other BaseAPI.
      expect(
        countOccurrences(
          code,
          `app.use(\`/\${APP_NAME.toLocaleLowerCase()}\`,newBaseAPI<${modelName},`,
        ),
      ).toBe(1);
    },
  );

  test.each(REGISTRATIONS)(
    "$modelName serves the SPEC route $route",
    (registration: Registration) => {
      const model: BaseModel = new registration.model();

      expect(model.crudApiPath?.toString()).toBe(registration.route);
    },
  );

  test("no other model already answers on a database route", () => {
    const routes: Set<string> = new Set<string>(
      REGISTRATIONS.map((registration: Registration): string => {
        return registration.route;
      }),
    );

    const owners: Array<string> = [];

    for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
      const route: string | undefined = new modelType().crudApiPath?.toString();

      if (route && routes.has(route)) {
        owners.push(`${route} -> ${modelType.name}`);
      }
    }

    expect(owners.sort()).toEqual(
      REGISTRATIONS.map((registration: Registration): string => {
        return `${registration.route} -> ${registration.modelName}`;
      }).sort(),
    );
  });
});
