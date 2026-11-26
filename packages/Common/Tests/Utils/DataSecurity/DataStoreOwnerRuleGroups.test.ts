import {
  DataStoreOwnerKind,
  DataStoreOwnerRef,
  DataStoreOwnerRuleFact,
  getOwnerRuleFactKey,
  MIN_STORES_FOR_DATA_STORE_OWNER_RULE,
} from "../../../Types/DataSecurity/DataStoreOwnerProposal";
import {
  DataStoreOwnerRuleGroup,
  DataStoreOwnerRuleGroupStore,
  getDataStoreOwnerRuleGroups,
  MAX_DATA_STORE_OWNER_RULE_GROUPS,
} from "../../../Utils/DataSecurity/DataStoreOwnerRuleGroups";
import { describe, expect, test } from "@jest/globals";

/*
 * THE OWNER RULES THAT KEEP STORES OWNED (#10374): which facts three or
 * more stores' proposed owners rest on - a tag the owners rest on, or the
 * start of a name - never a contested one, a tag the stores merely share,
 * or a set of stores another rule already covers.
 */

const PAYMENTS: DataStoreOwnerRef & { name: string } = {
  kind: DataStoreOwnerKind.Team,
  id: "10374000-0000-4000-8000-00000000a001",
  name: "Payments",
};

const CHECKOUT: DataStoreOwnerRef & { name: string } = {
  kind: DataStoreOwnerKind.Team,
  id: "10374000-0000-4000-8000-00000000a002",
  name: "Checkout",
};

const TEAM_TAG: DataStoreOwnerRuleFact = {
  kind: "CloudTag",
  key: "team",
  value: "payments",
};

const ENV_TAG: DataStoreOwnerRuleFact = {
  kind: "CloudTag",
  key: "env",
  value: "prod",
};

function store(
  index: number,
  overrides: Partial<DataStoreOwnerRuleGroupStore> = {},
): DataStoreOwnerRuleGroupStore {
  return {
    dataStoreId: `10374000-0000-4000-8000-0000000c${String(index).padStart(4, "0")}`,
    dataStoreName: `payments-store-${index}`,
    owners: [PAYMENTS],
    facts: [TEAM_TAG],
    restsOnTagFactKeys: [getOwnerRuleFactKey(TEAM_TAG)],
    ...overrides,
  };
}

describe("a fact three stores' owners rest on", () => {
  test("is a rule: the tag, the owners and the stores", () => {
    const groups: Array<DataStoreOwnerRuleGroup> = getDataStoreOwnerRuleGroups([
      store(3),
      store(1),
      store(2),
    ]);

    expect(groups).toEqual([
      {
        fact: TEAM_TAG,
        owners: [PAYMENTS],
        dataStoreIds: [store(1), store(2), store(3)].map(
          (each: DataStoreOwnerRuleGroupStore): string => {
            return each.dataStoreId;
          },
        ),
        dataStoreNames: [
          "payments-store-1",
          "payments-store-2",
          "payments-store-3",
        ],
      },
    ]);
  });

  test("two stores are not enough", () => {
    expect(MIN_STORES_FOR_DATA_STORE_OWNER_RULE).toBe(3);
    expect(getDataStoreOwnerRuleGroups([store(1), store(2)])).toEqual([]);
  });

  test("a store counts once, however often its fact is listed", () => {
    expect(
      getDataStoreOwnerRuleGroups([
        store(1, { facts: [TEAM_TAG, TEAM_TAG] }),
        store(2),
      ]),
    ).toEqual([]);
  });
});

describe("a tag", () => {
  test("is a fact only where the owners rest on it", () => {
    const shared: Array<DataStoreOwnerRuleGroupStore> = [1, 2, 3].map(
      (index: number) => {
        return store(index, {
          facts: [ENV_TAG],
          restsOnTagFactKeys: [],
        });
      },
    );

    // env=prod is on every one, and says nothing of who owns them.
    expect(getDataStoreOwnerRuleGroups(shared)).toEqual([]);
  });

  test("two sets of owners for one tag make no rule of it", () => {
    expect(
      getDataStoreOwnerRuleGroups([
        store(1),
        store(2),
        store(3),
        store(4, { owners: [CHECKOUT] }),
      ]),
    ).toEqual([]);
  });

  test("the same owners in any order are one set", () => {
    const both: Array<DataStoreOwnerRef & { name: string }> = [
      PAYMENTS,
      CHECKOUT,
    ];

    expect(
      getDataStoreOwnerRuleGroups([
        store(1, { owners: both }),
        store(2, { owners: [...both].reverse() }),
        store(3, { owners: both }),
      ]),
    ).toHaveLength(1);
  });
});

describe("the start of a name", () => {
  const PREFIX: DataStoreOwnerRuleFact = {
    kind: "NamePrefix",
    prefix: "payments-",
  };

  test("is a fact where the stores share it and their owners", () => {
    const groups: Array<DataStoreOwnerRuleGroup> = getDataStoreOwnerRuleGroups(
      [1, 2, 3].map((index: number) => {
        return store(index, { facts: [PREFIX], restsOnTagFactKeys: [] });
      }),
    );

    expect(
      groups.map((group: DataStoreOwnerRuleGroup) => {
        return group.fact;
      }),
    ).toEqual([PREFIX]);
  });

  test("a tag is preferred, and the prefix that covers the same stores is left out", () => {
    const groups: Array<DataStoreOwnerRuleGroup> = getDataStoreOwnerRuleGroups(
      [1, 2, 3].map((index: number) => {
        return store(index, { facts: [TEAM_TAG, PREFIX] });
      }),
    );

    expect(
      groups.map((group: DataStoreOwnerRuleGroup) => {
        return group.fact;
      }),
    ).toEqual([TEAM_TAG]);
  });

  test("a prefix that covers stores the tag does not is a rule of its own", () => {
    const groups: Array<DataStoreOwnerRuleGroup> = getDataStoreOwnerRuleGroups([
      ...[1, 2, 3].map((index: number) => {
        return store(index, { facts: [TEAM_TAG, PREFIX] });
      }),
      store(4, { facts: [PREFIX], restsOnTagFactKeys: [] }),
    ]);

    expect(
      groups.map((group: DataStoreOwnerRuleGroup) => {
        return [group.fact.kind, group.dataStoreIds.length];
      }),
    ).toEqual([
      ["CloudTag", 3],
      ["NamePrefix", 4],
    ]);
  });
});

describe("how many rules", () => {
  test("the facts that cover more stores first, and no more than the most", () => {
    const stores: Array<DataStoreOwnerRuleGroupStore> = [];

    for (
      let group: number = 0;
      group < MAX_DATA_STORE_OWNER_RULE_GROUPS + 5;
      group++
    ) {
      const fact: DataStoreOwnerRuleFact = {
        kind: "CloudTag",
        key: "team",
        value: `team-${group}`,
      };
      const size: number = group === 7 ? 6 : 3;

      for (let index: number = 0; index < size; index++) {
        stores.push(
          store(group * 10 + index, {
            owners: [
              {
                kind: DataStoreOwnerKind.Team,
                id: `10374000-0000-4000-8000-0000000a${String(group).padStart(4, "0")}`,
                name: `Team ${group}`,
              },
            ],
            facts: [fact],
            restsOnTagFactKeys: [getOwnerRuleFactKey(fact)],
          }),
        );
      }
    }

    const groups: Array<DataStoreOwnerRuleGroup> =
      getDataStoreOwnerRuleGroups(stores);

    expect(groups).toHaveLength(MAX_DATA_STORE_OWNER_RULE_GROUPS);
    expect(groups[0]!.dataStoreIds).toHaveLength(6);
  });

  test("a store with no owners counts toward no rule", () => {
    expect(
      getDataStoreOwnerRuleGroups([
        store(1, { owners: [] }),
        store(2, { owners: [] }),
        store(3, { owners: [] }),
      ]),
    ).toEqual([]);
  });
});
