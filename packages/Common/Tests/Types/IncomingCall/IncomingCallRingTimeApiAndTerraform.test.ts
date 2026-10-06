import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyEscalationRule from "../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import {
  DEFAULT_INCOMING_CALL_RING_SECONDS,
  MAX_INCOMING_CALL_RING_SECONDS,
  MIN_INCOMING_CALL_RING_SECONDS,
} from "../../../Types/IncomingCall/IncomingCallRingTime";
import { JSONObject } from "../../../Types/JSON";
import {
  DEVELOPER_DOCS_PROFILES,
  DeveloperDocsField,
  DeveloperDocsRecipe,
  DeveloperDocsRecipeBlock,
} from "../../../Utils/DeveloperDocs/ResourceProfiles";
import { getTerraformResourceConfig } from "../../../Utils/DeveloperDocs/TerraformConfig";
import {
  getTerraformAttribute,
  getTerraformTypeName,
  TerraformAttributeDescriptor,
} from "../../../Utils/DeveloperDocs/TerraformSchema";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import { ResourceGenerator } from "../../../../../Scripts/TerraformProvider/Core/ResourceGenerator";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * A new incoming call escalation rule rings for 20 seconds, wherever it is
 * created: the dashboard's form, the API and Terraform. The API and the
 * Terraform provider take the default from the model's column, so these
 * read the real OpenAPI spec, the real provider generator and the
 * dashboard's Developer pages, and hold each to the one default
 * (IncomingCallRingTime) - the way a reader of the API reference or a
 * Terraform user meets it.
 *
 * Rules made when the default was 30 keep their 30. For Terraform that has a
 * consequence the PR states plainly: the provider plans its default for an
 * attribute a configuration leaves out, so a configuration without
 * escalate_after_seconds plans 30 -> 20 for such a rule once the provider is
 * upgraded. The Developer pages write escalate_after_seconds = 30 into the
 * configuration they generate for one, so copying it keeps the rule as it is.
 */

const PREVIOUS_DEFAULT_RING_SECONDS: number = 30;

const TABLE_NAME: string = "IncomingCallPolicyEscalationRule";
const TERRAFORM_TYPE: string = "oneuptime_incoming_call_policy_escalation_rule";
const API_PATH: string = "/incoming-call-policy-escalation-rule";

const RULE_ID: string = "5c4e2d1a-0000-4000-8000-0000000000e1";
const POLICY_ID: string = "5c4e2d1a-0000-4000-8000-0000000000e2";
const SCHEDULE_ID: string = "5c4e2d1a-0000-4000-8000-0000000000e3";

let spec: JSONObject;
let provider: TerraformResource;

function schemaProperty(schemaName: string, property: string): JSONObject {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;
  const schema: JSONObject | undefined = schemas[schemaName] as
    | JSONObject
    | undefined;

  expect(schema).toBeDefined();

  return ((schema as JSONObject)["properties"] as JSONObject)[
    property
  ] as JSONObject;
}

function requiredOf(schemaName: string): Array<string> {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;

  return (((schemas[schemaName] as JSONObject)["required"] as
    | Array<string>
    | undefined) || []) as Array<string>;
}

beforeAll(() => {
  spec = OpenAPIUtil.generateOpenAPISpec();

  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(spec as never);

  const found: TerraformResource | undefined = parser
    .getResources()
    .find((resource: TerraformResource): boolean => {
      return `oneuptime_${resource.name}` === TERRAFORM_TYPE;
    });

  expect(found).toBeDefined();
  provider = found as TerraformResource;
});

describe("the API", () => {
  test("creates a rule without a ring time at 20 seconds", () => {
    const property: JSONObject = schemaProperty(
      `${TABLE_NAME}CreateSchema`,
      "escalateAfterSeconds",
    );

    expect(property["default"]).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
    expect(property["default"]).toBe(20);
    // Left out is allowed: the database fills the default in.
    expect(requiredOf(`${TABLE_NAME}CreateSchema`)).not.toContain(
      "escalateAfterSeconds",
    );
  });

  test("documents what the number does, its default and Twilio's limits", () => {
    const description: string = String(
      schemaProperty(`${TABLE_NAME}CreateSchema`, "escalateAfterSeconds")[
        "description"
      ] || "",
    );

    expect(description).toContain(
      "How long, in seconds, the phone rings before the call moves on to the next rule.",
    );
    expect(description).toContain(
      `${DEFAULT_INCOMING_CALL_RING_SECONDS} when left out`,
    );
    expect(description).toContain(String(MIN_INCOMING_CALL_RING_SECONDS));
    expect(description).toContain(String(MAX_INCOMING_CALL_RING_SECONDS));
    expect(description).not.toContain(String(PREVIOUS_DEFAULT_RING_SECONDS));
  });

  test("still lets an update set any ring time, 30 included", () => {
    const property: JSONObject = schemaProperty(
      `${TABLE_NAME}UpdateSchema`,
      "escalateAfterSeconds",
    );

    expect(property).toBeDefined();
    expect(requiredOf(`${TABLE_NAME}UpdateSchema`)).not.toContain(
      "escalateAfterSeconds",
    );
  });
});

describe("the Terraform provider", () => {
  test("plans 20 seconds for a rule whose configuration leaves the ring time out", () => {
    const attribute: TerraformAttribute | undefined =
      provider.schema["escalate_after_seconds"];

    expect(attribute).toBeDefined();
    expect(attribute?.type).toBe("number");
    expect(attribute?.default).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
    expect(attribute?.default).toBe(20);
    expect(attribute?.required).toBe(false);
    expect(attribute?.optional).toBe(true);
  });

  test("changes a rule's ring time in place, without replacing the rule", () => {
    expect(provider.schema["escalate_after_seconds"]?.forceNew).toBe(false);
  });

  test("generates a Go schema whose default is 20", async () => {
    const outputDir: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "incoming-call-ring-time-provider-"),
    );

    try {
      // The spec, cut down to this one resource's endpoints.
      const paths: JSONObject = spec["paths"] as JSONObject;
      const onlyRule: JSONObject = {
        ...spec,
        paths: Object.fromEntries(
          Object.entries(paths).filter(([route]: [string, unknown]) => {
            return route.startsWith(API_PATH);
          }),
        ),
      };

      await new ResourceGenerator(
        {
          outputDir,
          providerName: "oneuptime",
          providerVersion: "14.0.0",
          goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
        },
        onlyRule as unknown as OpenAPISpec,
      ).generateResources();

      const go: string = fs.readFileSync(
        path.join(
          outputDir,
          "internal/provider/resource_incoming_call_policy_escalation_rule.go",
        ),
        "utf-8",
      );

      const attributeStart: number = go.indexOf('"escalate_after_seconds":');
      expect(attributeStart).toBeGreaterThan(-1);

      const attribute: string = go.slice(
        attributeStart,
        go.indexOf("},", go.indexOf("PlanModifiers", attributeStart)),
      );

      expect(attribute).toContain(
        "Default: numberdefault.StaticBigFloat(big.NewFloat(20))",
      );
      expect(attribute).not.toContain("big.NewFloat(30)");
      expect(attribute).toContain("Optional: true");
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe("the dashboard's Developer pages", () => {
  test("know the provider's default", () => {
    const descriptor: TerraformAttributeDescriptor | undefined =
      getTerraformAttribute(
        IncomingCallPolicyEscalationRule,
        "escalateAfterSeconds",
      );

    expect(getTerraformTypeName(IncomingCallPolicyEscalationRule)).toBe(
      TERRAFORM_TYPE,
    );
    expect(descriptor?.defaultValue).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
    expect(descriptor?.attributeName).toBe("escalate_after_seconds");
  });

  test("leave a 20 second rule's ring time to the default in the configuration they write", () => {
    const hcl: string = getTerraformResourceConfig({
      modelType: IncomingCallPolicyEscalationRule,
      json: {
        _id: RULE_ID,
        incomingCallPolicyId: POLICY_ID,
        onCallDutyPolicyScheduleId: SCHEDULE_ID,
        name: "On-call engineer",
        escalateAfterSeconds: 20,
      },
    })!.resourceHcl;

    expect(hcl).not.toContain("escalate_after_seconds");
  });

  test("pin a rule made when the default was 30 to its 30, so applying the configuration keeps it", () => {
    const hcl: string = getTerraformResourceConfig({
      modelType: IncomingCallPolicyEscalationRule,
      json: {
        _id: RULE_ID,
        incomingCallPolicyId: POLICY_ID,
        onCallDutyPolicyScheduleId: SCHEDULE_ID,
        name: "On-call engineer",
        escalateAfterSeconds: 30,
      },
    })!.resourceHcl;

    expect(hcl).toMatch(/escalate_after_seconds\s*=\s*30\b/);
  });

  test("show recipes that ring for the default, and say so", () => {
    const recipes: Array<DeveloperDocsRecipe> =
      DEVELOPER_DOCS_PROFILES[new IncomingCallPolicy().tableName as string]
        ?.recipes || [];

    const ringFields: Array<DeveloperDocsField> = recipes.flatMap(
      (recipe: DeveloperDocsRecipe): Array<DeveloperDocsField> => {
        return recipe.blocks.flatMap(
          (block: DeveloperDocsRecipeBlock): Array<DeveloperDocsField> => {
            return block.fields.filter((field: DeveloperDocsField): boolean => {
              return field.column === "escalateAfterSeconds";
            });
          },
        );
      },
    );

    expect(ringFields.length).toBeGreaterThan(0);

    for (const field of ringFields) {
      expect(field.value).toEqual({
        kind: "literal",
        value: DEFAULT_INCOMING_CALL_RING_SECONDS,
      });
    }

    for (const recipe of recipes) {
      expect(recipe.description || "").not.toContain(
        `${PREVIOUS_DEFAULT_RING_SECONDS} seconds`,
      );
    }

    expect(
      recipes.some((recipe: DeveloperDocsRecipe): boolean => {
        return (recipe.description || "").includes(
          `for ${DEFAULT_INCOMING_CALL_RING_SECONDS} seconds before the next rule`,
        );
      }),
    ).toBe(true);
  });
});
