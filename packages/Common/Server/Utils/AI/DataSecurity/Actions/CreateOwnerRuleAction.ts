import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../../../Models/DatabaseModels/DataStoreFeed";
import DataStoreOwnerRule from "../../../../../Models/DatabaseModels/DataStoreOwnerRule";
import Team from "../../../../../Models/DatabaseModels/Team";
import User from "../../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Green500 } from "../../../../../Types/BrandColors";
import { DataSecurityAiProposalKind } from "../../../../../Types/DataSecurity/DataSecurityAi";
import {
  DataStoreOwnerKind,
  DataStoreOwnerRef,
  DataStoreOwnerRulePlan,
  listOwnerNames,
  readDataStoreOwnerRulePlan,
} from "../../../../../Types/DataSecurity/DataStoreOwnerProposal";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import DataStoreFeedService from "../../../../Services/DataStoreFeedService";
import DataStoreOwnerRuleEngineService from "../../../../Services/DataStoreOwnerRuleEngineService";
import DataStoreOwnerRuleService from "../../../../Services/DataStoreOwnerRuleService";
import { queueDataSecurityEvaluation } from "../../../DataSecurity/DataSecurityJobs";
import DataStoreOwnerWrites, {
  DataStoreOwnerRow,
  readDataStoreOwnerRows,
} from "../Owners/DataStoreOwnerWrites";
import logger from "../../../Logger";
import {
  DataSecurityAiAction,
  DataSecurityAiActor,
  DataSecurityAiChangeMade,
  DataSecurityAiChangeUndone,
  DataSecurityAiPlanOutcome,
} from "../DataSecurityAiAction";
import {
  getAddOwnersRefusal,
  getRemoveOwnersRefusal,
  holdsAnyOf,
  OWNER_RULE_PERMISSIONS,
} from "./StoreOwnerChanges";

/*
 * THE OWNER RULE THAT KEEPS STORES OWNED (#10374).
 *
 * Where three or more stores' proposed owners rest on the same fact - the
 * same tag, the same name prefix - OneUptime AI proposes the owner rule
 * that says so (DataStoreOwnerRuleProposals), with what the rule engine
 * says it would do: "This rule would set Payments as the owner of 14
 * stores, 3 of which already have owners." It is planned for the project,
 * never for one issue, so the engine never plans it.
 *
 * Approving it is one approval for every such store and the next one:
 *
 *   - the rule is made, as the person who approved, with their permission
 *     to create owner rules; it tells the owners it adds, as owner rules
 *     do;
 *   - it is run on every store it matches now, adding its owners as the
 *     same person, each store's timeline saying where they came from;
 *   - every store found from now on is matched by the owner rule engine as
 *     it is discovered.
 *
 * The stores' own checks decide whether it worked, as for a store's owners.
 * Undo deletes the rule and the owners it added when it was approved;
 * owners it added later, to stores found since, are its own work and stay.
 */

const CreateOwnerRuleAction: DataSecurityAiAction = {
  kind: DataSecurityAiProposalKind.CreateOwnerRule,

  // Planned for the project's stores, never for one issue.
  appliesToCheck(_checkId: string | undefined): boolean {
    return false;
  },

  async plan(): Promise<DataSecurityAiPlanOutcome> {
    return { kind: "nothing", detail: "planned-for-the-project" };
  },

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
  }): string | null {
    if (!holdsAnyOf(data.props, OWNER_RULE_PERMISSIONS.create)) {
      return "Approving this creates an owner rule, and you do not have permission to create one. Ask a Project Owner or Project Admin, or for Create Data Store Owner Rule.";
    }

    return getAddOwnersRefusal(
      data.props,
      readDataStoreOwnerRulePlan(data.proposal.plan)?.owners || [],
    );
  },

  getUndoRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
  }): string | null {
    if (!holdsAnyOf(data.props, OWNER_RULE_PERMISSIONS.delete)) {
      return "Undoing this deletes an owner rule, and you do not have permission to delete one. Ask a Project Owner or Project Admin, or for Delete Data Store Owner Rule.";
    }

    return getRemoveOwnersRefusal(
      data.props,
      readDataStoreOwnerRows(data.proposal.result?.["owners"]),
    );
  },

  async apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeMade> {
    const plan: DataStoreOwnerRulePlan | null = readDataStoreOwnerRulePlan(
      data.proposal.plan,
    );

    if (!plan) {
      throw new BadDataException(
        "This proposal no longer says what the rule matches or whom it adds, so nothing was done.",
      );
    }

    await DataStoreOwnerWrites.assertOwnersCanBeAdded({
      projectId: data.projectId,
      owners: plan.owners,
    });

    const draft: DataStoreOwnerRule = buildRule({
      projectId: data.projectId,
      plan,
    });
    const created: DataStoreOwnerRule = await DataStoreOwnerRuleService.create({
      data: draft,
      props: data.actor.props,
    });
    const ruleId: ObjectID = created.id!;
    const added: Array<DataStoreOwnerRow> = [];
    let matched: number = 0;

    try {
      const stores: Array<DataStore> =
        await DataStoreOwnerRuleEngineService.getStoresMatchingRule({
          projectId: data.projectId,
          rule: draft,
        });

      matched = stores.length;

      for (const store of stores) {
        if (!store.id) {
          continue;
        }

        const rows: Array<DataStoreOwnerRow> =
          await DataStoreOwnerWrites.addOwners({
            projectId: data.projectId,
            dataStoreId: store.id,
            owners: plan.owners,
            props: data.actor.props,
          });

        added.push(...rows);

        if (rows.length > 0) {
          await DataStoreFeedService.createDataStoreFeedItem({
            projectId: data.projectId,
            dataStoreId: store.id,
            dataStoreFeedEventType: DataStoreFeedEventType.AiChangeMade,
            displayColor: Green500,
            feedInfoInMarkdown:
              mdText`The owner rule **${plan.ruleName}**, which OneUptime AI proposed and this person approved, made **${namesOfRows(plan, rows)}** ${rows.length === 1 ? "an owner" : "owners"} of this store.`.toString(),
            userId: data.actor.userId,
          });
        }
      }
    } catch (error) {
      // All or nothing: the owners it added, and the rule, go too.
      await DataStoreOwnerWrites.removeOwnersAsOneUptime({
        projectId: data.projectId,
        rows: added,
      });

      try {
        await DataStoreOwnerRuleService.deleteOneById({
          id: ruleId,
          props: { isRoot: true },
        });
      } catch (deleteError) {
        logger.error(
          `DataSecurity owners: could not take back owner rule ${ruleId.toString()} after a change failed: ${deleteError}`,
        );
      }

      throw error;
    }

    // The stores' own checks decide: "Nobody owns this sensitive store".
    await queueDataSecurityEvaluation(data.projectId);

    const storesOwned: number = new Set(
      added.map((row: DataStoreOwnerRow): string => {
        return row.dataStoreId;
      }),
    ).size;

    return {
      result: {
        ruleId: ruleId.toString(),
        owners: added,
        storesMatched: matched,
      },
      summaryMarkdown:
        mdText`The owner rule **${plan.ruleName}** was made. It added **${listOwnerNames(
          plan.owners.map((owner: { name: string }): string => {
            return owner.name;
          }),
        )}** to ${String(storesOwned)} of the ${String(matched)} ${matched === 1 ? "store" : "stores"} it matches, and adds them to every store like them found from now on.`.toString(),
    };
  },

  async undo(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeUndone> {
    const rows: Array<DataStoreOwnerRow> = readDataStoreOwnerRows(
      data.proposal.result?.["owners"],
    );
    const ruleId: unknown = data.proposal.result?.["ruleId"];
    const removed: number = await DataStoreOwnerWrites.removeOwners({
      projectId: data.projectId,
      rows,
      props: data.actor.props,
    });

    if (typeof ruleId === "string" && ObjectID.isValidUUID(ruleId)) {
      await DataStoreOwnerRuleService.deleteBy({
        query: { _id: new ObjectID(ruleId), projectId: data.projectId },
        limit: 1,
        skip: 0,
        props: data.actor.props,
      });
    }

    await queueDataSecurityEvaluation(data.projectId);

    return {
      summaryMarkdown:
        mdText`The owner rule was deleted, and the ${String(removed)} ${removed === 1 ? "owner" : "owners"} it added when it was approved ${removed === 1 ? "was" : "were"} removed. Owners it added to stores found since stay: remove them on each store's Owners page.`.toString(),
    };
  },
};

// The rule a plan makes: what it matches, whom it adds, and that it tells them.
export function buildRule(data: {
  projectId: ObjectID;
  plan: DataStoreOwnerRulePlan;
}): DataStoreOwnerRule {
  const rule: DataStoreOwnerRule = new DataStoreOwnerRule();

  rule.projectId = data.projectId;
  rule.name = data.plan.ruleName.slice(0, 100);
  rule.description = `Proposed by OneUptime AI: ${data.plan.dataStoreIds.length} stores' owners rest on this, and the rule keeps the next store like them owned.`;
  rule.isEnabled = true;
  rule.notifyOwners = true;

  if (data.plan.cloudTagPattern) {
    rule.cloudTagPattern = data.plan.cloudTagPattern;
  }

  if (data.plan.nameRegexPattern) {
    rule.nameRegexPattern = data.plan.nameRegexPattern;
  }

  rule.ownerUsers = data.plan.owners
    .filter((owner: DataStoreOwnerRef): boolean => {
      return owner.kind === DataStoreOwnerKind.User;
    })
    .map((owner: DataStoreOwnerRef): User => {
      const user: User = new User();
      user._id = owner.id;
      user.id = new ObjectID(owner.id);
      return user;
    });
  rule.ownerTeams = data.plan.owners
    .filter((owner: DataStoreOwnerRef): boolean => {
      return owner.kind === DataStoreOwnerKind.Team;
    })
    .map((owner: DataStoreOwnerRef): Team => {
      const team: Team = new Team();
      team._id = owner.id;
      team.id = new ObjectID(owner.id);
      return team;
    });

  return rule;
}

function namesOfRows(
  plan: DataStoreOwnerRulePlan,
  rows: ReadonlyArray<DataStoreOwnerRow>,
): string {
  return listOwnerNames(
    rows.map((row: DataStoreOwnerRow): string => {
      return (
        plan.owners.find((owner: DataStoreOwnerRef): boolean => {
          return (
            owner.kind === row.kind &&
            owner.id.toLowerCase() === row.ownerId.toLowerCase()
          );
        })?.name || ""
      );
    }),
  );
}

export default CreateOwnerRuleAction;
