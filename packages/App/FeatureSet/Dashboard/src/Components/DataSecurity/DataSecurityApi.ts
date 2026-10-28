import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DATA_SECURITY_API_ROUTES,
  DataSecurityComplianceResponse,
  DataSecurityExplainResult,
  DataSecurityFixResult,
  DataSecurityOverview,
  DataSecurityRecordOfProcessingResponse,
  DataSecurityScrubResult,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Dashboard's side of Data Security's own routes (Server/API/
 * DataSecurityAPI.ts): what is worked out on request - the Overview, the
 * compliance scores, the record of processing - and the actions a page
 * offers. Every request goes through the refresh-aware client with the
 * project's headers, like every other page's.
 */

export class DataSecurityApiError extends Error {
  public readonly statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function post(route: string, data: JSONObject = {}): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw new DataSecurityApiError(
      API.getFriendlyMessage(response),
      response.statusCode,
    );
  }

  const body: JSONValue = response.data as JSONValue;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

export default class DataSecurityApi {
  public static async getOverview(): Promise<DataSecurityOverview> {
    return (await post(
      DATA_SECURITY_API_ROUTES.overview,
    )) as unknown as DataSecurityOverview;
  }

  public static async getCompliance(): Promise<DataSecurityComplianceResponse> {
    return (await post(
      DATA_SECURITY_API_ROUTES.compliance,
    )) as unknown as DataSecurityComplianceResponse;
  }

  public static async getRecordOfProcessing(): Promise<DataSecurityRecordOfProcessingResponse> {
    return (await post(
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
    )) as unknown as DataSecurityRecordOfProcessingResponse;
  }

  public static async scanNow(dataStoreId: ObjectID): Promise<void> {
    await post(DATA_SECURITY_API_ROUTES.scanNow(dataStoreId.toString()));
  }

  public static async checkNow(dataStoreId: ObjectID): Promise<void> {
    await post(DATA_SECURITY_API_ROUTES.checkNow(dataStoreId.toString()));
  }

  public static async scrubFinding(
    findingId: ObjectID,
  ): Promise<DataSecurityScrubResult> {
    return (await post(
      DATA_SECURITY_API_ROUTES.scrubFinding(findingId.toString()),
    )) as unknown as DataSecurityScrubResult;
  }

  public static async explainIssue(
    issueId: ObjectID,
  ): Promise<DataSecurityExplainResult> {
    return (await post(
      DATA_SECURITY_API_ROUTES.explainIssue(issueId.toString()),
    )) as unknown as DataSecurityExplainResult;
  }

  public static async fixIssueWithAi(
    issueId: ObjectID,
    codeRepositoryId?: ObjectID | undefined,
  ): Promise<DataSecurityFixResult> {
    return (await post(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(issueId.toString()),
      codeRepositoryId ? { codeRepositoryId: codeRepositoryId.toString() } : {},
    )) as unknown as DataSecurityFixResult;
  }
}
