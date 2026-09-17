import { JSONObject } from "../JSON";
import {
  AIResourceSubresource,
  AIResourceType,
  isAIResourceSubresourceKind,
  isAIResourceType,
} from "./AIResourceContext";

/*
 * "Page context" makes Ask AI aware of what the user is looking at in the
 * dashboard. The client detects the current page (an incident, a monitor, a
 * trace waterfall, the logs explorer, …) and attaches this small descriptor to
 * each message it sends; the server folds it into the system prompt so "this
 * incident" resolves to the entity on screen. The latest context is kept as
 * the conversation's subject. Sending null explicitly detaches and clears
 * that subject; omitting context lets a full-page conversation keep it.
 */
enum AIChatPageContextType {
  // Entity pages — carry the entity's id (and usually a display title).
  Incident = "Incident",
  Alert = "Alert",
  Monitor = "Monitor",
  ScheduledMaintenanceEvent = "ScheduledMaintenanceEvent",
  TelemetryService = "TelemetryService",
  RumApplication = "RumApplication",
  Resource = "Resource",
  Trace = "Trace",
  Exception = "Exception",

  // Area pages — no id; the user is browsing a list or an explorer.
  IncidentsList = "IncidentsList",
  AlertsList = "AlertsList",
  MonitorsList = "MonitorsList",
  ScheduledMaintenanceList = "ScheduledMaintenanceList",
  LogsExplorer = "LogsExplorer",
  TracesExplorer = "TracesExplorer",
  MetricsExplorer = "MetricsExplorer",
  ExceptionsList = "ExceptionsList",
  RumApplications = "RumApplications",
  TelemetryServicesList = "TelemetryServicesList",
  ResourcesList = "ResourcesList",
}

export default AIChatPageContextType;

export interface AIChatPageContext {
  type: AIChatPageContextType;
  // The entity on screen (UUID, or a hex trace id). Only set for entity types.
  entityId?: string | undefined;
  // Display title of the entity (incident title, monitor name, …). Optional.
  entityTitle?: string | undefined;
  resourceType?: AIResourceType | undefined;
  subresource?: AIResourceSubresource | undefined;
}

/*
 * Ids are OneUptime ObjectIDs (UUIDs) — except traces, whose ids are
 * OpenTelemetry hex strings. Anything else is rejected: the id is echoed into
 * the LLM prompt and into tool suggestions, so it must never carry free-form
 * text (e.g. a static route segment like "overview" that a :id URL wildcard
 * can capture).
 */
const UUID_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACE_ID_REGEX: RegExp = /^[0-9a-fA-F]{8,64}$/;

const MAX_ENTITY_TITLE_LENGTH: number = 200;

const ENTITY_TYPES: Array<AIChatPageContextType> = [
  AIChatPageContextType.Incident,
  AIChatPageContextType.Alert,
  AIChatPageContextType.Monitor,
  AIChatPageContextType.ScheduledMaintenanceEvent,
  AIChatPageContextType.TelemetryService,
  AIChatPageContextType.RumApplication,
  AIChatPageContextType.Resource,
  AIChatPageContextType.Trace,
  AIChatPageContextType.Exception,
];

export class AIChatPageContextHelper {
  /*
   * Titles are presentation hints; only the resource and child identity decide
   * whether navigation has selected a different conversation subject.
   */
  public static getIdentity(context: AIChatPageContext): string {
    return JSON.stringify([
      context.type,
      context.entityId || null,
      context.resourceType || null,
      context.subresource?.kind || null,
      context.subresource?.key || null,
      context.subresource?.namespace || null,
    ]);
  }

  public static isValidType(
    value: string | undefined,
  ): value is AIChatPageContextType {
    return Object.values(AIChatPageContextType).includes(
      value as AIChatPageContextType,
    );
  }

  // Entity types point at one specific record and require an entityId.
  public static isEntityType(type: AIChatPageContextType): boolean {
    return ENTITY_TYPES.includes(type);
  }

  /*
   * Validate and sanitize an untrusted client-supplied page context. Returns
   * undefined when the payload is missing or invalid — page context is a hint,
   * so a bad one is dropped rather than failing the message.
   */
  public static sanitize(
    json: JSONObject | undefined | null,
  ): AIChatPageContext | undefined {
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return undefined;
    }

    const type: string | undefined =
      typeof json["type"] === "string" ? (json["type"] as string) : undefined;

    if (!this.isValidType(type)) {
      return undefined;
    }

    const context: AIChatPageContext = { type: type };

    if (
      type === AIChatPageContextType.Resource ||
      type === AIChatPageContextType.ResourcesList
    ) {
      if (!isAIResourceType(json["resourceType"])) {
        return undefined;
      }
      context.resourceType = json["resourceType"];
    }

    if (this.isEntityType(type)) {
      const entityId: string =
        typeof json["entityId"] === "string"
          ? (json["entityId"] as string).trim()
          : "";

      const idRegex: RegExp =
        type === AIChatPageContextType.Trace ? TRACE_ID_REGEX : UUID_REGEX;

      // An entity context without a usable id is meaningless — drop it whole.
      if (!idRegex.test(entityId)) {
        return undefined;
      }

      context.entityId = entityId;

      if (
        type === AIChatPageContextType.Resource &&
        json["subresource"] !== undefined
      ) {
        const raw: unknown = json["subresource"];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          return undefined;
        }
        const child: JSONObject = raw as JSONObject;
        if (
          !context.resourceType ||
          !isAIResourceSubresourceKind(context.resourceType, child["kind"])
        ) {
          return undefined;
        }
        const subresource: AIResourceSubresource = { kind: child["kind"] };
        if (child["key"] !== undefined) {
          // eslint-disable-next-line no-control-regex
          const controlCharacters: RegExp = /[\u0000-\u001F\u007F]/;
          if (
            typeof child["key"] !== "string" ||
            !child["key"].trim() ||
            child["key"].length > 512 ||
            controlCharacters.test(child["key"])
          ) {
            return undefined;
          }
          subresource.key = child["key"].trim();
        }
        if (child["namespace"] !== undefined) {
          const namespacePattern: RegExp = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
          if (
            context.resourceType !== AIResourceType.KubernetesCluster ||
            typeof child["namespace"] !== "string" ||
            child["namespace"].length > 63 ||
            !namespacePattern.test(child["namespace"])
          ) {
            return undefined;
          }
          subresource.namespace = child["namespace"];
        }
        context.subresource = subresource;
      }

      if (typeof json["entityTitle"] === "string") {
        /*
         * The title is echoed into the system prompt: collapse whitespace and
         * control characters so it cannot introduce new lines or fake
         * prompt structure, and cap the length.
         */
        const entityTitle: string = (json["entityTitle"] as string)
          // eslint-disable-next-line no-control-regex
          .replace(/[\u0000-\u001F\u007F]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, MAX_ENTITY_TITLE_LENGTH);

        if (entityTitle) {
          context.entityTitle = entityTitle;
        }
      }
    }

    return context;
  }
}
