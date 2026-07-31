import { OpenAPISpec } from "../Core/Types";

/*
 * A miniature but shape-accurate OneUptime OpenAPI spec, mirroring what
 * Common/Server/Utils/OpenAPI.ts emits:
 *  - operationIds: create<Table>/get<Table>/update<Table>/delete<Table>/
 *    list<Table>/count<Table>
 *  - request bodies wrap the payload in {data: <Schema>}
 *  - responses wrap the payload in {data: <Schema>}
 *  - DB dates are {_type: DateTime, value} wrappers with x-oneuptime-type
 *  - entity arrays have object items with an _id property
 *
 * Models:
 *  - Monitor: full CRUD + list/count. Exercises enums, dates, entity/scalar
 *    arrays, complex objects, write-only secrets, immutable fields, computed
 *    server-managed fields.
 *  - EmailLog: list/count only (a resource must not be generated).
 *  - File: create + delete only (no read/update endpoints).
 */

const dateTimeWrapper: any = {
  type: "object",
  description: "A date time object.",
  "x-oneuptime-type": "DateTime",
  properties: {
    _type: { type: "string", enum: ["DateTime"] },
    value: { type: "string", example: "2023-10-01T12:00:00Z" },
  },
  example: { _type: "DateTime", value: "2023-10-01T12:00:00Z" },
};

const monitorCreateSchema: any = {
  type: "object",
  description: "Create schema for Monitor model. Create",
  required: ["name", "monitorType"],
  properties: {
    name: { type: "string", description: "Name of the monitor" },
    description: { type: "string", description: "Description" },
    monitorType: {
      type: "string",
      enum: ["Manual", "Website", "Ping"],
      example: "Manual",
      description: "Type of monitor",
    },
    disableMonitoringDatetime: dateTimeWrapper,
    labels: {
      type: "array",
      "x-ordered": false,
      items: {
        type: "object",
        properties: {
          _id: { type: "string", format: "uuid" },
        },
      },
      description: "Attached labels",
    },
    tags: {
      type: "array",
      "x-ordered": false,
      items: { type: "string" },
      description: "Plain string tags",
    },
    monitorSteps: {
      type: "object",
      description: "Monitor steps configuration",
    },
    secretToken: {
      type: "string",
      format: "password",
      description: "Write-only secret",
    },
    immutableRegion: {
      type: "string",
      description: "Cannot change after create",
    },
    projectId: { type: "string", description: "Project id" },
  },
};

// Update schema: no immutableRegion (immutable), no secretToken rotation.
const monitorUpdateSchema: any = {
  type: "object",
  description: "Update schema for Monitor model. Update",
  properties: {
    name: { type: "string", description: "Name of the monitor" },
    description: { type: "string", description: "Description" },
    monitorType: {
      type: "string",
      enum: ["Manual", "Website", "Ping"],
      description: "Type of monitor",
    },
    disableMonitoringDatetime: dateTimeWrapper,
    labels: monitorCreateSchema.properties.labels,
    tags: monitorCreateSchema.properties.tags,
    monitorSteps: { type: "object", description: "Monitor steps" },
  },
};

/*
 * The full model schema, used by get-item responses. Includes server-managed
 * (readOnly) fields; excludes the write-only secret.
 */
const monitorModelSchema: any = {
  type: "object",
  description: "Monitor model",
  properties: {
    _id: { type: "string", format: "uuid" },
    name: { type: "string", description: "Name of the monitor" },
    description: { type: "string" },
    monitorType: { type: "string", enum: ["Manual", "Website", "Ping"] },
    disableMonitoringDatetime: dateTimeWrapper,
    labels: monitorCreateSchema.properties.labels,
    tags: monitorCreateSchema.properties.tags,
    monitorSteps: { type: "object" },
    immutableRegion: { type: "string" },
    projectId: { type: "string" },
    serverToken: {
      type: "string",
      readOnly: true,
      description: "Server-generated token",
    },
    createdAt: dateTimeWrapper,
  },
};

const emailLogModelSchema: any = {
  type: "object",
  description: "EmailLog model",
  properties: {
    _id: { type: "string" },
    toEmail: { type: "string" },
    status: { type: "string" },
  },
};

const fileCreateSchema: any = {
  type: "object",
  description: "Create schema for File model. Create",
  required: ["file"],
  properties: {
    file: { type: "string", format: "binary" },
    name: { type: "string" },
  },
};

const fileReadSchema: any = {
  type: "object",
  description: "Read schema for File model. Read",
  properties: {
    _id: { type: "string" },
    name: { type: "string" },
    fileAccessToken: { type: "string", readOnly: true },
  },
};

function requestBody(schemaRef: any): any {
  return {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: { data: schemaRef },
          required: ["data"],
        },
      },
    },
  };
}

function itemResponse(schemaRef: any, status: string = "200"): any {
  return {
    [status]: {
      description: "Successful response",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { data: schemaRef },
          },
        },
      },
    },
  };
}

function listResponse(schemaRef: any): any {
  return {
    "200": {
      description: "Successful response",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: { type: "array", items: schemaRef },
              count: { type: "number" },
            },
          },
        },
      },
    },
  };
}

export function buildFixtureSpec(): OpenAPISpec {
  return {
    openapi: "3.0.0",
    info: {
      title: "OneUptime OpenAPI Specification",
      version: "1.0.0",
      description: "Test fixture spec",
    },
    servers: [{ url: "https://oneuptime.com/api" }],
    paths: {
      "/monitor": {
        post: {
          operationId: "createMonitor",
          tags: ["Monitor"],
          requestBody: requestBody({
            $ref: "#/components/schemas/MonitorCreateSchema",
          }),
          responses: itemResponse(
            { $ref: "#/components/schemas/MonitorReadSchema" },
            "201",
          ),
        } as any,
      },
      "/monitor/get-list": {
        post: {
          operationId: "listMonitor",
          tags: ["Monitor"],
          responses: listResponse({
            $ref: "#/components/schemas/Monitor",
          }),
        } as any,
      },
      "/monitor/count": {
        post: {
          operationId: "countMonitor",
          tags: ["Monitor"],
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { count: { type: "number" } },
                  },
                },
              },
            },
          },
        } as any,
      },
      "/monitor/{id}/get-item": {
        post: {
          operationId: "getMonitor",
          tags: ["Monitor"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: itemResponse({ $ref: "#/components/schemas/Monitor" }),
        } as any,
      },
      "/monitor/{id}": {
        put: {
          operationId: "updateMonitor",
          tags: ["Monitor"],
          requestBody: requestBody({
            $ref: "#/components/schemas/MonitorUpdateSchema",
          }),
          responses: itemResponse({
            $ref: "#/components/schemas/MonitorReadSchema",
          }),
        } as any,
        delete: {
          operationId: "deleteMonitor",
          tags: ["Monitor"],
          responses: { "200": { description: "Deleted successfully" } },
        } as any,
      },
      "/email-log/get-list": {
        post: {
          operationId: "listEmailLog",
          tags: ["EmailLog"],
          responses: listResponse({
            $ref: "#/components/schemas/EmailLog",
          }),
        } as any,
      },
      "/email-log/count": {
        post: {
          operationId: "countEmailLog",
          tags: ["EmailLog"],
          responses: {
            "200": { description: "Successful response" },
          },
        } as any,
      },
      "/file": {
        post: {
          operationId: "createFile",
          tags: ["File"],
          requestBody: requestBody({
            $ref: "#/components/schemas/FileCreateSchema",
          }),
          responses: itemResponse(
            { $ref: "#/components/schemas/FileReadSchema" },
            "201",
          ),
        } as any,
      },
      "/file/{id}": {
        delete: {
          operationId: "deleteFile",
          tags: ["File"],
          responses: { "200": { description: "Deleted successfully" } },
        } as any,
      },
    },
    components: {
      schemas: {
        Monitor: monitorModelSchema,
        MonitorCreateSchema: monitorCreateSchema,
        MonitorUpdateSchema: monitorUpdateSchema,
        MonitorReadSchema: monitorModelSchema,
        EmailLog: emailLogModelSchema,
        FileCreateSchema: fileCreateSchema,
        FileReadSchema: fileReadSchema,
      },
    },
  } as OpenAPISpec;
}
