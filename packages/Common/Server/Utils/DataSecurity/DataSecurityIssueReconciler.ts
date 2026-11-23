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
  Yellow500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataSecurityIssueResolution, {
  DataSecurityIssuePendingResolution,
  DataSecurityIssueResolutionDetails,
  isPendingResolutionCurrent,
  isVerifiedFixResolution,
  readDataSecurityIssuePendingResolution,
  readDataSecurityIssueResolutionDetails,
  toResolutionDetailsJSON,
} from "../../../Types/DataSecurity/DataSecurityIssueResolution";
import { MarkdownText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  describePullRequest,
  describeRegression,
} from "./DataSecurityIssueResolutions";
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
import DataSecurityAiProposals from "../AI/DataSecurity/DataSecurityAiProposals";

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
 * A resolved issue says how it resolved (DataSecurityIssue.resolution,
 * #10368): its check passes; a response action changed the store and its
 * check passed after (Fixed from here); a telemetry issue's every finding
 * is hidden by a scrub rule (Contained at ingest - not fixed: the code
 * still writes the data); its check no longer runs; its store is gone.
 * Fixes OneUptime followed to production say so themselves
 * (DataSecurityIssueResolutions). An issue that opens again forgets how it
 * resolved - but a leak that came back after a verified code fix keeps
 * which version brought it back, opens again even while a scrub rule
 * hides it, and stays open until it is fixed again or a person decides.
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
  /*
   * The telemetry checks of the store whose data a scrub rule hides at
   * ingest (isContainedTelemetryFinding, #10368): one of them passing
   * resolves its issue as contained, never as fixed.
   */
  containedCheckIds?: ReadonlySet<string> | undefined;
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

// Why an issue is no longer open, finishing "the issue is no longer open: ...".
const RESOLVED_WHY: Record<
  | DataSecurityIssueResolution.CheckPassed
  | DataSecurityIssueResolution.ContainedAtIngest
  | DataSecurityIssueResolution.FixedFromHere
  | DataSecurityIssueResolution.NoLongerChecked,
  string
> = {
  [DataSecurityIssueResolution.CheckPassed]: "its check passes now",
  [DataSecurityIssueResolution.ContainedAtIngest]:
    "a scrub rule hides its data at ingest, though the code still writes it",
  [DataSecurityIssueResolution.FixedFromHere]:
    "it was fixed from here, and its check passes now",
  [DataSecurityIssueResolution.NoLongerChecked]:
    "its check no longer runs on the store",
};

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
          await this.whenPassing({
            input,
            issue,
            now,
            output,
            isContained: Boolean(
              input.containedCheckIds?.has(evaluated.check.id),
            ),
          });
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
          await this.resolve({
            projectId: input.projectId,
            issue,
            now,
            output,
            resolution: DataSecurityIssueResolution.NoLongerChecked,
          });
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
      await this.reopen({
        projectId: input.projectId,
        issue,
        checkId: evaluated.check.id,
        title: evaluated.check.title,
        severity,
        riskScore: risk.score,
        riskFactors,
        evidence,
        now,
        output,
        markdown: acceptanceExpired
          ? mdText`The accepted risk expired and the check still fails, so the issue is open again.`
          : this.getReopenedLine(issue, evidence),
        eventType: acceptanceExpired
          ? DataSecurityIssueFeedEventType.AcceptanceExpired
          : DataSecurityIssueFeedEventType.Reopened,
      });
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

  /*
   * A passing check (or one that no longer applies): an open or accepted
   * issue resolves, saying how. A leak that came back after a verified fix
   * is the exception: marked so by its fix's watch, it opens again even
   * while a scrub rule hides it, and a rule hiding it never closes it.
   */
  private static async whenPassing(data: {
    input: ReconcileStoreInput;
    issue: DataSecurityIssue;
    now: Date;
    output: ReconcileStoreOutput;
    isContained: boolean;
  }): Promise<void> {
    const { input, issue, now, output, isContained } = data;
    const details: DataSecurityIssueResolutionDetails =
      readDataSecurityIssueResolutionDetails(issue.resolutionDetails);

    if (!issue.id) {
      return;
    }

    if (issue.status === DataSecurityIssueStatus.Resolved) {
      if (details.regression) {
        const severity: SecuritySeverity =
          issue.severity || SecuritySeverity.Medium;

        await this.reopen({
          projectId: input.projectId,
          issue,
          checkId: issue.checkId || "",
          title: issue.title || "",
          severity,
          riskScore: issue.riskScore || 0,
          now,
          output,
          markdown: isContained
            ? mdText`Opened again. ${describeRegression(details.regression)} The scrub rule kept after the fix hides it at ingest, so nothing new is stored, but the code writes it again.`
            : mdText`Opened again. ${describeRegression(details.regression)}`,
          eventType: DataSecurityIssueFeedEventType.FixRegressed,
        });
      }

      return;
    }

    if (
      issue.status === DataSecurityIssueStatus.Open &&
      details.regression &&
      isContained
    ) {
      // Came back, and only hidden at ingest: open until fixed again, or a person decides.
      this.count(output, issue.severity, issue.riskScore || 0);
      await this.touch(issue, now);
      return;
    }

    const pending: DataSecurityIssuePendingResolution | null =
      readDataSecurityIssuePendingResolution(issue.pendingResolution);

    await this.resolve({
      projectId: input.projectId,
      issue,
      now,
      output,
      resolution: isContained
        ? DataSecurityIssueResolution.ContainedAtIngest
        : isPendingResolutionCurrent({ pending, now })
          ? DataSecurityIssueResolution.FixedFromHere
          : DataSecurityIssueResolution.CheckPassed,
      pending,
    });
  }

  private static async resolve(data: {
    projectId: ObjectID;
    issue: DataSecurityIssue;
    now: Date;
    output: ReconcileStoreOutput;
    resolution:
      | DataSecurityIssueResolution.CheckPassed
      | DataSecurityIssueResolution.ContainedAtIngest
      | DataSecurityIssueResolution.FixedFromHere
      | DataSecurityIssueResolution.NoLongerChecked;
    pending?: DataSecurityIssuePendingResolution | null | undefined;
  }): Promise<void> {
    const { projectId, issue, now, output, resolution } = data;

    if (
      !issue.id ||
      (issue.status !== DataSecurityIssueStatus.Open &&
        issue.status !== DataSecurityIssueStatus.Accepted)
    ) {
      return;
    }

    const details: DataSecurityIssueResolutionDetails = {
      at: now.toISOString(),
      ...(resolution === DataSecurityIssueResolution.FixedFromHere &&
      data.pending
        ? {
            responseAction: data.pending.responseAction,
            ...(data.pending.userId ? { userId: data.pending.userId } : {}),
          }
        : {}),
    };

    await DataSecurityIssueService.updateOneById({
      id: issue.id,
      data: {
        status: DataSecurityIssueStatus.Resolved,
        resolvedAt: now,
        acceptedReason: null,
        acceptedUntil: null,
        resolution,
        resolutionDetails: toResolutionDetailsJSON(details),
        pendingResolution: null,
      } as never,
      props: { isRoot: true },
    });

    await this.feed(projectId, issue.id, this.getResolvedEntry(data));

    output.closed.push({
      issueId: issue.id,
      why: RESOLVED_WHY[resolution],
    });
    output.resolvedCount++;

    /*
     * What OneUptime AI made for the issue is proven by its check passing,
     * never by its own word; what still waited for a person is no longer
     * needed (#10364).
     */
    await DataSecurityAiProposals.onIssuesClosed({
      issueIds: [issue.id],
      checkPassed: resolution !== DataSecurityIssueResolution.NoLongerChecked,
      now,
    });
  }

  // What the timeline says of an issue that resolved, by how.
  private static getResolvedEntry(data: {
    resolution: DataSecurityIssueResolution;
    pending?: DataSecurityIssuePendingResolution | null | undefined;
  }): { eventType: DataSecurityIssueFeedEventType; color: Color; markdown: string } {
    switch (data.resolution) {
      case DataSecurityIssueResolution.NoLongerChecked:
        return {
          eventType: DataSecurityIssueFeedEventType.Resolved,
          color: Gray500,
          markdown:
            mdText`Resolved: the check no longer runs on this store - it was turned off, or no longer applies.`.toString(),
        };
      case DataSecurityIssueResolution.ContainedAtIngest:
        return {
          eventType: DataSecurityIssueFeedEventType.Contained,
          color: Yellow500,
          markdown:
            mdText`Contained at ingest, not fixed: a scrub rule hides this data before it is stored, but the code still writes it - to stdout, and everywhere else the service sends its telemetry. Fix the code to stop it where it starts.`.toString(),
        };
      case DataSecurityIssueResolution.FixedFromHere:
        return {
          eventType: DataSecurityIssueFeedEventType.Resolved,
          color: Green500,
          markdown: (data.pending
            ? mdText`Resolved: fixed from here. **${data.pending.responseAction}** changed the store, and its check passes now.`
            : mdText`Resolved: fixed from here, and its check passes now.`
          ).toString(),
        };
      default:
        return {
          eventType: DataSecurityIssueFeedEventType.Resolved,
          color: Green500,
          markdown: mdText`Resolved: the check passes now.`.toString(),
        };
    }
  }

  /*
   * What the timeline says of a resolved issue whose check failed again:
   * after a fix OneUptime followed to production, which fix; after a leak
   * came back, which version brought it back.
   */
  private static getReopenedLine(
    issue: DataSecurityIssue,
    evidence: string,
  ): MarkdownText {
    const details: DataSecurityIssueResolutionDetails =
      readDataSecurityIssueResolutionDetails(issue.resolutionDetails);

    if (details.regression) {
      return mdText`Opened again. ${describeRegression(details.regression)} ${evidence}`;
    }

    if (isVerifiedFixResolution(issue.resolution) && details.fix) {
      return mdText`The check failed again after the issue was fixed in ${describePullRequest(details.fix)}, so it is open again. ${evidence}`;
    }

    return mdText`The check failed again after the issue was resolved, so it is open again. ${evidence}`;
  }

  /*
   * An issue opens again: it forgets how it resolved - but a leak that came
   * back after a verified fix keeps which version brought it back, so its
   * page says so and a rule that hides it does not close it again.
   */
  private static async reopen(data: {
    projectId: ObjectID;
    issue: DataSecurityIssue;
    checkId: string;
    title: string;
    severity: SecuritySeverity;
    riskScore: number;
    riskFactors?: JSONArray | undefined;
    evidence?: string | undefined;
    now: Date;
    output: ReconcileStoreOutput;
    markdown: MarkdownText;
    eventType: DataSecurityIssueFeedEventType;
  }): Promise<void> {
    const { issue, now, output } = data;

    if (!issue.id) {
      return;
    }

    const regression: DataSecurityIssueResolutionDetails["regression"] =
      readDataSecurityIssueResolutionDetails(issue.resolutionDetails)
        .regression;

    await DataSecurityIssueService.updateOneById({
      id: issue.id,
      data: {
        status: DataSecurityIssueStatus.Open,
        severity: data.severity,
        riskScore: data.riskScore,
        ...(data.riskFactors ? { riskFactors: data.riskFactors } : {}),
        ...(data.evidence !== undefined ? { evidence: data.evidence } : {}),
        lastDetectedAt: now,
        resolvedAt: null,
        acceptedReason: null,
        acceptedUntil: null,
        resolution: null,
        resolutionDetails: regression
          ? toResolutionDetailsJSON({ regression })
          : null,
        pendingResolution: null,
        reopenCount: (issue.reopenCount || 0) + 1,
      } as never,
      props: { isRoot: true },
    });

    await this.feed(data.projectId, issue.id, {
      eventType: data.eventType,
      color: severityColor(data.severity),
      markdown: data.markdown.toString(),
    });

    output.opened.push({
      issueId: issue.id,
      checkId: data.checkId,
      title: data.title,
      severity: data.severity,
      riskScore: data.riskScore,
    });
    this.count(output, data.severity, data.riskScore);
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
            resolution: DataSecurityIssueResolution.StoreArchived,
            resolutionDetails: toResolutionDetailsJSON({
              at: now.toISOString(),
            }),
            pendingResolution: null,
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

        // Nothing OneUptime AI proposed for it is needed now; nothing is proven either.
        await DataSecurityAiProposals.onIssuesClosed({
          issueIds: [issue.id],
          checkPassed: false,
          now,
        });
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
