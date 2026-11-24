import DataSecurityIssuePullRequest from "../../../Models/DatabaseModels/DataSecurityIssuePullRequest";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import { TelemetryLeakFixBaseline } from "../../../Types/AI/FixProductionBaseline";
import FixProductionCheck from "../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../Types/AI/FixProductionStatus";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Gray500, Indigo500 } from "../../../Types/BrandColors";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import { getPullRequestLinkName } from "../../../Types/CodeRepository/PullRequestLink";
import PartialEntity from "../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DataSecurityIssueFeedService from "../../Services/DataSecurityIssueFeedService";
import DataSecurityIssuePullRequestService from "../../Services/DataSecurityIssuePullRequestService";
import DataSecurityFixTarget, {
  DataSecurityFixTargetRead,
} from "../AI/CodeFix/DataSecurityFixTarget";
import {
  FixProductionVerdict,
  fieldsWhenMerged,
  fitVerdict,
} from "../AI/CodeFix/FixProductionVerdict";
import FixProductionVerifier, {
  VerifierRun,
} from "../AI/CodeFix/FixProductionVerifier";
import TelemetryLeakFixWatch from "../AI/CodeFix/TelemetryLeakFixWatch";
import { CODE_HOST_REPOSITORY_SELECT } from "../CodeRepository/CodeHost/CodeHostAccess";
import LinkedPullRequestFollower, {
  LinkedPullRequestKind,
  PullRequestFollowed,
} from "../CodeRepository/LinkedPullRequests/LinkedPullRequestFollower";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataSecurityIssueResolutions from "./DataSecurityIssueResolutions";

/*
 * A PERSON'S OWN FIX OF A DATA SECURITY ISSUE, FOLLOWED TO PRODUCTION
 * (#10831) - the pull request they linked on the issue's page
 * (DataSecurityIssuePullRequest), followed as OneUptime AI's are:
 *
 *   1. When it is linked, the production check its issue's store calls for
 *      is picked (DataSecurityFixTarget: a telemetry store's leak in code,
 *      any other store's configuration), and a leak's baseline is taken at
 *      once (TelemetryLeakFixWatch.readBaseline): the places the leak was
 *      seen, the rules hiding them, and the traffic in the hour it was last
 *      seen - from the link on, so a pull request that merged before it
 *      was linked is weighed against the leak's last-seen hour too. A leak
 *      nothing can tell about says so on the issue there and then.
 *   2. While it is open, the one follower of linked pull requests
 *      (LinkedPullRequestFollower, a security case's links' too) reads its
 *      state every fifteen minutes. Merged, it waits for its deploy as an
 *      AI fix does (production status Awaiting deploy) and is checked at
 *      once; closed without merging, the issue's timeline says so and
 *      nothing more is followed.
 *   3. From the merge on, FixProductionVerifier follows it with the same
 *      checks an AI fix of the issue gets - its deploy, its new version
 *      watched, its verdict on its row, and the issue resolved as Fixed in
 *      code with the pull request and the version, or Fixed in
 *      infrastructure code once the change is applied.
 *
 * Each step is said on the issue's timeline, never with a value: the pull
 * request's name and link, and what OneUptime does next.
 */

// The most links one run reads the state of.
export const DATA_SECURITY_ISSUE_PULL_REQUEST_FOLLOW_BATCH: number = 100;

// What a linked fix is followed and checked with: the follower's columns and the checks'.
export const LINKED_FIX_SELECT: {
  _id: true;
  projectId: true;
  dataSecurityIssueId: true;
  createdByUserId: true;
  createdAt: true;
  pullRequestUrl: true;
  pullRequestNumber: true;
  pullRequestState: true;
  repoOrganizationName: true;
  repoName: true;
  mergeCommitSha: true;
  mergedAt: true;
  deployedAt: true;
  deployedVersion: true;
  deployedCommitSha: true;
  productionCheck: true;
  productionStatus: true;
  productionStatusAt: true;
  productionSummary: true;
  productionBaseline: true;
  codeRepository: typeof CODE_HOST_REPOSITORY_SELECT;
} = {
  _id: true,
  projectId: true,
  dataSecurityIssueId: true,
  createdByUserId: true,
  createdAt: true,
  pullRequestUrl: true,
  pullRequestNumber: true,
  pullRequestState: true,
  repoOrganizationName: true,
  repoName: true,
  mergeCommitSha: true,
  mergedAt: true,
  deployedAt: true,
  deployedVersion: true,
  deployedCommitSha: true,
  productionCheck: true,
  productionStatus: true,
  productionStatusAt: true,
  productionSummary: true,
  productionBaseline: true,
  codeRepository: CODE_HOST_REPOSITORY_SELECT,
};

// The statuses a check decided: nothing changes them again.
const DECIDED_STATUSES: ReadonlyArray<string> = [
  FixProductionStatus.Verified,
  FixProductionStatus.Regressed,
  FixProductionStatus.Unverifiable,
];

// A linked pull request as a person names it: "acme/checkout#482", or its address.
export function getLinkedFixName(
  row: Pick<
    DataSecurityIssuePullRequest,
    "repoOrganizationName" | "repoName" | "pullRequestNumber" | "pullRequestUrl"
  >,
): string {
  if (row.repoOrganizationName && row.repoName && row.pullRequestNumber) {
    return getPullRequestLinkName({
      owner: row.repoOrganizationName,
      repository: row.repoName,
      number: row.pullRequestNumber,
    });
  }

  return row.pullRequestUrl?.toString() || "";
}

// The pull request as the timeline shows it: its name, a link to its page when it has one.
function describeLink(data: { name: string; url: string }): MarkdownText {
  return data.url.startsWith("https://") || data.url.startsWith("http://")
    ? mdText`${FeedMarkdown.link(data.name, data.url)}`
    : mdText`**${data.name}**`;
}

// "Linked the pull request acme/checkout#482 as this issue's fix..."
export function linkedFixMarkdown(data: {
  name: string;
  url: string;
  check: FixProductionCheck | undefined;
}): MarkdownText {
  const link: MarkdownText = describeLink(data);

  return data.check === FixProductionCheck.StoreConfiguration
    ? mdText`🔗 Linked the pull request ${link} as this issue's fix. OneUptime follows it: once it merges and the change is applied, the issue counts as fixed in infrastructure code when the store passes its check.`
    : mdText`🔗 Linked the pull request ${link} as this issue's fix. OneUptime follows it to production: once it ships, the issue counts as fixed in code when the new version no longer writes the data.`;
}

// "The pull request acme/checkout#482, linked as this issue's fix, was closed without merging."
export function closedFixMarkdown(data: {
  name: string;
  url: string;
}): MarkdownText {
  return mdText`The pull request ${describeLink(data)}, linked as this issue's fix, was closed without merging. OneUptime no longer follows it.`;
}

// "Took the pull request acme/checkout#482 off this issue's fixes."
export function unlinkedFixMarkdown(data: { name: string }): MarkdownText {
  return mdText`🔗 Took the pull request **${data.name}** off this issue's fixes.`;
}

// A leak nothing can tell about, said when its fix is linked.
export function cannotTellFixMarkdown(data: {
  name: string;
  url: string;
  summary: string;
}): MarkdownText {
  return mdText`OneUptime cannot tell whether the pull request ${describeLink(data)} stops the leak. ${data.summary}`;
}

/*
 * The issue's linked fixes, as the one follower of linked pull requests
 * follows them: open ones only - a merged one's deploy is its production
 * check's to find, with the service it watches. A merge sets the check
 * waiting for that deploy (unless the link was decided already), and
 * starts it at once; a close says so on the issue.
 */
export const DATA_SECURITY_ISSUE_PULL_REQUESTS: LinkedPullRequestKind<DataSecurityIssuePullRequest> =
  {
    name: "Data Security issue pull request",
    findsDeploy: false,
    readToFollow: async (): Promise<Array<DataSecurityIssuePullRequest>> => {
      return await DataSecurityIssuePullRequestService.findBy({
        query: { pullRequestState: PullRequestState.Open },
        select: LINKED_FIX_SELECT,
        sort: { followedAt: SortOrder.Ascending },
        skip: 0,
        limit: DATA_SECURITY_ISSUE_PULL_REQUEST_FOLLOW_BATCH,
        props: { isRoot: true },
      });
    },
    write: async (data: {
      row: DataSecurityIssuePullRequest;
      update: JSONObject;
      isChanged: boolean;
    }): Promise<void> => {
      await DataSecurityIssuePullRequestService.updateColumnsByIdWithoutHooks({
        id: data.row.id!,
        data: data.update as PartialEntity<DataSecurityIssuePullRequest>,
        skipUpdateDateColumn: !data.isChanged,
      });
    },
    fieldsWhenMerged: (data: {
      row: DataSecurityIssuePullRequest;
      now: Date;
    }): JSONObject => {
      return DataSecurityLinkedFixes.productionFieldsWhenMerged(data);
    },
    afterChange: async (data: {
      row: DataSecurityIssuePullRequest;
      followed: PullRequestFollowed;
      run: VerifierRun;
    }): Promise<void> => {
      if (data.followed.isClosed) {
        await DataSecurityLinkedFixes.sayClosed(data.row);
        return;
      }

      if (
        data.followed.isMerged &&
        data.row.productionStatus === FixProductionStatus.AwaitingDeploy
      ) {
        // Its check starts at once, not at the verifier's next round.
        await FixProductionVerifier.verifyFix(data.row, data.run);
      }
    },
  };

export default class DataSecurityLinkedFixes {
  // Every linked fix still open, the longest-waiting first. Never throws.
  @CaptureSpan()
  public static async followAll(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    return await LinkedPullRequestFollower.followAll({
      kind: DATA_SECURITY_ISSUE_PULL_REQUESTS,
      now,
    });
  }

  /*
   * What a merge writes beside its state: its check waits for the deploy
   * that ships it, as an AI fix's does - unless the link was decided
   * already (a leak nothing could tell about, said when it was linked).
   */
  public static productionFieldsWhenMerged(data: {
    row: Pick<
      DataSecurityIssuePullRequest,
      "productionCheck" | "productionStatus"
    >;
    now: Date;
  }): JSONObject {
    if (
      !data.row.productionCheck ||
      DECIDED_STATUSES.includes(data.row.productionStatus || "")
    ) {
      return {};
    }

    const fields: JSONObject = fieldsWhenMerged({
      productionCheck: data.row.productionCheck,
      now: data.now,
    }) as unknown as JSONObject;

    // Its merge's own moment and commit are the follower's to write.
    delete fields["mergedAt"];
    delete fields["mergeCommitSha"];

    return fields;
  }

  /*
   * A link just made: a leak's baseline taken now, and a pull request that
   * merged already checked at once. Never throws: what is said about a
   * link never undoes it.
   */
  @CaptureSpan()
  public static async startFollowing(data: {
    projectId: ObjectID;
    id: ObjectID;
    now?: Date | undefined;
  }): Promise<void> {
    const run: VerifierRun = LinkedPullRequestFollower.newRun(data.now);

    try {
      const row: DataSecurityIssuePullRequest | null =
        await DataSecurityIssuePullRequestService.findOneBy({
          query: { _id: data.id, projectId: data.projectId },
          select: LINKED_FIX_SELECT,
          props: { isRoot: true },
        });

      if (!row || !row.projectId || !row.dataSecurityIssueId) {
        return;
      }

      if (
        row.productionCheck === FixProductionCheck.TelemetryLeak &&
        !row.productionBaseline?.telemetryLeak
      ) {
        const isDecided: boolean = await DataSecurityLinkedFixes.takeBaseline({
          row,
          run,
        });

        if (isDecided) {
          return;
        }
      }

      if (
        row.pullRequestState === PullRequestState.Merged &&
        row.productionStatus === FixProductionStatus.AwaitingDeploy
      ) {
        await FixProductionVerifier.verifyFix(row, run);
      }
    } catch (error) {
      logger.error(
        `DataSecurityLinkedFixes: could not start following linked pull request ${data.id.toString()}; its check starts at the verifier's next round:`,
      );
      logger.error(error);
    }
  }

  /*
   * A leak's baseline, from the link on: the places it was seen, the rules
   * hiding each, and the old version's traffic in the hour it was last seen
   * (before the link, whenever the pull request merged). True when nothing
   * can tell: the link is decided Unverifiable, and the issue says why.
   */
  public static async takeBaseline(data: {
    row: DataSecurityIssuePullRequest;
    run: VerifierRun;
  }): Promise<boolean> {
    const row: DataSecurityIssuePullRequest = data.row;
    const target: DataSecurityFixTargetRead | null =
      await DataSecurityFixTarget.readLink(row);

    if (!target) {
      return false;
    }

    const read: TelemetryLeakFixBaseline | FixProductionVerdict =
      await TelemetryLeakFixWatch.readBaseline({
        fix: row,
        target,
        mergedAt: data.run.now,
        now: data.run.now,
      });

    if (!("status" in read)) {
      await FixProductionVerifier.saveBaseline(row, { telemetryLeak: read });
      return false;
    }

    const verdict: FixProductionVerdict = fitVerdict(read);

    await FixProductionVerifier.writeFix(row, {
      productionStatus: verdict.status,
      productionSummary: verdict.summary,
      productionStatusAt: data.run.now,
    });
    row.productionStatus = verdict.status;
    row.productionSummary = verdict.summary;

    await DataSecurityIssueResolutions.noteOnIssues({
      projectId: row.projectId!,
      issueIds: [row.dataSecurityIssueId!],
      eventType: DataSecurityIssueFeedEventType.FixUnverifiable,
      color: Gray500,
      markdown: cannotTellFixMarkdown({
        name: getLinkedFixName(row),
        url: row.pullRequestUrl?.toString() || "",
        summary: verdict.summary,
      }),
    });

    return true;
  }

  // Closed without merging: the issue says so; nothing more is followed.
  public static async sayClosed(
    row: DataSecurityIssuePullRequest,
  ): Promise<void> {
    if (!row.projectId || !row.dataSecurityIssueId) {
      return;
    }

    await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
      projectId: row.projectId,
      dataSecurityIssueId: row.dataSecurityIssueId,
      eventType: DataSecurityIssueFeedEventType.FixClosed,
      displayColor: Gray500,
      feedInfoInMarkdown: closedFixMarkdown({
        name: getLinkedFixName(row),
        url: row.pullRequestUrl?.toString() || "",
      }).toString(),
    });
  }

  // Linked: the issue says who linked what, and what OneUptime does next.
  public static async sayLinked(data: {
    row: DataSecurityIssuePullRequest;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const row: DataSecurityIssuePullRequest = data.row;

    if (!row.projectId || !row.dataSecurityIssueId) {
      return;
    }

    await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
      projectId: row.projectId,
      dataSecurityIssueId: row.dataSecurityIssueId,
      eventType: DataSecurityIssueFeedEventType.FixLinked,
      displayColor: Indigo500,
      feedInfoInMarkdown: linkedFixMarkdown({
        name: getLinkedFixName(row),
        url: row.pullRequestUrl?.toString() || "",
        check: row.productionCheck,
      }).toString(),
      ...(data.userId ? { userId: data.userId } : {}),
    });
  }

  // Taken off: the issue says who took which off.
  public static async sayUnlinked(data: {
    row: DataSecurityIssuePullRequest;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const row: DataSecurityIssuePullRequest = data.row;

    if (!row.projectId || !row.dataSecurityIssueId) {
      return;
    }

    await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
      projectId: row.projectId,
      dataSecurityIssueId: row.dataSecurityIssueId,
      eventType: DataSecurityIssueFeedEventType.FixUnlinked,
      displayColor: Gray500,
      feedInfoInMarkdown: unlinkedFixMarkdown({
        name: getLinkedFixName(row),
      }).toString(),
      ...(data.userId ? { userId: data.userId } : {}),
    });
  }
}
