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
  // One security case's page.
  SecurityCase = "SecurityCase",
  // One data store's pages, and one data security issue's (Data Security).
  DataStore = "DataStore",
  DataSecurityIssue = "DataSecurityIssue",
  /*
   * One table's pages in Data Observability - its overview, Lineage tab and
   * the rest: "this table" is the one on screen (#6735).
   */
  DataTable = "DataTable",
  /*
   * One cloud account's pages (Cloud > Accounts > an account): an AWS
   * account, an Azure subscription or a Google Cloud project.
   */
  CloudAccount = "CloudAccount",
  // One workflow's pages, its Builder among them: "this workflow".
  Workflow = "Workflow",
  /*
   * One status page's pages - its Custom Domains, Subscribers, Single
   * Sign-On and the rest - and one on-call policy's: "this status page",
   * "this policy" (#7062).
   */
  StatusPage = "StatusPage",
  OnCallPolicy = "OnCallPolicy",
  /*
   * One on-call schedule's pages, its Layers among them, one team's, one
   * dashboard's, one runbook's, one SLO's, one incoming call policy's and
   * one form's (#10104): "how do I add a layer to this schedule?" is about
   * the one on screen, and ends at its own page.
   */
  OnCallSchedule = "OnCallSchedule",
  Team = "Team",
  Dashboard = "Dashboard",
  Runbook = "Runbook",
  Slo = "Slo",
  IncomingCallPolicy = "IncomingCallPolicy",
  Form = "Form",

  // Area pages — no id; the user is browsing a list or an explorer.
  IncidentsList = "IncidentsList",
  AlertsList = "AlertsList",
  MonitorsList = "MonitorsList",
  ScheduledMaintenanceList = "ScheduledMaintenanceList",
  LogsExplorer = "LogsExplorer",
  TracesExplorer = "TracesExplorer",
  // The Profiler: where services spend their CPU time and memory.
  ProfilesExplorer = "ProfilesExplorer",
  MetricsExplorer = "MetricsExplorer",
  ExceptionsList = "ExceptionsList",
  RumApplications = "RumApplications",
  TelemetryServicesList = "TelemetryServicesList",
  ResourcesList = "ResourcesList",
  /*
   * Any other Security Events page: the case queue, the events, entities,
   * detections and playbooks.
   */
  SecurityEvents = "SecurityEvents",
  // Any other Data Security page: the overview, stores, issues, access.
  DataSecurity = "DataSecurity",
  // Cloud > Accounts: every account the project's cloud connections read.
  CloudAccountsList = "CloudAccountsList",

  /*
   * The pages where a project is set up (#7062), so "how do I add someone
   * here?" is answered for the page on screen: Home, Project Settings,
   * the person's own User Settings, On-Call (its policies, schedules and
   * rules), Status Pages (the list, announcements, their settings) and
   * the forms that create something (Create Monitor, Declare Incident).
   * Which page of them is `page`.
   */
  Home = "Home",
  ProjectSettings = "ProjectSettings",
  UserSettings = "UserSettings",
  OnCall = "OnCall",
  StatusPagesList = "StatusPagesList",
  CreateForm = "CreateForm",
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
  /*
   * The Dashboard page on screen, as its route template in the Dashboard's
   * route map - "/dashboard/:projectId/settings/api-keys",
   * "/dashboard/:projectId/status-pages/:id/domains" - never an address
   * with ids in it (#7062). Which settings page, which create form, which
   * of a record's pages. The server names it from its own catalogs of the
   * Dashboard's pages and says nothing of one it does not know, so no
   * word of it reaches the prompt as the client wrote it.
   */
  page?: string | undefined;
}

/*
 * A page's route template: "/dashboard", then segments of lower-case
 * words joined by hyphens, or the project's and a record's placeholders.
 * No segment of the Dashboard's routes holds a digit, so an id - a UUID,
 * a trace's hex - never passes, nor a query string or text a person
 * typed: it can never carry anything but the name of a route.
 */
const PAGE_TEMPLATE_REGEX: RegExp =
  /^\/dashboard(?:\/(?:[a-z]+(?:-[a-z]+)*|:projectId|:id)){1,10}$/;

const MAX_PAGE_LENGTH: number = 256;

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
  AIChatPageContextType.SecurityCase,
  AIChatPageContextType.DataStore,
  AIChatPageContextType.DataSecurityIssue,
  AIChatPageContextType.DataTable,
  AIChatPageContextType.CloudAccount,
  AIChatPageContextType.Workflow,
  AIChatPageContextType.StatusPage,
  AIChatPageContextType.OnCallPolicy,
  AIChatPageContextType.OnCallSchedule,
  AIChatPageContextType.Team,
  AIChatPageContextType.Dashboard,
  AIChatPageContextType.Runbook,
  AIChatPageContextType.Slo,
  AIChatPageContextType.IncomingCallPolicy,
  AIChatPageContextType.Form,
];

export class AIChatPageContextHelper {
  /*
   * Titles are presentation hints; only the resource and child identity decide
   * whether navigation has selected a different conversation subject.
   */
  public static getIdentity(context: AIChatPageContext): string {
    return JSON.stringify([
      ...this.getSubjectParts(context),
      // Another page of the same subject is another page (#7062).
      context.page || null,
    ]);
  }

  /*
   * What the context is about, whichever of its pages is on screen: a
   * monitor's Overview and its Criteria are the same monitor, so what was
   * read of it stays while the person moves between them.
   */
  public static getSubjectIdentity(context: AIChatPageContext): string {
    return JSON.stringify(this.getSubjectParts(context));
  }

  private static getSubjectParts(
    context: AIChatPageContext,
  ): Array<string | null> {
    return [
      context.type,
      context.entityId || null,
      context.resourceType || null,
      context.subresource?.kind || null,
      context.subresource?.key || null,
      context.subresource?.namespace || null,
    ];
  }

  // A page's route template, as `page` may hold it, or undefined.
  public static sanitizePage(value: unknown): string | undefined {
    if (
      typeof value !== "string" ||
      value.length > MAX_PAGE_LENGTH ||
      !PAGE_TEMPLATE_REGEX.test(value)
    ) {
      return undefined;
    }

    return value;
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

    // Which page it is, by its route's name only (#7062); anything else is dropped.
    const page: string | undefined = this.sanitizePage(json["page"]);

    if (page) {
      context.page = page;
    }

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
