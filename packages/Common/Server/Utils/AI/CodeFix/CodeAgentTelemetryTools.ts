import AIRunService from "../../../Services/AIRunService";
import ChangeEventService from "../../../Services/ChangeEventService";
import ExceptionInstanceService from "../../../Services/ExceptionInstanceService";
import IncidentService from "../../../Services/IncidentService";
import MetricTypeService from "../../../Services/MetricTypeService";
import SpanService from "../../../Services/SpanService";
import TelemetryExceptionService, {
  ExceptionOfGroup,
} from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import {
  extractCandidatePathsFromStackTrace,
  findPathsWithLineNumber,
} from "../../CodeRepository/StackTraceRepoResolver";
import { getIncidentSelfPrivacyRaw } from "../../Incident/IncidentPrivacyFilter";
import logger from "../../Logger";
import {
  sanitizeExceptionMessage,
  sanitizeStackTrace,
} from "../../Telemetry/ExceptionSanitizer";
import RecentChangesContext, {
  ChangeRelevance,
  groupRecordedChanges,
  MAX_CHANGES_READ,
  MAX_LISTED_CHANGES,
  RecentChange,
  RecordedChange,
  toRecordedChange,
} from "../SRE/RecentChangesContext";
import { ChangeImpactVerdict } from "../SRE/ChangeImpact";
import { untrustedLine } from "../SRE/UntrustedText";
import AIToolbox, { ToolCallOutcome } from "../Toolbox/Index";
import { METRIC_ATTRIBUTE_SCHEMA_PROPERTIES } from "../Toolbox/MetricAttributeQuery";
import ToolResultSerializer, { SerializedResult } from "../Toolbox/Serializer";
import { renderSpanTree } from "../Toolbox/TraceTools";
import {
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
} from "../Toolbox/ToolTypes";
import {
  CodeAgentScope,
  CodeAgentScopedService,
} from "./CodeAgentTelemetryScope";
import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import Span from "../../../../Models/AnalyticsModels/Span";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../Models/DatabaseModels/Incident";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import AIRunType from "../../../../Types/AI/AIRunType";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../../Types/BaseDatabase/IncludesAnyOfGroups";
import { getOccurrenceFingerprintQuery } from "../../../../Types/Telemetry/ExceptionGroupFingerprints";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { describeChangeEventFields } from "../../../../Utils/Telemetry/ChangeEventFields";

/*
 * THE CODE AGENT'S PRODUCTION TELEMETRY TOOLS.
 *
 * Read-only tools the in-house code agent calls through the server
 * (CodeAgentTelemetry, /ai-agent-data/run-telemetry-tool) while it reviews
 * a pull request or writes a fix, over the AI toolbox's own reads:
 * query_traces, search_logs and query_metrics ARE the toolbox's tools, run
 * through AIToolbox.executeTool; the others read the same services the
 * toolbox reads, and every result goes through the toolbox's serializer
 * (redaction of tokens, keys, passwords and addresses; embedded data left
 * out; row, field and payload caps).
 *
 * Every read is held to the run's scope (CodeAgentTelemetryScope): its
 * project, and the services its repository serves. A tool that reads one
 * service takes serviceId, refuses one outside the scope before it reads
 * anything, and hands the toolbox tool the service in place of whatever
 * the model asked; a tool that reads several names them in its query. Of
 * what the model passes, only the arguments a tool declares reach a read.
 *
 * Nothing here writes: no tool is a mutation, and the only toolbox tools
 * the code agent can reach are the three named above.
 *
 * What telemetry carries - an exception's message, a log line, a deploy's
 * title, an incident's root cause - is written by whoever sends it, and
 * reaches the model as data: on one line, redacted, held to a length, and
 * quoted where it is free text (UntrustedText), so it cannot start a line
 * of its own in a result.
 */

// How far back find_production_exceptions reads by default, and at most.
export const DEFAULT_EXCEPTION_WINDOW_DAYS: number = 7;
export const MAX_EXCEPTION_WINDOW_DAYS: number = 30;

// How far back find_production_incidents reads by default, and at most.
export const DEFAULT_INCIDENT_WINDOW_DAYS: number = 90;
export const MAX_INCIDENT_WINDOW_DAYS: number = 365;

// How far back recent_deploys reads by default, and at most.
export const DEFAULT_DEPLOY_WINDOW_DAYS: number = 7;
export const MAX_DEPLOY_WINDOW_DAYS: number = 30;

// The most repository paths one call matches against.
export const MAX_PATHS_PER_CALL: number = 10;

// The most exception groups read for one searched term.
const MAX_EXCEPTION_GROUPS_PER_TERM: number = 25;

// The most frames of one exception a result shows.
const MAX_FRAMES_PER_EXCEPTION: number = 5;

// The stack-trace lines read for frames, and the longest line read.
const MAX_STACK_TRACE_LINES: number = 200;
const MAX_STACK_TRACE_LINE_LENGTH: number = 2000;

// The most spans of one trace get_trace reads.
const MAX_TRACE_SPANS: number = 300;

// The most incidents read before the files and text narrow them.
const MAX_INCIDENTS_READ: number = 50;

// The most of this repository's fix runs read for the incidents they fixed.
const MAX_FIX_RUNS_READ: number = 100;

// The most metric names listed for a service.
const MAX_METRIC_NAMES: number = 100;

// How many of a scope's services a refusal lists.
const MAX_LISTED_SERVICE_CHOICES: number = 20;

// What one tool call gives the model.
export interface CodeAgentTelemetryToolOutput {
  text: string;
  rowCount: number;
  citationLabel: string;
  isTruncated: boolean;
}

// A tool call whose arguments were read: the read, ready to run.
export type PreparedTelemetryRead = () => Promise<CodeAgentTelemetryToolOutput>;

export interface CodeAgentTelemetryTool {
  name: string;
  description: string;
  // JSON Schema for the arguments, handed to the model.
  inputSchema: JSONObject;
  /*
   * Reads the arguments against the scope, and returns the read. Nothing is
   * read here: a call whose arguments are refused (a BadDataException the
   * model can correct) costs the run nothing.
   */
  prepare(args: JSONObject, scope: CodeAgentScope): PreparedTelemetryRead;
}

/*
 * The context a read runs in: a system read held to the run's project, as
 * the autonomous investigations read (AIInvestigationEngine). The model
 * layer adds the tenant to every query of a model with a project column,
 * and every query below names the project as well.
 */
export function getTelemetryToolContext(scope: CodeAgentScope): ToolContext {
  return {
    projectId: scope.projectId,
    props: { isRoot: true, tenantId: scope.projectId },
  };
}

/*
 * Text telemetry or a person wrote, of any length, as one line held to
 * maxLength (UntrustedText). It is cut first, so no pattern reads more than
 * a few times what is kept: a root cause or a message can be megabytes long.
 */
export function boundedLine(text: string, maxLength: number): string {
  return untrustedLine(text.slice(0, maxLength * 4), maxLength);
}

// The same, quoted: read as a value, never as words of the prompt.
export function boundedQuotedLine(text: string, maxLength: number): string {
  return JSON.stringify(boundedLine(text, maxLength));
}

// "id (name)" for a refusal or a description, at most a few of them.
function describeServiceChoices(scope: CodeAgentScope): string {
  const listed: Array<string> = scope.services
    .slice(0, MAX_LISTED_SERVICE_CHOICES)
    .map((service: CodeAgentScopedService): string => {
      return `${service.id} (${JSON.stringify(service.name)})`;
    });

  const more: number = scope.services.length - listed.length;

  return `${listed.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
}

/*
 * The one service a read is for: the one asked for - by id, or by its exact
 * name - when the repository serves it, or the only one it serves. A
 * service outside the scope is refused here, before anything is read.
 */
export function pickScopedService(
  args: JSONObject,
  scope: CodeAgentScope,
): CodeAgentScopedService {
  const requested: string | undefined = ToolArgs.getString(args, "serviceId");

  if (requested) {
    const asked: string = requested.toLowerCase();

    const byId: CodeAgentScopedService | undefined = scope.services.find(
      (service: CodeAgentScopedService): boolean => {
        return service.id === asked;
      },
    );

    if (byId) {
      return byId;
    }

    const byName: Array<CodeAgentScopedService> = scope.services.filter(
      (service: CodeAgentScopedService): boolean => {
        return service.name.toLowerCase() === asked;
      },
    );

    if (byName.length === 1 && byName[0]) {
      return byName[0];
    }

    throw new BadDataException(
      `${boundedQuotedLine(requested, 80)} is not one of the services this repository serves, so its telemetry cannot be read here. Pass one of: ${describeServiceChoices(scope)}.`,
    );
  }

  if (scope.services.length === 1 && scope.services[0]) {
    return scope.services[0];
  }

  throw new BadDataException(
    `This repository serves ${scope.services.length} services: pass serviceId, one of: ${describeServiceChoices(scope)}.`,
  );
}

// The services a read is for: the one asked for, or every one in scope.
export function pickScopedServices(
  args: JSONObject,
  scope: CodeAgentScope,
): Array<CodeAgentScopedService> {
  if (ToolArgs.getString(args, "serviceId")) {
    return [pickScopedService(args, scope)];
  }

  return scope.services;
}

function serviceObjectIds(
  services: Array<CodeAgentScopedService>,
): Array<ObjectID> {
  return services.map((service: CodeAgentScopedService): ObjectID => {
    return new ObjectID(service.id);
  });
}

function serviceNameOf(
  scope: CodeAgentScope,
  id: ObjectID | string | undefined,
): string | undefined {
  if (!id) {
    return undefined;
  }

  const wanted: string = id.toString().toLowerCase();

  return scope.services.find((service: CodeAgentScopedService): boolean => {
    return service.id === wanted;
  })?.name;
}

function describeServices(services: Array<CodeAgentScopedService>): string {
  if (services.length === 1 && services[0]) {
    return JSON.stringify(services[0].name);
  }

  return `the repository's ${services.length} services`;
}

/*
 * The serviceId argument, as every tool that reads services takes it. Its
 * description names no service: the scope is in the agent's prompt, and
 * the tool definitions are the same for every run.
 */
const SERVICE_ID_PROPERTY: JSONObject = {
  type: "string",
  description:
    "One of the services this repository serves, by its id or its exact name (they are listed in your instructions). Required when the repository serves more than one; telemetry of any other service cannot be read.",
};

const OPTIONAL_SERVICE_ID_PROPERTY: JSONObject = {
  type: "string",
  description:
    "Only this one of the services this repository serves (its id or exact name). Defaults to all of them.",
};

const PATHS_PROPERTY: JSONObject = {
  type: "array",
  items: { type: "string" },
  description: `Repository paths of files (relative to the repository root), at most ${MAX_PATHS_PER_CALL}: only results that point at these files.`,
};

/*
 * A repository path as a frame is matched against it: forward slashes, no
 * leading "./" or "/". Null for one that names no file.
 */
export function normalizeRepositoryPath(path: string): string | null {
  const normalized: string = path
    .trim()
    .split("\\")
    .join("/")
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0 && segment !== ".";
    })
    .join("/");

  if (!normalized || normalized.length > 400) {
    return null;
  }

  return normalized;
}

function readPaths(args: JSONObject): Array<string> {
  const paths: Array<string> = [];

  for (const path of ToolArgs.getStringArray(args, "paths") || []) {
    const normalized: string | null = normalizeRepositoryPath(path);

    if (normalized && !paths.includes(normalized)) {
      paths.push(normalized);
    }
  }

  if (paths.length > MAX_PATHS_PER_CALL) {
    throw new BadDataException(
      `Pass at most ${MAX_PATHS_PER_CALL} paths in one call.`,
    );
  }

  return paths;
}

function basenameOf(path: string): string {
  const slash: number = path.lastIndexOf("/");

  return slash === -1 ? path : path.slice(slash + 1);
}

// How many trailing segments two paths share.
function sharedTrailingSegments(first: string, second: string): number {
  const a: Array<string> = first.split("/");
  const b: Array<string> = second.split("/");
  let shared: number = 0;

  while (
    shared < a.length &&
    shared < b.length &&
    a[a.length - 1 - shared] === b[b.length - 1 - shared]
  ) {
    shared++;
  }

  return shared;
}

function isIdentifierCharacter(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code === 0x24
  );
}

// Whether `text` holds `word` as a whole identifier - read with indexOf.
export function containsIdentifier(text: string, word: string): boolean {
  if (!word) {
    return false;
  }

  let from: number = 0;

  while (from <= text.length - word.length) {
    const at: number = text.indexOf(word, from);

    if (at === -1) {
      return false;
    }

    const before: number = at > 0 ? text.charCodeAt(at - 1) : NaN;
    const after: number =
      at + word.length < text.length ? text.charCodeAt(at + word.length) : NaN;

    if (
      (Number.isNaN(before) || !isIdentifierCharacter(before)) &&
      (Number.isNaN(after) || !isIdentifierCharacter(after))
    ) {
      return true;
    }

    from = at + 1;
  }

  return false;
}

/*
 * A frame line without its file locations - the paths with a line number
 * (V8, Ruby, Go, Java) and a quoted file (Python's File "...") - so a
 * function's name is looked for where a frame names its function, never in
 * a file name that happens to spell it (total in cart/total.ts).
 */
export function withoutFileLocations(line: string): string {
  let text: string = line;

  for (const location of findPathsWithLineNumber(line)) {
    text = text.split(location).join(" ");
  }

  let kept: string = "";
  let from: number = 0;

  while (from < text.length) {
    const open: number = text.indexOf('"', from);

    if (open === -1) {
      kept += text.slice(from);
      break;
    }

    const close: number = text.indexOf('"', open + 1);

    if (close === -1) {
      kept += text.slice(from);
      break;
    }

    kept += `${text.slice(from, open)} `;
    from = close + 1;
  }

  return kept;
}

export interface MatchedFrame {
  frame: string;
  // "path": two or more segments of the file's path; "file name": its name only.
  match: "path" | "file name" | "function";
  path?: string | undefined;
}

/*
 * The frames of a stack trace that run through the files asked for and,
 * when one is named, through the function. A frame's file is the file
 * asked for when one of the two paths is the other's tail, segment by
 * segment, as the repository resolver matches a frame: a container's
 * /app/src/billing/charge.ts is the repository's
 * services/billing/src/billing/charge.ts, and a Java frame, which names only
 * Charge.java, is any Charge.java - but lib/reports/charge.ts is not.
 * Read line by line, with indexOf and the resolver's own path reader, in
 * time in line with the trace's length.
 */
export function findMatchingFrames(data: {
  stackTrace: string;
  paths: Array<string>;
  functionName?: string | undefined;
}): Array<MatchedFrame> {
  const frames: Array<MatchedFrame> = [];
  const seen: Set<string> = new Set<string>();
  const lines: Array<string> = data.stackTrace
    .split("\n")
    .slice(0, MAX_STACK_TRACE_LINES);

  for (const rawLine of lines) {
    if (frames.length >= MAX_FRAMES_PER_EXCEPTION) {
      break;
    }

    const line: string = rawLine.slice(0, MAX_STACK_TRACE_LINE_LENGTH).trim();

    if (!line || seen.has(line)) {
      continue;
    }

    if (
      data.functionName &&
      !containsIdentifier(withoutFileLocations(line), data.functionName)
    ) {
      continue;
    }

    if (data.paths.length === 0) {
      if (data.functionName) {
        seen.add(line);
        frames.push({ frame: boundedLine(line, 300), match: "function" });
      }

      continue;
    }

    let best: { shared: number; path: string } | null = null;

    for (const candidate of extractCandidatePathsFromStackTrace(line)) {
      for (const path of data.paths) {
        const shared: number = sharedTrailingSegments(candidate, path);
        const shorter: number = Math.min(
          candidate.split("/").length,
          path.split("/").length,
        );

        if (
          shared > 0 &&
          shared === shorter &&
          (!best || shared > best.shared)
        ) {
          best = { shared, path };
        }
      }
    }

    if (best) {
      seen.add(line);
      frames.push({
        frame: boundedLine(line, 300),
        match: best.shared >= 2 ? "path" : "file name",
        path: best.path,
      });
    }
  }

  return frames;
}

// The first frames of a stack trace that name a file: where it was thrown.
function findTopFrames(stackTrace: string): Array<string> {
  const frames: Array<string> = [];

  for (const rawLine of stackTrace
    .split("\n")
    .slice(0, MAX_STACK_TRACE_LINES)) {
    if (frames.length >= 3) {
      break;
    }

    const line: string = rawLine.slice(0, MAX_STACK_TRACE_LINE_LENGTH).trim();

    if (line && extractCandidatePathsFromStackTrace(line).length > 0) {
      frames.push(boundedLine(line, 300));
    }
  }

  return frames;
}

/*
 * A toolbox tool, run for one service of the scope: only the arguments it
 * declares are passed, and the service argument is the service picked from
 * the scope, never the model's. AIToolbox.executeTool times it out and turns
 * a failure into an error the model can correct.
 */
async function runToolboxToolForService(data: {
  toolName: string;
  allowedArguments: Array<string>;
  args: JSONObject;
  serviceArgument: string;
  service: CodeAgentScopedService;
  scope: CodeAgentScope;
}): Promise<CodeAgentTelemetryToolOutput> {
  const toolArgs: JSONObject = {};

  for (const key of data.allowedArguments) {
    if (data.args[key] !== undefined && data.args[key] !== null) {
      toolArgs[key] = data.args[key];
    }
  }

  toolArgs[data.serviceArgument] = data.service.id;

  const outcome: ToolCallOutcome = await AIToolbox.executeTool({
    name: data.toolName,
    args: toolArgs,
    ctx: getTelemetryToolContext(data.scope),
  });

  return {
    text: `Service ${JSON.stringify(data.service.name)} (${data.service.id}):\n${outcome.textForLlm}`,
    rowCount: outcome.result?.rowCount || 0,
    citationLabel: `${outcome.result?.citationLabel || data.toolName} · ${data.service.name}`,
    isTruncated: Boolean(outcome.result?.isTruncated),
  };
}

function serializedOutput(data: {
  serialized: SerializedResult;
  citationLabel: string;
  // A line of OneUptime's own before the rows: what they are, or that there are none.
  lead?: string | undefined;
}): CodeAgentTelemetryToolOutput {
  return {
    text: data.lead
      ? `${data.lead}\n${data.serialized.text}`
      : data.serialized.text,
    rowCount: data.serialized.rowCount,
    citationLabel: data.citationLabel,
    isTruncated: data.serialized.isTruncated,
  };
}

const FindProductionExceptionsTool: CodeAgentTelemetryTool = {
  name: "find_production_exceptions",
  description:
    "Exceptions this repository's services threw in production, grouped by fingerprint: type, message, how often in the window and in all, first and last seen, the release it first appeared in, a recent occurrence's traceId, and the stack frames that run through the files or function you name. Pass paths (repository files) to find exceptions thrown in them, and functionName to narrow to one function. Without either it returns the most frequent exception groups.",
  inputSchema: {
    type: "object",
    properties: {
      paths: PATHS_PROPERTY,
      functionName: {
        type: "string",
        description:
          "A function or method name: only exceptions with a stack frame in it.",
      },
      serviceId: OPTIONAL_SERVICE_ID_PROPERTY,
      days: {
        type: "number",
        description: `Only exceptions seen within this many days (default ${DEFAULT_EXCEPTION_WINDOW_DAYS}, max ${MAX_EXCEPTION_WINDOW_DAYS}).`,
      },
      limit: {
        type: "number",
        description: "Maximum exception groups to return (default 10, max 20).",
      },
    },
  },
  prepare: (args: JSONObject, scope: CodeAgentScope): PreparedTelemetryRead => {
    const paths: Array<string> = readPaths(args);
    const functionName: string | undefined = ToolArgs.getString(
      args,
      "functionName",
    );

    if (functionName && functionName.length > 200) {
      throw new BadDataException("functionName is too long.");
    }

    const days: number = ToolArgs.getNumber(args, "days", {
      defaultValue: DEFAULT_EXCEPTION_WINDOW_DAYS,
      min: 1,
      max: MAX_EXCEPTION_WINDOW_DAYS,
    });
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 20,
    });
    const services: Array<CodeAgentScopedService> = pickScopedServices(
      args,
      scope,
    );

    return async (): Promise<CodeAgentTelemetryToolOutput> => {
      const now: Date = OneUptimeDate.getCurrentDate();
      const since: Date = OneUptimeDate.addRemoveDays(now, -days);
      const select: JSONObject = {
        _id: true,
        primaryEntityId: true,
        message: true,
        exceptionType: true,
        stackTrace: true,
        fingerprint: true,
        occuranceCount: true,
        firstSeenAt: true,
        lastSeenAt: true,
        firstSeenInRelease: true,
        lastSeenInRelease: true,
        isResolved: true,
        unhandled: true,
      };

      const readGroups: (
        stackTraceTerm: string | undefined,
        limitOfRead: number,
      ) => Promise<Array<TelemetryException>> = (
        stackTraceTerm: string | undefined,
        limitOfRead: number,
      ): Promise<Array<TelemetryException>> => {
        return TelemetryExceptionService.findBy({
          query: {
            projectId: scope.projectId,
            primaryEntityId: QueryHelper.any(serviceObjectIds(services)),
            lastSeenAt: QueryHelper.greaterThanEqualTo(since),
            ...(stackTraceTerm
              ? { stackTrace: QueryHelper.search(stackTraceTerm) }
              : {}),
          } as never,
          select: select as never,
          sort: { occuranceCount: SortOrder.Descending },
          limit: limitOfRead,
          skip: 0,
          props: getTelemetryToolContext(scope).props,
        });
      };

      /*
       * One read per file name asked about (or for the function), each
       * narrowed in the database to stack traces that name it; the frames
       * below decide which really run through the file.
       */
      const terms: Array<string> =
        paths.length > 0
          ? Array.from(new Set<string>(paths.map(basenameOf)))
          : functionName
            ? [functionName]
            : [];

      const groupsById: Map<string, TelemetryException> = new Map<
        string,
        TelemetryException
      >();

      const reads: Array<Array<TelemetryException>> =
        terms.length > 0
          ? await Promise.all(
              terms.map((term: string): Promise<Array<TelemetryException>> => {
                return readGroups(term, MAX_EXCEPTION_GROUPS_PER_TERM);
              }),
            )
          : [await readGroups(undefined, limit)];

      for (const groups of reads) {
        for (const group of groups) {
          if (group._id) {
            groupsById.set(group._id.toString(), group);
          }
        }
      }

      const matched: Array<{
        group: TelemetryException;
        frames: Array<string>;
      }> = [];

      for (const group of groupsById.values()) {
        const stackTrace: string = sanitizeStackTrace(group.stackTrace || "");

        if (paths.length > 0 || functionName) {
          const frames: Array<MatchedFrame> = findMatchingFrames({
            stackTrace,
            paths,
            functionName,
          });

          if (frames.length === 0) {
            continue;
          }

          matched.push({
            group,
            frames: frames.map((frame: MatchedFrame): string => {
              return `${frame.frame} [${frame.match}${frame.path ? `: ${frame.path}` : ""}]`;
            }),
          });
          continue;
        }

        matched.push({ group, frames: findTopFrames(stackTrace) });
      }

      matched.sort(
        (
          a: { group: TelemetryException },
          b: { group: TelemetryException },
        ): number => {
          return (
            Number(b.group.occuranceCount || 0) -
            Number(a.group.occuranceCount || 0)
          );
        },
      );

      const listed: Array<{
        group: TelemetryException;
        frames: Array<string>;
      }> = matched.slice(0, limit);

      const occurrences: Map<string, { count?: number; traceId?: string }> =
        await readOccurrences({
          scope,
          groups: listed.map(
            (entry: { group: TelemetryException }): TelemetryException => {
              return entry.group;
            },
          ),
          since,
          now,
        });

      const rows: Array<JSONObject> = listed.map(
        (entry: {
          group: TelemetryException;
          frames: Array<string>;
        }): JSONObject => {
          const group: TelemetryException = entry.group;
          const occurrence: { count?: number; traceId?: string } =
            occurrences.get(group._id?.toString() || "") || {};

          return {
            exceptionId: group._id?.toString(),
            service: serviceNameOf(scope, group.primaryEntityId),
            type: boundedQuotedLine(group.exceptionType || "Exception", 120),
            message: boundedQuotedLine(
              sanitizeExceptionMessage((group.message || "").slice(0, 4000)),
              300,
            ),
            [`occurrencesInLast${days}Days`]: occurrence.count,
            occurrencesAllTime: group.occuranceCount,
            firstSeenAt: group.firstSeenAt,
            lastSeenAt: group.lastSeenAt,
            firstSeenInRelease: group.firstSeenInRelease
              ? boundedLine(group.firstSeenInRelease, 80)
              : undefined,
            lastSeenInRelease: group.lastSeenInRelease
              ? boundedLine(group.lastSeenInRelease, 80)
              : undefined,
            resolved: group.isResolved ? "yes" : undefined,
            unhandled: group.unhandled ? "yes" : undefined,
            recentTraceId: occurrence.traceId,
            frames: entry.frames.join(" ⏎ "),
          };
        },
      );

      const where: string =
        paths.length > 0
          ? ` in ${paths.join(", ")}`
          : functionName
            ? ` in ${functionName}`
            : "";

      return serializedOutput({
        serialized: ToolResultSerializer.serializeRows(rows),
        citationLabel: `Exceptions of ${describeServices(services)}${where}, last ${days} days (${rows.length} found)`,
        lead:
          rows.length === 0
            ? `No exception of ${describeServices(services)} seen in the last ${days} days${where}.`
            : undefined,
      });
    };
  },
};

/*
 * How often each exception group occurred in the window, and the trace of
 * its most recent occurrence: counted from the occurrences themselves
 * (ExceptionInstance), by the group's fingerprints - its own and those of
 * the exceptions merged into it, which count on it
 * (TelemetryExceptionService.getGroupFingerprints) - as the fix verifier
 * counts them. A count that cannot be read is left out, never guessed.
 */
async function readOccurrences(data: {
  scope: CodeAgentScope;
  groups: Array<TelemetryException>;
  since: Date;
  now: Date;
}): Promise<Map<string, { count?: number; traceId?: string }>> {
  const occurrences: Map<string, { count?: number; traceId?: string }> =
    new Map<string, { count?: number; traceId?: string }>();

  const groups: Array<TelemetryException> = data.groups.filter(
    (group: TelemetryException): boolean => {
      return Boolean(group._id && group.fingerprint && group.primaryEntityId);
    },
  );

  if (groups.length === 0) {
    return occurrences;
  }

  const groupFingerprints: Map<string, Array<string>> =
    await TelemetryExceptionService.getGroupFingerprints({
      projectId: data.scope.projectId,
      exceptions: groups.map((group: TelemetryException): ExceptionOfGroup => {
        return { id: group._id!.toString(), fingerprint: group.fingerprint! };
      }),
    });

  const fingerprintsOf: (group: TelemetryException) => Array<string> = (
    group: TelemetryException,
  ): Array<string> => {
    return (
      groupFingerprints.get(group._id!.toString().toLowerCase()) || [
        group.fingerprint!,
      ]
    );
  };

  await Promise.all(
    groups.map(async (group: TelemetryException): Promise<void> => {
      try {
        const count: PositiveNumber = await ExceptionInstanceService.countBy({
          query: {
            projectId: data.scope.projectId,
            primaryEntityId: group.primaryEntityId,
            fingerprint: getOccurrenceFingerprintQuery(fingerprintsOf(group)),
            time: new InBetween(data.since, data.now),
          } as never,
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: getTelemetryToolContext(data.scope).props,
        });

        occurrences.set(group._id!.toString(), { count: count.toNumber() });
      } catch (error) {
        logger.debug(
          `find_production_exceptions: could not count occurrences: ${error}`,
        );
      }
    }),
  );

  try {
    const recent: Array<ExceptionInstance> =
      await ExceptionInstanceService.findBy({
        query: {
          projectId: data.scope.projectId,
          primaryEntityId: new Includes(
            Array.from(
              new Set<string>(
                groups.map((group: TelemetryException): string => {
                  return group.primaryEntityId!.toString();
                }),
              ),
            ),
          ),
          fingerprint: new Includes(
            Array.from(new Set<string>(groups.flatMap(fingerprintsOf))),
          ),
          time: new InBetween(data.since, data.now),
        } as never,
        select: { fingerprint: true, traceId: true, time: true } as never,
        sort: { time: SortOrder.Descending } as never,
        limit: 200,
        skip: 0,
        props: getTelemetryToolContext(data.scope).props,
      });

    for (const group of groups) {
      const fingerprints: Array<string> = fingerprintsOf(group);
      const latest: ExceptionInstance | undefined = recent.find(
        (occurrence: ExceptionInstance): boolean => {
          return (
            fingerprints.includes(occurrence.fingerprint?.toString() || "") &&
            Boolean(occurrence.traceId)
          );
        },
      );

      if (latest?.traceId) {
        const entry: { count?: number; traceId?: string } =
          occurrences.get(group._id!.toString()) || {};
        entry.traceId = latest.traceId.toString();
        occurrences.set(group._id!.toString(), entry);
      }
    }
  } catch (error) {
    logger.debug(
      `find_production_exceptions: could not read recent occurrences: ${error}`,
    );
  }

  return occurrences;
}

const QUERY_TRACES_ARGUMENTS: Array<string> = [
  "startTime",
  "endTime",
  "groupBy",
  "metric",
  "nameSearchText",
  "hasException",
  "rootOnly",
  "limit",
];

const QueryTracesTool: CodeAgentTelemetryTool = {
  name: "query_traces",
  description:
    "Latency and error profile of one of this repository's services from its production spans: count, errorCount and avg/p50/p90/p95/p99 durations in ms, grouped by span name (the operation or endpoint) by default and ranked by p95. Use nameSearchText with a route, an operation or a query the code handles to see how hot and how slow it is. Defaults to the last 24 hours.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      serviceId: SERVICE_ID_PROPERTY,
      groupBy: {
        type: "string",
        enum: ["name", "kind", "statusCode", "isRootSpan"],
        description: "Dimension to group by (default name).",
      },
      metric: {
        type: "string",
        enum: [
          "count",
          "errorCount",
          "avgDuration",
          "minDuration",
          "maxDuration",
          "p50Duration",
          "p90Duration",
          "p95Duration",
          "p99Duration",
        ],
        description:
          "Metric to rank the groups by (default p95Duration); every group carries the whole profile.",
      },
      nameSearchText: {
        type: "string",
        description: "Only spans whose name contains this text.",
      },
      hasException: {
        type: "boolean",
        description: "Only spans that recorded an exception.",
      },
      rootOnly: {
        type: "boolean",
        description: "Only root spans (whole-request latency).",
      },
      limit: {
        type: "number",
        description: "Maximum groups to return (default 10, max 25).",
      },
    },
  },
  prepare: (args: JSONObject, scope: CodeAgentScope): PreparedTelemetryRead => {
    const service: CodeAgentScopedService = pickScopedService(args, scope);

    return (): Promise<CodeAgentTelemetryToolOutput> => {
      return runToolboxToolForService({
        toolName: "query_traces",
        allowedArguments: QUERY_TRACES_ARGUMENTS,
        args,
        serviceArgument: "serviceId",
        service,
        scope,
      });
    };
  },
};

const GetTraceTool: CodeAgentTelemetryTool = {
  name: "get_trace",
  description:
    "The span tree of one production trace by traceId - each span's name, duration and whether it failed - for the spans of this repository's services only (a span whose parent belongs to another service shows as a root). Use it on a recentTraceId from find_production_exceptions, a traceId from search_logs, or the trace a performance finding names.",
  inputSchema: {
    type: "object",
    properties: {
      traceId: {
        type: "string",
        description: "The trace ID (required).",
      },
      serviceId: OPTIONAL_SERVICE_ID_PROPERTY,
    },
    required: ["traceId"],
  },
  prepare: (args: JSONObject, scope: CodeAgentScope): PreparedTelemetryRead => {
    const traceId: string | undefined = ToolArgs.getString(args, "traceId");

    if (!traceId || traceId.length > 128) {
      throw new BadDataException("traceId is required.");
    }

    const services: Array<CodeAgentScopedService> = pickScopedServices(
      args,
      scope,
    );

    return async (): Promise<CodeAgentTelemetryToolOutput> => {
      const spans: Array<Span> = await SpanService.findBy({
        query: {
          projectId: scope.projectId,
          traceId: traceId,
          primaryEntityId: new Includes(
            services.map((service: CodeAgentScopedService): string => {
              return service.id;
            }),
          ),
        } as never,
        select: {
          spanId: true,
          parentSpanId: true,
          name: true,
          startTimeUnixNano: true,
          durationUnixNano: true,
          statusCode: true,
          kind: true,
        } as never,
        sort: { startTimeUnixNano: SortOrder.Ascending } as never,
        limit: MAX_TRACE_SPANS,
        skip: 0,
        props: getTelemetryToolContext(scope).props,
      });

      const lines: Array<string> = renderSpanTree(spans);

      if (spans.length >= MAX_TRACE_SPANS) {
        lines.push(
          `… trace truncated at ${MAX_TRACE_SPANS} spans; deeper spans are omitted.`,
        );
      }

      const serialized: SerializedResult =
        spans.length > 0
          ? ToolResultSerializer.serializeText(lines.join("\n"), spans.length)
          : ToolResultSerializer.serializeText(
              `No span of ${describeServices(services)} in trace ${traceId}: it may be past retention, or belong only to other services.`,
              0,
            );

      return serializedOutput({
        serialized,
        citationLabel: `Trace ${traceId} (${spans.length}${spans.length >= MAX_TRACE_SPANS ? "+" : ""} spans of ${describeServices(services)})`,
      });
    };
  },
};

const SEARCH_LOGS_ARGUMENTS: Array<string> = [
  "startTime",
  "endTime",
  "severityTexts",
  "bodySearchText",
  "traceId",
  "limit",
];

const SearchLogsTool: CodeAgentTelemetryTool = {
  name: "search_logs",
  description:
    "Production log lines of one of this repository's services, newest first: filter by time range, severity, body text or traceId. Defaults to the last hour; pass an explicit window around what you investigate.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      serviceId: SERVICE_ID_PROPERTY,
      severityTexts: {
        type: "array",
        items: { type: "string" },
        description: 'Filter by severity, e.g. ["Error", "Fatal"].',
      },
      bodySearchText: {
        type: "string",
        description: "Only logs whose body contains this text.",
      },
      traceId: {
        type: "string",
        description: "Only logs of this trace.",
      },
      limit: {
        type: "number",
        description: "Maximum log lines to return (default 25, max 50).",
      },
    },
  },
  prepare: (args: JSONObject, scope: CodeAgentScope): PreparedTelemetryRead => {
    const service: CodeAgentScopedService = pickScopedService(args, scope);

    return (): Promise<CodeAgentTelemetryToolOutput> => {
      return runToolboxToolForService({
        toolName: "search_logs",
        allowedArguments: SEARCH_LOGS_ARGUMENTS,
        args,
        serviceArgument: "serviceId",
        service,
        scope,
      });
    };
  },
};

const QUERY_METRICS_ARGUMENTS: Array<string> = [
  "startTime",
  "endTime",
  "metricName",
  "aggregationType",
  ...Object.keys(METRIC_ATTRIBUTE_SCHEMA_PROPERTIES),
];

const QueryMetricsTool: CodeAgentTelemetryTool = {
  name: "query_metrics",
  description:
    "A metric one of this repository's services reports, aggregated over time (Avg, Max, Min, Sum, Count or P50-P99; default Avg over the last 24 hours), filtered by attributes or split with groupBy. Without metricName it lists the metric names the service reports (narrow them with nameSearch).",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      attributes: {
        type: "object",
        additionalProperties: { type: "string" },
        description:
          'Only data points whose attributes equal these values, e.g. {"http.route": "/checkout"}. A data point\'s own attributes are plain keys; its resource\'s attributes start with "resource.".',
      },
      groupBy: METRIC_ATTRIBUTE_SCHEMA_PROPERTIES["groupBy"] as JSONObject,
      serviceId: SERVICE_ID_PROPERTY,
      metricName: {
        type: "string",
        description:
          "Exact metric name. Leave it out to list the names the service reports.",
      },
      nameSearch: {
        type: "string",
        description:
          "When listing metric names: only names that contain this text.",
      },
      aggregationType: {
        type: "string",
        enum: [
          "Avg",
          "Max",
          "Min",
          "Sum",
          "Count",
          "P50",
          "P75",
          "P90",
          "P95",
          "P99",
        ],
        description: "How to aggregate (default Avg).",
      },
    },
  },
  prepare: (args: JSONObject, scope: CodeAgentScope): PreparedTelemetryRead => {
    const service: CodeAgentScopedService = pickScopedService(args, scope);
    const metricName: string | undefined = ToolArgs.getString(
      args,
      "metricName",
    );

    if (metricName) {
      return (): Promise<CodeAgentTelemetryToolOutput> => {
        return runToolboxToolForService({
          toolName: "query_metrics",
          allowedArguments: QUERY_METRICS_ARGUMENTS,
          args,
          serviceArgument: "entityId",
          service,
          scope,
        });
      };
    }

    const nameSearch: string | undefined = ToolArgs.getString(
      args,
      "nameSearch",
    );

    return async (): Promise<CodeAgentTelemetryToolOutput> => {
      // The metric types the service reports (the catalogue's services link).
      const metricTypes: Array<MetricType> = await MetricTypeService.findBy({
        query: {
          projectId: scope.projectId,
          services: new IncludesAnyOfGroups([[service.id]]),
          ...(nameSearch ? { name: QueryHelper.search(nameSearch) } : {}),
        } as never,
        select: { name: true, unit: true },
        sort: { name: SortOrder.Ascending },
        limit: MAX_METRIC_NAMES,
        skip: 0,
        props: getTelemetryToolContext(scope).props,
      });

      const rows: Array<JSONObject> = metricTypes.map(
        (metricType: MetricType): JSONObject => {
          return {
            name: metricType.name,
            unit: metricType.unit || undefined,
          };
        },
      );

      return serializedOutput({
        serialized: ToolResultSerializer.serializeRows(rows),
        citationLabel: `Metric names of ${JSON.stringify(service.name)} (${rows.length} found)`,
        lead: `Metrics ${JSON.stringify(service.name)} (${service.id}) reports - pass one as metricName:`,
      });
    };
  },
};

/*
 * What an incident's text is searched in. Not its description: a monitor's
 * template can put a screenshot there, megabytes of it, and what links an
 * incident to code is its root cause, remediation and postmortem.
 */
const INCIDENT_TEXT_FIELDS: Array<
  "title" | "rootCause" | "remediationNotes" | "postmortemNote"
> = ["title", "rootCause", "remediationNotes", "postmortemNote"];

const FindProductionIncidentsTool: CodeAgentTelemetryTool = {
  name: "find_production_incidents",
  description:
    "Incidents linked to this repository: those that affected one of its services, and those a OneUptime fix in this repository was opened for - newest first, with state, severity, root cause and postmortem. Pass paths (repository files) or searchText to keep only incidents whose title, root cause, remediation or postmortem mention them. Private incidents are never listed.",
  inputSchema: {
    type: "object",
    properties: {
      paths: PATHS_PROPERTY,
      searchText: {
        type: "string",
        description:
          "Only incidents whose text mentions this (a function, an error, an endpoint).",
      },
      days: {
        type: "number",
        description: `Only incidents declared within this many days (default ${DEFAULT_INCIDENT_WINDOW_DAYS}, max ${MAX_INCIDENT_WINDOW_DAYS}).`,
      },
      limit: {
        type: "number",
        description: "Maximum incidents to return (default 5, max 10).",
      },
    },
  },
  prepare: (args: JSONObject, scope: CodeAgentScope): PreparedTelemetryRead => {
    const paths: Array<string> = readPaths(args);
    const searchText: string | undefined = ToolArgs.getString(
      args,
      "searchText",
    );

    if (searchText && searchText.length > 200) {
      throw new BadDataException("searchText is too long.");
    }

    const days: number = ToolArgs.getNumber(args, "days", {
      defaultValue: DEFAULT_INCIDENT_WINDOW_DAYS,
      min: 1,
      max: MAX_INCIDENT_WINDOW_DAYS,
    });
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 5,
      min: 1,
      max: 10,
    });

    // What the incidents' text is searched for: each file and its name.
    const terms: Array<string> = Array.from(
      new Set<string>(
        [
          ...paths,
          ...paths.map(basenameOf),
          ...(searchText ? [searchText] : []),
        ]
          .map((term: string): string => {
            return term.toLowerCase();
          })
          .filter((term: string): boolean => {
            return term.length > 0;
          }),
      ),
    );

    return async (): Promise<CodeAgentTelemetryToolOutput> => {
      const since: Date = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        -days,
      );
      const incidents: Array<{ incident: Incident; linkedBy: string }> =
        await readLinkedIncidents({ scope, since });

      const rows: Array<JSONObject> = [];

      for (const entry of incidents) {
        if (rows.length >= limit) {
          break;
        }

        const mentions: Array<string> = [];

        if (terms.length > 0) {
          for (const field of INCIDENT_TEXT_FIELDS) {
            const value: string = (entry.incident[field] || "").toLowerCase();

            const found: string | undefined = terms.find(
              (term: string): boolean => {
                return value.includes(term);
              },
            );

            if (found) {
              mentions.push(`${field} mentions ${found}`);
            }
          }

          if (mentions.length === 0) {
            continue;
          }
        }

        const incident: Incident = entry.incident;

        rows.push({
          incident:
            incident.incidentNumberWithPrefix ||
            (incident.incidentNumber !== undefined
              ? `#${incident.incidentNumber}`
              : undefined),
          incidentId: incident._id?.toString(),
          title: boundedQuotedLine(incident.title || "", 200),
          state: incident.currentIncidentState?.name,
          severity: incident.incidentSeverity?.name,
          declaredAt: incident.createdAt,
          linkedBy: entry.linkedBy,
          mentions: mentions.length > 0 ? mentions.join("; ") : undefined,
          rootCause: incident.rootCause
            ? boundedLine(incident.rootCause, 800)
            : undefined,
          remediationNotes: incident.remediationNotes
            ? boundedLine(incident.remediationNotes, 400)
            : undefined,
          postmortemNote: incident.postmortemNote
            ? boundedLine(incident.postmortemNote, 800)
            : undefined,
        });
      }

      const about: string =
        terms.length > 0
          ? ` mentioning ${[...paths, ...(searchText ? [searchText] : [])].join(", ")}`
          : "";

      return serializedOutput({
        serialized: ToolResultSerializer.serializeRows(rows),
        citationLabel: `Incidents linked to ${scope.repositoryFullName}${about}, last ${days} days (${rows.length} found)`,
        lead:
          rows.length === 0
            ? `No incident linked to ${scope.repositoryFullName}${about} was declared in the last ${days} days.`
            : undefined,
      });
    };
  },
};

/*
 * The incidents linked to the repository, newest first: those whose
 * affected services include one it serves, and those its own code-fix runs
 * were opened for. Private incidents are left out whoever could read them:
 * what the agent writes reaches a pull request (the clause for a reader who
 * is no one, IncidentPrivacyFilter). Only code-fix runs are read - the
 * shared kind of AI run; chat and investigation runs are personal
 * (AIRunPrivacyFilter) - and only for the incident they name.
 */
async function readLinkedIncidents(data: {
  scope: CodeAgentScope;
  since: Date;
}): Promise<Array<{ incident: Incident; linkedBy: string }>> {
  const select: JSONObject = {
    _id: true,
    title: true,
    rootCause: true,
    remediationNotes: true,
    postmortemNote: true,
    incidentNumber: true,
    incidentNumberWithPrefix: true,
    createdAt: true,
    currentIncidentState: { name: true },
    incidentSeverity: { name: true },
    services: { _id: true },
  };

  const readIncidents: (query: JSONObject) => Promise<Array<Incident>> = (
    query: JSONObject,
  ): Promise<Array<Incident>> => {
    return IncidentService.findBy({
      query: {
        ...query,
        projectId: data.scope.projectId,
        createdAt: QueryHelper.greaterThanEqualTo(data.since),
        isPrivate: getIncidentSelfPrivacyRaw({}),
      } as never,
      select: select as never,
      sort: { createdAt: SortOrder.Descending },
      limit: MAX_INCIDENTS_READ,
      skip: 0,
      props: getTelemetryToolContext(data.scope).props,
    });
  };

  const fixRuns: Array<AIRun> = await AIRunService.findBy({
    query: {
      projectId: data.scope.projectId,
      runType: AIRunType.CodeFix,
      codeRepositoryId: data.scope.codeRepositoryId,
      triggeredByIncidentId: QueryHelper.notNull(),
    },
    select: { triggeredByIncidentId: true },
    sort: { createdAt: SortOrder.Descending },
    limit: MAX_FIX_RUNS_READ,
    skip: 0,
    props: { isRoot: true },
  });

  const fixedIncidentIds: Array<ObjectID> = Array.from(
    new Set<string>(
      fixRuns
        .map((run: AIRun): string => {
          return run.triggeredByIncidentId?.toString() || "";
        })
        .filter(Boolean),
    ),
  ).map((id: string): ObjectID => {
    return new ObjectID(id);
  });

  const [byService, byFix]: [Array<Incident>, Array<Incident>] =
    await Promise.all([
      readIncidents({
        services: new IncludesAnyOfGroups([
          data.scope.services.map((service: CodeAgentScopedService): string => {
            return service.id;
          }),
        ]),
      }),
      fixedIncidentIds.length > 0
        ? readIncidents({ _id: QueryHelper.any(fixedIncidentIds) })
        : Promise.resolve([]),
    ]);

  const fixedIds: Set<string> = new Set<string>(
    fixedIncidentIds.map((id: ObjectID): string => {
      return id.toString().toLowerCase();
    }),
  );
  const linked: Map<string, { incident: Incident; linkedBy: string }> = new Map<
    string,
    { incident: Incident; linkedBy: string }
  >();

  for (const incident of [...byService, ...byFix]) {
    const id: string = incident._id?.toString().toLowerCase() || "";

    if (!id || linked.has(id)) {
      continue;
    }

    // Only the repository's own services are named, never another's.
    const affected: Array<string> = (incident.services || [])
      .map((service: { _id?: string | ObjectID | undefined }): string => {
        return serviceNameOf(data.scope, service._id) || "";
      })
      .filter(Boolean);

    const reasons: Array<string> = [];

    if (affected.length > 0) {
      reasons.push(`affected ${affected.join(", ")}`);
    }

    if (fixedIds.has(id)) {
      reasons.push("a OneUptime fix in this repository was opened for it");
    }

    linked.set(id, {
      incident,
      linkedBy: reasons.join("; ") || "affected a service of this repository",
    });
  }

  return Array.from(linked.values()).sort(
    (a: { incident: Incident }, b: { incident: Incident }): number => {
      return (
        new Date(b.incident.createdAt || 0).getTime() -
        new Date(a.incident.createdAt || 0).getTime()
      );
    },
  );
}

const RecentDeploysTool: CodeAgentTelemetryTool = {
  name: "recent_deploys",
  description:
    "Deploys, rollouts, config changes and rollbacks recorded for this repository's services, newest first, each with the version and commit when known and whether it hurt its service: OneUptime compares the service's span error rate, p99 latency and exceptions in the 30 minutes before and after each recent change with fixed thresholds, and calls it a suspect only when something measurably got worse (or new exception types appeared with its version).",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: OPTIONAL_SERVICE_ID_PROPERTY,
      days: {
        type: "number",
        description: `Only changes within this many days (default ${DEFAULT_DEPLOY_WINDOW_DAYS}, max ${MAX_DEPLOY_WINDOW_DAYS}).`,
      },
    },
  },
  prepare: (args: JSONObject, scope: CodeAgentScope): PreparedTelemetryRead => {
    const services: Array<CodeAgentScopedService> = pickScopedServices(
      args,
      scope,
    );
    const days: number = ToolArgs.getNumber(args, "days", {
      defaultValue: DEFAULT_DEPLOY_WINDOW_DAYS,
      min: 1,
      max: MAX_DEPLOY_WINDOW_DAYS,
    });

    return async (): Promise<CodeAgentTelemetryToolOutput> => {
      const now: Date = OneUptimeDate.getCurrentDate();
      const since: Date = OneUptimeDate.addRemoveDays(now, -days);

      const events: Array<ChangeEvent> = await ChangeEventService.findBy({
        query: {
          projectId: scope.projectId,
          time: new InBetween(since, now),
          primaryEntityId: new Includes(
            services.map((service: CodeAgentScopedService): string => {
              return service.id;
            }),
          ),
        } as never,
        select: {
          _id: true,
          time: true,
          eventType: true,
          title: true,
          primaryEntityId: true,
          attributes: true,
        } as never,
        sort: { time: SortOrder.Descending } as never,
        limit: MAX_CHANGES_READ,
        skip: 0,
        props: getTelemetryToolContext(scope).props,
      });

      const relevance: ChangeRelevance = {
        serviceIds: new Set<string>(
          services.map((service: CodeAgentScopedService): string => {
            return service.id;
          }),
        ),
        kubernetesClusterIds: new Set<string>(),
        resourceIds: new Set<string>(),
        subjectKind: "incident",
        subjectId: "",
      };

      const recorded: Array<RecordedChange> = events
        .map(toRecordedChange)
        .filter((change: RecordedChange | null): change is RecordedChange => {
          return change !== null;
        });

      // One deploy's events folded into one change, newest first.
      const changes: Array<RecentChange> = groupRecordedChanges(
        recorded,
        relevance,
      )
        .reverse()
        .slice(0, MAX_LISTED_CHANGES);

      for (const change of changes) {
        change.serviceName = serviceNameOf(scope, change.serviceId);
      }

      await RecentChangesContext.checkImpact({
        projectId: scope.projectId,
        changes,
        lookahead: now,
        now,
      });

      const rows: Array<JSONObject> = changes.map(
        (change: RecentChange): JSONObject => {
          const facts: string = describeChangeEventFields(change.fields);

          return {
            at: change.time,
            service: change.serviceName,
            change: change.eventType,
            title: change.titles
              .slice(0, 2)
              .map((title: string): string => {
                return boundedQuotedLine(title, 200);
              })
              .join(" and "),
            facts: facts ? boundedLine(facts, 300) : undefined,
            verdict: change.impact
              ? change.impact.verdict === ChangeImpactVerdict.Suspect
                ? "SUSPECT"
                : change.impact.verdict
              : "not checked",
            impact: RecentChangesContext.describeImpact(change),
            changeId: change.id,
          };
        },
      );

      return serializedOutput({
        serialized: ToolResultSerializer.serializeRows(rows),
        citationLabel: `Changes to ${describeServices(services)}, last ${days} days (${rows.length} listed)`,
        lead:
          rows.length === 0
            ? `No deploy or change of ${describeServices(services)} was recorded in the last ${days} days.`
            : undefined,
      });
    };
  },
};

export default class CodeAgentTelemetryTools {
  private static readonly tools: Array<CodeAgentTelemetryTool> = [
    FindProductionExceptionsTool,
    QueryTracesTool,
    GetTraceTool,
    SearchLogsTool,
    QueryMetricsTool,
    FindProductionIncidentsTool,
    RecentDeploysTool,
  ];

  public static getTools(): Array<CodeAgentTelemetryTool> {
    return this.tools;
  }

  public static getTool(name: string): CodeAgentTelemetryTool | undefined {
    return this.tools.find((tool: CodeAgentTelemetryTool): boolean => {
      return tool.name === name;
    });
  }
}
