import { OpenAPISpec } from "../Core/Types";

/*
 * A miniature, shape-accurate spec of the models that name people, the way
 * Common/Server/Utils/OpenAPI.ts emits them: a person is a user ID with an
 * x-oneuptime-relation to User, or an array of them.
 *
 *  - User: get-list + get-item only (a data source; the API answers a person
 *    about themselves only, so the provider's is written by hand).
 *  - Team: create + get-item + list, what a membership joins.
 *  - Team Member: full CRUD, but nothing a project caller may update - its
 *    update schema has only what the invitee decides (whether they
 *    accepted, and when). The person is required.
 *  - Monitor Owner User: full CRUD with an empty update schema - the person
 *    cannot change, and OneUptime marks the row once it has told them.
 *  - On-Call Duty Policy Schedule Layer User: full CRUD, the person in the
 *    update schema too.
 *  - Monitor Owner Rule: full CRUD, a set of people (ownerUsers).
 *  - Incident Note: names a person only in its read schema
 *    (createdByUserId) - no companion - an ordered list of people
 *    (reviewers, x-ordered) and a person whose companion name is taken
 *    (approverUserId beside a column approverUserEmail).
 */

const personId: (description: string) => any = (description: string) => {
  return {
    type: "string",
    format: "uuid",
    description: description,
    example: "123e4567-e89b-12d3-a456-426614174000",
    "x-oneuptime-relation": { tag: "User", tableName: "User" },
  };
};

const people: (description: string, ordered?: boolean) => any = (
  description: string,
  ordered: boolean = false,
) => {
  return {
    type: "array",
    "x-ordered": ordered,
    items: {
      type: "object",
      properties: { _id: { type: "string", format: "uuid" } },
    },
    description: description,
    "x-oneuptime-relation": { tag: "User", tableName: "User" },
  };
};

const relationId: (tag: string, table: string, description: string) => any = (
  tag: string,
  table: string,
  description: string,
) => {
  return {
    type: "string",
    format: "uuid",
    description: description,
    "x-oneuptime-relation": { tag: tag, tableName: table },
  };
};

const dateTime: any = {
  type: "object",
  "x-oneuptime-type": "DateTime",
  description: "A date time.",
  example: { _type: "DateTime", value: "2026-01-01T00:00:00Z" },
};

const userSchema: any = {
  type: "object",
  description: "User model",
  properties: {
    _id: { type: "string", format: "uuid" },
    name: { type: "string", description: "Name" },
    email: {
      type: "object",
      description: "Email",
      example: { _type: "Email", value: "alice@example.com" },
    },
    password: { type: "string", format: "password" },
    isBlocked: { type: "boolean" },
  },
};

const teamSchema: any = {
  type: "object",
  description: "Team model",
  required: ["name"],
  properties: {
    _id: { type: "string", format: "uuid" },
    name: { type: "string", description: "Name of the team" },
  },
};

const teamMemberCreateSchema: any = {
  type: "object",
  description: "Create schema for TeamMember model. Create",
  required: ["teamId", "userId"],
  properties: {
    teamId: relationId("Team", "Team", "ID of the team the person is in."),
    userId: personId("ID of the person in the team."),
    hasAcceptedInvitation: {
      type: "boolean",
      default: false,
      description: "Whether the person has joined.",
    },
    invitationAcceptedAt: dateTime,
  },
};

const teamMemberReadSchema: any = {
  type: "object",
  description: "Read schema for TeamMember model. Read",
  properties: {
    _id: { type: "string", format: "uuid" },
    teamId: teamMemberCreateSchema.properties.teamId,
    userId: teamMemberCreateSchema.properties.userId,
    projectId: { type: "string", format: "uuid" },
    hasAcceptedInvitation: {
      type: "boolean",
      default: false,
      description: "Whether the person has joined.",
    },
    invitationAcceptedAt: dateTime,
    createdAt: dateTime,
  },
};

const teamMemberUpdateSchema: any = {
  type: "object",
  description: "Update schema for TeamMember model. Update",
  properties: {
    hasAcceptedInvitation:
      teamMemberCreateSchema.properties.hasAcceptedInvitation,
    invitationAcceptedAt: dateTime,
  },
};

const monitorOwnerUserUpdateSchema: any = {
  type: "object",
  description: "Update schema for MonitorOwnerUser model. Update",
  properties: {},
};

const monitorOwnerUserCreateSchema: any = {
  type: "object",
  description: "Create schema for MonitorOwnerUser model. Create",
  required: ["monitorId", "userId"],
  properties: {
    monitorId: relationId("Monitor", "Monitor", "ID of the monitor."),
    userId: personId("ID of the person who owns it."),
    isOwnerNotified: {
      type: "boolean",
      default: false,
      description: "Are owners notified of this resource ownership?",
    },
  },
};

const monitorOwnerUserReadSchema: any = {
  type: "object",
  description: "Read schema for MonitorOwnerUser model. Read",
  properties: {
    _id: { type: "string", format: "uuid" },
    ...monitorOwnerUserCreateSchema.properties,
  },
};

const layerUserCreateSchema: any = {
  type: "object",
  description:
    "Create schema for OnCallDutyPolicyScheduleLayerUser model. Create",
  required: ["onCallDutyPolicyScheduleLayerId", "userId"],
  properties: {
    onCallDutyPolicyScheduleLayerId: relationId(
      "On-Call Duty Policy Schedule Layer",
      "OnCallDutyPolicyScheduleLayer",
      "ID of the layer.",
    ),
    userId: personId("ID of the person who takes turns on call in this layer."),
  },
};

const layerUserUpdateSchema: any = {
  type: "object",
  description:
    "Update schema for OnCallDutyPolicyScheduleLayerUser model. Update",
  properties: {
    userId: layerUserCreateSchema.properties.userId,
  },
};

const layerUserReadSchema: any = {
  type: "object",
  description: "Read schema for OnCallDutyPolicyScheduleLayerUser model. Read",
  properties: {
    _id: { type: "string", format: "uuid" },
    ...layerUserCreateSchema.properties,
  },
};

const ownerRuleCreateSchema: any = {
  type: "object",
  description: "Create schema for MonitorOwnerRule model. Create",
  required: ["name"],
  properties: {
    name: { type: "string", description: "Name of the rule." },
    ownerUsers: people("Users to add as owners on the monitor."),
  },
};

const ownerRuleReadSchema: any = {
  type: "object",
  description: "Read schema for MonitorOwnerRule model. Read",
  properties: {
    _id: { type: "string", format: "uuid" },
    ...ownerRuleCreateSchema.properties,
  },
};

const noteCreateSchema: any = {
  type: "object",
  description: "Create schema for IncidentNote model. Create",
  required: ["note"],
  properties: {
    note: { type: "string", description: "The note." },
    reviewers: people("People who review it, in order.", true),
    approverUserId: personId("Who approves it."),
    approverUserEmail: { type: "string", description: "Kept as written." },
  },
};

const noteReadSchema: any = {
  type: "object",
  description: "Read schema for IncidentNote model. Read",
  properties: {
    _id: { type: "string", format: "uuid" },
    ...noteCreateSchema.properties,
    createdByUserId: personId("Who wrote it."),
  },
};

function requestBody(schemaName: string): any {
  return {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: { data: { $ref: `#/components/schemas/${schemaName}` } },
          required: ["data"],
        },
      },
    },
  };
}

function response(schemaName: string, isList: boolean = false): any {
  const ref: any = { $ref: `#/components/schemas/${schemaName}` };
  return {
    "200": {
      description: "Successful response",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: isList ? { type: "array", items: ref } : ref,
            },
          },
        },
      },
    },
  };
}

const idParameter: Array<any> = [
  {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
];

function paths(data: {
  path: string;
  table: string;
  tag: string;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
}): Record<string, any> {
  const read: string = `${data.table}ReadSchema`;
  const result: Record<string, any> = {
    [`${data.path}/get-list`]: {
      post: {
        operationId: `list${data.table}`,
        tags: [data.tag],
        responses: response(read, true),
      },
    },
    [`${data.path}/{id}/get-item`]: {
      post: {
        operationId: `get${data.table}`,
        tags: [data.tag],
        parameters: idParameter,
        responses: response(read),
      },
    },
  };

  if (data.create) {
    result[data.path] = {
      post: {
        operationId: `create${data.table}`,
        tags: [data.tag],
        requestBody: requestBody(`${data.table}CreateSchema`),
        responses: response(read),
      },
    };
  }

  const item: Record<string, any> = {};
  if (data.update) {
    item["put"] = {
      operationId: `update${data.table}`,
      tags: [data.tag],
      parameters: idParameter,
      requestBody: requestBody(`${data.table}UpdateSchema`),
      responses: response(read),
    };
  }
  if (data.delete) {
    item["delete"] = {
      operationId: `delete${data.table}`,
      tags: [data.tag],
      parameters: idParameter,
      responses: { "200": { description: "Deleted" } },
    };
  }
  if (Object.keys(item).length > 0) {
    result[`${data.path}/{id}`] = item;
  }

  return result;
}

export function buildPeopleFixtureSpec(): OpenAPISpec {
  return {
    openapi: "3.0.0",
    info: { title: "People fixture", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [
      { name: "User", description: "A signed up or invited OneUptime user." },
      { name: "Team", description: "Teams." },
      {
        name: "Team Member",
        description: "This model connects users and teams",
      },
      { name: "Monitor Owner User", description: "Owners of a monitor." },
      {
        name: "On-Call Duty Policy Schedule Layer User",
        description: "The people of a layer.",
      },
      { name: "Monitor Owner Rule", description: "Rules that add owners." },
      { name: "Incident Note", description: "Notes." },
    ],
    paths: {
      ...paths({ path: "/user", table: "User", tag: "User" }),
      ...paths({ path: "/team", table: "Team", tag: "Team", create: true }),
      ...paths({
        path: "/team-member",
        table: "TeamMember",
        tag: "Team Member",
        create: true,
        update: true,
        delete: true,
      }),
      ...paths({
        path: "/monitor-owner-user",
        table: "MonitorOwnerUser",
        tag: "Monitor Owner User",
        create: true,
        update: true,
        delete: true,
      }),
      ...paths({
        path: "/on-call-duty-schedule-layer-user",
        table: "OnCallDutyPolicyScheduleLayerUser",
        tag: "On-Call Duty Policy Schedule Layer User",
        create: true,
        update: true,
        delete: true,
      }),
      ...paths({
        path: "/monitor-owner-rule",
        table: "MonitorOwnerRule",
        tag: "Monitor Owner Rule",
        create: true,
        update: true,
        delete: true,
      }),
      ...paths({
        path: "/incident-note",
        table: "IncidentNote",
        tag: "Incident Note",
        create: true,
        delete: true,
      }),
    },
    components: {
      schemas: {
        UserReadSchema: userSchema,
        TeamReadSchema: teamSchema,
        TeamCreateSchema: teamSchema,
        TeamMemberCreateSchema: teamMemberCreateSchema,
        TeamMemberReadSchema: teamMemberReadSchema,
        TeamMemberUpdateSchema: teamMemberUpdateSchema,
        MonitorOwnerUserCreateSchema: monitorOwnerUserCreateSchema,
        MonitorOwnerUserUpdateSchema: monitorOwnerUserUpdateSchema,
        MonitorOwnerUserReadSchema: monitorOwnerUserReadSchema,
        OnCallDutyPolicyScheduleLayerUserCreateSchema: layerUserCreateSchema,
        OnCallDutyPolicyScheduleLayerUserUpdateSchema: layerUserUpdateSchema,
        OnCallDutyPolicyScheduleLayerUserReadSchema: layerUserReadSchema,
        MonitorOwnerRuleCreateSchema: ownerRuleCreateSchema,
        MonitorOwnerRuleUpdateSchema: ownerRuleCreateSchema,
        MonitorOwnerRuleReadSchema: ownerRuleReadSchema,
        IncidentNoteCreateSchema: noteCreateSchema,
        IncidentNoteReadSchema: noteReadSchema,
      },
    },
  } as OpenAPISpec;
}
