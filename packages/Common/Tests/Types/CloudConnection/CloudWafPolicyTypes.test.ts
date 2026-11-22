import { describe, expect, test } from "@jest/globals";
import {
  AZURE_WAF_BLOCKLIST_ACTIONS,
  AzureWafPolicyKind,
  AzureWafPolicyRef,
  getAzureWafBlocklistRoleLines,
  getAzureWafDestinationName,
  getAzureWafMatchVariable,
  getAzureWafPassPriority,
  getAzureWafPolicyAccessCommand,
  getAzureWafRuleName,
  isAzureActionPermitted,
  parseAzureWafPolicyId,
  readAzureWafRuleIndex,
  toAzureWafAddress,
} from "../../../Types/CloudConnection/AzureWafBlocklist";
import {
  CloudArmorBlocklistMode,
  CloudArmorPolicyRef,
  CloudArmorPolicyType,
  chooseCloudArmorMode,
  getCloudArmorAddressGroupNames,
  getCloudArmorClientAddresses,
  getCloudArmorConsoleUrl,
  getCloudArmorDestinationName,
  getCloudArmorPassPriority,
  getCloudArmorPolicyAccessCommand,
  getCloudArmorRuleDescription,
  isAnyOneUptimeCloudArmorRule,
  isCloudArmorGroupRule,
  isCloudArmorPolicyTypeSupported,
  parseCloudArmorPolicyId,
  readCloudArmorRule,
  readCloudArmorRuleIndex,
  toCloudArmorRange,
} from "../../../Types/CloudConnection/CloudArmorBlocklist";
import {
  CloudWafSlotPlan,
  CloudWafSlotRefusal,
  getCloudWafFreePriorities,
  getCloudWafProjectSuffix,
  getCloudWafValueKey,
  planCloudWafValueSlots,
} from "../../../Types/CloudConnection/CloudWafRuleSlots";
import { getAwsExternalIdForProject } from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { SecurityBlockClientAddress } from "../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import {
  SecurityBlockCloudWafKind,
  canSecurityBlockCloudWafReadClientAddress,
  getSecurityBlockCloudWafClientAddresses,
  getSecurityBlockCloudWafKind,
} from "../../../Types/SecurityBlocklist/SecurityBlockCloudWafKind";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";

/*
 * WHAT OneUptime KEEPS IN AN AZURE WAF OR CLOUD ARMOR POLICY, NAMED AND
 * PLANNED ONCE (#10348, #10349): the slot planner both share - which
 * addresses go in which of OneUptime's rules, at which free priority,
 * never a customer's priority - the policies' names read from what names
 * them, OneUptime's rules told from the customer's, the address a rule
 * matches, and the lines that grant one policy.
 */

describe("the slot planner", () => {
  test("fills the rules there first, then new ones at the free priorities, lowest first", () => {
    const plan: CloudWafSlotPlan = planCloudWafValueSlots({
      slots: [{ index: 1, priority: 3, values: ["192.0.2.1"], isFrozen: false }],
      add: ["192.0.2.2", "192.0.2.3", "192.0.2.4"],
      remove: [],
      perSlot: 2,
      maxSlots: 10,
      freePriorities: [4, 7],
      nextIndex: 2,
    });

    expect(
      plan.slots.map((slot: { index: number; priority: number; values: Array<string> }) => {
        return [slot.index, slot.priority, slot.values];
      }),
    ).toEqual([
      [1, 3, ["192.0.2.1", "192.0.2.2"]],
      [2, 4, ["192.0.2.3", "192.0.2.4"]],
    ]);
    expect(plan.changed.map((slot: { index: number }) => slot.index)).toEqual([1]);
    expect(plan.created.map((slot: { index: number }) => slot.index)).toEqual([2]);
    expect(plan.isChanged).toBe(true);
  });

  test("a removed address makes room, an emptied rule goes, and the same address twice is one", () => {
    const plan: CloudWafSlotPlan = planCloudWafValueSlots({
      slots: [
        { index: 1, priority: 1, values: ["192.0.2.1", "192.0.2.2"], isFrozen: false },
        { index: 2, priority: 2, values: ["192.0.2.3"], isFrozen: false },
      ],
      add: ["192.0.2.9", "192.0.2.9/32"],
      remove: ["192.0.2.2", "192.0.2.3"],
      perSlot: 2,
      maxSlots: 10,
      freePriorities: [5],
    });

    expect(plan.slots).toEqual([
      { index: 1, priority: 1, values: ["192.0.2.1", "192.0.2.9"], isFrozen: false },
    ]);
    expect(plan.emptied.map((slot: { index: number }) => slot.index)).toEqual([2]);
    expect(plan.added.map((addition: { isDone: boolean }) => addition.isDone)).toEqual([
      true,
      true,
    ]);
    expect(getCloudWafValueKey("192.0.2.9/32")).toBe(getCloudWafValueKey("192.0.2.9"));
  });

  test("a frozen rule - turned off by hand - takes nothing new, but lets a lifted address go", () => {
    const plan: CloudWafSlotPlan = planCloudWafValueSlots({
      slots: [
        { index: 1, priority: 1, values: ["192.0.2.1", "192.0.2.2"], isFrozen: true },
      ],
      add: ["192.0.2.5"],
      remove: ["192.0.2.2"],
      perSlot: 5,
      maxSlots: 10,
      freePriorities: [2],
      nextIndex: 2,
    });

    expect(plan.slots[0]!.values).toEqual(["192.0.2.1"]);
    expect(plan.slots[1]).toEqual({
      index: 2,
      priority: 2,
      values: ["192.0.2.5"],
      isFrozen: false,
    });
  });

  test("past the most rules it may take, an address is Full; with no free priority, No Free Priority", () => {
    const full: CloudWafSlotPlan = planCloudWafValueSlots({
      slots: [{ index: 1, priority: 1, values: ["192.0.2.1"], isFrozen: false }],
      add: ["192.0.2.2"],
      remove: [],
      perSlot: 1,
      maxSlots: 1,
      freePriorities: [2],
    });

    expect(full.added[0]!.refusal).toBe(CloudWafSlotRefusal.Full);

    const stuck: CloudWafSlotPlan = planCloudWafValueSlots({
      slots: [],
      add: ["192.0.2.2"],
      remove: [],
      perSlot: 10,
      maxSlots: 10,
      freePriorities: [],
    });

    expect(stuck.added[0]!.refusal).toBe(CloudWafSlotRefusal.NoFreePriority);
    expect(stuck.isChanged).toBe(false);
  });

  test("free priorities are before the first rule that lets a request through, never one taken", () => {
    expect(
      getCloudWafFreePriorities({
        usedPriorities: [1, 2, 4],
        passPriority: 6,
        lowest: 1,
        highest: 100,
        limit: 10,
      }),
    ).toEqual([3, 5]);
    expect(
      getCloudWafFreePriorities({
        usedPriorities: [],
        passPriority: null,
        lowest: 0,
        highest: 2147483646,
        limit: 3,
      }),
    ).toEqual([0, 1, 2]);
    expect(
      getCloudWafFreePriorities({
        usedPriorities: [],
        passPriority: 0,
        lowest: 0,
        highest: 100,
        limit: 10,
      }),
    ).toEqual([]);
  });

  test("a project's suffix is its AWS external id's: one project's rules never another's", () => {
    const first: string = getCloudWafProjectSuffix(
      "11111111-1111-4111-8111-111111111111",
    );

    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(getAwsExternalIdForProject("11111111-1111-4111-8111-111111111111")).toContain(first);
    expect(getCloudWafProjectSuffix("22222222-2222-4222-8222-222222222222")).not.toBe(first);
  });
});

describe("Azure WAF policies", () => {
  const SUBSCRIPTION: string = "D0CFE6B2-9AC0-4464-9919-DCCAEE2E48C0";

  test("a policy's id is read in any case, as Resource Graph lowers it, and anything else is refused", () => {
    const policy: AzureWafPolicyRef = parseAzureWafPolicyId(
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.network/applicationgatewaywebapplicationfirewallpolicies/prod-waf`,
    )!;

    expect(policy.kind).toBe(AzureWafPolicyKind.ApplicationGateway);
    expect(policy.subscriptionId).toBe(SUBSCRIPTION.toLowerCase());
    expect(policy.resourceGroup).toBe("rg-prod");
    expect(policy.name).toBe("prod-waf");
    expect(
      parseAzureWafPolicyId(
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/edgewaf`,
      )!.kind,
    ).toBe(AzureWafPolicyKind.FrontDoor);

    for (const value of [
      "",
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Network/applicationGateways/agw`,
      "/subscriptions/not-a-guid/resourceGroups/rg/providers/Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/x",
      42,
    ]) {
      expect(parseAzureWafPolicyId(value)).toBeNull();
    }
  });

  test("OneUptime's rules are named for the project and numbered; another project's, and the customer's, are not its own", () => {
    expect(getAzureWafRuleName("1a2b3c4d", 3)).toBe("OneUptime1a2b3c4dBlock3");
    expect(readAzureWafRuleIndex("OneUptime1a2b3c4dBlock3", "1a2b3c4d")).toBe(3);
    expect(readAzureWafRuleIndex("OneUptime9f8e7d6cBlock3", "1a2b3c4d")).toBeNull();
    expect(readAzureWafRuleIndex("AllowOffice", "1a2b3c4d")).toBeNull();
    expect(readAzureWafRuleIndex("OneUptime1a2b3c4dBlock0", "1a2b3c4d")).toBeNull();
  });

  test("an address as each kind takes it: Application Gateway IPv4 alone, a single address bare", () => {
    expect(toAzureWafAddress(AzureWafPolicyKind.ApplicationGateway, "35.205.11.131/32")).toBe(
      "35.205.11.131",
    );
    expect(toAzureWafAddress(AzureWafPolicyKind.ApplicationGateway, "185.220.101.0/24")).toBe(
      "185.220.101.0/24",
    );
    expect(toAzureWafAddress(AzureWafPolicyKind.ApplicationGateway, "2001:db8::1")).toBeNull();
    expect(toAzureWafAddress(AzureWafPolicyKind.FrontDoor, "2001:db8::1")).toBe("2001:db8::1");
    expect(toAzureWafAddress(AzureWafPolicyKind.FrontDoor, "example.com")).toBeNull();
  });

  test("which address a rule matches: the address that connected, unless Front Door is told to read X-Forwarded-For", () => {
    expect(
      getAzureWafMatchVariable(AzureWafPolicyKind.FrontDoor, SecurityBlockClientAddress.SourceIp),
    ).toBe("SocketAddr");
    expect(
      getAzureWafMatchVariable(
        AzureWafPolicyKind.FrontDoor,
        SecurityBlockClientAddress.ForwardedClient,
      ),
    ).toBe("RemoteAddr");
    expect(
      getAzureWafMatchVariable(
        AzureWafPolicyKind.ApplicationGateway,
        SecurityBlockClientAddress.SourceIp,
      ),
    ).toBe("RemoteAddr");
  });

  test("OneUptime's rules go before the customer's first Allow rule, on or off", () => {
    expect(
      getAzureWafPassPriority([
        { name: "a", priority: 10, action: "Block" },
        { name: "b", priority: 40, action: "Allow", state: "Disabled" },
        { name: "c", priority: 20, action: "Log" },
      ]),
    ).toBe(40);
    expect(getAzureWafPassPriority([{ name: "a", priority: 10, action: "Block" }])).toBeNull();
  });

  test("an action is granted by a wildcard and taken away by a not-action", () => {
    const read: string = AZURE_WAF_BLOCKLIST_ACTIONS[0]!;
    const write: string = AZURE_WAF_BLOCKLIST_ACTIONS[1]!;

    expect(isAzureActionPermitted({ action: write, permissions: [{ actions: ["*"], notActions: [] }] })).toBe(true);
    expect(
      isAzureActionPermitted({
        action: write,
        permissions: [{ actions: ["Microsoft.Network/*"], notActions: ["*/write"] }],
      }),
    ).toBe(false);
    expect(
      isAzureActionPermitted({ action: read, permissions: [{ actions: ["*/read"], notActions: [] }] }),
    ).toBe(true);
    expect(isAzureActionPermitted({ action: write, permissions: [] })).toBe(false);
  });

  test("the setup command makes the role on its scope and assigns it; one policy's lines widen an existing role by its id and roleName and assign it on the policy alone", () => {
    const lines: Array<string> = getAzureWafBlocklistRoleLines();

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Name: "OneUptime WAF Blocklist"');
    expect(lines[0]).toContain("AssignableScopes: [$scope]");

    for (const action of AZURE_WAF_BLOCKLIST_ACTIONS) {
      expect(lines[0]).toContain(`"${action}"`);
    }

    expect(lines[2]).toBe(
      'az role assignment create --assignee "$APP" --role "OneUptime WAF Blocklist" --scope "$SCOPE" > /dev/null',
    );

    const policy: AzureWafPolicyRef = parseAzureWafPolicyId(
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/prod-waf`,
    )!;
    const command: string = getAzureWafPolicyAccessCommand({
      clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
      policy,
    });

    expect(command).toContain(`SCOPE="/subscriptions/${SUBSCRIPTION.toLowerCase()}"`);
    // az role definition update finds a role by its full id, and needs its roleName with it.
    expect(command).toContain("{Id: .id, RoleName: .roleName,");
    expect(command).toContain("AssignableScopes: ((.assignableScopes + [$scope]) | unique)");
    expect(command.split("\n").pop()).toBe(
      `az role assignment create --assignee "00001111-aaaa-2222-bbbb-3333cccc4444" --role "OneUptime WAF Blocklist" --scope "${policy.id}" > /dev/null`,
    );
    expect(getAzureWafDestinationName("prod-waf")).toBe("Azure WAF (prod-waf)");
  });
});

describe("Cloud Armor policies", () => {
  test("a policy's name is read from its relative name or its self link, global or regional", () => {
    expect(parseCloudArmorPolicyId("projects/acme-prod/global/securityPolicies/prod-lb")).toEqual({
      id: "projects/acme-prod/global/securityPolicies/prod-lb",
      project: "acme-prod",
      region: null,
      name: "prod-lb",
    });
    expect(
      parseCloudArmorPolicyId(
        "https://www.googleapis.com/compute/v1/projects/acme-prod/regions/europe-west1/securityPolicies/eu-lb",
      ),
    ).toEqual({
      id: "projects/acme-prod/regions/europe-west1/securityPolicies/eu-lb",
      project: "acme-prod",
      region: "europe-west1",
      name: "eu-lb",
    });
    expect(parseCloudArmorPolicyId("projects/x/global/firewalls/y")).toBeNull();
  });

  test("OneUptime's rules say so in their description: numbered, or the address groups' one; another project's are not its own", () => {
    const description: string = getCloudArmorRuleDescription("1a2b3c4d", 4);

    expect(description).toBe(
      "OneUptime blocklist 1a2b3c4d #4. Managed by OneUptime: changes here are replaced.",
    );
    expect(readCloudArmorRuleIndex(description, "1a2b3c4d")).toBe(4);
    expect(readCloudArmorRuleIndex(description, "9f8e7d6c")).toBeNull();
    expect(
      isCloudArmorGroupRule(
        "OneUptime blocklist 1a2b3c4d, address groups. Managed by OneUptime: changes here are replaced.",
        "1a2b3c4d",
      ),
    ).toBe(true);
    expect(isAnyOneUptimeCloudArmorRule(getCloudArmorRuleDescription("9f8e7d6c", 1))).toBe(true);
    expect(isAnyOneUptimeCloudArmorRule("Allow the office")).toBe(false);
  });

  test("a single address is a /32 or /128, a range as it is, and /0 never", () => {
    expect(toCloudArmorRange("35.205.11.131")).toBe("35.205.11.131/32");
    expect(toCloudArmorRange("2001:db8::1")).toBe("2001:db8::1/128");
    expect(toCloudArmorRange("185.220.101.0/24")).toBe("185.220.101.0/24");
    expect(toCloudArmorRange("0.0.0.0/0")).toBeNull();
    expect(toCloudArmorRange("example.com")).toBeNull();
  });

  test("a rule's addresses are read from a basic match or from inIpRange terms; anything else is not a plain list", () => {
    expect(
      readCloudArmorRule({
        priority: 3,
        action: "deny(403)",
        match: { versionedExpr: "SRC_IPS_V1", config: { srcIpRanges: ["192.0.2.1/32"] } },
      }),
    ).toEqual(
      expect.objectContaining({ attribute: "origin.ip", values: ["192.0.2.1"], isDeny: true }),
    );
    expect(
      readCloudArmorRule({
        priority: 3,
        action: "deny(404)",
        match: {
          expr: {
            expression:
              "inIpRange(origin.user_ip, '192.0.2.1/32') || inIpRange(origin.user_ip, '2001:db8::/32')",
          },
        },
      }),
    ).toEqual(
      expect.objectContaining({
        attribute: "origin.user_ip",
        values: ["192.0.2.1", "2001:db8::/32"],
      }),
    );
    expect(
      readCloudArmorRule({
        priority: 3,
        action: "deny(403)",
        match: { expr: { expression: "origin.region_code == 'KP'" } },
      }).attribute,
    ).toBeNull();
  });

  test("OneUptime's rules go before the first rule that lets a request through: allow, throttle, rate-based ban, fair share", () => {
    expect(
      getCloudArmorPassPriority([
        { priority: 1000, action: "deny(403)" },
        { priority: 1500, action: "throttle" },
        { priority: 2147483647, action: "allow" },
      ]),
    ).toBe(1500);
    expect(
      getCloudArmorPassPriority([
        { priority: 1, action: "allow", description: getCloudArmorRuleDescription("9f8e7d6c", 1) },
        { priority: 2147483647, action: "deny(403)" },
      ]),
    ).toBeNull();
  });

  test("address groups for a global backend policy of an Enterprise project, rules for everything else", () => {
    expect(
      chooseCloudArmorMode({ tier: "CA_ENTERPRISE_PAYGO", policyType: CloudArmorPolicyType.Backend, region: null }),
    ).toBe(CloudArmorBlocklistMode.AddressGroups);
    expect(
      chooseCloudArmorMode({ tier: "CA_ENTERPRISE_ANNUAL", policyType: CloudArmorPolicyType.Edge, region: null }),
    ).toBe(CloudArmorBlocklistMode.Rules);
    expect(
      chooseCloudArmorMode({
        tier: "CA_ENTERPRISE_PAYGO",
        policyType: CloudArmorPolicyType.Backend,
        region: "europe-west1",
      }),
    ).toBe(CloudArmorBlocklistMode.Rules);
    expect(
      chooseCloudArmorMode({ tier: "CA_STANDARD", policyType: CloudArmorPolicyType.Backend, region: null }),
    ).toBe(CloudArmorBlocklistMode.Rules);
    expect(getCloudArmorAddressGroupNames("1a2b3c4d")).toEqual({
      ipv4: "oneuptime-1a2b3c4d-block-ipv4",
      ipv6: "oneuptime-1a2b3c4d-block-ipv6",
    });
  });

  test("an edge policy reads the address that connected alone; a network edge policy is not one OneUptime keeps the blocklist in", () => {
    expect(getCloudArmorClientAddresses(CloudArmorPolicyType.Backend)).toEqual([
      SecurityBlockClientAddress.SourceIp,
      SecurityBlockClientAddress.UserIp,
    ]);
    expect(getCloudArmorClientAddresses(CloudArmorPolicyType.Edge)).toEqual([
      SecurityBlockClientAddress.SourceIp,
    ]);
    expect(isCloudArmorPolicyTypeSupported(CloudArmorPolicyType.Network)).toBe(false);
    expect(isCloudArmorPolicyTypeSupported(CloudArmorPolicyType.Edge)).toBe(true);
  });

  test("one policy's lines make the role in its project, or update it, and bind it to the connection's service account", () => {
    const policy: CloudArmorPolicyRef = parseCloudArmorPolicyId(
      "projects/acme-prod/global/securityPolicies/prod-lb",
    )!;
    const command: Array<string> = getCloudArmorPolicyAccessCommand({
      serviceAccountEmail: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
      policy,
    }).split("\n");

    expect(command).toHaveLength(2);
    expect(command[0]).toContain('gcloud iam roles create oneuptimeCloudArmorBlocklist --project "acme-prod"');
    expect(command[0]).toContain(' || gcloud iam roles update oneuptimeCloudArmorBlocklist --project "acme-prod"');
    expect(command[1]).toBe(
      'gcloud projects add-iam-policy-binding "acme-prod" --member "serviceAccount:oneuptime-read-only@acme-prod.iam.gserviceaccount.com" --role projects/acme-prod/roles/oneuptimeCloudArmorBlocklist --condition=None > /dev/null',
    );
    expect(getCloudArmorDestinationName("prod-lb")).toBe("Cloud Armor (prod-lb)");
    expect(getCloudArmorConsoleUrl(policy)).toBe(
      "https://console.cloud.google.com/net-security/securitypolicies/details/prod-lb?project=acme-prod",
    );
  });
});

describe("a picked WAF's kind", () => {
  test("is read from its cloud and its id, and says where it can read the client's address", () => {
    expect(
      getSecurityBlockCloudWafKind({
        cloudProvider: CloudProvider.AWS,
        wafId:
          "arn:aws:wafv2:eu-west-1:123456789012:regional/webacl/prod-alb/a1b2c3d4-5678-90ab-cdef-111111111111",
      }),
    ).toBe(SecurityBlockCloudWafKind.AwsWebAcl);
    expect(
      getSecurityBlockCloudWafKind({
        cloudProvider: CloudProvider.Azure,
        wafId:
          "/subscriptions/d0cfe6b2-9ac0-4464-9919-dccaee2e48c0/resourceGroups/rg/providers/Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/edgewaf",
      }),
    ).toBe(SecurityBlockCloudWafKind.AzureFrontDoor);
    expect(
      getSecurityBlockCloudWafKind({
        cloudProvider: CloudProvider.GCP,
        wafId: "projects/acme-prod/global/securityPolicies/prod-lb",
      }),
    ).toBe(SecurityBlockCloudWafKind.CloudArmor);
    expect(getSecurityBlockCloudWafKind({ cloudProvider: CloudProvider.GCP, wafId: "nope" })).toBeNull();

    expect(
      getSecurityBlockCloudWafClientAddresses({
        kind: SecurityBlockCloudWafKind.AzureApplicationGateway,
      }),
    ).toEqual([SecurityBlockClientAddress.SourceIp]);
    expect(
      canSecurityBlockCloudWafReadClientAddress({
        kind: SecurityBlockCloudWafKind.AzureFrontDoor,
        clientAddress: SecurityBlockClientAddress.ForwardedClient,
      }),
    ).toBe(true);
    // A header only AWS WAF reads is not a choice anywhere else.
    expect(
      canSecurityBlockCloudWafReadClientAddress({
        kind: SecurityBlockCloudWafKind.CloudArmor,
        cloudArmorPolicyType: CloudArmorPolicyType.Backend,
        clientAddress: SecurityBlockClientAddress.CfConnectingIp,
      }),
    ).toBe(false);
  });
});
