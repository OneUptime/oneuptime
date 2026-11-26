import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../Models/DatabaseModels/DataSecurityIssueGroup";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import { readCloudTags } from "../../../Types/Cloud/CloudInventory";
import {
  DataSecurityIssueGroupFacts,
  describeIssueGroupCause,
  readDataSecurityIssueGroupFacts,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import {
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupFixResultJSON,
  DataSecurityIssueGroupFixStoreJSON,
} from "../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { isTelemetryFindingCheck } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DataSecurityFixResult,
  DataSecurityTelemetryFixPlanResult,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import Dictionary from "../../../Types/Dictionary";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import ObjectID from "../../../Types/ObjectID";
import { readDeclaredCode } from "../../../Utils/AiRemediation/DeclaredCodeChange";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataSecurityAiReads from "../AI/DataSecurity/DataSecurityAiReads";
import DataSecurityCodeTask, {
  DataSecurityFixCode,
} from "../AI/DataSecurity/DataSecurityCodeTask";
import { AiDeclaredCodeRecord } from "../AI/DataSecurity/DataSecurityAiInput";
import DataSecurityIssueDossier from "../AI/DataSecurity/DataSecurityIssueDossier";
import { buildDataSecurityFixRequest } from "../AI/DataSecurity/DataSecurityIssuePrompt";
import CloudAiTargets from "../AI/ResourceAccess/CloudAiTargets";
import DataSecurityIssueGroupFix, {
  GroupFixMember,
  getIssuesPageUrl,
} from "../DataSecurity/DataSecurityIssueGroupFix";
import DataSecurityIssueGroups from "../DataSecurity/DataSecurityIssueGroups";
import ProjectDataTypeNames from "../DataSecurity/ProjectDataTypeNames";
import TelemetryLeakFix, {
  TELEMETRY_FIX_NOTHING_TO_FIX_MESSAGE,
  TelemetryLeakFixPlan,
} from "../DataSecurity/TelemetryLeakFix";
import logger from "../Logger";
import type {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "./SecurityPlaybookActions";

/*
 * FIX THE CODE WITH AI, ON A DATA SECURITY CASE (#10370, #10740).
 *
 * A Data Security case is about a store whose issue was Critical. The
 * playbook's Fix the code with AI step fixes the case's open issues in the
 * code that declares their stores, each asked as OneUptime and kept on the
 * case (triggeredBySecurityCaseId), as the step asks one for an exception:
 *
 *   - an issue in a group of issues one mistake made: the group's one pull
 *     request, for the stores declared as code - the cause, once - in the
 *     repository the grouping found their code in;
 *   - an issue in no group (#10740): Fix with AI for that issue itself
 *     (DataSecurityCodeTask.requestFix), in the repository its store's
 *     declared code points to (DataSecurityIssueDossier.readDeclaredCode),
 *     as a person's Fix with AI asks it;
 *   - a leak in a service's telemetry: the service's one pull request for
 *     its leaks (#10367, TelemetryLeakFix), in the repository they are
 *     written in, as Fix with AI on the issue asks it - once a service,
 *     whichever of the case's issues it fixes.
 *
 * Never a change through a cloud connection, which always asks a person
 * (#10364): a store made in the console waits for Fix it from here on its
 * issue, or for its group's one approval on the Issues list.
 *
 * What the step says goes on the case's timeline, read by the case's
 * readers, who may not read a group's other stores (#10739): it names the
 * case's own stores and causes alone - a group's cause as the case's
 * stores make it, and no count of the group's stores.
 *
 * A case another source opened is the step's as before (the exceptions its
 * requests threw): null.
 */

// The most groups one step fixes: a case is about one store, so it has few.
export const MAX_CASE_GROUPS_FIXED: number = 5;

// The most of a case's issues in no group one step asks a pull request for, each its own.
export const MAX_CASE_ISSUES_FIXED: number = 5;

// The most of a case's issues read.
const MAX_CASE_ISSUES_READ: number = 100;

const ROOT: { isRoot: true } = { isRoot: true };

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

function idOf(record: { _id?: unknown; id?: unknown }): string {
  const value: unknown = record.id || record._id;

  return value ? String(value).toLowerCase() : "";
}

// The groups of a case's issues, by id, each once: the first few.
export function getCaseGroupIds(
  issues: ReadonlyArray<Pick<DataSecurityIssue, "dataSecurityIssueGroupId">>,
): Array<string> {
  return Array.from(
    new Set(
      issues
        .map(
          (
            issue: Pick<DataSecurityIssue, "dataSecurityIssueGroupId">,
          ): string => {
            return (
              issue.dataSecurityIssueGroupId?.toString().toLowerCase() || ""
            );
          },
        )
        .filter(Boolean),
    ),
  ).slice(0, MAX_CASE_GROUPS_FIXED);
}

// What the step did, as it goes: each part's lines, in the order asked.
interface CaseFixLines {
  started: Array<MarkdownText>;
  notStarted: Array<MarkdownText>;
  // The case's stores made in the console: they wait for a person.
  waiting: Array<MarkdownText>;
}

export default class SecurityPlaybookIssueGroupFix {
  public static async fixIssuesOfCase(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome | null> {
    // A Data Security case only: every other case's step reads nothing more.
    if (
      !context.securityCase.id ||
      context.securityCase.source !== SecurityDetectionSource.DataSecurity
    ) {
      return null;
    }

    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: context.projectId,
          securityCaseId: context.securityCase.id,
          status: DataSecurityIssueStatus.Open,
        },
        select: {
          _id: true,
          checkId: true,
          dataStoreId: true,
          dataSecurityIssueGroupId: true,
        },
        skip: 0,
        limit: MAX_CASE_ISSUES_READ,
        props: ROOT,
      });

    if (issues.length === 0) {
      return {
        status: SecurityPlaybookStepStatus.Skipped,
        summary: mdText`The case's Data Security issues are closed, so there is no code to fix.`,
      };
    }

    const stores: Map<string, DataStore> =
      await SecurityPlaybookIssueGroupFix.readStores({
        projectId: context.projectId,
        issues,
      });
    const lines: CaseFixLines = { started: [], notStarted: [], waiting: [] };

    await SecurityPlaybookIssueGroupFix.fixGroups({
      context,
      issues: issues.filter((issue: DataSecurityIssue): boolean => {
        return Boolean(issue.dataSecurityIssueGroupId);
      }),
      stores,
      lines,
    });
    await SecurityPlaybookIssueGroupFix.fixIssuesInNoGroup({
      context,
      issues: issues.filter((issue: DataSecurityIssue): boolean => {
        return !issue.dataSecurityIssueGroupId;
      }),
      stores,
      lines,
    });

    const details: Array<MarkdownText> = [];

    if (lines.notStarted.length > 0) {
      details.push(
        mdText`Not asked for:\n${FeedMarkdown.bulletList(lines.notStarted)}`,
      );
    }

    if (lines.waiting.length > 0) {
      details.push(
        mdText`Waiting for a person:\n${FeedMarkdown.bulletList(lines.waiting)}`,
      );
    }

    const detailsInMarkdown: MarkdownText | undefined =
      details.length > 0 ? FeedMarkdown.join(details, "\n\n") : undefined;

    if (lines.started.length === 0) {
      return {
        status: SecurityPlaybookStepStatus.Skipped,
        summary: mdText`No pull request was asked for the case's Data Security issues.`,
        ...(detailsInMarkdown ? { detailsInMarkdown } : {}),
      };
    }

    return {
      status: SecurityPlaybookStepStatus.Succeeded,
      summary: mdText`Asked OneUptime AI to fix the case's Data Security issues in code: ${FeedMarkdown.join(lines.started, "; ")}. Each pull request shows on its issue's page and in Code.`,
      feedEventType: SecurityCaseFeedEventType.ResponseAction,
      ...(detailsInMarkdown ? { detailsInMarkdown } : {}),
    };
  }

  /*
   * The case's issues in groups: each group's one pull request, for the
   * stores declared as code. Its cause is named as the case's stores alone
   * make it (#10739), and only the case's own stores made in the console
   * are said to wait.
   */
  private static async fixGroups(data: {
    context: PlaybookStepContext;
    issues: Array<DataSecurityIssue>;
    stores: Map<string, DataStore>;
    lines: CaseFixLines;
  }): Promise<void> {
    const projectId: ObjectID = data.context.projectId;

    for (const groupId of getCaseGroupIds(data.issues)) {
      const caseIssues: Array<DataSecurityIssue> = data.issues.filter(
        (issue: DataSecurityIssue): boolean => {
          return (
            issue.dataSecurityIssueGroupId?.toString().toLowerCase() === groupId
          );
        },
      );
      const caseStoreIds: Set<string> = new Set(
        caseIssues.map((issue: DataSecurityIssue): string => {
          return issue.dataStoreId?.toString().toLowerCase() || "";
        }),
      );
      let cause: string = "the cause of the case's issue";

      try {
        const group: DataSecurityIssueGroup =
          await DataSecurityIssueGroupFix.readGroup({ projectId, groupId });
        const facts: DataSecurityIssueGroupFacts | null =
          readDataSecurityIssueGroupFacts(group.facts);

        if (facts) {
          cause = describeIssueGroupCause(
            await DataSecurityIssueGroups.getFactsOfMembers({
              projectId,
              group,
              facts,
              members: caseIssues.map(
                (issue: DataSecurityIssue): { dataStoreId: string } => {
                  return {
                    dataStoreId:
                      issue.dataStoreId?.toString().toLowerCase() || "",
                  };
                },
              ),
            }),
          );
        }

        const members: Array<GroupFixMember> =
          await DataSecurityIssueGroupFix.readMembers({
            projectId,
            groupId: group.id!,
          });
        const plan: DataSecurityIssueGroupFixPlanJSON =
          await DataSecurityIssueGroupFix.planOf({
            projectId,
            group,
            members,
            props: ROOT,
          });

        for (const store of plan.cloud?.stores || []) {
          if (caseStoreIds.has(store.dataStoreId.toLowerCase())) {
            data.lines.waiting.push(
              SecurityPlaybookIssueGroupFix.consoleLine(store),
            );
          }
        }

        if (!plan.pullRequest || plan.pullRequest.stores.length === 0) {
          continue;
        }

        if (!plan.pullRequest.location) {
          data.lines.notStarted.push(
            mdText`${cause}: OneUptime could not find the code that declares the case's store. Fix the cause from ${FeedMarkdown.link(
              "the Issues list",
              getIssuesPageUrl(projectId),
            )}, where you pick the repository.`,
          );
          continue;
        }

        const result: DataSecurityIssueGroupFixResultJSON =
          await DataSecurityIssueGroupFix.run({
            projectId,
            groupId,
            props: ROOT,
            parts: [DataSecurityIssueGroupFixPart.PullRequest],
            triggeredBySecurityCaseId: data.context.securityCase.id!,
          });

        if (result.pullRequest?.aiRunId) {
          data.lines.started.push(
            mdText`one pull request that fixes the cause once, in the code that declares it: ${cause}${
              result.pullRequest.wasAlreadyAsked
                ? mdText` (already on its way)`
                : FeedMarkdown.empty()
            }`,
          );
        } else {
          data.lines.notStarted.push(
            mdText`${cause}: ${result.pullRequest?.message || "no pull request was asked for"}`,
          );
        }
      } catch (error) {
        logger.error(
          `Security playbook: could not fix issue group ${groupId} of case ${data.context.securityCase.id!.toString()}: ${error}`,
        );
        data.lines.notStarted.push(mdText`${cause}: ${errorMessage(error)}`);
      }
    }
  }

  /*
   * The case's issues in no group (#10740): each asked of Fix with AI on
   * its own, in the repository its store's declared code points to - the
   * first few. A store made in the console waits for Fix it from here; a
   * leak in telemetry for a person to pick the service's repository.
   */
  private static async fixIssuesInNoGroup(data: {
    context: PlaybookStepContext;
    issues: Array<DataSecurityIssue>;
    stores: Map<string, DataStore>;
    lines: CaseFixLines;
  }): Promise<void> {
    const projectId: ObjectID = data.context.projectId;
    // The services whose telemetry fix was asked for: one pull request fixes each one's issues.
    const servicesAsked: Set<string> = new Set();

    for (const issue of data.issues.slice(0, MAX_CASE_ISSUES_FIXED)) {
      const store: DataStore | undefined = data.stores.get(
        issue.dataStoreId?.toString().toLowerCase() || "",
      );
      const storeName: string = store?.name || "The case's store";

      try {
        if (isTelemetryFindingCheck(issue.checkId)) {
          await SecurityPlaybookIssueGroupFix.fixTelemetryLeaks({
            context: data.context,
            issue,
            storeName,
            servicesAsked,
            lines: data.lines,
          });
          continue;
        }

        if (!store || store.isArchived) {
          data.lines.notStarted.push(
            mdText`${storeName}: the store is gone from its source, so there is no code to fix.`,
          );
          continue;
        }

        const tags: Dictionary<string> = readCloudTags(store.cloudTags);

        if (!readDeclaredCode(CloudAiTargets.getManagedAsCode(tags))) {
          data.lines.waiting.push(
            mdText`${storeName}: made in the console, so there is no code to fix. Fix it from here on its issue: a change through its cloud connection always asks a person.`,
          );
          continue;
        }

        const full: DataSecurityIssue = await DataSecurityAiReads.readIssue({
          projectId,
          issueId: issue.id!,
        });
        const declared: AiDeclaredCodeRecord | null =
          await DataSecurityIssueDossier.readDeclaredCode(
            projectId,
            full,
            store,
          );

        if (!declared) {
          data.lines.notStarted.push(
            mdText`${storeName}: no repository OneUptime AI can work in holds the code that declares it. Ask for the fix from its issue, where you pick the repository.`,
          );
          continue;
        }

        const answer: DataSecurityFixResult =
          await DataSecurityCodeTask.requestFix({
            props: ROOT,
            projectId,
            issueIds: [issue.id!],
            code: DataSecurityFixCode.Infrastructure,
            requestedRepositoryId: declared.repositoryId,
            triggeredBySecurityCaseId: data.context.securityCase.id!,
            // The request as DataSecurityAiInput builds it (#10365), as Fix with AI's.
            buildMessage: async () => {
              return buildDataSecurityFixRequest(
                full,
                await DataSecurityAiReads.readPlaces({
                  projectId,
                  issue: full,
                }),
                await ProjectDataTypeNames.read({ projectId }),
              );
            },
          });

        if (answer.aiRunId) {
          data.lines.started.push(
            declared.paths.length > 0
              ? mdText`one pull request that fixes ${storeName}, in the ${declared.codeKind} code in ${declared.repositoryName} (${FeedMarkdown.join(declared.paths, ", ")})`
              : mdText`one pull request that fixes ${storeName}, in the ${declared.codeKind} code in ${declared.repositoryName}`,
          );
        } else {
          data.lines.notStarted.push(mdText`${storeName}: ${answer.message}`);
        }
      } catch (error) {
        logger.error(
          `Security playbook: could not fix issue ${idOf(issue)} of case ${data.context.securityCase.id!.toString()}: ${error}`,
        );
        data.lines.notStarted.push(
          mdText`${storeName}: ${errorMessage(error)}`,
        );
      }
    }
  }

  /*
   * A leak in a service's telemetry (#10367): the service's one pull
   * request for its leaks, planned as Fix with AI on the issue plans it -
   * the repository its leaks are written in, found from where they are
   * written - and asked as OneUptime, kept on the case. A service is asked
   * for once: its pull request fixes every one of its issues. Where nothing
   * says which repository holds its code, a person picks it on the issue.
   */
  private static async fixTelemetryLeaks(data: {
    context: PlaybookStepContext;
    issue: DataSecurityIssue;
    storeName: string;
    servicesAsked: Set<string>;
    lines: CaseFixLines;
  }): Promise<void> {
    const planned: {
      result: DataSecurityTelemetryFixPlanResult;
      plan: TelemetryLeakFixPlan | null;
    } = await TelemetryLeakFix.planForIssue({
      projectId: data.context.projectId,
      issueId: data.issue.id!,
      props: ROOT,
    });
    const plan: TelemetryLeakFixPlan | null = planned.plan;

    if (!plan) {
      data.lines.notStarted.push(
        mdText`${data.storeName}: ${planned.result.message || TELEMETRY_FIX_NOTHING_TO_FIX_MESSAGE}`,
      );
      return;
    }

    const serviceName: string = plan.serviceName || data.storeName;

    if (data.servicesAsked.has(plan.serviceId.toLowerCase())) {
      return;
    }

    data.servicesAsked.add(plan.serviceId.toLowerCase());

    if (!plan.repository) {
      data.lines.notStarted.push(
        mdText`${serviceName}: OneUptime could not tell which repository holds the code that writes its telemetry. Ask for the fix from its issue, where you pick the repository.`,
      );
      return;
    }

    const repositoryName: string =
      plan.repository.name || plan.repository.repositoryName;
    const answer: DataSecurityFixResult & { wasAlreadyAsked?: boolean } =
      await TelemetryLeakFix.start({
        projectId: data.context.projectId,
        plan,
        props: ROOT,
        requestedRepositoryId: plan.repository.id,
        triggeredBySecurityCaseId: data.context.securityCase.id!,
      });

    if (!answer.aiRunId) {
      data.lines.notStarted.push(mdText`${serviceName}: ${answer.message}`);
      return;
    }

    data.lines.started.push(
      answer.wasAlreadyAsked
        ? mdText`one pull request that stops ${serviceName} writing sensitive data to its telemetry, in ${repositoryName} (already on its way)`
        : mdText`one pull request that stops ${serviceName} writing sensitive data to its telemetry, in ${repositoryName}`,
    );
  }

  // A store of the case made in the console: what waits, and where.
  private static consoleLine(
    store: DataSecurityIssueGroupFixStoreJSON,
  ): MarkdownText {
    return mdText`${store.name || "The case's store"}: made in the console. A change through its cloud connection always asks a person, so it waits for its group's one approval on the Issues list (Fix the Cause).`;
  }

  // The stores of the case's issues, by id: their names, tags and whether they are gone.
  private static async readStores(data: {
    projectId: ObjectID;
    issues: Array<DataSecurityIssue>;
  }): Promise<Map<string, DataStore>> {
    const storeIds: Array<string> = Array.from(
      new Set(
        data.issues
          .map((issue: DataSecurityIssue): string => {
            return issue.dataStoreId?.toString().toLowerCase() || "";
          })
          .filter(Boolean),
      ),
    );

    if (storeIds.length === 0) {
      return new Map();
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId: data.projectId, _id: QueryHelper.any(storeIds) },
      select: {
        _id: true,
        name: true,
        kind: true,
        cloudTags: true,
        isArchived: true,
      },
      skip: 0,
      limit: storeIds.length,
      props: ROOT,
    });

    return new Map(
      stores.map((store: DataStore): [string, DataStore] => {
        return [idOf(store), store];
      }),
    );
  }
}
