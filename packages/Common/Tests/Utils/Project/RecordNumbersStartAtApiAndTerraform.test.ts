import { beforeAll, describe, expect, test } from "@jest/globals";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import {
  NUMBERED_RECORD_KINDS,
  NumberedRecordKindInfo,
} from "../../../Utils/Project/NextNumber";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * Where a project's numbers start is set through the API and the Terraform
 * provider as well as the dashboard's Numbering pages: a script that moves
 * a team over from another tool, or a Terraform configuration that creates
 * the project, can carry its numbers on. Both are generated from the
 * models - the OpenAPI spec by OpenAPIUtil, the provider from that spec by
 * Scripts/TerraformProvider - so these read the real spec and the real
 * provider parser, and hold each start to the shape a reader of the API
 * reference or a Terraform user meets: a whole number, optional, set when
 * the project is created and changed in place, and read back as set. The
 * counters behind the numbers stay out of both.
 */

const KINDS: Array<NumberedRecordKindInfo> = [...NUMBERED_RECORD_KINDS];

const TERRAFORM_ATTRIBUTE_BY_COLUMN: Record<string, string> = {
  incidentNumbersStartAt: "incident_numbers_start_at",
  incidentEpisodeNumbersStartAt: "incident_episode_numbers_start_at",
  alertNumbersStartAt: "alert_numbers_start_at",
  alertEpisodeNumbersStartAt: "alert_episode_numbers_start_at",
  scheduledMaintenanceNumbersStartAt: "scheduled_maintenance_numbers_start_at",
};

let spec: JSONObject;
let provider: TerraformResource;

function propertiesOf(schemaName: string): JSONObject {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;
  const schema: JSONObject | undefined = schemas[schemaName] as
    | JSONObject
    | undefined;

  expect(schema).toBeDefined();

  return ((schema as JSONObject)["properties"] as JSONObject) || {};
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
  test.each(KINDS)(
    "$startsAtColumn: read, set on create and changed as a whole number, with what it does said",
    (info: NumberedRecordKindInfo) => {
      for (const schemaName of [
        "ProjectReadSchema",
        "ProjectCreateSchema",
        "ProjectUpdateSchema",
      ]) {
        const property: JSONObject | undefined = propertiesOf(schemaName)[
          info.startsAtColumn
        ] as JSONObject | undefined;

        expect([schemaName, info.startsAtColumn, Boolean(property)]).toEqual([
          schemaName,
          info.startsAtColumn,
          true,
        ]);
        expect(["integer", "number"]).toContain(property?.["type"]);
        expect(String(property?.["description"] || "")).toContain(
          "must be higher than every",
        );
      }
    },
  );

  test.each(KINDS)(
    "$counterColumn: the counter itself is no caller's to read or write",
    (info: NumberedRecordKindInfo) => {
      for (const schemaName of [
        "ProjectReadSchema",
        "ProjectCreateSchema",
        "ProjectUpdateSchema",
      ]) {
        expect([
          schemaName,
          Object.keys(propertiesOf(schemaName)).includes(info.counterColumn),
        ]).toEqual([schemaName, false]);
      }
    },
  );
});

describe("the Terraform provider", () => {
  test.each(Object.entries(TERRAFORM_ATTRIBUTE_BY_COLUMN))(
    "%s is the optional %s, changed in place without replacing the project",
    (column: string, attributeName: string) => {
      const attribute: TerraformAttribute | undefined =
        provider.schema[attributeName];

      expect(attribute).toBeDefined();
      expect(["number", "int64"]).toContain(attribute?.type);
      expect(attribute?.required).toBeFalsy();
      expect(attribute?.forceNew).toBeFalsy();
      expect(attribute?.apiFieldName || column).toBe(column);

      // Sent when the project is created, and on an update.
      expect(Object.keys(provider.operationSchemas?.create || {})).toContain(
        attributeName,
      );
      expect(Object.keys(provider.operationSchemas?.update || {})).toContain(
        attributeName,
      );
    },
  );

  test("names every start, one attribute each, and no counter", () => {
    expect(Object.keys(TERRAFORM_ATTRIBUTE_BY_COLUMN).sort()).toEqual(
      KINDS.map((info: NumberedRecordKindInfo): string => {
        return info.startsAtColumn;
      }).sort(),
    );

    for (const info of KINDS) {
      const attributes: Array<string> = Object.keys(provider.schema).filter(
        (name: string): boolean => {
          return (provider.schema[name]?.apiFieldName || name) ===
            info.counterColumn;
        },
      );

      expect([info.counterColumn, attributes]).toEqual([info.counterColumn, []]);
    }
  });
});
