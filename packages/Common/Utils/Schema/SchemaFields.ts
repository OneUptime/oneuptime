import { getOpenApiMetadata } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ZodSchema } from "./Zod";

/*
 * The fields of an object schema ModelSchema or AnalyticsModelSchema built,
 * read through zod's and zod-to-openapi's public API.
 *
 * The MCP tools turn the model schemas into the JSON Schema an agent sees,
 * and they used to read zod's internals to do it (_def.shape(),
 * _def.typeName === "ZodOptional", _def.openapi.metadata). Those are zod 3's
 * and zod-to-openapi 7's, and zod 4 has none of them: the MCP tools would have
 * listed no fields at all. Reading the schemas here, beside where they are
 * made, keeps the next zod upgrade to one package.
 */

// What .openapi() said about a field: type, example, format, enum and so on.
export type SchemaFieldOpenApi = ReturnType<typeof getOpenApiMetadata>;

export interface SchemaField {
  name: string;

  // The field may be left out: its schema is .optional() at the top.
  isOptional: boolean;

  /*
   * The field's own documentation: what .describe() or .openapi({
   * description }) said about the field itself - ModelSchema writes the
   * column's description into both - else what its value's type says (an id
   * column with no description of its own: "A unique identifier ..."), if
   * anything.
   *
   * zod-to-openapi's .openapi() makes a new schema, and the new schema keeps
   * a .describe() text only in its OpenAPI metadata, so that is read too.
   */
  description: string | undefined;

  /*
   * The OpenAPI metadata of the field's value: for an optional field, what
   * the schema inside .optional() says, else the field's own - and nothing
   * when neither says anything.
   */
  openApi: SchemaFieldOpenApi | undefined;
}

function openApiOf(schema: z.ZodType): SchemaFieldOpenApi | undefined {
  const metadata: SchemaFieldOpenApi = getOpenApiMetadata(schema);

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function getSchemaFieldNames(schema: ZodSchema): Array<string> {
  return Object.keys(schema.shape);
}

export function getSchemaFields(schema: ZodSchema): Array<SchemaField> {
  return Object.entries(schema.shape).map(
    ([name, field]: [string, z.ZodType]): SchemaField => {
      const isOptional: boolean = field instanceof z.ZodOptional;
      const value: z.ZodType = isOptional
        ? (field as z.ZodOptional<z.ZodType>).unwrap()
        : field;

      const description: unknown =
        field.description ?? getOpenApiMetadata(field).description;

      return {
        name: name,
        isOptional: isOptional,
        description: typeof description === "string" ? description : undefined,
        openApi: openApiOf(value) || openApiOf(field),
      };
    },
  );
}
