import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import IncidentPublicNote from "../../Models/DatabaseModels/IncidentPublicNote";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import { JSONObject } from "../../Types/JSON";
import { ModelSchema } from "../../Utils/Schema/ModelSchema";
import { SafeParseReturnType, ZodObject, ZodRawShape, ZodTypeAny } from "zod";

/*
 * What the published API says about "notify subscribers" on a new incident
 * public note.
 *
 * When a create leaves the flag out, the server takes it from the incident:
 * on for an incident whose subscribers were told it was declared, off for one
 * declared quietly. The OpenAPI spec, the MCP tools and the Terraform
 * provider are all generated from this column's metadata, so a fixed
 * `default: true` there would be wrong for quiet incidents - and the
 * Terraform provider turns a spec default into a value it always sends,
 * which would bypass the incident's setting entirely.
 */

const COLUMN: string = "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";

function getGeneratedCreateSchema(): JSONObject {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  registry.register(
    "IncidentPublicNoteCreate",
    ModelSchema.getCreateModelSchema({ modelType: IncidentPublicNote }),
  );

  const document: JSONObject = new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents() as unknown as JSONObject;

  return ((document["components"] as JSONObject)["schemas"] as JSONObject)[
    "IncidentPublicNoteCreate"
  ] as JSONObject;
}

describe("IncidentPublicNote notify-on-create column contract", () => {
  const note: IncidentPublicNote = new IncidentPublicNote();
  const metadata: TableColumnMetadata = note.getTableColumnMetadata(COLUMN);

  test("declares no fixed default, because the default depends on the incident", () => {
    expect(metadata.defaultValue).toBeUndefined();
  });

  test("stays optional on create, so leaving it out is allowed", () => {
    expect(note.isDefaultValueColumn(COLUMN)).toBe(true);
    expect(metadata.required).toBeFalsy();
  });

  test("describes the incident-based default for API readers", () => {
    expect(metadata.description).toContain("If left out");
    expect(metadata.description).toContain("follows the incident");
  });

  test("the generated create schema publishes the field without a default", () => {
    const property: JSONObject = (
      getGeneratedCreateSchema()["properties"] as JSONObject
    )[COLUMN] as JSONObject;

    expect(property).toBeDefined();
    expect(property["type"]).toBe("boolean");
    expect(property).not.toHaveProperty("default");
  });

  test("the generated create schema does not require the field", () => {
    const required: Array<string> =
      (getGeneratedCreateSchema()["required"] as Array<string> | undefined) ||
      [];

    expect(required).not.toContain(COLUMN);
  });

  test("validating the field when it is left out keeps it unset for the server to fill in", () => {
    const schema: ZodObject<ZodRawShape> = ModelSchema.getCreateModelSchema({
      modelType: IncidentPublicNote,
    }) as unknown as ZodObject<ZodRawShape>;
    const fieldSchema: ZodTypeAny = schema.shape[COLUMN] as ZodTypeAny;

    expect(fieldSchema).toBeDefined();

    const parsed: SafeParseReturnType<unknown, unknown> =
      fieldSchema.safeParse(undefined);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeUndefined();
    expect(fieldSchema.safeParse(false).data).toBe(false);
    expect(fieldSchema.safeParse(true).data).toBe(true);
  });
});
