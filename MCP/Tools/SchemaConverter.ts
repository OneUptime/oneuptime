/**
 * Schema Converter
 * Converts Zod schemas to JSON Schema format for MCP tools
 */

import { JSONSchemaProperty } from "../Types/McpTypes";
import { ModelSchemaType } from "Common/Utils/Schema/ModelSchema";
import { AnalyticsModelSchemaType } from "Common/Utils/Schema/AnalyticsModelSchema";

// Type for Zod field definition
interface ZodFieldDef {
  typeName?: string;
  innerType?: ZodField;
  description?: string;
  openapi?: {
    metadata?: OpenApiMetadata;
  };
}

// Type for Zod field
interface ZodField {
  _def?: ZodFieldDef;
}

// Type for OpenAPI metadata
interface OpenApiMetadata {
  type?: string;
  description?: string;
  example?: unknown;
  format?: string;
  default?: unknown;
  items?: JSONSchemaProperty;
}

// Type for Zod schema with shape
interface ZodSchemaWithShape {
  _def?: {
    shape?: () => Record<string, ZodField>;
  };
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
    const schemaWithShape: ZodSchemaWithShape =
      zodSchema as unknown as ZodSchemaWithShape;
    const shapeFunction: (() => Record<string, ZodField>) | undefined =
      schemaWithShape._def?.shape;

    if (!shapeFunction) {
      return createEmptySchema();
    }

    const shape: Record<string, ZodField> = shapeFunction();
    const properties: Record<string, JSONSchemaProperty> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const { property, isRequired } = convertZodField(key, value);
      properties[key] = property;

      if (isRequired) {
        required.push(key);
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
 * Convert a single Zod field to JSON Schema property
 */
function convertZodField(
  key: string,
  zodField: ZodField,
): { property: JSONSchemaProperty; isRequired: boolean } {
  // Handle ZodOptional fields by looking at the inner type
  let actualField: ZodField = zodField;
  let isOptional: boolean = false;

  if (zodField._def?.typeName === "ZodOptional") {
    actualField = zodField._def.innerType || zodField;
    isOptional = true;
  }

  // Extract OpenAPI metadata
  const openApiMetadata: OpenApiMetadata | undefined =
    actualField._def?.openapi?.metadata || zodField._def?.openapi?.metadata;

  // Clean up description
  const rawDescription: string =
    zodField._def?.description ||
    openApiMetadata?.description ||
    `${key} field`;
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
    isRequired: !isOptional,
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
