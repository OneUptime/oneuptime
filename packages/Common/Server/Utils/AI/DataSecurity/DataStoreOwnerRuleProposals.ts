import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreOwnerRule from "../../../../Models/DatabaseModels/DataStoreOwnerRule";
import Project from "../../../../Models/DatabaseModels/Project";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import { sha256Hex } from "../../../../Types/AutoRemediation/RemediationPlanFingerprint";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import {
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWithoutAskingVerdict,
  DataSecurityAiWorkDecision,
  getDataSecurityAiWithoutAskingVerdict,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import { DataSecurityAiDecisionReason } from "../../../../Types/DataSecurity/DataSecurityAiDecision";
import {
  DataStoreOwnerEvidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnerKind,
  DataStoreOwnerRef,
  DataStoreOwnerRulePlan,
  DataStoreOwnersPlan,
  describeOwnerRuleFact,
  getOwnerRuleFactKey,
  getOwnerRulePattern,
  getOwnersKey,
  listOwnerNames,
  readDataStoreOwnerRef,
  readDataStoreOwnersPlan,
} from "../../../../Types/DataSecurity/DataStoreOwnerProposal";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DataStoreOwnerRuleGroup,
  DataStoreOwnerRuleGroupStore,
  getDataStoreOwnerRuleGroups,
} from "../../../../Utils/DataSecurity/DataStoreOwnerRuleGroups";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import DataSecurityAiProposalService from "../../../Services/DataSecurityAiProposalService";
import DataStoreOwnerRuleEngineService from "../../../Services/DataStoreOwnerRuleEngineService";
import DataStoreOwnerRuleService from "../../../Services/DataStoreOwnerRuleService";
import ProjectService from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CreateOwnerRuleAction, {
  buildRule,
} from "./Actions/CreateOwnerRuleAction";
import { DataSecurityAiPlannedChange } from "./DataSecurityAiAction";
import DataSecurityAiProposals from "./DataSecurityAiProposals";

/*
 * THE OWNER RULES ONEUPTIME AI PROPOSES (#10374): one look over the
 * project's proposed owners, a few minutes after a store's are proposed.
 *
 *  1. The owners proposed for each store - still waiting, or approved -
 *     and the facts of the store a rule could say: the cloud tags its
 *     owners rest on, the start of its name.
 *  2. The facts three or more stores' owners rest on, uncontested
 *     (Utils/DataSecurity/DataStoreOwnerRuleGroups).
 *  3. A rule the project has already, matching the same and adding the
 *     same owners, needs no proposal.
 *  4. What the rule engine says each rule would do now: how many stores it
 *     matches, and how many of those have owners already.
 *  5. The proposal (CreateOwnerRule), for no one issue: it always asks, and
 *     the same rule is never proposed twice - nor again once dismissed.
 *
 * Plain code: OneUptime AI's part is the stores' owners, which this only
 * reads. Read and written as OneUptime (root), the project scoped
 * explicitly. Never throws.
 */

// The most store owner proposals one look reads.
const MAX_PROPOSALS_READ: number = 2000;

// The most stores a rule's preview names.
const MAX_PREVIEW_STORE_NAMES: number = 5;

// What makes two owner rule proposals the same: the fact and the owners.
export function getOwnerRulePlanKey(
  group: Pick<DataStoreOwnerRuleGroup, "fact" | "owners">,
): string {
  return `owner-rule:${sha256Hex(
    `${getOwnerRuleFactKey(group.fact)}\n${getOwnersKey(group.owners)}`,
  ).slice(0, 16)}`;
}

// The rule's name: who owns which stores, as Settings > Owner Rules lists it.
export function getOwnerRuleName(group: DataStoreOwnerRuleGroup): string {
  const names: string = listOwnerNames(
    group.owners.map((owner: { name: string }): string => {
      return owner.name;
    }),
  );

  return `${names} ${group.owners.length === 1 ? "owns" : "own"} stores ${describeOwnerRuleFact(group.fact)}`.slice(
    0,
    100,
  );
}

// Owners as a change's result keeps them: each its kind, id and name.
function readNamedOwners(
  value: unknown,
): Array<DataStoreOwnerRef & { name: string }> {
  return (Array.isArray(value) ? value : [])
    .map((item: unknown): (DataStoreOwnerRef & { name: string }) | null => {
      const ref: DataStoreOwnerRef | null = readDataStoreOwnerRef(item);
      const name: unknown = (item as JSONObject | null)?.["name"];

      return ref
        ? { ...ref, name: typeof name === "string" ? name : "" }
        : null;
    })
    .filter(
      (
        owner: (DataStoreOwnerRef & { name: string }) | null,
      ): owner is DataStoreOwnerRef & { name: string } => {
        return owner !== null;
      },
    );
}

// A store's proposed owners, as the rules read them.
export function readGroupStore(
  proposal: Pick<DataSecurityAiProposal, "plan" | "result" | "status">,
): DataStoreOwnerRuleGroupStore | null {
  const plan: DataStoreOwnersPlan | null = readDataStoreOwnersPlan(
    proposal.plan,
  );

  if (!plan) {
    return null;
  }

  /*
   * What a person approved after changing it is what the store's owners
   * are: those rest on no evidence of the plan's, so no tag.
   */
  const approved: Array<DataStoreOwnerRef & { name: string }> =
    proposal.status === DataSecurityAiProposalStatus.Applied &&
    proposal.result?.["changedBeforeApproving"] === true
      ? readNamedOwners(proposal.result?.["approvedOwners"])
      : [];
  const isChanged: boolean = approved.length > 0;
  const owners: Array<DataStoreOwnerRef & { name: string }> = isChanged
    ? approved
    : plan.owners.map((owner: DataStoreOwnerRef & { name: string }) => {
        return { kind: owner.kind, id: owner.id, name: owner.name };
      });

  return {
    dataStoreId: plan.dataStoreId,
    dataStoreName: plan.dataStoreName,
    owners,
    facts: plan.ruleFacts,
    restsOnTagFactKeys: isChanged
      ? []
      : plan.evidence
          .filter((item: DataStoreOwnerEvidence): boolean => {
            return (
              item.source === DataStoreOwnerEvidenceSource.CloudTag &&
              plan.restsOn.includes(item.id) &&
              Boolean(item.tagKey && item.tagValue)
            );
          })
          .map((item: DataStoreOwnerEvidence): string => {
            return getOwnerRuleFactKey({
              kind: "CloudTag",
              key: item.tagKey || "",
              value: item.tagValue || "",
            });
          }),
  };
}

function idsOf(rows: Array<User> | Array<Team> | undefined): Set<string> {
  return new Set(
    (rows || []).map((row: User | Team): string => {
      return (row.id?.toString() || String(row._id || "")).toLowerCase();
    }),
  );
}

// Whether the project has a rule that matches the same and adds these owners.
export function hasRuleFor(
  rules: ReadonlyArray<DataStoreOwnerRule>,
  group: DataStoreOwnerRuleGroup,
): boolean {
  const pattern: { cloudTagPattern?: string; nameRegexPattern?: string } =
    getOwnerRulePattern(group.fact);

  return rules.some((rule: DataStoreOwnerRule): boolean => {
    const samePattern: boolean = pattern.cloudTagPattern
      ? (rule.cloudTagPattern || "").trim().toLowerCase() ===
        pattern.cloudTagPattern.toLowerCase()
      : (rule.nameRegexPattern || "").trim().toLowerCase() ===
        (pattern.nameRegexPattern || "").toLowerCase();

    if (!samePattern) {
      return false;
    }

    const users: Set<string> = idsOf(rule.ownerUsers);
    const teams: Set<string> = idsOf(rule.ownerTeams);

    return group.owners.every((owner: DataStoreOwnerRef): boolean => {
      return (owner.kind === DataStoreOwnerKind.User ? users : teams).has(
        owner.id.toLowerCase(),
      );
    });
  });
}

// What a proposed rule changes, as its proposal shows it.
export function toOwnerRuleChange(data: {
  plan: DataStoreOwnerRulePlan;
  dataStoreNames: Array<string>;
}): DataSecurityAiPlannedChange {
  const plan: DataStoreOwnerRulePlan = data.plan;
  const names: string = listOwnerNames(
    plan.owners.map((owner: { name: string }): string => {
      return owner.name;
    }),
  );
  const fact: string = describeOwnerRuleFact(plan.fact);
  const pattern: string = plan.cloudTagPattern || plan.nameRegexPattern || "";
  const matching: number = plan.preview.matchingStores;

  return {
    title: `Make ${names} the ${plan.owners.length === 1 ? "owner" : "owners"} of every store ${fact}`,
    changeMarkdown: FeedMarkdown.join(
      [
        mdText`An owner rule, **${plan.ruleName}** (${plan.cloudTagPattern ? "cloud tag" : "store name"} ${FeedMarkdown.code(pattern)}): every store ${fact} gets **${names}** as ${plan.owners.length === 1 ? "an owner" : "owners"}, now and whenever such a store is found. They are told, as owner rules tell the owners they add.`,
        mdText`This rule would set ${names} as the ${plan.owners.length === 1 ? "owner" : "owners"} of ${String(matching)} ${matching === 1 ? "store" : "stores"}, ${String(plan.preview.alreadyOwned)} of which already ${plan.preview.alreadyOwned === 1 ? "has" : "have"} owners.`,
        plan.preview.storeNames.length > 0
          ? mdText`Among them: ${FeedMarkdown.join(
              plan.preview.storeNames.map((name: string) => {
                return mdText`**${name}**`;
              }),
            )}.`
          : mdText``,
      ].filter((part: { toString: () => string }): boolean => {
        return part.toString().length > 0;
      }),
      "\n\n",
    ).toString(),
    reasonMarkdown: FeedMarkdown.join(
      [
        mdText`OneUptime AI proposed ${names} as the ${plan.owners.length === 1 ? "owner" : "owners"} of ${String(plan.dataStoreIds.length)} stores, and each of them rests on the same fact: they are ${fact}. A rule says it once, for them and for the next store like them.`,
        FeedMarkdown.bulletList(
          data.dataStoreNames.slice(0, 10).map((name: string) => {
            return mdText`**${name}**`;
          }),
        ),
      ],
      "\n\n",
    ).toString(),
    proofMarkdown:
      mdText`The stores' own checks decide: each sensitive store the rule adds owners to is checked again, and the first to pass **Nobody owns this sensitive store** proves it.`.toString(),
    undoMarkdown:
      mdText`Undo deletes the rule, and the owners it added when it was approved. Owners it adds to stores found later stay: remove them on each store's Owners page.`.toString(),
    plan: plan as unknown as JSONObject,
    planKey: getOwnerRulePlanKey(plan),
    meetsDefaultConditions: false,
  };
}

export default class DataStoreOwnerRuleProposals {
  // The owner rules the project's proposed owners share, proposed. Returns how many.
  @CaptureSpan()
  public static async proposeForProject(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<number> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          enableAi: true,
          enableAutomaticDataSecurityAi: true,
          requireTwoApprovalsForRiskierFixes: true,
        },
        props: { isRoot: true },
      });

      // Off, nothing runs and nothing is written.
      if (
        !project ||
        project.enableAi === false ||
        project.enableAutomaticDataSecurityAi !== true
      ) {
        return 0;
      }

      const proposals: Array<DataSecurityAiProposal> =
        await DataSecurityAiProposalService.findBy({
          query: {
            projectId: data.projectId,
            kind: DataSecurityAiProposalKind.SetStoreOwners,
            status: QueryHelper.any([
              DataSecurityAiProposalStatus.Proposed,
              DataSecurityAiProposalStatus.Applied,
            ]),
          },
          select: { _id: true, plan: true, result: true, status: true },
          skip: 0,
          limit: MAX_PROPOSALS_READ,
          props: { isRoot: true },
        });

      const groups: Array<DataStoreOwnerRuleGroup> =
        getDataStoreOwnerRuleGroups(
          proposals
            .map(readGroupStore)
            .filter(
              (
                store: DataStoreOwnerRuleGroupStore | null,
              ): store is DataStoreOwnerRuleGroupStore => {
                return store !== null;
              },
            ),
        );

      if (groups.length === 0) {
        return 0;
      }

      const rules: Array<DataStoreOwnerRule> =
        await DataStoreOwnerRuleService.findBy({
          query: { projectId: data.projectId },
          select: {
            _id: true,
            cloudTagPattern: true,
            nameRegexPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      const work: DataSecurityAiWorkDecision = {
        autonomy: DataSecurityAiAutonomy.Suggest,
        fromDefaults: true,
      };
      const verdict: DataSecurityAiWithoutAskingVerdict =
        getDataSecurityAiWithoutAskingVerdict({
          work,
          safety: DataSecurityAiChangeSafety.ChangesWhoIsTold,
          meetsDefaultConditions: false,
          isNamedByRule: false,
          requireTwoApprovalsForRiskierChanges:
            project.requireTwoApprovalsForRiskierFixes === true,
          changesWithoutAskingThisHour: 0,
        });
      let proposed: number = 0;

      for (const group of groups) {
        if (hasRuleFor(rules, group)) {
          continue;
        }

        const draftPlan: DataStoreOwnerRulePlan = {
          fact: group.fact,
          ruleName: getOwnerRuleName(group),
          ...getOwnerRulePattern(group.fact),
          owners: group.owners,
          dataStoreIds: group.dataStoreIds,
          preview: {
            matchingStores: 0,
            alreadyOwned: 0,
            storeNames: [],
            previewedAt: now.toISOString(),
          },
        };
        const preview: {
          matching: Array<DataStore>;
          ownedStoreIds: Set<string>;
        } = await DataStoreOwnerRuleEngineService.previewRule({
          projectId: data.projectId,
          rule: buildRule({ projectId: data.projectId, plan: draftPlan }),
        });
        const plan: DataStoreOwnerRulePlan = {
          ...draftPlan,
          preview: {
            matchingStores: preview.matching.length,
            alreadyOwned: preview.ownedStoreIds.size,
            storeNames: preview.matching
              .slice(0, MAX_PREVIEW_STORE_NAMES)
              .map((store: DataStore): string => {
                return store.name || "";
              }),
            previewedAt: now.toISOString(),
          },
        };
        const entry: { reason: DataSecurityAiDecisionReason } =
          await DataSecurityAiProposals.propose({
            projectId: data.projectId,
            issue: null,
            store: null,
            action: CreateOwnerRuleAction,
            change: toOwnerRuleChange({
              plan,
              dataStoreNames: group.dataStoreNames,
            }),
            work,
            verdict,
            // A rule for more stores waits ahead of one for fewer.
            riskScore: Math.min(100, preview.matching.length),
            now,
          });

        if (entry.reason === DataSecurityAiDecisionReason.Proposed) {
          proposed++;
        }
      }

      return proposed;
    } catch (error) {
      logger.error(
        `DataSecurity owners: could not propose the owner rules of project ${data.projectId.toString()}: ${error}`,
      );
      return 0;
    }
  }
}
