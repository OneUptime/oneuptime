import Zod, { ZodSchema } from "./Zod";
import { ObjectType } from "../../Types/JSON";
import type { ZodType } from "zod";

/*
 * The API schemas of Common's value Types: how a column of each type looks
 * in the OpenAPI document, and so in the API reference, the MCP tools and
 * the Terraform provider. ModelSchema and AnalyticsModelSchema read them
 * here, column by column.
 *
 * They used to be a static getSchema() on each Type (Email.getSchema(),
 * ObjectID.getSchema() ...). Every frontend loads those Types - the
 * Dashboard, Accounts, the Admin Dashboard, status pages and public
 * dashboards, on every page - and no browser reads a schema, so each
 * frontend carried zod and zod-to-openapi for nothing: about 111 KB (33 KB
 * gzipped) of the chunks every page loads. Here, beside the schema builders
 * that use them, only the server loads them. MonitorSchemas.ts does the same
 * for the monitor Types, and Tests/Utils/Schema/ZodOutOfBrowserGuard keeps
 * zod and these modules out of everything a frontend loads.
 *
 * Each schema takes a value of its Type as the API takes it - the
 * { _type, value } its toJSON() writes, or, for an ID, the UUID itself - and
 * its example is one such value (Tests/Utils/Schema/TypeSchemas holds both).
 * Each call builds a new schema, as getSchema() did: a model's schema owns
 * the schemas of its columns.
 */

// A unique identifier: a column of type ObjectID, as the API reads and writes it.
export function getObjectIDSchema(): ZodType {
  return Zod.string().openapi({
    type: "string",
    example: "123e4567-e89b-12d3-a456-426614174000",
    format: "uuid",
    description: "A unique identifier for an object, represented as a UUID.",
  });
}

export function getEmailSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.Email),
    value: Zod.string().email().openapi({
      type: "string",
      format: "email",
      example: "user@example.com",
    }),
  }).openapi({
    type: "object",
    description: "Email object",
    example: { _type: ObjectType.Email, value: "user@example.com" },
  });
}

export function getPhoneSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.Phone),
    value: Zod.string().openapi({
      type: "string",
      example: "+1-555-123-4567",
    }),
  }).openapi({
    type: "object",
    description: "Phone object",
    example: { _type: ObjectType.Phone, value: "+1-555-123-4567" },
  });
}

export function getNameSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.Name),
    value: Zod.string().openapi({
      type: "string",
      example: "John Doe",
    }),
  }).openapi({
    type: "object",
    description: "Name object",
    example: { _type: ObjectType.Name, value: "John Doe" },
  });
}

export function getDomainSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.Domain),
    value: Zod.string().openapi({
      type: "string",
      example: "example.com",
    }),
  }).openapi({
    type: "object",
    description: "Domain object",
    example: { _type: ObjectType.Domain, value: "example.com" },
  });
}

export function getVersionSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.Version),
    value: Zod.string().openapi({
      type: "string",
      example: "1.0.0",
    }),
  }).openapi({
    type: "object",
    description: "Version object",
    example: { _type: ObjectType.Version, value: "1.0.0" },
  });
}

export function getIPSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.IP),
    value: Zod.string().openapi({
      type: "string",
      example: "192.168.1.1",
    }),
  }).openapi({
    type: "object",
    description: "IP object",
    example: { _type: ObjectType.IP, value: "192.168.1.1" },
  });
}

export function getPortSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.Port),
    value: Zod.number().int().min(0).max(65535).openapi({
      type: "number",
      example: 8080,
    }),
  }).openapi({
    type: "object",
    description: "Port object",
    example: { _type: ObjectType.Port, value: 8080 },
  });
}

export function getColorSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.Color),
    value: Zod.string().openapi({
      type: "string",
      example: "#ff0000",
    }),
  }).openapi({
    type: "object",
    description: "Color object",
    example: { _type: ObjectType.Color, value: "#ff0000" },
  });
}

// A date and time (OneUptimeDate), as the API reads and writes it.
export function getDateSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.DateTime),
    value: Zod.string().openapi({
      type: "string",
      example: "2023-10-01T12:00:00Z",
    }),
  }).openapi({
    type: "object",
    description: "A date time object.",
    /*
     * Machine-readable marker so spec consumers (e.g. the Terraform provider
     * generator) can treat this wrapper as an RFC3339 timestamp instead of an
     * opaque object.
     */
    "x-oneuptime-type": ObjectType.DateTime,
    example: {
      _type: ObjectType.DateTime,
      value: "2023-10-01T12:00:00Z",
    },
  });
}
