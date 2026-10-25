import ThreatIntelFeed from "../../../../Models/DatabaseModels/ThreatIntelFeed";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../../Types/SecurityEvent/OcsfEventClass";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
} from "../../../../Types/SecurityEvent/DetectionFindingConstants";
import {
  THREAT_CONFIDENCE_ATTRIBUTE,
  THREAT_FEED_ID_ATTRIBUTE,
  THREAT_FEED_NAME_ATTRIBUTE,
  THREAT_INDICATOR_ID_ATTRIBUTE,
  THREAT_INDICATOR_TYPE_ATTRIBUTE,
  THREAT_INDICATOR_VALUE_ATTRIBUTE,
  THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES,
  THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES,
  THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION,
  THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION,
  THREAT_INTEL_PRODUCT_NAME,
  THREAT_INTEL_SERVICE_NAME,
  THREAT_MATCH_COUNT_ATTRIBUTE,
  isStixIndicatorId,
  ocsfSeverityForConfidence,
} from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../Services/SecurityEventService";
import ThreatIntelFeedService from "../../../Services/ThreatIntelFeedService";
import ThreatIntelIndicatorService, {
  IndicatorMatchGroup,
} from "../../../Services/ThreatIntelIndicatorService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import {
  AlertableMatch,
  openDedupedAlerts,
  openDedupedIncidents,
  resolveAlertSeverityIdForProject,
  resolveIncidentSeverityIdForProject,
} from "../SecurityEventAlerting";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import {
  detectionOverflowMarkdown,
  threatIntelMatchMarkdown,
} from "../../../../Utils/SecurityCase/SecurityCaseMarkdown";
import {
  DetectionGroupSplit,
  describeDetectionOverflow,
  splitDetectionGroups,
} from "../../../../Utils/SecurityEvent/DetectionOverflow";
import Select from "../../../Types/Database/Select";
import SecurityProjectWork, {
  SecurityProjectWorkDefinition,
  SecurityProjectWorkLease,
  UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
} from "../SecurityProjectWork";
import SecurityEntityRiskRecorder from "../EntityRisk/SecurityEntityRiskRecorder";
import { riskFindingsForIndicatorMatches } from "../EntityRisk/SecurityEntityRiskFindings";
import SecurityCaseIngest, {
  SecurityCaseIngestResult,
  SecurityDetectionSignal,
} from "../../SecurityCase/SecurityCaseIngest";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import {
  entitiesFromObservables,
  mergeSecurityEntities,
} from "../../../../Types/SecurityCase/SecurityEntity";

/*
 * The threat-intel matcher: every minute, join each enabled feed's ACTIVE
 * indicators against the security events ingested since the feed's last
 * evaluation. A matched indicator behaves exactly like a Sigma match —
 * a Detection Finding row (classUid 2004, product "OneUptime Threat
 * Intel", oneuptime.threat.* attributes), a deduped alert per
 * (feed, indicator value) fingerprint, and optionally an incident —
 * through the same shared machinery (SecurityEventAlerting,
 * buildSecurityEventDbRow) as the detection engine.
 *
 * Each window is evaluated ONCE, at close, against the indicators known
 * at that moment: the matcher catches intel that landed between an
 * event's ingest and its window's close (and, after downtime, anything
 * inside the 24-hour catch-up), but intel arriving later is not
 * retroactively joined against already-evaluated events — lastEvaluatedAt
 * only moves forward.
 */

// One alert per distinct indicator value per cycle, at most.
export const MAX_GROUPS_PER_EVALUATION: number =
  THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION;

export interface ThreatIntelMatchResult {
  feedId: string;
  // Indicator values the check recorded (at most THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION).
  matchedIndicators: number;
  // Of those, the ones past MAX_GROUPS_PER_EVALUATION: one case about the feed holds them.
  overflowIndicators: number;
  totalMatches: number;
  alertsCreated: number;
  incidentsCreated: number;
  findingsWritten: number;
  // Cases the matches opened; the rest joined cases already open.
  casesOpened: number;
}

/*
 * The work is spread by project (SecurityProjectWork): the cron queues one
 * turn for each project with an enabled feed, and a turn checks that
 * project's feeds, the longest unchecked first.
 */
export const THREAT_INTEL_MATCH_PROJECT_WORK: SecurityProjectWorkDefinition = {
  jobName: "ThreatIntel:MatchProjectIndicators",
  key: "threat-intel-match",
  maxConcurrentProjects: 8,
};

// What a turn reads of each feed: everything evaluateFeed needs.
const THREAT_INTEL_MATCH_FEED_SELECT: Select<ThreatIntelFeed> = {
  _id: true,
  projectId: true,
  name: true,
  shouldCreateAlert: true,
  shouldCreateIncident: true,
  shouldWriteDetectionFinding: true,
  shouldCreateCase: true,
  alertSeverityId: true,
  incidentSeverityId: true,
  lastEvaluatedAt: true,
};

// Finding rows written per insert.
const THREAT_INTEL_FINDING_INSERT_BATCH_SIZE: number = 1000;

export default class ThreatIntelMatcher {
  /*
   * The cron's half: every enabled feed in the instance, page by page, and
   * one turn queued for each project that has one. Returns how many
   * projects were queued.
   */
  @CaptureSpan()
  public static async enqueueProjectsWithEnabledFeeds(): Promise<number> {
    const feeds: Array<ThreatIntelFeed> =
      await ThreatIntelFeedService.findAllBy({
        query: {
          isEnabled: true,
        },
        select: {
          _id: true,
          projectId: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    return SecurityProjectWork.enqueueProjects(
      THREAT_INTEL_MATCH_PROJECT_WORK,
      feeds.map((feed: ThreatIntelFeed): ObjectID | undefined => {
        return feed.projectId;
      }),
    );
  }

  /*
   * One project's turn: each enabled feed, the longest unchecked first, for
   * as long as the turn has time and keeps its lease. A feed left over goes
   * on next minute from its own lastEvaluatedAt.
   */
  @CaptureSpan()
  public static async evaluateFeedsForProject(
    projectId: ObjectID,
    lease: SecurityProjectWorkLease = UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
  ): Promise<void> {
    const feeds: Array<ThreatIntelFeed> =
      await ThreatIntelFeedService.findAllBy({
        query: {
          projectId,
          isEnabled: true,
        },
        select: THREAT_INTEL_MATCH_FEED_SELECT,
        sort: {
          _id: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    feeds.sort((a: ThreatIntelFeed, b: ThreatIntelFeed): number => {
      return (
        (a.lastEvaluatedAt?.getTime() || 0) -
        (b.lastEvaluatedAt?.getTime() || 0)
      );
    });

    for (const feed of feeds) {
      if (!lease.hasTimeLeft()) {
        return;
      }

      await this.evaluateFeedRecordingFailure(feed);

      if (!(await lease.keep())) {
        return;
      }
    }
  }

  // evaluateFeed, with a failure recorded on the feed rather than thrown.
  private static async evaluateFeedRecordingFailure(
    feed: ThreatIntelFeed,
  ): Promise<void> {
    try {
      await this.evaluateFeed(feed);
    } catch (error) {
      logger.error(
        `ThreatIntelMatcher: error evaluating feed ${feed.id?.toString()}:`,
      );
      logger.error(error);

      /*
       * Best-effort bookkeeping guarded the same way as the poller's:
       * one feed whose error will not store must not stop every other
       * feed from being evaluated. ClickHouse errors echo the failing
       * query back, so they are the long ones.
       */
      if (feed.id) {
        const feedId: ObjectID = feed.id;

        await ConnectorErrorMessage.recordFailure({
          label: `ThreatIntelMatcher: feed ${feedId.toString()}`,
          write: async (): Promise<void> => {
            await ThreatIntelFeedService.updateOneById({
              id: feedId,
              data: {
                lastEvaluatedAt: OneUptimeDate.getCurrentDate(),
                lastMatchError: ConnectorErrorMessage.toMessage(error),
              },
              props: {
                isRoot: true,
              },
            });
          },
        });
      }
    }
  }

  @CaptureSpan()
  public static async evaluateFeed(
    feed: ThreatIntelFeed,
  ): Promise<ThreatIntelMatchResult> {
    if (!feed.id || !feed.projectId) {
      throw new Error("Threat intel feed is missing id or projectId.");
    }

    const endTime: Date = OneUptimeDate.getCurrentDate();

    const earliestAllowed: Date = OneUptimeDate.addRemoveMinutes(
      endTime,
      -THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES,
    );

    let startTime: Date = feed.lastEvaluatedAt
      ? feed.lastEvaluatedAt
      : OneUptimeDate.addRemoveMinutes(
          endTime,
          -THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES,
        );

    if (OneUptimeDate.isBefore(startTime, earliestAllowed)) {
      startTime = earliestAllowed;
    }

    const matches: Array<IndicatorMatchGroup> =
      await ThreatIntelIndicatorService.findIndicatorMatches({
        projectId: feed.projectId,
        feedId: feed.id,
        startTime,
        endTime,
        // One more than a check records, so it can tell "more than it reads".
        maxGroups: THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION + 1,
      });

    /*
     * Every matched value is recorded; the ones seen in the most events open
     * alerts and cases of their own, and the rest open one case about the
     * feed (DetectionOverflow) - never dropped without a word.
     */
    const split: DetectionGroupSplit<IndicatorMatchGroup> =
      splitDetectionGroups(matches, {
        openLimit: MAX_GROUPS_PER_EVALUATION,
        recordLimit: THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION,
      });
    const matchedGroups: Array<IndicatorMatchGroup> = split.recorded;
    const writesFindings: boolean = feed.shouldWriteDetectionFinding !== false;

    const overflowNotice: string | null =
      split.overflow.length > 0 || split.moreThanRead
        ? describeDetectionOverflow({
            kind: "feed",
            matched: split.recorded.length,
            moreThanRead: split.moreThanRead,
            opened: split.opened.length,
            findingsWritten: writesFindings,
          })
        : null;

    const result: ThreatIntelMatchResult = {
      feedId: feed.id.toString(),
      matchedIndicators: matchedGroups.length,
      overflowIndicators: split.overflow.length,
      totalMatches: 0,
      alertsCreated: 0,
      incidentsCreated: 0,
      findingsWritten: 0,
      casesOpened: 0,
    };

    for (const matchGroup of matchedGroups) {
      result.totalMatches += matchGroup.matchCount;
    }

    if (matchedGroups.length > 0) {
      if (feed.shouldCreateAlert !== false) {
        result.alertsCreated = await this.openAlertsForMatches({
          feed,
          matchedGroups: split.opened,
          startTime,
          endTime,
        });
      }

      // === true, not !== false — the DetectionRule incident gate.
      if (feed.shouldCreateIncident === true) {
        result.incidentsCreated = await this.openIncidentsForMatches({
          feed,
          matchedGroups: split.opened,
          startTime,
          endTime,
        });
      }

      let findingEventUids: Map<string, string> = new Map();

      if (writesFindings) {
        findingEventUids = await this.writeThreatIntelFindings({
          feed,
          matchedGroups,
        });
        result.findingsWritten = findingEventUids.size;
      }

      // !== false, like a detection rule's: see DetectionRule.shouldCreateCase.
      if (feed.shouldCreateCase !== false) {
        const signals: Array<SecurityDetectionSignal> = this.buildCaseSignals({
          feed,
          matchedGroups: split.opened,
          findingEventUids,
          startTime,
          endTime,
        });

        if (overflowNotice) {
          signals.push(
            this.buildOverflowSignal({
              feed,
              overflowGroups: split.overflow,
              summary: overflowNotice,
              startTime,
              endTime,
            }),
          );
        }

        try {
          const ingestResult: SecurityCaseIngestResult =
            await SecurityCaseIngest.recordDetections(signals);

          result.casesOpened = ingestResult.casesOpened;
        } catch (error) {
          logger.error(
            `ThreatIntelMatcher: feed ${feed.id.toString()} could not record its matches as security cases:`,
          );
          logger.error(error);
        }
      }

      // Each indicator the check opens adds to the risk of the address it names.
      await SecurityEntityRiskRecorder.record(
        riskFindingsForIndicatorMatches({
          feed,
          matchedGroups: split.opened,
          seenAt: endTime,
        }),
      );
    }

    if (overflowNotice) {
      logger.warn(
        `ThreatIntelMatcher: feed ${feed.id.toString()}: ${overflowNotice}`,
      );
    }

    await ThreatIntelFeedService.updateOneById({
      id: feed.id,
      data: {
        lastEvaluatedAt: endTime,
        // The feed was checked; an overflow is what its row should say about it.
        lastMatchError: overflowNotice as unknown as string,
        ...(matchedGroups.length > 0 ? { lastMatchAt: endTime } : {}),
      },
      props: {
        isRoot: true,
      },
    });

    return result;
  }

  /*
   * Unlike a Sigma rule, whose level applies to every match, indicator
   * matches carry per-indicator confidence — so matches are partitioned
   * by mapped severity and each partition resolves its own project
   * severity before the shared dedupe/create path runs.
   */
  private static async openAlertsForMatches(data: {
    feed: ThreatIntelFeed;
    matchedGroups: Array<IndicatorMatchGroup>;
    startTime: Date;
    endTime: Date;
  }): Promise<number> {
    const { feed, matchedGroups } = data;
    const projectId: ObjectID = feed.projectId!;

    let created: number = 0;

    for (const [severity, groups] of this.partitionBySeverity(
      matchedGroups,
    ).entries()) {
      const alertSeverityId: ObjectID | null =
        await resolveAlertSeverityIdForProject({
          projectId,
          explicitSeverityId: feed.alertSeverityId,
          severityLabel: severity,
          isSevere: this.isSevereSeverity(severity),
        });

      if (!alertSeverityId) {
        logger.warn(
          `ThreatIntelMatcher: project ${projectId.toString()} has no alert severities; skipping alert creation for feed ${feed.id?.toString()}.`,
        );
        return created;
      }

      created += await openDedupedAlerts({
        projectId,
        alertSeverityId,
        logLabel: `ThreatIntelMatcher: feed ${feed.id?.toString()}`,
        matches: groups.map(
          (matchGroup: IndicatorMatchGroup): AlertableMatch => {
            return this.buildAlertableMatch({
              feed,
              matchGroup,
              startTime: data.startTime,
              endTime: data.endTime,
            });
          },
        ),
      });
    }

    return created;
  }

  private static async openIncidentsForMatches(data: {
    feed: ThreatIntelFeed;
    matchedGroups: Array<IndicatorMatchGroup>;
    startTime: Date;
    endTime: Date;
  }): Promise<number> {
    const { feed, matchedGroups } = data;
    const projectId: ObjectID = feed.projectId!;

    let created: number = 0;

    for (const [severity, groups] of this.partitionBySeverity(
      matchedGroups,
    ).entries()) {
      const incidentSeverityId: ObjectID | null =
        await resolveIncidentSeverityIdForProject({
          projectId,
          explicitSeverityId: feed.incidentSeverityId,
          severityLabel: severity,
          isSevere: this.isSevereSeverity(severity),
        });

      if (!incidentSeverityId) {
        logger.warn(
          `ThreatIntelMatcher: project ${projectId.toString()} has no incident severities; skipping incident creation for feed ${feed.id?.toString()}.`,
        );
        return created;
      }

      created += await openDedupedIncidents({
        projectId,
        incidentSeverityId,
        logLabel: `ThreatIntelMatcher: feed ${feed.id?.toString()}`,
        matches: groups.map(
          (matchGroup: IndicatorMatchGroup): AlertableMatch => {
            return this.buildAlertableMatch({
              feed,
              matchGroup,
              startTime: data.startTime,
              endTime: data.endTime,
            });
          },
        ),
      });
    }

    return created;
  }

  /*
   * One case signal per matched indicator: a detection about the indicator's
   * value - the address, domain or hash the events touched - at the severity
   * its confidence earns.
   */
  public static buildCaseSignals(data: {
    feed: ThreatIntelFeed;
    matchedGroups: Array<IndicatorMatchGroup>;
    findingEventUids: Map<string, string>;
    startTime: Date;
    endTime: Date;
  }): Array<SecurityDetectionSignal> {
    const { feed } = data;

    return data.matchedGroups.map(
      (matchGroup: IndicatorMatchGroup): SecurityDetectionSignal => {
        return {
          projectId: feed.projectId!,
          source: SecurityDetectionSource.ThreatIntel,
          fingerprint: this.buildFingerprint(
            feed.id!,
            matchGroup.indicatorValue,
          ),
          title: `${feed.name || "Threat intel"} — ${matchGroup.indicatorValue}`,
          description: threatIntelMatchMarkdown({
            feedName: feed.name || "Threat intel",
            indicatorName: matchGroup.indicatorName,
            indicatorValue: matchGroup.indicatorValue,
            indicatorType: matchGroup.indicatorType,
            confidence: matchGroup.confidence,
            matchCount: matchGroup.matchCount,
            windowStart: OneUptimeDate.getDateAsFormattedString(data.startTime),
            windowEnd: OneUptimeDate.getDateAsFormattedString(data.endTime),
            stixId: matchGroup.stixId,
            sampleMessage: matchGroup.sampleMessage || undefined,
          }).toString(),
          severity: ocsfSeverityForConfidence(matchGroup.confidence),
          eventCount: matchGroup.matchCount,
          groupValue: matchGroup.indicatorValue,
          entities: mergeSecurityEntities(
            entitiesFromObservables([matchGroup.indicatorValue]),
            entitiesFromObservables(matchGroup.sampleObservables),
          ),
          mitreTactics: [],
          mitreTechniques: [],
          ruleName: feed.name || undefined,
          threatIntelFeedId: feed.id!,
          sampleMessage: matchGroup.sampleMessage || undefined,
          eventUid: data.findingEventUids.get(matchGroup.indicatorValue),
          seenAt: data.endTime,
        };
      },
    );
  }

  /*
   * The one case signal about a check's overflow: the indicator values past
   * MAX_GROUPS_PER_EVALUATION. It names no entity - nothing for a playbook
   * to contain - at the severity of the strongest indicator among them, and
   * its fingerprint is the feed's own, so every check that overflows joins
   * the same open case and counts it up.
   */
  public static buildOverflowSignal(data: {
    feed: ThreatIntelFeed;
    overflowGroups: Array<IndicatorMatchGroup>;
    summary: string;
    startTime: Date;
    endTime: Date;
  }): SecurityDetectionSignal {
    const { feed } = data;
    const feedName: string = feed.name || "Threat intel";

    let eventCount: number = 0;
    let highestConfidence: number = 0;

    for (const matchGroup of data.overflowGroups) {
      eventCount += matchGroup.matchCount;
      highestConfidence = Math.max(highestConfidence, matchGroup.confidence);
    }

    return {
      projectId: feed.projectId!,
      source: SecurityDetectionSource.ThreatIntel,
      fingerprint: `threat-intel:${feed.id!.toString()}:overflow`,
      title: `${feedName} — more matches than one check opens cases for`,
      description: detectionOverflowMarkdown({
        kind: "feed",
        sourceName: feedName,
        summary: data.summary,
        windowStart: OneUptimeDate.getDateAsFormattedString(data.startTime),
        windowEnd: OneUptimeDate.getDateAsFormattedString(data.endTime),
        examples: data.overflowGroups.map(
          (matchGroup: IndicatorMatchGroup): string => {
            return matchGroup.indicatorValue;
          },
        ),
      }).toString(),
      severity: ocsfSeverityForConfidence(highestConfidence),
      eventCount,
      entities: [],
      mitreTactics: [],
      mitreTechniques: [],
      ruleName: feed.name || undefined,
      threatIntelFeedId: feed.id!,
      seenAt: data.endTime,
    };
  }

  private static async writeThreatIntelFindings(data: {
    feed: ThreatIntelFeed;
    matchedGroups: Array<IndicatorMatchGroup>;
  }): Promise<Map<string, string>> {
    const { feed, matchedGroups } = data;
    const projectId: ObjectID = feed.projectId!;

    const serviceMetadata: TelemetryServiceMetadata =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: THREAT_INTEL_SERVICE_NAME,
        projectId,
      });

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "securityEvents",
      serviceConfig: serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
      projectConfig: serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: serviceMetadata.projectRetentionInDays,
    });

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    const eventUids: Map<string, string> = new Map();

    const rows: Array<JSONObject> = matchedGroups.map(
      (matchGroup: IndicatorMatchGroup): JSONObject => {
        const severityName: OcsfSeverity = ocsfSeverityForConfidence(
          matchGroup.confidence,
        );

        const eventUid: string = `threat-intel:${feed.id!.toString()}:${this.buildFingerprint(
          feed.id!,
          matchGroup.indicatorValue,
        )}:${OneUptimeDate.getCurrentDateAsUnixNano()}`;

        eventUids.set(matchGroup.indicatorValue, eventUid);

        const normalized: NormalizedSecurityEvent = {
          time: OneUptimeDate.getCurrentDate(),
          eventUid: eventUid,
          categoryUid,
          categoryName,
          classUid: DETECTION_FINDING_CLASS_UID,
          className: DETECTION_FINDING_CLASS_NAME,
          activityName: "Create",
          severityId: OcsfSeverityId[severityName],
          severityName,
          statusName: "New",
          message: `Threat intel: ${feed.name} — ${matchGroup.indicatorValue} (${
            matchGroup.matchCount
          } event${matchGroup.matchCount === 1 ? "" : "s"})`,
          vendorName: "OneUptime",
          productName: THREAT_INTEL_PRODUCT_NAME,
          // Provenance columns carry the STIX identity, not a rule id.
          ruleId: matchGroup.stixId,
          ruleName: matchGroup.indicatorName || feed.name || "",
          mitreTactics: [],
          mitreTechniques: [],
          principalUser: "",
          principalHost: "",
          principalIp: "",
          principalProcess: "",
          processName: "",
          processPath: "",
          processCommandLine: "",
          parentProcessName: "",
          parentProcessPath: "",
          parentProcessCommandLine: "",
          targetUser: "",
          targetHost: "",
          targetIp: "",
          targetPort: 0,
          targetResource: "",
          observables: [
            matchGroup.indicatorValue,
            ...matchGroup.sampleObservables.filter(
              (observable: string): boolean => {
                return observable.toLowerCase() !== matchGroup.indicatorValue;
              },
            ),
          ],
          attributes: {
            [THREAT_FEED_ID_ATTRIBUTE]: feed.id!.toString(),
            [THREAT_FEED_NAME_ATTRIBUTE]: feed.name || "",
            [THREAT_INDICATOR_ID_ATTRIBUTE]: matchGroup.stixId,
            [THREAT_INDICATOR_TYPE_ATTRIBUTE]: matchGroup.indicatorType,
            [THREAT_INDICATOR_VALUE_ATTRIBUTE]: matchGroup.indicatorValue,
            [THREAT_CONFIDENCE_ATTRIBUTE]: String(matchGroup.confidence),
            [THREAT_MATCH_COUNT_ATTRIBUTE]: String(matchGroup.matchCount),
          },
        };

        return buildSecurityEventDbRow({
          normalized,
          projectId,
          serviceMetadata,
          retentionDays,
        });
      },
    );

    for (
      let index: number = 0;
      index < rows.length;
      index += THREAT_INTEL_FINDING_INSERT_BATCH_SIZE
    ) {
      await SecurityEventService.insertJsonRows(
        rows.slice(index, index + THREAT_INTEL_FINDING_INSERT_BATCH_SIZE),
      );
    }

    return eventUids;
  }

  private static buildAlertableMatch(data: {
    feed: ThreatIntelFeed;
    matchGroup: IndicatorMatchGroup;
    startTime: Date;
    endTime: Date;
  }): AlertableMatch {
    const { feed, matchGroup } = data;

    return {
      fingerprint: this.buildFingerprint(feed.id!, matchGroup.indicatorValue),
      title: `[Threat Intel] ${feed.name} — ${matchGroup.indicatorValue}`,
      description: this.buildMatchDescription(data),
      rootCause:
        mdText`Threat intel feed "${feed.name}" indicator matched security events.`.toString(),
    };
  }

  private static buildMatchDescription(data: {
    feed: ThreatIntelFeed;
    matchGroup: IndicatorMatchGroup;
    startTime: Date;
    endTime: Date;
  }): string {
    const { matchGroup } = data;
    const descriptionParts: Array<string> = [];

    if (matchGroup.indicatorName) {
      descriptionParts.push(matchGroup.indicatorName);
    }

    descriptionParts.push(
      `Indicator ${matchGroup.indicatorValue} (${matchGroup.indicatorType}${
        matchGroup.confidence > 0 ? `, confidence ${matchGroup.confidence}` : ""
      }) matched ${matchGroup.matchCount} security event${
        matchGroup.matchCount === 1 ? "" : "s"
      } between ${OneUptimeDate.getDateAsFormattedString(
        data.startTime,
      )} and ${OneUptimeDate.getDateAsFormattedString(data.endTime)}.`,
    );

    if (isStixIndicatorId(matchGroup.stixId)) {
      descriptionParts.push(`STIX indicator: ${matchGroup.stixId}`);
    }

    if (matchGroup.sampleMessage) {
      descriptionParts.push(`Sample event: ${matchGroup.sampleMessage}`);
    }

    if (matchGroup.sampleObservables.length > 0) {
      descriptionParts.push(
        `Observables: ${matchGroup.sampleObservables.slice(0, 20).join(", ")}`,
      );
    }

    return descriptionParts.join("\n\n");
  }

  private static partitionBySeverity(
    matchedGroups: Array<IndicatorMatchGroup>,
  ): Map<OcsfSeverity, Array<IndicatorMatchGroup>> {
    const partitions: Map<OcsfSeverity, Array<IndicatorMatchGroup>> = new Map<
      OcsfSeverity,
      Array<IndicatorMatchGroup>
    >();

    for (const matchGroup of matchedGroups) {
      const severity: OcsfSeverity = ocsfSeverityForConfidence(
        matchGroup.confidence,
      );

      const existing: Array<IndicatorMatchGroup> | undefined =
        partitions.get(severity);

      if (existing) {
        existing.push(matchGroup);
      } else {
        partitions.set(severity, [matchGroup]);
      }
    }

    return partitions;
  }

  private static isSevereSeverity(severity: OcsfSeverity): boolean {
    return severity === OcsfSeverity.Critical || severity === OcsfSeverity.High;
  }

  private static buildFingerprint(
    feedId: ObjectID,
    indicatorValue: string,
  ): string {
    return `threat-intel:${feedId.toString()}:${MetricSeriesFingerprint.computeFingerprint(
      {
        indicatorValue: indicatorValue || "",
      },
    )}`;
  }
}
