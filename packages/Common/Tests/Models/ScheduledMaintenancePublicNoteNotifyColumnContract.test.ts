import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import ScheduledMaintenancePublicNote from "../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import { JSONObject } from "../../Types/JSON";
import { ModelSchema } from "../../Utils/Schema/ModelSchema";
import { SafeParseReturnType, ZodObject, ZodRawShape, ZodTypeAny } from "zod";

/*
 * What the published API says about "notify subscribers" on a new scheduled
 * maintenance public note.
 *
 * When a create leaves the flag out, the server takes it from the scheduled
 * maintenance event: on for an event whose subscribers were told it was
 * created, off for one created quietly. The OpenAPI spec, the MCP tools and
 * the Terraform provider are all generated from this column's metadata, so a
 * fixed `default: true` there would be wrong for quiet events - and the
 * Terraform provider turns a spec default into a value it always sends,
 * which would bypass the event's setting entirely.
 *
 * The column keeps `example: true`. That is only a sample value for readers
 * of the spec, not a default, so these tests check for `default` only.
 */

const COLUMN: string = "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";

function getGeneratedCreateSchema(): JSONObject {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  registry.register(
    "ScheduledMaintenancePublicNoteCreate",
    ModelSchema.getCreateModelSchema({
      modelType: ScheduledMaintenancePublicNote,
    }),
  );

  const document: JSONObject = new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents() as unknown as JSONObject;

  return ((document["components"] as JSONObject)["schemas"] as JSONObject)[
    "ScheduledMaintenancePublicNoteCreate"
  ] as JSONObject;
}

describe("ScheduledMaintenancePublicNote notify-on-create column contract", () => {
  const note: ScheduledMaintenancePublicNote =
    new ScheduledMaintenancePublicNote();
  const metadata: TableColumnMetadata = note.getTableColumnMetadata(COLUMN);

  test("declares no fixed default, because the default depends on the event", () => {
    expect(metadata.defaultValue).toBeUndefined();
  });

  test("stays optional on create, so leaving it out is allowed", () => {
    expect(note.isDefaultValueColumn(COLUMN)).toBe(true);
    expect(metadata.required).toBeFalsy();
  });

  test("describes the event-based default for API readers", () => {
    expect(metadata.description).toContain("If left out");
    expect(metadata.description).toContain(
      "follows the scheduled maintenance event",
    );
  });

  test("a new note object does not start with the flag set", () => {
    expect(
      new ScheduledMaintenancePublicNote()
        .shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBeUndefined();
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
      modelType: ScheduledMaintenancePublicNote,
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
