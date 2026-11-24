import FixProductionCheck from "../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../Types/AI/FixProductionStatus";
import ProjectReferencesService from "./ProjectReferencesService";
import AIRunService from "./AIRunService";
import Model from "../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../Models/DatabaseModels/AIRun";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../Types/BaseDatabase/Query";
import ObjectID from "../../Types/ObjectID";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import FixPullRequestCiStatus from "../../Types/AI/FixPullRequestCiStatus";
import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import AIRunOutputReadFilter, {
  CARRIED_RECORD_COLUMNS,
} from "../Utils/AI/AIRunOutputReadFilter";
import { combineWithPrivacyClause } from "../Utils/PrivacyFilterUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface AIFixOutcomeStats {
  total: number;
  open: number;
  merged: number;
  closedUnmerged: number;
  /*
   * merged / (merged + closedUnmerged), in whole percent. Null until at
   * least one PR reached a terminal state — a rate over zero outcomes is
   * noise, not signal.
   */
  acceptanceRatePercent: number | null;
  /*
   * Merged PRs whose last recorded ciStatus was Green or (for should-fail
   * regression-test PRs) ExpectedFailureObserved — merged is good,
   * merged-and-CI-green is better. Per gate G9, ONLY those two conclusions
   * count: a merged PR with no CI (NoCiConfigured), a never-polled null,
   * Pending or Red is NOT verified and drags the rate down honestly.
   */
  verifiedGreen: number;
  /*
   * verifiedGreen / merged, in whole percent. Null until at least one PR
   * merged — same honesty rule as acceptanceRatePercent.
   */
  verifiedGreenRatePercent: number | null;
  /*
   * Merged fixes production showed working (FixProductionVerifier):
   * merged-and-CI-green is good, merged-and-fixed-in-production is the
   * point. Only Verified counts; Watching, AwaitingDeploy and Unverifiable
   * are not.
   */
  verifiedInProduction: number;
  // Merged fixes production showed did not work: Regressed.
  regressedInProduction: number;
  /*
   * The same verdicts by what production watched each fix for
   * (FixProductionCheck), Unverifiable included: each kind of fix - an
   * exception's, a slow operation's, an incident's root cause, a telemetry
   * improvement - earns its precision apart, and a high share of
   * Unverifiable says the project records too few deploys (or too little
   * telemetry) to tell. A fix watched before the checks were told apart is
   * an exception fix.
   */
  productionByCheck: Record<FixProductionCheck, AIFixProductionOutcome>;
}

// What production decided about one kind of merged fix.
export interface AIFixProductionOutcome {
  verified: number;
  regressed: number;
  unverifiable: number;
}

// The checks a row names; the rest of the decided rows are exception fixes.
const NAMED_CHECKS: Array<FixProductionCheck> = [
  FixProductionCheck.Performance,
  FixProductionCheck.Recurrence,
  FixProductionCheck.Telemetry,
  // A Data Security fix: a telemetry leak's code, a store's infrastructure code (#10368).
  FixProductionCheck.TelemetryLeak,
  FixProductionCheck.StoreConfiguration,
];

const DECIDED_STATUSES: Array<FixProductionStatus> = [
  FixProductionStatus.Verified,
  FixProductionStatus.Regressed,
  FixProductionStatus.Unverifiable,
];

/*
 * The key a pull request names the code-fix run that opened it by: it is
 * read through that run (AIRunOutputReadFilter, #9165).
 */
export const PULL_REQUEST_AI_RUN_KEY: string = "aiRunId";

export const PULL_REQUEST_AI_RUN_NOT_FOUND_MESSAGE: string =
  "AI run not found (or you do not have access to it).";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A PULL REQUEST IS READ THROUGH THE RUN THAT OPENED IT (#9165).
   *
   * Its title, its description and how it stands - its CI, what production
   * showed - say what the run did. So it is read only by those who may read
   * that run (AIRunOutputReadFilter): a CodeFix run is the project's, and
   * one about a private incident or alert - the fix pull request of its
   * investigation, the code a fix of its declares, a task that carries one -
   * only for those who see that record; one about a record that is gone
   * only for Project Owners and Project Admins. In a find, a count, a sort
   * and a filter alike, and in an update and a delete, which reach only the
   * pull requests their caller may read.
   *
   * A pull request OneUptime AI opened from a chat names no run
   * (CodeWriteTools): it carries the chat's subject in keys of its own
   * (#9186), read the same way - one opened from a private incident's or
   * alert's AI conversation, or from Ask AI asked about one, only for those
   * who see it - and one from a chat about neither is read as before.
   * OneUptime's own reads - the Code pages' after their own check, the sync
   * of a pull request's state - are made as OneUptime.
   */
  public static applyPrivacyFilters<T>(
    query: T,
    props: DatabaseCommonInteractionProps,
  ): T {
    return AIRunOutputReadFilter.applyToCarriedKeys({
      query: AIRunOutputReadFilter.applyToRunKey({
        query: query,
        props: props,
        modelType: Model,
        column: PULL_REQUEST_AI_RUN_KEY,
      }),
      props: props,
      modelType: Model,
    });
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = Service.applyPrivacyFilters(findBy.query, findBy.props);

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = Service.applyPrivacyFilters(countBy.query, countBy.props);

    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    updateBy.query = Service.applyPrivacyFilters(
      updateBy.query,
      updateBy.props,
    );

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = Service.applyPrivacyFilters(
      deleteBy.query,
      deleteBy.props,
    );

    return { deleteBy, carryForward: null };
  }

  /*
   * A person who records a pull request names only a run they may read: one
   * about a private record they do not see is answered as one that does not
   * exist. OneUptime's own records (a Runner's, a chat's) are not asked.
   */
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    const runId: ObjectID | undefined = createBy.data.aiRunId;

    if (!runId || createBy.props.isRoot || createBy.props.isMasterAdmin) {
      return;
    }

    const readable: FindWhereProperty<any> | undefined =
      AIRunOutputReadFilter.getReadableRunsRaw(createBy.props);

    const run: AIRun | null = await AIRunService.findOneBy({
      query: {
        _id: readable
          ? combineWithPrivacyClause(runId.toString(), readable)
          : runId.toString(),
        ...(createBy.props.tenantId
          ? { projectId: createBy.props.tenantId }
          : {}),
      } as never,
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!run) {
      throw new BadDataException(PULL_REQUEST_AI_RUN_NOT_FOUND_MESSAGE);
    }
  }

  /*
   * The read hook narrows by the run a pull request names, and by the
   * records it carries. See DatabaseService.
   */
  public override getColumnsReadHooksNarrowBy(): Array<string> {
    return [PULL_REQUEST_AI_RUN_KEY, ...CARRIED_RECORD_COLUMNS];
  }

  /*
   * Outcome counts for the project's AI-authored fix PRs — the G11
   * precision baseline (states kept current by AIAgent:SyncPullRequestStates).
   * Queries run with the caller's props so tenant scoping and read
   * permissions come from the model ACLs.
   */
  @CaptureSpan()
  public async getOutcomeStats(
    props: DatabaseCommonInteractionProps,
  ): Promise<AIFixOutcomeStats> {
    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const countForState: (
      state: PullRequestState,
    ) => Promise<PositiveNumber> = (
      state: PullRequestState,
    ): Promise<PositiveNumber> => {
      return this.countBy({
        query: {
          projectId: props.tenantId!,
          pullRequestState: state,
        },
        props,
      });
    };

    /*
     * CI-verified merged PRs (B4 Tier 1). Only Green and
     * ExpectedFailureObserved count as verified — never NoCiConfigured,
     * null, Pending or Red (G9: absence of CI reads as unverified).
     */
    const countMergedWithCiStatus: (
      ciStatus: FixPullRequestCiStatus,
    ) => Promise<PositiveNumber> = (
      ciStatus: FixPullRequestCiStatus,
    ): Promise<PositiveNumber> => {
      return this.countBy({
        query: {
          projectId: props.tenantId!,
          pullRequestState: PullRequestState.Merged,
          ciStatus: ciStatus,
        },
        props,
      });
    };

    const countMergedWithProductionStatus: (
      productionStatus: FixProductionStatus,
      productionCheck?: FixProductionCheck,
    ) => Promise<PositiveNumber> = (
      productionStatus: FixProductionStatus,
      productionCheck?: FixProductionCheck,
    ): Promise<PositiveNumber> => {
      return this.countBy({
        query: {
          projectId: props.tenantId!,
          pullRequestState: PullRequestState.Merged,
          productionStatus: productionStatus,
          ...(productionCheck ? { productionCheck } : {}),
        },
        props,
      });
    };

    /*
     * Every decided status, in all and for each named check. A row with no
     * check is an exception fix from before the column, so the exception
     * counts are what the named checks leave of the totals.
     */
    const readProductionByCheck: () => Promise<
      Record<FixProductionCheck, AIFixProductionOutcome>
    > = async (): Promise<
      Record<FixProductionCheck, AIFixProductionOutcome>
    > => {
      const [totals, byCheck]: [
        Array<PositiveNumber>,
        Array<Array<PositiveNumber>>,
      ] = await Promise.all([
        Promise.all(
          DECIDED_STATUSES.map(
            (status: FixProductionStatus): Promise<PositiveNumber> => {
              return countMergedWithProductionStatus(status);
            },
          ),
        ),
        Promise.all(
          NAMED_CHECKS.map(
            (check: FixProductionCheck): Promise<Array<PositiveNumber>> => {
              return Promise.all(
                DECIDED_STATUSES.map(
                  (status: FixProductionStatus): Promise<PositiveNumber> => {
                    return countMergedWithProductionStatus(status, check);
                  },
                ),
              );
            },
          ),
        ),
      ]);

      const toOutcome: (counts: Array<number>) => AIFixProductionOutcome = (
        counts: Array<number>,
      ): AIFixProductionOutcome => {
        return {
          verified: counts[0] || 0,
          regressed: counts[1] || 0,
          unverifiable: counts[2] || 0,
        };
      };

      const named: Array<Array<number>> = byCheck.map(
        (counts: Array<PositiveNumber>): Array<number> => {
          return counts.map((count: PositiveNumber): number => {
            return count.toNumber();
          });
        },
      );

      const exception: Array<number> = DECIDED_STATUSES.map(
        (_status: FixProductionStatus, index: number): number => {
          let rest: number = totals[index]!.toNumber();

          for (const counts of named) {
            rest -= counts[index] || 0;
          }

          return Math.max(0, rest);
        },
      );

      return {
        [FixProductionCheck.Exception]: toOutcome(exception),
        [FixProductionCheck.Performance]: toOutcome(named[0]!),
        [FixProductionCheck.Recurrence]: toOutcome(named[1]!),
        [FixProductionCheck.Telemetry]: toOutcome(named[2]!),
        [FixProductionCheck.TelemetryLeak]: toOutcome(named[3]!),
        [FixProductionCheck.StoreConfiguration]: toOutcome(named[4]!),
      };
    };

    const [
      open,
      merged,
      closedUnmerged,
      mergedCiGreen,
      mergedCiExpectedFail,
      productionByCheck,
    ]: [
      PositiveNumber,
      PositiveNumber,
      PositiveNumber,
      PositiveNumber,
      PositiveNumber,
      Record<FixProductionCheck, AIFixProductionOutcome>,
    ] = await Promise.all([
      countForState(PullRequestState.Open),
      countForState(PullRequestState.Merged),
      countForState(PullRequestState.Closed),
      countMergedWithCiStatus(FixPullRequestCiStatus.Green),
      countMergedWithCiStatus(FixPullRequestCiStatus.ExpectedFailureObserved),
      readProductionByCheck(),
    ]);

    const sumOf: (key: keyof AIFixProductionOutcome) => number = (
      key: keyof AIFixProductionOutcome,
    ): number => {
      return Object.values(productionByCheck).reduce(
        (sum: number, outcome: AIFixProductionOutcome): number => {
          return sum + outcome[key];
        },
        0,
      );
    };

    const mergedCount: number = merged.toNumber();
    const closedCount: number = closedUnmerged.toNumber();
    const terminalCount: number = mergedCount + closedCount;
    const verifiedGreenCount: number =
      mergedCiGreen.toNumber() + mergedCiExpectedFail.toNumber();

    return {
      total: open.toNumber() + terminalCount,
      open: open.toNumber(),
      merged: mergedCount,
      closedUnmerged: closedCount,
      acceptanceRatePercent:
        terminalCount === 0
          ? null
          : Math.round((mergedCount / terminalCount) * 100),
      verifiedGreen: verifiedGreenCount,
      verifiedGreenRatePercent:
        mergedCount === 0
          ? null
          : Math.round((verifiedGreenCount / mergedCount) * 100),
      verifiedInProduction: sumOf("verified"),
      regressedInProduction: sumOf("regressed"),
      productionByCheck,
    };
  }
}

export default new Service();
