import { beforeAll, describe, expect, it } from "@jest/globals";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import { ResourceGenerator } from "../../../../../Scripts/TerraformProvider/Core/ResourceGenerator";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";

/*
 * A MONITOR SECRET'S TYPE IN THE PUBLISHED OPENAPI SPECIFICATION, AND IN THE
 * TERRAFORM PROVIDER GENERATED FROM IT (#9814).
 *
 * OneUptime changes a secret's type only together with a new value, which
 * it reads for the new type (#9760). The provider sends only what changed,
 * so a plan that changed secret_type and kept secret_value sent the type
 * alone, and the apply failed half-way. The spec now says the rule
 * (x-oneuptime-changes-only-with), and the real parser, reading the real
 * spec, has the resource's plan refuse such a change - while the type
 * still changes in place, with no replacement.
 *
 * The whole spec is generated once for the suite: it walks every model.
 */

describe("a monitor secret's type in the OpenAPI specification and the provider", () => {
  let spec: JSONObject;
  let resource: TerraformResource;
  let warnings: Array<string>;

  function propertyOf(schema: string, property: string): JSONObject {
    const schemas: JSONObject = (spec["components"] as JSONObject)[
      "schemas"
    ] as JSONObject;
    const properties: JSONObject = ((schemas[schema] as JSONObject)?.[
      "properties"
    ] || {}) as JSONObject;

    return (properties[property] || {}) as JSONObject;
  }

  beforeAll(() => {
    spec = OpenAPIUtil.generateOpenAPISpec();

    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(spec as unknown as OpenAPISpec);
    resource = parser
      .getResources()
      .find((candidate: TerraformResource): boolean => {
        return candidate.name === "monitor_secret";
      }) as TerraformResource;
    warnings = parser.warnings;
  });

  it("the spec says the type changes only with a new value, in every schema of the secret", () => {
    for (const schema of [
      "MonitorSecretCreateSchema",
      "MonitorSecretUpdateSchema",
      "MonitorSecretReadSchema",
      "MonitorSecret",
    ]) {
      expect([
        schema,
        propertyOf(schema, "secretType")["x-oneuptime-changes-only-with"],
      ]).toEqual([schema, "secretValue"]);
    }

    // Both are written by an update.
    expect(propertyOf("MonitorSecretUpdateSchema", "secretType")).toEqual(
      expect.objectContaining({ enum: ["Text", "TOTP"] }),
    );
    expect(propertyOf("MonitorSecretUpdateSchema", "secretValue")).toEqual(
      expect.objectContaining({ "x-oneuptime-secret": true }),
    );
  });

  it("the provider's secret_type changes only with secret_value, in place", () => {
    expect(resource).toBeDefined();

    const secretType: TerraformAttribute = resource.schema["secret_type"]!;
    const secretValue: TerraformAttribute = resource.schema["secret_value"]!;

    expect(secretType.changesOnlyWith).toBe("secret_value");
    expect(secretType.forceNew).toBe(false);
    expect(secretType.description).toContain(
      OpenAPIParser.describeChangesOnlyWith("secret_type", "secret_value"),
    );

    expect(secretValue.changesOnlyWith).toBeUndefined();
    expect(secretValue.forceNew).toBe(false);
    expect(secretValue.sensitive).toBe(true);

    expect(
      warnings.filter((warning: string): boolean => {
        return warning.includes("changes only together");
      }),
    ).toEqual([]);
  });

  it("only the monitor secret's type changes together with another attribute", () => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(spec as unknown as OpenAPISpec);

    const together: Array<string> = [];

    for (const candidate of parser.getResources()) {
      for (const [
        name,
        companion,
      ] of ResourceGenerator.getChangedTogetherAttributes(candidate)) {
        together.push(`${candidate.name}.${name} with ${companion}`);
      }
    }

    expect(together).toEqual(["monitor_secret.secret_type with secret_value"]);
  });
});
