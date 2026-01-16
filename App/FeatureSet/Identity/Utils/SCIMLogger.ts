import ProjectSCIMLog from "Common/Models/DatabaseModels/ProjectSCIMLog";
import StatusPageSCIMLog from "Common/Models/DatabaseModels/StatusPageSCIMLog";
import ProjectSCIMLogService from "Common/Server/Services/ProjectSCIMLogService";
import StatusPageSCIMLogService from "Common/Server/Services/StatusPageSCIMLogService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import SCIMLogStatus from "Common/Types/SCIM/SCIMLogStatus";
import { JSONObject, JSONValue, JSONArray } from "Common/Types/JSON";

export interface ProjectSCIMLogData {
  projectId: ObjectID;
  projectScimId: ObjectID;
  operationType: string;
  status: SCIMLogStatus;
  statusMessage?: string | undefined;
  httpMethod?: string | undefined;
  requestPath?: string | undefined;
  httpStatusCode?: number | undefined;
  affectedUserEmail?: string | undefined;
  affectedGroupName?: string | undefined;
  requestBody?: JSONObject | undefined;
  responseBody?: JSONObject | undefined;
  queryParams?: JSONObject | undefined;
  steps?: string[] | undefined;
  userInfo?: JSONObject | undefined;
  groupInfo?: JSONObject | undefined;
  additionalContext?: JSONObject | undefined;
}

export interface StatusPageSCIMLogData {
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPageScimId: ObjectID;
  operationType: string;
  status: SCIMLogStatus;
  statusMessage?: string | undefined;
  httpMethod?: string | undefined;
  requestPath?: string | undefined;
  httpStatusCode?: number | undefined;
  affectedUserEmail?: string | undefined;
  requestBody?: JSONObject | undefined;
  responseBody?: JSONObject | undefined;
  queryParams?: JSONObject | undefined;
  steps?: string[] | undefined;
  userInfo?: JSONObject | undefined;
  additionalContext?: JSONObject | undefined;
}

const sanitizeSensitiveData = (
  data: JSONObject | undefined,
): JSONObject | undefined => {
  if (!data) {
    return undefined;
  }

  const sanitized: JSONObject = { ...data };
  const sensitiveKeys: string[] = [
    "password",
    "bearerToken",
    "bearer_token",
    "authorization",
    "Authorization",
    "token",
    "secret",
    "apiKey",
    "api_key",
  ];

  const sanitizeRecursive = (obj: JSONObject): JSONObject => {
    const result: JSONObject = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value: JSONValue = obj[key];
        if (
          sensitiveKeys.some((k: string) => {
            return key.toLowerCase().includes(k.toLowerCase());
          })
        ) {
          result[key] = "[REDACTED]";
        } else if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          result[key] = sanitizeRecursive(value as JSONObject);
        } else if (Array.isArray(value)) {
          result[key] = (value as JSONArray).map((item: JSONValue) => {
            if (
              typeof item === "object" &&
              item !== null &&
              !Array.isArray(item)
            ) {
              return sanitizeRecursive(item as JSONObject);
            }
            return item;
          }) as JSONArray;
        } else {
          result[key] = value;
        }
      }
    }
    return result;
  };

  return sanitizeRecursive(sanitized);
};

export interface LogBodyDetails {
  requestBody?: JSONObject | undefined;
  responseBody?: JSONObject | undefined;
  timestamp: Date;
  queryParams?: JSONObject | undefined;
  steps?: string[] | undefined;
  userInfo?: JSONObject | undefined;
  groupInfo?: JSONObject | undefined;
  additionalContext?: JSONObject | undefined;
}

const buildLogBody = (data: LogBodyDetails): string => {
  const logBody: JSONObject = {
    timestamp: data.timestamp.toISOString(),
    executedAt: data.timestamp.toISOString(),
  };

  if (data.queryParams && Object.keys(data.queryParams).length > 0) {
    logBody["queryParameters"] = data.queryParams;
  }

  if (data.requestBody) {
    logBody["request"] = sanitizeSensitiveData(data.requestBody);
  }

  if (data.responseBody) {
    logBody["response"] = sanitizeSensitiveData(data.responseBody);
  }

  if (data.steps && data.steps.length > 0) {
    logBody["executionSteps"] = data.steps;
  }

  if (data.userInfo) {
    logBody["userDetails"] = sanitizeSensitiveData(data.userInfo);
  }

  if (data.groupInfo) {
    logBody["groupDetails"] = sanitizeSensitiveData(data.groupInfo);
  }

  if (data.additionalContext) {
    logBody["additionalContext"] = sanitizeSensitiveData(
      data.additionalContext,
    );
  }

  return JSON.stringify(logBody, null, 2);
};

export const createProjectSCIMLog = async (
  data: ProjectSCIMLogData,
): Promise<void> => {
  try {
    const log: ProjectSCIMLog = new ProjectSCIMLog();
    log.projectId = data.projectId;
    log.projectScimId = data.projectScimId;
    log.operationType = data.operationType;
    log.status = data.status;
    if (data.statusMessage !== undefined) {
      log.statusMessage = data.statusMessage;
    }
    if (data.httpMethod !== undefined) {
      log.httpMethod = data.httpMethod;
    }
    if (data.requestPath !== undefined) {
      log.requestPath = data.requestPath;
    }
    if (data.httpStatusCode !== undefined) {
      log.httpStatusCode = data.httpStatusCode;
    }
    if (data.affectedUserEmail !== undefined) {
      log.affectedUserEmail = data.affectedUserEmail;
    }
    if (data.affectedGroupName !== undefined) {
      log.affectedGroupName = data.affectedGroupName;
    }
    log.logBody = buildLogBody({
      requestBody: data.requestBody,
      responseBody: data.responseBody,
      timestamp: new Date(),
      queryParams: data.queryParams,
      steps: data.steps,
      userInfo: data.userInfo,
      groupInfo: data.groupInfo,
      additionalContext: data.additionalContext,
    });

    await ProjectSCIMLogService.create({
      data: log,
      props: { isRoot: true },
    });
  } catch (err) {
    // Log errors silently to not affect SCIM operations
    logger.error("Failed to create Project SCIM log entry:");
    logger.error(err);
  }
};

export const createStatusPageSCIMLog = async (
  data: StatusPageSCIMLogData,
): Promise<void> => {
  try {
    const log: StatusPageSCIMLog = new StatusPageSCIMLog();
    log.projectId = data.projectId;
    log.statusPageId = data.statusPageId;
    log.statusPageScimId = data.statusPageScimId;
    log.operationType = data.operationType;
    log.status = data.status;
    if (data.statusMessage !== undefined) {
      log.statusMessage = data.statusMessage;
    }
    if (data.httpMethod !== undefined) {
      log.httpMethod = data.httpMethod;
    }
    if (data.requestPath !== undefined) {
      log.requestPath = data.requestPath;
    }
    if (data.httpStatusCode !== undefined) {
      log.httpStatusCode = data.httpStatusCode;
    }
    if (data.affectedUserEmail !== undefined) {
      log.affectedUserEmail = data.affectedUserEmail;
    }
    log.logBody = buildLogBody({
      requestBody: data.requestBody,
      responseBody: data.responseBody,
      timestamp: new Date(),
      queryParams: data.queryParams,
      steps: data.steps,
      userInfo: data.userInfo,
      additionalContext: data.additionalContext,
    });

    await StatusPageSCIMLogService.create({
      data: log,
      props: { isRoot: true },
    });
  } catch (err) {
    // Log errors silently to not affect SCIM operations
    logger.error("Failed to create Status Page SCIM log entry:");
    logger.error(err);
  }
};

export default {
  createProjectSCIMLog,
  createStatusPageSCIMLog,
};
