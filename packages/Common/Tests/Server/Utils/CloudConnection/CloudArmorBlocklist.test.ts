import { describe, expect, test } from "@jest/globals";
import CloudArmorApi from "../../../../Server/Utils/CloudConnection/Gcp/CloudArmorApi";
import CloudArmorPolicyBlocklist, {
  CloudArmorState,
  CloudArmorWriteResult,
} from "../../../../Server/Utils/CloudConnection/Gcp/CloudArmorBlocklist";
import {
  CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY,
  CloudArmorBlocklistMode,
  CloudArmorPolicyRef,
  CloudArmorRuleDetails,
  parseCloudArmorPolicyId,
} from "../../../../Types/CloudConnection/CloudArmorBlocklist";
import { JSONObject } from "../../../../Types/JSON";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafStatus,
} from "../../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { fillSecurityBlockReason } from "../../../../Types/SecurityBlocklist/SecurityBlockReason";
import {
  FAKE_ARMOR_POLICY_ID,
  FAKE_EDGE_ARMOR_POLICY_ID,
  FAKE_GCP_KEY,
  FAKE_REGIONAL_ARMOR_POLICY_ID,
  FakeCloudArmor,
  createFakeCloudArmor,
  defaultRule,
  recordedBackendPolicy,
  recordedEdgePolicy,
  recordedRegionalPolicy,
} from "./FakeCloudArmor";
import { json } from "../LlmObservability/FakeProviderApi";

/*
 * THE BLOCKLIST'S RULES IN A CLOUD ARMOR SECURITY POLICY (#10349), against
 * Compute Engine's security policy methods and Network Security's address
 * groups as Google answers them (FakeCloudArmor): OneUptime's own rules,
 * each added, patched and removed on its own with addRule, patchRule and
 * removeRule - never the policy written whole, never a rule of the
 * customer's - or, for a global backend policy of a Cloud Armor Enterprise
 * project, the project's two address groups and one rule that denies what
 * they hold.
 *
 * Pinned: the mode picked from the tier and the policy's type; rules of 10
 * ranges at the free priorities before the first rule that lets a request
 * through; adding and removing across rules; a rule read again by its
 * priority before it is patched or removed; the user IP; the address
 * groups made, filled and emptied, and full; a rule set to preview,
 * changed or deleted by hand, a group deleted, and Put It Back; no free
 * priority; a quota used up; Remove; and the access check.
 */

const SUFFIX: string = "1a2b3c4d";

function api(fake: FakeCloudArmor): CloudArmorApi {
  return new CloudArmorApi({
    serviceAccountJson: FAKE_GCP_KEY,
    transport: fake.transport,
    sleep: async (): Promise<void> => {
      return undefined;
    },
  });
}

function ref(id: string = FAKE_ARMOR_POLICY_ID): CloudArmorPolicyRef {
  return parseCloudArmorPolicyId(id)!;
}

function keeperOf(data: {
  fake: FakeCloudArmor;
  id?: string | undefined;
  clientAddress?: SecurityBlockClientAddress | undefined;
  details?: CloudArmorRuleDetails | null | undefined;
}): CloudArmorPolicyBlocklist {
  const policy: CloudArmorPolicyRef = ref(data.id);

  return new CloudArmorPolicyBlocklist({
    api: api(data.fake),
    policy,
    displayName: policy.name,
    projectSuffix: SUFFIX,
    clientAddress: data.clientAddress || SecurityBlockClientAddress.SourceIp,
    details: data.details ?? null,
  });
}

// Set up, as the first Check Again does, and handed on as the next pass's keeper would be.
async function setUp(data: {
  fake: FakeCloudArmor;
  id?: string | undefined;
  clientAddress?: SecurityBlockClientAddress | undefined;
}): Promise<CloudArmorPolicyBlocklist> {
  const keeper: CloudArmorPolicyBlocklist = keeperOf(data);

  await keeper.setUp();

  return keeperOf({ ...data, details: keeper.getDetails() });
}

function next(
  fake: FakeCloudArmor,
  keeper: CloudArmorPolicyBlocklist,
  data: { id?: string; clientAddress?: SecurityBlockClientAddress } = {},
): CloudArmorPolicyBlocklist {
  return keeperOf({ fake, ...data, details: keeper.getDetails() });
}

function addresses(count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`;
  });
}

function ranges(rule: JSONObject | undefined): Array<string> {
  return (
    (((rule?.["match"] as JSONObject)?.["config"] as JSONObject)?.[
      "srcIpRanges"
    ] as Array<string>) || []
  );
}

function customerRules(fake: FakeCloudArmor, id: string): Array<JSONObject> {
  return fake.rules(id).filter((rule: JSONObject): boolean => {
    return !String(rule["description"] || "").startsWith("OneUptime blocklist");
  });
}

function done(results: Array<CloudArmorWriteResult>): Array<string> {
  return results
    .filter((result: CloudArmorWriteResult): boolean => {
      return result.isDone;
    })
    .map((result: CloudArmorWriteResult): string => {
      return result.value;
    });
}

describe("rules mode, without Cloud Armor Enterprise", () => {
  test("rules of 10 ranges at the lowest free priorities before the first rule that lets a request through, each added on its own; the customer's rules untouched", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor();
    const before: Array<JSONObject> = fake.rules(FAKE_ARMOR_POLICY_ID);
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    expect(keeper.getDetails().mode).toBe(CloudArmorBlocklistMode.Rules);
    expect(keeper.getDetails().tier).toBe("CA_STANDARD");

    const blocks: Array<string> = [...addresses(11), "2001:db8::1"];
    const result: { added: Array<CloudArmorWriteResult> } = await keeper.change(
      { add: blocks, remove: [] },
    );

    expect(done(result.added)).toEqual(blocks);
    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)).toEqual({
      kind: "compute#securityPolicyRule",
      priority: 0,
      description:
        "OneUptime blocklist 1a2b3c4d #1. Managed by OneUptime: changes here are replaced.",
      action: "deny(403)",
      preview: false,
      match: {
        versionedExpr: "SRC_IPS_V1",
        config: {
          srcIpRanges: addresses(10).map((value: string): string => {
            return `${value}/32`;
          }),
        },
      },
    });
    expect(ranges(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 1))).toEqual([
      "198.18.0.11/32",
      "2001:db8::1/128",
    ]);
    expect(customerRules(fake, FAKE_ARMOR_POLICY_ID)).toEqual(before);
    // One method a rule, never the policy whole: reads, then one addRule a rule.
    expect(
      fake.calls().filter((call: string): boolean => {
        return !call.startsWith("operations.") && call !== "get prod-lb";
      }),
    ).toEqual(["projects.get", "addRule prod-lb", "addRule prod-lb"]);

    const state: CloudArmorState = await next(fake, keeper).readState();

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(state.held).toHaveLength(12);
    expect(state.held[0]!.holder).toBe("priority 0");
    // Twenty rules of ten.
    expect(state.capacity).toBe(200);
  });

  test("a lifted block comes out of its rule with patchRule, an emptied rule goes with removeRule, each read again by its priority first", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor();
    let keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    await keeper.change({ add: addresses(12), remove: [] });
    keeper = next(fake, keeper);

    const calls: number = fake.calls().length;

    await keeper.change({
      add: ["35.205.11.131"],
      remove: ["198.18.0.1", "198.18.0.11", "198.18.0.12"],
    });

    const made: Array<string> = fake.calls().slice(calls);

    expect(made).toContain("getRule prod-lb");
    expect(made).toContain("patchRule prod-lb");
    expect(made).toContain("removeRule prod-lb");
    expect(made).not.toContain("addRule prod-lb");
    expect(ranges(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0))).toContain(
      "35.205.11.131/32",
    );
    expect(ranges(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0))).not.toContain(
      "198.18.0.1/32",
    );
    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 1)).toBeUndefined();
  });

  test("a rule at OneUptime's priority that is no longer OneUptime's is never patched or removed", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor();
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    await keeper.change({ add: ["35.205.11.131"], remove: [] });

    // Read by this pass, then replaced at priority 0 by a rule of the customer's.
    const pass: CloudArmorPolicyBlocklist = next(fake, keeper);

    await pass.readState();
    fake.changeBehind(FAKE_ARMOR_POLICY_ID, (policy: JSONObject): void => {
      const rules: Array<JSONObject> = policy["rules"] as Array<JSONObject>;
      rules[0] = {
        kind: "compute#securityPolicyRule",
        description: "Ours now: rate limit the API",
        priority: 0,
        match: { expr: { expression: "request.path.startsWith('/api')" } },
        action: "throttle",
        preview: false,
      };
    });

    await pass.change({ add: [], remove: ["35.205.11.131"] });

    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)!["description"]).toBe(
      "Ours now: rate limit the API",
    );
    expect(fake.calls()).not.toContain("removeRule prod-lb");
  });

  test("the user IP is matched with inIpRange(origin.user_ip, ...) terms, and the rules are written again when the person changes where it is read", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor();
    const keeper: CloudArmorPolicyBlocklist = await setUp({
      fake,
      clientAddress: SecurityBlockClientAddress.UserIp,
    });

    await keeper.change({
      add: ["35.205.11.131", "2001:db8::/32"],
      remove: [],
    });

    expect(
      (
        (fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)!["match"] as JSONObject)[
          "expr"
        ] as JSONObject
      )["expression"],
    ).toBe(
      "inIpRange(origin.user_ip, '35.205.11.131/32') || inIpRange(origin.user_ip, '2001:db8::/32')",
    );

    // Back to the address that connected: the next pass's first step writes it again.
    const back: CloudArmorPolicyBlocklist = next(fake, keeper, {
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(await back.rewriteIfNeeded()).toBe(true);
    expect(ranges(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0))).toEqual([
      "35.205.11.131/32",
      "2001:db8::/32",
    ]);
  });

  test("an edge security policy, and a regional one, hold the blocklist in rules even with Cloud Armor Enterprise", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor({
      tier: "CA_ENTERPRISE_PAYGO",
      policies: [
        { id: FAKE_EDGE_ARMOR_POLICY_ID, policy: recordedEdgePolicy() },
        { id: FAKE_REGIONAL_ARMOR_POLICY_ID, policy: recordedRegionalPolicy() },
      ],
    });

    for (const id of [
      FAKE_EDGE_ARMOR_POLICY_ID,
      FAKE_REGIONAL_ARMOR_POLICY_ID,
    ]) {
      const keeper: CloudArmorPolicyBlocklist = await setUp({ fake, id });

      expect(keeper.getDetails().mode).toBe(CloudArmorBlocklistMode.Rules);
      await keeper.change({ add: ["35.205.11.131"], remove: [] });
      expect(ranges(fake.ruleAt(id, 0))).toEqual(["35.205.11.131/32"]);
    }

    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv4`)).toBeUndefined();
    // A regional policy's write is waited for in its region.
    expect(
      fake.requests.some((request: { url: string }): boolean => {
        return request.url.includes("/regions/europe-west1/operations/");
      }),
    ).toBe(true);
  });

  test("no free priority before the first rule that lets a request through: No Free Priority, and no rule of the customer's renumbered", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor({
      policies: [
        {
          id: FAKE_ARMOR_POLICY_ID,
          policy: recordedBackendPolicy([
            {
              kind: "compute#securityPolicyRule",
              description: "Allow health checks",
              priority: 0,
              match: {
                versionedExpr: "SRC_IPS_V1",
                config: { srcIpRanges: ["35.191.0.0/16"] },
              },
              action: "allow",
              preview: false,
            },
            defaultRule(),
          ]),
        },
      ],
    });
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    expect((await next(fake, keeper).readState()).status).toBe(
      SecurityBlockCloudWafStatus.NoFreePriority,
    );

    const result: { added: Array<CloudArmorWriteResult> } = await next(
      fake,
      keeper,
    ).change({ add: ["35.205.11.131"], remove: [] });

    expect(result.added[0]!.isDone).toBe(false);
    expect(fillSecurityBlockReason(result.added[0]!.reason!)).toBe(
      "prod-lb has no free priority before your first Allow rule (priority 0) for another rule of OneUptime's, and OneUptime never renumbers your rules. Free a priority before it, and OneUptime adds its rule there.",
    );
    expect(fake.calls()).not.toContain("addRule prod-lb");
  });

  test("past 20 rules of 10, a block is said not to fit, naming what holds more", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor();
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    const result: { added: Array<CloudArmorWriteResult> } = await keeper.change(
      {
        add: addresses(201),
        remove: [],
      },
    );

    expect(done(result.added)).toHaveLength(200);
    expect(fillSecurityBlockReason(result.added[200]!.reason!)).toBe(
      "prod-lb is full: OneUptime's rules there hold 200 addresses, 10 to a rule. A global backend policy of a project with Cloud Armor Enterprise holds far more, in address groups.",
    );
  });

  test("a quota used up is said as one, not as a missing permission", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor();
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    fake.failNext(
      "addRule",
      json(
        {
          error: {
            code: 403,
            message:
              "Quota 'SECURITY_POLICY_RULES' exceeded. Limit: 200.0 globally.",
            errors: [
              {
                message:
                  "Quota 'SECURITY_POLICY_RULES' exceeded. Limit: 200.0 globally.",
                domain: "usageLimits",
                reason: "quotaExceeded",
              },
            ],
          },
        },
        403,
      ),
    );

    const result: { added: Array<CloudArmorWriteResult> } = await keeper.change(
      {
        add: ["35.205.11.131"],
        remove: [],
      },
    );

    expect(fillSecurityBlockReason(result.added[0]!.reason!)).toContain(
      "Google Cloud refused another rule in prod-lb as over a quota",
    );

    // A refusal that is one names the permission.
    fake.failNext(
      "addRule",
      json(
        {
          error: {
            code: 403,
            message:
              "Required 'compute.securityPolicies.update' permission for 'projects/acme-prod/global/securityPolicies/prod-lb'",
            errors: [
              { message: "forbidden", domain: "global", reason: "forbidden" },
            ],
          },
        },
        403,
      ),
    );

    const refused: { added: Array<CloudArmorWriteResult> } = await next(
      fake,
      keeper,
    ).change({ add: ["35.205.11.131"], remove: [] });

    expect(fillSecurityBlockReason(refused.added[0]!.reason!)).toBe(
      "OneUptime may not write prod-lb: the connection has no compute.securityPolicies.update there. Grant it with the lines the Add WAF dialog shows for the policy, then select Check Again.",
    );
  });
});

describe("a rule of OneUptime's changed by hand", () => {
  async function written(): Promise<{
    fake: FakeCloudArmor;
    keeper: CloudArmorPolicyBlocklist;
  }> {
    const fake: FakeCloudArmor = createFakeCloudArmor();
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    await keeper.change({
      add: ["35.205.11.131", "45.155.205.233"],
      remove: [],
    });

    return { fake, keeper: next(fake, keeper) };
  }

  test("set to preview: its blocks not in force and why, kept in preview by a pass - Put It Back enforces it again", async () => {
    const { fake, keeper } = await written();

    fake.changeBehind(FAKE_ARMOR_POLICY_ID, (policy: JSONObject): void => {
      (policy["rules"] as Array<JSONObject>)[0]!["preview"] = true;
    });

    const state: CloudArmorState = await keeper.readState(true);

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Drifted);
    expect(fillSecurityBlockReason(state.reason!)).toBe(
      "OneUptime's rule at priority 0 in prod-lb was set to preview by hand, so the blocks it holds are not enforced. Select Put It Back to enforce it again.",
    );

    await keeper.change({ add: [], remove: ["45.155.205.233"] });

    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)!["preview"]).toBe(true);
    expect(ranges(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0))).toEqual([
      "35.205.11.131/32",
    ]);

    const back: CloudArmorState = await next(fake, keeper).putBack();

    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)!["preview"]).toBe(false);
    expect(ranges(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0))).toEqual([
      "35.205.11.131/32",
    ]);
    expect(back.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
  });

  test("changed to allow: never written over by a pass - Put It Back denies again, holding what OneUptime meant it to", async () => {
    const { fake, keeper } = await written();

    fake.changeBehind(FAKE_ARMOR_POLICY_ID, (policy: JSONObject): void => {
      (policy["rules"] as Array<JSONObject>)[0]!["action"] = "allow";
    });

    expect((await keeper.readState(true)).status).toBe(
      SecurityBlockCloudWafStatus.Drifted,
    );

    await keeper.change({ add: [], remove: ["35.205.11.131"] });

    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)!["action"]).toBe("allow");

    await next(fake, keeper).putBack();

    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)!["action"]).toBe("deny(403)");
    // The block lifted while it was changed stays lifted.
    expect(ranges(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0))).toEqual([
      "45.155.205.233/32",
    ]);
  });

  test("deleted: its blocks said not to be enforced, not added back by a pass - Put It Back adds it again at its own priority", async () => {
    const { fake, keeper } = await written();

    fake.changeBehind(FAKE_ARMOR_POLICY_ID, (policy: JSONObject): void => {
      (policy["rules"] as Array<JSONObject>).splice(0, 1);
    });

    const state: CloudArmorState = await keeper.readState(true);

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Drifted);
    expect(fillSecurityBlockReason(state.held[0]!.notInForce!)).toBe(
      "OneUptime's rule at priority 0 in prod-lb was deleted by hand, so the blocks it held are not enforced. Select Put It Back to add it again.",
    );

    await keeper.change({ add: [], remove: [] });
    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)).toBeUndefined();

    const back: CloudArmorState = await next(fake, keeper).putBack();

    expect(ranges(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0))).toEqual([
      "35.205.11.131/32",
      "45.155.205.233/32",
    ]);
    expect(back.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
  });
});

describe("address groups mode, with Cloud Armor Enterprise", () => {
  test("a global backend policy gets the project's two groups and one rule that denies what either holds", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor({
      tier: "CA_ENTERPRISE_PAYGO",
    });
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    expect(keeper.getDetails().mode).toBe(
      CloudArmorBlocklistMode.AddressGroups,
    );
    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv4`)).toEqual({
      name: `oneuptime-${SUFFIX}-block-ipv4`,
      type: "IPV4",
      capacity: CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv4,
      items: [],
      description:
        "Kept by OneUptime from your project's blocklist. Changes made here are replaced.",
      purpose: ["CLOUD_ARMOR"],
    });
    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv6`)!.capacity).toBe(
      CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv6,
    );
    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)).toEqual({
      kind: "compute#securityPolicyRule",
      priority: 0,
      description:
        "OneUptime blocklist 1a2b3c4d, address groups. Managed by OneUptime: changes here are replaced.",
      action: "deny(403)",
      preview: false,
      match: {
        expr: {
          expression:
            "evaluateAddressGroup('oneuptime-1a2b3c4d-block-ipv4', origin.ip) || evaluateAddressGroup('oneuptime-1a2b3c4d-block-ipv6', origin.ip)",
        },
      },
    });

    const result: { added: Array<CloudArmorWriteResult> } = await keeper.change(
      {
        add: ["35.205.11.131", "185.220.101.0/24", "2001:db8::1"],
        remove: [],
      },
    );

    expect(done(result.added)).toHaveLength(3);
    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv4`)!.items).toEqual([
      "35.205.11.131/32",
      "185.220.101.0/24",
    ]);
    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv6`)!.items).toEqual([
      "2001:db8::1/128",
    ]);

    const state: CloudArmorState = await next(fake, keeper).readState();

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(state.capacity).toBe(
      CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv4 +
        CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv6,
    );
    expect(
      state.held.map((item: { holder: string }): string => {
        return item.holder;
      }),
    ).toEqual([
      `oneuptime-${SUFFIX}-block-ipv4`,
      `oneuptime-${SUFFIX}-block-ipv4`,
      `oneuptime-${SUFFIX}-block-ipv6`,
    ]);

    // A lifted block comes out with removeItems; the policy's rules are not written.
    const calls: number = fake.calls().length;

    await next(fake, keeper).change({ add: [], remove: ["185.220.101.0/24"] });

    expect(fake.calls().slice(calls)).toContain(
      `removeItems oneuptime-${SUFFIX}-block-ipv4`,
    );
    expect(fake.calls().slice(calls)).not.toContain("patchRule prod-lb");
    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv4`)!.items).toEqual([
      "35.205.11.131/32",
    ]);
  });

  test("a group deleted by hand: its blocks not enforced, not made again by a pass - Put It Back makes it again", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor({
      tier: "CA_ENTERPRISE_ANNUAL",
    });
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    await keeper.change({ add: ["35.205.11.131"], remove: [] });
    fake.deleteGroupBehind(`oneuptime-${SUFFIX}-block-ipv4`);

    const pass: CloudArmorPolicyBlocklist = next(fake, keeper);
    const state: CloudArmorState = await pass.readState(true);

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Drifted);
    expect(fillSecurityBlockReason(state.reason!)).toBe(
      `OneUptime's address group oneuptime-${SUFFIX}-block-ipv4 was deleted by hand, so its blocks are not enforced. Select Put It Back to make it again.`,
    );

    const result: { added: Array<CloudArmorWriteResult> } = await pass.change({
      add: ["45.155.205.233"],
      remove: [],
    });

    expect(result.added[0]!.isDone).toBe(false);
    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv4`)).toBeUndefined();

    await next(fake, pass).putBack();

    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv4`)).toBeDefined();
  });

  test("the rule set to preview by hand: Put It Back enforces it again", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor({
      tier: "CA_ENTERPRISE_PAYGO",
    });
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    fake.changeBehind(FAKE_ARMOR_POLICY_ID, (policy: JSONObject): void => {
      (policy["rules"] as Array<JSONObject>)[0]!["preview"] = true;
    });

    expect((await keeper.readState(true)).status).toBe(
      SecurityBlockCloudWafStatus.Drifted,
    );

    await next(fake, keeper).putBack();

    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)!["preview"]).toBe(false);
  });

  test("a group past its capacity says so of each block that does not fit", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor({
      tier: "CA_ENTERPRISE_PAYGO",
    });
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });
    const ipv6: Array<string> = Array.from(
      { length: CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv6 + 1 },
      (_value: unknown, index: number): string => {
        return `2001:db8:${index.toString(16)}::/48`;
      },
    );

    const result: { added: Array<CloudArmorWriteResult> } = await keeper.change(
      {
        add: ipv6,
        remove: [],
      },
    );

    const refused: Array<CloudArmorWriteResult> = result.added.filter(
      (item: CloudArmorWriteResult): boolean => {
        return !item.isDone;
      },
    );

    expect(done(result.added)).toHaveLength(
      CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv6,
    );
    expect(
      refused.map((item: CloudArmorWriteResult): string => {
        return item.value;
      }),
    ).toEqual([ipv6[ipv6.length - 1]]);
    expect(fillSecurityBlockReason(refused[0]!.reason!)).toBe(
      `OneUptime's address group oneuptime-${SUFFIX}-block-ipv6 is full: it holds 2,000 ranges, the capacity it was made with.`,
    );
  });

  test("Remove takes the rule out, then the groups once nothing names them", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor({
      tier: "CA_ENTERPRISE_PAYGO",
    });
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    await keeper.change({ add: ["35.205.11.131"], remove: [] });

    const leaving: CloudArmorPolicyBlocklist = next(fake, keeper);

    await leaving.removeAll();

    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)).toBeUndefined();
    expect(customerRules(fake, FAKE_ARMOR_POLICY_ID)).toEqual(
      recordedBackendPolicy()["rules"],
    );
    expect(await leaving.removeGroups()).toEqual([]);
    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv4`)).toBeUndefined();
    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv6`)).toBeUndefined();
  });
});

describe("Remove, rules mode", () => {
  test("takes each rule of OneUptime's out, read again by its priority first, and leaves every rule of the customer's", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor();
    const keeper: CloudArmorPolicyBlocklist = await setUp({ fake });

    await keeper.change({ add: addresses(15), remove: [] });
    await next(fake, keeper).removeAll();

    expect(customerRules(fake, FAKE_ARMOR_POLICY_ID)).toEqual(
      recordedBackendPolicy()["rules"],
    );
    expect(fake.rules(FAKE_ARMOR_POLICY_ID)).toHaveLength(3);
  });
});

describe("whether the connection may write the policy", () => {
  test("is testIamPermissions on its project: a policy's own permissions in rules mode, the address groups' too where setting it up takes them", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor();

    fake.setGranted([
      "compute.securityPolicies.get",
      "compute.globalOperations.get",
      "compute.projects.get",
    ]);

    expect(await keeperOf({ fake }).checkAccess()).toEqual([
      { permission: "compute.securityPolicies.get", isGranted: true },
      { permission: "compute.securityPolicies.update", isGranted: false },
      { permission: "compute.globalOperations.get", isGranted: true },
      { permission: "compute.projects.get", isGranted: true },
    ]);

    // An Enterprise project's global backend policy would be set up with address groups.
    const enterprise: FakeCloudArmor = createFakeCloudArmor({
      tier: "CA_ENTERPRISE_PAYGO",
    });

    expect(
      (await keeperOf({ fake: enterprise }).checkAccess()).map(
        (check: { permission: string }): string => {
          return check.permission;
        },
      ),
    ).toEqual([
      "compute.securityPolicies.get",
      "compute.securityPolicies.update",
      "compute.globalOperations.get",
      "compute.projects.get",
      "networksecurity.addressGroups.get",
      "networksecurity.addressGroups.create",
      "networksecurity.addressGroups.update",
      "networksecurity.addressGroups.use",
      "networksecurity.operations.get",
    ]);
    // Asking writes nothing.
    expect(
      [...fake.calls(), ...enterprise.calls()].filter(
        (call: string): boolean => {
          return (
            call.startsWith("addRule") ||
            call.startsWith("patchRule") ||
            call.startsWith("removeRule") ||
            call.startsWith("create")
          );
        },
      ),
    ).toEqual([]);
  });
});
