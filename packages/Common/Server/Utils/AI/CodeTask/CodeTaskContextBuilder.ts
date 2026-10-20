import AlertService from "../../../Services/AlertService";
import IncidentService from "../../../Services/IncidentService";
import MonitorService from "../../../Services/MonitorService";
import ServiceService from "../../../Services/ServiceService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  sanitizeExceptionMessage,
  sanitizeStackTrace,
} from "../../Telemetry/ExceptionSanitizer";
import AIToolbox, { ToolCallOutcome } from "../Toolbox/Index";
import ToolResultSerializer from "../Toolbox/Serializer";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Service from "../../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import {
  CODE_TASK_LIMITS,
  CodeTaskContextInput,
  CodeTaskContextItem,
  CodeTaskContextType,
  DEFAULT_CODE_TASK_LOG_WINDOW_IN_HOURS,
  DEFAULT_CODE_TASK_PROFILE_WINDOW_IN_HOURS,
} from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * TURNS WHAT A PERSON ADDED TO A REQUEST INTO WHAT THE AI IS GIVEN.
 *
 * Notes, links and paths are kept as written. A OneUptime record - an
 * incident, an alert, an exception, a monitor, a trace, the latest logs of a
 * search - is read NOW, under the person's own permissions, and kept as a
 * snapshot:
 *
 *  - Under their permissions, so a request can only carry what its author
 *    may see: a record of another project, or one their labels keep from
 *    them, is refused as missing. The project is the request's own (the
 *    tenant), never one named in the request.
 *  - Now, because telemetry expires and records change, and the Runner may
 *    pick the task up later; the conversation must show what the AI was
 *    actually given.
 *  - Redacted the way the AI toolbox redacts what it hands a model
 *    (ToolResultSerializer: tokens, keys, passwords, emails, addresses),
 *    with embedded files left out, and capped.
 */

const NOTE_LABEL_LENGTH: number = 60;
const RECORD_LABEL_LENGTH: number = 90;
const STACK_TRACE_LINES: number = 60;
const LOG_LINES: number = 20;

export interface CodeTaskContextBuildContext {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

export default class CodeTaskContextBuilder {
  @CaptureSpan()
  public static async build(
    data: CodeTaskContextBuildContext & {
      inputs: Array<CodeTaskContextInput>;
    },
  ): Promise<Array<CodeTaskContextItem>> {
    const items: Array<CodeTaskContextItem> = [];

    for (const input of data.inputs) {
      items.push(await CodeTaskContextBuilder.buildItem(input, data));
    }

    return items;
  }

  public static async buildItem(
    input: CodeTaskContextInput,
    context: CodeTaskContextBuildContext,
  ): Promise<CodeTaskContextItem> {
    switch (input.type) {
      case CodeTaskContextType.Note:
        return {
          type: CodeTaskContextType.Note,
          label: CodeTaskContextBuilder.shorten(
            input.text || "",
            NOTE_LABEL_LENGTH,
          ),
          text: input.text || "",
        };
      case CodeTaskContextType.Link:
        return {
          type: CodeTaskContextType.Link,
          label:
            input.title || CodeTaskContextBuilder.describeUrl(input.url || ""),
          url: input.url || "",
        };
      case CodeTaskContextType.File:
        return {
          type: CodeTaskContextType.File,
          label: input.path || "",
          path: input.path || "",
        };
      case CodeTaskContextType.Incident:
        return await CodeTaskContextBuilder.buildIncident(input, context);
      case CodeTaskContextType.Alert:
        return await CodeTaskContextBuilder.buildAlert(input, context);
      case CodeTaskContextType.Exception:
        return await CodeTaskContextBuilder.buildException(input, context);
      case CodeTaskContextType.Monitor:
        return await CodeTaskContextBuilder.buildMonitor(input, context);
      case CodeTaskContextType.Trace:
        return await CodeTaskContextBuilder.buildTrace(input, context);
      case CodeTaskContextType.Logs:
        return await CodeTaskContextBuilder.buildLogs(input, context);
      case CodeTaskContextType.Profile:
        return await CodeTaskContextBuilder.buildProfile(input, context);
      default:
        throw new BadDataException("Unknown context type.");
    }
  }

  private static async buildIncident(
    input: CodeTaskContextInput,
    context: CodeTaskContextBuildContext,
  ): Promise<CodeTaskContextItem> {
    const incident: Incident | null = await IncidentService.findOneBy({
      query: {
        _id: input.id!,
        projectId: context.projectId,
      },
      select: {
        _id: true,
        title: true,
        description: true,
        rootCause: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        createdAt: true,
        currentIncidentState: { name: true },
        incidentSeverity: { name: true },
        monitors: { name: true },
      },
      props: context.props,
    });

    if (!incident) {
      throw new BadDataException(
        "That incident was not found in this project, or you cannot see it.",
      );
    }

    const handle: string = CodeTaskContextBuilder.numberHandle(
      incident.incidentNumberWithPrefix,
      incident.incidentNumber,
    );
    const title: string = incident.title || "";

    return {
      type: CodeTaskContextType.Incident,
      recordId: input.id!,
      label: CodeTaskContextBuilder.shorten(
        CodeTaskContextBuilder.recordTitle("Incident", handle, title),
        RECORD_LABEL_LENGTH,
      ),
      snapshot: CodeTaskContextBuilder.renderSnapshot([
        CodeTaskContextBuilder.recordTitle("Incident", handle, title),
        CodeTaskContextBuilder.facts([
          ["State", incident.currentIncidentState?.name],
          ["Severity", incident.incidentSeverity?.name],
          ["Declared", CodeTaskContextBuilder.date(incident.createdAt)],
          [
            "Monitors",
            (incident.monitors || [])
              .map((monitor: Monitor): string => {
                return monitor.name || "";
              })
              .filter(Boolean)
              .join(", "),
          ],
        ]),
        CodeTaskContextBuilder.section("Description", incident.description),
        CodeTaskContextBuilder.section("Root cause", incident.rootCause),
      ]),
    };
  }

  private static async buildAlert(
    input: CodeTaskContextInput,
    context: CodeTaskContextBuildContext,
  ): Promise<CodeTaskContextItem> {
    const alert: Alert | null = await AlertService.findOneBy({
      query: {
        _id: input.id!,
        projectId: context.projectId,
      },
      select: {
        _id: true,
        title: true,
        description: true,
        rootCause: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        createdAt: true,
        currentAlertState: { name: true },
        alertSeverity: { name: true },
        monitor: { name: true },
      },
      props: context.props,
    });

    if (!alert) {
      throw new BadDataException(
        "That alert was not found in this project, or you cannot see it.",
      );
    }

    const handle: string = CodeTaskContextBuilder.numberHandle(
      alert.alertNumberWithPrefix,
      alert.alertNumber,
    );
    const title: string = alert.title || "";

    return {
      type: CodeTaskContextType.Alert,
      recordId: input.id!,
      label: CodeTaskContextBuilder.shorten(
        CodeTaskContextBuilder.recordTitle("Alert", handle, title),
        RECORD_LABEL_LENGTH,
      ),
      snapshot: CodeTaskContextBuilder.renderSnapshot([
        CodeTaskContextBuilder.recordTitle("Alert", handle, title),
        CodeTaskContextBuilder.facts([
          ["State", alert.currentAlertState?.name],
          ["Severity", alert.alertSeverity?.name],
          ["Created", CodeTaskContextBuilder.date(alert.createdAt)],
          ["Monitor", alert.monitor?.name],
        ]),
        CodeTaskContextBuilder.section("Description", alert.description),
        CodeTaskContextBuilder.section("Root cause", alert.rootCause),
      ]),
    };
  }

  private static async buildException(
    input: CodeTaskContextInput,
    context: CodeTaskContextBuildContext,
  ): Promise<CodeTaskContextItem> {
    const exception: TelemetryException | null =
      await TelemetryExceptionService.findOneBy({
        query: {
          _id: input.id!,
          projectId: context.projectId,
        },
        select: {
          _id: true,
          message: true,
          exceptionType: true,
          stackTrace: true,
          occuranceCount: true,
          firstSeenAt: true,
          lastSeenAt: true,
          environment: true,
          isResolved: true,
          primaryEntityId: true,
        },
        props: context.props,
      });

    if (!exception) {
      throw new BadDataException(
        "That exception was not found in this project, or you cannot see it.",
      );
    }

    // The service's name, when the person may see the service.
    const service: Service | null = exception.primaryEntityId
      ? await ServiceService.findOneBy({
          query: {
            _id: exception.primaryEntityId.toString(),
            projectId: context.projectId,
          },
          select: { name: true },
          props: context.props,
        }).catch((): null => {
          return null;
        })
      : null;

    const message: string = sanitizeExceptionMessage(exception.message || "");
    const exceptionType: string = exception.exceptionType || "Exception";
    const stackTrace: string = sanitizeStackTrace(exception.stackTrace || "")
      .split("\n")
      .slice(0, STACK_TRACE_LINES)
      .join("\n");

    return {
      type: CodeTaskContextType.Exception,
      recordId: input.id!,
      label: CodeTaskContextBuilder.shorten(
        message ? `${exceptionType}: ${message}` : exceptionType,
        RECORD_LABEL_LENGTH,
      ),
      snapshot: CodeTaskContextBuilder.renderSnapshot([
        `${exceptionType}: ${message}`,
        CodeTaskContextBuilder.facts([
          ["Service", service?.name],
          ["Environment", exception.environment],
          ["Occurrences", exception.occuranceCount?.toString()],
          ["First seen", CodeTaskContextBuilder.date(exception.firstSeenAt)],
          ["Last seen", CodeTaskContextBuilder.date(exception.lastSeenAt)],
          ["Resolved", exception.isResolved ? "yes" : undefined],
        ]),
        CodeTaskContextBuilder.section("Stack trace", stackTrace),
      ]),
    };
  }

  private static async buildMonitor(
    input: CodeTaskContextInput,
    context: CodeTaskContextBuildContext,
  ): Promise<CodeTaskContextItem> {
    const monitor: Monitor | null = await MonitorService.findOneBy({
      query: {
        _id: input.id!,
        projectId: context.projectId,
      },
      select: {
        _id: true,
        name: true,
        description: true,
        monitorType: true,
        currentMonitorStatus: { name: true },
      },
      props: context.props,
    });

    if (!monitor) {
      throw new BadDataException(
        "That monitor was not found in this project, or you cannot see it.",
      );
    }

    return {
      type: CodeTaskContextType.Monitor,
      recordId: input.id!,
      label: CodeTaskContextBuilder.shorten(
        monitor.name || "Monitor",
        RECORD_LABEL_LENGTH,
      ),
      snapshot: CodeTaskContextBuilder.renderSnapshot([
        `Monitor: ${monitor.name || ""}`,
        CodeTaskContextBuilder.facts([
          ["Type", monitor.monitorType?.toString()],
          ["Status", monitor.currentMonitorStatus?.name],
        ]),
        CodeTaskContextBuilder.section("Description", monitor.description),
      ]),
    };
  }

  private static async buildTrace(
    input: CodeTaskContextInput,
    context: CodeTaskContextBuildContext,
  ): Promise<CodeTaskContextItem> {
    const traceId: string = input.traceId || "";

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "get_trace",
      args: { traceId: traceId },
      ctx: { projectId: context.projectId, props: context.props },
    });

    if (!outcome.success || !outcome.result) {
      throw new BadDataException(
        outcome.errorMessage ||
          "That trace could not be read. You may not have access to traces.",
      );
    }

    if (outcome.result.rowCount === 0) {
      throw new BadDataException(
        "No spans were found for that trace ID in this project. It may be mistyped, or older than your trace retention.",
      );
    }

    return {
      type: CodeTaskContextType.Trace,
      label: `Trace ${traceId.substring(0, 8)}…`,
      traceId: traceId,
      snapshot: CodeTaskContextBuilder.capSnapshot(
        [`Trace ${traceId} (span tree):`, outcome.result.dataForLlm].join("\n"),
      ),
    };
  }

  private static async buildLogs(
    input: CodeTaskContextInput,
    context: CodeTaskContextBuildContext,
  ): Promise<CodeTaskContextItem> {
    const hours: number = input.hours || DEFAULT_CODE_TASK_LOG_WINDOW_IN_HOURS;
    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveHours(endTime, -1 * hours);
    const search: string = input.search || "";

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "search_logs",
      args: {
        bodySearchText: search,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        limit: LOG_LINES,
        ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      },
      ctx: { projectId: context.projectId, props: context.props },
    });

    if (!outcome.success || !outcome.result) {
      throw new BadDataException(
        outcome.errorMessage ||
          "Logs could not be read. You may not have access to logs.",
      );
    }

    const item: CodeTaskContextItem = {
      type: CodeTaskContextType.Logs,
      label: CodeTaskContextBuilder.shorten(
        `Logs matching "${search}"`,
        RECORD_LABEL_LENGTH,
      ),
      search: search,
      hours: hours,
      snapshot: CodeTaskContextBuilder.capSnapshot(
        [
          `The latest log lines whose body contains "${search}", from the last ${hours} hour(s), newest first:`,
          outcome.result.rowCount === 0
            ? "(no matching log lines)"
            : outcome.result.dataForLlm,
        ].join("\n"),
      ),
    };

    if (input.serviceId) {
      item.serviceId = input.serviceId;
    }

    return item;
  }

  /*
   * One function of a service's profile, read the way the AI tools read it
   * (get_profile_function) under the person's own permissions: its share
   * of the time, its hottest line, who calls it and what it calls - and,
   * with a window it was compared with, how that changed.
   */
  private static async buildProfile(
    input: CodeTaskContextInput,
    context: CodeTaskContextBuildContext,
  ): Promise<CodeTaskContextItem> {
    const functionName: string = input.functionName || "";
    const window: { startTime: string; endTime: string } =
      input.startTime && input.endTime
        ? { startTime: input.startTime, endTime: input.endTime }
        : CodeTaskContextBuilder.lastHours(
            input.hours || DEFAULT_CODE_TASK_PROFILE_WINDOW_IN_HOURS,
          );

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "get_profile_function",
      args: {
        functionName: functionName,
        serviceId: input.serviceId || "",
        startTime: window.startTime,
        endTime: window.endTime,
        ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
        ...(input.profileType ? { profileType: input.profileType } : {}),
        ...(input.beforeStartTime && input.beforeEndTime
          ? {
              beforeStartTime: input.beforeStartTime,
              beforeEndTime: input.beforeEndTime,
            }
          : {}),
      },
      ctx: { projectId: context.projectId, props: context.props },
    });

    if (!outcome.success || !outcome.result) {
      throw new BadDataException(
        outcome.errorMessage ||
          "That profile could not be read. You may not have access to profiles.",
      );
    }

    if (outcome.result.rowCount === 0) {
      throw new BadDataException(
        "That function took no time in this service's profiles in that time range. Pick a function the Profiler shows, or a longer time range.",
      );
    }

    /*
     * The service's name, for the label: only when the person may read the
     * service (a host or a cluster is not one, and is named by its id).
     */
    let service: Service | null = null;

    if (input.serviceId) {
      try {
        service = await ServiceService.findOneBy({
          query: {
            _id: input.serviceId,
            projectId: context.projectId,
          },
          select: { name: true },
          props: context.props,
        });
      } catch {
        service = null;
      }
    }

    const label: string = service?.name
      ? `Profile: ${functionName} in ${service.name}`
      : `Profile: ${functionName}`;

    const item: CodeTaskContextItem = {
      type: CodeTaskContextType.Profile,
      label: CodeTaskContextBuilder.shorten(label, RECORD_LABEL_LENGTH),
      functionName: functionName,
      startTime: window.startTime,
      endTime: window.endTime,
      snapshot: CodeTaskContextBuilder.capSnapshot(
        [
          service?.name
            ? `The continuous profile of ${service.name}, for the function below:`
            : "The continuous profile, for the function below:",
          outcome.result.dataForLlm,
        ].join("\n"),
      ),
    };

    if (input.serviceId) {
      item.serviceId = input.serviceId;
    }

    if (input.fileName !== undefined) {
      item.fileName = input.fileName;
    }

    if (input.profileType) {
      item.profileType = input.profileType;
    }

    if (input.beforeStartTime && input.beforeEndTime) {
      item.beforeStartTime = input.beforeStartTime;
      item.beforeEndTime = input.beforeEndTime;
    }

    return item;
  }

  // The last `hours` hours, as ISO timestamps.
  private static lastHours(hours: number): {
    startTime: string;
    endTime: string;
  } {
    const endTime: Date = OneUptimeDate.getCurrentDate();

    return {
      startTime: OneUptimeDate.addRemoveHours(
        endTime,
        -1 * hours,
      ).toISOString(),
      endTime: endTime.toISOString(),
    };
  }

  // "Incident #42: Checkout is down", "Incident: ..." when it has no number.
  public static recordTitle(
    kind: string,
    handle: string,
    title: string,
  ): string {
    return handle ? `${kind} ${handle}: ${title}` : `${kind}: ${title}`;
  }

  // "#42", or the project's own numbering ("INC-42") when it has one.
  private static numberHandle(
    withPrefix: string | undefined,
    plain: number | undefined,
  ): string {
    if (withPrefix) {
      return withPrefix;
    }

    return plain !== undefined && plain !== null ? `#${plain}` : "";
  }

  private static facts(
    pairs: Array<[string, string | undefined | null]>,
  ): string {
    return pairs
      .filter((pair: [string, string | undefined | null]): boolean => {
        return Boolean(pair[1] && pair[1].toString().trim());
      })
      .map((pair: [string, string | undefined | null]): string => {
        return `${pair[0]}: ${pair[1]}`;
      })
      .join("\n");
  }

  private static section(
    title: string,
    body: string | undefined | null,
  ): string {
    if (!body || !body.trim()) {
      return "";
    }

    return `${title}:\n${body.trim()}`;
  }

  private static date(date: Date | undefined): string | undefined {
    if (!date) {
      return undefined;
    }

    try {
      return new Date(date).toISOString();
    } catch {
      return undefined;
    }
  }

  /*
   * What the AI reads of a record: its parts, redacted the way the AI
   * toolbox redacts what it gives a model, embedded files left out, capped.
   */
  public static renderSnapshot(parts: Array<string>): string {
    const text: string = parts
      .filter((part: string): boolean => {
        return part.trim().length > 0;
      })
      .join("\n\n");

    return CodeTaskContextBuilder.capSnapshot(
      ToolResultSerializer.redactAndOmitEmbeddedData(text).text,
    );
  }

  public static capSnapshot(text: string): string {
    if (text.length <= CODE_TASK_LIMITS.maxSnapshotLength) {
      return text;
    }

    return `${text.substring(0, CODE_TASK_LIMITS.maxSnapshotLength)}\n… [truncated]`;
  }

  public static shorten(text: string, maxLength: number): string {
    const oneLine: string = text.split(/\s+/).join(" ").trim();

    if (oneLine.length <= maxLength) {
      return oneLine;
    }

    return `${oneLine.substring(0, maxLength - 1).trimEnd()}…`;
  }

  // A link's host and path, for a link given no title.
  public static describeUrl(url: string): string {
    try {
      const parsed: URL = new URL(url);
      const path: string = parsed.pathname === "/" ? "" : parsed.pathname;

      return CodeTaskContextBuilder.shorten(
        `${parsed.host}${path}`,
        RECORD_LABEL_LENGTH,
      );
    } catch {
      return CodeTaskContextBuilder.shorten(url, RECORD_LABEL_LENGTH);
    }
  }
}
