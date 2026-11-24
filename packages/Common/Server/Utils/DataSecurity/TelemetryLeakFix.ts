import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetrySourceMap from "../../../Models/DatabaseModels/TelemetrySourceMap";
import {
  TelemetryLeakFixTaskContext,
  getTelemetryLeakFixIssueIds,
  getTelemetryLeakFixTaskContext,
} from "../../../Types/AI/CodeFixTaskContext";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Purple500 } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import {
  DataSecurityFixRepository,
  DataSecurityFixResult,
  DataSecurityTelemetryFixPlanJSON,
  DataSecurityTelemetryFixPlanResult,
  DataSecurityTelemetryFixRepository,
  DataSecurityTelemetryFixRepositoryChoice,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  FINDING_FRESHNESS_IN_DAYS,
  SECRETS_IN_TELEMETRY_CHECK_ID,
  TELEMETRY_FINDING_CHECK_IDS,
  getTelemetryCheckIdOfDataType,
  isFindingCounted,
  isTelemetryFindingCheck,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import DataSecurityIssueResolution from "../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataTypeNamer from "../../../Types/DataSecurity/DataTypeNamer";
import { telemetryDataStoreKey } from "../../../Types/DataSecurity/DataStoreKey";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { readFindingSampleRecords } from "../../../Types/DataSecurity/FindingSampleRecord";
import {
  MAX_TELEMETRY_LEAK_ISSUES,
  MAX_TELEMETRY_LEAK_PATH_LENGTH,
  MAX_TELEMETRY_LEAKS_PER_FIX,
  RUM_TELEMETRY_STORE_KINDS,
  SERVICE_TELEMETRY_STORE_KINDS,
  TelemetryLeakFixDecision,
  TelemetryLeakFixIssue,
  TelemetryLeakFixLeak,
  TelemetryLeakFixOwnerKind,
  TelemetryLeakSignal,
  decideTelemetryLeakFix,
  getTelemetryLeakFixFingerprint,
  getTelemetryLeakFixLane,
  getRumSessionKey,
  getTelemetryLeakFixPlanKey,
  getTelemetryLeakSignal,
  getTelemetryLeakSignalOf,
  getTelemetryLeakStartFiles,
} from "../../../Types/DataSecurity/TelemetryLeakFix";
import { getScrubTarget } from "../../../Types/DataSecurity/TelemetryScrubTarget";
import { DataSecurityAiProposalKind } from "../../../Types/DataSecurity/DataSecurityAi";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import AIRunService from "../../Services/AIRunService";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../Services/CodeRepositoryService";
import DataSecurityAiProposalService from "../../Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import DataStoreService from "../../Services/DataStoreService";
import RumApplicationService from "../../Services/RumApplicationService";
import ServiceService from "../../Services/ServiceService";
import TelemetrySourceMapService from "../../Services/TelemetrySourceMapService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CodeFixOnItsWay from "../AI/CodeFix/CodeFixOnItsWay";
import CodeTaskAccess from "../AI/CodeTask/CodeTaskAccess";
import { DataSecurityAiCodeRequest } from "../AI/DataSecurity/DataSecurityAiInput";
import DataSecurityCodeTask from "../AI/DataSecurity/DataSecurityCodeTask";
import { buildTelemetryLeakFixRequest } from "../AI/DataSecurity/DataSecurityTelemetryFixPrompt";
import ProductionReviewScope, {
  ProductionReviewScopeResult,
} from "../CodeRepository/ProductionReview/ProductionReviewScope";
import { ResolvableRepository } from "../CodeRepository/StackTraceRepoResolver";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SourceMapResolver from "../Telemetry/SourceMapResolver";
import DataSecurityIssueCodeFix from "./DataSecurityIssueCodeFix";
import { getIssuePageUrl, getIssuesPageUrl } from "./DataSecurityIssueGroupFix";
import DataSecurityRunner from "./DataSecurityRunner";
import ProjectDataTypeNames from "./ProjectDataTypeNames";
import {
  ScrubCoverage,
  findCoveringScrubRule,
  getScrubCoverage,
} from "./Telemetry/TelemetryScrubCoverage";
import { getTelemetryStoreOwnerId } from "./Telemetry/TelemetryFindingOccurrences";
import TelemetryLeakLocator, {
  TelemetryLeakFindingToLocate,
  TelemetryLeakLocation,
} from "./Telemetry/TelemetryLeakLocator";
import {
  TelemetryLeakRepositoryGroup,
  TelemetryLeakToPlace,
  chooseTelemetryLeakRepositories,
} from "./Telemetry/TelemetryLeakRepositories";

/*
 * A SERVICE'S TELEMETRY LEAKS, FIXED IN ITS CODE: ONE PULL REQUEST PER
 * SERVICE AND REPOSITORY (#10367).
 *
 * A scrub rule (#10366) hides a leak in OneUptime; the code still writes it
 * to stdout, to a log shipper, to every other vendor the service sends its
 * telemetry to. So the fix is in the code, and Data Security works out
 * where before OneUptime AI's code agent starts:
 *
 *   1. The service's leaks: each finding of its telemetry stores - logs,
 *      spans, exceptions, AI calls, metrics - that its open telemetry issue
 *      counts, and each one a scrub rule of the project masks at ingest
 *      already (the code should do what ingest does), with the issue it is
 *      for. A finding a verified fix already stopped (fixedAt), or one a
 *      person set aside, is not one.
 *   2. Where each is written (TelemetryLeakLocator): the places the records
 *      it was seen in name - never a value, a record or an excerpt.
 *   3. The repository and folder (TelemetryLeakRepositories): from the
 *      files those places name, then the service's other leaks, its name,
 *      the only repository; the folder the files share, else Production
 *      Review's service folder. Leaks in two repositories are two fixes.
 *   4. How (decideTelemetryLeakFix): at each call site where they are
 *      written in at most three places, else one redaction step - always
 *      for the keys the scrub rules mask.
 *
 * A plan is then asked for as a Code task of its own recipe
 * (DataSecurityCodeTask.requestTelemetryLeakFix): by a person, with Fix with
 * AI on any of the service's telemetry issues - after it was shown to them,
 * and refused when it changed since - or by approving OneUptime AI's
 * proposal; or by OneUptime on its own, as the project's AI rules allow
 * (TelemetryLeakFixProposals). Every issue it fixes keeps the task
 * (DataSecurityIssue.codeFixTaskId) and gets its pull request on its
 * timeline; #10368 follows it to production.
 *
 * A RUM application's leaks are fixed the same way, in its front-end code
 * (#10933): its session replay store's findings - its browser logs' and
 * spans' attributes, its sessions' details - located where its
 * records say they were written (a JavaScript stack resolved through the
 * application's source maps, a code location, the page, the session
 * recorder call), in the repository its records' files are in, else where
 * the files its newest release's source maps name are, else the one named
 * like it; one pull request per application and repository, through the
 * same plan, the same lanes and the same cap.
 */

const ROOT: { isRoot: true } = { isRoot: true };

// The most of an application's source maps whose files are read, and how much of them.
export const MAX_SOURCE_MAPS_READ: number = 3;
export const MAX_SOURCE_MAP_BYTES_READ: number = 16 * 1024 * 1024;
// The most of an application's own files its source maps name that are matched against trees.
export const MAX_SOURCE_MAP_FILES: number = 200;

// The most of a service's findings looked through, and of its issues.
const MAX_FINDINGS_READ: number = 200;
const MAX_ISSUES_READ: number = 50;
// The most telemetry stores of one service: one of each kind, with room.
const MAX_STORES_READ: number = 20;

export const TELEMETRY_FIX_NOTHING_TO_FIX_MESSAGE: string =
  "This service writes no sensitive data to its telemetry that OneUptime still sees, so there is nothing to fix in its code.";

export const TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE: string =
  "This issue is not in a service's telemetry, so there is no service code to fix.";

export const TELEMETRY_FIX_NOTHING_TO_FIX_IN_APPLICATION_MESSAGE: string =
  "This application sends no sensitive data from the browser that OneUptime still sees, so there is nothing to fix in its code.";

export const TELEMETRY_FIX_CHANGED_MESSAGE: string =
  "What this fix would change has changed since it was shown to you, so nothing was started. Look at it again before you ask.";

export const TELEMETRY_FIX_ON_ITS_WAY_MESSAGE: string =
  "OneUptime AI is already writing this fix. Follow it in Code.";

// A finding of one of the service's telemetry stores, as a leak is made of it.
export interface ServiceLeakFinding {
  finding: DataStoreFinding;
  store: DataStore;
  issue: DataSecurityIssue;
  signal: TelemetryLeakSignal;
  isMaskedByScrubRule: boolean;
}

export interface ServiceLeaks {
  service: Service;
  stores: Array<DataStore>;
  issues: Array<DataSecurityIssue>;
  findings: Array<ServiceLeakFinding>;
}

/*
 * Whose code a fix changes: a service, or a RUM application's front end
 * (#10933) - its id and name, and for an application, the service its
 * builds' source maps were uploaded under and the service.name it sends.
 */
export interface TelemetryLeakFixOwner {
  kind: TelemetryLeakFixOwnerKind;
  id: string;
  name: string;
  // An application's: what its browser SDK names it (service.name), which a repository may be named like.
  codeName?: string | undefined;
  // An application's: the service its builds' source maps were uploaded under.
  sourceMapServiceId?: string | undefined;
}

// A RUM application's leaks: its session replay store's findings (#10933).
export interface RumApplicationLeaks {
  owner: TelemetryLeakFixOwner;
  stores: Array<DataStore>;
  issues: Array<DataSecurityIssue>;
  findings: Array<ServiceLeakFinding>;
}

// A plan of one fix: a service's leaks in one repository, decided.
export interface TelemetryLeakFixPlan {
  // A service's, unless it is a RUM application's front end (#10933).
  ownerKind: TelemetryLeakFixOwnerKind;
  serviceId: string;
  serviceName: string;
  repository: ResolvableRepository | null;
  choice: DataSecurityTelemetryFixRepositoryChoice | null;
  folder: string | null;
  decision: TelemetryLeakFixDecision;
  startFiles: Array<string>;
  issues: Array<TelemetryLeakFixIssue>;
  hasSecrets: boolean;
  // The riskiest issue it fixes: what the proposals and the cap order by.
  riskScore: number;
  riskiestIssueId: string;
  planKey: string;
  fingerprint: string;
}

function idOf(record: { id?: ObjectID | null; _id?: unknown }): string {
  return (record.id?.toString() || String(record._id || "")).toLowerCase();
}

// The issue a finding is for: the open issue of its store and check, else the newest resolved one.
function issueOfFinding(data: {
  issues: ReadonlyArray<DataSecurityIssue>;
  dataStoreId: string;
  checkId: string;
  isMaskedByScrubRule: boolean;
}): DataSecurityIssue | null {
  const ofStore: Array<DataSecurityIssue> = data.issues.filter(
    (issue: DataSecurityIssue): boolean => {
      return (
        idOf({ id: issue.dataStoreId || null }) === data.dataStoreId &&
        issue.checkId === data.checkId
      );
    },
  );
  const open: DataSecurityIssue | undefined = ofStore.find(
    (issue: DataSecurityIssue): boolean => {
      return issue.status === DataSecurityIssueStatus.Open;
    },
  );

  if (open) {
    return open;
  }

  /*
   * Masked at ingest, its issue may have resolved as contained - not
   * fixed: the code still writes it, and its fix is this pull request
   * (#10368).
   */
  return data.isMaskedByScrubRule
    ? ofStore.find((issue: DataSecurityIssue): boolean => {
        return (
          issue.status === DataSecurityIssueStatus.Resolved &&
          issue.resolution === DataSecurityIssueResolution.ContainedAtIngest
        );
      }) || null
    : null;
}

/*
 * The application's own files a source map names (#10933): its "sources",
 * cleaned of a bundler's prefix (webpack://app/./src/a.ts is src/a.ts),
 * a dependency's and a bundler's own left out. Never its sourcesContent.
 */
export function readSourceMapSources(content: string): Array<string> {
  let sources: unknown;

  try {
    sources = (JSON.parse(content) as { sources?: unknown }).sources;
  } catch {
    return [];
  }

  const files: Array<string> = [];

  for (const source of Array.isArray(sources) ? sources : []) {
    if (typeof source !== "string") {
      continue;
    }

    const file: string = SourceMapResolver.cleanSourcePath(source).trim();

    if (
      !file ||
      file.includes("node_modules/") ||
      file.startsWith("webpack/") ||
      file.includes("(webpack)") ||
      file.length > MAX_TELEMETRY_LEAK_PATH_LENGTH ||
      files.includes(file)
    ) {
      continue;
    }

    files.push(file);
  }

  return files;
}

export default class TelemetryLeakFix {
  /*
   * The service's leaks: its telemetry stores, their telemetry issues, and
   * each finding that is a leak (see the module comment). Null for a
   * service that is not the project's.
   */
  @CaptureSpan()
  public static async readServiceLeaks(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    now?: Date | undefined;
  }): Promise<ServiceLeaks | null> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const service: Service | null = await ServiceService.findOneBy({
      query: { _id: data.serviceId, projectId: data.projectId },
      select: { _id: true, name: true },
      props: ROOT,
    });

    if (!service?.id) {
      return null;
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        serviceId: data.serviceId,
        kind: QueryHelper.any([...SERVICE_TELEMETRY_STORE_KINDS]),
        isArchived: false,
      },
      select: { _id: true, name: true, kind: true, serviceId: true },
      skip: 0,
      limit: MAX_STORES_READ,
      props: ROOT,
    });

    if (stores.length === 0) {
      return { service, stores: [], issues: [], findings: [] };
    }

    return {
      service,
      stores,
      ...(await TelemetryLeakFix.readLeaksOfStores({
        projectId: data.projectId,
        stores,
        now,
      })),
    };
  }

  /*
   * A RUM application's leaks (#10933): its session replay store's
   * telemetry issues and each finding that is a leak - in its browser
   * logs, its browser spans and its sessions' details. Null for an
   * application that is not the project's.
   */
  @CaptureSpan()
  public static async readRumApplicationLeaks(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    now?: Date | undefined;
  }): Promise<RumApplicationLeaks | null> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const application: RumApplication | null =
      await RumApplicationService.findOneBy({
        query: { _id: data.rumApplicationId, projectId: data.projectId },
        select: { _id: true, name: true, appIdentifier: true },
        props: ROOT,
      });

    if (!application?.id) {
      return null;
    }

    const applicationId: string = idOf(application);
    const codeName: string = application.appIdentifier || "";
    // The service its builds' source maps were uploaded under: named as it names itself.
    const sourceMapService: Service | null = codeName
      ? await ServiceService.findOneBy({
          query: { projectId: data.projectId, name: codeName },
          select: { _id: true },
          props: ROOT,
        })
      : null;
    const owner: TelemetryLeakFixOwner = {
      kind: TelemetryLeakFixOwnerKind.RumApplication,
      id: applicationId,
      name: application.name || codeName,
      ...(codeName ? { codeName } : {}),
      ...(sourceMapService
        ? { sourceMapServiceId: idOf(sourceMapService) }
        : {}),
    };
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        kind: QueryHelper.any([...RUM_TELEMETRY_STORE_KINDS]),
        storeKey: QueryHelper.any(
          RUM_TELEMETRY_STORE_KINDS.map((kind: DataStoreKind): string => {
            return telemetryDataStoreKey({ serviceId: applicationId, kind });
          }),
        ),
        isArchived: false,
      },
      select: {
        _id: true,
        name: true,
        kind: true,
        serviceId: true,
        storeKey: true,
      },
      skip: 0,
      limit: MAX_STORES_READ,
      props: ROOT,
    });

    if (stores.length === 0) {
      return { owner, stores: [], issues: [], findings: [] };
    }

    return {
      owner,
      stores,
      ...(await TelemetryLeakFix.readLeaksOfStores({
        projectId: data.projectId,
        stores,
        now,
      })),
    };
  }

  /*
   * The telemetry issues of an owner's stores, and each finding that is a
   * leak (see the module comment): a service's, or a RUM application's.
   */
  public static async readLeaksOfStores(data: {
    projectId: ObjectID;
    stores: ReadonlyArray<DataStore>;
    now: Date;
  }): Promise<{
    issues: Array<DataSecurityIssue>;
    findings: Array<ServiceLeakFinding>;
  }> {
    const now: Date = data.now;
    const stores: ReadonlyArray<DataStore> = data.stores;
    const storeIds: Array<string> = stores.map((store: DataStore): string => {
      return idOf(store);
    });
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          dataStoreId: QueryHelper.any(storeIds),
          checkId: QueryHelper.any([...TELEMETRY_FINDING_CHECK_IDS]),
          status: QueryHelper.any([
            DataSecurityIssueStatus.Open,
            DataSecurityIssueStatus.Resolved,
          ]),
        },
        select: {
          _id: true,
          title: true,
          checkId: true,
          severity: true,
          riskScore: true,
          status: true,
          resolution: true,
          dataStoreId: true,
          resolvedAt: true,
        },
        sort: { riskScore: SortOrder.Descending },
        skip: 0,
        limit: MAX_ISSUES_READ,
        props: ROOT,
      });

    if (issues.length === 0) {
      return { issues: [], findings: [] };
    }

    const found: Array<DataStoreFinding> = await DataStoreFindingService.findBy(
      {
        query: {
          projectId: data.projectId,
          dataStoreId: QueryHelper.any(storeIds),
          isSuppressed: false,
          fixedAt: QueryHelper.isNull(),
          lastSeenAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveDurationInDays(
              now,
              -FINDING_FRESHNESS_IN_DAYS,
            ),
          ),
        },
        select: {
          _id: true,
          dataStoreId: true,
          dataTypeId: true,
          dataTypeName: true,
          location: true,
          locationKind: true,
          confidence: true,
          matchCount: true,
          isConfirmed: true,
          isAiSuggested: true,
          isSuppressed: true,
          isScrubbed: true,
          lastSeenAt: true,
          sampleRecords: true,
        },
        sort: { matchCount: SortOrder.Descending },
        skip: 0,
        limit: MAX_FINDINGS_READ,
        props: ROOT,
      },
    );
    const coverage: ScrubCoverage = await getScrubCoverage(data.projectId);
    const storeById: Map<string, DataStore> = new Map(
      stores.map((store: DataStore): [string, DataStore] => {
        return [idOf(store), store];
      }),
    );
    const findings: Array<ServiceLeakFinding> = [];

    for (const finding of found) {
      const store: DataStore | undefined = storeById.get(
        idOf({ id: finding.dataStoreId || null }),
      );
      // A service's by its store's kind; a RUM application's by where it sits.
      const signal: TelemetryLeakSignal | null = getTelemetryLeakSignalOf(
        store?.kind,
        finding.location,
      );

      if (
        !store ||
        !signal ||
        !finding.dataTypeId ||
        !finding.location ||
        !isFindingCounted(finding) ||
        finding.confidence === DataConfidence.Low
      ) {
        continue;
      }

      const isMaskedByScrubRule: boolean =
        finding.isScrubbed === true ||
        findCoveringScrubRule(coverage, {
          kind: store.kind!,
          dataTypeId: finding.dataTypeId,
          location: finding.location,
          // A RUM application's records are sent under its own id.
          serviceId: store.serviceId || getTelemetryStoreOwnerId(store),
        }) !== null;
      const issue: DataSecurityIssue | null = issueOfFinding({
        issues,
        dataStoreId: idOf(store),
        checkId: getTelemetryCheckIdOfDataType(finding.dataTypeId),
        isMaskedByScrubRule,
      });

      if (issue) {
        findings.push({ finding, store, issue, signal, isMaskedByScrubRule });
      }
    }

    return { issues, findings };
  }

  /*
   * The service's fixes: one plan for each repository its leaks are
   * written in, the riskiest first - none when it has no leak OneUptime
   * still sees.
   */
  @CaptureSpan()
  public static async planService(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    now?: Date | undefined;
  }): Promise<Array<TelemetryLeakFixPlan>> {
    const leaks: ServiceLeaks | null =
      await TelemetryLeakFix.readServiceLeaks(data);

    if (!leaks || leaks.findings.length === 0) {
      return [];
    }

    return await TelemetryLeakFix.planOwner({
      projectId: data.projectId,
      owner: {
        kind: TelemetryLeakFixOwnerKind.Service,
        id: idOf(leaks.service),
        name: leaks.service.name || "",
      },
      issues: leaks.issues,
      findings: leaks.findings,
    });
  }

  /*
   * A RUM application's fixes in its front-end code (#10933): one plan for
   * each repository its leaks are written in, the riskiest first - none
   * when it has no leak OneUptime still sees.
   */
  @CaptureSpan()
  public static async planRumApplication(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    now?: Date | undefined;
  }): Promise<Array<TelemetryLeakFixPlan>> {
    const leaks: RumApplicationLeaks | null =
      await TelemetryLeakFix.readRumApplicationLeaks(data);

    if (!leaks || leaks.findings.length === 0) {
      return [];
    }

    return await TelemetryLeakFix.planOwner({
      projectId: data.projectId,
      owner: leaks.owner,
      issues: leaks.issues,
      findings: leaks.findings,
    });
  }

  // An owner's fixes: its leaks located, put in repositories, and decided.
  public static async planOwner(data: {
    projectId: ObjectID;
    owner: TelemetryLeakFixOwner;
    issues: ReadonlyArray<DataSecurityIssue>;
    findings: ReadonlyArray<ServiceLeakFinding>;
  }): Promise<Array<TelemetryLeakFixPlan>> {
    const owner: TelemetryLeakFixOwner = data.owner;
    const isApplication: boolean =
      owner.kind === TelemetryLeakFixOwnerKind.RumApplication;

    // The riskiest issues' findings first: those a long list keeps.
    const findings: Array<ServiceLeakFinding> = [...data.findings]
      .sort((left: ServiceLeakFinding, right: ServiceLeakFinding): number => {
        return (
          (right.issue.riskScore || 0) - (left.issue.riskScore || 0) ||
          (right.finding.matchCount || 0) - (left.finding.matchCount || 0)
        );
      })
      .slice(0, MAX_TELEMETRY_LEAKS_PER_FIX);
    const namer: DataTypeNamer = await ProjectDataTypeNames.read({
      projectId: data.projectId,
    });
    const located: Map<string, TelemetryLeakLocation> =
      await TelemetryLeakLocator.locate({
        projectId: data.projectId,
        findings: findings.map(
          (entry: ServiceLeakFinding): TelemetryLeakFindingToLocate => {
            return {
              findingId: idOf(entry.finding),
              storeKind: entry.store.kind!,
              ownerId: owner.id,
              ...(owner.sourceMapServiceId
                ? { sourceMapServiceId: owner.sourceMapServiceId }
                : {}),
              location: entry.finding.location!,
              dataTypeId: entry.finding.dataTypeId!,
              sampleRecords: readFindingSampleRecords(
                entry.finding.sampleRecords,
              ),
              lastSeenAt: entry.finding.lastSeenAt || null,
            };
          },
        ),
        options: (await DataSecurityRunner.getScanSetup(data.projectId))
          .options,
        nameOf: (dataTypeId: string): string => {
          return namer.nameOf(dataTypeId);
        },
      });
    const toPlace: Array<TelemetryLeakToPlace> = findings.map(
      (entry: ServiceLeakFinding): TelemetryLeakToPlace => {
        const key: string | undefined =
          getScrubTarget(entry.store.kind, entry.finding.location!)?.key ||
          getRumSessionKey(entry.finding.location!);

        return {
          issueId: idOf(entry.issue),
          dataStoreId: idOf(entry.store),
          checkId: entry.issue.checkId || "",
          findingId: idOf(entry.finding),
          signal: entry.signal,
          dataTypeId: entry.finding.dataTypeId!,
          dataTypeName: namer.nameOf(
            entry.finding.dataTypeId!,
            entry.finding.dataTypeName,
          ),
          isSecret:
            getTelemetryCheckIdOfDataType(entry.finding.dataTypeId!) ===
            SECRETS_IN_TELEMETRY_CHECK_ID,
          location: entry.finding.location!,
          ...(key ? { key } : {}),
          isMaskedByScrubRule: entry.isMaskedByScrubRule,
          places: located.get(idOf(entry.finding))?.places || [],
        };
      },
    );
    const repositories: Array<ResolvableRepository> =
      await CodeRepositoryService.getResolvableRepositories(data.projectId);
    const groups: Array<TelemetryLeakRepositoryGroup> =
      await chooseTelemetryLeakRepositories({
        leaks: toPlace,
        // An application's repository is named like what its code calls it.
        serviceName: (isApplication && owner.codeName) || owner.name,
        repositories,
        getTreePaths: CodeRepositoryServiceClass.getRepositoryTreePaths,
        getServiceFolder: async (
          repository: ResolvableRepository,
        ): Promise<string | null> => {
          // Production Review keeps services' folders: an application has none.
          return isApplication
            ? null
            : await TelemetryLeakFix.getServiceFolder({
                projectId: data.projectId,
                repositoryId: repository.id,
                serviceId: owner.id,
              });
        },
        ...(isApplication && owner.sourceMapServiceId
          ? {
              appFiles: await TelemetryLeakFix.readSourceMapFiles({
                projectId: data.projectId,
                serviceId: owner.sourceMapServiceId,
              }),
            }
          : {}),
      });

    return groups
      .map((group: TelemetryLeakRepositoryGroup): TelemetryLeakFixPlan => {
        return TelemetryLeakFix.toPlan({
          projectId: data.projectId,
          owner,
          issues: data.issues,
          group,
        });
      })
      .sort((left: TelemetryLeakFixPlan, right: TelemetryLeakFixPlan) => {
        return right.riskScore - left.riskScore;
      });
  }

  /*
   * One repository's leaks of an owner, decided, as a plan: a service's -
   * named by its row - or a RUM application's (#10933).
   */
  public static toPlan(data: {
    projectId: ObjectID;
    service?: Service | undefined;
    owner?: TelemetryLeakFixOwner | undefined;
    issues: ReadonlyArray<DataSecurityIssue>;
    group: TelemetryLeakRepositoryGroup;
  }): TelemetryLeakFixPlan {
    const owner: TelemetryLeakFixOwner = data.owner || {
      kind: TelemetryLeakFixOwnerKind.Service,
      id: data.service ? idOf(data.service) : "",
      name: data.service?.name || "",
    };
    const decision: TelemetryLeakFixDecision = decideTelemetryLeakFix(
      data.group.leaks,
    );
    const issueIds: Array<string> = [];

    for (const leak of decision.leaks) {
      if (!issueIds.includes(leak.issueId)) {
        issueIds.push(leak.issueId);
      }
    }

    const issues: Array<TelemetryLeakFixIssue> = issueIds
      .map((issueId: string): TelemetryLeakFixIssue | null => {
        const issue: DataSecurityIssue | undefined = data.issues.find(
          (candidate: DataSecurityIssue): boolean => {
            return idOf(candidate) === issueId;
          },
        );
        const leak: TelemetryLeakFixLeak | undefined = decision.leaks.find(
          (candidate: TelemetryLeakFixLeak): boolean => {
            return candidate.issueId === issueId;
          },
        );

        return issue && leak
          ? {
              issueId,
              title: issue.title || "",
              checkId: issue.checkId || "",
              signal: leak.signal,
              issueUrl: getIssuePageUrl(data.projectId, issueId),
            }
          : null;
      })
      .filter(
        (
          issue: TelemetryLeakFixIssue | null,
        ): issue is TelemetryLeakFixIssue => {
          return issue !== null;
        },
      )
      .sort((left: TelemetryLeakFixIssue, right: TelemetryLeakFixIssue) => {
        return (
          TelemetryLeakFix.riskOf(data.issues, right.issueId) -
          TelemetryLeakFix.riskOf(data.issues, left.issueId)
        );
      })
      .slice(0, MAX_TELEMETRY_LEAK_ISSUES);
    const serviceId: string = owner.id.toLowerCase();
    const repositoryId: string | null = data.group.repository?.id || null;
    const startFiles: Array<string> = getTelemetryLeakStartFiles(
      decision.leaks,
    );

    return {
      ownerKind: owner.kind,
      serviceId,
      serviceName: owner.name,
      repository: data.group.repository,
      choice: data.group.choice,
      folder: data.group.folder,
      decision,
      startFiles,
      issues,
      hasSecrets: decision.leaks.some((leak: TelemetryLeakFixLeak): boolean => {
        return leak.isSecret;
      }),
      riskScore: issues.length
        ? TelemetryLeakFix.riskOf(data.issues, issues[0]!.issueId)
        : 0,
      riskiestIssueId: issues[0]?.issueId || decision.leaks[0]?.issueId || "",
      planKey: getTelemetryLeakFixPlanKey({
        serviceId,
        repositoryId,
        leaks: decision.leaks,
      }),
      fingerprint: getTelemetryLeakFixFingerprint({
        serviceId,
        repositoryId,
        strategy: decision.strategy,
        leaks: decision.leaks,
        startFiles,
      }),
    };
  }

  private static riskOf(
    issues: ReadonlyArray<DataSecurityIssue>,
    issueId: string,
  ): number {
    return (
      issues.find((issue: DataSecurityIssue): boolean => {
        return idOf(issue) === issueId;
      })?.riskScore || 0
    );
  }

  /*
   * The service's folder Production Review keeps for the repository
   * (ProductionReviewScope's service folders), or null. Never fails.
   */
  public static async getServiceFolder(data: {
    projectId: ObjectID;
    repositoryId: string;
    serviceId: string;
  }): Promise<string | null> {
    try {
      const scope: ProductionReviewScopeResult =
        await ProductionReviewScope.get({
          projectId: data.projectId,
          codeRepositoryId: new ObjectID(data.repositoryId),
        });

      return (
        scope.services.find(
          (service: { id: string; pathInRepository: string | null }) => {
            return service.id.toLowerCase() === data.serviceId.toLowerCase();
          },
        )?.pathInRepository || null
      );
    } catch (error) {
      logger.debug(
        `DataSecurity: could not read service ${data.serviceId}'s folder in repository ${data.repositoryId}: ${error}`,
      );
      return null;
    }
  }

  /*
   * A RUM application's own files, as its newest release's source maps name
   * them (#10933): the paths in their "sources", cleaned of a bundler's
   * prefix, a dependency's left out - never sourcesContent. At most
   * MAX_SOURCE_MAPS_READ maps, MAX_SOURCE_MAP_BYTES_READ in all. Never
   * fails: none when nothing was uploaded, or nothing could be read.
   */
  public static async readSourceMapFiles(data: {
    projectId: ObjectID;
    serviceId: string;
  }): Promise<Array<string>> {
    try {
      const listed: Array<TelemetrySourceMap> =
        await TelemetrySourceMapService.findBy({
          query: {
            projectId: data.projectId,
            serviceId: new ObjectID(data.serviceId),
          },
          select: { _id: true, serviceVersion: true, sizeInBytes: true },
          sort: { createdAt: SortOrder.Descending },
          skip: 0,
          limit: 50,
          props: ROOT,
        });
      const release: string | undefined = listed[0]?.serviceVersion;
      const files: Array<string> = [];
      let bytes: number = 0;
      let read: number = 0;

      for (const map of listed) {
        if (
          map.serviceVersion !== release ||
          read >= MAX_SOURCE_MAPS_READ ||
          files.length >= MAX_SOURCE_MAP_FILES
        ) {
          continue;
        }

        const size: number = map.sizeInBytes || 0;

        if (bytes + size > MAX_SOURCE_MAP_BYTES_READ) {
          continue;
        }

        const withContent: TelemetrySourceMap | null =
          await TelemetrySourceMapService.findOneBy({
            query: { _id: map.id!, projectId: data.projectId },
            select: { _id: true, content: true },
            props: ROOT,
          });

        bytes += size;
        read++;

        for (const file of readSourceMapSources(withContent?.content || "")) {
          if (!files.includes(file) && files.length < MAX_SOURCE_MAP_FILES) {
            files.push(file);
          }
        }
      }

      return files;
    } catch (error) {
      logger.debug(
        `DataSecurity: could not read the files of service ${data.serviceId}'s source maps: ${error}`,
      );
      return [];
    }
  }

  // The task context a plan's fix carries, but its request.
  public static toTaskContext(data: {
    projectId: ObjectID;
    plan: TelemetryLeakFixPlan;
  }): Omit<TelemetryLeakFixTaskContext, "request"> {
    const plan: TelemetryLeakFixPlan = data.plan;
    const isApplication: boolean =
      plan.ownerKind === TelemetryLeakFixOwnerKind.RumApplication;

    return {
      ...(isApplication ? { ownerKind: plan.ownerKind } : {}),
      serviceId: plan.serviceId,
      serviceName: plan.serviceName,
      title: isApplication
        ? `Stop ${plan.serviceName || "the application"} sending sensitive data from the browser`
        : `Stop ${plan.serviceName || "the service"} writing sensitive data to its telemetry`,
      strategy: plan.decision.strategy,
      placeCount: plan.decision.placeCount,
      leaks: plan.decision.leaks,
      issues: plan.issues,
      redactionKeys: plan.decision.redactionKeys,
      redactionDataTypes: plan.decision.redactionDataTypes,
      startFiles: plan.startFiles,
      ...(plan.folder ? { folder: plan.folder } : {}),
      hasSecrets: plan.hasSecrets,
      issuesUrl: getIssuesPageUrl(data.projectId),
    };
  }

  // The request a plan's fix hands the coding agent, as the input builder writes it.
  public static buildRequest(
    plan: TelemetryLeakFixPlan,
  ): DataSecurityAiCodeRequest {
    return buildTelemetryLeakFixRequest({
      ownerKind: plan.ownerKind,
      serviceName: plan.serviceName,
      folder: plan.folder || undefined,
      strategy: plan.decision.strategy,
      placeCount: plan.decision.placeCount,
      leaks: plan.decision.leaks,
      redactionKeys: plan.decision.redactionKeys,
      redactionDataTypes: plan.decision.redactionDataTypes,
      startFiles: plan.startFiles,
    });
  }

  // The task of a plan's fix still on its way in its repository, or null.
  public static async findFixOnItsWay(data: {
    projectId: ObjectID;
    serviceId: string;
    repositoryId: string;
  }): Promise<string | null> {
    return await CodeFixOnItsWay.findTaskId(
      CodeFixOnItsWay.ofTelemetryLeaks({
        projectId: data.projectId,
        serviceId: data.serviceId,
        codeRepositoryId: data.repositoryId,
      }),
    );
  }

  /*
   * A plan's fix, asked: as the person - with their permissions, in a
   * repository they may ask in, the plan's or the one they picked - or as
   * OneUptime, in the plan's repository. One already on its way for the
   * service there is answered with, not asked again.
   */
  @CaptureSpan()
  public static async start(data: {
    projectId: ObjectID;
    plan: TelemetryLeakFixPlan;
    props: DatabaseCommonInteractionProps;
    // The repository the person picked, or the proposal named.
    requestedRepositoryId?: unknown;
    llmProviderId?: ObjectID | undefined;
    // The security case whose playbook asked (#10740): the task is kept on it.
    triggeredBySecurityCaseId?: ObjectID | undefined;
  }): Promise<DataSecurityFixResult & { wasAlreadyAsked?: boolean }> {
    const requested: string =
      typeof data.requestedRepositoryId === "string" &&
      ObjectID.isValidUUID(data.requestedRepositoryId.trim())
        ? data.requestedRepositoryId.trim().toLowerCase()
        : data.plan.repository?.id.toLowerCase() || "";

    if (requested) {
      const onItsWay: string | null = await TelemetryLeakFix.findFixOnItsWay({
        projectId: data.projectId,
        serviceId: data.plan.serviceId,
        repositoryId: requested,
      });

      if (onItsWay) {
        return {
          message: TELEMETRY_FIX_ON_ITS_WAY_MESSAGE,
          aiRunId: onItsWay,
          wasAlreadyAsked: true,
        };
      }
    }

    const issueIds: Array<ObjectID> = data.plan.issues.map(
      (issue: TelemetryLeakFixIssue): ObjectID => {
        return new ObjectID(issue.issueId);
      },
    );

    const result: DataSecurityFixResult =
      await DataSecurityCodeTask.requestTelemetryLeakFix({
        props: data.props,
        projectId: data.projectId,
        issueIds,
        requestedRepositoryId: requested || undefined,
        fix: TelemetryLeakFix.toTaskContext({
          projectId: data.projectId,
          plan: data.plan,
        }),
        llmProviderId: data.llmProviderId,
        triggeredBySecurityCaseId: data.triggeredBySecurityCaseId,
        buildMessage: async (): Promise<DataSecurityAiCodeRequest> => {
          return TelemetryLeakFix.buildRequest(data.plan);
        },
      });

    /*
     * Asked for by a person: what OneUptime AI still proposes for the
     * service there waits for nobody now.
     */
    if (result.aiRunId && data.props.userId) {
      try {
        await DataSecurityAiProposalService.expireWaitingInLane({
          projectId: data.projectId,
          kind: DataSecurityAiProposalKind.FixTelemetryLeaksInCode,
          lane: getTelemetryLeakFixLane({
            serviceId: data.plan.serviceId,
            repositoryId: requested || data.plan.repository?.id || null,
          }),
          at: OneUptimeDate.getCurrentDate(),
        });
      } catch (error) {
        logger.error(
          `DataSecurity telemetry fix: could not settle what waited for service ${data.plan.serviceId}: ${error}`,
        );
      }
    }

    return result;
  }

  /*
   * The plan Fix with AI on a telemetry issue shows, before anything
   * starts: of the issue's service's fixes, the one in the repository most
   * of the issue's leaks are written in - with the repositories the person
   * may pick among when nothing decides, and the fix already on its way
   * when there is one. Null, saying why, for an issue that is no service's
   * telemetry, or with nothing left to fix.
   */
  @CaptureSpan()
  public static async planForIssue(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    result: DataSecurityTelemetryFixPlanResult;
    plan: TelemetryLeakFixPlan | null;
  }> {
    // Only an issue the person may read: one held from them by its labels is not found.
    if (!data.props.isRoot) {
      const readable: DataSecurityIssue | null =
        await DataSecurityIssueService.findOneBy({
          query: { _id: data.issueId, projectId: data.projectId },
          select: { _id: true },
          props: data.props,
        });

      if (!readable?.id) {
        throw new NotFoundException("Issue not found.");
      }
    }

    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: { _id: true, checkId: true, dataStoreId: true },
        props: ROOT,
      });

    if (!issue?.id) {
      throw new BadDataException("Issue not found.");
    }

    const owner: { kind: TelemetryLeakFixOwnerKind; id: ObjectID } | null =
      await TelemetryLeakFix.ownerOfIssue({
        projectId: data.projectId,
        issue,
      });

    if (!owner) {
      return {
        result: { plan: null, message: TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE },
        plan: null,
      };
    }

    const isApplication: boolean =
      owner.kind === TelemetryLeakFixOwnerKind.RumApplication;
    const plans: Array<TelemetryLeakFixPlan> = isApplication
      ? await TelemetryLeakFix.planRumApplication({
          projectId: data.projectId,
          rumApplicationId: owner.id,
        })
      : await TelemetryLeakFix.planService({
          projectId: data.projectId,
          serviceId: owner.id,
        });
    const plan: TelemetryLeakFixPlan | null = TelemetryLeakFix.planOfIssue(
      plans,
      idOf(issue),
    );

    if (!plan) {
      return {
        result: {
          plan: null,
          message: isApplication
            ? TELEMETRY_FIX_NOTHING_TO_FIX_IN_APPLICATION_MESSAGE
            : TELEMETRY_FIX_NOTHING_TO_FIX_MESSAGE,
        },
        plan: null,
      };
    }

    return {
      result: {
        plan: await TelemetryLeakFix.toPlanJSON({
          projectId: data.projectId,
          plan,
          props: data.props,
        }),
      },
      plan,
    };
  }

  // Of a service's fixes, the one most of the issue's leaks are in.
  public static planOfIssue(
    plans: ReadonlyArray<TelemetryLeakFixPlan>,
    issueId: string,
  ): TelemetryLeakFixPlan | null {
    let best: TelemetryLeakFixPlan | null = null;
    let bestCount: number = 0;

    for (const plan of plans) {
      const count: number = plan.decision.leaks.filter(
        (leak: TelemetryLeakFixLeak): boolean => {
          return leak.issueId === issueId.toLowerCase();
        },
      ).length;

      if (count > bestCount) {
        best = plan;
        bestCount = count;
      }
    }

    return best;
  }

  /*
   * Whose code an issue's fix changes: the service its store is the
   * telemetry of, or the RUM application its session replay store is
   * (#10933) - null for any other issue.
   */
  public static async ownerOfIssue(data: {
    projectId: ObjectID;
    issue: Pick<DataSecurityIssue, "checkId" | "dataStoreId">;
  }): Promise<{ kind: TelemetryLeakFixOwnerKind; id: ObjectID } | null> {
    if (
      !isTelemetryFindingCheck(data.issue.checkId) ||
      !data.issue.dataStoreId
    ) {
      return null;
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.issue.dataStoreId, projectId: data.projectId },
      select: { _id: true, kind: true, serviceId: true, storeKey: true },
      props: ROOT,
    });

    if (!store) {
      return null;
    }

    if (store.serviceId && getTelemetryLeakSignal(store.kind)) {
      return { kind: TelemetryLeakFixOwnerKind.Service, id: store.serviceId };
    }

    const applicationId: string | null = RUM_TELEMETRY_STORE_KINDS.includes(
      store.kind as DataStoreKind,
    )
      ? getTelemetryStoreOwnerId(store)
      : null;

    return applicationId
      ? {
          kind: TelemetryLeakFixOwnerKind.RumApplication,
          id: new ObjectID(applicationId),
        }
      : null;
  }

  /*
   * The service an issue's store is the telemetry of, when it is a
   * service's telemetry store this fix works on - null for any other.
   */
  public static async serviceOfIssue(data: {
    projectId: ObjectID;
    issue: Pick<DataSecurityIssue, "checkId" | "dataStoreId">;
  }): Promise<ObjectID | null> {
    if (
      !isTelemetryFindingCheck(data.issue.checkId) ||
      !data.issue.dataStoreId
    ) {
      return null;
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.issue.dataStoreId, projectId: data.projectId },
      select: { _id: true, kind: true, serviceId: true },
      props: ROOT,
    });

    return store?.serviceId && getTelemetryLeakSignal(store.kind)
      ? store.serviceId
      : null;
  }

  /*
   * A plan as the person is shown it: where it goes - only a repository
   * they may ask OneUptime AI to work in; else the ones they may pick
   * among - and the fix already on its way, when there is one.
   */
  public static async toPlanJSON(data: {
    projectId: ObjectID;
    plan: TelemetryLeakFixPlan;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityTelemetryFixPlanJSON> {
    const plan: TelemetryLeakFixPlan = data.plan;
    const askable: Array<CodeRepository> =
      await TelemetryLeakFix.listAskableRepositories(data);
    const decided: CodeRepository | undefined = plan.repository
      ? askable.find((repository: CodeRepository): boolean => {
          return idOf(repository) === plan.repository!.id.toLowerCase();
        })
      : undefined;
    const repository: DataSecurityTelemetryFixRepository | undefined =
      decided && plan.choice
        ? {
            id: idOf(decided),
            name: decided.name || plan.repository!.repositoryName,
            choice: plan.choice,
          }
        : undefined;
    const existingTaskId: string | null = repository
      ? await TelemetryLeakFix.findFixOnItsWay({
          projectId: data.projectId,
          serviceId: plan.serviceId,
          repositoryId: repository.id,
        })
      : null;

    return {
      ...(plan.ownerKind === TelemetryLeakFixOwnerKind.RumApplication
        ? { ownerKind: plan.ownerKind }
        : {}),
      serviceId: plan.serviceId,
      serviceName: plan.serviceName,
      strategy: plan.decision.strategy,
      placeCount: plan.decision.placeCount,
      leaks: plan.decision.leaks,
      issues: plan.issues,
      redactionKeys: plan.decision.redactionKeys,
      redactionDataTypes: plan.decision.redactionDataTypes,
      startFiles: plan.startFiles,
      ...(plan.folder ? { folder: plan.folder } : {}),
      hasSecrets: plan.hasSecrets,
      ...(repository ? { repository } : {}),
      ...(!repository
        ? {
            repositories: askable.map(
              (candidate: CodeRepository): DataSecurityFixRepository => {
                return {
                  id: idOf(candidate),
                  name: candidate.name || idOf(candidate),
                };
              },
            ),
          }
        : {}),
      fingerprint: plan.fingerprint,
      ...(existingTaskId
        ? {
            existing:
              (await DataSecurityIssueCodeFix.readTask({
                projectId: data.projectId,
                taskId: new ObjectID(existingTaskId),
                props: data.props,
                issueCount: plan.issues.length,
                serviceName: plan.serviceName,
              })) || undefined,
          }
        : {}),
    };
  }

  // The repositories the person may read and ask OneUptime AI to work in.
  private static async listAskableRepositories(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<CodeRepository>> {
    if (data.props.isRoot) {
      return [];
    }

    try {
      return await DataSecurityCodeTask.getAskableRepositories({
        props: data.props,
        projectId: data.projectId,
        readable: await CodeTaskAccess.listReadableRepositories({
          props: data.props,
          projectId: data.projectId,
        }),
      });
    } catch {
      // A role that may read no repository at all: there is none to pick.
      return [];
    }
  }

  /*
   * Fix with AI on a telemetry issue (#10367): the plan it was shown, asked
   * - in the repository the plan found, or the one the person picked. A
   * plan that changed since it was shown starts nothing, and is sent back
   * to show again.
   */
  @CaptureSpan()
  public static async runForIssue(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    props: DatabaseCommonInteractionProps;
    codeRepositoryId?: unknown;
    expectedPlanFingerprint?: unknown;
  }): Promise<DataSecurityFixResult> {
    const planned: {
      result: DataSecurityTelemetryFixPlanResult;
      plan: TelemetryLeakFixPlan | null;
    } = await TelemetryLeakFix.planForIssue(data);

    if (!planned.plan || !planned.result.plan) {
      return {
        message: planned.result.message || TELEMETRY_FIX_NOTHING_TO_FIX_MESSAGE,
      };
    }

    if (
      typeof data.expectedPlanFingerprint === "string" &&
      data.expectedPlanFingerprint !== planned.plan.fingerprint
    ) {
      return {
        message: TELEMETRY_FIX_CHANGED_MESSAGE,
        plan: planned.result.plan,
      };
    }

    // Nothing decides, and nothing was picked: the person picks.
    const picked: string =
      typeof data.codeRepositoryId === "string" &&
      ObjectID.isValidUUID(data.codeRepositoryId.trim())
        ? data.codeRepositoryId.trim()
        : "";

    if (!picked && !planned.result.plan.repository) {
      const repositories: Array<DataSecurityFixRepository> =
        planned.result.plan.repositories || [];

      const isApplication: boolean =
        planned.plan.ownerKind === TelemetryLeakFixOwnerKind.RumApplication;

      return {
        message:
          repositories.length > 0
            ? isApplication
              ? "Choose the repository that holds this application's front-end code."
              : "Choose the repository that holds this service's code."
            : isApplication
              ? "Connect the repository that holds this application's front-end code under Code, then ask again. If it is connected already, asking OneUptime AI to change it takes permission to edit it in Code - ask a Project Admin for it."
              : "Connect the repository that holds this service's code under Code, then ask again. If it is connected already, asking OneUptime AI to change it takes permission to edit it in Code - ask a Project Admin for it.",
        repositories,
        plan: planned.result.plan,
      };
    }

    return await TelemetryLeakFix.start({
      projectId: data.projectId,
      plan: planned.plan,
      props: data.props,
      requestedRepositoryId: picked || planned.result.plan.repository?.id,
    });
  }

  // The issues a telemetry fix's task is for (#10368 follows them), from its own context.
  public static async getIssueIdsOfTask(data: {
    projectId: ObjectID;
    taskId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const task: AIRun | null = await AIRunService.findOneBy({
      query: { _id: data.taskId.toString(), projectId: data.projectId },
      select: { _id: true, taskContext: true },
      props: ROOT,
    });

    return getTelemetryLeakFixIssueIds(
      getTelemetryLeakFixTaskContext(task?.taskContext?.telemetryLeakFix),
    ).map((id: string): ObjectID => {
      return new ObjectID(id);
    });
  }

  /*
   * A pull request a Code task opened (CodeFixPullRequestRecord): when the
   * task stops a service writing its telemetry leaks - its first turn's
   * context says so - each issue it fixes says so on its timeline, with the
   * link, and that a secret must be rotated. Never throws.
   */
  @CaptureSpan()
  public static async onPullRequestOpened(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    pullRequestUrl: string;
    title: string;
  }): Promise<void> {
    try {
      const run: AIRun | null = await AIRunService.findOneBy({
        query: { _id: data.aiRunId.toString(), projectId: data.projectId },
        select: { _id: true, codeTaskId: true, taskContext: true },
        props: ROOT,
      });
      // A reply's pull request is its task's: the first turn holds the leaks.
      const task: AIRun | null =
        run && run.codeTaskId
          ? await AIRunService.findOneBy({
              query: {
                _id: run.codeTaskId.toString(),
                projectId: data.projectId,
              },
              select: { _id: true, taskContext: true },
              props: ROOT,
            })
          : run;
      const fix: TelemetryLeakFixTaskContext | null =
        getTelemetryLeakFixTaskContext(task?.taskContext?.telemetryLeakFix);

      if (!fix) {
        return;
      }

      const isWebAddress: boolean =
        data.pullRequestUrl.startsWith("https://") ||
        data.pullRequestUrl.startsWith("http://");
      const isApplication: boolean =
        fix.ownerKind === TelemetryLeakFixOwnerKind.RumApplication;
      const opened: MarkdownText = isApplication
        ? isWebAddress
          ? mdText`OneUptime AI opened one pull request that stops ${fix.serviceName || "the application"} sending sensitive data from the browser, for this issue and the application's others: [${data.title}](${data.pullRequestUrl}).`
          : mdText`OneUptime AI opened one pull request that stops ${fix.serviceName || "the application"} sending sensitive data from the browser, for this issue and the application's others: ${data.title}.`
        : isWebAddress
          ? mdText`OneUptime AI opened one pull request that stops ${fix.serviceName || "the service"} writing sensitive data to its telemetry, for this issue and the service's others: [${data.title}](${data.pullRequestUrl}).`
          : mdText`OneUptime AI opened one pull request that stops ${fix.serviceName || "the service"} writing sensitive data to its telemetry, for this issue and the service's others: ${data.title}.`;
      const markdown: string = (
        fix.hasSecrets
          ? FeedMarkdown.join(
              [
                opened,
                mdText`**Rotate the secret too:** the code fix stops new copies only.`,
              ],
              " ",
            )
          : opened
      ).toString();

      for (const issueId of getTelemetryLeakFixIssueIds(fix)) {
        if (!ObjectID.isValidUUID(issueId)) {
          continue;
        }

        await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
          projectId: data.projectId,
          dataSecurityIssueId: new ObjectID(issueId),
          eventType: DataSecurityIssueFeedEventType.AiFixRequested,
          displayColor: Purple500,
          feedInfoInMarkdown: markdown,
        });
      }
    } catch (error) {
      logger.error(
        `DataSecurity telemetry fix: could not say that run ${data.aiRunId.toString()} opened a pull request: ${error}`,
      );
    }
  }

  // The lane a service's fix in one repository waits in (its proposals' plan keys).
  public static laneOf(plan: TelemetryLeakFixPlan): string {
    return getTelemetryLeakFixLane({
      serviceId: plan.serviceId,
      repositoryId: plan.repository?.id || null,
    });
  }
}
