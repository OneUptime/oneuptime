import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import ThreatIntelIndicator from "../../../../Models/AnalyticsModels/ThreatIntelIndicator";
import Incident from "../../../../Models/DatabaseModels/Incident";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseNote from "../../../../Models/DatabaseModels/SecurityCaseNote";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "../../../../Types/AI/AIChatTypes";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  SecurityEntity,
  readSecurityEntities,
} from "../../../../Types/SecurityCase/SecurityEntity";
import { ocsfSeverityFromId } from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  SecurityPlaybookStep,
  doesStepNeedApproval,
  parseSecurityPlaybookSteps,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { getSecurityPlaybookAction } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import IncidentService from "../../../Services/IncidentService";
import SecurityCaseNoteService from "../../../Services/SecurityCaseNoteService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import SecurityDetectionService from "../../../Services/SecurityDetectionService";
import SecurityEventService, {
  ObservableActivity,
} from "../../../Services/SecurityEventService";
import SecurityPlaybookRunService from "../../../Services/SecurityPlaybookRunService";
import SecurityPlaybookService from "../../../Services/SecurityPlaybookService";
import ThreatIntelIndicatorService, {
  ActiveIndicator,
} from "../../../Services/ThreatIntelIndicatorService";
import { securityCaseGroupingKey } from "../../SecurityCase/SecurityCaseIngest";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../../SecurityCase/SecurityCaseValues";
import SecurityCasePriorities from "../../../../Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "../../../../Utils/SecurityCase/SecurityCaseStatuses";
import ToolResultSerializer, {
  RedactionOptions,
  SerializedResult,
} from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * THE SECURITY CASE TOOLS: how OneUptime AI reads a security case and the
 * product around it, and - in a conversation, with the person's approval -
 * acts on one.
 *
 * Read tools:
 *   query_security_cases     one case with its detections, or a list of
 *                            cases (open ones, or the ones about an entity)
 *   lookup_threat_intel      which values the project's threat intel knows
 *   security_entity_activity how active values have been, and since when
 *   query_security_playbooks the playbooks a case can be handed to
 *
 * Write tools (isMutation: a conversation asks before each, and a system
 * run - a triage - never has them):
 *   add_security_case_note   a note on the case, as the person
 *   run_security_playbook    start a playbook on the case, as the person;
 *                            its containment steps still wait for their own
 *                            approval in the playbook engine
 *
 * Every read runs with the caller's props: the case reads through the model
 * layer, and the two raw reads (threat intel, entity activity) are held to
 * the models' read permissions by the tool gate (AIToolbox), which is their
 * only authorization. Results keep the observables security work is about
 * (keepSecurityObservables) and redact secrets.
 *
 * Text a case is made of was written outside the project - detection
 * titles, sample messages, indicator names - and may have been written for
 * an AI. The serializer redacts it and the assistant hands it to the model
 * inside a tool_result, as data; a triage also looks it over for text
 * written to steer an AI (SecurityCaseTriageRunner).
 */

const SECURITY_RESULT_OPTIONS: RedactionOptions = {
  keepSecurityObservables: true,
};

// The most detections one case read lists.
export const MAX_CASE_DETECTIONS: number = 20;
// The most cases a list read returns.
export const MAX_CASES: number = 25;
// The most values one lookup takes.
export const MAX_LOOKUP_VALUES: number = 25;
// The activity window, in hours: the default and the longest.
export const DEFAULT_ACTIVITY_HOURS: number = 7 * 24;
export const MAX_ACTIVITY_HOURS: number = 30 * 24;

/*
 * The permissions are read from the models' access control, lazily: this
 * module loads through the service import graph before the model classes
 * are wired, and a model method called at import time throws.
 */
const cachedPermissions: Map<string, Array<Permission>> = new Map();

function permissionsOf(
  key: string,
  read: () => Array<Permission>,
): Array<Permission> {
  const cached: Array<Permission> | undefined = cachedPermissions.get(key);

  if (cached) {
    return cached;
  }

  const permissions: Array<Permission> = read();
  cachedPermissions.set(key, permissions);
  return permissions;
}

function caseReadPermissions(): Array<Permission> {
  return permissionsOf("SecurityCase:read", (): Array<Permission> => {
    return new SecurityCase().getReadPermissions();
  });
}

// The values a lookup takes: trimmed, lower case, each once, at most MAX_LOOKUP_VALUES.
export function readLookupValues(args: JSONObject): Array<string> {
  const values: Array<string> = ToolArgs.getStringArray(args, "values") || [];
  const single: string | undefined = ToolArgs.getString(args, "value");

  return Array.from(
    new Set(
      [...values, ...(single ? [single] : [])]
        .map((value: string): string => {
          return value.trim().toLowerCase();
        })
        .filter((value: string): boolean => {
          return value.length > 0 && value.length <= 2048;
        }),
    ),
  ).slice(0, MAX_LOOKUP_VALUES);
}

function caseLabel(securityCase: SecurityCase): string {
  return `${securityCase.caseNumberWithPrefix || "Case"} ${securityCase.title || ""}`.trim();
}

function entityList(value: unknown): string {
  return readSecurityEntities(value)
    .map((entity: SecurityEntity): string => {
      return `${entity.type}: ${entity.value}`;
    })
    .join(", ");
}

/*
 * ---------------------------------------------------------------------------
 * query_security_cases
 * ---------------------------------------------------------------------------
 */
export const QuerySecurityCasesTool: ObservabilityTool = {
  name: "query_security_cases",
  description:
    'Read security cases. Pass securityCaseId for one case with its detections (what fired, how often, the entities it names, a sample event message) and the incident it declared, if any. Without it, list cases: status="open" (default), "closed" or "all", and entity to list only the cases about one user, host, IP address or domain - a recurrence, or a wider attack.',
  inputSchema: {
    type: "object",
    properties: {
      securityCaseId: {
        type: "string",
        description: "One case's ID, for its full details and detections.",
      },
      status: {
        type: "string",
        enum: ["open", "closed", "all"],
        description: 'Which cases to list (default "open").',
      },
      entity: {
        type: "string",
        description:
          "Only the cases about this entity (a user, host, IP address or domain).",
      },
      limit: {
        type: "number",
        description: `Maximum cases to list (default 10, max ${MAX_CASES}).`,
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return caseReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const securityCaseId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "securityCaseId",
    );

    if (securityCaseId) {
      return await readOneCase(securityCaseId, ctx);
    }

    const status: string = ToolArgs.getString(args, "status") || "open";
    const entity: string | undefined = ToolArgs.getString(args, "entity");
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: MAX_CASES,
    });

    const query: JSONObject = {
      projectId: ctx.projectId,
    };

    /*
     * Open and closed by what each of the project's statuses counts as
     * (SecurityCaseStatuses), whatever the project calls them.
     */
    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(ctx.projectId);

    if (status === "open") {
      query["securityCaseStatusId"] = new Includes(
        SecurityCaseStatuses.getOpenStatusIds(values.statuses),
      );
    } else if (status === "closed") {
      query["securityCaseStatusId"] = new Includes(
        SecurityCaseStatuses.getClosedStatusIds(values.statuses),
      );
    }

    if (entity) {
      query["groupingKey"] = securityCaseGroupingKey({
        groupValue: entity,
        fingerprint: "",
      });
    }

    const cases: Array<SecurityCase> = await SecurityCaseService.findBy({
      query: query as never,
      select: {
        _id: true,
        caseNumberWithPrefix: true,
        title: true,
        securityCaseStatusId: true,
        securityCasePriorityId: true,
        verdict: true,
        aiVerdict: true,
        entities: true,
        detectionCount: true,
        createdAt: true,
        closedAt: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit,
      skip: 0,
      props: ctx.props,
    });

    const rows: Array<JSONObject> = cases.map(
      (securityCase: SecurityCase): JSONObject => {
        return {
          securityCaseId: securityCase.id?.toString() || "",
          case: securityCase.caseNumberWithPrefix || "",
          title: securityCase.title || "",
          status: getStatusName(values, securityCase.securityCaseStatusId),
          priority: getPriorityName(
            values,
            securityCase.securityCasePriorityId,
          ),
          verdict: securityCase.verdict || "",
          aiVerdict: securityCase.aiVerdict || "",
          entities: entityList(securityCase.entities),
          detections: securityCase.detectionCount || 0,
          openedAt: securityCase.createdAt || null,
          closedAt: securityCase.closedAt || null,
        };
      },
    );

    const serialized: SerializedResult = ToolResultSerializer.serializeRows(
      rows,
      undefined,
      SECURITY_RESULT_OPTIONS,
    );

    const target: AIChatCitationTarget = {
      type: AIChatCitationTargetType.SecurityCases,
    };

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Security cases (${status}${entity ? `, about ${entity}` : ""}) - ${serialized.rowCount} found`,
      citationTarget: target,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Security cases (${rows.length})`,
              columns: [
                { key: "case", title: "Case", type: "text" },
                { key: "title", title: "Title", type: "text" },
                { key: "status", title: "Status", type: "text" },
                { key: "priority", title: "Priority", type: "text" },
                { key: "aiVerdict", title: "AI Verdict", type: "text" },
              ],
              rows: rows,
              link: target,
            })
          : undefined,
    };
  },
};

// A status's and a priority's names, as the project calls them.
function getStatusName(
  values: ProjectSecurityCaseValues,
  statusId: ObjectID | undefined,
): string {
  return SecurityCaseStatuses.find(values.statuses, statusId)?.name || "";
}

function getPriorityName(
  values: ProjectSecurityCaseValues,
  priorityId: ObjectID | undefined,
): string {
  return SecurityCasePriorities.find(values.priorities, priorityId)?.name || "";
}

async function readOneCase(
  securityCaseId: ObjectID,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  const values: ProjectSecurityCaseValues =
    await SecurityCaseValues.getForProject(ctx.projectId);

  const securityCase: SecurityCase | null = await SecurityCaseService.findOneBy(
    {
      query: {
        _id: securityCaseId,
        projectId: ctx.projectId,
      },
      select: {
        _id: true,
        caseNumberWithPrefix: true,
        title: true,
        description: true,
        securityCaseStatusId: true,
        securityCasePriorityId: true,
        verdict: true,
        closingNote: true,
        source: true,
        entities: true,
        mitreTactics: true,
        mitreTechniques: true,
        detectionCount: true,
        firstDetectedAt: true,
        lastDetectedAt: true,
        createdAt: true,
        closedAt: true,
        incidentId: true,
        aiVerdict: true,
        aiSuggestedSecurityCasePriorityId: true,
      },
      props: ctx.props,
    },
  );

  if (!securityCase) {
    throw new BadDataException(
      "Security case not found (or you do not have access to it).",
    );
  }

  const detections: Array<SecurityDetection> =
    await SecurityDetectionService.findBy({
      query: {
        projectId: ctx.projectId,
        securityCaseId: securityCaseId,
      },
      select: {
        title: true,
        severity: true,
        source: true,
        ruleName: true,
        entities: true,
        eventCount: true,
        fireCount: true,
        firstSeenAt: true,
        lastSeenAt: true,
        sampleMessage: true,
      },
      sort: { lastSeenAt: SortOrder.Descending },
      limit: MAX_CASE_DETECTIONS,
      skip: 0,
      props: ctx.props,
    });

  let incidentLine: string = "";

  if (securityCase.incidentId) {
    try {
      const incident: Incident | null = await IncidentService.findOneById({
        id: securityCase.incidentId,
        select: { incidentNumberWithPrefix: true, title: true },
        props: ctx.props,
      });

      if (incident) {
        incidentLine =
          `${incident.incidentNumberWithPrefix || "Incident"} ${incident.title || ""}`.trim();
      }
    } catch {
      // An incident the caller may not read is not named.
      incidentLine = "";
    }
  }

  const caseRow: JSONObject = {
    securityCaseId: securityCase.id?.toString() || "",
    case: securityCase.caseNumberWithPrefix || "",
    title: securityCase.title || "",
    description: securityCase.description || "",
    status: getStatusName(values, securityCase.securityCaseStatusId),
    priority: getPriorityName(values, securityCase.securityCasePriorityId),
    verdict: securityCase.verdict || "",
    closingNote: securityCase.closingNote || "",
    source: securityCase.source || "",
    entities: entityList(securityCase.entities),
    mitreTactics: (securityCase.mitreTactics || []).join(", "),
    mitreTechniques: (securityCase.mitreTechniques || []).join(", "),
    detections: securityCase.detectionCount || 0,
    firstDetectedAt: securityCase.firstDetectedAt || null,
    lastDetectedAt: securityCase.lastDetectedAt || null,
    openedAt: securityCase.createdAt || null,
    closedAt: securityCase.closedAt || null,
    declaredIncident: incidentLine,
    aiVerdict: securityCase.aiVerdict || "",
    aiSuggestedPriority: getPriorityName(
      values,
      securityCase.aiSuggestedSecurityCasePriorityId,
    ),
  };

  const detectionRows: Array<JSONObject> = detections.map(
    (detection: SecurityDetection): JSONObject => {
      return {
        detection: detection.title || "",
        severity: detection.severity || "",
        source: detection.source || "",
        rule: detection.ruleName || "",
        entities: entityList(detection.entities),
        events: detection.eventCount || 0,
        fired: detection.fireCount || 0,
        firstSeenAt: detection.firstSeenAt || null,
        lastSeenAt: detection.lastSeenAt || null,
        sampleEventMessage: detection.sampleMessage || "",
      };
    },
  );

  const caseText: SerializedResult = ToolResultSerializer.serializeRows(
    [caseRow],
    undefined,
    SECURITY_RESULT_OPTIONS,
  );
  const detectionText: SerializedResult = ToolResultSerializer.serializeRows(
    detectionRows,
    undefined,
    SECURITY_RESULT_OPTIONS,
  );

  const target: AIChatCitationTarget = {
    type: AIChatCitationTargetType.SecurityCaseView,
    params: { securityCaseId: securityCaseId.toString() },
  };

  return {
    dataForLlm: `Case:\n${caseText.text}\n\nDetections (latest first, at most ${MAX_CASE_DETECTIONS}):\n${detectionText.text}`,
    rowCount: 1 + detectionRows.length,
    citationLabel: `Security case ${caseLabel(securityCase)} (${detectionRows.length} ${detectionRows.length === 1 ? "detection" : "detections"})`,
    citationTarget: target,
    redactionCount: caseText.redactionCount + detectionText.redactionCount,
    isTruncated: caseText.isTruncated || detectionText.isTruncated,
    widget: WidgetBuilder.resourceCard({
      title: "Security case",
      resourceType: "Security Case",
      heading: caseLabel(securityCase),
      subheading: `${getStatusName(values, securityCase.securityCaseStatusId)} · ${getPriorityName(values, securityCase.securityCasePriorityId)}`,
      fields: [
        {
          label: "Detections",
          value: String(securityCase.detectionCount || 0),
        },
        { label: "Entities", value: entityList(securityCase.entities) || "-" },
      ],
      link: target,
    }),
  };
}

/*
 * ---------------------------------------------------------------------------
 * lookup_threat_intel
 * ---------------------------------------------------------------------------
 */
export const LookupThreatIntelTool: ObservabilityTool = {
  name: "lookup_threat_intel",
  description: `Look values up in the project's threat intel feeds: IP addresses, domains, URLs and file hashes. Returns, for each value, whether an active indicator matches it, the feed, the indicator's name or type and its confidence. A match is strong evidence of known-bad infrastructure; no match is NOT evidence of safety (the feeds only know what they list). At most ${MAX_LOOKUP_VALUES} values per call.`,
  inputSchema: {
    type: "object",
    properties: {
      values: {
        type: "array",
        items: { type: "string" },
        description:
          "The values to look up: IP addresses, domains, URLs, file hashes.",
      },
    },
    required: ["values"],
  },
  get requiredPermissions(): Array<Permission> {
    return permissionsOf("ThreatIntelIndicator:read", (): Array<Permission> => {
      return new ThreatIntelIndicator().getReadPermissions();
    });
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const values: Array<string> = readLookupValues(args);

    if (values.length === 0) {
      throw new BadDataException(
        "values is required: the IP addresses, domains, URLs or file hashes to look up.",
      );
    }

    const indicators: Array<ActiveIndicator> =
      await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
        projectId: ctx.projectId,
        values,
        now: OneUptimeDate.getCurrentDate(),
      });

    // The most confident indicator for each value.
    const best: Map<string, ActiveIndicator> = new Map();

    for (const indicator of indicators) {
      const known: ActiveIndicator | undefined = best.get(
        indicator.indicatorValue,
      );

      if (!known || indicator.confidence > known.confidence) {
        best.set(indicator.indicatorValue, indicator);
      }
    }

    const rows: Array<JSONObject> = values.map((value: string): JSONObject => {
      const match: ActiveIndicator | undefined = best.get(value);

      return match
        ? {
            value,
            match: "known-bad",
            feed: match.feedName,
            indicator: match.indicatorName || match.indicatorType || "",
            confidence: match.confidence,
          }
        : { value, match: "no match" };
    });

    const serialized: SerializedResult = ToolResultSerializer.serializeRows(
      rows,
      undefined,
      SECURITY_RESULT_OPTIONS,
    );

    return {
      dataForLlm: serialized.text,
      rowCount: best.size,
      citationLabel: `Threat intel lookup of ${values.length} ${values.length === 1 ? "value" : "values"}: ${best.size} known-bad`,
      citationTarget: { type: AIChatCitationTargetType.ThreatIntel },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget: WidgetBuilder.table({
        title: `Threat intel (${best.size} of ${values.length} known-bad)`,
        columns: [
          { key: "value", title: "Value", type: "text" },
          { key: "match", title: "Match", type: "text" },
          { key: "feed", title: "Feed", type: "text" },
          { key: "confidence", title: "Confidence", type: "number" },
        ],
        rows,
        link: { type: AIChatCitationTargetType.ThreatIntel },
      }),
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * security_entity_activity
 * ---------------------------------------------------------------------------
 */
export const SecurityEntityActivityTool: ObservabilityTool = {
  name: "security_entity_activity",
  description: `How active users, hosts, IP addresses and other values have been in the project's security events: for each value, how many events and findings name it over the window, the worst severity, and when it was first and last seen. A value first seen just before a detection, or with many findings, is unusual. Window: hours (default ${DEFAULT_ACTIVITY_HOURS}, max ${MAX_ACTIVITY_HOURS}). At most ${MAX_LOOKUP_VALUES} values per call.`,
  inputSchema: {
    type: "object",
    properties: {
      values: {
        type: "array",
        items: { type: "string" },
        description: "The users, hosts, IP addresses or other values to read.",
      },
      hours: {
        type: "number",
        description: `How many hours back to read (default ${DEFAULT_ACTIVITY_HOURS}).`,
      },
    },
    required: ["values"],
  },
  get requiredPermissions(): Array<Permission> {
    return permissionsOf("SecurityEvent:read", (): Array<Permission> => {
      return new SecurityEvent().getReadPermissions();
    });
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    // Activity reads values as the events store them, so case is kept.
    const values: Array<string> = Array.from(
      new Set(
        (ToolArgs.getStringArray(args, "values") || [])
          .map((value: string): string => {
            return value.trim();
          })
          .filter((value: string): boolean => {
            return value.length > 0 && value.length <= 2048;
          }),
      ),
    ).slice(0, MAX_LOOKUP_VALUES);

    if (values.length === 0) {
      throw new BadDataException(
        "values is required: the users, hosts or addresses to read.",
      );
    }

    const hours: number = ToolArgs.getNumber(args, "hours", {
      defaultValue: DEFAULT_ACTIVITY_HOURS,
      min: 1,
      max: MAX_ACTIVITY_HOURS,
    });

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveHours(endTime, -hours);

    const activity: Array<ObservableActivity> =
      await SecurityEventService.findObservableActivity({
        projectId: ctx.projectId,
        values,
        startTime,
        endTime,
      });

    const byValue: Map<string, ObservableActivity> = new Map();

    for (const item of activity) {
      byValue.set(item.value.toLowerCase(), item);
    }

    const rows: Array<JSONObject> = values.map((value: string): JSONObject => {
      const item: ObservableActivity | undefined = byValue.get(
        value.toLowerCase(),
      );

      if (!item) {
        return { value, events: 0, findings: 0, note: "not seen in window" };
      }

      return {
        value,
        events: item.eventCount,
        findings: item.findingCount,
        worstSeverity: ocsfSeverityFromId(item.maxSeverityId) || "",
        firstSeen: item.firstSeen || null,
        lastSeen: item.lastSeen || null,
      };
    });

    const serialized: SerializedResult = ToolResultSerializer.serializeRows(
      rows,
      undefined,
      SECURITY_RESULT_OPTIONS,
    );

    return {
      dataForLlm: `Window: the last ${hours} hour(s), ${startTime.toISOString()} - ${endTime.toISOString()}.\n${serialized.text}`,
      rowCount: activity.length,
      citationLabel: `Security activity of ${values.length} ${values.length === 1 ? "value" : "values"} over ${hours} ${hours === 1 ? "hour" : "hours"}`,
      citationTarget: { type: AIChatCitationTargetType.SecurityEvents },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget: WidgetBuilder.table({
        title: "Entity activity",
        description: `The last ${hours} ${hours === 1 ? "hour" : "hours"}`,
        columns: [
          { key: "value", title: "Value", type: "text" },
          { key: "events", title: "Events", type: "number" },
          { key: "findings", title: "Findings", type: "number" },
          { key: "firstSeen", title: "First Seen", type: "date" },
          { key: "lastSeen", title: "Last Seen", type: "date" },
        ],
        rows,
        link: { type: AIChatCitationTargetType.SecurityEvents },
      }),
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * query_security_playbooks
 * ---------------------------------------------------------------------------
 */

/*
 * One playbook's steps in a line: "Check threat intel, then Contain
 * CrowdStrike host (needs approval)". Steps that cannot be read say so,
 * rather than keep every other playbook from being listed.
 */
export function describePlaybookSteps(steps: unknown): string {
  let parsed: Array<SecurityPlaybookStep>;

  try {
    parsed = parseSecurityPlaybookSteps(steps);
  } catch {
    return "(its steps could not be read)";
  }

  return parsed
    .map((step: SecurityPlaybookStep): string => {
      const title: string =
        getSecurityPlaybookAction(step.action)?.title || step.action;

      return doesStepNeedApproval(step) ? `${title} (needs approval)` : title;
    })
    .join(", then ");
}

export const QuerySecurityPlaybooksTool: ObservabilityTool = {
  name: "query_security_playbooks",
  description:
    "List the project's security playbooks that are on: each one's ID, name, what starts it and its steps in order, marking the steps that wait for a person's approval (containment does unless a Security Admin turned it off). Use it to say which playbook fits a case.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  get requiredPermissions(): Array<Permission> {
    return permissionsOf("SecurityPlaybook:read", (): Array<Permission> => {
      return new SecurityPlaybook().getReadPermissions();
    });
  },
  execute: async (
    _args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const playbooks: Array<SecurityPlaybook> =
      await SecurityPlaybookService.findBy({
        query: {
          projectId: ctx.projectId,
          isEnabled: true,
        },
        select: {
          _id: true,
          name: true,
          description: true,
          trigger: true,
          minimumSecurityCasePriorityId: true,
          steps: true,
        },
        sort: { name: SortOrder.Ascending },
        limit: 50,
        skip: 0,
        props: ctx.props,
      });

    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(ctx.projectId);

    const rows: Array<JSONObject> = playbooks.map(
      (playbook: SecurityPlaybook): JSONObject => {
        return {
          securityPlaybookId: playbook.id?.toString() || "",
          name: playbook.name || "",
          description: playbook.description || "",
          startsOn: playbook.trigger || "",
          minimumPriority: getPriorityName(
            values,
            playbook.minimumSecurityCasePriorityId,
          ),
          steps: describePlaybookSteps(playbook.steps),
        };
      },
    );

    const serialized: SerializedResult = ToolResultSerializer.serializeRows(
      rows,
      undefined,
      SECURITY_RESULT_OPTIONS,
    );

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Security playbooks that are on (${serialized.rowCount})`,
      citationTarget: { type: AIChatCitationTargetType.SecurityPlaybooks },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * add_security_case_note (write)
 * ---------------------------------------------------------------------------
 */
export const AddSecurityCaseNoteTool: ObservabilityTool = {
  name: "add_security_case_note",
  description:
    "Add a note to a security case's timeline, as the signed-in person: findings, a checklist, what to check next. Notes are visible to everyone who can read the case. Find the securityCaseId with query_security_cases first.",
  inputSchema: {
    type: "object",
    properties: {
      securityCaseId: {
        type: "string",
        description: "The case's ID (required).",
      },
      note: {
        type: "string",
        description: "The note, in markdown (required).",
      },
    },
    required: ["securityCaseId", "note"],
  },
  get requiredPermissions(): Array<Permission> {
    return permissionsOf("SecurityCaseNote:create", (): Array<Permission> => {
      return new SecurityCaseNote().getCreatePermissions();
    });
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Add a note to security case ${ToolArgs.getString(args, "securityCaseId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const securityCaseId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "securityCaseId",
    );

    if (!securityCaseId) {
      throw new BadDataException(
        "securityCaseId is required. Use query_security_cases to find it first.",
      );
    }

    const note: string | undefined = ToolArgs.getString(args, "note");

    if (!note) {
      throw new BadDataException("note is required (the note's text).");
    }

    const userId: ObjectID | undefined = ctx.props.userId;

    if (!userId) {
      throw new BadDataException(
        "No signed-in person in context; cannot add a note.",
      );
    }

    // Read under the person's permissions before writing anything.
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: securityCaseId, projectId: ctx.projectId },
        select: { _id: true, caseNumberWithPrefix: true, title: true },
        props: ctx.props,
      });

    if (!securityCase) {
      throw new BadDataException(
        "Security case not found (or you do not have access to it).",
      );
    }

    const caseNote: SecurityCaseNote = new SecurityCaseNote();
    caseNote.projectId = ctx.projectId;
    caseNote.securityCaseId = securityCaseId;
    /*
     * The model wrote this from what it read, events included: it stays
     * Markdown, but nothing in it acts on its own where the note is shown
     * (FeedMarkdown.aiWritten).
     */
    caseNote.note = FeedMarkdown.aiWritten(note).toString();
    caseNote.createdByUserId = userId;

    const created: SecurityCaseNote = await SecurityCaseNoteService.create({
      data: caseNote,
      props: ctx.props,
    });

    const target: AIChatCitationTarget = {
      type: AIChatCitationTargetType.SecurityCaseView,
      params: { securityCaseId: securityCaseId.toString() },
    };

    return {
      dataForLlm: `Added a note to ${caseLabel(securityCase)} (note ${created.id?.toString() || ""}). It is on the case's timeline for everyone who can read the case.`,
      rowCount: 1,
      citationLabel: `Note on ${caseLabel(securityCase)}`,
      citationTarget: target,
      redactionCount: 0,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Note added",
        resourceType: "Security Case",
        heading: caseLabel(securityCase),
        fields: [
          {
            label: "Note",
            value: note.length > 200 ? `${note.substring(0, 200)}…` : note,
          },
        ],
        link: target,
      }),
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * run_security_playbook (write)
 * ---------------------------------------------------------------------------
 */
export const RunSecurityPlaybookTool: ObservabilityTool = {
  name: "run_security_playbook",
  description:
    "Start one of the project's security playbooks on a security case, as the signed-in person - the way Run Playbook does on the case page. The playbook's steps run in order; a containment step (suspending an account, isolating a host) still waits for a person's approval on the case unless a Security Admin turned that off, and never acts on a protected entity. Find the IDs with query_security_cases and query_security_playbooks first.",
  inputSchema: {
    type: "object",
    properties: {
      securityCaseId: {
        type: "string",
        description: "The case to run it on (required).",
      },
      securityPlaybookId: {
        type: "string",
        description: "The playbook to run (required).",
      },
    },
    required: ["securityCaseId", "securityPlaybookId"],
  },
  get requiredPermissions(): Array<Permission> {
    return permissionsOf(
      "SecurityPlaybookRun:create",
      (): Array<Permission> => {
        return new SecurityPlaybookRun().getCreatePermissions();
      },
    );
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Run playbook ${ToolArgs.getString(args, "securityPlaybookId") || ""} on security case ${ToolArgs.getString(args, "securityCaseId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const securityCaseId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "securityCaseId",
    );
    const securityPlaybookId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "securityPlaybookId",
    );

    if (!securityCaseId || !securityPlaybookId) {
      throw new BadDataException(
        "securityCaseId and securityPlaybookId are required. Find them with query_security_cases and query_security_playbooks.",
      );
    }

    if (!ctx.props.userId) {
      throw new BadDataException(
        "No signed-in person in context; cannot run a playbook.",
      );
    }

    // Both read under the person's permissions before anything starts.
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: securityCaseId, projectId: ctx.projectId },
        select: { _id: true, caseNumberWithPrefix: true, title: true },
        props: ctx.props,
      });

    if (!securityCase) {
      throw new BadDataException(
        "Security case not found (or you do not have access to it).",
      );
    }

    const playbook: SecurityPlaybook | null =
      await SecurityPlaybookService.findOneBy({
        query: {
          _id: securityPlaybookId,
          projectId: ctx.projectId,
          isEnabled: true,
        },
        select: { _id: true, name: true, steps: true },
        props: ctx.props,
      });

    if (!playbook) {
      throw new BadDataException(
        "Playbook not found, turned off, or you do not have access to it.",
      );
    }

    const run: SecurityPlaybookRun = new SecurityPlaybookRun();
    run.projectId = ctx.projectId;
    run.securityCaseId = securityCaseId;
    run.securityPlaybookId = securityPlaybookId;

    const created: SecurityPlaybookRun =
      await SecurityPlaybookRunService.create({
        data: run,
        props: ctx.props,
      });

    const target: AIChatCitationTarget = {
      type: AIChatCitationTargetType.SecurityCaseView,
      params: { securityCaseId: securityCaseId.toString() },
    };

    const steps: string = describePlaybookSteps(playbook.steps);

    return {
      dataForLlm: `Started the playbook "${playbook.name || ""}" on ${caseLabel(securityCase)} (run ${created.id?.toString() || ""}). Its steps: ${steps || "none"}. A step marked "needs approval" waits on the case for a person to approve it.`,
      rowCount: 1,
      citationLabel: `Playbook ${playbook.name || ""} on ${caseLabel(securityCase)}`,
      citationTarget: target,
      redactionCount: 0,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Playbook started",
        resourceType: "Security Case",
        heading: caseLabel(securityCase),
        subheading: playbook.name || "",
        fields: [{ label: "Steps", value: steps || "-" }],
        link: target,
      }),
    };
  },
};
