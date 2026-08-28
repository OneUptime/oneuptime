import ThreatIntelFeed from "../../../../Models/DatabaseModels/ThreatIntelFeed";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
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
  THREAT_INTEL_PRODUCT_NAME,
  THREAT_INTEL_SERVICE_NAME,
  THREAT_MATCH_COUNT_ATTRIBUTE,
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
 * This scheduled lane is what catches intel that arrives AFTER the
 * events did: the ingest-time enricher can only stamp what is already
 * known, but the matcher re-joins every window against the freshest
 * indicator set.
 */

// Cap on one evaluation's scan, whatever lastEvaluatedAt says.
const MAX_LOOKBACK_IN_MINUTES: number = 24 * 60;

// First-ever evaluation window for a feed.
const DEFAULT_WINDOW_IN_MINUTES: number = 15;

// One alert per distinct indicator value per cycle, at most.
export const MAX_GROUPS_PER_EVALUATION: number = 100;

export interface ThreatIntelMatchResult {
  feedId: string;
  matchedIndicators: number;
  totalMatches: number;
  alertsCreated: number;
  incidentsCreated: number;
  findingsWritten: number;
}

export default class ThreatIntelMatcher {
  @CaptureSpan()
  public static async evaluateAllDueFeeds(): Promise<void> {
    const feeds: Array<ThreatIntelFeed> = await ThreatIntelFeedService.findBy({
      query: {
        isEnabled: true,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        shouldCreateAlert: true,
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: true,
        alertSeverityId: true,
        incidentSeverityId: true,
        lastEvaluatedAt: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const feed of feeds) {
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
      -MAX_LOOKBACK_IN_MINUTES,
    );

    let startTime: Date = feed.lastEvaluatedAt
      ? feed.lastEvaluatedAt
      : OneUptimeDate.addRemoveMinutes(endTime, -DEFAULT_WINDOW_IN_MINUTES);

    if (OneUptimeDate.isBefore(startTime, earliestAllowed)) {
      startTime = earliestAllowed;
    }

    const matchedGroups: Array<IndicatorMatchGroup> =
      await ThreatIntelIndicatorService.findIndicatorMatches({
        projectId: feed.projectId,
        feedId: feed.id,
        startTime,
        endTime,
        maxGroups: MAX_GROUPS_PER_EVALUATION,
      });

    const result: ThreatIntelMatchResult = {
      feedId: feed.id.toString(),
      matchedIndicators: matchedGroups.length,
      totalMatches: 0,
      alertsCreated: 0,
      incidentsCreated: 0,
      findingsWritten: 0,
    };

    for (const matchGroup of matchedGroups) {
      result.totalMatches += matchGroup.matchCount;
    }

    if (matchedGroups.length > 0) {
      if (feed.shouldCreateAlert !== false) {
        result.alertsCreated = await this.openAlertsForMatches({
          feed,
          matchedGroups,
          startTime,
          endTime,
        });
      }

      // === true, not !== false — the DetectionRule incident gate.
      if (feed.shouldCreateIncident === true) {
        result.incidentsCreated = await this.openIncidentsForMatches({
          feed,
          matchedGroups,
          startTime,
          endTime,
        });
      }

      if (feed.shouldWriteDetectionFinding !== false) {
        result.findingsWritten = await this.writeThreatIntelFindings({
          feed,
          matchedGroups,
        });
      }
    }

    await ThreatIntelFeedService.updateOneById({
      id: feed.id,
      data: {
        lastEvaluatedAt: endTime,
        lastMatchError: null as unknown as string,
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

  private static async writeThreatIntelFindings(data: {
    feed: ThreatIntelFeed;
    matchedGroups: Array<IndicatorMatchGroup>;
  }): Promise<number> {
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

    const rows: Array<JSONObject> = matchedGroups.map(
      (matchGroup: IndicatorMatchGroup): JSONObject => {
        const severityName: OcsfSeverity = ocsfSeverityForConfidence(
          matchGroup.confidence,
        );

        const normalized: NormalizedSecurityEvent = {
          time: OneUptimeDate.getCurrentDate(),
          eventUid: `threat-intel:${feed.id!.toString()}:${this.buildFingerprint(
            feed.id!,
            matchGroup.indicatorValue,
          )}:${OneUptimeDate.getCurrentDateAsUnixNano()}`,
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

    await SecurityEventService.insertJsonRows(rows);

    return rows.length;
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
      rootCause: `Threat intel feed "${feed.name}" indicator matched security events.`,
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

    if (matchGroup.stixId) {
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
