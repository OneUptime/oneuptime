import crypto from "crypto";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import ChangeEventService from "../../../Services/ChangeEventService";
import ProfileAggregationService, {
  FunctionListItem,
  FunctionListResult,
} from "../../../Services/ProfileAggregationService";
import TraceAggregationService, {
  CodeLocationSampleRow,
  ServiceLatencyProfile,
  ServiceLatencyProfileRow,
  TraceAnalyticsTableRow,
} from "../../../Services/TraceAggregationService";
import RecentChangesContext, {
  ChangeRelevance,
  groupRecordedChanges,
  MAX_CHANGES_READ,
  RecentChange,
  RecordedChange,
  toRecordedChange,
} from "../../AI/SRE/RecentChangesContext";
import { ChangeImpactVerdict } from "../../AI/SRE/ChangeImpact";
import { CodeAgentScopedService } from "../../AI/CodeFix/CodeAgentTelemetryScope";
import ProfileEvidence, { ProfileKind } from "../../Profile/ProfileEvidence";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  PRODUCTION_REVIEW_WINDOWS,
  ProductionReviewSection,
} from "../../../../Types/CodeRepository/ProductionReview";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  ProfileFrameOrigin,
  getProfileFrameOrigin,
} from "../../../../Utils/Profiles/ProfileFrames";
import { getShareOfWindow } from "../../../../Utils/Profiles/ProfileHotspot";

/*
 * WHAT PRODUCTION DOES WITH A REPOSITORY'S CODE, READ ONCE FOR ALL OF ITS
 * PULL REQUESTS.
 *
 * A production review is unattended work that every push to every pull
 * request starts, and most of what it reads does not depend on the pull
 * request at all: how busy each of the repository's services is, the
 * operations they serve, which operations run which code, where their CPU
 * time goes, and which of their recent deploys OneUptime suspects. So that
 * is read for the repository - over the last hour of traces and profiles,
 * the last week of deploys - kept for half an hour, and every review of
 * the repository's pull requests in that time matches its own change
 * against the same reads (ProductionReviewFindings).
 *
 * Every read is bounded and stands on its own: one that fails or takes too
 * long leaves its part out (unread), and the review says so, rather than
 * fail the review or wait on it.
 */

// How long a repository's reads are kept, and kept when some failed.
export const REPOSITORY_PROFILE_CACHE_SECONDS: number = 30 * 60;
export const PARTIAL_REPOSITORY_PROFILE_CACHE_SECONDS: number = 5 * 60;

// The longest one read may take before its part is left out.
export const REPOSITORY_PROFILE_READ_TIMEOUT_MS: number = 30 * 1000;

// The busiest operations of the repository's services read.
export const MAX_OPERATIONS_READ: number = 500;

// Spans the code location sample reads, and the groups it keeps.
export const CODE_LOCATION_SAMPLE_SIZE: number = 20000;
export const MAX_CODE_LOCATIONS: number = 500;

// The busiest services whose profiles are read, and their functions kept.
export const MAX_PROFILED_SERVICES: number = 5;
export const MAX_FUNCTIONS_PER_SERVICE: number = 150;

const CACHE_NAMESPACE: string = "production-review-repository";

export interface ServiceTraffic {
  serviceId: string;
  // Spans in the traces window.
  count: number;
  p99Ms: number;
}

export interface ServiceOperation {
  serviceId: string;
  name: string;
  count: number;
  errorCount: number;
  p95Ms: number;
}

export interface CodeLocation {
  serviceId: string;
  // The operation (span name) the code runs in.
  name: string;
  filePath: string;
  functionName: string;
  count: number;
}

export interface ProfiledFunction {
  serviceId: string;
  functionName: string;
  fileName: string;
  totalPercent: number;
  selfPercent: number;
  // What the profile measures: "CPU time".
  kind: string;
}

export interface SuspectDeploy {
  serviceId: string;
  at: string;
  version?: string | undefined;
  // What got worse after it.
  impact: string;
}

export interface RepositoryProductionProfile {
  readAt: string;
  traffic: Array<ServiceTraffic>;
  operations: Array<ServiceOperation>;
  codeLocations: Array<CodeLocation>;
  functions: Array<ProfiledFunction>;
  suspectDeploys: Array<SuspectDeploy>;
  unread: Array<ProductionReviewSection>;
}

// A read that may fail or run out of time: its part, or null.
async function readWithin<T>(
  section: string,
  read: () => Promise<T>,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  try {
    return await Promise.race([
      read(),
      new Promise<never>(
        (_resolve: unknown, reject: (error: Error) => void): void => {
          timer = setTimeout(() => {
            reject(new Error("the read took too long"));
          }, REPOSITORY_PROFILE_READ_TIMEOUT_MS);
        },
      ),
    ]);
  } catch (error) {
    logger.warn(
      `Production review: could not read ${section} for a repository: ${error}`,
    );
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function lowerIds(services: Array<CodeAgentScopedService>): Array<string> {
  return services
    .map((service: CodeAgentScopedService): string => {
      return service.id.toLowerCase();
    })
    .sort();
}

export default class ProductionReviewRepositoryProfile {
  /*
   * The repository's reads, from the cache when they are fresh: kept per
   * repository and per set of services, so a repository whose services
   * change is read again.
   */
  @CaptureSpan()
  public static async get(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
    services: Array<CodeAgentScopedService>;
  }): Promise<RepositoryProductionProfile> {
    const key: string = ProductionReviewRepositoryProfile.getCacheKey(data);

    try {
      const cached: JSONObject | null = await GlobalCache.getJSONObject(
        CACHE_NAMESPACE,
        key,
      );

      if (cached && ProductionReviewRepositoryProfile.isProfile(cached)) {
        return cached as unknown as RepositoryProductionProfile;
      }
    } catch (error) {
      logger.debug(
        `Production review: could not read a repository's cached reads: ${error}`,
      );
    }

    const profile: RepositoryProductionProfile =
      await ProductionReviewRepositoryProfile.read(data);

    try {
      await GlobalCache.setJSON(
        CACHE_NAMESPACE,
        key,
        profile as unknown as JSONObject,
        {
          expiresInSeconds:
            profile.unread.length > 0
              ? PARTIAL_REPOSITORY_PROFILE_CACHE_SECONDS
              : REPOSITORY_PROFILE_CACHE_SECONDS,
        },
      );
    } catch (error) {
      logger.debug(
        `Production review: could not keep a repository's reads: ${error}`,
      );
    }

    return profile;
  }

  public static getCacheKey(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
    services: Array<CodeAgentScopedService>;
  }): string {
    const services: string = crypto
      .createHash("sha256")
      .update(lowerIds(data.services).join(","))
      .digest("hex")
      .substring(0, 16);

    return `${data.projectId.toString()}:${data.codeRepositoryId
      .toString()
      .toLowerCase()}:${services}`;
  }

  // Whether a cached value is a profile this code wrote.
  public static isProfile(value: JSONObject): boolean {
    return (
      typeof value["readAt"] === "string" &&
      Array.isArray(value["traffic"]) &&
      Array.isArray(value["operations"]) &&
      Array.isArray(value["codeLocations"]) &&
      Array.isArray(value["functions"]) &&
      Array.isArray(value["suspectDeploys"]) &&
      Array.isArray(value["unread"])
    );
  }

  // Every read, at once, each on its own.
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
    services: Array<CodeAgentScopedService>;
  }): Promise<RepositoryProductionProfile> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const serviceIds: Array<ObjectID> = lowerIds(data.services).map(
      (id: string): ObjectID => {
        return new ObjectID(id);
      },
    );

    if (serviceIds.length === 0) {
      return {
        readAt: now.toISOString(),
        traffic: [],
        operations: [],
        codeLocations: [],
        functions: [],
        suspectDeploys: [],
        unread: [],
      };
    }

    const tracesStart: Date = OneUptimeDate.addRemoveHours(
      now,
      -PRODUCTION_REVIEW_WINDOWS.tracesHours,
    );

    const [traffic, operations, codeLocations, suspectDeploys]: [
      Array<ServiceTraffic> | null,
      Array<ServiceOperation> | null,
      Array<CodeLocation> | null,
      Array<SuspectDeploy> | null,
    ] = await Promise.all([
      readWithin("traffic", () => {
        return ProductionReviewRepositoryProfile.readTraffic({
          projectId: data.projectId,
          serviceIds,
          startTime: tracesStart,
          endTime: now,
        });
      }),
      readWithin("operations", () => {
        return ProductionReviewRepositoryProfile.readOperations({
          projectId: data.projectId,
          serviceIds,
          startTime: tracesStart,
          endTime: now,
        });
      }),
      readWithin("code locations", () => {
        return ProductionReviewRepositoryProfile.readCodeLocations({
          projectId: data.projectId,
          serviceIds,
          startTime: tracesStart,
          endTime: now,
        });
      }),
      readWithin("deploys", () => {
        return ProductionReviewRepositoryProfile.readSuspectDeploys({
          projectId: data.projectId,
          serviceIds,
          now,
        });
      }),
    ]);

    // The busiest services' profiles: their traffic says which they are.
    const profiled: Array<ObjectID> = ProductionReviewRepositoryProfile.busiest(
      serviceIds,
      traffic || [],
    ).slice(0, MAX_PROFILED_SERVICES);

    const functions: Array<ProfiledFunction> | null = await readWithin(
      "profiles",
      () => {
        return ProductionReviewRepositoryProfile.readFunctions({
          projectId: data.projectId,
          serviceIds: profiled,
          startTime: OneUptimeDate.addRemoveHours(
            now,
            -PRODUCTION_REVIEW_WINDOWS.profilesHours,
          ),
          endTime: now,
        });
      },
    );

    const unread: Array<ProductionReviewSection> = [];

    if (!traffic) {
      unread.push(ProductionReviewSection.Services);
    }

    if (!operations || !codeLocations) {
      unread.push(ProductionReviewSection.Operations);
    }

    if (!functions) {
      unread.push(ProductionReviewSection.Profiles);
    }

    if (!suspectDeploys) {
      unread.push(ProductionReviewSection.Deploys);
    }

    return {
      readAt: now.toISOString(),
      traffic: traffic || [],
      operations: operations || [],
      codeLocations: codeLocations || [],
      functions: functions || [],
      suspectDeploys: suspectDeploys || [],
      unread,
    };
  }

  // The services, busiest first; those with no traffic keep their order last.
  public static busiest(
    serviceIds: Array<ObjectID>,
    traffic: Array<ServiceTraffic>,
  ): Array<ObjectID> {
    const counts: Map<string, number> = new Map<string, number>();

    for (const entry of traffic) {
      counts.set(entry.serviceId.toLowerCase(), entry.count);
    }

    return [...serviceIds].sort((a: ObjectID, b: ObjectID): number => {
      return (
        (counts.get(b.toString().toLowerCase()) || 0) -
        (counts.get(a.toString().toLowerCase()) || 0)
      );
    });
  }

  /*
   * How busy each service is: spans and p99 over the window, from the
   * aggregate projection - cheap, and a partial answer is no answer.
   */
  private static async readTraffic(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    startTime: Date;
    endTime: Date;
  }): Promise<Array<ServiceTraffic>> {
    const profile: ServiceLatencyProfile =
      await TraceAggregationService.getServiceLatencyProfile({
        projectId: data.projectId,
        startTime: data.startTime,
        endTime: data.endTime,
        limit: data.serviceIds.length,
        serviceIds: data.serviceIds,
      });

    if (profile.isPartial) {
      throw new Error("the traffic read was cut short");
    }

    return profile.rows.map((row: ServiceLatencyProfileRow): ServiceTraffic => {
      return {
        serviceId: row.primaryEntityId.toLowerCase(),
        count: row.count,
        p99Ms: Math.round(row.p99DurationMs * 100) / 100,
      };
    });
  }

  // The busiest operations of the services, with their errors and p95.
  private static async readOperations(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    startTime: Date;
    endTime: Date;
  }): Promise<Array<ServiceOperation>> {
    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable({
        projectId: data.projectId,
        startTime: data.startTime,
        endTime: data.endTime,
        bucketSizeInMinutes: 60,
        chartType: "table",
        metric: "count",
        groupBy: ["primaryEntityId", "name"],
        limit: MAX_OPERATIONS_READ,
        serviceIds: data.serviceIds,
      });

    return rows
      .map((row: TraceAnalyticsTableRow): ServiceOperation => {
        return {
          serviceId: (row.groupValues["primaryEntityId"] || "").toLowerCase(),
          name: row.groupValues["name"] || "",
          count: row.count,
          errorCount: row.errorCount,
          p95Ms: Math.round(row.p95DurationMs * 100) / 100,
        };
      })
      .filter((operation: ServiceOperation): boolean => {
        return Boolean(operation.serviceId) && Boolean(operation.name);
      });
  }

  // Which operations run which code, from spans that say.
  private static async readCodeLocations(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    startTime: Date;
    endTime: Date;
  }): Promise<Array<CodeLocation>> {
    const rows: Array<CodeLocationSampleRow> =
      await TraceAggregationService.getCodeLocationSample({
        projectId: data.projectId,
        startTime: data.startTime,
        endTime: data.endTime,
        serviceIds: data.serviceIds,
        sampleSize: CODE_LOCATION_SAMPLE_SIZE,
        limit: MAX_CODE_LOCATIONS,
      });

    return rows.map((row: CodeLocationSampleRow): CodeLocation => {
      return {
        serviceId: row.serviceId,
        name: row.name,
        filePath: row.filePath,
        functionName: row.functionName,
        count: row.count,
      };
    });
  }

  /*
   * Where each service's time goes, from its continuous profiles: the
   * functions of the application's own code - never a library's, the
   * runtime's or the system's, which no pull request changes - with their
   * share of the window.
   */
  private static async readFunctions(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    startTime: Date;
    endTime: Date;
  }): Promise<Array<ProfiledFunction>> {
    const functions: Array<ProfiledFunction> = [];

    for (const serviceId of data.serviceIds) {
      const kind: ProfileKind | null = await ProfileEvidence.resolveKind({
        projectId: data.projectId,
        window: { startTime: data.startTime, endTime: data.endTime },
        serviceFilter: { serviceIds: [serviceId] },
      });

      if (!kind) {
        continue;
      }

      const list: FunctionListResult =
        await ProfileAggregationService.getFunctionList({
          projectId: data.projectId,
          startTime: data.startTime,
          endTime: data.endTime,
          serviceIds: [serviceId],
          profileTypes: kind.queryTypes,
          limit: 500,
          sortBy: "totalValue",
        });

      if (list.windowTotal <= 0) {
        continue;
      }

      const kindName: string = ProfileEvidence.describeKind(kind);

      functions.push(
        ...list.functions
          .filter((item: FunctionListItem): boolean => {
            return (
              Boolean(item.fileName) &&
              Boolean(item.functionName) &&
              getProfileFrameOrigin(
                item.fileName,
                item.functionName,
                item.frameType,
              ) === ProfileFrameOrigin.Own
            );
          })
          .slice(0, MAX_FUNCTIONS_PER_SERVICE)
          .map((item: FunctionListItem): ProfiledFunction => {
            return {
              serviceId: serviceId.toString().toLowerCase(),
              functionName: item.functionName,
              fileName: item.fileName,
              totalPercent: getShareOfWindow(item.totalValue, list.windowTotal),
              selfPercent: getShareOfWindow(item.selfValue, list.windowTotal),
              kind: kindName,
            };
          }),
      );
    }

    return functions;
  }

  /*
   * The services' deploys and other changes in the deploys window that
   * OneUptime suspects: their error rate, latency or exceptions measurably
   * got worse in the half hour after (RecentChangesContext.checkImpact, as
   * the code agent's recent_deploys reads them).
   */
  private static async readSuspectDeploys(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    now: Date;
  }): Promise<Array<SuspectDeploy>> {
    const since: Date = OneUptimeDate.addRemoveDays(
      data.now,
      -PRODUCTION_REVIEW_WINDOWS.deploysDays,
    );

    const events: Array<ChangeEvent> = await ChangeEventService.findBy({
      query: {
        projectId: data.projectId,
        time: new InBetween(since, data.now),
        primaryEntityId: new Includes(
          data.serviceIds.map((id: ObjectID): string => {
            return id.toString();
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
      props: { isRoot: true, tenantId: data.projectId },
    });

    const relevance: ChangeRelevance = {
      serviceIds: new Set<string>(
        data.serviceIds.map((id: ObjectID): string => {
          return id.toString().toLowerCase();
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
    ).reverse();

    await RecentChangesContext.checkImpact({
      projectId: data.projectId,
      changes,
      lookahead: data.now,
      now: data.now,
    });

    return changes
      .filter((change: RecentChange): boolean => {
        return (
          change.impact?.verdict === ChangeImpactVerdict.Suspect &&
          Boolean(change.serviceId)
        );
      })
      .map((change: RecentChange): SuspectDeploy => {
        const deploy: SuspectDeploy = {
          serviceId: (change.serviceId || "").toLowerCase(),
          at: new Date(change.time).toISOString(),
          impact: (change.impact?.reasons || []).join("; "),
        };

        const version: string | undefined =
          change.fields.version || change.fields.commitSha;

        if (version) {
          deploy.version = version;
        }

        return deploy;
      });
  }
}
