import {
  DataStoreOwnerConfidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnerKind,
  DataStoreOwnerRuleFact,
  DataStoreOwnerRulePlan,
  DataStoreOwnersPlan,
  describeOwnerRuleFact,
  findEmailAddresses,
  foldOwnerName,
  getOwnerNameForms,
  getOwnerRuleFactKey,
  getOwnerRulePattern,
  getOwnersKey,
  getStoreNamePrefix,
  getStoreOwnerRuleFacts,
  isOwnerTagKey,
  isSameOwnerName,
  listOwnerNames,
  readDataStoreOwnerRulePlan,
  readDataStoreOwnersPlan,
} from "../../../Types/DataSecurity/DataStoreOwnerProposal";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT POINTS TO A STORE'S OWNERS, AND WHAT IS PROPOSED FROM IT (#10374):
 * the plain rules every part of the feature reads - which tags name an
 * owner, how a name is matched to a team, which facts of a store a rule can
 * say and how, and a stored plan read back defensively.
 */

const TEAM_ID: string = "10374000-0000-4000-8000-00000000a001";
const USER_ID: string = "10374000-0000-4000-8000-00000000b001";
const STORE_ID: string = "10374000-0000-4000-8000-00000000c001";

describe("which tags name an owner", () => {
  test.each([
    "owner",
    "Owner",
    "OWNER",
    "owners",
    "team",
    "Team",
    "team_name",
    "owner-team",
    "owning_team",
    "contact",
    "owner.email",
    "data-owner",
    "maintainer",
    "created-by",
    "acme:owner",
    "app/team",
    "acme.io/owner",
  ])("%s does", (key: string) => {
    expect(isOwnerTagKey(key)).toBe(true);
  });

  test.each([
    "env",
    "environment",
    "cost-center",
    "Name",
    "terraform",
    "teamwork",
    "ownership-cost",
    "",
  ])("%s does not", (key: string) => {
    expect(isOwnerTagKey(key)).toBe(false);
  });
});

describe("a name, as it is matched to a team", () => {
  test("case, separators and a handle's organization are folded away", () => {
    expect(foldOwnerName("Payments Team")).toBe("payments team");
    expect(foldOwnerName("@acme/payments-team")).toBe("payments team");
    expect(foldOwnerName("acme/payments")).toBe("payments");
    expect(foldOwnerName("  data_platform ")).toBe("data platform");
  });

  test("a last word that only says it is a team may be left out", () => {
    expect(getOwnerNameForms("Payments Team")).toEqual([
      "payments team",
      "payments",
    ]);
    expect(getOwnerNameForms("Payments")).toEqual(["payments"]);
    expect(getOwnerNameForms("team")).toEqual(["team"]);
    expect(getOwnerNameForms("")).toEqual([]);
  });

  test("a handle and a team's name name the same team", () => {
    expect(isSameOwnerName("@acme/payments-team", "Payments")).toBe(true);
    expect(isSameOwnerName("payments", "Payments Squad")).toBe(true);
    expect(isSameOwnerName("payments", "Payroll")).toBe(false);
    // Never a part of a word.
    expect(isSameOwnerName("pay", "Payments")).toBe(false);
  });
});

describe("email addresses in what a tag or a cloud's change log says", () => {
  test("each address, in lower case, once", () => {
    expect(
      findEmailAddresses(
        "Alice@Acme.com, bob@acme.co.uk; alice@acme.com and nobody",
      ),
    ).toEqual(["alice@acme.com", "bob@acme.co.uk"]);
  });

  test("an AWS SSO session names the person by email", () => {
    expect(
      findEmailAddresses(
        "arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_Admin_abc/alice@acme.com",
      ),
    ).toEqual(["alice@acme.com"]);
  });

  test("a role or an automation names no address", () => {
    expect(
      findEmailAddresses("arn:aws:iam::123456789012:role/terraform-apply"),
    ).toEqual([]);
  });
});

describe("the start of a store's name a rule could match", () => {
  test.each([
    ["payments-ledger", "payments-"],
    ["payments_ledger", "payments_"],
    ["Checkout.Orders", "checkout."],
    ["ledger", null],
    ["pa-ledger", null],
    ["prod-orders", null],
    ["logs-archive", null],
    ["backup-2026", null],
    ["9lives-ledger", null],
  ])("%s starts %s", (name: string, prefix: string | null) => {
    expect(getStoreNamePrefix(name)).toBe(prefix);
  });
});

describe("what a rule could say of a store", () => {
  test("each owner tag, then the start of its name", () => {
    expect(
      getStoreOwnerRuleFacts({
        name: "payments-ledger",
        cloudTags: { team: "payments", env: "prod", owner: "alice@acme.com" },
      }),
    ).toEqual([
      { kind: "CloudTag", key: "owner", value: "alice@acme.com" },
      { kind: "CloudTag", key: "team", value: "payments" },
      { kind: "NamePrefix", prefix: "payments-" },
    ]);
  });

  test("a store with no owner tag and a one-word name has nothing a rule could say", () => {
    expect(
      getStoreOwnerRuleFacts({ name: "ledger", cloudTags: { env: "prod" } }),
    ).toEqual([]);
  });

  test("a tag fact and a prefix fact are told apart by kind", () => {
    expect(
      getOwnerRuleFactKey({ kind: "CloudTag", key: "Team", value: "Payments" }),
    ).toBe("tag:team=payments");
    expect(
      getOwnerRuleFactKey({ kind: "NamePrefix", prefix: "payments-" }),
    ).toBe("prefix:payments-");
  });
});

describe("an owner rule's pattern for a fact", () => {
  test("a tag is matched whole, as the Owner Rules form writes one", () => {
    const fact: DataStoreOwnerRuleFact = {
      kind: "CloudTag",
      key: "team",
      value: "payments",
    };

    expect(getOwnerRulePattern(fact)).toEqual({
      cloudTagPattern: "^team=payments$",
    });
    expect(
      RulePatternMatchUtil.matches(
        "team=payments",
        getOwnerRulePattern(fact).cloudTagPattern,
      ),
    ).toBe(true);
    expect(
      RulePatternMatchUtil.matches(
        "team=payments-eu",
        getOwnerRulePattern(fact).cloudTagPattern,
      ),
    ).toBe(false);
  });

  test("what a pattern reads as syntax is matched as itself", () => {
    const fact: DataStoreOwnerRuleFact = {
      kind: "CloudTag",
      key: "team",
      value: "payments.eu (core)",
    };
    const pattern: string = getOwnerRulePattern(fact).cloudTagPattern!;

    expect(pattern).toBe("^team=payments\\.eu \\(core\\)$");
    expect(
      RulePatternMatchUtil.matches("team=payments.eu (core)", pattern),
    ).toBe(true);
    expect(
      RulePatternMatchUtil.matches("team=paymentsXeu (core)", pattern),
    ).toBe(false);
  });

  test("a name's start is matched from the first letter", () => {
    const pattern: string = getOwnerRulePattern({
      kind: "NamePrefix",
      prefix: "payments-",
    }).nameRegexPattern!;

    expect(pattern).toBe("^payments-");
    expect(RulePatternMatchUtil.matches("payments-ledger", pattern)).toBe(true);
    expect(RulePatternMatchUtil.matches("old-payments-ledger", pattern)).toBe(
      false,
    );
  });

  test("a fact in words, for a rule's name", () => {
    expect(
      describeOwnerRuleFact({
        kind: "CloudTag",
        key: "team",
        value: "payments",
      }),
    ).toBe("tagged team=payments");
    expect(describeOwnerRuleFact({ kind: "NamePrefix", prefix: "pay-" })).toBe(
      "whose names start with pay-",
    );
  });
});

describe("owners, as a set and in a sentence", () => {
  test("the same owners make the same key, in any order and case", () => {
    expect(
      getOwnersKey([
        { kind: DataStoreOwnerKind.User, id: USER_ID.toUpperCase() },
        { kind: DataStoreOwnerKind.Team, id: TEAM_ID },
        { kind: DataStoreOwnerKind.Team, id: TEAM_ID },
      ]),
    ).toBe(
      getOwnersKey([
        { kind: DataStoreOwnerKind.Team, id: TEAM_ID },
        { kind: DataStoreOwnerKind.User, id: USER_ID },
      ]),
    );
  });

  test("names in a list", () => {
    expect(listOwnerNames(["Payments"])).toBe("Payments");
    expect(listOwnerNames(["Payments", "Alice"])).toBe("Payments and Alice");
    expect(listOwnerNames(["Payments", "", "Alice", "Bob"])).toBe(
      "Payments, Alice and Bob",
    );
    expect(listOwnerNames([])).toBe("");
  });
});

function storedOwnersPlan(): DataStoreOwnersPlan {
  return {
    dataStoreId: STORE_ID,
    dataStoreName: "payments-ledger",
    owners: [
      {
        kind: DataStoreOwnerKind.Team,
        id: TEAM_ID,
        ref: "T1",
        name: "Payments",
        evidenceIds: ["E1"],
        canOpenStore: true,
      },
    ],
    confidence: DataStoreOwnerConfidence.High,
    reason: "The team tag names Payments.",
    disagreement: "",
    restsOn: ["E1"],
    evidence: [
      {
        id: "E1",
        source: DataStoreOwnerEvidenceSource.CloudTag,
        tagKey: "team",
        tagValue: "payments",
        owners: [{ kind: DataStoreOwnerKind.Team, id: TEAM_ID }],
      },
    ],
    candidates: [
      {
        kind: DataStoreOwnerKind.Team,
        id: TEAM_ID,
        ref: "T1",
        name: "Payments",
        evidenceIds: ["E1"],
        canOpenStore: true,
      },
    ],
    ruleFacts: [{ kind: "CloudTag", key: "team", value: "payments" }],
    isSensitive: true,
  };
}

describe("a store's owners plan, read back", () => {
  test("as it was stored", () => {
    const plan: DataStoreOwnersPlan = storedOwnersPlan();

    expect(readDataStoreOwnersPlan(JSON.parse(JSON.stringify(plan)))).toEqual({
      ...plan,
      evidence: [
        {
          ...plan.evidence[0]!,
          serviceId: undefined,
          serviceName: undefined,
          isServiceTelemetry: undefined,
          repositoryName: undefined,
          filePath: undefined,
          codeOwnersPath: undefined,
          codeOwner: undefined,
          operation: undefined,
          changeCount: undefined,
          lastChangedAt: undefined,
          unmatched: undefined,
        },
      ],
    });
  });

  test("a plan that names no store, or no owner, is none", () => {
    expect(readDataStoreOwnersPlan(null)).toBeNull();
    expect(readDataStoreOwnersPlan("owners")).toBeNull();
    expect(
      readDataStoreOwnersPlan({ ...storedOwnersPlan(), dataStoreId: "" }),
    ).toBeNull();
    expect(
      readDataStoreOwnersPlan({ ...storedOwnersPlan(), owners: [] }),
    ).toBeNull();
  });

  test("what a newer server wrote and this build does not know is left out", () => {
    const read: DataStoreOwnersPlan | null = readDataStoreOwnersPlan({
      ...storedOwnersPlan(),
      confidence: "Certain",
      owners: [
        ...storedOwnersPlan().owners,
        { kind: "Robot", id: USER_ID, ref: "R1", name: "A robot" },
        { kind: DataStoreOwnerKind.User, ref: "P1", name: "No id" },
      ],
      evidence: [
        ...storedOwnersPlan().evidence,
        { id: "E2", source: "Telepathy", owners: [] },
      ],
      ruleFacts: [
        { kind: "CloudTag", key: "team", value: "payments" },
        { kind: "Label", label: "pci" },
      ],
    });

    expect(read?.confidence).toBe(DataStoreOwnerConfidence.Low);
    expect(read?.owners).toHaveLength(1);
    expect(read?.evidence).toHaveLength(1);
    expect(read?.ruleFacts).toEqual([
      { kind: "CloudTag", key: "team", value: "payments" },
    ]);
  });
});

function storedRulePlan(): DataStoreOwnerRulePlan {
  return {
    fact: { kind: "CloudTag", key: "team", value: "payments" },
    ruleName: "Payments owns stores tagged team=payments",
    cloudTagPattern: "^team=payments$",
    owners: [{ kind: DataStoreOwnerKind.Team, id: TEAM_ID, name: "Payments" }],
    dataStoreIds: [STORE_ID],
    preview: {
      matchingStores: 14,
      alreadyOwned: 3,
      storeNames: ["payments-ledger"],
      previewedAt: "2026-11-21T00:00:00.000Z",
    },
  };
}

describe("an owner rule's plan, read back", () => {
  test("as it was stored", () => {
    const read: DataStoreOwnerRulePlan | null = readDataStoreOwnerRulePlan(
      JSON.parse(JSON.stringify(storedRulePlan())),
    );

    expect(read).toEqual({
      ...storedRulePlan(),
      nameRegexPattern: undefined,
    });
  });

  test("a rule that says no fact, no pattern or no owner is none", () => {
    expect(
      readDataStoreOwnerRulePlan({ ...storedRulePlan(), fact: null }),
    ).toBeNull();
    expect(
      readDataStoreOwnerRulePlan({
        ...storedRulePlan(),
        cloudTagPattern: undefined,
      }),
    ).toBeNull();
    expect(
      readDataStoreOwnerRulePlan({ ...storedRulePlan(), owners: [] }),
    ).toBeNull();
  });

  test("a preview's counts are whole and never below none", () => {
    const read: DataStoreOwnerRulePlan | null = readDataStoreOwnerRulePlan({
      ...storedRulePlan(),
      preview: { matchingStores: 3.7, alreadyOwned: -2, storeNames: "x" },
    });

    expect(read?.preview.matchingStores).toBe(3);
    expect(read?.preview.alreadyOwned).toBe(0);
    expect(read?.preview.storeNames).toEqual([]);
  });
});
