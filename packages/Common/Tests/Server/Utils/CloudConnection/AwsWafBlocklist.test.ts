import { describe, expect, test } from "@jest/globals";
import AwsWafBlocklistGroup, {
  AwsWafRuleState,
  AwsWafSetWriteResult,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsWafBlocklist";
import {
  AWS_WAF_WRITE_SPACING_MS,
  getAwsWafSampledRequests,
  getAwsWafWebAclUpdateBody,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsWaf";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  AWS_WAF_IP_SET_MAX_ADDRESSES,
  AwsWafArn,
  AwsWafScope,
  getAwsWafBlocklistRuleNames,
  getAwsWafBlocklistSets,
  parseAwsWafArn,
} from "../../../../Types/CloudConnection/AwsWafBlocklist";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { getAwsExternalIdForProject } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityBlockAction } from "../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafStatus,
} from "../../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import {
  FAKE_WAF_ACCOUNT_ID,
  FakeAwsWaf,
  FakeWafIpSet,
  FakeWafWebAcl,
  WAF_ERRORS,
  bumpIpSet,
  bumpWebAcl,
  createFakeAwsWaf,
  wafError,
} from "./FakeAwsWaf";

/*
 * THE BLOCKLIST'S IP SETS AND RULES IN AWS WAF (#10344), against AWS WAF as
 * it answers (FakeAwsWaf): the sets made, changed with the lock token -
 * read and changed again when it went stale - and full at 10,000; the rule
 * placed below the customer's first and never a rule of theirs changed;
 * regional and CloudFront scopes; ListIPSets' pages; throttles waited out;
 * refusals said with what grants the permission; and a web ACL kept in code
 * read, never written.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EXTERNAL_ID: string = getAwsExternalIdForProject(PROJECT_ID);
const SETS: ReturnType<typeof getAwsWafBlocklistSets> =
  getAwsWafBlocklistSets(EXTERNAL_ID);
const RULES: { block: string; challenge: string } =
  getAwsWafBlocklistRuleNames(EXTERNAL_ID);
const REGION: string = "eu-west-1";

function setName(key: string): string {
  return SETS.find((set: { key: string }): boolean => {
    return set.key === key;
  })!.name;
}

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT_ID,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      wafBlocklist: "rule",
    },
    secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  };
}

interface Harness {
  fake: FakeAwsWaf;
  group: AwsWafBlocklistGroup;
  waits: Array<number>;
  webAcl: AwsWafArn;
  acl: FakeWafWebAcl;
}

function harness(
  data: {
    region?: string | undefined;
    scope?: "REGIONAL" | "CLOUDFRONT" | undefined;
    rules?: Array<JSONObject> | undefined;
    extra?: JSONObject | undefined;
    fake?: FakeAwsWaf | undefined;
  } = {},
): Harness {
  const fake: FakeAwsWaf = data.fake || createFakeAwsWaf();
  const region: string = data.region || REGION;
  const scope: "REGIONAL" | "CLOUDFRONT" = data.scope || "REGIONAL";
  const acl: FakeWafWebAcl = fake.addWebAcl({
    region,
    scope,
    name: "prod-alb",
    rules: data.rules,
    extra: data.extra,
  });
  const webAcl: AwsWafArn = parseAwsWafArn(acl.webAcl["ARN"])!;
  const waits: Array<number> = [];
  let clock: number = Date.UTC(2026, 10, 21, 10, 0, 0);

  const group: AwsWafBlocklistGroup = new AwsWafBlocklistGroup({
    settings: settings(),
    connectionId: ObjectID.generate(),
    externalId: EXTERNAL_ID,
    accountId: FAKE_WAF_ACCOUNT_ID,
    region,
    scope: scope === "CLOUDFRONT" ? AwsWafScope.CloudFront : AwsWafScope.Regional,
    options: {
      transport: fake.transport,
      now: (): Date => {
        return new Date(clock);
      },
      sleep: async (milliseconds: number): Promise<void> => {
        waits.push(milliseconds);
        clock += milliseconds;
      },
    },
  });

  return { fake, group, waits, webAcl, acl };
}

// A customer's own rule at a priority.
function customerRule(name: string, priority: number): JSONObject {
  return {
    Name: name,
    Priority: priority,
    Action: { Block: {} },
    Statement: {
      GeoMatchStatement: { CountryCodes: ["KP"] },
    },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: name,
    },
  };
}

function cidrsOf(fake: FakeAwsWaf, key: string, region: string = REGION): Array<string> {
  return fake.getIpSet(region, "REGIONAL", setName(key))?.addresses || [];
}

describe("first-time setup: the four IP sets and the rule", () => {
  test("makes each set, empty, of its IP version, named for the project, and says it is OneUptime's", async () => {
    const h: Harness = harness();

    const arns: Record<string, string> = await h.group.ensureSets();

    expect(Object.keys(arns).sort()).toEqual([
      "block-ipv4",
      "block-ipv6",
      "challenge-ipv4",
      "challenge-ipv6",
    ]);

    for (const spec of SETS) {
      const set: FakeWafIpSet = h.fake.getIpSet(REGION, "REGIONAL", spec.name)!;

      expect(set.name).toBe(`oneuptime-${EXTERNAL_ID.slice(10, 18)}-${spec.key}`);
      expect(set.version).toBe(spec.family === 4 ? "IPV4" : "IPV6");
      expect(set.addresses).toEqual([]);
      expect(set.description).toContain("OneUptime");
      expect(arns[spec.key]).toBe(set.arn);
      expect(set.arn).toContain(`:${REGION}:${FAKE_WAF_ACCOUNT_ID}:regional/ipset/`);
    }

    // Made again, nothing is made twice.
    const before: number = h.fake.actions().filter((action: string) => {
      return action === "CreateIPSet";
    }).length;

    await h.group.ensureSets();

    expect(
      h.fake.actions().filter((action: string) => {
        return action === "CreateIPSet";
      }).length,
    ).toBe(before);
  });

  test("adds the block rule and the challenge rule just below the customer's first rule, an OR of each action's two sets", async () => {
    const h: Harness = harness({
      rules: [customerRule("allow-office", 10), customerRule("geo", 20)],
    });

    const state: AwsWafRuleState = await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(state.priorities).toEqual({ block: 8, challenge: 9 });
    expect(state.enforcedSetKeys.sort()).toEqual([
      "block-ipv4",
      "block-ipv6",
      "challenge-ipv4",
      "challenge-ipv6",
    ]);

    const rules: Array<JSONObject> = h.fake.getRules(REGION, "REGIONAL", "prod-alb");
    const byName: Map<string, JSONObject> = new Map(
      rules.map((rule: JSONObject): [string, JSONObject] => {
        return [rule["Name"] as string, rule];
      }),
    );

    // The customer's rules, as they were, where they were.
    expect(byName.get("allow-office")).toEqual(customerRule("allow-office", 10));
    expect(byName.get("geo")).toEqual(customerRule("geo", 20));

    expect(byName.get(RULES.block)).toEqual({
      Name: RULES.block,
      Priority: 8,
      Action: { Block: {} },
      Statement: {
        OrStatement: {
          Statements: [
            {
              IPSetReferenceStatement: {
                ARN: h.fake.getIpSet(REGION, "REGIONAL", setName("block-ipv4"))!
                  .arn,
              },
            },
            {
              IPSetReferenceStatement: {
                ARN: h.fake.getIpSet(REGION, "REGIONAL", setName("block-ipv6"))!
                  .arn,
              },
            },
          ],
        },
      },
      VisibilityConfig: {
        SampledRequestsEnabled: true,
        CloudWatchMetricsEnabled: true,
        MetricName: RULES.block,
      },
    });
    expect(byName.get(RULES.challenge)!["Priority"]).toBe(9);
    expect(byName.get(RULES.challenge)!["Action"]).toEqual({ Challenge: {} });
  });

  test("a web ACL with no rule of the customer's takes priorities 0 and 1", async () => {
    const h: Harness = harness();

    const state: AwsWafRuleState = await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(state.priorities).toEqual({ block: 0, challenge: 1 });
  });

  test("sends back every member GetWebACL answered but the read-only ones, so no setting of the customer's is lost", async () => {
    const h: Harness = harness({
      rules: [customerRule("geo", 5)],
      extra: {
        Description: "Production ALB",
        CustomResponseBodies: {
          blocked: { ContentType: "TEXT_PLAIN", Content: "Blocked" },
        },
        CaptchaConfig: { ImmunityTimeProperty: { ImmunityTime: 600 } },
        TokenDomains: ["example.com"],
        AssociationConfig: {
          RequestBody: {
            CLOUDFRONT: { DefaultSizeInspectionLimit: "KB_32" },
          },
        },
        // A member AWS adds after this was written: kept all the same.
        SomeFutureSetting: { Mode: "ON" },
      },
    });

    await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    const update: JSONObject = h.fake.calls.find(
      (call: { action: string }): boolean => {
        return call.action === "UpdateWebACL";
      },
    )!.body;

    expect(update["Description"]).toBe("Production ALB");
    expect(update["CustomResponseBodies"]).toEqual({
      blocked: { ContentType: "TEXT_PLAIN", Content: "Blocked" },
    });
    expect(update["CaptchaConfig"]).toEqual({
      ImmunityTimeProperty: { ImmunityTime: 600 },
    });
    expect(update["TokenDomains"]).toEqual(["example.com"]);
    expect(update["SomeFutureSetting"]).toEqual({ Mode: "ON" });
    expect(update["DefaultAction"]).toEqual({ Allow: {} });
    expect(update["Scope"]).toBe("REGIONAL");
    expect(update["LockToken"]).toBeTruthy();

    for (const member of [
      "ARN",
      "Capacity",
      "LabelNamespace",
      "ManagedByFirewallManager",
    ]) {
      expect(update[member]).toBeUndefined();
    }
  });

  test("the update body is the web ACL without its read-only members, its scope and lock token added", () => {
    expect(
      getAwsWafWebAclUpdateBody({
        webAcl: {
          Name: "a",
          Id: "b",
          ARN: "arn",
          Capacity: 7,
          LabelNamespace: "x",
          ManagedByFirewallManager: false,
          RetrofittedByFirewallManager: false,
          PreProcessFirewallManagerRuleGroups: [],
          PostProcessFirewallManagerRuleGroups: [],
          DefaultAction: { Block: {} },
          Rules: [{ Name: "old" }],
        },
        rules: [{ Name: "new" }],
        scope: AwsWafScope.CloudFront,
        lockToken: "token",
      }),
    ).toEqual({
      Name: "a",
      Id: "b",
      DefaultAction: { Block: {} },
      Rules: [{ Name: "new" }],
      Scope: "CLOUDFRONT",
      LockToken: "token",
    });
  });

  test("reads the client's address from the header the web ACL is set to: the last of X-Forwarded-For, the one of CF-Connecting-IP", async () => {
    const xff: Harness = harness();

    await xff.group.ensureRules({
      webAcl: xff.webAcl,
      clientAddress: SecurityBlockClientAddress.XForwardedFor,
    });

    const reference: JSONObject = (
      (
        (
          xff.fake
            .getRules(REGION, "REGIONAL", "prod-alb")
            .find((rule: JSONObject) => {
              return rule["Name"] === RULES.block;
            })!["Statement"] as JSONObject
        )["OrStatement"] as JSONObject
      )["Statements"] as Array<JSONObject>
    )[0]!["IPSetReferenceStatement"] as JSONObject;

    expect(reference["IPSetForwardedIPConfig"]).toEqual({
      HeaderName: "X-Forwarded-For",
      FallbackBehavior: "NO_MATCH",
      Position: "LAST",
    });

    const cf: Harness = harness();

    await cf.group.ensureRules({
      webAcl: cf.webAcl,
      clientAddress: SecurityBlockClientAddress.CfConnectingIp,
    });

    expect(
      JSON.stringify(cf.fake.getRules(REGION, "REGIONAL", "prod-alb")),
    ).toContain('"HeaderName":"CF-Connecting-IP","FallbackBehavior":"NO_MATCH","Position":"FIRST"');
  });

  test("a rule already as it should be is not written again; one whose client address changed is rewritten in place", async () => {
    const h: Harness = harness({ rules: [customerRule("geo", 10)] });

    await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    const writes: () => number = (): number => {
      return h.fake.actions().filter((action: string) => {
        return action === "UpdateWebACL";
      }).length;
    };

    expect(writes()).toBe(1);

    await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(writes()).toBe(1);

    const state: AwsWafRuleState = await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.TrueClientIp,
    });

    expect(writes()).toBe(2);
    // Kept where it was.
    expect(state.priorities).toEqual({ block: 8, challenge: 9 });
    expect(
      JSON.stringify(h.fake.getRules(REGION, "REGIONAL", "prod-alb")),
    ).toContain("True-Client-IP");
  });
});

describe("no free priority", () => {
  test("a web ACL whose first rule is at priority 0 is left as it is, and says to free two priorities", async () => {
    const h: Harness = harness({ rules: [customerRule("first", 0)] });

    const state: AwsWafRuleState = await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(state.status).toBe(SecurityBlockCloudWafStatus.NoFreePriority);
    expect(state.message).toBe(
      "prod-alb has no free priority below its first rule (priority 0) for OneUptime's two rules, and OneUptime never renumbers your rules. Free two priorities below it, and OneUptime adds them there.",
    );
    expect(h.fake.actions()).not.toContain("UpdateWebACL");
    expect(h.fake.getRules(REGION, "REGIONAL", "prod-alb")).toEqual([
      customerRule("first", 0),
    ]);
  });

  test("one free priority is not enough for two rules; it is for the one missing", async () => {
    const short: Harness = harness({ rules: [customerRule("first", 1)] });

    expect(
      (
        await short.group.ensureRules({
          webAcl: short.webAcl,
          clientAddress: SecurityBlockClientAddress.SourceIp,
        })
      ).status,
    ).toBe(SecurityBlockCloudWafStatus.NoFreePriority);

    // OneUptime's block rule is there (at 0); only the challenge rule is missing.
    const h: Harness = harness({ rules: [customerRule("first", 2)] });

    await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    const rules: Array<JSONObject> = h.fake.getRules(REGION, "REGIONAL", "prod-alb");

    bumpWebAcl(
      h.fake.state(REGION, "REGIONAL").webAcls.get(h.webAcl.id)!,
      rules
        .filter((rule: JSONObject): boolean => {
          return rule["Name"] !== RULES.challenge;
        })
        .map((rule: JSONObject): JSONObject => {
          return rule["Name"] === RULES.block ? { ...rule, Priority: 0 } : rule;
        }),
    );

    const state: AwsWafRuleState = await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(state.priorities).toEqual({ block: 0, challenge: 1 });
  });
});

describe("lock tokens", () => {
  test("a set written between OneUptime's read and its write is read again, and the change made on what it holds now", async () => {
    const h: Harness = harness();

    await h.group.ensureSets();

    const set: FakeWafIpSet = h.fake.getIpSet(
      REGION,
      "REGIONAL",
      setName("block-ipv4"),
    )!;

    // Someone else adds 198.51.100.9 between the read and the write.
    h.fake.writeBehind(() => {
      bumpIpSet(set, ["198.51.100.9/32"]);
    });

    const result: {
      added: Array<AwsWafSetWriteResult>;
      removed: Array<AwsWafSetWriteResult>;
    } = await h.group.changeSet("block-ipv4", {
      add: [{ value: "35.205.11.131", cidr: "35.205.11.131/32" }],
      remove: [],
    });

    expect(result.added).toEqual([{ value: "35.205.11.131", isDone: true }]);
    expect(cidrsOf(h.fake, "block-ipv4")).toEqual([
      "198.51.100.9/32",
      "35.205.11.131/32",
    ]);
    // The stale token was refused once, then the set was read again and written.
    expect(
      h.fake.actions().filter((action: string) => {
        return action === "UpdateIPSet";
      }),
    ).toHaveLength(2);
  });

  test("a set that keeps changing is given up on after three tries, and every entry says so", async () => {
    const h: Harness = harness();

    await h.group.ensureSets();

    const set: FakeWafIpSet = h.fake.getIpSet(
      REGION,
      "REGIONAL",
      setName("block-ipv4"),
    )!;

    h.fake.writeBehind(() => {
      bumpIpSet(set);
    }, 3);

    const result: {
      added: Array<AwsWafSetWriteResult>;
      removed: Array<AwsWafSetWriteResult>;
    } = await h.group.changeSet("block-ipv4", {
      add: [{ value: "35.205.11.131", cidr: "35.205.11.131/32" }],
      remove: ["203.0.113.7"],
    });

    expect(result.added[0]!.isDone).toBe(false);
    expect(result.added[0]!.error).toBe(
      `IP set ${setName("block-ipv4")} kept changing while OneUptime wrote it (3 tries). OneUptime tries again shortly.`,
    );
    expect(result.removed[0]!.isDone).toBe(false);
  });

  test("a web ACL written between the read and the write is read again: the customer's new rule is kept", async () => {
    const h: Harness = harness({ rules: [customerRule("geo", 10)] });
    const acl: FakeWafWebAcl = h.fake.state(REGION, "REGIONAL").webAcls.get(
      h.webAcl.id,
    )!;

    h.fake.writeBehind(() => {
      bumpWebAcl(acl, [
        customerRule("geo", 10),
        customerRule("rate-limit", 6),
      ]);
    });

    const state: AwsWafRuleState = await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    // Below the new first rule (6), not the old one (10).
    expect(state.priorities).toEqual({ block: 4, challenge: 5 });

    const names: Array<unknown> = h.fake
      .getRules(REGION, "REGIONAL", "prod-alb")
      .map((rule: JSONObject) => {
        return rule["Name"];
      });

    expect(names).toEqual(
      expect.arrayContaining(["geo", "rate-limit", RULES.block, RULES.challenge]),
    );
  });
});

describe("reading and changing the sets", () => {
  test("removes what is lifted and adds what is blocked, in one write a set, single addresses as /32 and /128", async () => {
    const h: Harness = harness();

    h.fake.addIpSet({
      region: REGION,
      scope: "REGIONAL",
      name: setName("block-ipv4"),
      version: "IPV4",
      addresses: ["203.0.113.7/32", "35.205.11.0/24"],
    });
    h.fake.addIpSet({
      region: REGION,
      scope: "REGIONAL",
      name: setName("block-ipv6"),
      version: "IPV6",
      addresses: [],
    });

    await h.group.changeSet("block-ipv4", {
      add: [{ value: "198.51.100.9", cidr: "198.51.100.9/32" }],
      remove: ["203.0.113.7"],
    });
    await h.group.changeSet("block-ipv6", {
      add: [{ value: "2001:db8::7", cidr: "2001:db8::7/128" }],
      remove: [],
    });

    expect(cidrsOf(h.fake, "block-ipv4")).toEqual([
      "35.205.11.0/24",
      "198.51.100.9/32",
    ]);
    expect(cidrsOf(h.fake, "block-ipv6")).toEqual(["2001:db8::7/128"]);
    expect(
      h.fake.actions().filter((action: string) => {
        return action === "UpdateIPSet";
      }),
    ).toHaveLength(2);

    // What a set holds, as blocks write values.
    const set: Awaited<ReturnType<AwsWafBlocklistGroup["readSet"]>> =
      await h.group.readSet("block-ipv6");

    expect(AwsWafBlocklistGroup.valuesOf(set!)).toEqual(["2001:db8::7"]);
  });

  test("a change that changes nothing writes nothing", async () => {
    const h: Harness = harness();

    h.fake.addIpSet({
      region: REGION,
      scope: "REGIONAL",
      name: setName("block-ipv4"),
      version: "IPV4",
      addresses: ["35.205.11.131/32"],
    });

    const result: {
      added: Array<AwsWafSetWriteResult>;
      removed: Array<AwsWafSetWriteResult>;
    } = await h.group.changeSet("block-ipv4", {
      add: [{ value: "35.205.11.131", cidr: "35.205.11.131/32" }],
      remove: ["203.0.113.250"],
    });

    expect(result.added).toEqual([{ value: "35.205.11.131", isDone: true }]);
    expect(h.fake.actions()).not.toContain("UpdateIPSet");
  });

  test("a set that is not there is made with what is added", async () => {
    const h: Harness = harness();

    await h.group.changeSet("challenge-ipv4", {
      add: [{ value: "35.205.11.131", cidr: "35.205.11.131/32" }],
      remove: [],
    });

    expect(
      h.fake.getIpSet(REGION, "REGIONAL", setName("challenge-ipv4"))!.addresses,
    ).toEqual(["35.205.11.131/32"]);
    expect(h.fake.actions()).toEqual(
      expect.arrayContaining(["ListIPSets", "CreateIPSet"]),
    );
  });

  test("finds its sets on a later page of ListIPSets", async () => {
    const fake: FakeAwsWaf = createFakeAwsWaf({ listPageSize: 2 });

    for (let index: number = 0; index < 5; index++) {
      fake.addIpSet({
        region: REGION,
        scope: "REGIONAL",
        name: `customer-set-${index}`,
        version: "IPV4",
      });
    }

    fake.addIpSet({
      region: REGION,
      scope: "REGIONAL",
      name: setName("block-ipv4"),
      version: "IPV4",
      addresses: ["35.205.11.131/32"],
    });

    const h: Harness = harness({ fake });
    const set: Awaited<ReturnType<AwsWafBlocklistGroup["readSet"]>> =
      await h.group.readSet("block-ipv4");

    expect(set?.addresses).toEqual(["35.205.11.131/32"]);
    expect(
      h.fake.calls
        .filter((call: { action: string }) => {
          return call.action === "ListIPSets";
        })
        .map((call: { body: JSONObject }) => {
          return call.body["NextMarker"] || null;
        }),
    ).toEqual([null, "2", "4"]);
    // The customer's sets are listed, and never read.
    expect(
      h.fake.calls.filter((call: { action: string; body: JSONObject }) => {
        return (
          call.action === "GetIPSet" &&
          String(call.body["Name"]).startsWith("customer-set")
        );
      }),
    ).toEqual([]);
  });

  test("a full set takes what fits, the oldest first, and says of each other entry that it is full", async () => {
    const h: Harness = harness();
    const existing: Array<string> = Array.from(
      { length: AWS_WAF_IP_SET_MAX_ADDRESSES - 1 },
      (_: unknown, index: number): string => {
        return `10.${Math.floor(index / 65536) % 256}.${Math.floor(index / 256) % 256}.${index % 256}/32`;
      },
    );

    h.fake.addIpSet({
      region: REGION,
      scope: "REGIONAL",
      name: setName("block-ipv4"),
      version: "IPV4",
      addresses: existing,
    });

    const result: {
      added: Array<AwsWafSetWriteResult>;
      removed: Array<AwsWafSetWriteResult>;
    } = await h.group.changeSet("block-ipv4", {
      add: [
        { value: "35.205.11.1", cidr: "35.205.11.1/32" },
        { value: "35.205.11.2", cidr: "35.205.11.2/32" },
        { value: "35.205.11.3", cidr: "35.205.11.3/32" },
      ],
      remove: [],
    });

    expect(result.added).toEqual([
      { value: "35.205.11.1", isDone: true },
      {
        value: "35.205.11.2",
        isDone: false,
        error: `the AWS WAF IP set ${setName("block-ipv4")} is full (10,000)`,
      },
      {
        value: "35.205.11.3",
        isDone: false,
        error: `the AWS WAF IP set ${setName("block-ipv4")} is full (10,000)`,
      },
    ]);
    expect(cidrsOf(h.fake, "block-ipv4")).toHaveLength(AWS_WAF_IP_SET_MAX_ADDRESSES);
  });

  test("a set AWS calls full (WAFLimitsExceededException) refuses the entries it was asked to add, saying so", async () => {
    const fake: FakeAwsWaf = createFakeAwsWaf({ maxAddresses: 1 });
    const h: Harness = harness({ fake });

    fake.addIpSet({
      region: REGION,
      scope: "REGIONAL",
      name: setName("block-ipv4"),
      version: "IPV4",
      addresses: ["203.0.113.7/32"],
    });

    const result: {
      added: Array<AwsWafSetWriteResult>;
      removed: Array<AwsWafSetWriteResult>;
    } = await h.group.changeSet("block-ipv4", {
      add: [{ value: "35.205.11.131", cidr: "35.205.11.131/32" }],
      remove: [],
    });

    expect(result.added).toEqual([
      {
        value: "35.205.11.131",
        isDone: false,
        error: `the AWS WAF IP set ${setName("block-ipv4")} is full (10,000)`,
      },
    ]);
  });

  test("an account with as many IP sets as AWS allows says so, and what to do", async () => {
    const fake: FakeAwsWaf = createFakeAwsWaf({ maxIpSets: 0 });
    const h: Harness = harness({ fake });

    const result: {
      added: Array<AwsWafSetWriteResult>;
      removed: Array<AwsWafSetWriteResult>;
    } = await h.group.changeSet("block-ipv4", {
      add: [{ value: "35.205.11.131", cidr: "35.205.11.131/32" }],
      remove: [],
    });

    expect(result.added[0]!.isDone).toBe(false);
    expect(result.added[0]!.error).toBe(
      `AWS WAF could not make IP set ${setName("block-ipv4")}: the account has as many IP sets in ${REGION} as AWS allows (100 unless raised). Delete one you no longer use, or ask AWS for more.`,
    );
  });
});

describe("throttling, failures for now and refusals", () => {
  test("a throttled write is waited out and sent again, as AWS's SDKs do", async () => {
    const h: Harness = harness();

    await h.group.ensureSets();
    h.fake.failNext("UpdateIPSet", WAF_ERRORS.throttled);

    const result: {
      added: Array<AwsWafSetWriteResult>;
      removed: Array<AwsWafSetWriteResult>;
    } = await h.group.changeSet("block-ipv4", {
      add: [{ value: "35.205.11.131", cidr: "35.205.11.131/32" }],
      remove: [],
    });

    expect(result.added[0]!.isDone).toBe(true);
    expect(
      h.fake.actions().filter((action: string) => {
        return action === "UpdateIPSet";
      }),
    ).toHaveLength(2);
    expect(h.waits.length).toBeGreaterThan(0);
  });

  test("writes of a kind are spaced a little over a second apart: AWS WAF takes one a second", async () => {
    const h: Harness = harness();

    await h.group.ensureSets();

    const creates: Array<number> = h.waits.filter((wait: number): boolean => {
      return wait > 0 && wait <= AWS_WAF_WRITE_SPACING_MS;
    });

    // Four sets made: three waits between them.
    expect(creates).toHaveLength(3);
  });

  test("a refusal names the permission, the set, and that the connection's setting grants it", async () => {
    const h: Harness = harness();

    await h.group.ensureSets();
    h.fake.failNext("UpdateIPSet", WAF_ERRORS.denied("wafv2:UpdateIPSet"));

    const result: {
      added: Array<AwsWafSetWriteResult>;
      removed: Array<AwsWafSetWriteResult>;
    } = await h.group.changeSet("block-ipv4", {
      add: [{ value: "35.205.11.131", cidr: "35.205.11.131/32" }],
      remove: [],
    });

    expect(result.added[0]!.error).toBe(
      `AWS refused wafv2:UpdateIPSet on IP set ${setName("block-ipv4")}: the access key may not call it. Turn on Block addresses in AWS WAF for the connection, and run its setup command again.`,
    );
    // Nothing of AWS's own words, which name an identity.
    expect(result.added[0]!.error).not.toContain("arn:aws:iam");
  });

  test("a refused web ACL write says to pick the setting that adds the rule, or add it in code", async () => {
    const h: Harness = harness();

    h.fake.failNext("UpdateWebACL", WAF_ERRORS.denied("wafv2:UpdateWebACL"));

    const state: AwsWafRuleState = await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Failed);
    expect(state.message).toBe(
      'OneUptime could not add its rules to prod-alb: AWS refused wafv2:UpdateWebACL on web ACL prod-alb: the access key may not call it. Pick "On, and OneUptime adds its rule" under Block addresses in AWS WAF for the connection and run its setup command again, or add the rule to the web ACL in code.',
    );
  });

  test("a set just made that AWS WAF does not know yet is waited for, then referenced", async () => {
    const fake: FakeAwsWaf = createFakeAwsWaf({ unavailableAfterCreate: 6 });
    const h: Harness = harness({ fake });

    const state: AwsWafRuleState = await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(h.waits).toContain(5000);
  });

  test("AWS WAF failing for now (a 500) is asked again, and a write that keeps failing says so", async () => {
    const h: Harness = harness();

    await h.group.ensureSets();
    h.fake.failNext("UpdateIPSet", WAF_ERRORS.internal, 3);

    const result: {
      added: Array<AwsWafSetWriteResult>;
      removed: Array<AwsWafSetWriteResult>;
    } = await h.group.changeSet("block-ipv4", {
      add: [{ value: "35.205.11.131", cidr: "35.205.11.131/32" }],
      remove: [],
    });

    expect(result.added[0]!.isDone).toBe(false);
    expect(result.added[0]!.error).toContain("3 times");
  });
});

describe("CloudFront's web ACLs", () => {
  test("are written in us-east-1 with scope CLOUDFRONT, their sets global", async () => {
    const h: Harness = harness({ region: "us-east-1", scope: "CLOUDFRONT" });

    expect(h.webAcl.scope).toBe(AwsWafScope.CloudFront);
    expect(h.webAcl.arn).toContain(":global/webacl/");

    const state: AwsWafRuleState = await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Enforcing);

    for (const call of h.fake.calls) {
      expect(call.region).toBe("us-east-1");

      if (call.body["Scope"] !== undefined) {
        expect(call.body["Scope"]).toBe("CLOUDFRONT");
      }
    }

    expect(
      h.fake.getIpSet("us-east-1", "CLOUDFRONT", setName("block-ipv4"))!.arn,
    ).toContain(":global/ipset/");
    // The regional sets of us-east-1 are not CloudFront's.
    expect(h.fake.getIpSet("us-east-1", "REGIONAL", setName("block-ipv4"))).toBeUndefined();
  });
});

describe("a web ACL its team keeps in code", () => {
  test("is read, never written: waiting for its rule, which sets it lacks, and the priorities free for it", async () => {
    const h: Harness = harness({ rules: [customerRule("geo", 3)] });

    await h.group.ensureSets();

    const state: AwsWafRuleState = await h.group.readRuleState({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
      addsRule: false,
    });

    expect(state.status).toBe(SecurityBlockCloudWafStatus.WaitingForRule);
    expect(state.message).toBe(
      `prod-alb has no rule that blocks ${SETS.map((set: { name: string }) => {
        return set.name;
      }).join(", ")} yet. Add OneUptime's rule to it, as its Rule tab shows.`,
    );
    expect(state.priorities).toEqual({ block: 1, challenge: 2 });
    expect(h.fake.actions()).not.toContain("UpdateWebACL");
  });

  test("is enforcing once its own rules reference the sets, whatever they are called, reading the client's address as it is set to", async () => {
    const h: Harness = harness();
    const arns: Record<string, string> = await h.group.ensureSets();
    const reference: (arn: string, config?: JSONObject) => JSONObject = (
      arn: string,
      config?: JSONObject,
    ): JSONObject => {
      return {
        IPSetReferenceStatement: {
          ARN: arn,
          ...(config ? { IPSetForwardedIPConfig: config } : {}),
        },
      };
    };
    const rule: (
      name: string,
      action: string,
      priority: number,
      statements: Array<JSONObject>,
    ) => JSONObject = (
      name: string,
      action: string,
      priority: number,
      statements: Array<JSONObject>,
    ): JSONObject => {
      return {
        Name: name,
        Priority: priority,
        Action: { [action]: {} },
        Statement: { OrStatement: { Statements: statements } },
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: `${name}-metric`,
        },
      };
    };
    const xffLast: JSONObject = {
      HeaderName: "x-forwarded-for",
      FallbackBehavior: "NO_MATCH",
      Position: "LAST",
    };

    bumpWebAcl(h.fake.state(REGION, "REGIONAL").webAcls.get(h.webAcl.id)!, [
      rule("terraform-blocklist", "Block", 0, [
        reference(arns["block-ipv4"]!, xffLast),
        reference(arns["block-ipv6"]!, xffLast),
      ]),
      rule("terraform-challenge", "Challenge", 1, [
        reference(arns["challenge-ipv4"]!, xffLast),
        reference(arns["challenge-ipv6"]!, xffLast),
      ]),
    ]);

    const state: AwsWafRuleState = await h.group.readRuleState({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.XForwardedFor,
      addsRule: false,
    });

    expect(state.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(state.sampledMetricNames).toEqual({
      [SecurityBlockAction.Block]: "terraform-blocklist-metric",
      [SecurityBlockAction.Challenge]: "terraform-challenge-metric",
    });

    // Read as the source address, the same rules block nothing.
    expect(
      (
        await h.group.readRuleState({
          webAcl: h.webAcl,
          clientAddress: SecurityBlockClientAddress.SourceIp,
          addsRule: false,
        })
      ).enforcedSetKeys,
    ).toEqual([]);
  });

  test("a rule that reads the first X-Forwarded-For - what the request claimed - or matches only under a scope-down enforces nothing", async () => {
    const h: Harness = harness();
    const arns: Record<string, string> = await h.group.ensureSets();

    bumpWebAcl(h.fake.state(REGION, "REGIONAL").webAcls.get(h.webAcl.id)!, [
      {
        Name: "claimed",
        Priority: 0,
        Action: { Block: {} },
        Statement: {
          IPSetReferenceStatement: {
            ARN: arns["block-ipv4"]!,
            IPSetForwardedIPConfig: {
              HeaderName: "X-Forwarded-For",
              FallbackBehavior: "NO_MATCH",
              Position: "FIRST",
            },
          },
        },
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: "claimed",
        },
      },
      {
        Name: "scoped",
        Priority: 1,
        Action: { Block: {} },
        Statement: {
          AndStatement: {
            Statements: [
              { IPSetReferenceStatement: { ARN: arns["block-ipv6"]! } },
              {
                ByteMatchStatement: {
                  SearchString: "/admin",
                  FieldToMatch: { UriPath: {} },
                  TextTransformations: [{ Priority: 0, Type: "NONE" }],
                  PositionalConstraint: "STARTS_WITH",
                },
              },
            ],
          },
        },
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: "scoped",
        },
      },
      {
        Name: "counted",
        Priority: 2,
        Action: { Count: {} },
        Statement: {
          IPSetReferenceStatement: { ARN: arns["challenge-ipv4"]! },
        },
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: "counted",
        },
      },
    ]);

    const state: AwsWafRuleState = await h.group.readRuleState({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.XForwardedFor,
      addsRule: false,
    });

    expect(state.enforcedSetKeys).toEqual([]);
    expect(state.status).toBe(SecurityBlockCloudWafStatus.WaitingForRule);
  });
});

describe("taking it down", () => {
  test("takes OneUptime's rules out and writes every rule of the customer's back; nothing to do when they are not there", async () => {
    const h: Harness = harness({ rules: [customerRule("geo", 10)] });

    await h.group.ensureRules({
      webAcl: h.webAcl,
      clientAddress: SecurityBlockClientAddress.SourceIp,
    });

    expect(await h.group.removeRules(h.webAcl)).toBe(true);
    expect(h.fake.getRules(REGION, "REGIONAL", "prod-alb")).toEqual([
      customerRule("geo", 10),
    ]);
    expect(await h.group.removeRules(h.webAcl)).toBe(false);
  });

  test("empties and deletes the sets; one a rule still references is left, empty, and named", async () => {
    const h: Harness = harness();
    const arns: Record<string, string> = await h.group.ensureSets();

    await h.group.changeSet("block-ipv4", {
      add: [{ value: "35.205.11.131", cidr: "35.205.11.131/32" }],
      remove: [],
    });

    // A rule kept in code still references the IPv4 block set.
    bumpWebAcl(h.fake.state(REGION, "REGIONAL").webAcls.get(h.webAcl.id)!, [
      {
        Name: "terraform",
        Priority: 0,
        Action: { Block: {} },
        Statement: { IPSetReferenceStatement: { ARN: arns["block-ipv4"]! } },
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: "terraform",
        },
      },
    ]);

    const left: Array<string> = await h.group.emptyAndDeleteSets();

    expect(left).toEqual([setName("block-ipv4")]);
    expect(cidrsOf(h.fake, "block-ipv4")).toEqual([]);

    for (const key of ["block-ipv6", "challenge-ipv4", "challenge-ipv6"]) {
      expect(h.fake.getIpSet(REGION, "REGIONAL", setName(key))).toBeUndefined();
    }
  });
});

describe("sampled requests", () => {
  test("reads what a rule sampled in a window: each request's address, headers and when", async () => {
    const sampled: Record<string, Array<JSONObject>> = {};
    const fakeWithSamples: FakeAwsWaf = createFakeAwsWaf({
      sampledRequests: sampled,
    });
    const h: Harness = harness({ fake: fakeWithSamples });

    sampled[`${h.webAcl.arn}|${RULES.block}`] = [
      {
        Request: {
          ClientIP: "35.205.11.131",
          Country: "BE",
          URI: "/login",
          Method: "POST",
          HTTPVersion: "HTTP/1.1",
          Headers: [
            { Name: "Host", Value: "app.example.com" },
            { Name: "X-Forwarded-For", Value: "1.2.3.4, 35.205.11.131" },
          ],
        },
        Weight: 1,
        Timestamp: 1795255200,
        Action: "BLOCK",
      },
    ];

    const session: Awaited<ReturnType<AwsWafBlocklistGroup["getSession"]>> =
      await h.group.getSession();
    const samples: Awaited<ReturnType<typeof getAwsWafSampledRequests>> =
      await getAwsWafSampledRequests(session, {
        webAclArn: h.webAcl.arn,
        webAclName: "prod-alb",
        ruleMetricName: RULES.block,
        from: new Date(Date.UTC(2026, 10, 21, 7, 0, 0)),
        to: new Date(Date.UTC(2026, 10, 21, 10, 0, 0)),
        maxItems: 100,
      });

    expect(samples).toEqual([
      {
        clientIp: "35.205.11.131",
        headers: {
          host: ["app.example.com"],
          "x-forwarded-for": ["1.2.3.4, 35.205.11.131"],
        },
        timestamp: new Date(1795255200 * 1000),
        action: "BLOCK",
        weight: 1,
      },
    ]);

    const call: { body: JSONObject } = fakeWithSamples.calls.find(
      (candidate: { action: string }) => {
        return candidate.action === "GetSampledRequests";
      },
    )!;

    expect(call.body).toEqual({
      WebAclArn: h.webAcl.arn,
      RuleMetricName: RULES.block,
      Scope: "REGIONAL",
      TimeWindow: {
        StartTime: Date.UTC(2026, 10, 21, 7, 0, 0) / 1000,
        EndTime: Date.UTC(2026, 10, 21, 10, 0, 0) / 1000,
      },
      MaxItems: 100,
    });
  });

  test("a refusal to read them says which permission", async () => {
    const fake: FakeAwsWaf = createFakeAwsWaf();
    const h: Harness = harness({ fake });

    fake.failNext(
      "GetSampledRequests",
      wafError("AccessDeniedException", "not authorized"),
    );

    let failure: unknown = null;

    try {
      await getAwsWafSampledRequests(await h.group.getSession(), {
        webAclArn: h.webAcl.arn,
        webAclName: "prod-alb",
        ruleMetricName: RULES.block,
        from: new Date(),
        to: new Date(),
        maxItems: 10,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
    expect((failure as Error).message).toContain(
      "AWS refused wafv2:GetSampledRequests on web ACL prod-alb",
    );
  });
});
