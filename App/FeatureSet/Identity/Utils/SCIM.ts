import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import ServerException from "Common/Types/Exception/ServerException";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import logger from "Common/Server/Utils/Logger";
import axios, { AxiosResponse } from "axios";

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

  public static createAxiosConfig(bearerToken: string): JSONObject {
    return {
      headers: {
        "Content-Type": "application/scim+json",
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/scim+json",
      },
      timeout: 30000,
    };
  }

  public static async createUser(
    scimBaseUrl: URL,
    bearerToken: string,
    user: Omit<SCIMUser, "id" | "meta">,
  ): Promise<SCIMUser> {
    try {
      const url = `${scimBaseUrl.toString()}/Users`;
      const userData = {
        schemas: [SCIMUtil.SCIM_SCHEMAS.CORE_USER],
        ...user,
      };

      const response: AxiosResponse<SCIMUser> = await axios.post(
        url,
        userData,
        SCIMUtil.createAxiosConfig(bearerToken) as any,
      );

      logger.info(`SCIM user created: ${user.userName}`);
      return response.data;
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
      const url = `${scimBaseUrl.toString()}/Users/${userId}`;
      const userData = {
        schemas: [SCIMUtil.SCIM_SCHEMAS.CORE_USER],
        ...user,
      };

      const response: AxiosResponse<SCIMUser> = await axios.put(
        url,
        userData,
        SCIMUtil.createAxiosConfig(bearerToken) as any,
      );

      logger.info(`SCIM user updated: ${userId}`);
      return response.data;
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
      const url = `${scimBaseUrl.toString()}/Users/${userId}`;

      await axios.delete(url, SCIMUtil.createAxiosConfig(bearerToken) as any);

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
      const url = `${scimBaseUrl.toString()}/Users/${userId}`;
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

      const response: AxiosResponse<SCIMUser> = await axios.patch(
        url,
        patchData,
        SCIMUtil.createAxiosConfig(bearerToken) as any,
      );

      logger.info(`SCIM user deactivated: ${userId}`);
      return response.data;
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
      const url = `${scimBaseUrl.toString()}/Users/${userId}`;

      const response: AxiosResponse<SCIMUser> = await axios.get(
        url,
        SCIMUtil.createAxiosConfig(bearerToken) as any,
      );

      return response.data;
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
      const url = `${scimBaseUrl.toString()}/Users`;
      const params = {
        filter: `userName eq "${userName}"`,
        count: 1,
      };

      const response: AxiosResponse<SCIMListResponse<SCIMUser>> = await axios.get(
        url,
        {
          ...SCIMUtil.createAxiosConfig(bearerToken),
          params,
        } as any,
      );

      if (response.data.totalResults > 0) {
        return response.data.Resources[0] || null;
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
      const url = `${scimBaseUrl.toString()}/Users`;
      const params = {
        startIndex: options?.startIndex || 1,
        count: options?.count || 100,
        ...(options?.filter && { filter: options.filter }),
      };

      const response: AxiosResponse<SCIMListResponse<SCIMUser>> = await axios.get(
        url,
        {
          ...SCIMUtil.createAxiosConfig(bearerToken),
          params,
        } as any,
      );

      return response.data;
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
      const url = `${scimBaseUrl.toString()}/Users`;
      const params = {
        count: 1,
      };

      await axios.get(url, {
        ...SCIMUtil.createAxiosConfig(bearerToken),
        params,
      } as any);

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
      const url = `${scimBaseUrl.toString()}/Groups`;
      const groupData = {
        schemas: [SCIMUtil.SCIM_SCHEMAS.CORE_GROUP],
        ...group,
      };

      const response: AxiosResponse<SCIMGroup> = await axios.post(
        url,
        groupData,
        SCIMUtil.createAxiosConfig(bearerToken) as any,
      );

      logger.info(`SCIM group created: ${group.displayName}`);
      return response.data;
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
      const url = `${scimBaseUrl.toString()}/Groups/${groupId}`;
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

      await axios.patch(
        url,
        patchData,
        SCIMUtil.createAxiosConfig(bearerToken) as any,
      );

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
      const url = `${scimBaseUrl.toString()}/Groups/${groupId}`;
      const patchData = {
        schemas: [SCIMUtil.SCIM_SCHEMAS.PATCH_OP],
        Operations: [
          {
            op: "remove",
            path: `members[value eq "${userId}"]`,
          },
        ],
      };

      await axios.patch(
        url,
        patchData,
        SCIMUtil.createAxiosConfig(bearerToken) as any,
      );

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
