import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataSecurityIssueFeedService from "../../Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import logger from "../Logger";
import {
  Gray500,
  Green500,
  Orange500,
  Red500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import {
  DataSecurityCheckStatus,
  EvaluatedCheck,
  FrameworkRequirementRef,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  getRiskScore,
  moreSevere,
  RiskScore,
} from "../../../Types/DataSecurity/DataSecurityRisk";
import { DataStoreExposure } from "../../../Types/DataSecurity/DataStorePosture";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { ClosedDataSecurityIssue } from "./DataSecurityIssueAlerts";

/*
 * KEEPING A STORE'S ISSUES IN STEP WITH ITS CHECKS.
 *
 * Every evaluation runs every check on a store (DataSecurityCheckCatalog);
 * this turns the results into issue rows, one per store and check:
 *
 *  - A failing check with a severity opens an issue, or updates the open
 *    one; a resolved issue whose check fails again opens again, and so
 *    does an accepted one whose acceptance has run out.
 *  - A passing check - or one that no longer applies, or was turned off -
 *    resolves its open or accepted issue.
 *  - A check that cannot tell (Unknown: a permission missing, a read
 *    failed) leaves its issue as it is: nobody may conclude a problem is
 *    fixed because OneUptime could not look.
 *  - "Not an issue" is a person's verdict and stays.
 *
 * What changes is written to the issue's timeline. Unchanged issues are
 * touched only to note the check still fails, and at most hourly, so an
 * evaluation every few minutes does not flood workflows and the audit log.
 */

// How stale an open issue's lastDetectedAt may get before it is refreshed.
const LAST_DETECTED_REFRESH_IN_MINUTES: number = 60;

// The most issues a store has: one per check, and the catalog has 32.
const MAX_ISSUES_PER_STORE: number = 100;

export interface ReconcileStoreInput {
  projectId: ObjectID;
  dataStoreId: ObjectID;
  exposure: DataStoreExposure;
  estimatedRecords?: number | null | undefined;
  isProduction: boolean;
  hasRecentSecurityActivity: boolean;
  dataTypeIds: Array<string>;
  checks: Array<EvaluatedCheck>;
  existingIssues: Array<DataSecurityIssue>;
  now?: Date | undefined;
}

export interface ReconciledIssue {
  issueId: ObjectID;
  checkId: string;
  title: string;
  severity: SecuritySeverity;
  riskScore: number;
}

export interface ReconcileStoreOutput {
  // Issues that opened, or opened again, in this evaluation.
  opened: Array<ReconciledIssue>;
  // Issues it resolved, and why: their alerts are resolved with them.
  closed: Array<ClosedDataSecurityIssue>;
  resolvedCount: number;
  openIssueCount: number;
  highestSeverity: SecuritySeverity | null;
  highestRiskScore: number;
}

export function getIssueKey(dataStoreId: ObjectID, checkId: string): string {
  return `${dataStoreId.toString()}|${checkId}`;
}

function severityColor(severity: SecuritySeverity): Color {
  return severity === SecuritySeverity.Critical ||
    severity === SecuritySeverity.High
    ? Red500
    : Orange500;
}

function frameworksJson(
  requirements: ReadonlyArray<FrameworkRequirementRef>,
): JSONArray {
  return requirements.map((ref: FrameworkRequirementRef): JSONObject => {
    return { framework: ref.framework, requirement: ref.requirement };
  });
}

export default class DataSecurityIssueReconciler {
  public static async reconcileStore(
    input: ReconcileStoreInput,
  ): Promise<ReconcileStoreOutput> {
    const now: Date = input.now || OneUptimeDate.getCurrentDate();
    const byCheck: Map<string, DataSecurityIssue> = new Map();

    for (const issue of input.existingIssues) {
      if (issue.checkId) {
        byCheck.set(issue.checkId, issue);
      }
    }

    const output: ReconcileStoreOutput = {
      opened: [],
      closed: [],
      resolvedCount: 0,
      openIssueCount: 0,
      highestSeverity: null,
      highestRiskScore: 0,
    };

    const evaluatedCheckIds: Set<string> = new Set();

    for (const evaluated of input.checks) {
      evaluatedCheckIds.add(evaluated.check.id);

      const issue: DataSecurityIssue | undefined = byCheck.get(
        evaluated.check.id,
      );

      try {
        if (
          evaluated.result.status === DataSecurityCheckStatus.Fail &&
          evaluated.severity
        ) {
          await this.whenFailing({
            input,
            evaluated,
            severity: evaluated.severity,
            issue,
            now,
            output,
          });
        } else if (
          evaluated.result.status === DataSecurityCheckStatus.Unknown
        ) {
          // Cannot tell: an open issue stays open and counts.
          if (issue && issue.status === DataSecurityIssueStatus.Open) {
            this.count(output, issue.severity, issue.riskScore || 0);
          }
        } else if (issue) {
          await this.resolve(input.projectId, issue, now, output, false);
        }
      } catch (error) {
        logger.error(
          `DataSecurity: could not reconcile check ${evaluated.check.id} of store ${input.dataStoreId.toString()}:`,
        );
        logger.error(error);
      }
    }

    // Issues of checks that no longer run on this store: off, or not applicable.
    for (const [checkId, issue] of byCheck) {
      if (!evaluatedCheckIds.has(checkId)) {
        try {
          await this.resolve(input.projectId, issue, now, output, true);
        } catch (error) {
          logger.error(
            `DataSecurity: could not resolve the issue of check ${checkId} of store ${input.dataStoreId.toString()}:`,
          );
          logger.error(error);
        }
      }
    }

    return output;
  }

  private static count(
    output: ReconcileStoreOutput,
    severity: SecuritySeverity | undefined,
    riskScore: number,
  ): void {
    output.openIssueCount++;
    output.highestSeverity = moreSevere(output.highestSeverity, severity);
    output.highestRiskScore = Math.max(output.highestRiskScore, riskScore);
  }

  private static async whenFailing(data: {
    input: ReconcileStoreInput;
    evaluated: EvaluatedCheck;
    severity: SecuritySeverity;
    issue: DataSecurityIssue | undefined;
    now: Date;
    output: ReconcileStoreOutput;
  }): Promise<void> {
    const { input, evaluated, severity, issue, now, output } = data;
    const risk: RiskScore = getRiskScore({
      severity,
      exposure: input.exposure,
      estimatedRecords: input.estimatedRecords,
      hasRecentSecurityActivity: input.hasRecentSecurityActivity,
      isProduction: input.isProduction,
    });
    const evidence: string = (evaluated.result.evidence || "").slice(0, 500);
    const riskFactors: JSONArray = risk.factors as unknown as JSONArray;

    if (!issue) {
      const created: DataSecurityIssue = new DataSecurityIssue();
      created.projectId = input.projectId;
      created.dataStoreId = input.dataStoreId;
      created.issueKey = getIssueKey(input.dataStoreId, evaluated.check.id);
      created.checkId = evaluated.check.id;
      created.checkGroup = evaluated.check.group;
      created.title = evaluated.check.title;
      created.evidence = evidence;
      created.severity = severity;
      created.riskScore = risk.score;
      created.riskFactors = riskFactors;
      created.status = DataSecurityIssueStatus.Open;
      created.dataTypeIds = input.dataTypeIds.slice(0, 50);
      created.frameworks = frameworksJson(evaluated.check.requirements);
      created.firstDetectedAt = now;
      created.lastDetectedAt = now;

      const saved: DataSecurityIssue = await DataSecurityIssueService.create({
        data: created,
        props: { isRoot: true },
      });

      if (saved.id) {
        await this.feed(input.projectId, saved.id, {
          eventType: DataSecurityIssueFeedEventType.IssueOpened,
          color: severityColor(severity),
          markdown:
            mdText`**${severity}** issue opened: ${evaluated.check.title}. ${evidence}`.toString(),
        });

        output.opened.push({
          issueId: saved.id,
          checkId: evaluated.check.id,
          title: evaluated.check.title,
          severity,
          riskScore: risk.score,
        });
      }

      this.count(output, severity, risk.score);
      return;
    }

    if (!issue.id) {
      return;
    }

    if (issue.status === DataSecurityIssueStatus.NotAnIssue) {
      // A person's verdict stands; note only that the check still fails.
      await this.touch(issue, now);
      return;
    }

    const acceptanceExpired: boolean =
      issue.status === DataSecurityIssueStatus.Accepted &&
      Boolean(issue.acceptedUntil) &&
      issue.acceptedUntil!.getTime() <= now.getTime();

    if (
      issue.status === DataSecurityIssueStatus.Resolved ||
      acceptanceExpired
    ) {
      await DataSecurityIssueService.updateOneById({
        id: issue.id,
        data: {
          status: DataSecurityIssueStatus.Open,
          severity,
          riskScore: risk.score,
          riskFactors,
          evidence,
          lastDetectedAt: now,
          resolvedAt: null,
          acceptedReason: null,
          acceptedUntil: null,
          reopenCount: (issue.reopenCount || 0) + 1,
        } as never,
        props: { isRoot: true },
      });

      await this.feed(input.projectId, issue.id, {
        eventType: acceptanceExpired
          ? DataSecurityIssueFeedEventType.AcceptanceExpired
          : DataSecurityIssueFeedEventType.Reopened,
        color: severityColor(severity),
        markdown: (acceptanceExpired
          ? mdText`The accepted risk expired and the check still fails, so the issue is open again.`
          : mdText`The check failed again after the issue was resolved, so it is open again. ${evidence}`
        ).toString(),
      });

      output.opened.push({
        issueId: issue.id,
        checkId: evaluated.check.id,
        title: evaluated.check.title,
        severity,
        riskScore: risk.score,
      });
      this.count(output, severity, risk.score);
      return;
    }

    if (issue.status === DataSecurityIssueStatus.Accepted) {
      await this.touch(issue, now);
      return;
    }

    // Open, and still failing: change what changed.
    const severityChanged: boolean = issue.severity !== severity;
    const changed: boolean =
      severityChanged ||
      issue.riskScore !== risk.score ||
      (issue.evidence || "") !== evidence;

    if (changed) {
      await DataSecurityIssueService.updateOneById({
        id: issue.id,
        data: {
          severity,
          riskScore: risk.score,
          riskFactors,
          evidence,
          lastDetectedAt: now,
          dataTypeIds: input.dataTypeIds.slice(0, 50),
        } as never,
        props: { isRoot: true },
      });

      if (severityChanged) {
        await this.feed(input.projectId, issue.id, {
          eventType: DataSecurityIssueFeedEventType.SeverityChanged,
          color: severityColor(severity),
          markdown:
            mdText`Severity changed from **${issue.severity || "none"}** to **${severity}**, as the store's data or exposure changed.`.toString(),
        });
      }
    } else {
      await this.touch(issue, now);
    }

    this.count(output, severity, risk.score);
  }

  private static async touch(
    issue: DataSecurityIssue,
    now: Date,
  ): Promise<void> {
    if (
      !issue.id ||
      (issue.lastDetectedAt &&
        now.getTime() - issue.lastDetectedAt.getTime() <
          LAST_DETECTED_REFRESH_IN_MINUTES * 60 * 1000)
    ) {
      return;
    }

    await DataSecurityIssueService.updateColumnsByIdWithoutHooks({
      id: issue.id,
      data: { lastDetectedAt: now },
    });
  }

  private static async resolve(
    projectId: ObjectID,
    issue: DataSecurityIssue,
    now: Date,
    output: ReconcileStoreOutput,
    checkGone: boolean,
  ): Promise<void> {
    if (
      !issue.id ||
      (issue.status !== DataSecurityIssueStatus.Open &&
        issue.status !== DataSecurityIssueStatus.Accepted)
    ) {
      return;
    }

    await DataSecurityIssueService.updateOneById({
      id: issue.id,
      data: {
        status: DataSecurityIssueStatus.Resolved,
        resolvedAt: now,
        acceptedReason: null,
        acceptedUntil: null,
      } as never,
      props: { isRoot: true },
    });

    await this.feed(projectId, issue.id, {
      eventType: DataSecurityIssueFeedEventType.Resolved,
      color: checkGone ? Gray500 : Green500,
      markdown: (checkGone
        ? mdText`Resolved: the check no longer runs on this store - it was turned off, or no longer applies.`
        : mdText`Resolved: the check passes now.`
      ).toString(),
    });

    output.closed.push({
      issueId: issue.id,
      why: checkGone
        ? "its check no longer runs on the store"
        : "its check passes now",
    });
    output.resolvedCount++;
  }

  /*
   * A store discovery no longer finds is archived, and its open issues are
   * resolved with it: the exposure of a store that is gone is no exposure,
   * and its alert should page nobody. An accepted risk and a person's Not
   * an issue stay as they are. If the store comes back, its next
   * evaluation opens again each issue whose check still fails.
   */
  public static async resolveIssuesOfArchivedStore(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    now?: Date | undefined;
  }): Promise<Array<ClosedDataSecurityIssue>> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          dataStoreId: data.dataStoreId,
          status: new Includes([DataSecurityIssueStatus.Open]),
        },
        select: { _id: true },
        skip: 0,
        limit: MAX_ISSUES_PER_STORE,
        props: { isRoot: true },
      });
    const closed: Array<ClosedDataSecurityIssue> = [];

    for (const issue of issues) {
      if (!issue.id) {
        continue;
      }

      try {
        await DataSecurityIssueService.updateOneById({
          id: issue.id,
          data: {
            status: DataSecurityIssueStatus.Resolved,
            resolvedAt: now,
          } as never,
          props: { isRoot: true },
        });

        await this.feed(data.projectId, issue.id, {
          eventType: DataSecurityIssueFeedEventType.Resolved,
          color: Gray500,
          markdown:
            mdText`Resolved: the store was archived, as its source no longer lists it. The issue opens again if the store comes back and its check still fails.`.toString(),
        });

        closed.push({ issueId: issue.id, why: "its store was archived" });
      } catch (error) {
        logger.error(
          `DataSecurity: could not resolve issue ${issue.id.toString()} of archived store ${data.dataStoreId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return closed;
  }

  private static async feed(
    projectId: ObjectID,
    issueId: ObjectID,
    data: {
      eventType: DataSecurityIssueFeedEventType;
      color: Color;
      markdown: string;
    },
  ): Promise<void> {
    await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
      projectId,
      dataSecurityIssueId: issueId,
      eventType: data.eventType,
      displayColor: data.color,
      feedInfoInMarkdown: data.markdown,
    });
  }
}
