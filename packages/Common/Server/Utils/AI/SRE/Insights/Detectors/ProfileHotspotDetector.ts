import ObjectID from "../../../../../../Types/ObjectID";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import AIInsightSeverity from "../../../../../../Types/AI/AIInsightSeverity";
import {
  ProfileInsightEvidence,
  ProfileInsightNeighbourEvidence,
} from "../../../../../../Types/AI/AIInsightEvidence";
import ServiceType from "../../../../../../Types/Telemetry/ServiceType";
import Service from "../../../../../../Models/DatabaseModels/Service";
import ServiceService from "../../../../../Services/ServiceService";
import ProfileAggregationService, {
  FunctionListItem,
  FunctionListResult,
  ServiceActivityItem,
} from "../../../../../Services/ProfileAggregationService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
import ProfileEvidence, {
  ProfileFunctionEvidence,
  ProfileKind,
  ProfileWindow,
} from "../../../../Profile/ProfileEvidence";
import LlmConversationPrivacy from "../../../../LlmObservability/LlmConversationPrivacy";
import logger from "../../../../Logger";
import CaptureSpan from "../../../../Telemetry/CaptureSpan";
import {
  mdText,
  MarkdownText,
} from "../../../../../../Utils/Markdown/FeedMarkdown";
import FeedMarkdown from "../../../../../../Utils/Markdown/FeedMarkdown";
import {
  ProfileFrameOrigin,
  getProfileFunctionKey,
  isOwnProfileFrame,
} from "../../../../../../Utils/Profiles/ProfileFrames";
import {
  ProfileCallChain,
  ProfileCallee,
  getShareOfWindow,
} from "../../../../../../Utils/Profiles/ProfileHotspot";
import {
  PROFILE_INSIGHT_CANDIDATES_PER_SERVICE,
  PROFILE_INSIGHT_CATEGORIES,
  PROFILE_INSIGHT_MAX_FINDINGS_PER_SERVICE,
  PROFILE_INSIGHT_MAX_SERVICES_PER_SCAN,
  PROFILE_INSIGHT_MIN_WINDOW_SAMPLES,
  ProfileInsightReading,
  getProfileInsightFingerprint,
  getProfileInsightReason,
  getProfileInsightSeverity,
  getProfileInsightTitle,
  getProfileInsightWindows,
  isProfileInsightScanTick,
} from "../../../../../../Utils/Profiles/ProfileInsight";
import {
  ProfileCategory,
  formatProfileShare,
  getProfileCategoryNoun,
} from "../../../../../../Utils/Profiles/ProfileTypes";
import { ProfileFixReason } from "../../../../../../Utils/Suggestions/ProfileFixSuggestion";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * ProfileHotspot — slow code in a service's profiles: a function of the
 * service's own code that takes a large share of its time over the last
 * hour, or whose share grew well beyond what it took in the same hour the
 * day before (Utils/Profiles/ProfileInsight holds the gates). It feeds the
 * Profiles product's AI section (Types/AI/TelemetryAi): OneUptime AI looks
 * into each finding and opens a pull request that makes the code faster,
 * as the project's profile AI rules say.
 *
 * Once an hour (the scanner's first look of each hour), for the ten
 * busiest profiled services: one read of the small Profile table for which
 * services were profiled, and for each service its function list in the two
 * windows (own-code time, as the Profiler's "Your code" ranks it) - then,
 * for the few functions that pass the gates on the lists, the function's
 * own reading (ProfileEvidence.readFunction: its callers and callees, and
 * the same share the Profiler's "Fix with AI" is decided on), which decides.
 * Deterministic: no LLM anywhere here.
 *
 * Read as root with the project scoped explicitly, as every detector: the
 * services whose telemetry holds a company AI tool's private chats are left
 * out (LlmConversationPrivacy), since an insight is read by people who may
 * not read those.
 */

// A function as the gates read it, from the two windows' function lists.
export interface ProfileHotspotListReading {
  item: FunctionListItem;
  reading: ProfileInsightReading;
  reason: ProfileFixReason;
}

export default class ProfileHotspotDetector implements InsightDetector {
  public insightType: AIInsightType = AIInsightType.ProfileHotspot;

  /*
   * The services to read, busiest first: services (not hosts or clusters,
   * whose eBPF profiles hold every process on them), with enough samples in
   * the window to mean something, not a company AI tool's.
   */
  public static pickServices(data: {
    activity: Array<ServiceActivityItem>;
    excludedServiceIds: Set<string>;
  }): Array<string> {
    return data.activity
      .filter((item: ServiceActivityItem): boolean => {
        const type: string = item.primaryEntityType || "";

        return (
          Boolean(item.primaryEntityId) &&
          (type === "" || type === ServiceType.OpenTelemetry) &&
          item.sampleCount >= PROFILE_INSIGHT_MIN_WINDOW_SAMPLES &&
          !data.excludedServiceIds.has(item.primaryEntityId.toLowerCase())
        );
      })
      .sort((a: ServiceActivityItem, b: ServiceActivityItem): number => {
        return (
          b.sampleCount - a.sampleCount ||
          a.primaryEntityId.localeCompare(b.primaryEntityId)
        );
      })
      .slice(0, PROFILE_INSIGHT_MAX_SERVICES_PER_SCAN)
      .map((item: ServiceActivityItem): string => {
        return item.primaryEntityId.toLowerCase();
      });
  }

  /*
   * The functions worth reading closely, from the two windows' lists: the
   * application's own functions whose list figures pass the gates, growth
   * first (a regression is the more useful finding), then by share. Pure.
   */
  public static pickCandidates(data: {
    category: ProfileCategory;
    recent: FunctionListResult;
    baseline: FunctionListResult | null;
  }): Array<ProfileHotspotListReading> {
    const before: Map<string, FunctionListItem> = new Map<
      string,
      FunctionListItem
    >();

    for (const item of data.baseline?.functions || []) {
      before.set(getProfileFunctionKey(item.functionName, item.fileName), item);
    }

    const readings: Array<ProfileHotspotListReading> = [];

    for (const item of data.recent.functions) {
      const isOwnCode: boolean = isOwnProfileFrame(
        item.fileName,
        item.functionName,
        item.frameType,
      );

      if (!isOwnCode || item.ownValue <= 0) {
        continue;
      }

      const reading: ProfileInsightReading = {
        category: data.category,
        isOwnCode,
        ownShare: getShareOfWindow(item.ownValue, data.recent.windowTotal),
        functionSampleCount: item.sampleCount,
        windowSampleCount: data.recent.windowSampleCount,
      };

      if (data.baseline) {
        const previous: FunctionListItem | undefined = before.get(
          getProfileFunctionKey(item.functionName, item.fileName),
        );

        reading.ownShareBefore = previous
          ? getShareOfWindow(previous.ownValue, data.baseline.windowTotal)
          : 0;
        reading.baselineWindowSampleCount = data.baseline.windowSampleCount;
      }

      const reason: ProfileFixReason | null = getProfileInsightReason(reading);

      if (reason) {
        readings.push({ item, reading, reason });
      }
    }

    const growth: (candidate: ProfileHotspotListReading) => number = (
      candidate: ProfileHotspotListReading,
    ): number => {
      return (
        candidate.reading.ownShare - (candidate.reading.ownShareBefore || 0)
      );
    };

    return readings
      .sort(
        (
          a: ProfileHotspotListReading,
          b: ProfileHotspotListReading,
        ): number => {
          if (a.reason !== b.reason) {
            return a.reason === ProfileFixReason.Grew ? -1 : 1;
          }

          const byWeight: number =
            a.reason === ProfileFixReason.Grew
              ? growth(b) - growth(a)
              : b.reading.ownShare - a.reading.ownShare;

          return (
            byWeight ||
            getProfileFunctionKey(
              a.item.functionName,
              a.item.fileName,
            ).localeCompare(
              getProfileFunctionKey(b.item.functionName, b.item.fileName),
            )
          );
        },
      )
      .slice(0, PROFILE_INSIGHT_CANDIDATES_PER_SERVICE);
  }

  // What the function's own reading says, as the gates read it.
  public static toReading(
    evidence: ProfileFunctionEvidence,
    category: ProfileCategory,
  ): ProfileInsightReading {
    const reading: ProfileInsightReading = {
      category,
      isOwnCode: evidence.origin === ProfileFrameOrigin.Own,
      ownShare: evidence.ownShare,
      functionSampleCount: evidence.sampleCount,
      windowSampleCount: evidence.windowSampleCount,
    };

    if (evidence.before) {
      reading.ownShareBefore = evidence.before.ownShare;
      reading.baselineWindowSampleCount = evidence.before.windowSampleCount;
    }

    return reading;
  }

  // The insight a confirmed finding becomes. Pure.
  public static buildCandidate(data: {
    serviceId: string;
    serviceName: string;
    kind: ProfileKind;
    category: ProfileCategory;
    evidence: ProfileFunctionEvidence;
    reading: ProfileInsightReading;
    reason: ProfileFixReason;
    baseline: ProfileWindow;
  }): InsightCandidate {
    const evidence: ProfileFunctionEvidence = data.evidence;
    const windowTotal: number = evidence.windowTotal;

    const callers: Array<ProfileInsightNeighbourEvidence> =
      evidence.callerChains
        .filter((chain: ProfileCallChain): boolean => {
          return chain.frames.length > 0;
        })
        .slice(0, 5)
        .map((chain: ProfileCallChain): ProfileInsightNeighbourEvidence => {
          return {
            functionName: chain.frames[0]!.functionName,
            fileName: chain.frames[0]!.fileName,
            share: getShareOfWindow(chain.value, windowTotal),
          };
        });

    const callees: Array<ProfileInsightNeighbourEvidence> = evidence.callees
      .slice(0, 5)
      .map((callee: ProfileCallee): ProfileInsightNeighbourEvidence => {
        return {
          functionName: callee.functionName,
          fileName: callee.fileName,
          share: getShareOfWindow(callee.value, windowTotal),
        };
      });

    const profile: ProfileInsightEvidence = {
      serviceId: data.serviceId,
      functionName: evidence.functionName,
      fileName: evidence.fileName,
      lineNumber: evidence.lineNumber,
      profileType: data.kind.selection,
      category: data.category,
      reason: data.reason,
      ownShare: data.reading.ownShare,
      functionSampleCount: data.reading.functionSampleCount,
      windowSampleCount: data.reading.windowSampleCount,
      windowStartTime: evidence.window.startTime.toISOString(),
      windowEndTime: evidence.window.endTime.toISOString(),
      callers,
      callees,
    };

    if (data.reading.ownShareBefore !== undefined) {
      profile.ownShareBefore = data.reading.ownShareBefore;
      profile.baselineStartTime = data.baseline.startTime.toISOString();
      profile.baselineEndTime = data.baseline.endTime.toISOString();
    }

    const severity: AIInsightSeverity = getProfileInsightSeverity(
      data.reading,
      data.reason,
    );

    return {
      insightType: AIInsightType.ProfileHotspot,
      fingerprint: getProfileInsightFingerprint({
        serviceId: data.serviceId,
        category: data.category,
        functionName: evidence.functionName,
        fileName: evidence.fileName,
      }),
      title: getProfileInsightTitle({
        functionName: evidence.functionName,
        serviceName: data.serviceName,
        category: data.category,
        reason: data.reason,
        ownShare: data.reading.ownShare,
        ownShareBefore: data.reading.ownShareBefore,
      }),
      detailMarkdown: ProfileHotspotDetector.buildDetail({
        serviceName: data.serviceName,
        category: data.category,
        profile,
      }).toString(),
      severity,
      serviceName: data.serviceName,
      telemetryServiceId: new ObjectID(data.serviceId),
      evidence: { profile },
    };
  }

  /*
   * The evidence as a person reads it on the insight: real numbers only.
   * Every name is written into Markdown escaped (mdText): a function or a
   * file name is the profiler's, not ours.
   */
  public static buildDetail(data: {
    serviceName: string;
    category: ProfileCategory;
    profile: ProfileInsightEvidence;
  }): MarkdownText {
    const profile: ProfileInsightEvidence = data.profile;
    const noun: string = getProfileCategoryNoun(data.category);
    const where: string = profile.fileName
      ? `${profile.fileName}${profile.lineNumber > 0 ? `:${profile.lineNumber}` : ""}`
      : "";

    const lines: Array<MarkdownText> = [
      mdText`**Slow code in ${data.serviceName}**`,
      FeedMarkdown.empty(),
      where
        ? mdText`- Function: \`${profile.functionName}\` in \`${where}\``
        : mdText`- Function: \`${profile.functionName}\``,
      mdText`- Takes ${formatProfileShare(profile.ownShare)} of the service's ${noun} over the hour, with the library and runtime code it calls (${profile.functionSampleCount.toLocaleString("en-US")} of ${profile.windowSampleCount.toLocaleString("en-US")} samples)`,
    ];

    if (profile.ownShareBefore !== undefined) {
      lines.push(
        mdText`- At the same time the day before: ${formatProfileShare(profile.ownShareBefore)}`,
      );
    }

    if (profile.callees.length > 0) {
      lines.push(
        mdText`- Spends its time calling: ${FeedMarkdown.join(
          profile.callees.map(
            (callee: ProfileInsightNeighbourEvidence): MarkdownText => {
              return mdText`\`${callee.functionName}\` (${formatProfileShare(callee.share)})`;
            },
          ),
          ", ",
        )}`,
      );
    }

    if (profile.callers.length > 0) {
      lines.push(
        mdText`- Called from: ${FeedMarkdown.join(
          profile.callers.map(
            (caller: ProfileInsightNeighbourEvidence): MarkdownText => {
              return mdText`\`${caller.functionName}\``;
            },
          ),
          ", ",
        )}`,
      );
    }

    return FeedMarkdown.join(lines, "\n");
  }

  @CaptureSpan()
  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    if (!isProfileInsightScanTick(context.now)) {
      return [];
    }

    const windows: { window: ProfileWindow; baseline: ProfileWindow } =
      getProfileInsightWindows(context.now);

    const excludedServiceIds: Set<string> = new Set<string>(
      (
        await LlmConversationPrivacy.getRestrictedServiceIds(context.projectId)
      ).map((id: string): string => {
        return id.toLowerCase();
      }),
    );

    const activity: Array<ServiceActivityItem> =
      await ProfileAggregationService.getServiceActivity({
        projectId: context.projectId,
        startTime: windows.window.startTime,
        endTime: windows.window.endTime,
        ...(excludedServiceIds.size > 0
          ? {
              excludedServiceIds: Array.from(excludedServiceIds).map(
                (id: string): ObjectID => {
                  return new ObjectID(id);
                },
              ),
            }
          : {}),
      });

    const serviceIds: Array<string> = ProfileHotspotDetector.pickServices({
      activity,
      excludedServiceIds,
    });

    if (serviceIds.length === 0) {
      return [];
    }

    // Only ids that are the project's services: a host's id is none.
    const services: Array<Service> = await ServiceService.findBy({
      query: {
        projectId: context.projectId,
        _id: QueryHelper.any(serviceIds),
      },
      select: { _id: true, name: true },
      limit: serviceIds.length,
      skip: 0,
      props: { isRoot: true },
    });

    const candidates: Array<InsightCandidate> = [];

    for (const serviceId of serviceIds) {
      const service: Service | undefined = services.find(
        (row: Service): boolean => {
          return row.id?.toString().toLowerCase() === serviceId;
        },
      );

      if (!service) {
        continue;
      }

      try {
        candidates.push(
          ...(await this.detectInService({
            projectId: context.projectId,
            serviceId,
            serviceName: service.name || "this service",
            window: windows.window,
            baseline: windows.baseline,
          })),
        );
      } catch (error) {
        logger.error(
          `ProfileHotspotDetector: service ${serviceId} of project ${context.projectId.toString()} could not be read - continuing with the others: ${error}`,
        );
      }
    }

    return candidates;
  }

  private async detectInService(data: {
    projectId: ObjectID;
    serviceId: string;
    serviceName: string;
    window: ProfileWindow;
    baseline: ProfileWindow;
  }): Promise<Array<InsightCandidate>> {
    const serviceFilter: { serviceIds: Array<ObjectID> } = {
      serviceIds: [new ObjectID(data.serviceId)],
    };

    // CPU time, or the first kind the service has (wall time, say).
    const kind: ProfileKind | null = await ProfileEvidence.resolveKind({
      projectId: data.projectId,
      window: data.window,
      serviceFilter,
    });

    if (
      !kind ||
      !kind.category ||
      !PROFILE_INSIGHT_CATEGORIES.includes(kind.category)
    ) {
      return [];
    }

    const category: ProfileCategory = kind.category;

    const [recent, baseline]: [FunctionListResult, FunctionListResult] =
      await Promise.all([
        ProfileAggregationService.getFunctionList({
          projectId: data.projectId,
          startTime: data.window.startTime,
          endTime: data.window.endTime,
          ...serviceFilter,
          profileTypes: kind.queryTypes,
          limit: 50,
          sortBy: "ownValue",
        }),
        ProfileAggregationService.getFunctionList({
          projectId: data.projectId,
          startTime: data.baseline.startTime,
          endTime: data.baseline.endTime,
          ...serviceFilter,
          profileTypes: kind.queryTypes,
          limit: 200,
          sortBy: "ownValue",
        }),
      ]);

    const listed: Array<ProfileHotspotListReading> =
      ProfileHotspotDetector.pickCandidates({
        category,
        recent,
        baseline: baseline.windowSampleCount > 0 ? baseline : null,
      });

    const found: Array<InsightCandidate> = [];

    for (const candidate of listed) {
      if (found.length >= PROFILE_INSIGHT_MAX_FINDINGS_PER_SERVICE) {
        break;
      }

      /*
       * The function's own reading decides, the one the Profiler's Fix with
       * AI is decided on: never file what it would not offer.
       */
      const evidence: ProfileFunctionEvidence | null =
        await ProfileEvidence.readFunction({
          projectId: data.projectId,
          serviceFilter,
          kind,
          functionName: candidate.item.functionName,
          fileName: candidate.item.fileName,
          window: data.window,
          ...(baseline.windowSampleCount > 0
            ? { beforeWindow: data.baseline }
            : {}),
        });

      if (!evidence) {
        continue;
      }

      const reading: ProfileInsightReading = ProfileHotspotDetector.toReading(
        evidence,
        category,
      );
      const reason: ProfileFixReason | null = getProfileInsightReason(reading);

      if (!reason) {
        continue;
      }

      found.push(
        ProfileHotspotDetector.buildCandidate({
          serviceId: data.serviceId,
          serviceName: data.serviceName,
          kind,
          category,
          evidence,
          reading,
          reason,
          baseline: data.baseline,
        }),
      );
    }

    return found;
  }
}
