import DataSecurityAiDecision from "../../../../Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../../Types/Date";
import {
  DATA_SECURITY_AI_VERDICT_TITLES,
  DataSecurityAnalysisLine,
  DataSecurityIssueAnalysisView,
} from "../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import ObjectID from "../../../../Types/ObjectID";
import SecuritySeverity from "../../../../Types/SecuritySeverity";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import DataSecurityAiDecisionService from "../../../Services/DataSecurityAiDecisionService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreService from "../../../Services/DataStoreService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DataSecurityIntegrations, {
  OpenedIssueForIntegrations,
} from "../../DataSecurity/DataSecurityIntegrations";
import {
  HeldOwnerNotice,
  OWNER_NOTICE_MAX_WAIT_IN_MS,
  queueDataSecurityOwnerNotice,
} from "../../DataSecurity/DataSecurityJobs";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "../../Workspace/WorkspaceActionAuthorization";
import DataSecurityIssueAnalysis, {
  StoredDataSecurityIssueAnalysis,
} from "./DataSecurityIssueAnalysis";
import DataSecurityIssueAnalysisReader from "./DataSecurityIssueAnalysisReader";

/*
 * THE OWNERS' EMAIL, WITH ONEUPTIME AI'S ANALYSIS IN IT (#10369).
 *
 * While OneUptime AI works on new Data Security issues on its own, a
 * store's owners' email about its new issues is held
 * (DataSecurityIntegrations.onIssuesOpened) until the analysis is there,
 * so the first thing an owner reads says whether the issue is real and the
 * shortest way to fixed:
 *
 *   - it waits for OneUptime AI's work on each issue still open - the
 *     engine's record of it, written whatever came of it (#10364) - a
 *     minute at a time, and at most OWNER_NOTICE_MAX_WAIT_IN_MS since the
 *     issues opened: then it goes with what there is. An issue no longer
 *     open is no longer news, and is left out;
 *   - under each issue the analysis wrote, two lines: the verdict (and
 *     why), and the shortest path - each only when the owner may read what
 *     it rests on (DataSecurityIssueAnalysisReader, with the owner's own
 *     permissions), so the email never tells an owner what the issue's
 *     page would not;
 *   - with the project's AI off by the time it goes, it goes as it always
 *     did, with no analysis in it.
 */

// The issues of a held notice, as their email names them.
const NOTICE_ISSUE_SELECT: {
  _id: true;
  title: true;
  checkId: true;
  severity: true;
  riskScore: true;
  status: true;
  dataStoreId: true;
} = {
  _id: true,
  title: true,
  checkId: true,
  severity: true,
  riskScore: true,
  status: true,
  dataStoreId: true,
};

export type HeldOwnerNoticeOutcome = "sent" | "waiting" | "nothing";

export default class DataSecurityOwnerNotice {
  @CaptureSpan()
  public static async send(
    notice: HeldOwnerNotice,
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<HeldOwnerNoticeOutcome> {
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: notice.projectId,
          dataStoreId: notice.dataStoreId,
          _id: new Includes(notice.issueIds),
          status: DataSecurityIssueStatus.Open,
        },
        select: NOTICE_ISSUE_SELECT,
        skip: 0,
        limit: notice.issueIds.length,
        props: { isRoot: true },
      });

    if (issues.length === 0) {
      return "nothing";
    }

    const isAiWorking: boolean = await DataSecurityIntegrations.isAutomaticAiOn(
      notice.projectId,
    );
    const waitedFor: number = now.getTime() - notice.openedAt.getTime();

    if (
      isAiWorking &&
      waitedFor < OWNER_NOTICE_MAX_WAIT_IN_MS &&
      (await this.isAnyStillWorkedOn(notice, issues)) &&
      (await queueDataSecurityOwnerNotice({
        ...notice,
        attempt: notice.attempt + 1,
      }))
    ) {
      return "waiting";
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: notice.dataStoreId, projectId: notice.projectId },
      select: {
        _id: true,
        name: true,
        storeKey: true,
        kind: true,
        sensitivity: true,
        sensitivityOverride: true,
      },
      props: { isRoot: true },
    });

    if (!store?.id) {
      return "nothing";
    }

    const opened: Array<OpenedIssueForIntegrations> = issues.map(
      (issue: DataSecurityIssue): OpenedIssueForIntegrations => {
        return {
          issueId: issue.id!,
          checkId: issue.checkId || "",
          title: issue.title || "",
          severity: issue.severity || SecuritySeverity.Low,
          riskScore: issue.riskScore || 0,
          dataStoreId: store.id!,
          dataStoreName: store.name || "",
          dataStoreKey: store.storeKey || "",
          dataStoreKind: store.kind || undefined,
          sensitivity:
            store.sensitivityOverride ||
            store.sensitivity ||
            DataSensitivity.Public,
        };
      },
    );

    await DataSecurityIntegrations.notifyOwners(
      notice.projectId,
      opened,
      isAiWorking,
      isAiWorking
        ? await this.analysisLinesFor(notice.projectId, store.id)
        : undefined,
    );

    return "sent";
  }

  /*
   * Whether OneUptime AI's work on any of the issues is still to come: the
   * engine records each evaluation of an issue, whatever came of it, so an
   * issue with no record since the issues opened is still waited for.
   */
  private static async isAnyStillWorkedOn(
    notice: HeldOwnerNotice,
    issues: Array<DataSecurityIssue>,
  ): Promise<boolean> {
    const decisions: Array<DataSecurityAiDecision> =
      await DataSecurityAiDecisionService.findBy({
        query: {
          projectId: notice.projectId,
          dataSecurityIssueId: new Includes(
            issues.map((issue: DataSecurityIssue): ObjectID => {
              return issue.id!;
            }),
          ),
          createdAt: QueryHelper.greaterThanEqualTo(notice.openedAt),
        },
        select: { _id: true, dataSecurityIssueId: true },
        skip: 0,
        limit: issues.length * 4,
        props: { isRoot: true },
      });
    const done: Set<string> = new Set(
      decisions.map((decision: DataSecurityAiDecision): string => {
        return decision.dataSecurityIssueId?.toString() || "";
      }),
    );

    return issues.some((issue: DataSecurityIssue): boolean => {
      return !done.has(issue.id!.toString());
    });
  }

  /*
   * Each owner's lines for each issue: the analysis the issue keeps, as the
   * owner may read it - none when they may not read the issue, or nothing
   * of the analysis they may read. Each owner's permissions are read once.
   */
  private static async analysisLinesFor(
    projectId: ObjectID,
    dataStoreId: ObjectID,
  ): Promise<
    (
      owner: User,
      issue: OpenedIssueForIntegrations,
    ) => Promise<Array<MarkdownText>>
  > {
    const stored: Map<string, StoredDataSecurityIssueAnalysis | null> =
      new Map();
    const propsOf: Map<string, DatabaseCommonInteractionProps | null> =
      new Map();

    return async (
      owner: User,
      issue: OpenedIssueForIntegrations,
    ): Promise<Array<MarkdownText>> => {
      const issueKey: string = issue.issueId.toString();

      if (!stored.has(issueKey)) {
        stored.set(
          issueKey,
          await DataSecurityIssueAnalysis.readStored({
            projectId,
            issueId: issue.issueId,
          }),
        );
      }

      const analysis: StoredDataSecurityIssueAnalysis | null =
        stored.get(issueKey) || null;

      if (!analysis || !owner.id) {
        return [];
      }

      const ownerKey: string = owner.id.toString();

      if (!propsOf.has(ownerKey)) {
        propsOf.set(ownerKey, await this.readOwnerProps(projectId, owner.id));
      }

      const props: DatabaseCommonInteractionProps | null =
        propsOf.get(ownerKey) || null;

      if (!props) {
        return [];
      }

      try {
        // The owner reads the issue first: one they may not read adds nothing.
        await DataSecurityIssueAnalysisReader.readIssue({
          projectId,
          issueId: issue.issueId,
          props,
        });

        return getOwnerNoticeAnalysisLines(
          await DataSecurityIssueAnalysisReader.viewFor({
            projectId,
            dataStoreId,
            stored: analysis,
            props,
          }),
        );
      } catch {
        return [];
      }
    };
  }

  // An owner's permissions in the project, or null when they are no member of it.
  private static async readOwnerProps(
    projectId: ObjectID,
    userId: ObjectID,
  ): Promise<DatabaseCommonInteractionProps | null> {
    try {
      return await WorkspaceActionAuthorization.getProjectMemberProps({
        userId,
        projectId,
      });
    } catch (error) {
      logger.debug(
        `DataSecurity AI: the owners' email of project ${projectId.toString()} names no analysis to user ${userId.toString()}: ${error}`,
      );
      return null;
    }
  }
}

/*
 * The two lines an owner's email carries of an issue's analysis: the
 * verdict - with why, when they may read it - and the shortest path, when
 * they may read it. OneUptime AI's words go in as text, never as Markdown.
 */
export function getOwnerNoticeAnalysisLines(
  view: DataSecurityIssueAnalysisView,
): Array<MarkdownText> {
  const reason: DataSecurityAnalysisLine | undefined = view.lines.reason;
  const path: DataSecurityAnalysisLine | undefined = view.lines.path;
  const verdict: string = DATA_SECURITY_AI_VERDICT_TITLES[view.verdict];
  const lines: Array<MarkdownText> = [
    reason
      ? mdText`OneUptime AI: **${verdict}**. ${reason.text}`
      : mdText`OneUptime AI: **${verdict}**.`,
  ];

  if (path) {
    lines.push(mdText`Shortest path to fixed: ${path.text}`);
  }

  return lines;
}
