import {
  CLOUD_ORGANIZATION_AGENT_STATES,
  CLOUD_ORGANIZATION_MAX_ACCOUNTS,
  CloudOrganizationView,
  NOT_AN_ORGANIZATION,
  RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
  RESOURCE_AI_ACCESS_ORGANIZATION_PATH,
  countConnectedAccounts,
  getRoleArnAccountId,
  isAwsAccountId,
  parseCloudOrganizationKeys,
  parseCloudOrganizationView,
} from "../../../Types/CloudConnection/CloudOrganizationAgents";
import { CLOUD_AI_AGENT_ORGANIZATION_MAX_ACCOUNTS } from "../../../Types/CloudConnection/CloudAiAgentSetupCommands";
import { describe, expect, test } from "@jest/globals";

/*
 * Types/CloudConnection/CloudOrganizationAgents - what the dashboard and
 * the server share about an AWS Organization's Cloud AI agents: the routes,
 * the management account read off a role ARN, and the answers as the
 * dashboard reads them off the wire (anything else reads as nothing).
 */

const ROW: Record<string, unknown> = {
  cloudAccountId: "aaaaaaaa-1111-4111-8111-111111111111",
  accountId: "111111111111",
  name: "Management",
  isManagementAccount: true,
  agent: "connected",
  lastSeenAt: "2026-11-06T10:00:00.000Z",
};

describe("the routes", () => {
  test("live beside the account's other AI access routes", () => {
    expect(RESOURCE_AI_ACCESS_ORGANIZATION_PATH).toBe(
      "/resource-ai-access/organization",
    );
    expect(RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH).toBe(
      "/resource-ai-access/organization-agent-keys",
    );
  });

  test("list no more accounts than one command sets up", () => {
    expect(CLOUD_ORGANIZATION_MAX_ACCOUNTS).toBe(
      CLOUD_AI_AGENT_ORGANIZATION_MAX_ACCOUNTS,
    );
  });
});

describe("getRoleArnAccountId", () => {
  test.each([
    ["arn:aws:iam::111111111111:role/OneUptimeRead", "111111111111"],
    [
      "arn:aws-us-gov:iam::222222222222:role/path/OneUptimeRead",
      "222222222222",
    ],
    ["arn:aws-cn:iam::333333333333:role/x", "333333333333"],
  ])("%s is in account %s", (arn: string, account: string) => {
    expect(getRoleArnAccountId(arn)).toBe(account);
  });

  test.each([
    [undefined],
    [null],
    [42],
    [""],
    ["arn:aws:iam::11111111111:role/short"],
    ["arn:aws:iam::1111111111111:role/long"],
    ["arn:aws:iam::11111111111a:role/letters"],
    ["arn:aws:iam::111111111111:user/someone"],
    ["arn:aws:s3:::111111111111:role/x"],
    ["aws:iam::111111111111:role/x"],
  ])("%j is no role's account", (value: unknown) => {
    expect(getRoleArnAccountId(value)).toBeNull();
  });
});

describe("isAwsAccountId", () => {
  test("twelve digits, and nothing else", () => {
    expect(isAwsAccountId("123456789012")).toBe(true);

    for (const value of [
      "12345678901",
      "1234567890123",
      "12345678901a",
      " 123456789012",
      "",
      123456789012,
      null,
      undefined,
    ]) {
      expect(isAwsAccountId(value)).toBe(false);
    }
  });
});

describe("parseCloudOrganizationView", () => {
  test("an organization, its rows as sent", () => {
    const view: CloudOrganizationView = parseCloudOrganizationView({
      isOrganization: true,
      managementAccountId: "111111111111",
      accounts: [
        ROW,
        {
          ...ROW,
          cloudAccountId: "bbbbbbbb-2222-4222-8222-222222222222",
          accountId: "222222222222",
          name: "",
          isManagementAccount: false,
          agent: "none",
          lastSeenAt: null,
        },
      ],
      isTruncated: true,
    });

    expect(view).toEqual({
      isOrganization: true,
      managementAccountId: "111111111111",
      accounts: [
        ROW,
        {
          cloudAccountId: "bbbbbbbb-2222-4222-8222-222222222222",
          accountId: "222222222222",
          // A row without a name goes by its account id.
          name: "222222222222",
          isManagementAccount: false,
          agent: "none",
          lastSeenAt: null,
        },
      ],
      isTruncated: true,
    });
  });

  test.each([
    [null],
    [undefined],
    ["organization"],
    [[]],
    [{}],
    [{ isOrganization: "true", accounts: [ROW] }],
    [{ isOrganization: false, accounts: [ROW] }],
  ])("%j is no organization", (value: unknown) => {
    expect(parseCloudOrganizationView(value)).toEqual(NOT_AN_ORGANIZATION);
  });

  test.each([
    [{ ...ROW, cloudAccountId: "" }],
    [{ ...ROW, accountId: 111111111111 }],
    [{ ...ROW, agent: "online" }],
    [{ ...ROW, agent: undefined }],
    ["row"],
    [null],
  ])("a row of the wrong shape is left out: %j", (row: unknown) => {
    expect(
      parseCloudOrganizationView({
        isOrganization: true,
        managementAccountId: "111111111111",
        accounts: [row, ROW],
      }).accounts,
    ).toEqual([ROW]);
  });

  test("every agent state reads as itself", () => {
    for (const agent of CLOUD_ORGANIZATION_AGENT_STATES) {
      expect(
        parseCloudOrganizationView({
          isOrganization: true,
          accounts: [{ ...ROW, agent }],
        }).accounts[0]?.agent,
      ).toBe(agent);
    }
  });
});

describe("parseCloudOrganizationKeys", () => {
  const KEY_ROW: Record<string, unknown> = {
    cloudAccountId: "bbbbbbbb-2222-4222-8222-222222222222",
    accountId: "222222222222",
    name: "Payments",
    agentKey: "ouca_x_y",
    worksUntilConnectedBy: "2026-11-07T10:00:00.000Z",
  };
  const SKIPPED_ROW: Record<string, unknown> = {
    cloudAccountId: "cccccccc-3333-4333-8333-333333333333",
    accountId: "333333333333",
    name: "",
    reason: "You may not edit it.",
  };

  test("keys and the accounts left out, with why", () => {
    expect(
      parseCloudOrganizationKeys({
        managementAccountId: "111111111111",
        keys: [KEY_ROW, { ...KEY_ROW, agentKey: "" }],
        skipped: [SKIPPED_ROW, { reason: "no account" }],
      }),
    ).toEqual({
      managementAccountId: "111111111111",
      keys: [KEY_ROW],
      skipped: [{ ...SKIPPED_ROW, name: "333333333333" }],
    });
  });

  test.each([[null], [undefined], [{}], [{ keys: [KEY_ROW] }], ["keys"]])(
    "%j is no answer",
    (value: unknown) => {
      expect(parseCloudOrganizationKeys(value)).toBeNull();
    },
  );

  test("lists that are not lists read as empty", () => {
    expect(
      parseCloudOrganizationKeys({
        managementAccountId: "111111111111",
        keys: "all",
        skipped: { one: SKIPPED_ROW },
      }),
    ).toEqual({ managementAccountId: "111111111111", keys: [], skipped: [] });
  });
});

describe("countConnectedAccounts", () => {
  test("only the agents connected now count", () => {
    expect(
      countConnectedAccounts({
        isOrganization: true,
        managementAccountId: "111111111111",
        accounts: [
          { ...(ROW as never), agent: "connected" },
          { ...(ROW as never), agent: "offline" },
          { ...(ROW as never), agent: "none" },
          { ...(ROW as never), agent: "connected" },
        ],
        isTruncated: false,
      }),
    ).toBe(2);
    expect(countConnectedAccounts(NOT_AN_ORGANIZATION)).toBe(0);
  });
});
