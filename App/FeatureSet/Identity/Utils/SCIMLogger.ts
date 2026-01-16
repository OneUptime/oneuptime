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
  statusMessage?: string;
  httpMethod?: string;
  requestPath?: string;
  httpStatusCode?: number;
  affectedUserEmail?: string;
  affectedGroupName?: string;
  requestBody?: JSONObject;
  responseBody?: JSONObject;
}

export interface StatusPageSCIMLogData {
  projectId: ObjectID;
  statusPageId: ObjectID;
  statusPageScimId: ObjectID;
  operationType: string;
  status: SCIMLogStatus;
  statusMessage?: string;
  httpMethod?: string;
  requestPath?: string;
  httpStatusCode?: number;
  affectedUserEmail?: string;
  requestBody?: JSONObject;
  responseBody?: JSONObject;
}

const sanitizeSensitiveData = (data: JSONObject | undefined): JSONObject | undefined => {
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
        if (sensitiveKeys.some((k: string) => key.toLowerCase().includes(k.toLowerCase()))) {
          result[key] = "[REDACTED]";
        } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          result[key] = sanitizeRecursive(value as JSONObject);
        } else if (Array.isArray(value)) {
          result[key] = (value as JSONArray).map((item: JSONValue) => {
            if (typeof item === "object" && item !== null && !Array.isArray(item)) {
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

const buildLogBody = (data: {
  requestBody?: JSONObject;
  responseBody?: JSONObject;
  timestamp: Date;
}): string => {
  const logBody: JSONObject = {
    timestamp: data.timestamp.toISOString(),
    request: sanitizeSensitiveData(data.requestBody),
    response: sanitizeSensitiveData(data.responseBody),
  };
  return JSON.stringify(logBody);
};

export const createProjectSCIMLog = async (data: ProjectSCIMLogData): Promise<void> => {
  try {
    const log: ProjectSCIMLog = new ProjectSCIMLog();
    log.projectId = data.projectId;
    log.projectScimId = data.projectScimId;
    log.operationType = data.operationType;
    log.status = data.status;
    log.statusMessage = data.statusMessage;
    log.httpMethod = data.httpMethod;
    log.requestPath = data.requestPath;
    log.httpStatusCode = data.httpStatusCode;
    log.affectedUserEmail = data.affectedUserEmail;
    log.affectedGroupName = data.affectedGroupName;
    log.logBody = buildLogBody({
      requestBody: data.requestBody,
      responseBody: data.responseBody,
      timestamp: new Date(),
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

export const createStatusPageSCIMLog = async (data: StatusPageSCIMLogData): Promise<void> => {
  try {
    const log: StatusPageSCIMLog = new StatusPageSCIMLog();
    log.projectId = data.projectId;
    log.statusPageId = data.statusPageId;
    log.statusPageScimId = data.statusPageScimId;
    log.operationType = data.operationType;
    log.status = data.status;
    log.statusMessage = data.statusMessage;
    log.httpMethod = data.httpMethod;
    log.requestPath = data.requestPath;
    log.httpStatusCode = data.httpStatusCode;
    log.affectedUserEmail = data.affectedUserEmail;
    log.logBody = buildLogBody({
      requestBody: data.requestBody,
      responseBody: data.responseBody,
      timestamp: new Date(),
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
