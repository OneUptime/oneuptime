import { ExpressRequest } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Exception from "Common/Types/Exception/Exception";

/**
 * SCIM Error types as defined in RFC 7644
 */
export enum SCIMErrorType {
  InvalidFilter = "invalidFilter",
  TooMany = "tooMany",
  Uniqueness = "uniqueness",
  Mutability = "mutability",
  InvalidSyntax = "invalidSyntax",
  InvalidPath = "invalidPath",
  NoTarget = "noTarget",
  InvalidValue = "invalidValue",
  InvalidVers = "invalidVers",
  Sensitive = "sensitive",
}

/**
 * Shared SCIM utility functions for both Project SCIM and Status Page SCIM
 */

// Base interface for SCIM user-like objects - compatible with User model
export interface SCIMUser {
  id?: ObjectID | null;
  email?: Email;
  name?: Name | string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Parse name information from SCIM user payload
 */
export const parseNameFromSCIM: (scimUser: JSONObject) => string = (
  scimUser: JSONObject,
): string => {
  logger.debug(
    `SCIM - Parsing name from SCIM user: ${JSON.stringify(scimUser, null, 2)}`,
  );

  const givenName: string =
    ((scimUser["name"] as JSONObject)?.["givenName"] as string) || "";
  const familyName: string =
    ((scimUser["name"] as JSONObject)?.["familyName"] as string) || "";
  const formattedName: string = (scimUser["name"] as JSONObject)?.[
    "formatted"
  ] as string;

  // Construct full name: prefer formatted, then combine given+family, then fallback to displayName
  if (formattedName) {
    return formattedName;
  } else if (givenName || familyName) {
    return `${givenName} ${familyName}`.trim();
  } else if (scimUser["displayName"]) {
    return scimUser["displayName"] as string;
  }
  return "";
};

/**
 * Parse full name into SCIM name format
 */
export const parseNameToSCIMFormat: (fullName: string) => {
  givenName: string;
  familyName: string;
  formatted: string;
} = (
  fullName: string,
): { givenName: string; familyName: string; formatted: string } => {
  const nameParts: string[] = fullName.trim().split(/\s+/);
  const givenName: string = nameParts[0] || "";
  const familyName: string = nameParts.slice(1).join(" ") || "";

  return {
    givenName,
    familyName,
    formatted: fullName,
  };
};

/**
 * Format user object for SCIM response
 */
export const formatUserForSCIM: (
  user: SCIMUser,
  req: ExpressRequest,
  scimId: string,
  scimType: "project" | "status-page",
) => JSONObject = (
  user: SCIMUser,
  req: ExpressRequest,
  scimId: string,
  scimType: "project" | "status-page",
): JSONObject => {
  const baseUrl: string = `${req.protocol}://${req.get("host")}`;
  const userName: string = user.email?.toString() || "";
  const fullName: string =
    user.name?.toString() || userName.split("@")[0] || "Unknown User";

  const nameData: { givenName: string; familyName: string; formatted: string } =
    parseNameToSCIMFormat(fullName);

  // Determine the correct endpoint path based on SCIM type
  const endpointPath: string =
    scimType === "project"
      ? `/scim/v2/${scimId}/Users/${user.id?.toString()}`
      : `/status-page-scim/v2/${scimId}/Users/${user.id?.toString()}`;

  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id?.toString(),
    userName: userName,
    displayName: nameData.formatted,
    name: {
      formatted: nameData.formatted,
      familyName: nameData.familyName,
      givenName: nameData.givenName,
    },
    emails: [
      {
        value: userName,
        type: "work",
        primary: true,
      },
    ],
    active: true,
    meta: {
      resourceType: "User",
      created: user.createdAt?.toISOString(),
      lastModified: user.updatedAt?.toISOString(),
      location: `${baseUrl}${endpointPath}`,
    },
  };
};

/**
 * Extract email from SCIM user payload
 */
export const extractEmailFromSCIM: (scimUser: JSONObject) => string = (
  scimUser: JSONObject,
): string => {
  return (
    (scimUser["userName"] as string) ||
    ((scimUser["emails"] as JSONObject[])?.[0]?.["value"] as string) ||
    ""
  );
};

/**
 * Extract active status from SCIM user payload
 */
export const extractActiveFromSCIM: (scimUser: JSONObject) => boolean = (
  scimUser: JSONObject,
): boolean => {
  return scimUser["active"] !== false; // Default to true if not specified
};

/**
 * Generate SCIM ServiceProviderConfig response
 */
export const generateServiceProviderConfig: (
  req: ExpressRequest,
  scimId: string,
  scimType: "project" | "status-page",
  documentationUrl?: string,
) => JSONObject = (
  req: ExpressRequest,
  scimId: string,
  scimType: "project" | "status-page",
  documentationUrl: string = "https://oneuptime.com/docs/identity/scim",
): JSONObject => {
  const baseUrl: string = `${req.protocol}://${req.get("host")}`;
  const endpointPath: string =
    scimType === "project"
      ? `/scim/v2/${scimId}`
      : `/status-page-scim/v2/${scimId}`;

  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: documentationUrl,
    patch: {
      supported: true,
    },
    bulk: {
      supported: false,
      maxOperations: 0,
      maxPayloadSize: 0,
    },
    filter: {
      supported: true,
      maxResults: 200,
    },
    changePassword: {
      supported: false,
    },
    sort: {
      supported: true,
    },
    etag: {
      supported: false,
    },
    authenticationSchemes: [
      {
        type: "httpbearer",
        name: "HTTP Bearer",
        description: "Authentication scheme using HTTP Bearer Token",
        primary: true,
      },
    ],
    meta: {
      location: `${baseUrl}${endpointPath}/ServiceProviderConfig`,
      resourceType: "ServiceProviderConfig",
      created: "2023-01-01T00:00:00Z",
      lastModified: "2023-01-01T00:00:00Z",
    },
  };
};

/**
 * Generate SCIM ListResponse for users
 */
export const generateUsersListResponse: (
  users: JSONObject[],
  startIndex: number,
  totalResults: number,
) => JSONObject = (
  users: JSONObject[],
  startIndex: number,
  totalResults: number,
): JSONObject => {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: totalResults,
    startIndex: startIndex,
    itemsPerPage: users.length,
    Resources: users,
  };
};

/**
 * Generate SCIM ListResponse for groups
 */
export const generateGroupsListResponse: (
  groups: JSONObject[],
  startIndex: number,
  totalResults: number,
) => JSONObject = (
  groups: JSONObject[],
  startIndex: number,
  totalResults: number,
): JSONObject => {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: totalResults,
    startIndex: startIndex,
    itemsPerPage: groups.length,
    Resources: groups,
  };
};

/**
 * Parse query parameters for SCIM list requests
 */
export const parseSCIMQueryParams: (req: ExpressRequest) => {
  startIndex: number;
  count: number;
} = (req: ExpressRequest): { startIndex: number; count: number } => {
  const startIndex: number = parseInt(req.query["startIndex"] as string) || 1;
  const count: number = Math.min(
    parseInt(req.query["count"] as string) || 100,
    200, // SCIM recommended max
  );

  return { startIndex, count };
};

/**
 * Generate SCIM-compliant error response as per RFC 7644
 */
export const generateSCIMErrorResponse: (
  status: number,
  detail: string,
  scimType?: SCIMErrorType,
) => JSONObject = (
  status: number,
  detail: string,
  scimType?: SCIMErrorType,
): JSONObject => {
  const errorResponse: JSONObject = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: status.toString(),
    detail: detail,
  };

  if (scimType) {
    errorResponse["scimType"] = scimType;
  }

  return errorResponse;
};

/**
 * Generate SCIM Schemas endpoint response
 */
export const generateSchemasResponse: (
  req: ExpressRequest,
  scimId: string,
  scimType: "project" | "status-page",
) => JSONObject = (
  req: ExpressRequest,
  scimId: string,
  scimType: "project" | "status-page",
): JSONObject => {
  const baseUrl: string = `${req.protocol}://${req.get("host")}`;
  const endpointPath: string =
    scimType === "project"
      ? `/scim/v2/${scimId}`
      : `/status-page-scim/v2/${scimId}`;

  const schemas: JSONObject[] = [
    {
      id: "urn:ietf:params:scim:schemas:core:2.0:User",
      name: "User",
      description: "User Schema",
      attributes: [
        {
          name: "userName",
          type: "string",
          multiValued: false,
          description: "Unique identifier for the User, typically email address",
          required: true,
          caseExact: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "server",
        },
        {
          name: "name",
          type: "complex",
          multiValued: false,
          description: "The components of the user's name",
          required: false,
          subAttributes: [
            {
              name: "formatted",
              type: "string",
              multiValued: false,
              description: "The full name",
              required: false,
              mutability: "readWrite",
              returned: "default",
            },
            {
              name: "familyName",
              type: "string",
              multiValued: false,
              description: "The family name or last name",
              required: false,
              mutability: "readWrite",
              returned: "default",
            },
            {
              name: "givenName",
              type: "string",
              multiValued: false,
              description: "The given name or first name",
              required: false,
              mutability: "readWrite",
              returned: "default",
            },
          ],
          mutability: "readWrite",
          returned: "default",
        },
        {
          name: "displayName",
          type: "string",
          multiValued: false,
          description: "The name of the User suitable for display",
          required: false,
          mutability: "readWrite",
          returned: "default",
        },
        {
          name: "emails",
          type: "complex",
          multiValued: true,
          description: "Email addresses for the user",
          required: false,
          subAttributes: [
            {
              name: "value",
              type: "string",
              multiValued: false,
              description: "Email address value",
              required: false,
              mutability: "readWrite",
              returned: "default",
            },
            {
              name: "type",
              type: "string",
              multiValued: false,
              description: "Type of email (work, home, other)",
              required: false,
              canonicalValues: ["work", "home", "other"],
              mutability: "readWrite",
              returned: "default",
            },
            {
              name: "primary",
              type: "boolean",
              multiValued: false,
              description: "Indicates if this is the primary email",
              required: false,
              mutability: "readWrite",
              returned: "default",
            },
          ],
          mutability: "readWrite",
          returned: "default",
        },
        {
          name: "active",
          type: "boolean",
          multiValued: false,
          description: "Indicates whether the user is active",
          required: false,
          mutability: "readWrite",
          returned: "default",
        },
      ],
      meta: {
        resourceType: "Schema",
        location: `${baseUrl}${endpointPath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:User`,
      },
    },
  ];

  // Add Group schema only for project SCIM
  if (scimType === "project") {
    schemas.push({
      id: "urn:ietf:params:scim:schemas:core:2.0:Group",
      name: "Group",
      description: "Group Schema (Teams in OneUptime)",
      attributes: [
        {
          name: "displayName",
          type: "string",
          multiValued: false,
          description: "Human-readable name for the Group/Team",
          required: true,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "server",
        },
        {
          name: "members",
          type: "complex",
          multiValued: true,
          description: "A list of members of the Group",
          required: false,
          subAttributes: [
            {
              name: "value",
              type: "string",
              multiValued: false,
              description: "Identifier of the member",
              required: false,
              mutability: "immutable",
              returned: "default",
            },
            {
              name: "$ref",
              type: "reference",
              referenceTypes: ["User"],
              multiValued: false,
              description: "URI of the member resource",
              required: false,
              mutability: "immutable",
              returned: "default",
            },
            {
              name: "display",
              type: "string",
              multiValued: false,
              description: "Display name of the member",
              required: false,
              mutability: "immutable",
              returned: "default",
            },
          ],
          mutability: "readWrite",
          returned: "default",
        },
      ],
      meta: {
        resourceType: "Schema",
        location: `${baseUrl}${endpointPath}/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group`,
      },
    });
  }

  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: schemas.length,
    itemsPerPage: schemas.length,
    startIndex: 1,
    Resources: schemas,
  };
};

/**
 * Generate SCIM ResourceTypes endpoint response
 */
export const generateResourceTypesResponse: (
  req: ExpressRequest,
  scimId: string,
  scimType: "project" | "status-page",
) => JSONObject = (
  req: ExpressRequest,
  scimId: string,
  scimType: "project" | "status-page",
): JSONObject => {
  const baseUrl: string = `${req.protocol}://${req.get("host")}`;
  const endpointPath: string =
    scimType === "project"
      ? `/scim/v2/${scimId}`
      : `/status-page-scim/v2/${scimId}`;

  const resourceTypes: JSONObject[] = [
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "User",
      name: "User",
      endpoint: "/Users",
      description: "User Account",
      schema: "urn:ietf:params:scim:schemas:core:2.0:User",
      schemaExtensions: [],
      meta: {
        resourceType: "ResourceType",
        location: `${baseUrl}${endpointPath}/ResourceTypes/User`,
      },
    },
  ];

  // Add Group resource type only for project SCIM
  if (scimType === "project") {
    resourceTypes.push({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      description: "Group (Team in OneUptime)",
      schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
      schemaExtensions: [],
      meta: {
        resourceType: "ResourceType",
        location: `${baseUrl}${endpointPath}/ResourceTypes/Group`,
      },
    });
  }

  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: resourceTypes.length,
    itemsPerPage: resourceTypes.length,
    startIndex: 1,
    Resources: resourceTypes,
  };
};

/**
 * Map HTTP status codes to SCIM error types
 */
export const getScimErrorTypeFromException: (
  err: Exception,
) => SCIMErrorType | undefined = (err: Exception): SCIMErrorType | undefined => {
  const errorName: string = err.constructor.name;

  switch (errorName) {
    case "BadRequestException":
      return SCIMErrorType.InvalidValue;
    case "NotFoundException":
      return SCIMErrorType.NoTarget;
    case "NotAuthorizedException":
      return undefined; // No specific SCIM type for auth errors
    default:
      return undefined;
  }
};

/**
 * Get HTTP status code from exception
 */
export const getHttpStatusFromException: (err: Exception) => number = (
  err: Exception,
): number => {
  const errorName: string = err.constructor.name;

  switch (errorName) {
    case "BadRequestException":
      return 400;
    case "NotAuthorizedException":
      return 401;
    case "PaymentRequiredException":
      return 402;
    case "NotFoundException":
      return 404;
    case "NotImplementedException":
      return 501;
    default:
      return 500;
  }
};
