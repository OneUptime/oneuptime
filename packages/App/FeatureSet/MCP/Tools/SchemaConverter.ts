/**
 * Schema Converter
 * Converts Zod schemas to JSON Schema format for MCP tools
 */

import { JSONSchemaProperty } from "../Types/McpTypes";
import { ModelSchemaType } from "Common/Utils/Schema/ModelSchema";
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
  zodSchema: ModelSchemaType,
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

  /*
   * Examples stay out: every client pays for them on every connection, and
   * almost all of them only repeat the type. A typed value is the exception,
   * as its example is the only place that says what the API reads (a date is
   * {"_type": "DateTime", "value": ...}), so that shape is kept as schema.
   */
  const typedValueProperties: Record<string, JSONSchemaProperty> | undefined =
    getTypedValueProperties(metadata.example);

  if (typedValueProperties) {
    property.properties = typedValueProperties;
    property.required = Object.keys(typedValueProperties);
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
 * The fields of a typed value such as {"_type": "Color", "value": "#ff0000"},
 * read from its example. Nothing for an example of any other shape.
 */
function getTypedValueProperties(
  example: unknown,
): Record<string, JSONSchemaProperty> | undefined {
  if (!example || typeof example !== "object" || Array.isArray(example)) {
    return undefined;
  }

  const typedValue: { _type?: unknown; value?: unknown } = example as {
    _type?: unknown;
    value?: unknown;
  };

  if (typeof typedValue._type !== "string" || typedValue.value === undefined) {
    return undefined;
  }

  return {
    _type: { type: "string", enum: [typedValue._type] },
    value: { type: typeof typedValue.value },
  };
}

/**
 * The fields of a tool without what each one means, but for the fields named.
 * Names, types, enums and defaults stay, so a client can still check a call.
 */
export function withoutFieldDescriptions(
  properties: Record<string, JSONSchemaProperty>,
  fieldsToKeep: Array<string> = [],
): Record<string, JSONSchemaProperty> {
  const compacted: Record<string, JSONSchemaProperty> = {};

  for (const [name, property] of Object.entries(properties)) {
    const compactedProperty: JSONSchemaProperty = { ...property };

    if (!fieldsToKeep.includes(name)) {
      delete compactedProperty.description;
    }

    compacted[name] = compactedProperty;
  }

  return compacted;
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
