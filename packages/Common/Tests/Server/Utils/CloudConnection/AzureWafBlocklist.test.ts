import { describe, expect, test } from "@jest/globals";
import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import AzureWafPolicyBlocklist, {
  AZURE_WAF_WRITE_ATTEMPTS,
  AzureWafError,
  AzureWafState,
  AzureWafWriteResult,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureWafBlocklist";
import {
  AzureWafPolicyKind,
  AzureWafPolicyRef,
  AzureWafRuleDetails,
  getAzureWafRuleName,
  parseAzureWafPolicyId,
} from "../../../../Types/CloudConnection/AzureWafBlocklist";
import { JSONObject } from "../../../../Types/JSON";
import { CLOUD_WAF_REASONS } from "../../../../Types/SecurityBlocklist/CloudWafReasons";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafStatus,
} from "../../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { fillSecurityBlockReason } from "../../../../Types/SecurityBlocklist/SecurityBlockReason";
import {
  FAKE_AZURE_CLIENT,
  FAKE_AZURE_SECRET,
  FAKE_AZURE_TENANT,
  FAKE_FRONT_DOOR_POLICY_ID,
  FAKE_GATEWAY_POLICY_ID,
  FakeAzureWafArm,
  createFakeAzureWafArm,
  recordedFrontDoorPolicy,
  recordedGatewayPolicy,
} from "./FakeAzureWafArm";

/*
 * THE BLOCKLIST'S RULES IN AN AZURE WAF POLICY (#10348), against Resource
 * Manager as it answers for Application Gateway and Front Door WAF
 * policies (FakeAzureWafArm, from recorded answers): OneUptime's own
 * custom rules, written in whole-policy PUTs that carry the read's ETag in
 * If-Match, with every rule, setting and managed rule of the customer's
 * written back as it was read.
 *
 * Pinned: the first write and the priorities it takes; adding and removing
 * across rules; a write that meets someone else's (412) made again on what
 * they wrote, and given up after AZURE_WAF_WRITE_ATTEMPTS; Front Door's
 * 202 and the Pending that follows until its provisioning succeeds; IPv6
 * refused on Application Gateway; how much a policy holds; a rule turned
 * off, changed or deleted by hand, and Put It Back; a policy that blocks
 * nothing; Remove; the access check; and the customer's rules never
 * touched.
 */

const SUFFIX: string = "1a2b3c4d";
const OTHER_SUFFIX: string = "9f8e7d6c";

function arm(fake: FakeAzureWafArm): AzureArm {
  return new AzureArm({
    tenantId: FAKE_AZURE_TENANT,
    clientId: FAKE_AZURE_CLIENT,
    clientSecret: FAKE_AZURE_SECRET,
    cloud: "public",
    transport: fake.transport,
    sleep: async (): Promise<void> => {
      return undefined;
    },
  });
}

function gatewayRef(): AzureWafPolicyRef {
  return parseAzureWafPolicyId(FAKE_GATEWAY_POLICY_ID)!;
}

function frontDoorRef(): AzureWafPolicyRef {
  return parseAzureWafPolicyId(FAKE_FRONT_DOOR_POLICY_ID)!;
}

function keeperOf(data: {
  fake: FakeAzureWafArm;
  policy?: AzureWafPolicyRef | undefined;
  clientAddress?: SecurityBlockClientAddress | undefined;
  details?: AzureWafRuleDetails | null | undefined;
  displayName?: string | undefined;
}): AzureWafPolicyBlocklist {
  const policy: AzureWafPolicyRef = data.policy || gatewayRef();

  return new AzureWafPolicyBlocklist({
    arm: arm(data.fake),
    policy,
    displayName: data.displayName || policy.name,
    projectSuffix: SUFFIX,
    clientAddress: data.clientAddress || SecurityBlockClientAddress.SourceIp,
    details: data.details ?? null,
  });
}

function gatewayFake(customRules?: Array<JSONObject>): FakeAzureWafArm {
  return createFakeAzureWafArm({
    policies: [
      {
        id: FAKE_GATEWAY_POLICY_ID,
        kind: "gateway",
        policy: recordedGatewayPolicy(customRules),
      },
    ],
  });
}

function frontDoorFake(
  data: { applyingReads?: number; customRules?: Array<JSONObject> } = {},
): FakeAzureWafArm {
  return createFakeAzureWafArm({
    policies: [
      {
        id: FAKE_FRONT_DOOR_POLICY_ID,
        kind: "frontDoor",
        policy: recordedFrontDoorPolicy(data.customRules),
      },
    ],
    frontDoorApplyingReads: data.applyingReads,
  });
}

function addresses(count: number, third: number = 0): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `198.18.${third + Math.floor(index / 250)}.${(index % 250) + 1}`;
  });
}

function ruleNamed(
  rules: Array<JSONObject>,
  name: string,
): JSONObject | undefined {
  return rules.find((rule: JSONObject): boolean => {
    return rule["name"] === name;
  });
}

function gatewayValues(rule: JSONObject | undefined): Array<string> {
  const condition: JSONObject = ((rule?.[
    "matchConditions"
  ] as Array<JSONObject>) || [])[0]!;

  return (condition?.["matchValues"] as Array<string>) || [];
}

function frontDoorValues(rule: JSONObject | undefined): Array<string> {
  const condition: JSONObject = ((rule?.[
    "matchConditions"
  ] as Array<JSONObject>) || [])[0]!;

  return (condition?.["matchValue"] as Array<string>) || [];
}

// The customer's rules as a write carries them: the read's, but each rule's etag, which is Azure's.
function withoutEtags(rules: Array<JSONObject>): Array<JSONObject> {
  return rules.map((rule: JSONObject): JSONObject => {
    const copy: JSONObject = { ...rule };
    delete copy["etag"];
    return copy;
  });
}

function customerRulesOf(rules: Array<JSONObject>): Array<JSONObject> {
  return rules.filter((rule: JSONObject): boolean => {
    return !String(rule["name"] || "").startsWith(`OneUptime${SUFFIX}`);
  });
}

function gatewayRulesOfPut(put: JSONObject): Array<JSONObject> {
  return (put["properties"] as JSONObject)["customRules"] as Array<JSONObject>;
}

function done(results: Array<AzureWafWriteResult>): Array<string> {
  return results
    .filter((result: AzureWafWriteResult): boolean => {
      return result.isDone;
    })
    .map((result: AzureWafWriteResult): string => {
      return result.value;
    });
}

describe("the first write", () => {
  test("puts the blocks in a rule of OneUptime's at the lowest free priority before the customer's first Allow rule, and writes everything else as it was read", async () => {
    const fake: FakeAzureWafArm = gatewayFake();
    const keeper: AzureWafPolicyBlocklist = keeperOf({ fake });
    const before: JSONObject = fake.policy(FAKE_GATEWAY_POLICY_ID);

    const result: {
      added: Array<AzureWafWriteResult>;
      removed: Array<AzureWafWriteResult>;
    } = await keeper.change({
      add: ["35.205.11.131", "185.220.101.0/24", "45.155.205.233"],
      remove: [],
    });

    expect(result.added).toEqual([
      {
        value: "35.205.11.131",
        isDone: true,
        rule: getAzureWafRuleName(SUFFIX, 1),
      },
      {
        value: "185.220.101.0/24",
        isDone: true,
        rule: getAzureWafRuleName(SUFFIX, 1),
      },
      {
        value: "45.155.205.233",
        isDone: true,
        rule: getAzureWafRuleName(SUFFIX, 1),
      },
    ]);

    const puts: Array<JSONObject> = fake.puts(FAKE_GATEWAY_POLICY_ID);

    expect(puts).toHaveLength(1);

    const written: Array<JSONObject> = gatewayRulesOfPut(puts[0]!);
    const ours: JSONObject = ruleNamed(written, "OneUptime1a2b3c4dBlock1")!;

    expect(ours).toEqual({
      name: "OneUptime1a2b3c4dBlock1",
      priority: 1,
      ruleType: "MatchRule",
      action: "Block",
      state: "Enabled",
      matchConditions: [
        {
          matchVariables: [{ variableName: "RemoteAddr" }],
          operator: "IPMatch",
          negationConditon: false,
          matchValues: ["35.205.11.131", "185.220.101.0/24", "45.155.205.233"],
          transforms: [],
        },
      ],
    });

    // The customer's rules, settings and managed rules as they were read.
    const read: JSONObject = before["properties"] as JSONObject;
    const sent: JSONObject = puts[0]!["properties"] as JSONObject;

    expect(customerRulesOf(written)).toEqual(
      withoutEtags(read["customRules"] as Array<JSONObject>),
    );
    expect(sent["policySettings"]).toEqual(read["policySettings"]);
    expect(
      (
        (sent["managedRules"] as JSONObject)[
          "managedRuleSets"
        ] as Array<JSONObject>
      )[0],
    ).toEqual({
      ruleSetType: "OWASP",
      ruleSetVersion: "3.2",
      ruleGroupOverrides: [],
    });
    expect(puts[0]!["tags"]).toEqual({ team: "edge" });
    expect(puts[0]!["location"]).toBe("westeurope");
    // Nothing Azure keeps itself, and the ETag in If-Match, not the body.
    expect(puts[0]!["etag"]).toBeUndefined();
    expect(sent["provisioningState"]).toBeUndefined();
    expect(sent["applicationGateways"]).toBeUndefined();

    const put: { headers?: Record<string, string> } = fake.requests.find(
      (request: { method: string }): boolean => {
        return request.method === "PUT";
      },
    ) as { headers?: Record<string, string> };

    expect(put.headers?.["If-Match"]).toBe(String(before["etag"]));

    const state: AzureWafState = await keeper.readState(true);

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(state.reason).toBeNull();
    expect(
      state.held.map((item: { value: string }): string => {
        return item.value;
      }),
    ).toEqual(["35.205.11.131", "185.220.101.0/24", "45.155.205.233"]);
    expect(state.details.rules).toEqual([
      {
        index: 1,
        name: "OneUptime1a2b3c4dBlock1",
        priority: 1,
        values: ["35.205.11.131", "185.220.101.0/24", "45.155.205.233"],
      },
    ]);
  });

  test("never renumbers the customer's rules: with every priority before their first Allow rule taken, it says No Free Priority and writes nothing", async () => {
    const taken: Array<JSONObject> = [1, 2, 3].map(
      (priority: number): JSONObject => {
        return {
          name: `Geo${priority}`,
          priority,
          ruleType: "MatchRule",
          action: "Block",
          state: "Enabled",
          matchConditions: [
            {
              matchVariables: [{ variableName: "RemoteAddr" }],
              operator: "GeoMatch",
              negationConditon: false,
              matchValues: ["KP"],
              transforms: [],
            },
          ],
        };
      },
    );
    const allow: JSONObject = {
      name: "AllowHealth",
      priority: 4,
      ruleType: "MatchRule",
      action: "Allow",
      state: "Enabled",
      matchConditions: [
        {
          matchVariables: [{ variableName: "RequestUri" }],
          operator: "BeginsWith",
          negationConditon: false,
          matchValues: ["/health"],
          transforms: [],
        },
      ],
    };
    const fake: FakeAzureWafArm = gatewayFake([...taken, allow]);
    const keeper: AzureWafPolicyBlocklist = keeperOf({
      fake,
      displayName: "prod-waf",
    });

    const result: { added: Array<AzureWafWriteResult> } = await keeper.change({
      add: ["35.205.11.131"],
      remove: [],
    });

    expect(result.added[0]!.isDone).toBe(false);
    expect(result.added[0]!.reason!.template).toBe(
      CLOUD_WAF_REASONS.noFreePriority,
    );
    expect(fillSecurityBlockReason(result.added[0]!.reason!)).toBe(
      "prod-waf has no free priority before your first Allow rule (priority 4) for another rule of OneUptime's, and OneUptime never renumbers your rules. Free a priority before it, and OneUptime adds its rule there.",
    );
    expect(fake.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(0);

    // It keeps saying so on every pass, not only on the pass that wrote.
    const state: AzureWafState = await keeperOf({
      fake,
      details: keeper.getDetails(),
    }).readState(true);

    expect(state.status).toBe(SecurityBlockCloudWafStatus.NoFreePriority);

    // Once the customer frees one, the block goes there.
    fake.writeBehind(FAKE_GATEWAY_POLICY_ID, (policy: JSONObject): void => {
      const rules: Array<JSONObject> = (policy["properties"] as JSONObject)[
        "customRules"
      ] as Array<JSONObject>;
      rules.splice(2, 1);
    });

    const again: AzureWafPolicyBlocklist = keeperOf({
      fake,
      details: keeper.getDetails(),
    });

    expect(
      done((await again.change({ add: ["35.205.11.131"], remove: [] })).added),
    ).toEqual(["35.205.11.131"]);
    expect(
      ruleNamed(
        fake.customRules(FAKE_GATEWAY_POLICY_ID),
        "OneUptime1a2b3c4dBlock1",
      )!["priority"],
    ).toBe(3);
    expect((await again.readState(true)).status).toBe(
      SecurityBlockCloudWafStatus.Enforcing,
    );
  });

  test("another OneUptime project's rules in the same policy are the customer's to this one: never written, their priorities never taken", async () => {
    const theirs: JSONObject = {
      name: `OneUptime${OTHER_SUFFIX}Block1`,
      priority: 1,
      ruleType: "MatchRule",
      action: "Block",
      state: "Enabled",
      matchConditions: [
        {
          matchVariables: [{ variableName: "RemoteAddr" }],
          operator: "IPMatch",
          negationConditon: false,
          matchValues: ["192.0.2.1"],
          transforms: [],
        },
      ],
    };
    const fake: FakeAzureWafArm = gatewayFake([theirs]);
    const keeper: AzureWafPolicyBlocklist = keeperOf({ fake });

    await keeper.change({ add: ["35.205.11.131"], remove: ["192.0.2.1"] });

    const rules: Array<JSONObject> = fake.customRules(FAKE_GATEWAY_POLICY_ID);

    expect(ruleNamed(rules, `OneUptime${OTHER_SUFFIX}Block1`)).toEqual(theirs);
    expect(ruleNamed(rules, "OneUptime1a2b3c4dBlock1")!["priority"]).toBe(2);
  });

  test("a pass that changes nothing writes nothing", async () => {
    const fake: FakeAzureWafArm = gatewayFake();
    const keeper: AzureWafPolicyBlocklist = keeperOf({ fake });

    await keeper.change({ add: ["35.205.11.131"], remove: [] });

    const next: AzureWafPolicyBlocklist = keeperOf({
      fake,
      details: keeper.getDetails(),
    });
    const result: { added: Array<AzureWafWriteResult> } = await next.change({
      add: ["35.205.11.131"],
      remove: ["203.0.113.9"],
    });

    expect(done(result.added)).toEqual(["35.205.11.131"]);
    expect(fake.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(1);
  });
});

describe("adding and removing across rules", () => {
  test("a rule holds 600 addresses with CRS 3.2: the 601st starts a second rule, a removed one makes room in the first, and an emptied rule goes", async () => {
    const fake: FakeAzureWafArm = gatewayFake();
    const keeper: AzureWafPolicyBlocklist = keeperOf({ fake });
    const first: Array<string> = addresses(601);

    await keeper.change({ add: first, remove: [] });

    let rules: Array<JSONObject> = fake.customRules(FAKE_GATEWAY_POLICY_ID);

    expect(
      gatewayValues(ruleNamed(rules, "OneUptime1a2b3c4dBlock1")),
    ).toHaveLength(600);
    expect(gatewayValues(ruleNamed(rules, "OneUptime1a2b3c4dBlock2"))).toEqual([
      first[600],
    ]);
    expect(ruleNamed(rules, "OneUptime1a2b3c4dBlock2")!["priority"]).toBe(2);

    // One removed from the first rule, one new: the new one fills the room, in one write.
    const second: AzureWafPolicyBlocklist = keeperOf({
      fake,
      details: keeper.getDetails(),
    });

    await second.change({ add: ["35.205.11.131"], remove: [first[0]!] });

    rules = fake.customRules(FAKE_GATEWAY_POLICY_ID);

    expect(fake.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(2);
    expect(
      gatewayValues(ruleNamed(rules, "OneUptime1a2b3c4dBlock1")),
    ).toContain("35.205.11.131");
    expect(
      gatewayValues(ruleNamed(rules, "OneUptime1a2b3c4dBlock1")),
    ).not.toContain(first[0]);

    // The second rule's only block lifted: the rule goes, and its priority is free again.
    const third: AzureWafPolicyBlocklist = keeperOf({
      fake,
      details: second.getDetails(),
    });

    await third.change({ add: [], remove: [first[600]!] });

    rules = fake.customRules(FAKE_GATEWAY_POLICY_ID);

    expect(ruleNamed(rules, "OneUptime1a2b3c4dBlock2")).toBeUndefined();
    expect(
      third.getDetails().rules.map((rule: { index: number }) => {
        return rule.index;
      }),
    ).toEqual([1]);
  });

  test("an Application Gateway policy matches IPv4 only: an IPv6 block is refused, saying why, and the rest are written", async () => {
    const fake: FakeAzureWafArm = gatewayFake();
    const keeper: AzureWafPolicyBlocklist = keeperOf({ fake });

    const result: { added: Array<AzureWafWriteResult> } = await keeper.change({
      add: ["35.205.11.131", "2001:db8::1", "2001:db8:1::/48"],
      remove: [],
    });

    expect(done(result.added)).toEqual(["35.205.11.131"]);

    const refused: Array<AzureWafWriteResult> = result.added.filter(
      (item: AzureWafWriteResult): boolean => {
        return !item.isDone;
      },
    );

    expect(refused).toHaveLength(2);
    expect(fillSecurityBlockReason(refused[0]!.reason!)).toBe(
      "Application Gateway matches IPv4 addresses only, so it cannot block 2001:db8::1.",
    );
    expect(
      gatewayValues(
        ruleNamed(
          fake.customRules(FAKE_GATEWAY_POLICY_ID),
          "OneUptime1a2b3c4dBlock1",
        ),
      ),
    ).toEqual(["35.205.11.131"]);
  });

  test("a Front Door policy holds IPv6 too, matched where the client connected (SocketAddr) unless told to read X-Forwarded-For", async () => {
    const fake: FakeAzureWafArm = frontDoorFake();
    const keeper: AzureWafPolicyBlocklist = keeperOf({
      fake,
      policy: frontDoorRef(),
    });

    expect(
      done(
        (
          await keeper.change({
            add: ["35.205.11.131", "2001:db8::1"],
            remove: [],
          })
        ).added,
      ),
    ).toEqual(["35.205.11.131", "2001:db8::1"]);

    const rules: Array<JSONObject> = fake.customRules(
      FAKE_FRONT_DOOR_POLICY_ID,
    );
    const ours: JSONObject = ruleNamed(rules, "OneUptime1a2b3c4dBlock1")!;

    expect(ours).toEqual({
      name: "OneUptime1a2b3c4dBlock1",
      priority: 1,
      enabledState: "Enabled",
      ruleType: "MatchRule",
      action: "Block",
      matchConditions: [
        {
          matchVariable: "SocketAddr",
          operator: "IPMatch",
          negateCondition: false,
          matchValue: ["35.205.11.131", "2001:db8::1"],
          transforms: [],
        },
      ],
    });
    // The Front Door rules the customer had, as they were.
    expect(customerRulesOf(rules)).toEqual(
      (
        (recordedFrontDoorPolicy()["properties"] as JSONObject)[
          "customRules"
        ] as JSONObject
      )["rules"] as Array<JSONObject>,
    );

    // Told to read the original client: OneUptime's rules are written again with RemoteAddr.
    const forwarded: AzureWafPolicyBlocklist = keeperOf({
      fake,
      policy: frontDoorRef(),
      clientAddress: SecurityBlockClientAddress.ForwardedClient,
      details: keeper.getDetails(),
    });

    expect(await forwarded.rewriteIfNeeded()).toBe(true);
    expect(
      (
        ruleNamed(
          fake.customRules(FAKE_FRONT_DOOR_POLICY_ID),
          "OneUptime1a2b3c4dBlock1",
        )!["matchConditions"] as Array<JSONObject>
      )[0]!["matchVariable"],
    ).toBe("RemoteAddr");
    expect(
      frontDoorValues(
        ruleNamed(
          fake.customRules(FAKE_FRONT_DOOR_POLICY_ID),
          "OneUptime1a2b3c4dBlock1",
        ),
      ),
    ).toEqual(["35.205.11.131", "2001:db8::1"]);
    expect(
      await keeperOf({
        fake,
        policy: frontDoorRef(),
        clientAddress: SecurityBlockClientAddress.ForwardedClient,
        details: forwarded.getDetails(),
      }).rewriteIfNeeded(),
    ).toBe(false);
  });

  test("how much a policy holds: ten rules of 600 with CRS 3.2, fewer when few priorities are free; more than fits is said to be full", async () => {
    const fake: FakeAzureWafArm = gatewayFake();
    const state: AzureWafState = await keeperOf({ fake }).readState();

    expect(state.capacity).toBe(6000);

    // Version 3.1 of the rule set: 540 to a rule.
    const older: JSONObject = recordedGatewayPolicy();
    (
      ((older["properties"] as JSONObject)["managedRules"] as JSONObject)[
        "managedRuleSets"
      ] as Array<JSONObject>
    )[0]!["ruleSetVersion"] = "3.1";

    const olderFake: FakeAzureWafArm = createFakeAzureWafArm({
      policies: [
        { id: FAKE_GATEWAY_POLICY_ID, kind: "gateway", policy: older },
      ],
    });

    expect((await keeperOf({ fake: olderFake }).readState()).capacity).toBe(
      5400,
    );

    // Front Door: 600 to a rule.
    expect(
      (
        await keeperOf({
          fake: frontDoorFake(),
          policy: frontDoorRef(),
        }).readState()
      ).capacity,
    ).toBe(6000);
  });
});

describe("a write that meets someone else's", () => {
  test("is refused with 412, read again and made on what they wrote: their new rule kept, its priority avoided", async () => {
    const fake: FakeAzureWafArm = gatewayFake();
    const keeper: AzureWafPolicyBlocklist = keeperOf({ fake });
    const theirs: JSONObject = {
      name: "RateLimitLogin",
      priority: 1,
      ruleType: "MatchRule",
      action: "Block",
      state: "Enabled",
      matchConditions: [
        {
          matchVariables: [{ variableName: "RequestUri" }],
          operator: "Contains",
          negationConditon: false,
          matchValues: ["/login"],
          transforms: [],
        },
      ],
    };

    // Written between OneUptime's read and its write, as the portal would.
    await keeper.read();
    fake.writeBehindNextPuts(
      FAKE_GATEWAY_POLICY_ID,
      1,
      (policy: JSONObject): void => {
        (
          (policy["properties"] as JSONObject)[
            "customRules"
          ] as Array<JSONObject>
        ).push(theirs);
      },
    );

    const result: { added: Array<AzureWafWriteResult> } = await keeper.change({
      add: ["35.205.11.131"],
      remove: [],
    });

    expect(done(result.added)).toEqual(["35.205.11.131"]);
    expect(fake.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(2);

    const rules: Array<JSONObject> = fake.customRules(FAKE_GATEWAY_POLICY_ID);

    expect(ruleNamed(rules, "RateLimitLogin")).toEqual(theirs);
    expect(ruleNamed(rules, "OneUptime1a2b3c4dBlock1")!["priority"]).toBe(2);
  });

  test("a policy that keeps changing is given up after its tries: nothing written over anyone's, and each block says so", async () => {
    const fake: FakeAzureWafArm = gatewayFake();
    const keeper: AzureWafPolicyBlocklist = keeperOf({
      fake,
      displayName: "prod-waf",
    });

    fake.writeBehindNextPuts(
      FAKE_GATEWAY_POLICY_ID,
      AZURE_WAF_WRITE_ATTEMPTS,
      (policy: JSONObject): void => {
        (policy["tags"] as JSONObject)["touched"] = "yes";
      },
    );

    const result: {
      added: Array<AzureWafWriteResult>;
      removed: Array<AzureWafWriteResult>;
    } = await keeper.change({ add: ["35.205.11.131"], remove: [] });

    expect(fake.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(
      AZURE_WAF_WRITE_ATTEMPTS,
    );
    expect(result.added[0]!.isDone).toBe(false);
    expect(fillSecurityBlockReason(result.added[0]!.reason!)).toBe(
      `prod-waf kept changing while OneUptime wrote it (${AZURE_WAF_WRITE_ATTEMPTS} tries). OneUptime tries again shortly.`,
    );
    expect(
      ruleNamed(
        fake.customRules(FAKE_GATEWAY_POLICY_ID),
        "OneUptime1a2b3c4dBlock1",
      ),
    ).toBeUndefined();
  });

  test("a refusal says what to do: a missing write permission named, a policy Azure is still applying, a policy gone", async () => {
    const cases: Array<[number, JSONObject, string]> = [
      [
        403,
        {
          error: {
            code: "AuthorizationFailed",
            message:
              "The client does not have authorization to perform action 'Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/write'.",
          },
        },
        "OneUptime may not write prod-waf: the connection has no Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/write there. Grant it with the lines the Add WAF dialog shows for the policy, then select Check Again.",
      ],
      [
        409,
        {
          error: {
            code: "AnotherOperationInProgress",
            message:
              "Another operation on this or dependent resource is in progress.",
          },
        },
        "Azure is still applying an earlier change to prod-waf. OneUptime writes it again shortly.",
      ],
      [
        400,
        {
          error: {
            code: "ApplicationGatewayWafPolicyCustomRuleInvalidMatchValues",
            message: "Match values are invalid.",
          },
        },
        "Azure refused the change to prod-waf: Match values are invalid.",
      ],
    ];

    for (const [status, body, sentence] of cases) {
      const fake: FakeAzureWafArm = gatewayFake();
      const keeper: AzureWafPolicyBlocklist = keeperOf({
        fake,
        displayName: "prod-waf",
      });

      fake.failNextPut(status, body);

      const result: { added: Array<AzureWafWriteResult> } = await keeper.change(
        { add: ["35.205.11.131"], remove: [] },
      );

      expect({
        status,
        sentence: fillSecurityBlockReason(result.added[0]!.reason!),
      }).toEqual({
        status,
        sentence,
      });
    }

    // A read it may not make names the read permission, and stops before writing.
    const fake: FakeAzureWafArm = gatewayFake();

    fake.failReads(403, {
      error: { code: "AuthorizationFailed", message: "no read" },
    });

    await expect(
      keeperOf({ fake, displayName: "prod-waf" }).readState(),
    ).rejects.toThrow(
      "OneUptime may not read prod-waf: the connection has no Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/read there.",
    );
    await expect(
      keeperOf({ fake, displayName: "prod-waf" }).readState(),
    ).rejects.toBeInstanceOf(AzureWafError);
    expect(fake.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(0);
  });
});

describe("Front Door applies a write at its edges", () => {
  test("202, then Applying with the new blocks held but propagating, until provisioning is Succeeded", async () => {
    const fake: FakeAzureWafArm = frontDoorFake({ applyingReads: 2 });
    const keeper: AzureWafPolicyBlocklist = keeperOf({
      fake,
      policy: frontDoorRef(),
      displayName: "edgewaf",
    });

    await keeper.change({ add: ["35.205.11.131"], remove: [] });

    const applying: AzureWafState = await keeper.readState(true);

    expect(applying.status).toBe(SecurityBlockCloudWafStatus.Applying);
    expect(fillSecurityBlockReason(applying.reason!)).toBe(
      "Azure is applying the last change to edgewaf. Its new blocks are enforced once it is done, usually within a few minutes.",
    );
    expect(applying.held).toEqual([
      {
        value: "35.205.11.131",
        rule: "OneUptime1a2b3c4dBlock1",
        isPropagating: true,
        notInForce: null,
      },
    ]);

    expect((await keeper.readState(true)).status).toBe(
      SecurityBlockCloudWafStatus.Applying,
    );

    const applied: AzureWafState = await keeper.readState(true);

    expect(applied.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(applied.held[0]!.isPropagating).toBe(false);
  });
});

describe("a policy that blocks nothing", () => {
  test.each([
    [
      "turned off",
      (policy: JSONObject): void => {
        ((policy["properties"] as JSONObject)["policySettings"] as JSONObject)[
          "state"
        ] = "Disabled";
      },
      "prod-waf is turned off in Azure, so it blocks nothing. Turn it on, and its blocks are enforced from the next check.",
    ],
    [
      "in Detection mode",
      (policy: JSONObject): void => {
        ((policy["properties"] as JSONObject)["policySettings"] as JSONObject)[
          "mode"
        ] = "Detection";
      },
      "prod-waf is in Detection mode, so Azure WAF only logs the requests OneUptime's rules match. Switch it to Prevention mode, and its blocks are enforced from the next check.",
    ],
    [
      "attached to nothing",
      (policy: JSONObject): void => {
        (policy["properties"] as JSONObject)["applicationGateways"] = [];
      },
      "prod-waf is not associated with an application gateway, a listener or a path rule, so it blocks nothing. Associate it in Azure, and its blocks are enforced from the next check.",
    ],
    [
      "failed to provision",
      (policy: JSONObject): void => {
        (policy["properties"] as JSONObject)["provisioningState"] = "Failed";
      },
      "Azure could not apply the last change to prod-waf: its provisioning state is Failed. Check the policy in the Azure portal. OneUptime reads it again on each check.",
    ],
  ])(
    "%s: Not Enforcing, every block held but not in force, saying why",
    async (
      _name: string,
      change: (policy: JSONObject) => void,
      sentence: string,
    ) => {
      const fake: FakeAzureWafArm = gatewayFake();
      const keeper: AzureWafPolicyBlocklist = keeperOf({
        fake,
        displayName: "prod-waf",
      });

      await keeper.change({ add: ["35.205.11.131"], remove: [] });
      fake.writeBehind(FAKE_GATEWAY_POLICY_ID, change);

      const state: AzureWafState = await keeper.readState(true);

      expect(state.status).toBe(SecurityBlockCloudWafStatus.Failed);
      expect(fillSecurityBlockReason(state.reason!)).toBe(sentence);
      expect(fillSecurityBlockReason(state.held[0]!.notInForce!)).toBe(
        sentence,
      );
    },
  );
});

describe("a rule of OneUptime's changed by hand", () => {
  async function written(): Promise<{
    fake: FakeAzureWafArm;
    details: AzureWafRuleDetails;
  }> {
    const fake: FakeAzureWafArm = gatewayFake();
    const keeper: AzureWafPolicyBlocklist = keeperOf({ fake });

    await keeper.change({
      add: ["35.205.11.131", "45.155.205.233"],
      remove: [],
    });

    return { fake, details: keeper.getDetails() };
  }

  function changeOurs(
    fake: FakeAzureWafArm,
    change: (rule: JSONObject, rules: Array<JSONObject>) => void,
  ): void {
    fake.writeBehind(FAKE_GATEWAY_POLICY_ID, (policy: JSONObject): void => {
      const rules: Array<JSONObject> = (policy["properties"] as JSONObject)[
        "customRules"
      ] as Array<JSONObject>;
      change(ruleNamed(rules, "OneUptime1a2b3c4dBlock1")!, rules);
    });
  }

  test("turned off: left off, its blocks not in force and why, nothing new put in it - until Put It Back turns it on", async () => {
    const { fake, details } = await written();

    changeOurs(fake, (rule: JSONObject): void => {
      rule["state"] = "Disabled";
    });

    const keeper: AzureWafPolicyBlocklist = keeperOf({
      fake,
      details,
      displayName: "prod-waf",
    });
    const state: AzureWafState = await keeper.readState(true);

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Drifted);
    expect(fillSecurityBlockReason(state.reason!)).toBe(
      "OneUptime's rule OneUptime1a2b3c4dBlock1 in prod-waf was turned off by hand, so the blocks it holds are not enforced. Select Put It Back to turn it on again.",
    );
    expect(
      state.held.every((item: { notInForce: unknown }): boolean => {
        return item.notInForce !== null;
      }),
    ).toBe(true);

    // A pass: a block lifted comes out of it, a new one goes to a new rule; it stays off.
    await keeper.change({ add: ["192.0.2.7"], remove: ["45.155.205.233"] });

    let rules: Array<JSONObject> = fake.customRules(FAKE_GATEWAY_POLICY_ID);

    expect(ruleNamed(rules, "OneUptime1a2b3c4dBlock1")!["state"]).toBe(
      "Disabled",
    );
    expect(gatewayValues(ruleNamed(rules, "OneUptime1a2b3c4dBlock1"))).toEqual([
      "35.205.11.131",
    ]);
    expect(gatewayValues(ruleNamed(rules, "OneUptime1a2b3c4dBlock2"))).toEqual([
      "192.0.2.7",
    ]);

    const back: AzureWafState = await keeperOf({
      fake,
      details: keeper.getDetails(),
    }).putBack();

    rules = fake.customRules(FAKE_GATEWAY_POLICY_ID);

    expect(ruleNamed(rules, "OneUptime1a2b3c4dBlock1")!["state"]).toBe(
      "Enabled",
    );
    expect(back.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
  });

  test("changed: never written over by a pass, its blocks not in force - Put It Back writes it again as OneUptime writes it", async () => {
    const { fake, details } = await written();

    changeOurs(fake, (rule: JSONObject): void => {
      rule["action"] = "Log";
    });

    const keeper: AzureWafPolicyBlocklist = keeperOf({ fake, details });

    expect((await keeper.readState(true)).status).toBe(
      SecurityBlockCloudWafStatus.Drifted,
    );

    await keeper.change({ add: ["192.0.2.7"], remove: ["35.205.11.131"] });

    expect(
      ruleNamed(
        fake.customRules(FAKE_GATEWAY_POLICY_ID),
        "OneUptime1a2b3c4dBlock1",
      )!["action"],
    ).toBe("Log");

    await keeperOf({ fake, details: keeper.getDetails() }).putBack();

    const ours: JSONObject = ruleNamed(
      fake.customRules(FAKE_GATEWAY_POLICY_ID),
      "OneUptime1a2b3c4dBlock1",
    )!;

    expect(ours["action"]).toBe("Block");
    // What OneUptime meant it to hold: the block lifted while it was changed stays lifted.
    expect(gatewayValues(ours)).toEqual(["45.155.205.233"]);
  });

  test("deleted: not added back by a pass, its blocks said not to be enforced - Put It Back adds it again at its own priority", async () => {
    const { fake, details } = await written();

    changeOurs(fake, (_rule: JSONObject, rules: Array<JSONObject>): void => {
      rules.splice(
        rules.findIndex((rule: JSONObject): boolean => {
          return rule["name"] === "OneUptime1a2b3c4dBlock1";
        }),
        1,
      );
    });

    const keeper: AzureWafPolicyBlocklist = keeperOf({
      fake,
      details,
      displayName: "prod-waf",
    });
    const state: AzureWafState = await keeper.readState(true);

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Drifted);
    expect(fillSecurityBlockReason(state.held[0]!.notInForce!)).toBe(
      "OneUptime's rule OneUptime1a2b3c4dBlock1 in prod-waf was deleted by hand, so the blocks it held are not enforced. Select Put It Back to add it again.",
    );

    // A pass writes no rule of the number someone deleted.
    await keeper.change({ add: [], remove: [] });
    expect(
      ruleNamed(
        fake.customRules(FAKE_GATEWAY_POLICY_ID),
        "OneUptime1a2b3c4dBlock1",
      ),
    ).toBeUndefined();

    const back: AzureWafState = await keeperOf({
      fake,
      details: keeper.getDetails(),
    }).putBack();
    const ours: JSONObject = ruleNamed(
      fake.customRules(FAKE_GATEWAY_POLICY_ID),
      "OneUptime1a2b3c4dBlock1",
    )!;

    expect(ours["priority"]).toBe(1);
    expect(gatewayValues(ours)).toEqual(["35.205.11.131", "45.155.205.233"]);
    expect(back.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
  });
});

describe("Remove", () => {
  test("takes every rule of OneUptime's out - in force, off or changed - and writes the customer's back as they were", async () => {
    const fake: FakeAzureWafArm = gatewayFake();
    const keeper: AzureWafPolicyBlocklist = keeperOf({ fake });

    await keeper.change({ add: addresses(601), remove: [] });

    const leaving: AzureWafPolicyBlocklist = keeperOf({
      fake,
      details: keeper.getDetails(),
    });

    expect(await leaving.removeAll()).toBe(true);
    expect(fake.customRules(FAKE_GATEWAY_POLICY_ID)).toEqual(
      withoutEtags(
        (recordedGatewayPolicy()["properties"] as JSONObject)[
          "customRules"
        ] as Array<JSONObject>,
      ),
    );
    expect(leaving.getDetails().rules).toEqual([]);

    // Nothing of OneUptime's left: nothing written.
    expect(await keeperOf({ fake }).removeAll()).toBe(false);
    expect(fake.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(2);
  });
});

describe("whether the connection may write the policy", () => {
  test("is Azure's own answer of what the app may do there, each permission the policy's kind takes, writing nothing", async () => {
    const fake: FakeAzureWafArm = gatewayFake();

    fake.setPermissions([
      { actions: ["Microsoft.Network/*/read"], notActions: [] },
    ]);

    expect(await keeperOf({ fake }).checkAccess()).toEqual([
      {
        permission:
          "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/read",
        isGranted: true,
      },
      {
        permission:
          "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/write",
        isGranted: false,
      },
    ]);

    fake.setPermissions([
      {
        actions: [
          "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/read",
          "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/write",
          "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/read",
          "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/write",
        ],
        notActions: [],
      },
    ]);

    expect(
      (await keeperOf({ fake }).checkAccess()).every(
        (check: { isGranted: boolean }): boolean => {
          return check.isGranted;
        },
      ),
    ).toBe(true);

    // A role that grants everything but takes the write away grants no write.
    fake.setPermissions([
      {
        actions: ["*"],
        notActions: ["Microsoft.Network/*/write"],
      },
    ]);

    expect(
      (await keeperOf({ fake }).checkAccess()).map(
        (check: { isGranted: boolean }): boolean => {
          return check.isGranted;
        },
      ),
    ).toEqual([true, false]);
    expect(
      fake.requests.filter((request: { method: string }): boolean => {
        return request.method === "PUT";
      }),
    ).toHaveLength(0);
  });
});

describe("the policy's kind", () => {
  test("is read from its id, as Resource Graph and the inventory name it", () => {
    expect(gatewayRef().kind).toBe(AzureWafPolicyKind.ApplicationGateway);
    expect(frontDoorRef().kind).toBe(AzureWafPolicyKind.FrontDoor);
  });
});
