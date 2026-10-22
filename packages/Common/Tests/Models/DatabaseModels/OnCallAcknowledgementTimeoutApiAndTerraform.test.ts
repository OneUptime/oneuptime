import { beforeAll, describe, expect, test } from "@jest/globals";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * AN ON-CALL POLICY'S ACKNOWLEDGEMENT TIMEOUT, OUTSIDE THE DASHBOARD.
 *
 * A team that keeps its on-call policies in Terraform, a script on the API
 * or an AI agent over MCP sets the timeout the way the Dashboard does: one
 * optional number of minutes, acknowledgementTimeoutInMinutes, empty to
 * turn it off. A run's clock and its page again number are OneUptime's own:
 * read everywhere, written by nobody. The API reference and the Terraform
 * provider are generated from the models' metadata; these read the real
 * spec and the real provider parser.
 */

let spec: JSONObject;
let providerResources: Array<TerraformResource>;

function propertiesOf(schemaName: string): JSONObject {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;
  const schema: JSONObject | undefined = schemas[schemaName] as
    | JSONObject
    | undefined;

  expect(schema).toBeDefined();

  return ((schema as JSONObject)["properties"] || {}) as JSONObject;
}

function requiredOf(schemaName: string): Array<string> {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;

  return ((schemas[schemaName] as JSONObject)["required"] ||
    []) as Array<string>;
}

beforeAll(() => {
  spec = OpenAPIUtil.generateOpenAPISpec();

  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(spec as never);
  providerResources = parser.getResources();
});

// Who may change an on-call policy may change its timeout: the same roles.
const POLICY_WRITERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.OnCallAdmin,
  Permission.OnCallMember,
];

describe("the policy's acknowledgementTimeoutInMinutes", () => {
  const column: TableColumnMetadata =
    new OnCallDutyPolicy().getTableColumnMetadata(
      "acknowledgementTimeoutInMinutes",
    );

  test("is an optional number with no default: every policy starts with it off", () => {
    expect(column.type).toBe(TableColumnType.Number);
    expect(column.required).toBe(false);
    expect(column.isDefaultValueColumn).toBeFalsy();
    expect(column.defaultValue).toBeUndefined();
    expect(new OnCallDutyPolicy().acknowledgementTimeoutInMinutes).toBeUndefined();
  });

  test("is written by whoever may create or edit a policy, and read by whoever may read one", () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    const access: {
      create: Array<Permission>;
      update: Array<Permission>;
      read: Array<Permission>;
    } = policy.getColumnAccessControlFor("acknowledgementTimeoutInMinutes")!;
    const repeat: {
      create: Array<Permission>;
      update: Array<Permission>;
      read: Array<Permission>;
    } = policy.getColumnAccessControlFor(
      "repeatPolicyIfNoOneAcknowledgesNoOfTimes",
    )!;

    // Exactly as the Repeat Policy beside it.
    expect(access.create).toEqual(repeat.create);
    expect(access.update).toEqual(repeat.update);
    expect(access.read).toEqual(repeat.read);

    for (const permission of POLICY_WRITERS) {
      expect(access.update).toContain(permission);
    }

    expect(access.read).toContain(Permission.Viewer);
    expect(access.update).not.toContain(Permission.Viewer);
  });

  test("its description says what it does in one short line", () => {
    expect(column.description).toBe(
      "Page again when something this policy paged about is acknowledged but not resolved within this many minutes (5 to 1440). Empty: never.",
    );
    expect(column.description!.length).toBeLessThanOrEqual(150);
  });

  test("the API takes it on create and update, and never requires it", () => {
    for (const schemaName of [
      "OnCallDutyPolicyCreateSchema",
      "OnCallDutyPolicyUpdateSchema",
    ]) {
      const property: JSONObject | undefined = propertiesOf(schemaName)[
        "acknowledgementTimeoutInMinutes"
      ] as JSONObject | undefined;

      expect(property).toBeDefined();
      expect(["number", "integer"]).toContain(property!["type"]);
      expect(property!["default"]).toBeUndefined();
      expect(requiredOf(schemaName)).not.toContain(
        "acknowledgementTimeoutInMinutes",
      );
    }
  });

  test("the API reads it back", () => {
    expect(
      propertiesOf("OnCallDutyPolicyReadSchema")[
        "acknowledgementTimeoutInMinutes"
      ],
    ).toBeDefined();
  });

  test("Terraform has acknowledgement_timeout_in_minutes: an optional number, changed in place", () => {
    const resource: TerraformResource | undefined = providerResources.find(
      (candidate: TerraformResource): boolean => {
        return candidate.name === "on_call_policy";
      },
    );

    expect(resource).toBeDefined();

    const attribute: TerraformAttribute | undefined =
      resource!.schema["acknowledgement_timeout_in_minutes"];

    expect(attribute).toBeDefined();
    expect(attribute?.type).toBe("number");
    expect(attribute?.required).toBe(false);
    expect(attribute?.optional).toBe(true);
    // Changing it keeps the policy and its history: no replacement.
    expect(attribute?.forceNew).toBe(false);
  });
});

describe("a run's clock and its page again number", () => {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();

  test.each(["acknowledgementTimeoutStartedAt", "pageAgainNumber"])(
    "%s is written by nobody but OneUptime",
    (columnName: string) => {
      const access: {
        create: Array<Permission>;
        update: Array<Permission>;
        read: Array<Permission>;
      } = run.getColumnAccessControlFor(columnName)!;

      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
      expect(access.read).toContain(Permission.OnCallViewer);
      expect(access.read).toContain(
        Permission.ReadProjectOnCallDutyPolicyExecutionLog,
      );
    },
  );

  test("both are optional, and empty on every run until the timeout is used", () => {
    expect(
      run.getTableColumnMetadata("acknowledgementTimeoutStartedAt").type,
    ).toBe(TableColumnType.Date);
    expect(run.getTableColumnMetadata("pageAgainNumber").type).toBe(
      TableColumnType.Number,
    );
    expect(
      run.getTableColumnMetadata("acknowledgementTimeoutStartedAt").required,
    ).toBe(false);
    expect(run.getTableColumnMetadata("pageAgainNumber").required).toBe(false);
    expect(run.acknowledgementTimeoutStartedAt).toBeUndefined();
    expect(run.pageAgainNumber).toBeUndefined();
  });

  test("the API reads both, and takes neither on create", () => {
    const read: JSONObject = propertiesOf("OnCallDutyPolicyExecutionLogReadSchema");

    expect(read["acknowledgementTimeoutStartedAt"]).toBeDefined();
    expect(read["pageAgainNumber"]).toBeDefined();

    const create: JSONObject = propertiesOf(
      "OnCallDutyPolicyExecutionLogCreateSchema",
    );

    expect(create["acknowledgementTimeoutStartedAt"]).toBeUndefined();
    expect(create["pageAgainNumber"]).toBeUndefined();
  });
});
