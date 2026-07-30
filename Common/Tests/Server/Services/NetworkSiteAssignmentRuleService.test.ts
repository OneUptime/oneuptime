import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
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
 *
 * Plus the site the rule points at must belong to the rule's own project,
 * under either spelling of the reference: the dashboard's form posts the
 * `site` relation, not the `siteId` column. A rule aimed at a foreign site
 * renders that site's name in the rules table and can never assign anything,
 * because NetworkDeviceService rejects the device update it would drive.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SITE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

function mockSiteInProject(projectId: ObjectID): jest.SpyInstance {
  return jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue({
    id: SITE_ID,
    _id: SITE_ID.toString(),
    projectId: projectId,
  } as unknown as NetworkSite);
}

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
    mockSiteInProject(PROJECT_ID);

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate(
        makeCreateBy({ subnetCidr: "10.0.0.0/24" }),
      ),
    ).resolves.toBeDefined();
  });

  it("accepts a hostname-pattern-only rule", async () => {
    mockSiteInProject(PROJECT_ID);

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate(
        makeCreateBy({ hostnamePattern: "unit-*" }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a rule that points at another project's site", async () => {
    mockSiteInProject(OTHER_PROJECT_ID);

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate(
        makeCreateBy({ hostnamePattern: "unit-*" }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a rule whose site does not resolve to a row", async () => {
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(null);

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate(
        makeCreateBy({ hostnamePattern: "unit-*" }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * The dashboard posts `{ site: { _id } }`; a guard that reads only `siteId`
   * would wave this straight through.
   */
  it("checks the site given as the dashboard's `site` relation", async () => {
    mockSiteInProject(OTHER_PROJECT_ID);

    const rule: NetworkSiteAssignmentRule = new NetworkSiteAssignmentRule();
    rule.projectId = PROJECT_ID;
    rule.hostnamePattern = "unit-*";
    (rule as any).site = { _id: SITE_ID.toString() };

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeCreate({
        data: rule,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);
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

  it("skips validation entirely when neither criterion nor site is touched", async () => {
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

  it("rejects re-pointing a rule at another project's site", async () => {
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([
        { projectId: PROJECT_ID } as unknown as NetworkSiteAssignmentRule,
      ]);
    mockSiteInProject(OTHER_PROJECT_ID);

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeUpdate(
        makeUpdateBy({ site: { _id: SITE_ID.toString() } }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("accepts re-pointing a rule at a site in its own project", async () => {
    jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue([
        { projectId: PROJECT_ID } as unknown as NetworkSiteAssignmentRule,
      ]);
    mockSiteInProject(PROJECT_ID);

    await expect(
      (NetworkSiteAssignmentRuleService as any).onBeforeUpdate(
        makeUpdateBy({ siteId: SITE_ID }),
      ),
    ).resolves.toBeDefined();
  });
});
