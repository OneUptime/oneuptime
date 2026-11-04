import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterConnectionTest from "Common/Models/DatabaseModels/VMwareVCenterConnectionTest";
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
 * fine and 404s from the dashboard. VMwareVCenterConnectionTest shipped that way: Test
 * connection answered "Page not found" until it was mounted, though the probe's side and the
 * expiry job were ready. Booting the whole API router here would pull in every service, so
 * the registration is pinned on the source, whitespace-insensitively, the way
 * OpenStackConnectionTestBaseAPIRegistration does.
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
    model: VMwareVCenter,
    modelName: "VMwareVCenter",
    serviceName: "VMwareVCenterService",
    route: "/vmware-vcenter",
  },
  {
    model: VMwareVCenterConnectionTest,
    modelName: "VMwareVCenterConnectionTest",
    serviceName: "VMwareVCenterConnectionTestService",
    route: "/vmware-vcenter-connection-test",
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
