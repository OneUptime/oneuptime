import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DeclaredIncident,
  EntityActivity,
  SecurityOverview,
  parseEntityActivity,
  parseOverview,
} from "./SecurityCaseApiTypes";
import {
  SecuritySetupStatus,
  SecuritySetupTestResult,
  TurnOnRecommendedResult,
  parseSecuritySetupStatus,
  parseSetupTestResult,
  parseTurnOnRecommendedResult,
} from "../SecurityOverview/SecuritySetupModel";
import {
  SecurityCaseTriageStatusView,
  parseSecurityCaseTriageStatus,
} from "./SecurityCaseAiTriage";
import {
  parseIncidentSecurity,
  parseResourceSecurity,
  parseSecurityConnections,
} from "../SecurityConnections/SecurityConnectionsModel";
import {
  IncidentSecurityJson,
  ResourceSecurityJson,
  SecurityConnectionKind,
  SecurityConnectionsJson,
} from "Common/Types/SecurityCase/SecurityConnection";
import { SecurityEntity } from "Common/Types/SecurityCase/SecurityEntity";
import { SecurityLogResource } from "Common/Utils/SecurityCase/SecurityConnectionMatch";
import { APP_API_URL } from "Common/UI/Config";
import {
  SecurityAttackCampaign,
  SecurityAttackCampaignsResult,
  readSecurityAttackCampaign,
} from "Common/Types/SecurityEvent/SecurityAttackCampaign";
import {
  DetectionRetrohuntResult,
  parseDetectionRetrohuntResult,
} from "Common/Types/SecurityEvent/DetectionRetrohunt";
import {
  SecurityCaseEventsAddResult,
  readSecurityCaseEventsAddResult,
} from "Common/Types/SecurityCase/SecurityCaseEventEvidence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

export type { DeclaredIncident, EntityActivity, SecurityOverview };

/*
 * What Connected Signals is asked about: a case, by its id; or an event's
 * or an entity's values around a time, with the records its log lines were
 * sent under, when known - or, for an entity, read from its events.
 */
export type SecurityConnectionsRequest =
  | { caseId: ObjectID }
  | {
      entities: Array<SecurityEntity>;
      time?: Date | undefined;
      logResources?: Array<SecurityLogResource> | undefined;
      readLogResources?: boolean | undefined;
    };

/*
 * The Security product's own routes, beside the CRUD the model tables use
 * (Common/Server/API/SecurityCaseAPI.ts and SecurityPlaybookRunAPI.ts). Each
 * call reads the response defensively: a field the server left out reads as
 * nothing rather than throwing in a render.
 */

/*
 * A route's refusal or failure: the API's sentence, and the status it came
 * with - which tells a sentence written for people (a role, a plan, a
 * request refused) from a failure on OneUptime's side that the Dashboard
 * words itself (describeSetupCallFailure).
 */
export class SecurityApiError extends Error {
  public readonly statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

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
    throw new SecurityApiError(
      API.getFriendlyMessage(response),
      response.statusCode,
    );
  }

  const body: JSONValue = response.data as JSONValue;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

export default class SecurityCaseApi {
  /*
   * The project's web attacks over a window, one row per address that sent
   * them (Types/SecurityEvent/SecurityAttackCampaign): the Campaigns page.
   */
  public static async getAttackCampaigns(window: {
    startTime: Date;
    endTime: Date;
  }): Promise<SecurityAttackCampaignsResult> {
    const body: JSONObject = await post("/security-event/attack-campaigns", {
      startTime: window.startTime.toISOString(),
      endTime: window.endTime.toISOString(),
    });
    const campaigns: JSONValue | undefined = body["campaigns"];

    return {
      campaigns: Array.isArray(campaigns)
        ? campaigns
            .filter((row: JSONValue): boolean => {
              return Boolean(row) && typeof row === "object";
            })
            .map((row: JSONValue): SecurityAttackCampaign => {
              return readSecurityAttackCampaign(row as JSONObject);
            })
        : [],
      startTime: String(body["startTime"] || window.startTime.toISOString()),
      endTime: String(body["endTime"] || window.endTime.toISOString()),
      isTruncated: body["isTruncated"] === true,
    };
  }

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

  /*
   * Connected Signals: what a case names in the rest of OneUptime - or an
   * event's or an entity's values, around a time - and what is happening on
   * each record (Common/Server/Utils/SecurityEvent/Connections).
   */
  public static async getConnections(
    request: SecurityConnectionsRequest,
  ): Promise<SecurityConnectionsJson> {
    return parseSecurityConnections(
      await post(
        "/security-case/connections",
        "caseId" in request
          ? { caseId: request.caseId.toString() }
          : {
              entities: request.entities.map(
                (entity: SecurityEntity): JSONObject => {
                  return { type: entity.type, value: entity.value };
                },
              ),
              ...(request.time ? { time: request.time.toISOString() } : {}),
              ...(request.logResources && request.logResources.length > 0
                ? {
                    logResources: request.logResources.map(
                      (resource: SecurityLogResource): JSONObject => {
                        return { type: resource.type, id: resource.id };
                      },
                    ),
                  }
                : {}),
              ...(request.readLogResources ? { readLogResources: true } : {}),
            },
      ),
    );
  }

  // What Security Events says about one of the project's records: its page's Security card.
  public static async getResourceSecurity(data: {
    kind: SecurityConnectionKind;
    id: ObjectID;
  }): Promise<ResourceSecurityJson> {
    return parseResourceSecurity(
      await post("/security-case/resource-security", {
        kind: data.kind,
        id: data.id.toString(),
      }),
    );
  }

  // The cases behind an incident, and the open cases naming what it affects.
  public static async getIncidentSecurity(
    incidentId: ObjectID,
  ): Promise<IncidentSecurityJson> {
    return parseIncidentSecurity(
      await post("/security-case/incident-security", {
        incidentId: incidentId.toString(),
      }),
    );
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

  /*
   * OneUptime AI's triage of a case: its latest run, the run's steps while
   * it runs, and what stops a triage now (SecurityCaseTriageStatus).
   */
  public static async getAiTriage(
    caseId: ObjectID,
  ): Promise<SecurityCaseTriageStatusView> {
    return parseSecurityCaseTriageStatus(
      await post(`/security-case/${caseId.toString()}/ai-triage`, {}),
    );
  }

  /*
   * The rows behind one citation ([C#]) of the triage's report, re-run with
   * the viewer's own permissions: the evidence list's Load rows. The raw
   * response, as the evidence list reads it.
   */
  public static async loadAiTriageEvidenceRows(data: {
    caseId: ObjectID;
    runId: string;
    citationId: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    return await API.post<JSONObject>({
      url: routeUrl(
        `/security-case/${data.caseId.toString()}/ai-triage/evidence`,
      ),
      data: { runId: data.runId, citationId: data.citationId },
      headers: { ...ModelAPI.getCommonHeaders() },
    });
  }

  // Triage with AI: asks OneUptime AI to triage the case now.
  public static async startAiTriage(caseId: ObjectID): Promise<string> {
    const body: JSONObject = await post(
      `/security-case/${caseId.toString()}/ai-triage/start`,
      {},
    );

    return String(body["runId"] || "");
  }

  /*
   * OneUptime AI writes a detection rule's Sigma YAML from a description,
   * checked as a saved rule is (DetectionRuleDraft). Nothing is saved.
   */
  public static async draftDetectionRule(description: string): Promise<{
    sigmaRuleYaml: string;
    title: string;
  }> {
    const body: JSONObject = await post("/detection-rule/draft-with-ai", {
      description,
    });

    return {
      sigmaRuleYaml:
        typeof body["sigmaRuleYaml"] === "string"
          ? (body["sigmaRuleYaml"] as string)
          : "",
      title: typeof body["title"] === "string" ? (body["title"] as string) : "",
    };
  }

  /*
   * A detection rule run over past events (POST /detection-rule/retrohunt):
   * a saved rule by its id, the rule as the form holds it, or both - what
   * it would have found, with its exceptions. Nothing is opened or sent.
   */
  public static async runDetectionRuleRetrohunt(
    request: JSONObject,
  ): Promise<DetectionRetrohuntResult> {
    const body: JSONObject = await post("/detection-rule/retrohunt", request);

    return parseDetectionRetrohuntResult(body);
  }

  /*
   * Security events kept on a case as evidence (POST
   * /security-case-evidence/add-events), read by OneUptime as the person
   * asking: which were kept, which the case kept already, and which were
   * not found - each by its id. `huntId` names the hunt that found them.
   */
  public static async addEventsToCase(data: {
    caseId: ObjectID;
    events: Array<{ eventUid: string; time: Date }>;
    huntId?: ObjectID | undefined;
  }): Promise<SecurityCaseEventsAddResult> {
    return readSecurityCaseEventsAddResult(
      await post("/security-case-evidence/add-events", {
        securityCaseId: data.caseId.toString(),
        events: data.events.map(
          (event: { eventUid: string; time: Date }): JSONObject => {
            return {
              eventUid: event.eventUid,
              time: event.time.toISOString(),
            };
          },
        ),
        ...(data.huntId ? { securityHuntId: data.huntId.toString() } : {}),
      }),
    );
  }

  /*
   * Values from a file or a paste put on a watchlist the team keeps (POST
   * /security-watchlist/import): added to what it holds, or replacing it.
   * Answers what it did - the counts, and the lines it left out.
   */
  public static async importWatchlistValues(data: {
    watchlistId: ObjectID;
    text: string;
    mode: string;
  }): Promise<JSONObject> {
    return await post("/security-watchlist/import", {
      securityWatchlistId: data.watchlistId.toString(),
      text: data.text,
      mode: data.mode,
    });
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
