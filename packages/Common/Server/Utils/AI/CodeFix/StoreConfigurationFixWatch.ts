import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import {
  StoreConfigurationFixBaseline,
  StoreConfigurationFixIssue,
} from "../../../../Types/AI/FixProductionBaseline";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { Orange500 } from "../../../../Types/BrandColors";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import DataSecurityIssueResolution from "../../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import ObjectID from "../../../../Types/ObjectID";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreService from "../../../Services/DataStoreService";
import DataSecurityFixNotAppliedNotice from "../../DataSecurity/DataSecurityFixNotAppliedNotice";
import DataSecurityIssueResolutions, {
  describePullRequest,
  getResolutionFixOf,
} from "../../DataSecurity/DataSecurityIssueResolutions";
import {
  queueDataSecurityConnectionRead,
  queueDataSecurityEvaluation,
} from "../../DataSecurity/DataSecurityJobs";
import DataSecurityFixTarget, {
  DataSecurityFixTargetRead,
} from "./DataSecurityFixTarget";
import { FixProductionVerdict } from "./FixProductionVerdict";
import FixProductionVerifier, { VerifierRun } from "./FixProductionVerifier";
import {
  StoreConfigurationFixCounts,
  decideStoreConfigurationVerdict,
  isADayAfterMerge,
  isReadADayAfterMerge,
} from "./StoreConfigurationFixVerdict";

/*
 * A MERGED FIX IN INFRASTRUCTURE CODE, FOLLOWED UNTIL IT TAKES (#10368): the
 * StoreConfiguration check of FixProductionVerifier.
 *
 * Its issues are the ones its task names (DataSecurityFixTarget): a
 * group's stores declared as code (#10370), or the one store Fix with AI
 * was asked from. On the fix's first check every store is read again at
 * once, as Check Now reads it, and the issues are kept
 * (StoreConfigurationFixBaseline).
 *
 * Then, every check, where each issue stands (StoreConfigurationFixVerdict):
 * one that resolved after the merge as its check passed was fixed by the
 * pull request, and says so (Fixed in infrastructure code); one still open
 * a day after the merge is asked to be read again once, and when that read
 * still finds it failing, the stores' owners and the pull request's author
 * are told, once (DataSecurityFixNotAppliedNotice). Every issue applied is
 * Verified; one never applied in the 14 days a deploy is waited for is
 * Unverifiable.
 */

const ROOT: { isRoot: true } = { isRoot: true };

// Where one issue of the fix stands.
export enum IssueStanding {
  Applied = "Applied",
  Open = "Open",
  NotThisFix = "NotThisFix",
}

export default class StoreConfigurationFixWatch {
  public static async verify(
    fix: AIAgentTaskPullRequest,
    run: VerifierRun,
  ): Promise<void> {
    const mergedAt: Date = FixProductionVerifier.mergedAtOf(fix, run);
    let baseline: StoreConfigurationFixBaseline | undefined =
      fix.productionBaseline?.storeConfiguration;

    if (!baseline) {
      const target: DataSecurityFixTargetRead | null = fix.aiRunId
        ? await DataSecurityFixTarget.read(fix.aiRunId)
        : null;

      if (!target) {
        await FixProductionVerifier.settle(fix, run, {
          status: FixProductionStatus.Unverifiable,
          summary:
            "The Data Security issues this fix was opened for no longer exist, so whether its change was applied cannot be told.",
        });
        return;
      }

      baseline = await StoreConfigurationFixWatch.startWatching({
        fix,
        target,
        now: run.now,
      });
    }

    const issues: Array<DataSecurityIssue> =
      await StoreConfigurationFixWatch.readIssues({
        projectId: fix.projectId!,
        baseline,
      });
    const stores: Map<string, DataStore> =
      await StoreConfigurationFixWatch.readStores({
        projectId: fix.projectId!,
        issues,
      });
    const counts: StoreConfigurationFixCounts = {
      applied: 0,
      open: 0,
      openAfterADay: 0,
      notThisFix: 0,
    };
    const toUpgrade: Array<ObjectID> = [];
    const open: Array<DataSecurityIssue> = [];
    const openAfterADay: Array<DataSecurityIssue> = [];

    for (const issue of issues) {
      const store: DataStore | undefined = stores.get(
        issue.dataStoreId?.toString() || "",
      );

      switch (
        StoreConfigurationFixWatch.standingOf({ issue, store, mergedAt })
      ) {
        case IssueStanding.Applied:
          counts.applied++;

          if (
            issue.resolution !==
            DataSecurityIssueResolution.FixedInInfrastructureCode
          ) {
            toUpgrade.push(issue.id!);
          }
          break;
        case IssueStanding.Open:
          counts.open++;
          open.push(issue);

          if (
            isReadADayAfterMerge({
              readAt: store?.configurationReadAt,
              mergedAt,
              now: run.now,
            })
          ) {
            counts.openAfterADay++;
            openAfterADay.push(issue);
          }
          break;
        default:
          counts.notThisFix++;
      }
    }

    const taskId: ObjectID | undefined =
      baseline.taskId && ObjectID.isValidUUID(baseline.taskId)
        ? new ObjectID(baseline.taskId)
        : undefined;

    if (toUpgrade.length > 0) {
      await DataSecurityIssueResolutions.markFixedInInfrastructureCode({
        projectId: fix.projectId!,
        issueIds: toUpgrade,
        fix: getResolutionFixOf({ pullRequest: fix, taskId }),
        verifiedAt: run.now,
      });
    }

    // A day after the merge, the stores still open are read once more before anyone is told.
    if (
      open.length > openAfterADay.length &&
      isADayAfterMerge({ mergedAt, now: run.now }) &&
      !baseline.dayReadAskedAt
    ) {
      await StoreConfigurationFixWatch.askForRead({
        projectId: fix.projectId!,
        stores: open
          .map((issue: DataSecurityIssue): DataStore | undefined => {
            return stores.get(issue.dataStoreId?.toString() || "");
          })
          .filter((store: DataStore | undefined): store is DataStore => {
            return Boolean(store);
          }),
      });
      baseline = { ...baseline, dayReadAskedAt: run.now.toISOString() };
      await FixProductionVerifier.saveBaseline(fix, {
        storeConfiguration: baseline,
      });
    }

    const verdict: FixProductionVerdict = decideStoreConfigurationVerdict({
      mergedAt,
      now: run.now,
      counts,
    });

    await FixProductionVerifier.settle(fix, run, verdict);

    // Merged, not applied: told once, to the owners and the author.
    if (
      openAfterADay.length > 0 &&
      !baseline.notAppliedToldAt &&
      verdict.status !== FixProductionStatus.Unverifiable
    ) {
      baseline = { ...baseline, notAppliedToldAt: run.now.toISOString() };
      await FixProductionVerifier.saveBaseline(fix, {
        storeConfiguration: baseline,
      });

      await DataSecurityFixNotAppliedNotice.send({
        projectId: fix.projectId!,
        fix: getResolutionFixOf({ pullRequest: fix, taskId }),
        issues: openAfterADay.map((issue: DataSecurityIssue) => {
          return {
            issueId: issue.id!,
            dataStoreId: issue.dataStoreId!,
            checkId: issue.checkId || "",
          };
        }),
        authorUserId:
          baseline.askedByUserId && ObjectID.isValidUUID(baseline.askedByUserId)
            ? new ObjectID(baseline.askedByUserId)
            : undefined,
      });
    }
  }

  /*
   * The fix's first check: its issues kept, their stores read again at
   * once - as Check Now reads them - and the issues told it merged.
   */
  public static async startWatching(data: {
    fix: AIAgentTaskPullRequest;
    target: DataSecurityFixTargetRead;
    now: Date;
  }): Promise<StoreConfigurationFixBaseline> {
    const projectId: ObjectID = data.fix.projectId!;
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId,
          _id: new Includes(
            data.target.issueIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          ),
        } as never,
        select: { _id: true, dataStoreId: true, checkId: true, status: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: ROOT,
      });
    const kept: Array<StoreConfigurationFixIssue> = issues
      .filter((issue: DataSecurityIssue): boolean => {
        return Boolean(issue.id && issue.dataStoreId && issue.checkId);
      })
      .map((issue: DataSecurityIssue): StoreConfigurationFixIssue => {
        return {
          issueId: issue.id!.toString(),
          dataStoreId: issue.dataStoreId!.toString(),
          checkId: issue.checkId!,
        };
      });
    const baseline: StoreConfigurationFixBaseline = {
      issues: kept,
      taskId: data.target.taskId.toString(),
      ...(data.target.askedByUserId
        ? { askedByUserId: data.target.askedByUserId.toString() }
        : {}),
      readAskedAt: data.now.toISOString(),
    };

    await StoreConfigurationFixWatch.askForRead({
      projectId,
      stores: Array.from(
        (
          await StoreConfigurationFixWatch.readStores({ projectId, issues })
        ).values(),
      ),
    });
    await FixProductionVerifier.saveBaseline(data.fix, {
      storeConfiguration: baseline,
    });

    const openIssueIds: Array<ObjectID> = issues
      .filter((issue: DataSecurityIssue): boolean => {
        return (
          Boolean(issue.id) && issue.status === DataSecurityIssueStatus.Open
        );
      })
      .map((issue: DataSecurityIssue): ObjectID => {
        return issue.id!;
      });

    await DataSecurityIssueResolutions.noteOnIssues({
      projectId,
      issueIds: openIssueIds,
      eventType: DataSecurityIssueFeedEventType.FixShipped,
      color: Orange500,
      markdown: mdText`The fix in ${describePullRequest(
        getResolutionFixOf({ pullRequest: data.fix }),
      )} merged. The store is being read again: the issue resolves as fixed in infrastructure code once its check passes - after the change is applied.`,
    });

    return baseline;
  }

  /*
   * Where one issue stands: applied when it resolved after the merge as its
   * check passed - or a person marked it resolved and a read since found
   * it passing; open while it is open; not this fix's otherwise.
   */
  public static standingOf(data: {
    issue: DataSecurityIssue;
    store: DataStore | undefined;
    mergedAt: Date;
  }): IssueStanding {
    const issue: DataSecurityIssue = data.issue;

    if (issue.status === DataSecurityIssueStatus.Open) {
      return IssueStanding.Open;
    }

    if (
      issue.status !== DataSecurityIssueStatus.Resolved ||
      !issue.resolvedAt ||
      new Date(issue.resolvedAt).getTime() < data.mergedAt.getTime()
    ) {
      return IssueStanding.NotThisFix;
    }

    switch (issue.resolution) {
      case DataSecurityIssueResolution.CheckPassed:
      case DataSecurityIssueResolution.FixedInInfrastructureCode:
        return IssueStanding.Applied;
      case DataSecurityIssueResolution.ResolvedByPerson:
        // A person's Mark Resolved asks for a read; one since that left it resolved passed.
        return data.store?.configurationReadAt &&
          new Date(data.store.configurationReadAt).getTime() >
            new Date(issue.resolvedAt).getTime()
          ? IssueStanding.Applied
          : IssueStanding.Open;
      default:
        return IssueStanding.NotThisFix;
    }
  }

  private static async readIssues(data: {
    projectId: ObjectID;
    baseline: StoreConfigurationFixBaseline;
  }): Promise<Array<DataSecurityIssue>> {
    if (data.baseline.issues.length === 0) {
      return [];
    }

    return await DataSecurityIssueService.findBy({
      query: {
        projectId: data.projectId,
        _id: new Includes(
          data.baseline.issues.map(
            (issue: StoreConfigurationFixIssue): string => {
              return issue.issueId;
            },
          ),
        ),
      } as never,
      select: {
        _id: true,
        dataStoreId: true,
        checkId: true,
        status: true,
        resolution: true,
        resolvedAt: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: ROOT,
    });
  }

  // The issues' stores, by id: when each was last read, and through what.
  private static async readStores(data: {
    projectId: ObjectID;
    issues: ReadonlyArray<DataSecurityIssue>;
  }): Promise<Map<string, DataStore>> {
    const ids: Array<string> = Array.from(
      new Set(
        data.issues
          .map((issue: DataSecurityIssue): string => {
            return issue.dataStoreId?.toString() || "";
          })
          .filter(Boolean),
      ),
    );

    if (ids.length === 0) {
      return new Map();
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId: data.projectId, _id: new Includes(ids) } as never,
      select: {
        _id: true,
        cloudConnectionId: true,
        configurationReadAt: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: ROOT,
    });

    return new Map(
      stores.map((store: DataStore): [string, DataStore] => {
        return [store.id!.toString(), store];
      }),
    );
  }

  // Reads the stores again at once, as Check Now does: their connections, then the project.
  public static async askForRead(data: {
    projectId: ObjectID;
    stores: ReadonlyArray<DataStore>;
  }): Promise<void> {
    const connections: Set<string> = new Set<string>();

    for (const store of data.stores) {
      const connectionId: string = store.cloudConnectionId?.toString() || "";

      if (!connectionId || connections.has(connectionId)) {
        continue;
      }

      connections.add(connectionId);
      await queueDataSecurityConnectionRead({
        projectId: data.projectId,
        cloudConnectionId: new ObjectID(connectionId),
      });
    }

    await queueDataSecurityEvaluation(data.projectId);
  }
}
