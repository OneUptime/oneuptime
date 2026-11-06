import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import ResourceAiAgentService from "../../../../Server/Services/ResourceAiAgentService";
import CloudOrganizationAgents from "../../../../Server/Utils/CloudConnection/CloudOrganizationAgents";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CLOUD_ORGANIZATION_MAX_ACCOUNTS,
  CloudOrganizationView,
  NOT_AN_ORGANIZATION,
} from "../../../../Types/CloudConnection/CloudOrganizationAgents";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Server/Utils/CloudConnection/CloudOrganizationAgents - which accounts of
 * an AWS Organization a Cloud AI agent covers, for "Let AI fix problems":
 *
 *   - an account is one of an organization's when the connection that
 *     found it reads an AWS Organization with an IAM role; the management
 *     account is that role's account;
 *   - the accounts listed are the ones the person asking may read (their
 *     own props, never root), the management account first;
 *   - each account's agent is read as OneUptime, in the project only:
 *     connected now, connected once and silent since, or none.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLOUD_MANAGEMENT: ObjectID = new ObjectID(
  "aaaaaaaa-1111-4111-8111-111111111111",
);
const CLOUD_A: ObjectID = new ObjectID("bbbbbbbb-2222-4222-8222-222222222222");
const CLOUD_B: ObjectID = new ObjectID("cccccccc-3333-4333-8333-333333333333");
const MANAGEMENT: string = "111111111111";
const NOW: Date = new Date("2026-11-06T12:00:00.000Z");

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("55555555-5555-4555-8555-555555555555"),
} as DatabaseCommonInteractionProps;

const ORGANIZATION_CONFIG: JSONObject = {
  authMethod: CloudConnectionAuthMethod.AwsRole,
  roleArn: `arn:aws:iam::${MANAGEMENT}:role/OneUptimeRead`,
  readScope: "organization",
};

function account(data: {
  id: ObjectID;
  accountId?: string | undefined;
  name?: string | undefined;
  cloudConnectionId?: ObjectID | undefined;
}): CloudAccount {
  const row: CloudAccount = new CloudAccount();
  row.id = data.id;
  row.accountId = data.accountId as string;
  row.name = data.name as string;
  row.cloudConnectionId = data.cloudConnectionId as ObjectID;
  return row;
}

function connection(config: JSONObject | undefined): CloudConnection {
  const row: CloudConnection = new CloudConnection();
  row.id = CONNECTION_ID;
  row.config = config as JSONObject;
  return row;
}

function agent(data: {
  resourceId: ObjectID;
  connectionStatus: string;
  lastAliveAt: Date;
}): ResourceAiAgent {
  const row: ResourceAiAgent = new ResourceAiAgent();
  row.id = ObjectID.generate();
  row.resourceId = data.resourceId;
  row.connectionStatus = data.connectionStatus as never;
  row.lastAliveAt = data.lastAliveAt;
  return row;
}

describe("CloudOrganizationAgents", () => {
  let findAccountSpy: SpyInstance<typeof CloudAccountService.findOneBy>;
  let findAccountsSpy: SpyInstance<typeof CloudAccountService.findBy>;
  let findConnectionSpy: SpyInstance<typeof CloudConnectionService.findOneBy>;
  let findAgentsSpy: SpyInstance<typeof ResourceAiAgentService.findBy>;

  beforeEach(() => {
    findAccountSpy = jest
      .spyOn(CloudAccountService, "findOneBy")
      .mockResolvedValue(
        account({ id: CLOUD_A, cloudConnectionId: CONNECTION_ID }),
      );
    findConnectionSpy = jest
      .spyOn(CloudConnectionService, "findOneBy")
      .mockResolvedValue(connection(ORGANIZATION_CONFIG));
    findAccountsSpy = jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([
        account({ id: CLOUD_A, accountId: "222222222222", name: "Payments" }),
        account({ id: CLOUD_B, accountId: "333333333333", name: "" }),
        account({
          id: CLOUD_MANAGEMENT,
          accountId: MANAGEMENT,
          name: "Management",
        }),
      ]);
    findAgentsSpy = jest
      .spyOn(ResourceAiAgentService, "findBy")
      .mockResolvedValue([
        agent({
          resourceId: CLOUD_MANAGEMENT,
          connectionStatus: "connected",
          lastAliveAt: new Date(NOW.getTime() - 60 * 1000),
        }),
        agent({
          resourceId: CLOUD_A,
          connectionStatus: "connected",
          lastAliveAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
        }),
      ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("readManagementAccountId", () => {
    test("an organization read with a role: the role's account", () => {
      expect(
        CloudOrganizationAgents.readManagementAccountId(ORGANIZATION_CONFIG),
      ).toBe(MANAGEMENT);
    });

    test.each([
      ["one account", { ...ORGANIZATION_CONFIG, readScope: "account" }],
      ["no scope", { ...ORGANIZATION_CONFIG, readScope: undefined }],
      [
        "an access key",
        {
          ...ORGANIZATION_CONFIG,
          authMethod: CloudConnectionAuthMethod.AwsAccessKey,
        },
      ],
      [
        "a role ARN that is not one",
        { ...ORGANIZATION_CONFIG, roleArn: "role" },
      ],
      ["no role ARN", { ...ORGANIZATION_CONFIG, roleArn: undefined }],
    ])("%s: none", (_name: string, config: JSONObject) => {
      expect(
        CloudOrganizationAgents.readManagementAccountId(config),
      ).toBeNull();
    });

    test("no settings at all: none", () => {
      expect(CloudOrganizationAgents.readManagementAccountId(null)).toBeNull();
      expect(
        CloudOrganizationAgents.readManagementAccountId(undefined),
      ).toBeNull();
    });
  });

  describe("findOrganization", () => {
    test("the account's connection reads the organization: its id and management account", async () => {
      await expect(
        CloudOrganizationAgents.findOrganization({
          projectId: PROJECT_ID,
          cloudAccountId: CLOUD_A,
        }),
      ).resolves.toEqual({
        connectionId: CONNECTION_ID,
        managementAccountId: MANAGEMENT,
      });

      // An AWS account of this project, and an AWS connection of it.
      const accountQuery: Record<string, unknown> = (
        findAccountSpy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(accountQuery["projectId"]).toEqual(PROJECT_ID);
      expect(accountQuery["provider"]).toBe(CloudProvider.AWS);
      expect(accountQuery["_id"]).toBe(CLOUD_A.toString());

      const connectionQuery: Record<string, unknown> = (
        findConnectionSpy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query;
      expect(connectionQuery["projectId"]).toEqual(PROJECT_ID);
      expect(connectionQuery["_id"]).toBe(CONNECTION_ID.toString());
      expect(connectionQuery["provider"]).toBe(CloudProvider.AWS);
    });

    test("an account no connection found: none, and no connection read", async () => {
      findAccountSpy.mockResolvedValue(account({ id: CLOUD_A }));

      await expect(
        CloudOrganizationAgents.findOrganization({
          projectId: PROJECT_ID,
          cloudAccountId: CLOUD_A,
        }),
      ).resolves.toBeNull();
      expect(findConnectionSpy).not.toHaveBeenCalled();
    });

    test("no such account (or not AWS, or another project's): none", async () => {
      findAccountSpy.mockResolvedValue(null);

      await expect(
        CloudOrganizationAgents.findOrganization({
          projectId: PROJECT_ID,
          cloudAccountId: CLOUD_A,
        }),
      ).resolves.toBeNull();
    });

    test("a connection that reads one account: none", async () => {
      findConnectionSpy.mockResolvedValue(
        connection({ ...ORGANIZATION_CONFIG, readScope: "account" }),
      );

      await expect(
        CloudOrganizationAgents.findOrganization({
          projectId: PROJECT_ID,
          cloudAccountId: CLOUD_A,
        }),
      ).resolves.toBeNull();
    });

    test("a connection that is gone: none", async () => {
      findConnectionSpy.mockResolvedValue(null);

      await expect(
        CloudOrganizationAgents.findOrganization({
          projectId: PROJECT_ID,
          cloudAccountId: CLOUD_A,
        }),
      ).resolves.toBeNull();
    });
  });

  describe("findAccounts", () => {
    test("the connection's AWS accounts the caller may read, by name, one more than the limit", async () => {
      await CloudOrganizationAgents.findAccounts({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID,
        props: CALLER,
      });

      const call: Record<string, unknown> = findAccountsSpy.mock
        .calls[0]![0] as unknown as Record<string, unknown>;

      // The caller's own props: an account they may not read is never named.
      expect(call["props"]).toBe(CALLER);
      expect(call["limit"]).toBe(CLOUD_ORGANIZATION_MAX_ACCOUNTS + 1);
      expect(
        (call["query"] as Record<string, unknown>)["cloudConnectionId"],
      ).toEqual(CONNECTION_ID);
      expect((call["query"] as Record<string, unknown>)["provider"]).toBe(
        CloudProvider.AWS,
      );
    });
  });

  describe("getView", () => {
    test("the management account first, each account's agent where it is", async () => {
      const view: CloudOrganizationView = await CloudOrganizationAgents.getView(
        {
          projectId: PROJECT_ID,
          cloudAccountId: CLOUD_A,
          props: CALLER,
          now: NOW,
        },
      );

      expect(view).toEqual({
        isOrganization: true,
        managementAccountId: MANAGEMENT,
        accounts: [
          {
            cloudAccountId: CLOUD_MANAGEMENT.toString(),
            accountId: MANAGEMENT,
            name: "Management",
            isManagementAccount: true,
            agent: "connected",
            lastSeenAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
          },
          {
            cloudAccountId: CLOUD_A.toString(),
            accountId: "222222222222",
            name: "Payments",
            isManagementAccount: false,
            agent: "offline",
            lastSeenAt: new Date(
              NOW.getTime() - 24 * 60 * 60 * 1000,
            ).toISOString(),
          },
          {
            cloudAccountId: CLOUD_B.toString(),
            accountId: "333333333333",
            // No name: its account id.
            name: "333333333333",
            isManagementAccount: false,
            agent: "none",
            lastSeenAt: null,
          },
        ],
        isTruncated: false,
      });
    });

    test("the agents are the accounts' own, read in this project only", async () => {
      await CloudOrganizationAgents.getView({
        projectId: PROJECT_ID,
        cloudAccountId: CLOUD_A,
        props: CALLER,
        now: NOW,
      });

      const call: Record<string, unknown> = findAgentsSpy.mock
        .calls[0]![0] as unknown as Record<string, unknown>;
      const query: Record<string, unknown> = call["query"] as Record<
        string,
        unknown
      >;

      expect(query["projectId"]).toEqual(PROJECT_ID);
      expect(query["resourceType"]).toBe(AiResourceType.AwsAccount);
      expect(call["limit"]).toBe(3);
    });

    test("not an organization: nothing listed, nothing read", async () => {
      findConnectionSpy.mockResolvedValue(
        connection({ ...ORGANIZATION_CONFIG, readScope: "account" }),
      );

      await expect(
        CloudOrganizationAgents.getView({
          projectId: PROJECT_ID,
          cloudAccountId: CLOUD_A,
          props: CALLER,
          now: NOW,
        }),
      ).resolves.toEqual(NOT_AN_ORGANIZATION);
      expect(findAccountsSpy).not.toHaveBeenCalled();
      expect(findAgentsSpy).not.toHaveBeenCalled();
    });

    test("rows without an id or account id are left out", async () => {
      findAccountsSpy.mockResolvedValue([
        account({ id: CLOUD_A, accountId: "" }),
        account({ id: CLOUD_B, accountId: "333333333333" }),
      ]);

      const view: CloudOrganizationView = await CloudOrganizationAgents.getView(
        {
          projectId: PROJECT_ID,
          cloudAccountId: CLOUD_A,
          props: CALLER,
          now: NOW,
        },
      );

      expect(
        view.accounts.map((row: { accountId: string }): string => {
          return row.accountId;
        }),
      ).toEqual(["333333333333"]);
    });

    test("more accounts than it lists: it says so", async () => {
      const many: Array<CloudAccount> = [];

      for (
        let index: number = 0;
        index <= CLOUD_ORGANIZATION_MAX_ACCOUNTS;
        index++
      ) {
        many.push(
          account({
            id: ObjectID.generate(),
            accountId: String(100000000000 + index),
          }),
        );
      }

      findAccountsSpy.mockResolvedValue(many);
      findAgentsSpy.mockResolvedValue([]);

      const view: CloudOrganizationView = await CloudOrganizationAgents.getView(
        {
          projectId: PROJECT_ID,
          cloudAccountId: CLOUD_A,
          props: CALLER,
          now: NOW,
        },
      );

      expect(view.accounts).toHaveLength(CLOUD_ORGANIZATION_MAX_ACCOUNTS);
      expect(view.isTruncated).toBe(true);
    });
  });

  describe("findAgents", () => {
    test("no accounts: nothing read", async () => {
      await expect(
        CloudOrganizationAgents.findAgents({
          projectId: PROJECT_ID,
          cloudAccountIds: [],
        }),
      ).resolves.toEqual(new Map());
      expect(findAgentsSpy).not.toHaveBeenCalled();
    });
  });
});
