import URL from "../../Types/API/URL";
import Email from "../../Types/Email";
import ServerException from "../../Types/Exception/ServerException";
import { JSONObject } from "../../Types/JSON";
import Name from "../../Types/Name";
import logger from "./Logger";
import API from "../../Utils/API";
import HTTPResponse from "../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import Headers from "../../Types/API/Headers";
import Route from "../../Types/API/Route";

export interface SCIMUser {
  id?: string;
  userName: string;
  name?: {
    formatted?: string;
    familyName?: string;
    givenName?: string;
  };
  displayName?: string;
  emails: Array<{
    value: string;
    type?: string;
    primary?: boolean;
  }>;
  active: boolean;
  groups?: Array<{
    value: string;
    display?: string;
  }>;
  meta?: {
    resourceType: string;
    created?: string;
    lastModified?: string;
    location?: string;
    version?: string;
  };
}

export interface SCIMGroup {
  id?: string;
  displayName: string;
  members?: Array<{
    value: string;
    display?: string;
    type?: string;
  }>;
  meta?: {
    resourceType: string;
    created?: string;
    lastModified?: string;
    location?: string;
    version?: string;
  };
}

export interface SCIMListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface SCIMError {
  schemas: string[];
  scimType?: string;
  detail: string;
  status: number;
}

export default class SCIMUtil {
  public static readonly SCIM_SCHEMAS = {
    CORE_USER: "urn:ietf:params:scim:schemas:core:2.0:User",
    CORE_GROUP: "urn:ietf:params:scim:schemas:core:2.0:Group",
    LIST_RESPONSE: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
    ERROR: "urn:ietf:params:scim:api:messages:2.0:Error",
    PATCH_OP: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  };

  public static createHeaders(bearerToken: string): Headers {
    return {
      "Content-Type": "application/scim+json",
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/scim+json",
    };
  }

  public static async createUser(
    scimBaseUrl: URL,
    bearerToken: string,
    user: Omit<SCIMUser, "id" | "meta">,
  ): Promise<SCIMUser> {
    try {
      const userData = {
        schemas: [SCIMUtil.SCIM_SCHEMAS.CORE_USER],
        ...user,
      };

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post<JSONObject>(
        scimBaseUrl.addRoute(new Route("/Users")),
        userData,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        throw new ServerException(response.message || "Failed to create SCIM user");
      }

      logger.info(`SCIM user created: ${user.userName}`);
      return response.data as unknown as SCIMUser;
    } catch (error: any) {
      logger.error(`Failed to create SCIM user: ${user.userName} - ${error.message}`);
      throw new ServerException(`Failed to create SCIM user: ${error.message}`);
    }
  }

  public static async updateUser(
    scimBaseUrl: URL,
    bearerToken: string,
    userId: string,
    user: Partial<SCIMUser>,
  ): Promise<SCIMUser> {
    try {
      const userData = {
        schemas: [SCIMUtil.SCIM_SCHEMAS.CORE_USER],
        ...user,
      };

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.put<JSONObject>(
        scimBaseUrl.addRoute(new Route(`/Users/${userId}`)),
        userData,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        throw new ServerException(response.message || "Failed to update SCIM user");
      }

      logger.info(`SCIM user updated: ${userId}`);
      return response.data as unknown as SCIMUser;
    } catch (error: any) {
      logger.error(`Failed to update SCIM user: ${userId} - ${error.message}`);
      throw new ServerException(`Failed to update SCIM user: ${error.message}`);
    }
  }

  public static async deleteUser(
    scimBaseUrl: URL,
    bearerToken: string,
    userId: string,
  ): Promise<void> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.delete<JSONObject>(
        scimBaseUrl.addRoute(new Route(`/Users/${userId}`)),
        undefined,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        throw new ServerException(response.message || "Failed to delete SCIM user");
      }

      logger.info(`SCIM user deleted: ${userId}`);
    } catch (error: any) {
      logger.error(`Failed to delete SCIM user: ${userId} - ${error.message}`);
      throw new ServerException(`Failed to delete SCIM user: ${error.message}`);
    }
  }

  public static async deactivateUser(
    scimBaseUrl: URL,
    bearerToken: string,
    userId: string,
  ): Promise<SCIMUser> {
    try {
      const patchData = {
        schemas: [SCIMUtil.SCIM_SCHEMAS.PATCH_OP],
        Operations: [
          {
            op: "replace",
            path: "active",
            value: false,
          },
        ],
      };

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.patch<JSONObject>(
        scimBaseUrl.addRoute(new Route(`/Users/${userId}`)),
        patchData,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        throw new ServerException(response.message || "Failed to deactivate SCIM user");
      }

      logger.info(`SCIM user deactivated: ${userId}`);
      return response.data as unknown as SCIMUser;
    } catch (error: any) {
      logger.error(`Failed to deactivate SCIM user: ${userId} - ${error.message}`);
      throw new ServerException(`Failed to deactivate SCIM user: ${error.message}`);
    }
  }

  public static async getUser(
    scimBaseUrl: URL,
    bearerToken: string,
    userId: string,
  ): Promise<SCIMUser> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.get<JSONObject>(
        scimBaseUrl.addRoute(new Route(`/Users/${userId}`)),
        undefined,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        throw new ServerException(response.message || "Failed to get SCIM user");
      }

      return response.data as unknown as SCIMUser;
    } catch (error: any) {
      logger.error(`Failed to get SCIM user: ${userId} - ${error.message}`);
      throw new ServerException(`Failed to get SCIM user: ${error.message}`);
    }
  }

  public static async getUserByUserName(
    scimBaseUrl: URL,
    bearerToken: string,
    userName: string,
  ): Promise<SCIMUser | null> {
    try {
      const usersUrl = scimBaseUrl.addRoute(new Route("/Users"));
      usersUrl.addQueryParam("filter", `userName eq "${userName}"`);
      usersUrl.addQueryParam("count", "1");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.get<JSONObject>(
        usersUrl,
        undefined,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        throw new ServerException(response.message || "Failed to get SCIM user by username");
      }

      const listResponse = response.data as unknown as SCIMListResponse<SCIMUser>;
      if (listResponse.totalResults > 0) {
        return listResponse.Resources[0] || null;
      }

      return null;
    } catch (error: any) {
      logger.error(`Failed to get SCIM user by username: ${userName} - ${error.message}`);
      throw new ServerException(`Failed to get SCIM user: ${error.message}`);
    }
  }

  public static async listUsers(
    scimBaseUrl: URL,
    bearerToken: string,
    options?: {
      startIndex?: number;
      count?: number;
      filter?: string;
    },
  ): Promise<SCIMListResponse<SCIMUser>> {
    try {
      const usersUrl = scimBaseUrl.addRoute(new Route("/Users"));
      usersUrl.addQueryParam("startIndex", (options?.startIndex || 1).toString());
      usersUrl.addQueryParam("count", (options?.count || 100).toString());
      
      if (options?.filter) {
        usersUrl.addQueryParam("filter", options.filter);
      }

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.get<JSONObject>(
        usersUrl,
        undefined,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        throw new ServerException(response.message || "Failed to list SCIM users");
      }

      return response.data as unknown as SCIMListResponse<SCIMUser>;
    } catch (error: any) {
      logger.error(`Failed to list SCIM users - ${error.message}`);
      throw new ServerException(`Failed to list SCIM users: ${error.message}`);
    }
  }

  public static async testConnection(
    scimBaseUrl: URL,
    bearerToken: string,
  ): Promise<boolean> {
    try {
      const usersUrl = scimBaseUrl.addRoute(new Route("/Users"));
      usersUrl.addQueryParam("count", "1");

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.get<JSONObject>(
        usersUrl,
        undefined,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        logger.error(`SCIM connection test failed: ${scimBaseUrl.toString()} - ${response.message}`);
        return false;
      }

      logger.info(`SCIM connection test successful: ${scimBaseUrl.toString()}`);
      return true;
    } catch (error: any) {
      logger.error(`SCIM connection test failed: ${scimBaseUrl.toString()} - ${error.message}`);
      return false;
    }
  }

  public static convertOneUptimeUserToSCIMUser(
    email: Email,
    name?: Name,
    isActive: boolean = true,
  ): Omit<SCIMUser, "id" | "meta"> {
    const emailValue = email.toString();
    
    const result: Omit<SCIMUser, "id" | "meta"> = {
      userName: emailValue,
      displayName: name?.toString() || emailValue,
      emails: [
        {
          value: emailValue,
          type: "work",
          primary: true,
        },
      ],
      active: isActive,
    };

    if (name) {
      result.name = {
        formatted: name.toString(),
        givenName: name.toString().split(" ")[0] || "",
        familyName: name.toString().split(" ").slice(1).join(" ") || "",
      };
    }

    return result;
  }

  public static extractEmailFromSCIMUser(scimUser: SCIMUser): Email | null {
    if (!scimUser.emails || scimUser.emails.length === 0) {
      return null;
    }

    // Find primary email first
    const primaryEmail = scimUser.emails.find(email => email.primary);
    if (primaryEmail) {
      return new Email(primaryEmail.value);
    }

    // Otherwise, use the first email
    return new Email(scimUser.emails[0]!.value);
  }

  public static extractNameFromSCIMUser(scimUser: SCIMUser): Name | null {
    if (scimUser.name?.formatted) {
      return new Name(scimUser.name.formatted);
    }

    if (scimUser.displayName) {
      return new Name(scimUser.displayName);
    }

    if (scimUser.name?.givenName || scimUser.name?.familyName) {
      const fullName = `${scimUser.name.givenName || ""} ${scimUser.name.familyName || ""}`.trim();
      if (fullName) {
        return new Name(fullName);
      }
    }

    return null;
  }

  // Group Operations
  public static async createGroup(
    scimBaseUrl: URL,
    bearerToken: string,
    group: Omit<SCIMGroup, "id" | "meta">,
  ): Promise<SCIMGroup> {
    try {
      const groupData = {
        schemas: [SCIMUtil.SCIM_SCHEMAS.CORE_GROUP],
        ...group,
      };

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post<JSONObject>(
        scimBaseUrl.addRoute(new Route("/Groups")),
        groupData,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        throw new ServerException(response.message || "Failed to create SCIM group");
      }

      logger.info(`SCIM group created: ${group.displayName}`);
      return response.data as unknown as SCIMGroup;
    } catch (error: any) {
      logger.error(`Failed to create SCIM group: ${group.displayName} - ${error.message}`);
      throw new ServerException(`Failed to create SCIM group: ${error.message}`);
    }
  }

  public static async addUserToGroup(
    scimBaseUrl: URL,
    bearerToken: string,
    groupId: string,
    userId: string,
    userDisplayName?: string,
  ): Promise<void> {
    try {
      const patchData = {
        schemas: [SCIMUtil.SCIM_SCHEMAS.PATCH_OP],
        Operations: [
          {
            op: "add",
            path: "members",
            value: [
              {
                value: userId,
                display: userDisplayName,
                type: "User",
              },
            ],
          },
        ],
      };

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.patch<JSONObject>(
        scimBaseUrl.addRoute(new Route(`/Groups/${groupId}`)),
        patchData,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        throw new ServerException(response.message || "Failed to add user to group");
      }

      logger.info(`SCIM user ${userId} added to group ${groupId}`);
    } catch (error: any) {
      logger.error(`Failed to add SCIM user ${userId} to group ${groupId} - ${error.message}`);
      throw new ServerException(`Failed to add user to group: ${error.message}`);
    }
  }

  public static async removeUserFromGroup(
    scimBaseUrl: URL,
    bearerToken: string,
    groupId: string,
    userId: string,
  ): Promise<void> {
    try {
      const patchData = {
        schemas: [SCIMUtil.SCIM_SCHEMAS.PATCH_OP],
        Operations: [
          {
            op: "remove",
            path: `members[value eq "${userId}"]`,
          },
        ],
      };

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.patch<JSONObject>(
        scimBaseUrl.addRoute(new Route(`/Groups/${groupId}`)),
        patchData,
        SCIMUtil.createHeaders(bearerToken),
        { timeout: 30000 },
      );

      if (response instanceof HTTPErrorResponse) {
        throw new ServerException(response.message || "Failed to remove user from group");
      }

      logger.info(`SCIM user ${userId} removed from group ${groupId}`);
    } catch (error: any) {
      logger.error(`Failed to remove SCIM user ${userId} from group ${groupId} - ${error.message}`);
      throw new ServerException(`Failed to remove user from group: ${error.message}`);
    }
  }

  public static convertUserToSCIMUser(user: any): Omit<SCIMUser, "id" | "meta"> {
    const firstName = user.name?.firstName || "";
    const lastName = user.name?.lastName || "";
    
    return {
      userName: user.email?.toString() || "",
      emails: [
        {
          value: user.email?.toString() || "",
          type: "work",
          primary: true,
        },
      ],
      name: {
        formatted: `${firstName} ${lastName}`.trim() || user.name?.toString() || "",
        givenName: firstName,
        familyName: lastName,
      },
      displayName: user.name?.toString() || user.email?.toString() || "",
      active: true,
    };
  }
}
