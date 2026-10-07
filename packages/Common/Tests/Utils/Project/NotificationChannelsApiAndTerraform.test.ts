import { beforeAll, describe, expect, test } from "@jest/globals";
import Project from "../../../Models/DatabaseModels/Project";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import {
  PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
  PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
  ProjectNotificationChannel,
} from "../../../Utils/Project/NotificationChannels";
import { PROJECT_BILLING_READ_ROLES } from "../../../Utils/Project/ProjectBilling";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * The project's SMS, phone call, WhatsApp and Telegram switches
 * (Utils/Project/NotificationChannels) are switched through the API and the
 * Terraform provider as well as the dashboard: a Billing Admin's API key, or
 * a Terraform configuration run with one, turns them on and off. Both are
 * generated from the models - the OpenAPI spec by OpenAPIUtil, the provider
 * from that spec by Scripts/TerraformProvider - so these read the real spec
 * and the real provider parser, and hold each switch to the shape a reader
 * of the API reference or a Terraform user meets.
 */

const CHANNELS: Array<ProjectNotificationChannel> = Object.values(
  ProjectNotificationChannel,
);

// Terraform's attribute name for each column, as the provider names it.
const TERRAFORM_ATTRIBUTE_BY_COLUMN: Record<string, string> = {
  enableSmsNotifications: "enable_sms_notifications",
  enableCallNotifications: "enable_call_notifications",
  enableWhatsAppNotifications: "enable_whats_app_notifications",
  enableTelegramNotifications: "enable_telegram_notifications",
};

let spec: JSONObject;
let provider: TerraformResource;

function schemaOf(name: string): JSONObject {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;
  const schema: JSONObject | undefined = schemas[name] as
    | JSONObject
    | undefined;

  expect(schema).toBeDefined();

  return schema as JSONObject;
}

function propertyOf(schemaName: string, property: string): JSONObject {
  return ((schemaOf(schemaName)["properties"] as JSONObject) || {})[
    property
  ] as JSONObject;
}

beforeAll(() => {
  spec = OpenAPIUtil.generateOpenAPISpec();

  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(spec as never);

  const found: TerraformResource | undefined = parser
    .getResources()
    .find((resource: TerraformResource): boolean => {
      return resource.name === "project";
    });

  expect(found).toBeDefined();
  provider = found as TerraformResource;
});

describe("the API", () => {
  test.each(CHANNELS)(
    "%s: the switch is read and changed as a boolean, with what it does said",
    (channel: ProjectNotificationChannel) => {
      const column: string =
        PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL[channel];

      for (const schemaName of ["ProjectReadSchema", "ProjectUpdateSchema"]) {
        const property: JSONObject = propertyOf(schemaName, column);

        expect([schemaName, column, property?.["type"]]).toEqual([
          schemaName,
          column,
          "boolean",
        ]);
        expect(String(property?.["description"] || "").length).toBeGreaterThan(
          0,
        );
      }
    },
  );

  test("a project is not created with a channel on: the switches start off and are turned on afterwards", () => {
    const createProperties: JSONObject =
      (schemaOf("ProjectCreateSchema")["properties"] as JSONObject) || {};

    for (const column of Object.values(
      PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
    )) {
      expect([column, Object.keys(createProperties).includes(column)]).toEqual([
        column,
        false,
      ]);
    }
  });

  test("the switches are changed by the people the model lets change them: Project Owner, Billing Admin and Manage Billing", () => {
    const project: Project = new Project();

    for (const column of Object.values(
      PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
    )) {
      expect(project.getColumnAccessControlFor(column)?.update).toEqual([
        ...PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
      ]);
    }

    expect([...PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.BillingAdmin,
        Permission.ManageProjectBilling,
      ].sort(),
    );
  });

  test("every billing role reads them, as the billing pages show them", () => {
    const project: Project = new Project();

    for (const column of Object.values(
      PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
    )) {
      const read: Array<Permission> =
        project.getColumnAccessControlFor(column)?.read || [];

      for (const role of PROJECT_BILLING_READ_ROLES) {
        expect([column, role, read.includes(role)]).toEqual([
          column,
          role,
          true,
        ]);
      }
    }
  });
});

describe("the Terraform provider", () => {
  test("names the four switches on oneuptime_project, one attribute each", () => {
    const attributeFor: (column: string) => Array<string> = (
      column: string,
    ): Array<string> => {
      return Object.keys(provider.schema).filter((name: string): boolean => {
        return (provider.schema[name]?.apiFieldName || name) === column;
      });
    };

    expect(
      Object.values(PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL).map(
        (column: string): Array<string> => {
          return attributeFor(column);
        },
      ),
    ).toEqual([
      ["enable_sms_notifications"],
      ["enable_call_notifications"],
      ["enable_whats_app_notifications"],
      ["enable_telegram_notifications"],
    ]);
  });

  test.each(Object.entries(TERRAFORM_ATTRIBUTE_BY_COLUMN))(
    "%s is the optional bool %s, changed in place without replacing the project",
    (column: string, attributeName: string) => {
      const attribute: TerraformAttribute | undefined =
        provider.schema[attributeName];

      expect(attribute).toBeDefined();
      expect(attribute?.type).toBe("bool");
      expect(attribute?.required).toBeFalsy();
      expect(attribute?.forceNew).toBeFalsy();
      expect(attribute?.apiFieldName || column).toBe(column);

      // Sent on an update, the way the dashboard's switch sends it.
      expect(
        Object.keys(provider.operationSchemas?.update || {}),
      ).toContain(attributeName);
    },
  );
});
