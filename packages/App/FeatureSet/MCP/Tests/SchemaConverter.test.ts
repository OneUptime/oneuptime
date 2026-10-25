/**
 * SchemaConverter unit tests.
 *
 * Covers how a model schema becomes the JSON Schema an agent sees: enum
 * propagation from zod-openapi metadata (so agents see valid values like
 * ASC/DESC), which fields are required, whose description wins, description
 * cleaning, and tool name sanitization.
 *
 * Every schema here is a real one, made with Common's zod (Utils/Schema/Zod,
 * with zod-to-openapi's .openapi()) or by ModelSchema from a real model. These
 * tests used to hand the converter objects shaped like zod 3's internals
 * (_def.shape(), _def.typeName === "ZodOptional", _def.openapi.metadata);
 * zod 4 has none of them, so those tests kept passing while every MCP tool
 * would have lost its fields. The converter now reads schemas through
 * Common's SchemaFields, and these hold it to what zod 3 produced.
 */

import { describe, it, expect } from "@jest/globals";
import {
  zodToJsonSchema,
  cleanFieldDescription,
  sanitizeToolName,
  ZodToJsonSchemaResult,
} from "../Tools/SchemaConverter";
import { ModelSchema, ModelSchemaType } from "Common/Utils/Schema/ModelSchema";
import {
  AnalyticsModelSchema,
  AnalyticsModelSchemaType,
} from "Common/Utils/Schema/AnalyticsModelSchema";
import Zod from "Common/Utils/Schema/Zod";
import Label from "Common/Models/DatabaseModels/Label";
import Log from "Common/Models/AnalyticsModels/Log";
import { JSONSchemaProperty } from "../Types/McpTypes";

function objectSchema(shape: Record<string, unknown>): ModelSchemaType {
  return Zod.object(
    shape as Parameters<typeof Zod.object>[0],
  ) as unknown as ModelSchemaType;
}

describe("SchemaConverter", () => {
  describe("zodToJsonSchema enum propagation", () => {
    it("copies enum values from openapi metadata on optional fields", () => {
      // The shape BaseSchema.generateSortSchema gives every sortable column.
      const schema: ModelSchemaType = objectSchema({
        createdAt: Zod.enum(["ASC", "DESC"]).optional().openapi({
          type: "string",
          enum: ["ASC", "DESC"],
          description: "Sort order for createdAt field",
          example: "ASC",
        }),
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["createdAt"]).toEqual({
        type: "string",
        description: "Sort order for createdAt field",
        example: "ASC",
        enum: ["ASC", "DESC"],
      });
      // Optional fields must not be listed as required.
      expect(result.required).toBeUndefined();
    });

    it("copies enum values on required fields and marks them required", () => {
      const schema: ModelSchemaType = objectSchema({
        status: Zod.string().openapi({
          type: "string",
          enum: ["internal", "public"],
        }),
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["status"]?.enum).toEqual(["internal", "public"]);
      expect(result.required).toEqual(["status"]);
    });

    it("omits enum when metadata has an empty enum array", () => {
      const schema: ModelSchemaType = objectSchema({
        name: Zod.string().openapi({
          type: "string",
          enum: [],
        }),
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["name"]?.enum).toBeUndefined();
    });

    it("falls back to a string property when no metadata exists", () => {
      const schema: ModelSchemaType = objectSchema({
        title: Zod.any(),
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["title"]).toEqual({
        type: "string",
        description: "title field",
      });
      expect(result.required).toEqual(["title"]);
    });
  });

  describe("zodToJsonSchema reads fields the way ModelSchema writes them", () => {
    it("lists every field of the shape, in order, and nothing else", () => {
      const schema: ModelSchemaType = objectSchema({
        first: Zod.string().openapi({ type: "string" }),
        second: Zod.number().optional().openapi({ type: "number" }),
        third: Zod.boolean().openapi({ type: "boolean" }),
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(Object.keys(result.properties)).toEqual([
        "first",
        "second",
        "third",
      ]);
      expect(result.required).toEqual(["first", "third"]);
      expect(result.type).toBe("object");
      expect(result.additionalProperties).toBe(false);
    });

    it("lets the column's own description win over its type's", () => {
      /*
       * ModelSchema's annotateColumn: .describe() and .openapi({ description
       * }) with the column's words, on top of a type (ObjectID's) that brings
       * a description of its own.
       */
      const schema: ModelSchemaType = objectSchema({
        projectId: Zod.string()
          .openapi({
            type: "string",
            format: "uuid",
            description:
              "A unique identifier for an object, represented as a UUID.",
          })
          .optional()
          .describe("The project this belongs to.")
          .openapi({ description: "The project this belongs to." }),
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["projectId"]).toEqual({
        type: "string",
        format: "uuid",
        description: "The project this belongs to.",
      });
    });

    it("uses the type's description when the column has none", () => {
      const schema: ModelSchemaType = objectSchema({
        ownerId: Zod.string()
          .openapi({
            type: "string",
            description: "A unique identifier for an object.",
          })
          .optional(),
      });

      expect(zodToJsonSchema(schema).properties["ownerId"]?.description).toBe(
        "A unique identifier for an object.",
      );
    });

    it("strips the permission text ModelSchema appends to a description", () => {
      const schema: ModelSchemaType = objectSchema({
        name: Zod.string()
          .describe("The name. Permissions - Create: [Owner], Read: [Member]")
          .openapi({
            type: "string",
            description:
              "The name. Permissions - Create: [Owner], Read: [Member]",
          }),
      });

      expect(zodToJsonSchema(schema).properties["name"]?.description).toBe(
        "The name.",
      );
    });

    it("keeps an array field's items, and gives one without items a string item", () => {
      const schema: ModelSchemaType = objectSchema({
        tags: Zod.array(Zod.string()).openapi({
          type: "array",
          items: { type: "string" },
        }),
        names: Zod.array(Zod.any()).openapi({ type: "array" }),
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["tags"]?.items).toEqual({ type: "string" });
      expect(result.properties["names"]?.items).toEqual({
        type: "string",
        description: "names item",
      });
    });

    it("carries a default and a format from the metadata", () => {
      const schema: ModelSchemaType = objectSchema({
        isEnabled: Zod.boolean()
          .openapi({ type: "boolean", default: true })
          .default(true)
          .optional(),
        secret: Zod.string().openapi({ type: "string", format: "password" }),
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["isEnabled"]).toMatchObject({
        type: "boolean",
        default: true,
      });
      expect(result.properties["secret"]?.format).toBe("password");
      expect(result.required).toEqual(["secret"]);
    });

    it("answers an empty schema, not a throw, for something that is not an object schema", () => {
      const result: ZodToJsonSchemaResult = zodToJsonSchema(
        {} as unknown as ModelSchemaType,
      );

      expect(result).toEqual({
        type: "object",
        properties: {},
        additionalProperties: false,
      });
    });
  });

  describe("a real model's schemas, as the MCP tools hand them to agents", () => {
    /*
     * What these assert is what zod 3 and zod-to-openapi 7 produced for the
     * same model before Common moved to zod 4 (the whole tool list was
     * compared field by field: identical).
     */
    it("a label's create schema: required fields, column descriptions, types, examples and defaults", () => {
      const result: ZodToJsonSchemaResult = zodToJsonSchema(
        ModelSchema.getCreateModelSchema({ modelType: Label }),
      );

      expect(result.required).toEqual(["name", "color"]);
      expect(result.properties["name"]).toEqual({
        type: "string",
        description: "Any friendly name of this object.",
        example: "Example short text",
      });
      // An id column: the column's words win over ObjectID's own.
      expect(result.properties["projectId"]).toEqual({
        type: "string",
        description:
          "ID of your OneUptime Project in which this object belongs.",
        example: "123e4567-e89b-12d3-a456-426614174000",
        format: "uuid",
      });
      expect(result.properties["color"]).toEqual({
        type: "object",
        description: "Color of this resource in Hex (#32a852 for example).",
        example: { _type: "Color", value: "#ff0000" },
      });
      expect(result.properties["isArchived"]).toMatchObject({
        type: "boolean",
        example: true,
        default: false,
      });
      // Server-made fields are not asked for on create.
      expect(result.properties).not.toHaveProperty("_id");
      expect(result.properties).not.toHaveProperty("createdAt");
    });

    it("a label's update schema: every field optional", () => {
      const result: ZodToJsonSchemaResult = zodToJsonSchema(
        ModelSchema.getUpdateModelSchema({ modelType: Label }),
      );

      expect(Object.keys(result.properties)).toEqual(
        expect.arrayContaining(["name", "color", "description"]),
      );
      expect(result.required).toBeUndefined();
    });

    it("a label's sort schema: ASC or DESC for each sortable column", () => {
      const result: ZodToJsonSchemaResult = zodToJsonSchema(
        ModelSchema.getSortModelSchema({ modelType: Label }),
      );
      const createdAt: JSONSchemaProperty | undefined =
        result.properties["createdAt"];

      expect(createdAt).toEqual({
        type: "string",
        description: "Sort order for createdAt field",
        example: "ASC",
        enum: ["ASC", "DESC"],
      });
      expect(result.required).toBeUndefined();
    });

    it("a label's query schema: each column says which operators it takes", () => {
      const result: ZodToJsonSchemaResult = zodToJsonSchema(
        ModelSchema.getQueryModelSchema({ modelType: Label }),
      );

      expect(result.properties["name"]).toEqual({
        type: "object",
        description:
          "Query operators for name field of type Text. Supported operators: EqualTo, NotEqual, IsNull, NotNull, EqualToOrNull, Search, Includes",
        example: { _type: "EqualTo", value: "John Doe" },
      });
    });

    it("a log query schema made without OpenAPI metadata still lists its fields", () => {
      const schema: AnalyticsModelSchemaType =
        AnalyticsModelSchema.getQueryModelSchema({
          modelType: Log,
          disableOpenApiSchema: true,
        });
      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["severityText"]).toEqual({
        type: "string",
        description: "severityText field",
      });
      expect(Object.keys(result.properties).length).toBeGreaterThan(10);
    });
  });

  describe("cleanFieldDescription", () => {
    it("leaves descriptions without permission text untouched", () => {
      expect(cleanFieldDescription("The incident title.")).toBe(
        "The incident title.",
      );
    });

    it("strips '. Permissions -' suffixes and closes the sentence", () => {
      expect(
        cleanFieldDescription(
          "The incident title. Permissions - read: [Owner], create: [Owner]",
        ),
      ).toBe("The incident title.");
    });

    it("strips mid-string 'Permissions -' text", () => {
      expect(
        cleanFieldDescription("Title of the item Permissions - read stuff"),
      ).toBe("Title of the item.");
    });

    it("returns empty input unchanged", () => {
      expect(cleanFieldDescription("")).toBe("");
    });
  });

  describe("sanitizeToolName", () => {
    it("converts camelCase and separators to snake_case", () => {
      expect(sanitizeToolName("ScheduledMaintenance")).toBe(
        "scheduled_maintenance",
      );
      expect(sanitizeToolName("On-Call Duty Policy")).toBe(
        "on_call_duty_policy",
      );
      expect(sanitizeToolName("Incident States")).toBe("incident_states");
    });
  });
});
