import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DeclaredIncident,
  EntityActivity,
  EntityFindingSummary,
  SecurityOverview,
  parseEntityActivity,
  parseOverview,
  parseTopEntities,
} from "./SecurityCaseApiTypes";
import {
  SecuritySetupStatus,
  SecuritySetupTestResult,
  TurnOnRecommendedResult,
  parseSecuritySetupStatus,
  parseSetupTestResult,
  parseTurnOnRecommendedResult,
} from "../SecurityOverview/SecuritySetupModel";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

export type {
  DeclaredIncident,
  EntityActivity,
  EntityFindingSummary,
  SecurityOverview,
};

/*
 * The Security product's own routes, beside the CRUD the model tables use
 * (Common/Server/API/SecurityCaseAPI.ts and SecurityPlaybookRunAPI.ts). Each
 * call reads the response defensively: a field the server left out reads as
 * nothing rather than throwing in a render.
 */

export class SecurityApiError extends Error {}

function routeUrl(route: string): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(route);
}

async function post(route: string, data: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: routeUrl(route),
      data: data,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw new SecurityApiError(API.getFriendlyMessage(response));
  }

  const body: JSONValue = response.data as JSONValue;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

export default class SecurityCaseApi {
  public static async getOverview(): Promise<SecurityOverview> {
    return parseOverview(await post("/security-case/overview", {}));
  }

  public static async getEntityActivity(data: {
    values: Array<string>;
    hours: number;
  }): Promise<Array<EntityActivity>> {
    if (data.values.length === 0) {
      return [];
    }

    return parseEntityActivity(
      await post("/security-case/entity-activity", {
        values: data.values,
        hours: data.hours,
      }),
    );
  }

  public static async getTopEntities(data: {
    days: number;
    limit: number;
  }): Promise<Array<EntityFindingSummary>> {
    return parseTopEntities(
      await post("/security-case/top-entities", {
        days: data.days,
        limit: data.limit,
      }),
    );
  }

  public static async declareIncident(data: {
    caseId: ObjectID;
    incidentSeverityId: ObjectID;
  }): Promise<DeclaredIncident> {
    const body: JSONObject = await post(
      `/security-case/${data.caseId.toString()}/declare-incident`,
      { incidentSeverityId: data.incidentSeverityId.toString() },
    );

    return {
      incidentId: String(body["incidentId"] || ""),
      incidentNumber: String(body["incidentNumber"] || ""),
    };
  }

  // How Security is set up: the Overview's pipeline and Get started.
  public static async getSetupStatus(): Promise<SecuritySetupStatus> {
    return parseSecuritySetupStatus(
      await post("/security-case/setup/status", {}),
    );
  }

  /*
   * The one click: your logs as a source, the recommended rules and the
   * Enrich New Cases playbook - or only the parts asked for.
   */
  public static async turnOnRecommended(
    options: { logs?: boolean; detections?: boolean; playbook?: boolean } = {},
  ): Promise<TurnOnRecommendedResult> {
    return parseTurnOnRecommendedResult(
      await post("/security-case/setup/turn-on-recommended", {
        logs: options.logs !== false,
        detections: options.detections !== false,
        playbook: options.playbook !== false,
      }),
    );
  }

  // A harmless simulated attack through the real pipeline.
  public static async runSetupTest(): Promise<SecuritySetupTestResult> {
    return parseSetupTestResult(await post("/security-case/setup/test", {}));
  }

  public static async decideApproval(data: {
    runId: ObjectID;
    isApproved: boolean;
    comment?: string | undefined;
    // For a step that acts on users or hosts: the ones the approver kept ticked.
    targets?: Array<string> | undefined;
  }): Promise<void> {
    await post(
      `/security-playbook-run/${data.runId.toString()}/${
        data.isApproved ? "approve" : "reject"
      }`,
      {
        ...(data.comment ? { comment: data.comment } : {}),
        ...(data.isApproved && data.targets ? { targets: data.targets } : {}),
      },
    );
  }

  // Releases one target a containment step contained, with the step's undo.
  public static async undoTarget(data: {
    runId: ObjectID;
    stepId: string;
    value: string;
  }): Promise<void> {
    await post(`/security-playbook-run/${data.runId.toString()}/undo`, {
      stepId: data.stepId,
      value: data.value,
    });
  }
}
