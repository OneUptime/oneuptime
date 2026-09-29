/**
 * SchemaConverter unit tests.
 *
 * Covers enum propagation from zod-openapi metadata into JSON Schema
 * properties (so agents see valid values like ASC/DESC), description
 * cleaning, and tool name sanitization.
 */

import { describe, it, expect } from "@jest/globals";
import {
  zodToJsonSchema,
  cleanFieldDescription,
  sanitizeToolName,
  ZodToJsonSchemaResult,
} from "../Tools/SchemaConverter";
import { ModelSchemaType } from "Common/Utils/Schema/ModelSchema";

/**
 * Build a minimal object matching the ZodField shape the converter reads
 * (_def.openapi.metadata) without depending on zod internals.
 */
function makeFakeSchema(shape: Record<string, unknown>): ModelSchemaType {
  return {
    _def: {
      shape: (): Record<string, unknown> => {
        return shape;
      },
    },
  } as unknown as ModelSchemaType;
}

describe("SchemaConverter", () => {
  describe("zodToJsonSchema enum propagation", () => {
    it("copies enum values from openapi metadata on optional fields", () => {
      const schema: ModelSchemaType = makeFakeSchema({
        createdAt: {
          _def: {
            typeName: "ZodOptional",
            innerType: { _def: {} },
            openapi: {
              metadata: {
                type: "string",
                enum: ["ASC", "DESC"],
                description: "Sort order for createdAt field",
              },
            },
          },
        },
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["createdAt"]?.type).toBe("string");
      expect(result.properties["createdAt"]?.enum).toEqual(["ASC", "DESC"]);
      // Optional fields must not be listed as required.
      expect(result.required).toBeUndefined();
    });

    it("copies enum values on required fields and marks them required", () => {
      const schema: ModelSchemaType = makeFakeSchema({
        status: {
          _def: {
            openapi: {
              metadata: {
                type: "string",
                enum: ["internal", "public"],
              },
            },
          },
        },
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["status"]?.enum).toEqual(["internal", "public"]);
      expect(result.required).toEqual(["status"]);
    });

    it("omits enum when metadata has an empty enum array", () => {
      const schema: ModelSchemaType = makeFakeSchema({
        name: {
          _def: {
            openapi: {
              metadata: {
                type: "string",
                enum: [],
              },
            },
          },
        },
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["name"]?.enum).toBeUndefined();
    });

    it("falls back to a string property when no metadata exists", () => {
      const schema: ModelSchemaType = makeFakeSchema({
        title: { _def: {} },
      });

      const result: ZodToJsonSchemaResult = zodToJsonSchema(schema);

      expect(result.properties["title"]?.type).toBe("string");
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
