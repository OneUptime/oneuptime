/**
 * Schema Converter
 * Converts Zod schemas to JSON Schema format for MCP tools
 */

import { JSONSchemaProperty } from "../Types/McpTypes";
import { ModelSchemaType } from "Common/Utils/Schema/ModelSchema";
import { AnalyticsModelSchemaType } from "Common/Utils/Schema/AnalyticsModelSchema";
import { getSchemaFields, SchemaField } from "Common/Utils/Schema/SchemaFields";

// The OpenAPI metadata a property is built from.
interface OpenApiMetadata {
  type?: string;
  description?: string;
  example?: unknown;
  format?: string;
  default?: unknown;
  items?: JSONSchemaProperty;
  enum?: Array<string | number | boolean>;
}

// Result type for schema conversion
export interface ZodToJsonSchemaResult {
  type: string;
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties: boolean;
}

/**
 * Convert a Zod schema to JSON Schema format for MCP tools
 */
export function zodToJsonSchema(
  zodSchema: ModelSchemaType | AnalyticsModelSchemaType,
): ZodToJsonSchemaResult {
  try {
    /*
     * Read through Common's SchemaFields, never zod's internals: a zod
     * upgrade changes those (zod 4 has none of zod 3's _def.shape() or
     * _def.typeName), and every tool would quietly lose its fields.
     */
    const fields: Array<SchemaField> = getSchemaFields(zodSchema);
    const properties: Record<string, JSONSchemaProperty> = {};
    const required: string[] = [];

    for (const field of fields) {
      const { property, isRequired } = convertSchemaField(field);
      properties[field.name] = property;

      if (isRequired) {
        required.push(field.name);
      }
    }

    const result: ZodToJsonSchemaResult = {
      type: "object",
      properties,
      additionalProperties: false,
    };

    if (required.length > 0) {
      result.required = required;
    }

    return result;
  } catch {
    return createEmptySchema();
  }
}

/**
 * Convert a single schema field to JSON Schema property
 */
function convertSchemaField(field: SchemaField): {
  property: JSONSchemaProperty;
  isRequired: boolean;
} {
  const key: string = field.name;

  /*
   * For an optional field, the metadata of the value inside .optional(),
   * else the field's own.
   */
  const openApiMetadata: OpenApiMetadata | undefined = field.openApi as
    | OpenApiMetadata
    | undefined;

  // Clean up description
  const rawDescription: string =
    field.description || openApiMetadata?.description || `${key} field`;
  const cleanDescription: string = cleanFieldDescription(rawDescription);

  let property: JSONSchemaProperty;

  if (openApiMetadata) {
    property = buildPropertyFromMetadata(
      openApiMetadata,
      key,
      cleanDescription,
    );
  } else {
    // Fallback for fields without OpenAPI metadata
    property = {
      type: "string",
      description: cleanDescription,
    };
  }

  return {
    property,
    isRequired: !field.isOptional,
  };
}

/**
 * Build JSON Schema property from OpenAPI metadata
 */
function buildPropertyFromMetadata(
  metadata: OpenApiMetadata,
  key: string,
  description: string,
): JSONSchemaProperty {
  const property: JSONSchemaProperty = {
    type: metadata.type || "string",
    description,
  };

  // Add optional fields if present
  if (metadata.example !== undefined) {
    (property as JSONSchemaProperty & { example: unknown }).example =
      metadata.example;
  }

  if (metadata.format) {
    property.format = metadata.format;
  }

  if (metadata.default !== undefined) {
    property.default = metadata.default;
  }

  // Preserve enums (e.g. sort order ASC/DESC) so agents see valid values
  if (metadata.enum && metadata.enum.length > 0) {
    property.enum = metadata.enum;
  }

  // Handle array types
  if (metadata.type === "array") {
    property.items = metadata.items || {
      type: "string",
      description: `${key} item`,
    };
  }

  return property;
}

/**
 * Clean up description by removing permission information
 */
export function cleanFieldDescription(description: string): string {
  if (!description) {
    return description;
  }

  // Remove everything after ". Permissions -"
  const permissionsIndex: number = description.indexOf(". Permissions -");
  if (permissionsIndex !== -1) {
    const beforeText: string = description.substring(0, permissionsIndex);
    return addPeriodIfNeeded(beforeText);
  }

  // Handle cases where it starts with "Permissions -" without a preceding sentence
  const permissionsStartIndex: number = description.indexOf("Permissions -");
  if (permissionsStartIndex !== -1) {
    const beforePermissions: string = description
      .substring(0, permissionsStartIndex)
      .trim();
    if (beforePermissions && beforePermissions.length > 0) {
      return addPeriodIfNeeded(beforePermissions);
    }
  }

  return description;
}

/**
 * Add period to text if it doesn't end with punctuation
 */
function addPeriodIfNeeded(text: string): string {
  if (!text) {
    return text;
  }

  const punctuation: string[] = [".", "!", "?"];
  const lastChar: string = text.charAt(text.length - 1);

  if (punctuation.includes(lastChar)) {
    return text;
  }

  return text + ".";
}

/**
 * Create an empty schema result
 */
function createEmptySchema(): ZodToJsonSchemaResult {
  return {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
}

/**
 * Sanitize a name to be valid for MCP tool names
 * MCP tool names can only contain [a-z0-9_-]
 */
export function sanitizeToolName(name: string): string {
  return (
    name
      // Convert camelCase to snake_case
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .toLowerCase()
      // Replace non-alphanumeric characters with underscores
      .replace(/[^a-z0-9]/g, "_")
      // Replace multiple consecutive underscores with single underscore
      .replace(/_+/g, "_")
      // Remove leading/trailing underscores
      .replace(/^_|_$/g, "")
  );
}
