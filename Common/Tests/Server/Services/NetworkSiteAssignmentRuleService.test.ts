import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import NetworkSiteAssignmentRule from "../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * Contract under test: an assignment rule must always end up with at least
 * one usable criterion (subnetCidr or hostnamePattern), and a provided CIDR
 * must be well-formed - on create AND on any update, including updates that
 * clear one criterion while the other only exists on the stored row.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SITE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

function makeCreateBy(data: {
  subnetCidr?: string | undefined;
  hostnamePattern?: string | undefined;
}): CreateBy<NetworkSiteAssignmentRule> {
  const rule: NetworkSiteAssignmentRule = new NetworkSiteAssignmentRule();
  rule.projectId = PROJECT_ID;
  rule.siteId = SITE_ID;
  if (data.subnetCidr !== undefined) {
    rule.subnetCidr = data.subnetCidr;
  }
  if (data.hostnamePattern !== undefined) {
    rule.hostnamePattern = data.hostnamePattern;
  }
  return {
    data: rule,
    props: { isRoot: true },
  };
}

describe("NetworkSiteAssignmentRuleService.onBeforeCreate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects a rule with neither criterion", async () => {
    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate(
        makeCreateBy({}),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects whitespace-only criteria", async () => {
    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate(
        makeCreateBy({ subnetCidr: "  ", hostnamePattern: " " }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a malformed CIDR", async () => {
    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate(
        makeCreateBy({ subnetCidr: "10.0.0.0/33" }),
      ),
    ).rejects.toThrow(BadDataException);
    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate(
        makeCreateBy({ subnetCidr: "not-a-cidr" }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("accepts a CIDR-only rule", async () => {
    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate(
        makeCreateBy({ subnetCidr: "10.0.0.0/24" }),
      ),
    ).resolves.toBeDefined();
  });

  it("accepts a hostname-pattern-only rule", async () => {
    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate(
        makeCreateBy({ hostnamePattern: "unit-*" }),
      ),
    ).resolves.toBeDefined();
  });
});

describe("NetworkSiteAssignmentRuleService.onBeforeUpdate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeUpdateBy(
    data: Record<string, unknown>,
  ): UpdateBy<NetworkSiteAssignmentRule> {
    return {
      query: { _id: "some-rule-id" },
      data: data,
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkSiteAssignmentRule>;
  }

  function mockExistingRule(data: {
    subnetCidr?: string | undefined;
    hostnamePattern?: string | undefined;
  }): void {
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([data as unknown as NetworkSiteAssignmentRule]);
  }

  it("allows clearing the CIDR while the stored row keeps a hostname pattern", async () => {
    mockExistingRule({
      subnetCidr: "10.0.0.0/24",
      hostnamePattern: "unit-*",
    });

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeUpdate(
        makeUpdateBy({ subnetCidr: null }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects clearing the only criterion", async () => {
    mockExistingRule({ subnetCidr: "10.0.0.0/24" });

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeUpdate(
        makeUpdateBy({ subnetCidr: null }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects clearing both criteria at once", async () => {
    mockExistingRule({
      subnetCidr: "10.0.0.0/24",
      hostnamePattern: "unit-*",
    });

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeUpdate(
        makeUpdateBy({ subnetCidr: null, hostnamePattern: "" }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects updating to a malformed CIDR", async () => {
    mockExistingRule({ subnetCidr: "10.0.0.0/24" });

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeUpdate(
        makeUpdateBy({ subnetCidr: "10.0.0.0/99" }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("accepts a valid CIDR change", async () => {
    mockExistingRule({ subnetCidr: "10.0.0.0/24" });

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeUpdate(
        makeUpdateBy({ subnetCidr: "192.168.0.0/16" }),
      ),
    ).resolves.toBeDefined();
  });

  it("skips validation entirely when neither criterion is touched", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteAssignmentRuleService,
      "findBy",
    );

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeUpdate(
        makeUpdateBy({ priority: 42 }),
      ),
    ).resolves.toBeDefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });
});
