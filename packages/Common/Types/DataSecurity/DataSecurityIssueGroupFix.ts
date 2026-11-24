import { sha256Hex } from "../AutoRemediation/RemediationPlanFingerprint";
import { DeclaredCodeOwnerCandidateJSON } from "../../Utils/AiRemediation/DeclaredCodeChange";
import { DataSecurityAiProposalKind, toStableJsonText } from "./DataSecurityAi";
import { DataSecurityFixRepository } from "./DataSecurityApiTypes";
import { DataSecurityIssueGroupFixStateJSON } from "./DataSecurityIssueGroup";
import DataSecurityIssueResolution from "./DataSecurityIssueResolution";
import DataSecurityIssueStatus from "./DataSecurityIssueStatus";
import { DataSecurityResponseAction } from "./DataSecurityResponseAction";

/*
 * ONE FIX FOR A GROUP OF ISSUES ONE MISTAKE MADE (#10370), AS DATA.
 *
 * A group's fix has up to two parts, and a person sees both before one
 * press makes them:
 *
 *   - the pull request, for the stores declared as code: one change to the
 *     module or file that declares them, in a repository the person
 *     confirms, as for an incident's fix;
 *   - one approval, for the stores made in the console: on each store the
 *     response action its own kind takes to fix the check (Fix it from
 *     here), through its cloud connection. A group's stores share one
 *     check and one cloud, but not always one kind: a module that makes S3
 *     buckets and DynamoDB tables can fail one check on both, and each kind
 *     takes its own action - still one approval, listed kind by kind with
 *     what each does (#10742).
 *
 * What each part leaves out, and why, is said store by store: a store
 * marked Public By Design is never blocked; a store OneUptime AI's analysis
 * says the fix would break something it uses waits for the person to tick
 * it; a store Data Security cannot change through its cloud is left to be
 * fixed by hand. Pure, so the server and the Dashboard read it alike.
 * Stored strings are a contract: never rename one.
 */

export enum DataSecurityIssueGroupFixPart {
  PullRequest = "PullRequest",
  Cloud = "Cloud",
}

export const DATA_SECURITY_ISSUE_GROUP_FIX_PARTS: ReadonlyArray<DataSecurityIssueGroupFixPart> =
  [
    DataSecurityIssueGroupFixPart.PullRequest,
    DataSecurityIssueGroupFixPart.Cloud,
  ];

export function isDataSecurityIssueGroupFixPart(
  value: unknown,
): value is DataSecurityIssueGroupFixPart {
  return (
    typeof value === "string" &&
    (DATA_SECURITY_ISSUE_GROUP_FIX_PARTS as ReadonlyArray<string>).includes(
      value,
    )
  );
}

// Why a store is left out of its group's fix.
export enum DataSecurityIssueGroupLeftOutReason {
  // Marked Public By Design: a fix that closes an exposure never closes it.
  PublicByDesign = "PublicByDesign",
  /*
   * OneUptime AI's analysis of its issue (#10369) says the fix would take
   * away access something still uses: a person may tick it in.
   */
  FixWouldBreak = "FixWouldBreak",
  // Made in the console, and nothing Data Security can run fixes this check on it.
  NothingToRun = "NothingToRun",
  // Not found through a cloud connection.
  NotThroughACloud = "NotThroughACloud",
  // Its cloud connection is gone or turned off.
  ConnectionGone = "ConnectionGone",
  // Its cloud connection's "Data security response" setting is off.
  ResponseOff = "ResponseOff",
}

// A store of a group's fix, with its issue.
export interface DataSecurityIssueGroupFixStoreJSON {
  issueId: string;
  dataStoreId: string;
  name: string;
  kind?: string | undefined;
  region?: string | undefined;
  /*
   * The response action its kind takes to fix the check (#10742): on each
   * store of the one approval, and on a store it leaves out that has one -
   * what a store ticked in with Fix it anyway runs.
   */
  action?: DataSecurityResponseAction | undefined;
}

// A store a part of the fix leaves out, and why.
export interface DataSecurityIssueGroupLeftOutJSON
  extends DataSecurityIssueGroupFixStoreJSON {
  part: DataSecurityIssueGroupFixPart;
  reason: DataSecurityIssueGroupLeftOutReason;
  // Whether the person may tick it in: only a fix that would break something.
  canInclude: boolean;
  // What the fix would break, as the analysis names it: who uses the access it removes.
  breaks?: Array<string> | undefined;
  // The connection whose response setting is off, to turn it on there.
  cloudConnectionId?: string | undefined;
}

export interface DataSecurityIssueGroupPullRequestPlanJSON {
  // The stores declared as code that the one pull request fixes.
  stores: Array<DataSecurityIssueGroupFixStoreJSON>;
  // The kind of code ("Terraform"), as the stores' tags name it.
  codeKind?: string | undefined;
  // Where the code that declares them is, when the grouping found it.
  location?:
    | { repositoryId: string; repositoryName: string; paths: Array<string> }
    | undefined;
  /*
   * The repositories the person may pick, ranked as an incident's fix ranks
   * them (DeclaredCodeOwner), each the reader may read, with whether they
   * may ask AI to work in it.
   */
  candidates: Array<DeclaredCodeOwnerCandidateJSON>;
  // Why the reader cannot ask for it now, in Code's words; none when they can.
  refusal?: string | undefined;
  // The pull request already on its way, or open.
  existing?: DataSecurityIssueGroupFixStateJSON | undefined;
}

/*
 * One kind of store's own response action in the one approval (#10742),
 * with the stores of that kind it runs on: what it does to them, what
 * stops working and what it costs is the action's own sentence for that
 * kind (describeDataSecurityResponseAction), as Fix it from here says it.
 */
export interface DataSecurityIssueGroupCloudActionJSON {
  action: DataSecurityResponseAction;
  // The kind of store (DataStoreKind): "AWS S3 Bucket".
  kind: string;
  stores: Array<DataSecurityIssueGroupFixStoreJSON>;
}

export interface DataSecurityIssueGroupCloudPlanJSON {
  /*
   * The action most of the stores take - the only one, when they are all
   * of one kind. A group of several kinds runs each kind's own (actions).
   */
  action: DataSecurityResponseAction;
  /*
   * Each kind's own action and its stores, the most stores first: one
   * approval runs them all, each store through its cloud connection.
   */
  actions: Array<DataSecurityIssueGroupCloudActionJSON>;
  // Every store the approval runs on, each with its action.
  stores: Array<DataSecurityIssueGroupFixStoreJSON>;
  // Why the reader cannot run it, when they cannot.
  refusal?: string | undefined;
}

export interface DataSecurityIssueGroupFixPlanJSON {
  groupId: string;
  checkId: string;
  pullRequest?: DataSecurityIssueGroupPullRequestPlanJSON | undefined;
  cloud?: DataSecurityIssueGroupCloudPlanJSON | undefined;
  leftOut: Array<DataSecurityIssueGroupLeftOutJSON>;
  /*
   * What the plan was made from: the fix refuses a press made on a plan
   * that changed since it was shown (issues resolved, stores left).
   */
  planFingerprint: string;
}

// What a press of the group's fix did.
export interface DataSecurityIssueGroupFixResultJSON {
  pullRequest?:
    | {
        message: string;
        aiRunId?: string | undefined;
        // Several the person may ask in, none picked: choose one.
        repositories?: Array<DataSecurityFixRepository> | undefined;
        wasAlreadyAsked?: boolean | undefined;
      }
    | undefined;
  cloud?:
    | {
        // The action most of the stores took (the plan's).
        action: DataSecurityResponseAction;
        // Each action it ran, with what became of its stores (#10742).
        actions: Array<DataSecurityIssueGroupCloudOutcomeJSON>;
        changed: number;
        unchanged: number;
        failed: Array<{ dataStoreId: string; name: string; message: string }>;
        /*
         * The issues whose store it changed: what its check passing then
         * proves (#10738). Not those already as they should be.
         */
        changedIssueIds?: Array<string> | undefined;
        // Why the person may not make this part: nothing was changed.
        refusal?: string | undefined;
      }
    | undefined;
  leftOut: number;
}

// What one action of the one approval did to its stores (#10742).
export interface DataSecurityIssueGroupCloudOutcomeJSON {
  action: DataSecurityResponseAction;
  changed: number;
  unchanged: number;
  failed: number;
}

/*
 * The one approval's actions, kind by kind (#10742): the stores grouped by
 * the action they take and their kind - Revoke Sharing says one thing of a
 * snapshot and another of a database - the most stores first, then by
 * action and kind, so the same stores always read the same way. A store
 * with no action is no action's.
 */
export function getIssueGroupCloudActions(
  stores: ReadonlyArray<DataSecurityIssueGroupFixStoreJSON>,
): Array<DataSecurityIssueGroupCloudActionJSON> {
  const byKey: Map<string, DataSecurityIssueGroupCloudActionJSON> = new Map();

  for (const store of stores) {
    if (!store.action) {
      continue;
    }

    const kind: string = store.kind || "";
    const key: string = `${store.action}\n${kind}`;
    const entry: DataSecurityIssueGroupCloudActionJSON = byKey.get(key) || {
      action: store.action,
      kind,
      stores: [],
    };

    entry.stores.push(store);
    byKey.set(key, entry);
  }

  return Array.from(byKey.values()).sort(
    (
      left: DataSecurityIssueGroupCloudActionJSON,
      right: DataSecurityIssueGroupCloudActionJSON,
    ): number => {
      return (
        right.stores.length - left.stores.length ||
        left.action.localeCompare(right.action) ||
        left.kind.localeCompare(right.kind)
      );
    },
  );
}

/*
 * The action most of these stores take, or null for none: the one a plan
 * names first. Of two as common, the first in the actions' order.
 */
export function getIssueGroupMainAction(
  stores: ReadonlyArray<Pick<DataSecurityIssueGroupFixStoreJSON, "action">>,
): DataSecurityResponseAction | null {
  const counts: Map<DataSecurityResponseAction, number> = new Map();

  for (const store of stores) {
    if (store.action) {
      counts.set(store.action, (counts.get(store.action) || 0) + 1);
    }
  }

  let main: DataSecurityResponseAction | null = null;

  for (const [action, count] of counts) {
    if (
      !main ||
      count > (counts.get(main) || 0) ||
      (count === counts.get(main) && action.localeCompare(main) < 0)
    ) {
      main = action;
    }
  }

  return main;
}

// The actions of the one approval, each once, in its order.
export function getIssueGroupCloudActionList(
  cloud: Pick<DataSecurityIssueGroupCloudPlanJSON, "action" | "actions">,
): Array<DataSecurityResponseAction> {
  const actions: Array<DataSecurityResponseAction> = [];

  for (const entry of cloud.actions || []) {
    if (!actions.includes(entry.action)) {
      actions.push(entry.action);
    }
  }

  return actions.length > 0 ? actions : [cloud.action];
}

/*
 * A plan's fingerprint: its group, and every store of each part with what
 * becomes of it. The same issues and stores give the same fingerprint
 * however they were read. A one approval whose stores take more than one
 * action says which takes which (#10742); one of a single action reads as
 * it always did.
 */
export function getIssueGroupFixPlanFingerprint(
  plan: Omit<DataSecurityIssueGroupFixPlanJSON, "planFingerprint">,
): string {
  const ids: (
    stores: ReadonlyArray<{ dataStoreId: string }>,
  ) => Array<string> = (
    stores: ReadonlyArray<{ dataStoreId: string }>,
  ): Array<string> => {
    return stores
      .map((store: { dataStoreId: string }): string => {
        return store.dataStoreId.toLowerCase();
      })
      .sort();
  };
  const cloudActions: Array<string> = plan.cloud
    ? Array.from(
        new Set(
          plan.cloud.stores.map(
            (store: DataSecurityIssueGroupFixStoreJSON): string => {
              return store.action || plan.cloud!.action;
            },
          ),
        ),
      )
    : [];

  return sha256Hex(
    toStableJsonText({
      groupId: plan.groupId.toLowerCase(),
      pullRequest: plan.pullRequest ? ids(plan.pullRequest.stores) : null,
      cloud: plan.cloud
        ? {
            action: plan.cloud.action,
            stores: ids(plan.cloud.stores),
            ...(cloudActions.length > 1
              ? {
                  storeActions: plan.cloud.stores
                    .map((store: DataSecurityIssueGroupFixStoreJSON) => {
                      return `${store.dataStoreId.toLowerCase()}:${store.action || plan.cloud!.action}`;
                    })
                    .sort(),
                }
              : {}),
          }
        : null,
      leftOut: plan.leftOut
        .map((store: DataSecurityIssueGroupLeftOutJSON): string => {
          return `${store.part}:${store.reason}:${store.dataStoreId.toLowerCase()}`;
        })
        .sort(),
    }),
  ).slice(0, 16);
}

// How many stores a press of the plan fixes, with the stores ticked in.
export function countIssueGroupFixStores(
  plan: Pick<
    DataSecurityIssueGroupFixPlanJSON,
    "pullRequest" | "cloud" | "leftOut"
  >,
  includedDataStoreIds: ReadonlyArray<string> = [],
): number {
  const ticked: Set<string> = new Set(
    includedDataStoreIds.map((id: string): string => {
      return id.toLowerCase();
    }),
  );

  return (
    (plan.pullRequest?.refusal ? 0 : plan.pullRequest?.stores.length || 0) +
    (plan.cloud && !plan.cloud.refusal
      ? plan.cloud.stores.length +
        plan.leftOut.filter(
          (store: DataSecurityIssueGroupLeftOutJSON): boolean => {
            return (
              store.part === DataSecurityIssueGroupFixPart.Cloud &&
              store.canInclude &&
              ticked.has(store.dataStoreId.toLowerCase())
            );
          },
        ).length
      : 0)
  );
}

/*
 * ---------------------------------------------------------------------------
 * Whether a group's fix worked (#10738)
 * ---------------------------------------------------------------------------
 *
 * A change OneUptime AI made for one issue is proven when that issue's
 * check passes after it (DataSecurityAiProposalService.markProvenForIssue).
 * A group's fix - one pull request, or one approval - is proven the same
 * way, by its issues' own checks: once every issue it fixed is closed, and
 * each was closed by the fix itself (#10368's resolutions tell them apart):
 *
 *   - the pull request: each issue it lists resolved as Fixed in
 *     infrastructure code, by that very pull request's task - the production
 *     check that followed it to the applied change says so
 *     (StoreConfigurationFixWatch);
 *   - the one approval: each issue whose store it changed resolved as Fixed
 *     from here, by the action it ran on that store, after it ran. A store it
 *     found already as it should be, or could not change, is no part of what
 *     it proves.
 *
 * An issue accepted, marked not an issue, marked resolved by a person, no
 * longer checked, whose store was archived, or whose check passed for no
 * change OneUptime knows of, was closed some other way: the fix is not
 * proven by it, and AI Results never counts it among the changes that
 * worked. Proving claims nothing a check did not say.
 */
export enum IssueGroupFixProofStanding {
  // Every issue it fixed was closed by it: its check passed after the change.
  Proven = "Proven",
  // An issue it fixed is still open.
  Waiting = "Waiting",
  // An issue it fixed was closed some other way.
  ClosedOtherwise = "ClosedOtherwise",
  // It fixed no issue: nothing to prove.
  NothingToProve = "NothingToProve",
}

// One issue a group's fix fixed, as its proof reads it.
export interface IssueGroupFixProofIssue {
  status?: string | null | undefined;
  resolution?: string | null | undefined;
  // When it resolved.
  resolvedAt?: Date | string | null | undefined;
  // The code task of the pull request it was fixed in (resolutionDetails.fix.taskId).
  fixTaskId?: string | null | undefined;
  // The response action it was fixed from here by (resolutionDetails.responseAction).
  responseAction?: string | null | undefined;
  /*
   * The one approval: the action it ran on this issue's store, when the
   * proposal says. None for a proposal from before it said.
   */
  expectedAction?: string | null | undefined;
}

function timeOf(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

// Whether the fix itself closed this issue.
export function isIssueClosedByGroupFix(data: {
  kind: DataSecurityAiProposalKind;
  // The pull request's code task (its first turn).
  taskId?: string | null | undefined;
  // When the one approval ran.
  appliedAt?: Date | string | null | undefined;
  issue: IssueGroupFixProofIssue;
}): boolean {
  const issue: IssueGroupFixProofIssue = data.issue;

  if (issue.status !== DataSecurityIssueStatus.Resolved) {
    return false;
  }

  if (data.kind === DataSecurityAiProposalKind.FixIssueGroupInCode) {
    return Boolean(
      issue.resolution ===
        DataSecurityIssueResolution.FixedInInfrastructureCode &&
        data.taskId &&
        issue.fixTaskId &&
        issue.fixTaskId.toLowerCase() === data.taskId.toLowerCase(),
    );
  }

  if (
    data.kind !== DataSecurityAiProposalKind.FixIssueGroupInCloud ||
    issue.resolution !== DataSecurityIssueResolution.FixedFromHere
  ) {
    return false;
  }

  if (issue.expectedAction && issue.responseAction !== issue.expectedAction) {
    return false;
  }

  const ranAt: number | null = timeOf(data.appliedAt);
  const resolvedAt: number | null = timeOf(issue.resolvedAt);

  // Fixed from here before the approval ran: by another hand.
  return ranAt === null || resolvedAt === null || resolvedAt >= ranAt;
}

// Where an applied group fix stands against the checks of the issues it fixed.
export function getIssueGroupFixProofStanding(data: {
  kind: DataSecurityAiProposalKind;
  taskId?: string | null | undefined;
  appliedAt?: Date | string | null | undefined;
  issues: ReadonlyArray<IssueGroupFixProofIssue>;
}): IssueGroupFixProofStanding {
  if (data.issues.length === 0) {
    return IssueGroupFixProofStanding.NothingToProve;
  }

  if (
    data.issues.some((issue: IssueGroupFixProofIssue): boolean => {
      return issue.status === DataSecurityIssueStatus.Open;
    })
  ) {
    return IssueGroupFixProofStanding.Waiting;
  }

  return data.issues.every((issue: IssueGroupFixProofIssue): boolean => {
    return isIssueClosedByGroupFix({
      kind: data.kind,
      taskId: data.taskId,
      appliedAt: data.appliedAt,
      issue,
    });
  })
    ? IssueGroupFixProofStanding.Proven
    : IssueGroupFixProofStanding.ClosedOtherwise;
}
