import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import { DataStoreFeedEventType } from "../../../Models/DatabaseModels/DataStoreFeed";
import Includes from "../../../Types/BaseDatabase/Includes";
import { Green500, Orange500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import DataSecurityIssueResolution, {
  DataSecurityIssueRegression,
  DataSecurityIssueResolutionDetails,
  DataSecurityIssueResolutionFix,
  DataSecurityIssueResolutionRule,
  MAX_RESOLUTION_TEXT_LENGTH,
  readDataSecurityIssueResolutionDetails,
  readResolutionUrl,
  toResolutionDetailsJSON,
} from "../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DataSecurityIssueFeedService from "../../Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreFeedService from "../../Services/DataStoreFeedService";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import DataSecurityAiProposals from "../AI/DataSecurity/DataSecurityAiProposals";
import logger from "../Logger";
import DataSecurityIssueAlerts from "./DataSecurityIssueAlerts";
import { queueDataSecurityEvaluation } from "./DataSecurityJobs";

/*
 * WRITING HOW AN ISSUE WAS FIXED, ONCE A FIX IS FOLLOWED TO PRODUCTION
 * (#10368).
 *
 * The production checks of a Data Security fix (TelemetryLeakFixWatch,
 * StoreConfigurationFixWatch) decide; this writes what they decided onto
 * the issues the fix is for, and says it where people look:
 *
 *   - Fixed in code: a leak's issue resolves - or, contained at ingest
 *     already, is upgraded - with the pull request, the version that
 *     shipped it and when production proved it. Its findings are marked
 *     fixed (DataStoreFinding.fixedAt), so the old data still kept until
 *     its retention no longer holds the issue open. The scrub rules that
 *     contained it are kept, as defence in depth, and named.
 *   - Fixed in infrastructure code: a store's issue that resolved after
 *     the merge, as its check passed, says it was the pull request.
 *   - The leak came back: the watch found the data again after the fix
 *     was verified. The issue says which version brought it back, and the
 *     next evaluation opens it again (DataSecurityIssueReconciler), so its
 *     alerts and owners hear of it as of any issue that opens again.
 *
 * Each says so on the issue's timeline and the store's: "Fixed in pull
 * request #482, deployed in version 2.4.1, verified at ...". Never throws
 * for one issue: a write that fails is logged, and the next check of the
 * fix tries again.
 */

const ROOT: { isRoot: true } = { isRoot: true };

// The most issues one fix writes to: a group's, at most.
const MAX_ISSUES_WRITTEN: number = 500;

// The most findings of one fix marked fixed.
const MAX_FINDINGS_MARKED: number = 2000;

// The pull request a fix came in, as a resolution keeps it.
export function getResolutionFixOf(data: {
  pullRequest: AIAgentTaskPullRequest;
  taskId?: ObjectID | undefined;
  // A code fix: the deploy that shipped it.
  version?: string | undefined;
  commitSha?: string | undefined;
  deployedAt?: Date | undefined;
}): DataSecurityIssueResolutionFix {
  const pullRequest: AIAgentTaskPullRequest = data.pullRequest;
  const fix: DataSecurityIssueResolutionFix = {
    pullRequestId:
      pullRequest.id?.toString() || String(pullRequest._id || "") || "",
  };
  const owner: string | undefined =
    pullRequest.repoOrganizationName ||
    pullRequest.codeRepository?.organizationName;
  const name: string | undefined =
    pullRequest.repoName || pullRequest.codeRepository?.repositoryName;
  const url: string | undefined = readResolutionUrl(
    pullRequest.pullRequestUrl?.toString(),
  );

  if (data.taskId) {
    fix.taskId = data.taskId.toString();
  }

  if (pullRequest.pullRequestNumber) {
    fix.number = pullRequest.pullRequestNumber;
  }

  if (url) {
    fix.url = url;
  }

  if (owner && name) {
    fix.repository = `${owner}/${name}`.slice(0, MAX_RESOLUTION_TEXT_LENGTH);
  }

  if (pullRequest.mergedAt) {
    fix.mergedAt = new Date(pullRequest.mergedAt).toISOString();
  }

  if (data.version) {
    fix.version = data.version.slice(0, MAX_RESOLUTION_TEXT_LENGTH);
  }

  if (data.commitSha) {
    fix.commitSha = data.commitSha.slice(0, MAX_RESOLUTION_TEXT_LENGTH);
  }

  if (data.deployedAt) {
    fix.deployedAt = data.deployedAt.toISOString();
  }

  return fix;
}

// "pull request [#482](…)", or "pull request #482", or "its pull request".
export function describePullRequest(
  fix: DataSecurityIssueResolutionFix | undefined,
): MarkdownText {
  if (!fix?.number) {
    return mdText`its pull request`;
  }

  const label: string = `#${fix.number}`;

  return fix.url
    ? mdText`pull request ${FeedMarkdown.link(label, fix.url)}`
    : mdText`pull request ${label}`;
}

// "Nov 21, 2026 14:10", as the server's timeline writes a time.
export function describeResolutionTime(at: Date | string): string {
  return OneUptimeDate.getDateAsUserFriendlyFormattedString(new Date(at));
}

/*
 * "Fixed in pull request #482, deployed in version 2.4.1, verified at
 * Nov 21, 2026 14:10." - the line a verified code fix leaves.
 */
export function describeFixedInCode(data: {
  fix: DataSecurityIssueResolutionFix;
  verifiedAt: Date;
}): MarkdownText {
  const shipped: MarkdownText = data.fix.version
    ? mdText`deployed in version ${data.fix.version}`
    : data.fix.commitSha
      ? mdText`deployed in commit ${FeedMarkdown.code(data.fix.commitSha.slice(0, 7))}`
      : mdText`deployed`;

  return mdText`Fixed in ${describePullRequest(data.fix)}, ${shipped}, verified at ${describeResolutionTime(
    data.verifiedAt,
  )}.`;
}

// "Fixed in pull request #57, applied, verified at Nov 21, 2026 14:10."
export function describeFixedInInfrastructureCode(data: {
  fix: DataSecurityIssueResolutionFix;
  verifiedAt: Date;
}): MarkdownText {
  return mdText`Fixed in ${describePullRequest(data.fix)}, applied, verified at ${describeResolutionTime(
    data.verifiedAt,
  )}: the store's configuration passes its check.`;
}

// What a verified code fix keeps: the rules that contained the leak, and why.
export function describeKeptRules(
  rules: ReadonlyArray<DataSecurityIssueResolutionRule>,
): MarkdownText | null {
  if (rules.length === 0) {
    return null;
  }

  const names: MarkdownText = FeedMarkdown.join(
    rules.map((rule: DataSecurityIssueResolutionRule): MarkdownText => {
      return mdText`**${rule.name || "a scrub rule"}**`;
    }),
    ", ",
  );

  return rules.length === 1
    ? mdText`The scrub rule that contained it, ${names}, is kept, so a regression is hidden on arrival. It has changed nothing since the fix: remove it from the issue when you no longer want it.`
    : mdText`The scrub rules that contained it, ${names}, are kept, so a regression is hidden on arrival. They have changed nothing since the fix: remove them from the issue when you no longer want them.`;
}

/*
 * "The leak came back in version 2.5.0, after pull request #482 fixed it
 * in version 2.4.1." - what the issue says as it opens again.
 */
export function describeRegression(
  regression: DataSecurityIssueRegression,
): MarkdownText {
  const fixed: MarkdownText = regression.fix
    ? regression.fix.version
      ? mdText` after ${describePullRequest(regression.fix)} fixed it in version ${regression.fix.version}`
      : mdText` after ${describePullRequest(regression.fix)} fixed it`
    : mdText` after its fix was verified`;

  return regression.version
    ? mdText`The leak came back in version ${regression.version},${fixed}.`
    : mdText`The leak came back${fixed}.`;
}

export default class DataSecurityIssueResolutions {
  /*
   * A code fix production proved (Fixed in code): each issue resolves, or
   * is upgraded from contained, and its findings are marked fixed. An
   * issue a person accepted or set aside is theirs, and left alone. The
   * timelines say so; the issues that closed end their alerts, and the
   * project is evaluated again so the store's counts follow.
   */
  public static async markFixedInCode(data: {
    projectId: ObjectID;
    issueIds: ReadonlyArray<ObjectID>;
    fix: DataSecurityIssueResolutionFix;
    verifiedAt: Date;
    // The rules that contained the leak, kept as defence in depth.
    keptRules: ReadonlyArray<DataSecurityIssueResolutionRule>;
    // The findings it stopped.
    findingIds: ReadonlyArray<ObjectID>;
  }): Promise<Array<ObjectID>> {
    const details: DataSecurityIssueResolutionDetails = {
      at: data.verifiedAt.toISOString(),
      fix: data.fix,
      ...(data.keptRules.length > 0
        ? { scrubRules: [...data.keptRules] }
        : {}),
    };
    const line: MarkdownText = FeedMarkdown.join(
      [
        describeFixedInCode({ fix: data.fix, verifiedAt: data.verifiedAt }),
        ...(describeKeptRules(data.keptRules)
          ? [describeKeptRules(data.keptRules)!]
          : []),
      ],
      " ",
    );

    await DataSecurityIssueResolutions.markFindingsFixed({
      projectId: data.projectId,
      findingIds: data.findingIds,
      fixedAt: data.verifiedAt,
    });

    const written: Array<ObjectID> =
      await DataSecurityIssueResolutions.writeResolution({
        projectId: data.projectId,
        issueIds: data.issueIds,
        resolution: DataSecurityIssueResolution.FixedInCode,
        details,
        at: data.verifiedAt,
        closedWhy: "its fix was verified in production",
      });

    await DataSecurityIssueResolutions.noteOnIssues({
      projectId: data.projectId,
      issueIds: written,
      eventType: DataSecurityIssueFeedEventType.FixVerified,
      storeEventType: DataStoreFeedEventType.IssueFixVerified,
      color: Green500,
      markdown: line,
    });

    return written;
  }

  /*
   * A fix in infrastructure code production proved, for the issues whose
   * check passed after it merged (Fixed in infrastructure code).
   */
  public static async markFixedInInfrastructureCode(data: {
    projectId: ObjectID;
    issueIds: ReadonlyArray<ObjectID>;
    fix: DataSecurityIssueResolutionFix;
    verifiedAt: Date;
  }): Promise<Array<ObjectID>> {
    const written: Array<ObjectID> =
      await DataSecurityIssueResolutions.writeResolution({
        projectId: data.projectId,
        issueIds: data.issueIds,
        resolution: DataSecurityIssueResolution.FixedInInfrastructureCode,
        details: {
          at: data.verifiedAt.toISOString(),
          fix: data.fix,
        },
        at: data.verifiedAt,
        closedWhy: "its fix was applied and its check passes",
      });

    await DataSecurityIssueResolutions.noteOnIssues({
      projectId: data.projectId,
      issueIds: written,
      eventType: DataSecurityIssueFeedEventType.FixVerified,
      storeEventType: DataStoreFeedEventType.IssueFixVerified,
      color: Green500,
      markdown: describeFixedInInfrastructureCode({
        fix: data.fix,
        verifiedAt: data.verifiedAt,
      }),
    });

    return written;
  }

  /*
   * The leak came back after its verified fix: the issue keeps which
   * version brought it back, its findings count again, and the next
   * evaluation opens it again with that line (DataSecurityIssueReconciler),
   * as any issue that opens again - its alert and its owners included.
   */
  public static async markCameBack(data: {
    projectId: ObjectID;
    issue: DataSecurityIssue;
    regression: DataSecurityIssueRegression;
    findingIds: ReadonlyArray<ObjectID>;
  }): Promise<void> {
    if (!data.issue.id) {
      return;
    }

    const details: DataSecurityIssueResolutionDetails = {
      ...readDataSecurityIssueResolutionDetails(data.issue.resolutionDetails),
      regression: data.regression,
    };

    await DataSecurityIssueService.updateColumnsByIdWithoutHooks({
      id: data.issue.id,
      data: { resolutionDetails: toResolutionDetailsJSON(details) } as never,
    });

    await DataSecurityIssueResolutions.markFindingsFixed({
      projectId: data.projectId,
      findingIds: data.findingIds,
      fixedAt: null,
    });

    await DataSecurityIssueResolutions.noteOnStores({
      projectId: data.projectId,
      issueIds: [data.issue.id],
      eventType: DataStoreFeedEventType.IssueFixRegressed,
      color: Red500,
      markdown: describeRegression(data.regression),
    });

    await queueDataSecurityEvaluation(data.projectId);
  }

  /*
   * Writes a resolution onto the issues: an open one resolves; a resolved
   * one is upgraded; an accepted one, or one a person set aside, is left as
   * it is. Returns the issues written.
   */
  public static async writeResolution(data: {
    projectId: ObjectID;
    issueIds: ReadonlyArray<ObjectID>;
    resolution: DataSecurityIssueResolution;
    details: DataSecurityIssueResolutionDetails;
    at: Date;
    // Why its alert ends, for an issue that was open.
    closedWhy: string;
  }): Promise<Array<ObjectID>> {
    if (data.issueIds.length === 0) {
      return [];
    }

    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          _id: new Includes(
            data.issueIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          ),
        } as never,
        select: { _id: true, status: true },
        skip: 0,
        limit: MAX_ISSUES_WRITTEN,
        props: ROOT,
      });
    const written: Array<ObjectID> = [];
    const closed: Array<ObjectID> = [];

    for (const issue of issues) {
      if (
        !issue.id ||
        (issue.status !== DataSecurityIssueStatus.Open &&
          issue.status !== DataSecurityIssueStatus.Resolved)
      ) {
        continue;
      }

      try {
        await DataSecurityIssueService.updateOneById({
          id: issue.id,
          data: {
            status: DataSecurityIssueStatus.Resolved,
            resolution: data.resolution,
            resolutionDetails: toResolutionDetailsJSON(data.details),
            pendingResolution: null,
            ...(issue.status === DataSecurityIssueStatus.Open
              ? {
                  resolvedAt: data.at,
                  acceptedReason: null,
                  acceptedUntil: null,
                }
              : {}),
          } as never,
          props: ROOT,
        });

        written.push(issue.id);

        if (issue.status === DataSecurityIssueStatus.Open) {
          closed.push(issue.id);
        }
      } catch (error) {
        logger.error(
          `DataSecurity: could not write how issue ${issue.id.toString()} was fixed; the fix's next check tries again: ${error}`,
        );
      }
    }

    if (closed.length > 0) {
      await DataSecurityIssueAlerts.resolveForClosedIssues({
        projectId: data.projectId,
        issues: closed.map((issueId: ObjectID) => {
          return { issueId, why: data.closedWhy };
        }),
      });

      // What OneUptime AI proposed for it is no longer needed, nor unproven.
      await DataSecurityAiProposals.onIssuesClosed({
        issueIds: closed,
        checkPassed: true,
        now: data.at,
      });
    }

    if (written.length > 0) {
      await queueDataSecurityEvaluation(data.projectId);
    }

    return written;
  }

  /*
   * Marks a fix's findings fixed - or, with none, counting again. Only the
   * project's own findings are written.
   */
  public static async markFindingsFixed(data: {
    projectId: ObjectID;
    findingIds: ReadonlyArray<ObjectID>;
    fixedAt: Date | null;
  }): Promise<void> {
    if (data.findingIds.length === 0) {
      return;
    }

    try {
      await DataStoreFindingService.updateBy({
        query: {
          projectId: data.projectId,
          _id: new Includes(
            data.findingIds.slice(0, MAX_FINDINGS_MARKED).map(
              (id: ObjectID): string => {
                return id.toString();
              },
            ),
          ),
        } as never,
        data: { fixedAt: data.fixedAt } as never,
        limit: MAX_FINDINGS_MARKED,
        skip: 0,
        props: ROOT,
      });
    } catch (error) {
      logger.error(
        `DataSecurity: could not mark ${data.findingIds.length} finding(s) of project ${data.projectId.toString()} as ${data.fixedAt ? "fixed" : "counting again"}: ${error}`,
      );
    }
  }

  /*
   * A line on the issues' timelines - and their stores', when a store's
   * kind of entry is given. Never throws.
   */
  public static async noteOnIssues(data: {
    projectId: ObjectID;
    issueIds: ReadonlyArray<ObjectID>;
    eventType: DataSecurityIssueFeedEventType;
    storeEventType?: DataStoreFeedEventType | undefined;
    color: Color;
    markdown: MarkdownText;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    for (const issueId of data.issueIds) {
      try {
        await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
          projectId: data.projectId,
          dataSecurityIssueId: issueId,
          eventType: data.eventType,
          displayColor: data.color,
          feedInfoInMarkdown: data.markdown.toString(),
          userId: data.userId,
        });
      } catch (error) {
        logger.error(
          `DataSecurity: could not write on issue ${issueId.toString()}'s timeline how its fix stands: ${error}`,
        );
      }
    }

    if (data.storeEventType) {
      await DataSecurityIssueResolutions.noteOnStores({
        projectId: data.projectId,
        issueIds: data.issueIds,
        eventType: data.storeEventType,
        color: data.color,
        markdown: data.markdown,
      });
    }
  }

  // The same line on each issue's store's timeline, once a store. Never throws.
  public static async noteOnStores(data: {
    projectId: ObjectID;
    issueIds: ReadonlyArray<ObjectID>;
    eventType: DataStoreFeedEventType;
    color: Color;
    markdown: MarkdownText;
  }): Promise<void> {
    if (data.issueIds.length === 0) {
      return;
    }

    try {
      const issues: Array<DataSecurityIssue> =
        await DataSecurityIssueService.findBy({
          query: {
            projectId: data.projectId,
            _id: new Includes(
              data.issueIds.map((id: ObjectID): string => {
                return id.toString();
              }),
            ),
          } as never,
          select: { _id: true, dataStoreId: true, title: true },
          skip: 0,
          limit: MAX_ISSUES_WRITTEN,
          props: ROOT,
        });
      const seen: Set<string> = new Set<string>();

      for (const issue of issues) {
        const storeId: string = issue.dataStoreId?.toString() || "";

        if (!storeId || seen.has(storeId)) {
          continue;
        }

        seen.add(storeId);

        await DataStoreFeedService.createDataStoreFeedItem({
          projectId: data.projectId,
          dataStoreId: issue.dataStoreId!,
          dataStoreFeedEventType: data.eventType,
          displayColor: data.color,
          feedInfoInMarkdown: mdText`**${issue.title || "An issue"}**: ${data.markdown}`.toString(),
        });
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not write on the stores' timelines how a fix stands: ${error}`,
      );
    }
  }
}

// The colours the timelines use for how a fix stands.
export const FIX_LINE_COLORS: {
  shipped: Color;
  notApplied: Color;
  regressed: Color;
} = {
  shipped: Orange500,
  notApplied: Orange500,
  regressed: Red500,
};
