import ExceptionInstanceService from "../../../Services/ExceptionInstanceService";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateService from "../../../Services/IncidentStateService";
import TelemetryExceptionService, {
  ExceptionOfGroup,
} from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { CodeAgentScopedService } from "../../AI/CodeFix/CodeAgentTelemetryScope";
import {
  boundedLine,
  containsIdentifier,
  withoutFileLocations,
} from "../../AI/CodeFix/CodeAgentTelemetryTools";
import { getIncidentSelfPrivacyRaw } from "../../Incident/IncidentPrivacyFilter";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  normalizeExceptionText,
  sanitizeStackTrace,
} from "../../Telemetry/ExceptionSanitizer";
import {
  extractCandidatePathsFromStackTrace,
  findPathsWithLineNumber,
} from "../StackTraceRepoResolver";
import {
  ChangedCode,
  ChangedCodeFile,
  ChangedFileMatch,
  getChangedFunctionNames,
  isLineInRanges,
  matchChangedFile,
} from "./ProductionReviewDiff";
import {
  RepositoryProductionProfile,
  ServiceOperation,
  ServiceTraffic,
  SuspectDeploy,
} from "./ProductionReviewRepositoryProfile";
import Incident from "../../../../Models/DatabaseModels/Incident";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import IncludesAnyOfGroups from "../../../../Types/BaseDatabase/IncludesAnyOfGroups";
import { getOccurrenceFingerprintQuery } from "../../../../Types/Telemetry/ExceptionGroupFingerprints";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  PRODUCTION_REVIEW_LIMITS,
  PRODUCTION_REVIEW_WINDOWS,
  ProductionReviewDeployJSON,
  ProductionReviewExceptionJSON,
  ProductionReviewHotFunctionJSON,
  ProductionReviewIncidentJSON,
  ProductionReviewIncidentsJSON,
  ProductionReviewOperationJSON,
  ProductionReviewOperationMatch,
  ProductionReviewSection,
  ProductionReviewServiceJSON,
  ProductionReviewWhere,
} from "../../../../Types/CodeRepository/ProductionReview";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";

/*
 * WHAT PRODUCTION SAYS ABOUT THE CODE A PULL REQUEST CHANGES.
 *
 * The change's files, lines and functions (ProductionReviewDiff) matched
 * against what production reports of the same code:
 *
 *   - EXCEPTIONS whose stack trace runs through a changed file - at a line
 *     the change touches, in a function it changes, or anywhere in the file
 *     - with how often they were thrown in the last week;
 *   - OPERATIONS that run the changed code: their spans name a changed file
 *     or function (code attributes), they serve a route the change edits,
 *     or they are named after a function it changes - with how busy, how
 *     often failing and how slow they are;
 *   - HOT FUNCTIONS: functions of the changed files that take a share of
 *     their service's profile;
 *   - INCIDENTS open on the services the change runs in, or whose root
 *     cause, remediation or postmortem names a changed file or function;
 *   - DEPLOYS of those services OneUptime suspects.
 *
 * Paths are matched from their end, as the repository resolver matches a
 * stack frame (matchChangedFile): production names "/app/src/x.ts", the
 * repository "services/billing/src/x.ts". And production runs the code
 * BEFORE this change, so a stack frame's line is compared with the base
 * lines the change touches.
 *
 * What a report keeps is aggregate and names code: an exception's type, an
 * operation's name (with the ids, addresses and numbers in it masked, as an
 * exception's fingerprint masks them), a function, a path, counts, rates
 * and shares. Never an exception's message, a log line, an attribute's
 * value or an incident's text.
 */

// How far back an exception counts, and incidents and deploys.
const EXCEPTION_GROUPS_PER_FILE: number = 25;
const MAX_FILE_NAMES_SEARCHED: number = 20;
const MAX_INCIDENTS_READ: number = 50;
const MAX_STACK_TRACE_LINES: number = 200;
const MAX_STACK_TRACE_LINE_LENGTH: number = 2000;
// The longest incident text read for what it names.
const MAX_INCIDENT_TEXT_READ: number = 20000;
// A function name shorter than this is too common to match by name alone.
const MIN_MATCHED_NAME_LENGTH: number = 4;
// How long the occurrence counts may take before the totals are shown instead.
const OCCURRENCE_COUNT_TIMEOUT_MS: number = 20 * 1000;

export interface ProductionReviewFindingsInput {
  projectId: ObjectID;
  changed: ChangedCode;
  // Every service the repository serves.
  services: Array<CodeAgentScopedService>;
  // Those the changed files are under (ProductionReviewScope).
  touched: Array<CodeAgentScopedService>;
  profile: RepositoryProductionProfile;
  now: Date;
}

export interface ProductionReviewFindingsResult {
  services: Array<ProductionReviewServiceJSON>;
  exceptions: Array<ProductionReviewExceptionJSON>;
  operations: Array<ProductionReviewOperationJSON>;
  hotFunctions: Array<ProductionReviewHotFunctionJSON>;
  incidents: ProductionReviewIncidentsJSON;
  suspectDeploys: Array<ProductionReviewDeployJSON>;
  unreadSections: Array<ProductionReviewSection>;
}

// Where a stack trace runs through the change, at its closest.
export interface ExceptionFrameMatch {
  file: ChangedCodeFile;
  path: string;
  line?: number | undefined;
  functionName?: string | undefined;
  where: ProductionReviewWhere;
}

const WHERE_RANK: Record<ProductionReviewWhere, number> = {
  [ProductionReviewWhere.ChangedLine]: 0,
  [ProductionReviewWhere.ChangedFunction]: 1,
  [ProductionReviewWhere.ChangedFile]: 2,
};

const MATCH_RANK: Record<ProductionReviewOperationMatch, number> = {
  [ProductionReviewOperationMatch.CodeAttribute]: 0,
  [ProductionReviewOperationMatch.Route]: 1,
  [ProductionReviewOperationMatch.FunctionName]: 2,
};

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

// The digits at `from`, as a number, or undefined.
function readLineNumber(text: string, from: number): number | undefined {
  let end: number = from;

  while (end < text.length && end - from < 9 && isDigit(text[end])) {
    end++;
  }

  if (end === from) {
    return undefined;
  }

  const value: number = Number(text.slice(from, end));

  return value > 0 ? value : undefined;
}

/*
 * The line a frame names for a path in it: "path:42" (V8, Ruby, Go, Java)
 * or Python's `File "path", line 42`.
 */
export function readFrameLine(
  frameLine: string,
  rawPath: string,
): number | undefined {
  const at: number = frameLine.indexOf(rawPath);

  if (at === -1) {
    return undefined;
  }

  const after: number = at + rawPath.length;

  if (frameLine[after] === ":") {
    return readLineNumber(frameLine, after + 1);
  }

  const pythonLine: number = frameLine.indexOf(", line ", after);

  if (pythonLine !== -1 && pythonLine - after <= 2) {
    return readLineNumber(frameLine, pythonLine + ", line ".length);
  }

  return undefined;
}

/*
 * Whether what is left of a frame line once its file is taken out is only
 * the file's line and an offset - ":80 +0x1b", Go's - so the function is on
 * the line before.
 */
export function isFileAndOffsetOnly(frameText: string): boolean {
  let rest: string = frameText.trim();

  if (rest.startsWith(":")) {
    let end: number = 1;

    while (end < rest.length && isDigit(rest[end])) {
      end++;
    }

    rest = rest.slice(end).trim();
  }

  return rest === "" || rest.startsWith("+0x");
}

// The raw paths a frame line names: Python's quoted file, and path:line ones.
function readFramePaths(frameLine: string): Array<string> {
  const paths: Array<string> = [];
  const pythonFile: number = frameLine.indexOf('File "');

  if (pythonFile !== -1) {
    const close: number = frameLine.indexOf('"', pythonFile + 6);

    if (close !== -1) {
      paths.push(frameLine.slice(pythonFile + 6, close));
    }
  }

  for (const path of findPathsWithLineNumber(frameLine)) {
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }

  return paths;
}

/*
 * Where a stack trace runs through the change, at its closest: a frame at a
 * base line the change touches, else one in a function it changes, else one
 * anywhere in a changed file - the topmost of its kind. Null when no frame
 * runs through a changed file. Read line by line, in time in line with the
 * trace (a few hundred lines of it at most).
 */
export function matchExceptionFrames(data: {
  stackTrace: string;
  changed: ChangedCode;
}): ExceptionFrameMatch | null {
  const lines: Array<string> = data.stackTrace
    .split("\n")
    .slice(0, MAX_STACK_TRACE_LINES);
  let best: ExceptionFrameMatch | null = null;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index]!.slice(0, MAX_STACK_TRACE_LINE_LENGTH);

    if (extractCandidatePathsFromStackTrace(line).length === 0) {
      continue;
    }

    for (const rawPath of readFramePaths(line)) {
      const match: ChangedFileMatch | null = matchChangedFile(
        rawPath,
        data.changed.files,
      );

      if (!match) {
        continue;
      }

      const lineNumber: number | undefined = readFrameLine(line, rawPath);

      /*
       * The function a frame runs in is on its own line - or, for Go, whose
       * file line holds nothing but the file and an offset ("+0x1b"), on
       * the line before it.
       */
      const frameText: string = withoutFileLocations(line);
      const isFileOnlyLine: boolean = isFileAndOffsetOnly(frameText);
      const previousText: string =
        isFileOnlyLine && index > 0
          ? withoutFileLocations(
              lines[index - 1]!.slice(0, MAX_STACK_TRACE_LINE_LENGTH),
            )
          : "";

      const functionName: string | undefined = match.file.functionNames.find(
        (name: string): boolean => {
          return (
            containsIdentifier(frameText, name) ||
            (isFileOnlyLine && containsIdentifier(previousText, name))
          );
        },
      );

      const where: ProductionReviewWhere =
        lineNumber !== undefined &&
        isLineInRanges(lineNumber, match.file.baseLines)
          ? ProductionReviewWhere.ChangedLine
          : functionName
            ? ProductionReviewWhere.ChangedFunction
            : ProductionReviewWhere.ChangedFile;

      if (!best || WHERE_RANK[where] < WHERE_RANK[best.where]) {
        best = {
          file: match.file,
          path: match.file.path,
          line: lineNumber,
          functionName,
          where,
        };
      }

      if (best.where === ProductionReviewWhere.ChangedLine) {
        return best;
      }
    }
  }

  return best;
}

/*
 * Whether an operation's name serves the route: the route stands in it as a
 * whole path - after the start or a space, and before the end, a space, a
 * "?" or a "(" - so "/orders" is not "/orders/:id".
 */
export function operationServesRoute(name: string, route: string): boolean {
  let from: number = 0;

  while (from <= name.length - route.length) {
    const at: number = name.indexOf(route, from);

    if (at === -1) {
      return false;
    }

    const before: string | undefined = at > 0 ? name[at - 1] : undefined;
    const after: string | undefined = name[at + route.length];

    if (
      (before === undefined || before === " ") &&
      (after === undefined || after === " " || after === "?" || after === "(")
    ) {
      return true;
    }

    from = at + 1;
  }

  return false;
}

// The last identifier of a qualified name: "Billing.charge" -> "charge".
export function lastNameSegment(name: string): string {
  let end: number = name.length;

  while (end > 0 && name[end - 1] === ")") {
    // "charge()" -> "charge"
    const open: number = name.lastIndexOf("(", end - 1);

    if (open === -1) {
      break;
    }

    end = open;
  }

  const trimmed: string = name.slice(0, end);
  let start: number = trimmed.length;

  while (start > 0) {
    const character: string = trimmed[start - 1]!;

    if (
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      (character >= "0" && character <= "9") ||
      character === "_" ||
      character === "$"
    ) {
      start--;
    } else {
      break;
    }
  }

  return trimmed.slice(start);
}

// A span's name as a report keeps it: ids, addresses and numbers masked.
export function maskOperationName(name: string): string {
  return boundedLine(
    normalizeExceptionText(name.slice(0, 1000)),
    PRODUCTION_REVIEW_LIMITS.maxNameLength,
  );
}

export default class ProductionReviewFindings {
  @CaptureSpan()
  public static async find(
    input: ProductionReviewFindingsInput,
  ): Promise<ProductionReviewFindingsResult> {
    const servicesById: Map<string, CodeAgentScopedService> = new Map<
      string,
      CodeAgentScopedService
    >();

    for (const service of input.services) {
      servicesById.set(service.id.toLowerCase(), service);
    }

    const operations: Array<ProductionReviewOperationJSON> =
      ProductionReviewFindings.matchOperations({
        changed: input.changed,
        profile: input.profile,
        servicesById,
      });

    const hotFunctions: Array<ProductionReviewHotFunctionJSON> =
      ProductionReviewFindings.matchHotFunctions({
        changed: input.changed,
        profile: input.profile,
        servicesById,
      });

    const exceptions: Array<ProductionReviewExceptionJSON> | null =
      input.changed.files.length === 0 || input.services.length === 0
        ? []
        : await ProductionReviewFindings.readExceptions({
            projectId: input.projectId,
            changed: input.changed,
            servicesById,
            now: input.now,
          });

    /*
     * The services the change runs in: those its files are under, and
     * those production found running it.
     */
    const runIn: Array<string> = [];

    const addService: (id: string) => void = (id: string): void => {
      const lower: string = id.toLowerCase();

      if (servicesById.has(lower) && !runIn.includes(lower)) {
        runIn.push(lower);
      }
    };

    for (const service of input.touched) {
      addService(service.id);
    }

    for (const found of [
      ...(exceptions || []),
      ...operations,
      ...hotFunctions,
    ]) {
      addService(found.serviceId);
    }

    const incidents: ProductionReviewIncidentsJSON | null =
      runIn.length === 0
        ? { total: 0, open: 0, items: [] }
        : await ProductionReviewFindings.readIncidents({
            projectId: input.projectId,
            serviceIds: runIn,
            changed: input.changed,
            now: input.now,
          });

    const unreadSections: Array<ProductionReviewSection> = [
      ...input.profile.unread,
    ];

    if (!exceptions) {
      unreadSections.push(ProductionReviewSection.Exceptions);
    }

    if (!incidents) {
      unreadSections.push(ProductionReviewSection.Incidents);
    }

    return {
      services: ProductionReviewFindings.describeServices({
        serviceIds: runIn,
        servicesById,
        traffic: input.profile.traffic,
      }),
      exceptions: exceptions || [],
      operations,
      hotFunctions,
      incidents: incidents || { total: 0, open: 0, items: [] },
      suspectDeploys: ProductionReviewFindings.pickDeploys({
        deploys: input.profile.suspectDeploys,
        serviceIds: runIn,
        servicesById,
      }),
      unreadSections,
    };
  }

  public static describeServices(data: {
    serviceIds: Array<string>;
    servicesById: Map<string, CodeAgentScopedService>;
    traffic: Array<ServiceTraffic>;
  }): Array<ProductionReviewServiceJSON> {
    return data.serviceIds
      .slice(0, PRODUCTION_REVIEW_LIMITS.maxServices)
      .map((id: string): ProductionReviewServiceJSON => {
        const traffic: ServiceTraffic | undefined = data.traffic.find(
          (entry: ServiceTraffic): boolean => {
            return entry.serviceId.toLowerCase() === id;
          },
        );

        const service: ProductionReviewServiceJSON = {
          id,
          name: data.servicesById.get(id)?.name || "",
        };

        if (traffic) {
          service.requestCount = traffic.count;
          service.p99Ms = traffic.p99Ms;
        }

        return service;
      });
  }

  /*
   * The operations that run the changed code, each found once - by its
   * code attributes before a route, before its name - busiest first.
   */
  public static matchOperations(data: {
    changed: ChangedCode;
    profile: RepositoryProductionProfile;
    servicesById: Map<string, CodeAgentScopedService>;
  }): Array<ProductionReviewOperationJSON> {
    const found: Map<string, ProductionReviewOperationJSON> = new Map<
      string,
      ProductionReviewOperationJSON
    >();

    const operationsByKey: Map<string, ServiceOperation> = new Map<
      string,
      ServiceOperation
    >();

    for (const operation of data.profile.operations) {
      operationsByKey.set(
        `${operation.serviceId.toLowerCase()}|${operation.name}`,
        operation,
      );
    }

    const changedFunctions: Array<string> = getChangedFunctionNames(
      data.changed,
    ).filter((name: string): boolean => {
      return name.length >= MIN_MATCHED_NAME_LENGTH;
    });

    const add: (entry: {
      operation: ServiceOperation;
      matchedBy: ProductionReviewOperationMatch;
      path?: string | undefined;
      functionName?: string | undefined;
    }) => void = (entry: {
      operation: ServiceOperation;
      matchedBy: ProductionReviewOperationMatch;
      path?: string | undefined;
      functionName?: string | undefined;
    }): void => {
      const serviceId: string = entry.operation.serviceId.toLowerCase();
      const service: CodeAgentScopedService | undefined =
        data.servicesById.get(serviceId);

      if (!service) {
        return;
      }

      const key: string = `${serviceId}|${entry.operation.name}`;
      const existing: ProductionReviewOperationJSON | undefined =
        found.get(key);

      if (
        existing &&
        MATCH_RANK[existing.matchedBy] <= MATCH_RANK[entry.matchedBy]
      ) {
        return;
      }

      const operation: ProductionReviewOperationJSON = {
        name: maskOperationName(entry.operation.name),
        serviceId,
        serviceName: service.name,
        matchedBy: entry.matchedBy,
        requestCount: entry.operation.count,
        errorCount: entry.operation.errorCount,
        p95Ms: entry.operation.p95Ms,
      };

      if (entry.path) {
        operation.path = entry.path;
      }

      if (entry.functionName) {
        operation.functionName = boundedLine(
          entry.functionName,
          PRODUCTION_REVIEW_LIMITS.maxNameLength,
        );
      }

      found.set(key, operation);
    };

    // Spans that say which file or function they were started in.
    for (const location of data.profile.codeLocations) {
      const operation: ServiceOperation | undefined = operationsByKey.get(
        `${location.serviceId.toLowerCase()}|${location.name}`,
      );

      if (!operation) {
        continue;
      }

      const fileMatch: ChangedFileMatch | null = location.filePath
        ? matchChangedFile(location.filePath, data.changed.files)
        : null;

      const functionName: string = lastNameSegment(location.functionName);

      if (fileMatch) {
        add({
          operation,
          matchedBy: ProductionReviewOperationMatch.CodeAttribute,
          path: fileMatch.file.path,
          functionName: fileMatch.file.functionNames.includes(functionName)
            ? functionName
            : undefined,
        });
      } else if (
        !location.filePath &&
        functionName &&
        changedFunctions.includes(functionName)
      ) {
        add({
          operation,
          matchedBy: ProductionReviewOperationMatch.CodeAttribute,
          functionName,
        });
      }
    }

    // Operations that serve a route the change edits.
    for (const file of data.changed.files) {
      for (const route of file.routes) {
        for (const operation of data.profile.operations) {
          if (operationServesRoute(operation.name, route)) {
            add({
              operation,
              matchedBy: ProductionReviewOperationMatch.Route,
              path: file.path,
            });
          }
        }
      }
    }

    // Operations named after a function the change edits.
    if (changedFunctions.length > 0) {
      for (const operation of data.profile.operations) {
        const name: string = lastNameSegment(operation.name.trim());

        if (
          name.length >= MIN_MATCHED_NAME_LENGTH &&
          changedFunctions.includes(name) &&
          (operation.name.trim() === name ||
            operation.name.trim().endsWith(`.${name}`) ||
            operation.name.trim().endsWith(`::${name}`))
        ) {
          add({
            operation,
            matchedBy: ProductionReviewOperationMatch.FunctionName,
            functionName: name,
          });
        }
      }
    }

    return Array.from(found.values())
      .sort(
        (
          a: ProductionReviewOperationJSON,
          b: ProductionReviewOperationJSON,
        ): number => {
          return b.requestCount - a.requestCount;
        },
      )
      .slice(0, PRODUCTION_REVIEW_LIMITS.maxOperations);
  }

  /*
   * The functions of the changed files that take a share of their
   * service's profile worth a reviewer's attention, the largest first.
   */
  public static matchHotFunctions(data: {
    changed: ChangedCode;
    profile: RepositoryProductionProfile;
    servicesById: Map<string, CodeAgentScopedService>;
  }): Array<ProductionReviewHotFunctionJSON> {
    const found: Map<string, ProductionReviewHotFunctionJSON> = new Map<
      string,
      ProductionReviewHotFunctionJSON
    >();

    for (const profiled of data.profile.functions) {
      if (
        profiled.totalPercent < PRODUCTION_REVIEW_LIMITS.minHotFunctionPercent
      ) {
        continue;
      }

      const service: CodeAgentScopedService | undefined = data.servicesById.get(
        profiled.serviceId.toLowerCase(),
      );
      const match: ChangedFileMatch | null = service
        ? matchChangedFile(profiled.fileName, data.changed.files)
        : null;

      if (!service || !match) {
        continue;
      }

      const name: string = lastNameSegment(profiled.functionName);
      const functionName: string = boundedLine(
        profiled.functionName,
        PRODUCTION_REVIEW_LIMITS.maxNameLength,
      );
      const key: string = `${service.id}|${match.file.path}|${functionName}`;

      if (found.has(key)) {
        continue;
      }

      found.set(key, {
        functionName,
        path: match.file.path,
        serviceId: service.id,
        serviceName: service.name,
        totalPercent: Math.round(profiled.totalPercent * 10) / 10,
        selfPercent: Math.round(profiled.selfPercent * 10) / 10,
        isChangedFunction:
          Boolean(name) && match.file.functionNames.includes(name),
        profileKind: boundedLine(profiled.kind, 40),
      });
    }

    return Array.from(found.values())
      .sort(
        (
          a: ProductionReviewHotFunctionJSON,
          b: ProductionReviewHotFunctionJSON,
        ): number => {
          if (a.isChangedFunction !== b.isChangedFunction) {
            return a.isChangedFunction ? -1 : 1;
          }

          return b.totalPercent - a.totalPercent;
        },
      )
      .slice(0, PRODUCTION_REVIEW_LIMITS.maxHotFunctions);
  }

  // The deploys OneUptime suspects, of the services the change runs in.
  public static pickDeploys(data: {
    deploys: Array<SuspectDeploy>;
    serviceIds: Array<string>;
    servicesById: Map<string, CodeAgentScopedService>;
  }): Array<ProductionReviewDeployJSON> {
    return data.deploys
      .filter((deploy: SuspectDeploy): boolean => {
        return data.serviceIds.includes(deploy.serviceId.toLowerCase());
      })
      .slice(0, PRODUCTION_REVIEW_LIMITS.maxSuspectDeploys)
      .map((deploy: SuspectDeploy): ProductionReviewDeployJSON => {
        const json: ProductionReviewDeployJSON = {
          serviceId: deploy.serviceId.toLowerCase(),
          serviceName:
            data.servicesById.get(deploy.serviceId.toLowerCase())?.name || "",
          at: deploy.at,
          impact: boundedLine(deploy.impact, 300),
        };

        if (deploy.version) {
          json.version = boundedLine(deploy.version, 60);
        }

        return json;
      });
  }

  /*
   * The exception groups of the repository's services thrown in the last
   * week whose stack traces run through a changed file - narrowed in the
   * database to traces that name one of the files, then read frame by frame
   * - closest to the change first, then most frequent. Null when they
   * could not be read.
   */
  public static async readExceptions(data: {
    projectId: ObjectID;
    changed: ChangedCode;
    servicesById: Map<string, CodeAgentScopedService>;
    now: Date;
  }): Promise<Array<ProductionReviewExceptionJSON> | null> {
    const since: Date = OneUptimeDate.addRemoveDays(
      data.now,
      -PRODUCTION_REVIEW_WINDOWS.exceptionsDays,
    );

    const fileNames: Array<string> = [];

    for (const file of data.changed.files) {
      for (const path of file.previousPath
        ? [file.path, file.previousPath]
        : [file.path]) {
        const name: string = path.slice(path.lastIndexOf("/") + 1);

        if (name && !fileNames.includes(name)) {
          fileNames.push(name);
        }
      }
    }

    const serviceIds: Array<ObjectID> = Array.from(
      data.servicesById.keys(),
    ).map((id: string): ObjectID => {
      return new ObjectID(id);
    });

    let groups: Array<TelemetryException>;

    try {
      const reads: Array<Array<TelemetryException>> = await Promise.all(
        fileNames
          .slice(0, MAX_FILE_NAMES_SEARCHED)
          .map((fileName: string): Promise<Array<TelemetryException>> => {
            return TelemetryExceptionService.findBy({
              query: {
                projectId: data.projectId,
                primaryEntityId: QueryHelper.any(serviceIds),
                lastSeenAt: QueryHelper.greaterThanEqualTo(since),
                stackTrace: QueryHelper.search(fileName),
              } as never,
              select: {
                _id: true,
                primaryEntityId: true,
                exceptionType: true,
                stackTrace: true,
                fingerprint: true,
                occuranceCount: true,
                firstSeenAt: true,
                lastSeenAt: true,
                unhandled: true,
                isArchived: true,
              },
              sort: { occuranceCount: SortOrder.Descending },
              limit: EXCEPTION_GROUPS_PER_FILE,
              skip: 0,
              props: { isRoot: true, tenantId: data.projectId },
            });
          }),
      );

      const byId: Map<string, TelemetryException> = new Map<
        string,
        TelemetryException
      >();

      for (const read of reads) {
        for (const group of read) {
          // An archived group is one the team chose to stop hearing about.
          if (group._id && group.isArchived !== true) {
            byId.set(group._id.toString(), group);
          }
        }
      }

      groups = Array.from(byId.values());
    } catch (error) {
      logger.warn(`Production review: could not read exceptions: ${error}`);
      return null;
    }

    const matched: Array<{
      group: TelemetryException;
      match: ExceptionFrameMatch;
    }> = [];

    for (const group of groups) {
      const match: ExceptionFrameMatch | null = matchExceptionFrames({
        stackTrace: sanitizeStackTrace(group.stackTrace || ""),
        changed: data.changed,
      });

      if (
        match &&
        group.primaryEntityId &&
        data.servicesById.has(group.primaryEntityId.toString().toLowerCase())
      ) {
        matched.push({ group, match });
      }
    }

    matched.sort(
      (
        a: { group: TelemetryException; match: ExceptionFrameMatch },
        b: { group: TelemetryException; match: ExceptionFrameMatch },
      ): number => {
        if (a.match.where !== b.match.where) {
          return WHERE_RANK[a.match.where] - WHERE_RANK[b.match.where];
        }

        return (
          Number(b.group.occuranceCount || 0) -
          Number(a.group.occuranceCount || 0)
        );
      },
    );

    const listed: Array<{
      group: TelemetryException;
      match: ExceptionFrameMatch;
    }> = matched.slice(0, PRODUCTION_REVIEW_LIMITS.maxExceptions);

    const counts: Map<string, number> =
      await ProductionReviewFindings.countOccurrences({
        projectId: data.projectId,
        groups: listed.map(
          (entry: { group: TelemetryException }): TelemetryException => {
            return entry.group;
          },
        ),
        since,
        now: data.now,
      });

    return listed.map(
      (entry: {
        group: TelemetryException;
        match: ExceptionFrameMatch;
      }): ProductionReviewExceptionJSON => {
        const group: TelemetryException = entry.group;
        const serviceId: string = group
          .primaryEntityId!.toString()
          .toLowerCase();
        const windowCount: number | undefined = counts.get(
          group._id!.toString(),
        );

        const json: ProductionReviewExceptionJSON = {
          exceptionId: group._id!.toString(),
          type: boundedLine(
            group.exceptionType || "Exception",
            PRODUCTION_REVIEW_LIMITS.maxNameLength,
          ),
          serviceId,
          serviceName: data.servicesById.get(serviceId)?.name || "",
          path: entry.match.path,
          where: entry.match.where,
          occurrences:
            windowCount !== undefined
              ? windowCount
              : Number(group.occuranceCount || 0),
          isWindowCount: windowCount !== undefined,
          isUnhandled: Boolean(group.unhandled),
          isNew: Boolean(
            group.firstSeenAt && new Date(group.firstSeenAt) >= since,
          ),
        };

        if (entry.match.line !== undefined) {
          json.line = entry.match.line;
        }

        if (entry.match.functionName) {
          json.functionName = entry.match.functionName;
        }

        if (group.firstSeenAt) {
          json.firstSeenAt = new Date(group.firstSeenAt).toISOString();
        }

        if (group.lastSeenAt) {
          json.lastSeenAt = new Date(group.lastSeenAt).toISOString();
        }

        return json;
      },
    );
  }

  /*
   * How often each group was thrown in the window, counted from its
   * occurrences by fingerprint - its own, and those of the exceptions
   * merged into it, which count on it (TelemetryExceptionService
   * .getGroupFingerprints) - as the fix verifier counts them. A count that
   * cannot be read, or is not read in time, is left out: the group's total
   * is shown instead, and says so.
   */
  private static async countOccurrences(data: {
    projectId: ObjectID;
    groups: Array<TelemetryException>;
    since: Date;
    now: Date;
  }): Promise<Map<string, number>> {
    const counts: Map<string, number> = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const groups: Array<TelemetryException> = data.groups.filter(
      (group: TelemetryException): boolean => {
        return Boolean(group._id && group.fingerprint && group.primaryEntityId);
      },
    );

    // Never rejects: it may still be under way once the time is up.
    const reads: Promise<void> = (async (): Promise<void> => {
      try {
        // One read of what was merged into them all, within the time allowed.
        const groupFingerprints: Map<
          string,
          Array<string>
        > = await TelemetryExceptionService.getGroupFingerprints({
          projectId: data.projectId,
          exceptions: groups.map(
            (group: TelemetryException): ExceptionOfGroup => {
              return {
                id: group._id!.toString(),
                fingerprint: group.fingerprint!,
              };
            },
          ),
        });

        await ProductionReviewFindings.countEach({
          projectId: data.projectId,
          groups,
          groupFingerprints,
          since: data.since,
          now: data.now,
          counts,
        });
      } catch (error) {
        logger.debug(
          `Production review: could not count the exceptions' occurrences: ${error}`,
        );
      }
    })();

    try {
      await Promise.race([
        reads,
        new Promise<void>((resolve: () => void): void => {
          timer = setTimeout(resolve, OCCURRENCE_COUNT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    return new Map<string, number>(counts);
  }

  // Each group's count in the window, into `counts` as it is read.
  private static async countEach(data: {
    projectId: ObjectID;
    groups: Array<TelemetryException>;
    groupFingerprints: Map<string, Array<string>>;
    since: Date;
    now: Date;
    counts: Map<string, number>;
  }): Promise<void> {
    const counts: Map<string, number> = data.counts;

    await Promise.all(
      data.groups.map(async (group: TelemetryException): Promise<void> => {
        try {
          const count: PositiveNumber = await ExceptionInstanceService.countBy({
            query: {
              projectId: data.projectId,
              primaryEntityId: group.primaryEntityId,
              fingerprint: getOccurrenceFingerprintQuery(
                data.groupFingerprints.get(
                  group._id!.toString().toLowerCase(),
                ) || [group.fingerprint!],
              ),
              time: new InBetween(data.since, data.now),
            } as never,
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true, tenantId: data.projectId },
          });

          counts.set(group._id!.toString(), count.toNumber());
        } catch (error) {
          logger.debug(
            `Production review: could not count an exception's occurrences: ${error}`,
          );
        }
      }),
    );
  }

  /*
   * The incidents declared in the window on the services the change runs
   * in - never a private one - with which are open and which name the
   * change in their root cause, remediation or postmortem. Their text is
   * read for that and kept nowhere. Null when they could not be read.
   */
  public static async readIncidents(data: {
    projectId: ObjectID;
    serviceIds: Array<string>;
    changed: ChangedCode;
    now: Date;
  }): Promise<ProductionReviewIncidentsJSON | null> {
    let incidents: Array<Incident>;
    /*
     * The project's states that count as resolved (Common/Utils/
     * ResolvedState): one rule for whether an incident is open, a state
     * placed after Resolved included.
     */
    let resolvedStateIds: Array<string>;

    try {
      resolvedStateIds = (
        await IncidentStateService.getResolvedIncidentStateIds(data.projectId)
      ).map((id: ObjectID): string => {
        return id.toString();
      });

      incidents = await IncidentService.findBy({
        query: {
          projectId: data.projectId,
          createdAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveDays(
              data.now,
              -PRODUCTION_REVIEW_WINDOWS.incidentsDays,
            ),
          ),
          isPrivate: getIncidentSelfPrivacyRaw({}),
          services: new IncludesAnyOfGroups([data.serviceIds]),
        } as never,
        select: {
          _id: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          createdAt: true,
          rootCause: true,
          remediationNotes: true,
          postmortemNote: true,
          currentIncidentStateId: true,
          currentIncidentState: { name: true },
          incidentSeverity: { name: true },
        } as never,
        sort: { createdAt: SortOrder.Descending },
        limit: MAX_INCIDENTS_READ,
        skip: 0,
        props: { isRoot: true, tenantId: data.projectId },
      });
    } catch (error) {
      logger.warn(`Production review: could not read incidents: ${error}`);
      return null;
    }

    const items: Array<ProductionReviewIncidentJSON> = incidents
      .filter((incident: Incident): boolean => {
        return Boolean(incident._id);
      })
      .map((incident: Incident): ProductionReviewIncidentJSON => {
        const isOpen: boolean = !resolvedStateIds.includes(
          incident.currentIncidentStateId?.toString() || "",
        );

        const item: ProductionReviewIncidentJSON = {
          incidentId: incident._id!.toString(),
          label: boundedLine(
            incident.incidentNumberWithPrefix ||
              (incident.incidentNumber !== undefined &&
              incident.incidentNumber !== null
                ? `#${incident.incidentNumber}`
                : "Incident"),
            40,
          ),
          isOpen,
          declaredAt: new Date(incident.createdAt || data.now).toISOString(),
        };

        if (incident.incidentSeverity?.name) {
          item.severity = boundedLine(incident.incidentSeverity.name, 40);
        }

        if (incident.currentIncidentState?.name) {
          item.state = boundedLine(incident.currentIncidentState.name, 40);
        }

        const mentions: string | null = ProductionReviewFindings.findMention({
          texts: [
            incident.rootCause,
            incident.remediationNotes,
            incident.postmortemNote,
          ],
          changed: data.changed,
        });

        if (mentions) {
          item.mentions = mentions;
        }

        return item;
      });

    const notable: Array<ProductionReviewIncidentJSON> = items
      .filter((item: ProductionReviewIncidentJSON): boolean => {
        return item.isOpen || Boolean(item.mentions);
      })
      .sort(
        (
          a: ProductionReviewIncidentJSON,
          b: ProductionReviewIncidentJSON,
        ): number => {
          if (a.isOpen !== b.isOpen) {
            return a.isOpen ? -1 : 1;
          }

          return b.declaredAt.localeCompare(a.declaredAt);
        },
      );

    return {
      total: items.length,
      open: items.filter((item: ProductionReviewIncidentJSON): boolean => {
        return item.isOpen;
      }).length,
      items: notable.slice(0, PRODUCTION_REVIEW_LIMITS.maxIncidents),
    };
  }

  /*
   * The changed file or function an incident's text names, or null: a
   * file by its path, or by its name when that name is long enough to mean
   * one file ("charge.ts", not "a.go"); a function by its name, as a whole
   * word. Read with indexOf, the text held to a length.
   */
  public static findMention(data: {
    texts: Array<string | null | undefined>;
    changed: ChangedCode;
  }): string | null {
    const texts: Array<string> = data.texts
      .filter((text: string | null | undefined): text is string => {
        return typeof text === "string" && text.length > 0;
      })
      .map((text: string): string => {
        return text.slice(0, MAX_INCIDENT_TEXT_READ);
      });

    if (texts.length === 0) {
      return null;
    }

    const lowered: Array<string> = texts.map((text: string): string => {
      return text.toLowerCase();
    });

    for (const file of data.changed.files) {
      const name: string = file.path.slice(file.path.lastIndexOf("/") + 1);

      for (const text of lowered) {
        if (
          text.includes(file.path.toLowerCase()) ||
          (name.length >= 8 && text.includes(name.toLowerCase()))
        ) {
          return file.path;
        }
      }
    }

    for (const name of getChangedFunctionNames(data.changed)) {
      if (name.length < 6) {
        continue;
      }

      for (const text of texts) {
        if (containsIdentifier(text, name)) {
          return `${name}()`;
        }
      }
    }

    return null;
  }
}
