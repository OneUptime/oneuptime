import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";
import {
  DATA_SECURITY_API_ROUTES,
  DataSecurityComplianceResponse,
  DataSecurityDropMetricImpact,
  DataSecurityDropMetricResult,
  DataSecurityExplainResult,
  DataSecurityMetricUser,
  DataSecurityMetricUserWidget,
  DataSecurityFindingOccurrences,
  DataSecurityFixResult,
  DataSecurityOverview,
  DataSecurityRecordOfProcessingResponse,
  DataSecurityResourceComplianceResponse,
  DataSecurityResourceScope,
  DataSecurityResponseAvailability,
  DataSecurityResponseResult,
  DataSecurityScrubResult,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  DataStoreResourceKind,
  isDataStoreResourceKind,
} from "Common/Types/DataSecurity/DataStoreResource";
import { DataSecurityResponseAction } from "Common/Types/DataSecurity/DataSecurityResponseAction";
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

function readIds(value: JSONValue | undefined): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Array<string> = [];

  for (const id of value as Array<unknown>) {
    if (typeof id === "string" && ObjectID.isValidUUID(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * A resource's scope read defensively: ids that are not ids are dropped,
 * and an answer without one lists no store, so a page never reads every
 * store of the project in its place.
 */
export function parseResourceScope(
  body: JSONObject,
): DataSecurityResourceScope {
  const owner: JSONValue | undefined = body["complianceOwner"];
  const ownerObject: JSONObject | null =
    owner && typeof owner === "object" && !Array.isArray(owner)
      ? (owner as JSONObject)
      : null;
  const ownerKind: JSONValue | undefined = ownerObject?.["kind"];
  const ownerId: JSONValue | undefined = ownerObject?.["id"];

  return {
    kind: isDataStoreResourceKind(body["kind"])
      ? body["kind"]
      : DataStoreResourceKind.KubernetesCluster,
    id: typeof body["id"] === "string" ? body["id"] : "",
    name: typeof body["name"] === "string" ? body["name"] : "",
    dataStoreIds: readIds(body["dataStoreIds"]),
    ownedDataStoreIds: readIds(body["ownedDataStoreIds"]),
    complianceOwner:
      isDataStoreResourceKind(ownerKind) &&
      typeof ownerId === "string" &&
      ObjectID.isValidUUID(ownerId)
        ? {
            kind: ownerKind,
            id: ownerId,
            name:
              typeof ownerObject?.["name"] === "string"
                ? (ownerObject["name"] as string)
                : "",
          }
        : null,
    isTruncated: body["isTruncated"] === true,
  };
}

export default class DataSecurityApi {
  /*
   * In the reader's zone: the issue trend counts the reader's days, as every
   * other day chart does (issue #7925). A zone the list does not name is not
   * sent, and those days stay UTC's.
   */
  public static async getOverview(): Promise<DataSecurityOverview> {
    const timezone: Timezone | undefined =
      AggregationIntervalUtil.getListedReaderTimezone();

    return (await post(
      DATA_SECURITY_API_ROUTES.overview,
      timezone ? { timezone } : {},
    )) as unknown as DataSecurityOverview;
  }

  public static async getCompliance(): Promise<DataSecurityComplianceResponse> {
    return (await post(
      DATA_SECURITY_API_ROUTES.compliance,
    )) as unknown as DataSecurityComplianceResponse;
  }

  /*
   * A resource's own pages (#9547, #9555): the stores they show - a
   * cluster's or a container host's databases', a database's, a cloud
   * resource's, a service's telemetry - and how they stand against each
   * framework.
   */
  public static async getResourceScope(data: {
    kind: DataStoreResourceKind;
    id: ObjectID;
  }): Promise<DataSecurityResourceScope> {
    return parseResourceScope(
      await post(DATA_SECURITY_API_ROUTES.resourceScope, {
        kind: data.kind,
        id: data.id.toString(),
      }),
    );
  }

  public static async getResourceCompliance(data: {
    kind: DataStoreResourceKind;
    id: ObjectID;
  }): Promise<DataSecurityResourceComplianceResponse> {
    return (await post(DATA_SECURITY_API_ROUTES.resourceCompliance, {
      kind: data.kind,
      id: data.id.toString(),
    })) as unknown as DataSecurityResourceComplianceResponse;
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

  /*
   * What dropping the metrics whose names hold a finding's data would do
   * (#9757, #9946): asked before the drop, which it never makes. Read
   * defensively: a reader without an id is no reader, a widget without an
   * id no widget, and a count that is no count is none.
   */
  public static async getDropMetricImpact(
    findingId: ObjectID,
  ): Promise<DataSecurityDropMetricImpact> {
    const answer: JSONObject = await post(
      DATA_SECURITY_API_ROUTES.dropMetricImpact(findingId.toString()),
    );
    const textOf: (value: unknown) => string = (value: unknown): string => {
      return typeof value === "string" ? value : "";
    };
    const widgetsOf: (value: unknown) => Array<DataSecurityMetricUserWidget> = (
      value: unknown,
    ): Array<DataSecurityMetricUserWidget> => {
      return (Array.isArray(value) ? value : [])
        .map((widget: unknown): JSONObject => {
          return (
            widget && typeof widget === "object" ? widget : {}
          ) as JSONObject;
        })
        .filter((widget: JSONObject): boolean => {
          return Boolean(textOf(widget["id"]));
        })
        .map((widget: JSONObject): DataSecurityMetricUserWidget => {
          return {
            id: textOf(widget["id"]),
            title: textOf(widget["title"]),
            type: textOf(widget["type"]),
          };
        });
    };
    const usersOf: (
      value: JSONValue | undefined,
    ) => Array<DataSecurityMetricUser> = (
      value: JSONValue | undefined,
    ): Array<DataSecurityMetricUser> => {
      const users: Array<DataSecurityMetricUser> = [];

      for (const user of Array.isArray(value) ? value : []) {
        const entry: JSONObject = (
          user && typeof user === "object" ? user : {}
        ) as JSONObject;

        if (
          typeof entry["id"] !== "string" ||
          !ObjectID.isValidUUID(entry["id"]) ||
          typeof entry["name"] !== "string"
        ) {
          continue;
        }

        const read: DataSecurityMetricUser = {
          id: entry["id"],
          name: entry["name"],
        };

        if (Array.isArray(entry["widgets"])) {
          read.widgets = widgetsOf(entry["widgets"]);
        }

        if (typeof entry["outputMetricName"] === "string") {
          read.outputMetricName = entry["outputMetricName"];
        }

        users.push(read);
      }

      return users;
    };
    const countOf: (value: JSONValue | undefined) => number = (
      value: JSONValue | undefined,
    ): number => {
      return typeof value === "number" && Number.isInteger(value) && value > 0
        ? value
        : 0;
    };

    return {
      ...(answer as unknown as DataSecurityDropMetricImpact),
      isAvailable: answer["isAvailable"] === true,
      metricsMatched:
        typeof answer["metricsMatched"] === "number"
          ? (answer["metricsMatched"] as number)
          : 0,
      isMetricsMatchedCapped: answer["isMetricsMatchedCapped"] === true,
      metricsCounted: answer["metricsCounted"] === true,
      monitors: usersOf(answer["monitors"]),
      dashboards: usersOf(answer["dashboards"]),
      slos: usersOf(answer["slos"]),
      recordingRules: usersOf(answer["recordingRules"]),
      monitorsChecked: answer["monitorsChecked"] === true,
      dashboardsChecked: answer["dashboardsChecked"] === true,
      slosChecked: answer["slosChecked"] === true,
      recordingRulesChecked: answer["recordingRulesChecked"] === true,
      monitorsHidden: countOf(answer["monitorsHidden"]),
      dashboardsHidden: countOf(answer["dashboardsHidden"]),
      slosHidden: countOf(answer["slosHidden"]),
      recordingRulesHidden: countOf(answer["recordingRulesHidden"]),
    };
  }

  /*
   * The drop itself: the service's new data points of those metrics are
   * dropped at ingest from now on, and lost for good.
   */
  public static async dropMetric(
    findingId: ObjectID,
  ): Promise<DataSecurityDropMetricResult> {
    return (await post(
      DATA_SECURITY_API_ROUTES.dropMetric(findingId.toString()),
      { confirmDataLoss: true },
    )) as unknown as DataSecurityDropMetricResult;
  }

  // The newest records a telemetry finding's data was seen in, read now.
  public static async getFindingOccurrences(
    findingId: ObjectID,
  ): Promise<DataSecurityFindingOccurrences> {
    const answer: JSONObject = await post(
      DATA_SECURITY_API_ROUTES.findingOccurrences(findingId.toString()),
    );

    return {
      ...(answer as unknown as DataSecurityFindingOccurrences),
      occurrences: Array.isArray(answer["occurrences"])
        ? (answer[
            "occurrences"
          ] as unknown as DataSecurityFindingOccurrences["occurrences"])
        : [],
    };
  }

  public static async explainIssue(
    issueId: ObjectID,
  ): Promise<DataSecurityExplainResult> {
    return (await post(
      DATA_SECURITY_API_ROUTES.explainIssue(issueId.toString()),
    )) as unknown as DataSecurityExplainResult;
  }

  // Which response actions a store can take now, and why not.
  public static async getResponseActions(
    dataStoreId: ObjectID,
  ): Promise<DataSecurityResponseAvailability> {
    return (await post(
      DATA_SECURITY_API_ROUTES.responseActions(dataStoreId.toString()),
    )) as unknown as DataSecurityResponseAvailability;
  }

  // Block public access, or revoke sharing, on a store - from one of its issues.
  public static async respond(data: {
    dataStoreId: ObjectID;
    action: DataSecurityResponseAction;
    dataSecurityIssueId?: ObjectID | undefined;
  }): Promise<DataSecurityResponseResult> {
    return (await post(
      DATA_SECURITY_API_ROUTES.respond(data.dataStoreId.toString()),
      {
        action: data.action,
        ...(data.dataSecurityIssueId
          ? { dataSecurityIssueId: data.dataSecurityIssueId.toString() }
          : {}),
      },
    )) as unknown as DataSecurityResponseResult;
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
