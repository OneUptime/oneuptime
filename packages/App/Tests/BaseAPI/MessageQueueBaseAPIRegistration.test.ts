import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import MessageQueueLabelRule from "Common/Models/DatabaseModels/MessageQueueLabelRule";
import MessageQueueOwnerRule from "Common/Models/DatabaseModels/MessageQueueOwnerRule";
import MessageQueueOwnerTeam from "Common/Models/DatabaseModels/MessageQueueOwnerTeam";
import MessageQueueOwnerUser from "Common/Models/DatabaseModels/MessageQueueOwnerUser";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Queues resource type exposes five models over the generic CRUD API. A
 * model's @CrudApiEndpoint route only answers once BaseAPI/Index.ts mounts
 * `new BaseAPI<Model, ServiceType>(Model, Service)` for it — a model left out
 * there compiles fine and 404s from the dashboard. Booting the whole API
 * router here would pull in every service, so the registration is pinned on
 * the source, whitespace-insensitively, the same way
 * DatabaseServerBaseAPIRegistration pins the Databases models.
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
    model: MessageQueue,
    modelName: "MessageQueue",
    serviceName: "MessageQueueService",
    route: "/message-queue",
  },
  {
    model: MessageQueueOwnerTeam,
    modelName: "MessageQueueOwnerTeam",
    serviceName: "MessageQueueOwnerTeamService",
    route: "/message-queue-owner-team",
  },
  {
    model: MessageQueueOwnerUser,
    modelName: "MessageQueueOwnerUser",
    serviceName: "MessageQueueOwnerUserService",
    route: "/message-queue-owner-user",
  },
  {
    model: MessageQueueLabelRule,
    modelName: "MessageQueueLabelRule",
    serviceName: "MessageQueueLabelRuleService",
    route: "/message-queue-label-rule",
  },
  {
    model: MessageQueueOwnerRule,
    modelName: "MessageQueueOwnerRule",
    serviceName: "MessageQueueOwnerRuleService",
    route: "/message-queue-owner-rule",
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

describe("Queues CRUD API registration", () => {
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

  test("no other model already answers on a queue route", () => {
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

  test("every model under the /message-queue routes is registered here", () => {
    /*
     * A sixth queue model added later must be mounted too; it would answer
     * on a /message-queue-* route by convention.
     */
    const queueModels: Array<string> = (
      AllModelTypes as Array<DatabaseBaseModelType>
    )
      .filter((modelType: DatabaseBaseModelType): boolean => {
        const route: string | undefined =
          new modelType().crudApiPath?.toString();
        return Boolean(route && route.startsWith("/message-queue"));
      })
      .map((modelType: DatabaseBaseModelType): string => {
        return modelType.name;
      });

    expect(queueModels.sort()).toEqual(
      REGISTRATIONS.map((registration: Registration): string => {
        return registration.modelName;
      }).sort(),
    );
  });
});
