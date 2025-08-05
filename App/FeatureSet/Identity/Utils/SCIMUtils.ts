import { ExpressRequest } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";

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
      supported: true,
      maxOperations: 1000,
      maxPayloadSize: 1048576,
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
 * Log SCIM operation with consistent format
 */
export const logSCIMOperation: (
  operation: string,
  scimType: "project" | "status-page",
  scimId: string,
  details?: string,
) => void = (
  operation: string,
  scimType: "project" | "status-page",
  scimId: string,
  details?: string,
): void => {
  const logPrefix: string =
    scimType === "project" ? "Project SCIM" : "Status Page SCIM";
  const message: string = `${logPrefix} ${operation} - scimId: ${scimId}${details ? `, ${details}` : ""}`;
  logger.debug(message);
};
