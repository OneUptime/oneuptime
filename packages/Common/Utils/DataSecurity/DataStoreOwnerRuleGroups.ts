import {
  DataStoreOwnerRef,
  DataStoreOwnerRuleFact,
  getOwnerRuleFactKey,
  getOwnersKey,
  MIN_STORES_FOR_DATA_STORE_OWNER_RULE,
} from "../../Types/DataSecurity/DataStoreOwnerProposal";

/*
 * THE OWNER RULES THAT KEEP STORES OWNED (#10374): which facts several
 * stores' owners rest on.
 *
 * OneUptime AI proposes each store's owners from its own evidence. Where
 * MIN_STORES_FOR_DATA_STORE_OWNER_RULE or more of those proposals name the
 * same owners and rest on the same fact, that fact is a rule: the next
 * store like them is owned the day it is found, instead of waiting for a
 * proposal of its own.
 *
 *   - A cloud tag is a fact a store's owners rest on only where the
 *     evidence the proposal rests on is that tag: "team=payments" names
 *     Payments. A tag the stores merely share ("env=prod") is never one.
 *   - A name's start ("payments-") is one where the stores share it and
 *     their owners: the prefix is what they have in common.
 *   - A fact two proposals give different owners for is contested, and no
 *     rule is made of it: a rule would be wrong for one of them.
 *   - A tag is preferred to a name's start, and the facts that cover more
 *     stores first; a fact whose stores another rule of the same owners
 *     already covers is left out, so one set of stores gets one rule.
 *
 * Pure: the server reads the proposals, asks the rule engine what each
 * rule would do, and proposes it (DataStoreOwnerRuleProposals).
 */

// The most rules one project is proposed at once.
export const MAX_DATA_STORE_OWNER_RULE_GROUPS: number = 20;

export interface DataStoreOwnerRuleGroupStore {
  dataStoreId: string;
  dataStoreName: string;
  // The owners proposed for the store, each with its name.
  owners: Array<DataStoreOwnerRef & { name: string }>;
  // What a rule could say of the store (getStoreOwnerRuleFacts).
  facts: Array<DataStoreOwnerRuleFact>;
  // The facts of its cloud tags its owners rest on, by getOwnerRuleFactKey.
  restsOnTagFactKeys: Array<string>;
}

export interface DataStoreOwnerRuleGroup {
  fact: DataStoreOwnerRuleFact;
  owners: Array<DataStoreOwnerRef & { name: string }>;
  dataStoreIds: Array<string>;
  dataStoreNames: Array<string>;
}

interface Bucket {
  fact: DataStoreOwnerRuleFact;
  owners: Array<DataStoreOwnerRef & { name: string }>;
  stores: Array<DataStoreOwnerRuleGroupStore>;
}

export function getDataStoreOwnerRuleGroups(
  stores: ReadonlyArray<DataStoreOwnerRuleGroupStore>,
  options?: { minStores?: number; maxGroups?: number },
): Array<DataStoreOwnerRuleGroup> {
  const minStores: number =
    options?.minStores || MIN_STORES_FOR_DATA_STORE_OWNER_RULE;
  const maxGroups: number =
    options?.maxGroups || MAX_DATA_STORE_OWNER_RULE_GROUPS;

  // Fact, then the owners its stores' proposals name.
  const byFact: Map<string, Map<string, Bucket>> = new Map();

  for (const store of stores) {
    if (store.owners.length === 0) {
      continue;
    }

    const ownersKey: string = getOwnersKey(store.owners);
    const seen: Set<string> = new Set();

    for (const fact of store.facts) {
      const factKey: string = getOwnerRuleFactKey(fact);

      if (
        seen.has(factKey) ||
        (fact.kind === "CloudTag" &&
          !store.restsOnTagFactKeys.includes(factKey))
      ) {
        continue;
      }

      seen.add(factKey);

      const ofFact: Map<string, Bucket> = byFact.get(factKey) || new Map();
      const bucket: Bucket = ofFact.get(ownersKey) || {
        fact,
        owners: store.owners,
        stores: [],
      };

      bucket.stores.push(store);
      ofFact.set(ownersKey, bucket);
      byFact.set(factKey, ofFact);
    }
  }

  const candidates: Array<Bucket> = [];

  for (const ofFact of byFact.values()) {
    // Contested: two sets of owners for one fact.
    if (ofFact.size !== 1) {
      continue;
    }

    const bucket: Bucket = Array.from(ofFact.values())[0]!;

    if (bucket.stores.length >= minStores) {
      candidates.push(bucket);
    }
  }

  candidates.sort((left: Bucket, right: Bucket): number => {
    const leftTag: number = left.fact.kind === "CloudTag" ? 0 : 1;
    const rightTag: number = right.fact.kind === "CloudTag" ? 0 : 1;

    return (
      leftTag - rightTag ||
      right.stores.length - left.stores.length ||
      getOwnerRuleFactKey(left.fact).localeCompare(
        getOwnerRuleFactKey(right.fact),
      )
    );
  });

  const groups: Array<DataStoreOwnerRuleGroup> = [];
  const coveredByOwners: Map<string, Set<string>> = new Map();

  for (const bucket of candidates) {
    if (groups.length >= maxGroups) {
      break;
    }

    const ownersKey: string = getOwnersKey(bucket.owners);
    const covered: Set<string> = coveredByOwners.get(ownersKey) || new Set();

    if (
      bucket.stores.every((store: DataStoreOwnerRuleGroupStore): boolean => {
        return covered.has(store.dataStoreId);
      })
    ) {
      continue;
    }

    for (const store of bucket.stores) {
      covered.add(store.dataStoreId);
    }

    coveredByOwners.set(ownersKey, covered);

    const sorted: Array<DataStoreOwnerRuleGroupStore> = [...bucket.stores].sort(
      (
        left: DataStoreOwnerRuleGroupStore,
        right: DataStoreOwnerRuleGroupStore,
      ): number => {
        return left.dataStoreName.localeCompare(right.dataStoreName);
      },
    );

    groups.push({
      fact: bucket.fact,
      owners: bucket.owners,
      dataStoreIds: sorted.map((store: DataStoreOwnerRuleGroupStore) => {
        return store.dataStoreId;
      }),
      dataStoreNames: sorted.map((store: DataStoreOwnerRuleGroupStore) => {
        return store.dataStoreName;
      }),
    });
  }

  return groups;
}
