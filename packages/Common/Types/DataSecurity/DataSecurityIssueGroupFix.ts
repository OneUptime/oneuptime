import { sha256Hex } from "../AutoRemediation/RemediationPlanFingerprint";
import { DeclaredCodeOwnerCandidateJSON } from "../../Utils/AiRemediation/DeclaredCodeChange";
import { toStableJsonText } from "./DataSecurityAi";
import { DataSecurityFixRepository } from "./DataSecurityApiTypes";
import { DataSecurityIssueGroupFixStateJSON } from "./DataSecurityIssueGroup";
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
 *   - one approval, for the stores made in the console: the response action
 *     that fixes the check (Fix it from here), run on every one of them
 *     through its cloud connection.
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

export interface DataSecurityIssueGroupCloudPlanJSON {
  // The change, run on every store below through its cloud connection.
  action: DataSecurityResponseAction;
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
        action: DataSecurityResponseAction;
        changed: number;
        unchanged: number;
        failed: Array<{ dataStoreId: string; name: string; message: string }>;
        // Why the person may not make this part: nothing was changed.
        refusal?: string | undefined;
      }
    | undefined;
  leftOut: number;
}

/*
 * A plan's fingerprint: its group, and every store of each part with what
 * becomes of it. The same issues and stores give the same fingerprint
 * however they were read.
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

  return sha256Hex(
    toStableJsonText({
      groupId: plan.groupId.toLowerCase(),
      pullRequest: plan.pullRequest ? ids(plan.pullRequest.stores) : null,
      cloud: plan.cloud
        ? { action: plan.cloud.action, stores: ids(plan.cloud.stores) }
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
