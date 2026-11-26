import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { OwnersToReviewCopy } from "./DataSecurityAiCopy";
import Route from "Common/Types/API/Route";
import { DataSecurityAiProposalKind } from "Common/Types/DataSecurity/DataSecurityAi";
import {
  DataStoreOwnerCandidate,
  DataStoreOwnerConfidence,
  DataStoreOwnerKind,
  DataStoreOwnerRulePlan,
  DataStoreOwnersPlan,
  readDataStoreOwnerRulePlan,
  readDataStoreOwnersPlan,
} from "Common/Types/DataSecurity/DataStoreOwnerProposal";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { PillTone } from "Common/UI/Components/Pill/PillTone";

/*
 * WHAT OWNERS TO REVIEW READS OF A PROPOSAL (#10374), apart from how it is
 * drawn, so the list and its tests read the same:
 *
 *   - a store's owners: who, how sure OneUptime AI is, why, where the
 *     evidence disagrees, and which owners cannot open the store;
 *   - an owner rule: whom it adds, and what the rule engine said it would
 *     do when it was proposed;
 *   - where each row opens: the store's Owners page, or Owner Rules;
 *   - the owners a person picks before approving, as the route takes them.
 *
 * A proposal's plan is read defensively (Types/DataSecurity/
 * DataStoreOwnerProposal): what a newer server wrote and this build does
 * not know is left out, never drawn as something it is not.
 */

export interface OwnerProposalOwner {
  kind: DataStoreOwnerKind;
  id: string;
  name: string;
  // False for an owner who cannot open the store in Data Security today.
  canOpenStore: boolean;
}

export type OwnerProposalView =
  | {
      kind: "store";
      dataStoreId: string;
      dataStoreName: string;
      owners: Array<OwnerProposalOwner>;
      confidence: DataStoreOwnerConfidence;
      reason: string;
      disagreement: string;
    }
  | {
      kind: "rule";
      owners: Array<OwnerProposalOwner>;
      ruleName: string;
      matchingStores: number;
      alreadyOwned: number;
    };

// A proposal's plan, as Owners to review draws it; null for one it cannot read.
export function readOwnerProposalView(proposal: {
  kind?: unknown;
  plan?: unknown;
}): OwnerProposalView | null {
  if (proposal.kind === DataSecurityAiProposalKind.SetStoreOwners) {
    const plan: DataStoreOwnersPlan | null = readDataStoreOwnersPlan(
      proposal.plan,
    );

    return plan
      ? {
          kind: "store",
          dataStoreId: plan.dataStoreId,
          dataStoreName: plan.dataStoreName,
          owners: plan.owners.map(
            (owner: DataStoreOwnerCandidate): OwnerProposalOwner => {
              return {
                kind: owner.kind,
                id: owner.id,
                name: owner.name,
                canOpenStore: owner.canOpenStore,
              };
            },
          ),
          confidence: plan.confidence,
          reason: plan.reason,
          disagreement: plan.disagreement,
        }
      : null;
  }

  if (proposal.kind === DataSecurityAiProposalKind.CreateOwnerRule) {
    const plan: DataStoreOwnerRulePlan | null = readDataStoreOwnerRulePlan(
      proposal.plan,
    );

    return plan
      ? {
          kind: "rule",
          owners: plan.owners.map(
            (owner: { kind: DataStoreOwnerKind; id: string; name: string }) => {
              return { ...owner, canOpenStore: true };
            },
          ),
          ruleName: plan.ruleName,
          matchingStores: plan.preview.matchingStores,
          alreadyOwned: plan.preview.alreadyOwned,
        }
      : null;
  }

  return null;
}

// How sure OneUptime AI is, as a chip says it.
export function getOwnerConfidenceChip(confidence: DataStoreOwnerConfidence): {
  text: string;
  tone: PillTone;
} {
  switch (confidence) {
    case DataStoreOwnerConfidence.High:
      return { text: OwnersToReviewCopy.sure, tone: PillTone.Success };
    case DataStoreOwnerConfidence.Medium:
      return { text: OwnersToReviewCopy.fairlySure, tone: PillTone.Info };
    default:
      return { text: OwnersToReviewCopy.notSure, tone: PillTone.Warning };
  }
}

/*
 * Where a row opens: a store's owners its Owners page, where they are
 * added; an owner rule the Owner Rules it joins.
 */
export function getOwnerProposalRoute(proposal: {
  kind?: unknown;
  dataStoreId?: ObjectID | string | undefined;
}): Route {
  if (
    proposal.kind === DataSecurityAiProposalKind.SetStoreOwners &&
    proposal.dataStoreId
  ) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_OWNERS] as Route,
      { modelId: new ObjectID(proposal.dataStoreId.toString()) },
    );
  }

  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_SECURITY_SETTINGS_OWNER_RULES] as Route,
  );
}

// Whether a person may pick other owners before approving: a store's, not a rule's.
export function canChangeOwnersFirst(proposal: { kind?: unknown }): boolean {
  return proposal.kind === DataSecurityAiProposalKind.SetStoreOwners;
}

function readIds(value: unknown): Array<string> {
  return (Array.isArray(value) ? value : [])
    .map((item: unknown): string => {
      if (typeof item === "string") {
        return item;
      }

      if (item instanceof ObjectID) {
        return item.toString();
      }

      if (item && typeof item === "object") {
        const record: { _id?: unknown; id?: unknown } = item as {
          _id?: unknown;
          id?: unknown;
        };

        return String(record._id || record.id || "");
      }

      return "";
    })
    .filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });
}

/*
 * The owners a person picked in the Owners field (ownerUsers and
 * ownerTeams, as the one Owners field writes them), as the approve route
 * takes them: {"owners": [{"kind": "Team", "id": "..."}]}.
 */
export function toOwnerChanges(values: JSONObject): JSONObject {
  return {
    owners: [
      ...readIds(values["ownerTeams"]).map((id: string): JSONObject => {
        return { kind: DataStoreOwnerKind.Team, id };
      }),
      ...readIds(values["ownerUsers"]).map((id: string): JSONObject => {
        return { kind: DataStoreOwnerKind.User, id };
      }),
    ],
  };
}

/*
 * The order a bulk Approve takes the picked proposals in: owner rules
 * first, as picked, then the stores - one rule's approval can own a store
 * whose own proposal is picked after it, which then no longer waits.
 */
export function rulesFirst<T extends { kind?: unknown }>(
  items: ReadonlyArray<T>,
): Array<T> {
  const isRule: (item: T) => boolean = (item: T): boolean => {
    return item.kind === DataSecurityAiProposalKind.CreateOwnerRule;
  };

  return [
    ...items.filter((item: T): boolean => {
      return isRule(item);
    }),
    ...items.filter((item: T): boolean => {
      return !isRule(item);
    }),
  ];
}

// The Owners field's start: the owners OneUptime AI proposed.
export function toOwnersFormValues(
  owners: ReadonlyArray<OwnerProposalOwner>,
): JSONObject {
  return {
    ownerTeams: owners
      .filter((owner: OwnerProposalOwner): boolean => {
        return owner.kind === DataStoreOwnerKind.Team;
      })
      .map((owner: OwnerProposalOwner): string => {
        return owner.id;
      }),
    ownerUsers: owners
      .filter((owner: OwnerProposalOwner): boolean => {
        return owner.kind === DataStoreOwnerKind.User;
      })
      .map((owner: OwnerProposalOwner): string => {
        return owner.id;
      }),
  };
}
