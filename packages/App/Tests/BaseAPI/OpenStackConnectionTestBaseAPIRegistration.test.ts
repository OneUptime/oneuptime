import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudConnectionTest from "Common/Models/DatabaseModels/OpenStackCloudConnectionTest";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A model's @CrudApiEndpoint route only answers once BaseAPI/Index.ts mounts
 * `new BaseAPI<Model, ServiceType>(Model, Service)` for it. A model left out there compiles
 * fine and 404s from the dashboard, and the Test connection button with it. Booting the whole
 * API router here would pull in every service, so the registration is pinned on the source,
 * whitespace-insensitively, the way MessageQueueBaseAPIRegistration pins the Queues models.
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
    model: OpenStackCloud,
    modelName: "OpenStackCloud",
    serviceName: "OpenStackCloudService",
    route: "/openstack-cloud",
  },
  {
    model: OpenStackCloudConnectionTest,
    modelName: "OpenStackCloudConnectionTest",
    serviceName: "OpenStackCloudConnectionTestService",
    route: "/openstack-cloud-connection-test",
  },
];

function readBaseApiIndex(): string {
  return fs
    .readFileSync(path.join(APP_ROOT, "FeatureSet/BaseAPI/Index.ts"), "utf8")
    .replace(/\s+/g, "");
}

describe("the connection test's CRUD API registration", () => {
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
        `newBaseAPI<${modelName},${serviceName}Type,?>\\(${modelName},${serviceName},?\\)\\.getRouter\\(\\)`,
        "g",
      );

      expect(code.match(mount) || []).toHaveLength(1);
    },
  );

  test.each(REGISTRATIONS)(
    "$modelName serves the route $route",
    (registration: Registration) => {
      const model: BaseModel = new registration.model();

      expect(model.crudApiPath?.toString()).toBe(registration.route);
    },
  );

  test("no other model answers on those routes", () => {
    const owners: Array<string> = [];

    for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
      const route: string | undefined = new modelType().crudApiPath?.toString();

      if (
        route &&
        REGISTRATIONS.some((registration: Registration): boolean => {
          return registration.route === route;
        })
      ) {
        owners.push(modelType.name);
      }
    }

    expect(owners.sort()).toEqual(
      REGISTRATIONS.map((registration: Registration): string => {
        return registration.modelName;
      }).sort(),
    );
  });
});
