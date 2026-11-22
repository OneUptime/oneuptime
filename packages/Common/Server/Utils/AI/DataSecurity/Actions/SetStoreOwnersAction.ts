import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityAiProposalKind } from "../../../../../Types/DataSecurity/DataSecurityAi";
import { NO_OWNER_CHECK_ID } from "../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DataStoreOwnerCandidate,
  DataStoreOwnerRef,
  DataStoreOwnersPlan,
  readDataStoreOwnersPlan,
} from "../../../../../Types/DataSecurity/DataStoreOwnerProposal";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import DataStoreService from "../../../../Services/DataStoreService";
import {
  queueDataSecurityEvaluation,
  queueDataStoreOwnerRuleProposals,
} from "../../../DataSecurity/DataSecurityJobs";
import DataStoreOwnerEvidenceReader from "../Owners/DataStoreOwnerEvidenceReader";
import DataStoreOwnerWrites, {
  DataStoreOwnerRow,
  readDataStoreOwnerRows,
} from "../Owners/DataStoreOwnerWrites";
import {
  DataSecurityAiAction,
  DataSecurityAiActor,
  DataSecurityAiChangeMade,
  DataSecurityAiChangeUndone,
  DataSecurityAiIssueContext,
  DataSecurityAiPlanOutcome,
} from "../DataSecurityAiAction";
import {
  DATA_STORE_FOR_OWNER_PLAN_SELECT,
  DataStoreForOwnerPlan,
} from "../Owners/DataStoreOwnerSelects";
import DataStoreOwnerPlanner from "../DataStoreOwnerPlanner";
import {
  getAddOwnersRefusal,
  getRemoveOwnersRefusal,
  nameOwners,
  readOwnerChanges,
} from "./StoreOwnerChanges";

/*
 * OWNERS FOR A STORE THAT HAS NONE (#10374).
 *
 * "Nobody owns this sensitive store" is an issue nobody fixes: nobody is
 * told. On a newly connected cloud account it is almost every store. When
 * that issue opens - and once a day for the stores that are new, and when
 * a cloud connection is first read (DataStoreOwnerProposalRun) -
 * OneUptime AI proposes owners from the evidence of who owns it
 * (DataStoreOwnerPlanner): its cloud tags, the services that use it, the
 * code owners of the file that declares it, who changed it.
 *
 * An owner is told about the store and its issues, so the change always
 * asks (ChangesWhoIsTold), whatever an AI rule says: Judge set to Without
 * asking proposes it all the same. Approving it adds the owners as the
 * person who approved - their own permission to add a store's owners - and
 * tells them as any owner is told; the person may pick other owners first.
 * The store's own check decides whether it worked: the store is checked
 * again, and the issue resolves when it has an owner. Undo removes exactly
 * the owners it added.
 */

const SetStoreOwnersAction: DataSecurityAiAction = {
  kind: DataSecurityAiProposalKind.SetStoreOwners,

  appliesToCheck(checkId: string | undefined): boolean {
    return checkId === NO_OWNER_CHECK_ID;
  },

  async plan(
    context: DataSecurityAiIssueContext,
  ): Promise<DataSecurityAiPlanOutcome> {
    if (!context.store.id) {
      return { kind: "nothing", detail: "store-gone" };
    }

    const store: DataStoreForOwnerPlan | null =
      await DataStoreService.findOneBy({
        query: { _id: context.store.id, projectId: context.projectId },
        select: DATA_STORE_FOR_OWNER_PLAN_SELECT,
        props: { isRoot: true },
      });

    if (!store) {
      return { kind: "nothing", detail: "store-gone" };
    }

    return await DataStoreOwnerPlanner.plan({
      projectId: context.projectId,
      store,
      // "Nobody owns this sensitive store" fails only on a sensitive one.
      isSensitive: true,
      directory: await DataStoreOwnerEvidenceReader.readDirectory(
        context.projectId,
      ),
      dataTypeNamer: context.dataTypeNamer,
      llmProviderId: context.llmProviderId,
    });
  },

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
    changes?: JSONObject | undefined;
  }): string | null {
    const owners: Array<DataStoreOwnerRef> = data.changes
      ? readOwnerChanges(data.changes)
      : readDataStoreOwnersPlan(data.proposal.plan)?.owners || [];

    return getAddOwnersRefusal(data.props, owners);
  },

  getUndoRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
  }): string | null {
    return getRemoveOwnersRefusal(
      data.props,
      readDataStoreOwnerRows(data.proposal.result?.["owners"]),
    );
  },

  async readChanges(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    changes: unknown;
  }): Promise<JSONObject> {
    const owners: Array<DataStoreOwnerRef> = readOwnerChanges(data.changes);

    await DataStoreOwnerWrites.assertOwnersCanBeAdded({
      projectId: data.projectId,
      owners: await nameOwners({ projectId: data.projectId, owners }),
    });

    return { owners: owners as unknown as Array<JSONObject> };
  },

  async apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
    changes?: JSONObject | undefined;
  }): Promise<DataSecurityAiChangeMade> {
    const plan: DataStoreOwnersPlan | null = readDataStoreOwnersPlan(
      data.proposal.plan,
    );

    if (!plan || !data.proposal.dataStoreId) {
      throw new BadDataException(
        "This proposal no longer says whose store it is for, so nothing was done.",
      );
    }

    const owners: Array<DataStoreOwnerRef & { name: string }> = data.changes
      ? await nameOwners({
          projectId: data.projectId,
          owners: readOwnerChanges(data.changes),
        })
      : plan.owners.map(
          (
            owner: DataStoreOwnerCandidate,
          ): DataStoreOwnerRef & { name: string } => {
            return { kind: owner.kind, id: owner.id, name: owner.name };
          },
        );

    await DataStoreOwnerWrites.assertOwnersCanBeAdded({
      projectId: data.projectId,
      owners,
    });

    const added: Array<DataStoreOwnerRow> =
      await DataStoreOwnerWrites.addOwners({
        projectId: data.projectId,
        dataStoreId: data.proposal.dataStoreId,
        owners,
        props: data.actor.props,
      });

    // The store's own check decides: "Nobody owns this sensitive store".
    await queueDataSecurityEvaluation(data.projectId);

    const addedNames: Array<MarkdownText> = owners
      .filter((owner: DataStoreOwnerRef): boolean => {
        return added.some((row: DataStoreOwnerRow): boolean => {
          return (
            row.kind === owner.kind &&
            row.ownerId.toLowerCase() === owner.id.toLowerCase()
          );
        });
      })
      .map((owner: DataStoreOwnerRef & { name: string }): MarkdownText => {
        return mdText`**${owner.name}**`;
      });

    return {
      result: {
        owners: added,
        approvedOwners: owners as unknown as Array<JSONObject>,
        changedBeforeApproving: Boolean(data.changes),
      },
      summaryMarkdown: (addedNames.length === 0
        ? mdText`The store had these owners already, so none was added.`
        : mdText`Owners added from OneUptime AI's proposal: ${FeedMarkdown.join(addedNames)}. They are told, as any owner is, and the store is being checked again.`
      ).toString(),
    };
  },

  // The rules this store's owners may share with others', looked at once for all.
  async onProposed(data: { projectId: ObjectID }): Promise<void> {
    await queueDataStoreOwnerRuleProposals(data.projectId);
  },

  async undo(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeUndone> {
    const rows: Array<DataStoreOwnerRow> = readDataStoreOwnerRows(
      data.proposal.result?.["owners"],
    );
    const removed: number = await DataStoreOwnerWrites.removeOwners({
      projectId: data.projectId,
      rows,
      props: data.actor.props,
    });

    await queueDataSecurityEvaluation(data.projectId);

    return {
      summaryMarkdown: (removed > 0
        ? mdText`The owners it added were removed, and the store is being checked again.`
        : mdText`The owners it added had been removed already.`
      ).toString(),
    };
  },
};

export default SetStoreOwnersAction;
