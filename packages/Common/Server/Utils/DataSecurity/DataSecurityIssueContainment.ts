import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import {
  DataSecurityIssueContainment,
  DataSecurityIssueContainmentRule,
  ISSUE_CONTAINMENT_DAYS,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  FINDING_FRESHNESS_IN_DAYS,
  getTelemetryCheckIdOfDataType,
  isContainedTelemetryFinding,
  isTelemetryFindingCheck,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueResolution, {
  DataSecurityIssueResolutionDetails,
  DataSecurityIssueResolutionRule,
  readDataSecurityIssueResolutionDetails,
} from "../../../Types/DataSecurity/DataSecurityIssueResolution";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import DataStoreService from "../../Services/DataStoreService";
import LogScrubRuleService from "../../Services/LogScrubRuleService";
import ScrubRuleValueCountService, {
  ScrubRuleValueCountRow,
} from "../../Services/ScrubRuleValueCountService";
import TraceScrubRuleService from "../../Services/TraceScrubRuleService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import { getTelemetryStoreOwnerId } from "./Telemetry/TelemetryFindingOccurrences";
import {
  CoveringScrubRule,
  findCoveringScrubRule,
  getScrubCoverage,
  ScrubCoverage,
} from "./Telemetry/TelemetryScrubCoverage";

/*
 * WHAT HIDES A TELEMETRY ISSUE'S DATA AT INGEST, AND WHETHER THE CODE STILL
 * WRITES IT (#10368).
 *
 * A leak contained at ingest is not fixed: a scrub rule hides the data
 * before OneUptime stores it, but the code still writes it - to stdout and
 * to every other place the service sends telemetry. The issue's page says
 * so with what proves it: each rule that hides the issue's data, and how
 * many values it changed in the issue's service in the last week, from
 * #10366's counter (ScrubRuleValueCount). After a verified code fix, the
 * rules that contained it are kept as defence in depth, and the page says
 * what they changed since - nothing, while the fix holds - beside the
 * offer to remove them.
 *
 * Read as the server once the caller's own read of the issue found it (an
 * issue they may not read is not found). Names and counts only: never a
 * value.
 */

const ROOT: { isRoot: true } = { isRoot: true };

// The most findings of a store read for what contains them.
const MAX_FINDINGS_READ: number = 200;

// What the counter says of one rule in one service.
interface RuleCounts {
  valuesChanged: number;
  lastChangedAt: Date | null;
  lastChangedVersion: string;
}

export function foldRuleCounts(data: {
  rows: ReadonlyArray<ScrubRuleValueCountRow>;
  serviceId: string;
}): Map<string, RuleCounts> {
  const byRule: Map<string, RuleCounts> = new Map<string, RuleCounts>();
  const serviceId: string = data.serviceId.toLowerCase();

  for (const row of data.rows) {
    if (row.serviceId.toLowerCase() !== serviceId || row.valueCount <= 0) {
      continue;
    }

    const counts: RuleCounts = byRule.get(row.scrubRuleId) || {
      valuesChanged: 0,
      lastChangedAt: null,
      lastChangedVersion: "",
    };

    counts.valuesChanged += row.valueCount;

    if (
      row.lastChangedAt &&
      (!counts.lastChangedAt ||
        row.lastChangedAt.getTime() > counts.lastChangedAt.getTime())
    ) {
      counts.lastChangedAt = row.lastChangedAt;
      counts.lastChangedVersion = row.serviceVersion;
    }

    byRule.set(row.scrubRuleId, counts);
  }

  return byRule;
}

export default class DataSecurityIssueContainmentReader {
  public static async read(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<DataSecurityIssueContainment | null> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    // The caller's own read first: an issue they may not read is not found.
    const readable: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: { _id: true },
        props: data.props,
      });

    if (!readable?.id) {
      return null;
    }

    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: {
          _id: true,
          checkId: true,
          dataStoreId: true,
          resolution: true,
          resolutionDetails: true,
        },
        props: ROOT,
      });

    if (!issue?.dataStoreId || !isTelemetryFindingCheck(issue.checkId)) {
      return null;
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: issue.dataStoreId, projectId: data.projectId },
      select: { _id: true, kind: true, serviceId: true, storeKey: true },
      props: ROOT,
    });
    const serviceId: string | null = store
      ? getTelemetryStoreOwnerId(store)
      : null;

    if (!store || !serviceId) {
      return null;
    }

    const details: DataSecurityIssueResolutionDetails =
      readDataSecurityIssueResolutionDetails(issue.resolutionDetails);
    const isFixedInCode: boolean =
      issue.resolution === DataSecurityIssueResolution.FixedInCode;
    const findings: Array<DataStoreFinding> =
      await DataStoreFindingService.findBy({
        query: {
          projectId: data.projectId,
          dataStoreId: store.id!,
          isSuppressed: false,
          isScrubbed: true,
          lastSeenAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveDurationInDays(
              now,
              -FINDING_FRESHNESS_IN_DAYS,
            ),
          ),
        },
        select: {
          _id: true,
          dataTypeId: true,
          location: true,
          confidence: true,
          matchCount: true,
          isConfirmed: true,
          isAiSuggested: true,
          isScrubbed: true,
          fixedAt: true,
        },
        skip: 0,
        limit: MAX_FINDINGS_READ,
        props: ROOT,
      });
    const contained: Array<DataStoreFinding> = findings.filter(
      (finding: DataStoreFinding): boolean => {
        return (
          isContainedTelemetryFinding(finding) &&
          getTelemetryCheckIdOfDataType(finding.dataTypeId || "") ===
            issue.checkId
        );
      },
    );
    const rules: Map<string, DataSecurityIssueContainmentRule> = new Map();

    if (contained.length > 0) {
      const coverage: ScrubCoverage = await getScrubCoverage(data.projectId);

      for (const finding of contained) {
        const rule: CoveringScrubRule | null = findCoveringScrubRule(
          coverage,
          {
            kind: store.kind as DataStoreKind,
            dataTypeId: finding.dataTypeId || "",
            location: finding.location || "",
            serviceId,
          },
        );

        if (rule && !rules.has(rule.id)) {
          rules.set(rule.id, {
            id: rule.id,
            signal: rule.signal,
            name: rule.name,
            valuesChanged: null,
            isKept: false,
          });
        }
      }
    }

    // After a verified code fix: the rules that contained it, kept, while they still exist.
    if (isFixedInCode) {
      for (const kept of await DataSecurityIssueContainmentReader.readExistingRules({
        projectId: data.projectId,
        rules: details.scrubRules || [],
      })) {
        rules.set(kept.id, {
          ...(rules.get(kept.id) || {
            id: kept.id,
            signal: kept.signal,
            name: kept.name,
            valuesChanged: null,
          }),
          isKept: true,
        });
      }
    }

    await DataSecurityIssueContainmentReader.count({
      projectId: data.projectId,
      serviceId,
      rules: Array.from(rules.values()),
      since: OneUptimeDate.addRemoveDurationInDays(now, -ISSUE_CONTAINMENT_DAYS),
      fixedAt: isFixedInCode && details.at ? new Date(details.at) : null,
    });

    return {
      days: ISSUE_CONTAINMENT_DAYS,
      containedFindingCount: contained.length,
      rules: Array.from(rules.values()),
    };
  }

  // The kept rules that still exist, as they are named now.
  private static async readExistingRules(data: {
    projectId: ObjectID;
    rules: ReadonlyArray<DataSecurityIssueResolutionRule>;
  }): Promise<Array<DataSecurityIssueResolutionRule>> {
    const ids: Array<string> = data.rules.map(
      (rule: DataSecurityIssueResolutionRule): string => {
        return rule.id;
      },
    );

    if (ids.length === 0) {
      return [];
    }

    const query: never = {
      projectId: data.projectId,
      _id: new Includes(ids),
    } as never;
    const [logRules, traceRules]: [Array<LogScrubRule>, Array<TraceScrubRule>] =
      await Promise.all([
        LogScrubRuleService.findBy({
          query,
          select: { _id: true, name: true },
          skip: 0,
          limit: LIMIT_MAX,
          props: ROOT,
        }),
        TraceScrubRuleService.findBy({
          query,
          select: { _id: true, name: true },
          skip: 0,
          limit: LIMIT_MAX,
          props: ROOT,
        }),
      ]);

    return [
      ...logRules.map((rule: LogScrubRule): DataSecurityIssueResolutionRule => {
        return { id: rule.id!.toString(), signal: "log", name: rule.name || "" };
      }),
      ...traceRules.map(
        (rule: TraceScrubRule): DataSecurityIssueResolutionRule => {
          return {
            id: rule.id!.toString(),
            signal: "trace",
            name: rule.name || "",
          };
        },
      ),
    ];
  }

  /*
   * What each log and trace rule changed in the service, from the counter:
   * in the last days, and since the fix. A count that cannot be read is
   * none told (null), never zero.
   */
  private static async count(data: {
    projectId: ObjectID;
    serviceId: string;
    rules: Array<DataSecurityIssueContainmentRule>;
    since: Date;
    fixedAt: Date | null;
  }): Promise<void> {
    const counted: Array<DataSecurityIssueContainmentRule> = data.rules.filter(
      (rule: DataSecurityIssueContainmentRule): boolean => {
        return rule.signal === "log" || rule.signal === "trace";
      },
    );

    if (counted.length === 0) {
      return;
    }

    const since: Date =
      data.fixedAt && data.fixedAt.getTime() < data.since.getTime()
        ? data.fixedAt
        : data.since;

    try {
      const rows: Array<ScrubRuleValueCountRow> =
        await ScrubRuleValueCountService.readValueCounts({
          projectId: data.projectId,
          scrubRuleIds: counted.map(
            (rule: DataSecurityIssueContainmentRule): string => {
              return rule.id;
            },
          ),
          since,
          byHour: true,
        });
      const lately: Map<string, RuleCounts> = foldRuleCounts({
        rows: rows.filter((row: ScrubRuleValueCountRow): boolean => {
          return Boolean(row.hour && row.hour.getTime() >= data.since.getTime());
        }),
        serviceId: data.serviceId,
      });
      const sinceFix: Map<string, RuleCounts> | null = data.fixedAt
        ? foldRuleCounts({
            rows: rows.filter((row: ScrubRuleValueCountRow): boolean => {
              return Boolean(
                row.lastChangedAt &&
                  row.lastChangedAt.getTime() >= data.fixedAt!.getTime(),
              );
            }),
            serviceId: data.serviceId,
          })
        : null;

      for (const rule of counted) {
        const counts: RuleCounts | undefined = lately.get(
          rule.id.toLowerCase(),
        );

        rule.valuesChanged = counts?.valuesChanged || 0;

        if (counts?.lastChangedAt) {
          rule.lastChangedAt = counts.lastChangedAt.toISOString();

          if (counts.lastChangedVersion) {
            rule.lastChangedVersion = counts.lastChangedVersion;
          }
        }

        if (sinceFix && rule.isKept) {
          rule.valuesChangedSinceFix =
            sinceFix.get(rule.id.toLowerCase())?.valuesChanged || 0;
        }
      }
    } catch (error) {
      logger.warn(
        `DataSecurity: could not read what the scrub rules of project ${data.projectId.toString()} changed, for an issue's containment: ${error}`,
      );
    }
  }
}
