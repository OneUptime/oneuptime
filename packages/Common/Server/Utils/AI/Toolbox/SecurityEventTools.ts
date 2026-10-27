import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
  AIChatWidgetColumn,
} from "../../../../Types/AI/AIChatTypes";
import SecurityEventService from "../../../Services/SecurityEventService";
import ToolResultSerializer, {
  RedactionOptions,
  SerializedResult,
} from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * AI toolbox over the SecurityEvent table — the "AI security analyst"
 * surface. Read-only; executes under the requesting user's permission
 * props like every other analytics tool.
 *
 * Its results keep the observables a security question is about - IP
 * addresses, user names and email addresses, file hashes - which every
 * other tool's results redact (ToolResultSerializer's
 * keepSecurityObservables): "a sign-in from [redacted-ip]" cannot be
 * judged, nor looked up in threat intel. Secrets are redacted as anywhere.
 */
const SECURITY_RESULT_OPTIONS: RedactionOptions = {
  keepSecurityObservables: true,
};

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily — this module loads through the service import graph
 * before the model class is fully wired, so calling a model method at
 * import time throws a circular-dependency TypeError.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new SecurityEvent().getReadPermissions();
    }
    return cachedReadPermissions;
  };

/*
 * What a row says of an event, in the order a responder reads it: what
 * happened and whether it worked, who did it - the user, the machine and
 * the process that acted - the process it is about with its path, command
 * line and parent, what it touched, and who reported it. Without the
 * process fields an endpoint detection (an encoded PowerShell command, a
 * credential dump) could not be judged: the message of a process launch is
 * often only its class.
 */
const SEARCH_SELECT: JSONObject = {
  time: true,
  severityName: true,
  className: true,
  activityName: true,
  statusName: true,
  message: true,
  principalUser: true,
  principalHost: true,
  principalIp: true,
  principalProcess: true,
  processName: true,
  processPath: true,
  processCommandLine: true,
  parentProcessName: true,
  parentProcessPath: true,
  parentProcessCommandLine: true,
  targetUser: true,
  targetHost: true,
  targetIp: true,
  targetPort: true,
  targetResource: true,
  vendorName: true,
  ruleName: true,
  mitreTechniques: true,
  /*
   * The request the event happened in, and how far it got: with the trace
   * id the model opens the exact trace (its spans, the exception it threw)
   * rather than searching for it by time and host.
   */
  traceId: true,
  requestOutcome: true,
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * principalProcess - the process that acted - when it says something the
 * event's own process fields do not: in an open, an injection or an end it
 * is another process than the one acted on, and a row stored before
 * OneUptime read process fields knows its process only by it. In a launch
 * it is the parent, and in any other event the process itself, which the
 * row already names.
 */
function actingProcessIfNew(event: SecurityEvent): string {
  const acting: string = text(event.principalProcess);

  if (!acting) {
    return "";
  }

  const named: Array<string> = [
    event.processName,
    event.processPath,
    event.processCommandLine,
    event.parentProcessName,
    event.parentProcessPath,
    event.parentProcessCommandLine,
  ].map((value: unknown): string => {
    return text(value).toLowerCase();
  });

  return named.includes(acting.toLowerCase()) ? "" : acting;
}

/*
 * One event as the model reads it: only what the event says. Every column
 * is non-nullable with a '' (or 0, or []) default, and a row of blanks
 * costs tokens and reads as if the source had said "nothing".
 */
export function securityEventSearchRow(event: SecurityEvent): JSONObject {
  const row: JSONObject = {};

  const put: (key: string, value: unknown) => void = (
    key: string,
    value: unknown,
  ): void => {
    if (value instanceof Date) {
      row[key] = value;
      return;
    }

    if (typeof value === "number") {
      if (Number.isFinite(value) && value > 0) {
        row[key] = value;
      }
      return;
    }

    if (Array.isArray(value)) {
      const values: Array<string> = value
        .map((item: unknown): string => {
          return text(item);
        })
        .filter((item: string): boolean => {
          return item.length > 0;
        });

      if (values.length > 0) {
        row[key] = values.join(", ");
      }
      return;
    }

    const written: string = text(value);

    if (written) {
      row[key] = written;
    }
  };

  put("time", event.time);
  put("severity", event.severityName);
  put("class", event.className);
  put("activity", event.activityName);
  put("status", event.statusName);
  put("message", event.message);
  put("principalUser", event.principalUser);
  put("principalHost", event.principalHost);
  put("principalIp", event.principalIp);
  put("principalProcess", actingProcessIfNew(event));
  put("process", event.processName);
  put("processPath", event.processPath);
  put("commandLine", event.processCommandLine);
  put("parentProcess", event.parentProcessName);
  put("parentProcessPath", event.parentProcessPath);
  put("parentCommandLine", event.parentProcessCommandLine);
  put("targetUser", event.targetUser);
  put("targetHost", event.targetHost);
  put("targetIp", event.targetIp);
  put("targetPort", event.targetPort);
  put("targetResource", event.targetResource);
  put("vendor", event.vendorName);
  put("rule", event.ruleName);
  put("techniques", event.mitreTechniques);
  put("traceId", event.traceId);
  put("requestOutcome", event.requestOutcome);

  return row;
}

// The process a person reads in the table: its command line, else its name.
function processShown(row: JSONObject): string {
  return (
    text(row["commandLine"]) ||
    text(row["process"]) ||
    text(row["principalProcess"])
  );
}

/*
 * The status every source writes for an attempt that did not work. Okta
 * writes one message ("User login to Okta") for a sign-in that worked and
 * one that did not: only the status tells them apart.
 */
const FAILURE_STATUS: string = "failure";

/*
 * What happened: the message - or, when the message only names the
 * event's class, as an OCSF event stored without one does ("Process
 * Activity"), the class and its activity the way OCSF names an event type
 * ("Process Activity: Inject") - and whether it failed ("User login to Okta
 * (Failure)"). A success, or a status no source explains, is left to the
 * event's own panel.
 */
function whatHappened(row: JSONObject): string {
  const message: string = text(row["message"]);
  const className: string = text(row["class"]);
  const said: string =
    message && message.toLowerCase() !== className.toLowerCase()
      ? message
      : [className, text(row["activity"])]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join(": ");
  const status: string = text(row["status"]);

  if (!said || status.toLowerCase() !== FAILURE_STATUS) {
    return said;
  }

  return `${said} (${status})`;
}

// A lower-case letter, a digit or an underscore: the text it reads is lower-cased.
function isWordCharacter(character: string | undefined): boolean {
  if (!character) {
    return false;
  }

  const code: number = character.charCodeAt(0);

  return (
    (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95
  );
}

/*
 * How much of the words is searched for the process. The cell shows one
 * line, and both come from outside OneUptime, at any length: comparing
 * every place one long text could sit in another takes time that grows
 * with their product.
 */
const NAMES_PROCESS_SCAN_LIMIT: number = 1000;

/*
 * Whether the words already name this process as a word of its own:
 * "Process injection into lsass.exe" names lsass.exe, "SSH brute force"
 * does not name sh.
 */
function namesProcess(said: string, process: string): boolean {
  const haystack: string = said
    .slice(0, NAMES_PROCESS_SCAN_LIMIT)
    .toLowerCase();
  const needle: string = process.toLowerCase();
  let from: number = haystack.indexOf(needle);

  while (from !== -1) {
    const end: number = from + needle.length;

    if (
      !isWordCharacter(haystack[from - 1]) &&
      !isWordCharacter(haystack[end])
    ) {
      return true;
    }

    from = haystack.indexOf(needle, from + 1);
  }

  return false;
}

/*
 * One event as a person reads it in the table beside the answer: what
 * happened, then - when the event names a process the words before do
 * not - that process, its command line else its name ("Process Activity:
 * Launch · powershell.exe -nop -enc ..."). One column, so the process is in
 * sight: the chat panel is at most 768px wide, and a Class, a Message and
 * a Process column ran the process past its edge.
 */
export function securityEventTableText(row: JSONObject): string {
  const said: string = whatHappened(row);
  const process: string = processShown(row);

  if (!process || namesProcess(said, process)) {
    return said;
  }

  return said ? `${said} · ${process}` : process;
}

export const SearchSecurityEventsTool: ObservabilityTool = {
  name: "search_security_events",
  description:
    "Search SIEM security events (normalized to OCSF). Filter by time range, severity, event class, message text, user, host, process name, command line, or any observable (IP, hostname, username). Each event says what was done (its class, activity and status), who did it (user, host, IP and the process that acted, principalProcess), the process it is about with its path, command line and parent (in a process launch the process started; in an open, an injection or an end the process acted on), and what it touched. An event read from a log line written inside a traced request also gives its traceId - open it with the trace tools to see the request's spans and the exception it threw - and its requestOutcome: how far the request got (Rejected, Reached App, Errored, Reached Database). Use this to investigate what security activity involved a given entity, what ran on a host, or what fired recently.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      severityNames: {
        type: "array",
        items: { type: "string" },
        description:
          'Filter by OCSF severity, e.g. ["Critical", "High"] or ["Medium"].',
      },
      classNames: {
        type: "array",
        items: { type: "string" },
        description:
          'Filter by OCSF event class, e.g. ["Authentication", "Detection Finding", "DNS Activity"].',
      },
      messageSearchText: {
        type: "string",
        description: "Only events whose message contains this text.",
      },
      principalUser: {
        type: "string",
        description: "Only events where this user is the actor.",
      },
      principalHost: {
        type: "string",
        description: "Only events where this host is the actor.",
      },
      observable: {
        type: "string",
        description:
          "Only events mentioning this observable anywhere (user, hostname, IP, domain). Broader than principalUser/principalHost.",
      },
      processName: {
        type: "string",
        description:
          "Only events whose process name contains this text, in any case, such as powershell or mimikatz.exe: the process started, opened, injected into or ended in a process event, the process that acted in any other. A case's Process entity is searched with it.",
      },
      commandLineSearchText: {
        type: "string",
        description:
          "Only events whose process command line contains this text, in any case, such as -enc or sekurlsa.",
      },
      limit: {
        type: "number",
        description: "Maximum events to return (default 25, max 50).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 24,
      maxDays: 30,
    });
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 25,
      min: 1,
      max: 50,
    });

    const query: JSONObject = {
      time: new InBetween(startTime, endTime),
    };

    const severityNames: Array<string> | undefined = ToolArgs.getStringArray(
      args,
      "severityNames",
    );
    if (severityNames) {
      query["severityName"] = new Includes(severityNames);
    }

    const classNames: Array<string> | undefined = ToolArgs.getStringArray(
      args,
      "classNames",
    );
    if (classNames) {
      query["className"] = new Includes(classNames);
    }

    const messageSearchText: string | undefined = ToolArgs.getString(
      args,
      "messageSearchText",
    );
    if (messageSearchText) {
      query["message"] = new Search(messageSearchText);
    }

    const principalUser: string | undefined = ToolArgs.getString(
      args,
      "principalUser",
    );
    if (principalUser) {
      query["principalUser"] = principalUser;
    }

    const principalHost: string | undefined = ToolArgs.getString(
      args,
      "principalHost",
    );
    if (principalHost) {
      query["principalHost"] = principalHost;
    }

    const observable: string | undefined = ToolArgs.getString(
      args,
      "observable",
    );
    if (observable) {
      query["observables"] = new Includes([observable]);
    }

    const processName: string | undefined = ToolArgs.getString(
      args,
      "processName",
    );
    if (processName) {
      query["processName"] = new Search(processName);
    }

    const commandLineSearchText: string | undefined = ToolArgs.getString(
      args,
      "commandLineSearchText",
    );
    if (commandLineSearchText) {
      query["processCommandLine"] = new Search(commandLineSearchText);
    }

    const events: Array<SecurityEvent> = await SecurityEventService.findBy({
      query: query as never,
      select: SEARCH_SELECT as never,
      sort: {
        time: SortOrder.Descending,
      } as never,
      limit: limit,
      skip: 0,
      props: ctx.props,
    });

    const rows: Array<JSONObject> = events.map(securityEventSearchRow);

    const serialized: SerializedResult = ToolResultSerializer.serializeRows(
      rows,
      undefined,
      SECURITY_RESULT_OPTIONS,
    );

    const securityEventsLink: AIChatCitationTarget = {
      type: AIChatCitationTargetType.SecurityEvents,
    };

    /*
     * The table a person reads beside the answer: when, how bad, what
     * happened (with the process it is about) and where. The event is the
     * table's own column, never shown to the model.
     */
    const widgetRows: Array<JSONObject> = rows.map(
      (row: JSONObject): JSONObject => {
        const shown: string = securityEventTableText(row);

        return shown ? { ...row, eventShown: shown } : row;
      },
    );
    const columns: Array<AIChatWidgetColumn> = [
      { key: "time", title: "Time", type: "date" },
      { key: "severity", title: "Severity", type: "text" },
      { key: "eventShown", title: "Event", type: "text" },
      { key: "principalHost", title: "Host", type: "text" },
    ];

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Security events ${startTime.toISOString()} – ${endTime.toISOString()} (${serialized.rowCount} shown)`,
      citationTarget: securityEventsLink,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Security Events (${rows.length})`,
              description: `${startTime.toISOString()} – ${endTime.toISOString()}`,
              columns: columns,
              rows: widgetRows,
              link: securityEventsLink,
            })
          : undefined,
    };
  },
};

// Sample size for the in-code aggregation below.
const SUMMARY_SAMPLE_LIMIT: number = 500;

export const SecurityEventSummaryTool: ObservabilityTool = {
  name: "security_event_summary",
  description:
    "Summarize security event volume by event class and severity over a time range. Use this first to understand the shape of security activity before drilling into raw events with search_security_events.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      observable: {
        type: "string",
        description:
          "Optionally scope the summary to events mentioning this observable (user, hostname, IP).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 24,
      maxDays: 30,
    });

    const query: JSONObject = {
      time: new InBetween(startTime, endTime),
    };

    const observable: string | undefined = ToolArgs.getString(
      args,
      "observable",
    );
    if (observable) {
      query["observables"] = new Includes([observable]);
    }

    /*
     * Aggregate in code over a bounded sample rather than raw SQL: findBy
     * runs the model layer's permission scoping, which raw aggregation
     * would bypass. The sample cap is stated in the result so the model
     * knows when counts are a floor rather than a total.
     */
    const events: Array<SecurityEvent> = await SecurityEventService.findBy({
      query: query as never,
      select: {
        className: true,
        severityName: true,
      } as never,
      sort: {
        time: SortOrder.Descending,
      } as never,
      limit: SUMMARY_SAMPLE_LIMIT,
      skip: 0,
      props: ctx.props,
    });

    const countsByKey: Map<string, JSONObject> = new Map<string, JSONObject>();

    for (const event of events) {
      const className: string = event.className || "Base Event";
      const severity: string = event.severityName || "Unknown";
      const key: string = `${className}|${severity}`;

      const existing: JSONObject | undefined = countsByKey.get(key);

      if (existing) {
        existing["count"] = (existing["count"] as number) + 1;
      } else {
        countsByKey.set(key, {
          class: className,
          severity: severity,
          count: 1,
        });
      }
    }

    const rows: Array<JSONObject> = Array.from(countsByKey.values()).sort(
      (a: JSONObject, b: JSONObject): number => {
        return (b["count"] as number) - (a["count"] as number);
      },
    );

    const serialized: SerializedResult = ToolResultSerializer.serializeRows(
      rows,
      undefined,
      SECURITY_RESULT_OPTIONS,
    );

    const sampleNote: string =
      events.length >= SUMMARY_SAMPLE_LIMIT
        ? ` (based on the most recent ${SUMMARY_SAMPLE_LIMIT} events — counts are a floor)`
        : "";

    return {
      dataForLlm: serialized.text + sampleNote,
      rowCount: serialized.rowCount,
      citationLabel: `Security event summary ${startTime.toISOString()} – ${endTime.toISOString()}${sampleNote}`,
      citationTarget: {
        type: AIChatCitationTargetType.SecurityEvents,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: "Security events by class and severity",
              description: `${startTime.toISOString()} – ${endTime.toISOString()}${sampleNote}`,
              columns: [
                { key: "class", title: "Event Class", type: "text" },
                { key: "severity", title: "Severity", type: "text" },
                { key: "count", title: "Count", type: "number" },
              ],
              rows: rows,
            })
          : undefined,
    };
  },
};
