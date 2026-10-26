import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudAccountService from "../../../Server/Services/CloudAccountService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import logger from "../../../Server/Utils/Logger";
import { CloudAccountResourceSummary } from "../../../Types/Cloud/CloudAccountSummary";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * A connection's cloud accounts, kept by its reads: each found or created
 * (named after its cloud's own name, or its id), linked to the connection
 * when no other connection reads it, marked seen - and listed in full only
 * when the inventory listed it to its last page - with a name a person
 * gave it never touched again. Its resources are counted by the database,
 * by type and Region, pinned to the account's project: an account of any
 * size is one small read.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_CONNECTION: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ACCOUNT_ROW: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const LISTED_AT: Date = new Date("2026-10-26T10:00:00.000Z");

let existing: Map<string, CloudAccount>;
let created: Array<CloudAccount>;
let updates: Array<{ id: ObjectID; data: JSONObject }>;
let createSpy: SpyInstance<typeof CloudAccountService.create>;
let query: Mock<(sql: string, parameters: Array<unknown>) => Promise<unknown>>;

function accountRow(data: {
  accountId: string;
  name: string;
  providerAccountName?: string;
  cloudConnectionId?: ObjectID;
}): CloudAccount {
  const row: CloudAccount = new CloudAccount();
  row.id = ACCOUNT_ROW;
  row.projectId = PROJECT;
  row.provider = CloudProvider.AWS;
  row.accountId = data.accountId;
  row.name = data.name;

  if (data.providerAccountName) {
    row.providerAccountName = data.providerAccountName;
  }

  if (data.cloudConnectionId) {
    row.cloudConnectionId = data.cloudConnectionId;
  }

  return row;
}

beforeEach(() => {
  existing = new Map();
  created = [];
  updates = [];

  jest
    .spyOn(CloudAccountService, "findAccount")
    .mockImplementation((async (data: {
      projectId: ObjectID;
      provider: CloudProvider;
      accountId: string;
    }) => {
      expect(data.projectId).toEqual(PROJECT);

      for (const [key, row] of existing) {
        if (key.toLowerCase() === data.accountId.toLowerCase()) {
          return row;
        }
      }

      return null;
    }) as never);
  createSpy = jest
    .spyOn(CloudAccountService, "create")
    .mockImplementation((async (data: { data: CloudAccount }) => {
      const row: CloudAccount = data.data;
      row.id = new ObjectID(
        `66666666-6666-4666-8666-${String(created.length).padStart(12, "0")}`,
      );
      created.push(row);
      return row;
    }) as never);
  jest
    .spyOn(CloudAccountService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      updates.push({ id: data.id, data: data.data });
    }) as never);
  query = jest.fn(
    async (_sql: string, _parameters: Array<unknown>): Promise<unknown> => {
      return [];
    },
  );
  jest
    .spyOn(CloudResourceService, "getRepository")
    .mockReturnValue({ manager: { query } } as never);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an account a read reaches for the first time", () => {
  test("is created under its cloud's name, linked to the connection and marked seen", async () => {
    const rows: Array<CloudAccount> =
      await CloudAccountService.recordAccountsSeen({
        projectId: PROJECT,
        connectionId: CONNECTION,
        provider: CloudProvider.AWS,
        accounts: [{ accountId: " 123456789012 ", name: "acme-production" }],
      });

    expect(rows).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(created[0]!.projectId).toEqual(PROJECT);
    expect(created[0]!.provider).toBe(CloudProvider.AWS);
    expect(created[0]!.accountId).toBe("123456789012");
    expect(created[0]!.name).toBe("acme-production");
    expect(created[0]!.providerAccountName).toBe("acme-production");
    expect(created[0]!.cloudConnectionId).toEqual(CONNECTION);
    expect(created[0]!.lastSeenAt).toBeInstanceOf(Date);
    expect(created[0]!.inventoryListedAt).toBeUndefined();
    // As the system: no person creates these.
    expect(
      (createSpy.mock.calls[0]![0] as unknown as JSONObject)["props"],
    ).toEqual({ isRoot: true });
  });

  test("with no name of its cloud's, is named after its id", async () => {
    await CloudAccountService.recordAccountsSeen({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.GCP,
      accounts: [{ accountId: "acme-prod" }],
    });

    expect(created[0]!.name).toBe("acme-prod");
    expect(created[0]!.providerAccountName).toBeUndefined();
  });

  test("listed in full by this read, says so", async () => {
    await CloudAccountService.recordAccountsSeen({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accounts: [{ accountId: "123456789012", listedInFullAt: LISTED_AT }],
    });

    expect(created[0]!.inventoryListedAt).toEqual(LISTED_AT);
  });

  test("a name longer than a name may be is cut to fit", async () => {
    await CloudAccountService.recordAccountsSeen({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.Azure,
      accounts: [
        {
          accountId: "00000000-0000-4000-8000-000000000001",
          name: "x".repeat(300),
        },
      ],
    });

    // Both are short texts of 100: an Azure subscription's 64 characters fit whole.
    expect(created[0]!.name).toBe("x".repeat(100));
    expect(created[0]!.providerAccountName).toBe("x".repeat(100));
  });

  test("an Azure subscription's name of 64 characters is kept whole", async () => {
    const name: string = "Contoso Production Workloads - Europe West - Payments Platform 01".slice(0, 64);

    await CloudAccountService.recordAccountsSeen({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.Azure,
      accounts: [
        {
          accountId: "00000000-0000-4000-8000-000000000002",
          name: name,
        },
      ],
    });

    expect(name).toHaveLength(64);
    expect(created[0]!.name).toBe(name);
    expect(created[0]!.providerAccountName).toBe(name);
  });

  test("an account with no id is no account", async () => {
    const rows: Array<CloudAccount> =
      await CloudAccountService.recordAccountsSeen({
        projectId: PROJECT,
        connectionId: CONNECTION,
        provider: CloudProvider.AWS,
        accounts: [{ accountId: "  " }],
      });

    expect(rows).toEqual([]);
    expect(created).toEqual([]);
  });
});

describe("an account the project holds already", () => {
  test("keeps the name a person gave it; its cloud's own name moves on", async () => {
    existing.set(
      "123456789012",
      accountRow({
        accountId: "123456789012",
        name: "Payments production",
        providerAccountName: "old-alias",
        cloudConnectionId: CONNECTION,
      }),
    );

    await CloudAccountService.recordAccountsSeen({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accounts: [{ accountId: "123456789012", name: "new-alias" }],
    });

    expect(created).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.data["name"]).toBeUndefined();
    expect(updates[0]!.data["providerAccountName"]).toBe("new-alias");
    expect(updates[0]!.data["lastSeenAt"]).toBeInstanceOf(Date);
    // Not listed in full this time: when it last was stays.
    expect(updates[0]!.data["inventoryListedAt"]).toBeUndefined();
  });

  test("read by another connection, stays that connection's", async () => {
    existing.set(
      "123456789012",
      accountRow({
        accountId: "123456789012",
        name: "Production",
        cloudConnectionId: OTHER_CONNECTION,
      }),
    );

    await CloudAccountService.recordAccountsSeen({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accounts: [{ accountId: "123456789012" }],
    });

    expect(updates[0]!.data["cloudConnectionId"]).toBeUndefined();
  });

  test("read by no connection (its connection was removed), is taken by this one", async () => {
    existing.set(
      "123456789012",
      accountRow({ accountId: "123456789012", name: "Production" }),
    );

    await CloudAccountService.recordAccountsSeen({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accounts: [{ accountId: "123456789012" }],
    });

    expect(updates[0]!.data["cloudConnectionId"]).toBe(CONNECTION.toString());
  });

  test("listed in full now, moves its Last Listed At on", async () => {
    existing.set(
      "123456789012",
      accountRow({ accountId: "123456789012", name: "Production" }),
    );

    await CloudAccountService.recordAccountsSeen({
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: CloudProvider.AWS,
      accounts: [{ accountId: "123456789012", listedInFullAt: LISTED_AT }],
    });

    expect(updates[0]!.data["inventoryListedAt"]).toEqual(LISTED_AT);
  });
});

describe("two reads at once", () => {
  test("the one that loses the insert reads the winner's row", async () => {
    const winner: CloudAccount = accountRow({
      accountId: "123456789012",
      name: "Production",
      cloudConnectionId: CONNECTION,
    });

    createSpy.mockImplementation((async () => {
      existing.set("123456789012", winner);
      throw new Error("duplicate key value violates unique constraint");
    }) as never);

    const rows: Array<CloudAccount> =
      await CloudAccountService.recordAccountsSeen({
        projectId: PROJECT,
        connectionId: CONNECTION,
        provider: CloudProvider.AWS,
        accounts: [{ accountId: "123456789012" }],
      });

    expect(rows).toEqual([winner]);
  });

  test("one account that cannot be kept never stops the others", async () => {
    createSpy.mockImplementationOnce((async () => {
      throw new Error("database is down");
    }) as never);

    const rows: Array<CloudAccount> =
      await CloudAccountService.recordAccountsSeen({
        projectId: PROJECT,
        connectionId: CONNECTION,
        provider: CloudProvider.AWS,
        accounts: [
          { accountId: "111111111111" },
          { accountId: "222222222222" },
        ],
      });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.accountId).toBe("222222222222");
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("an account's resources, counted", () => {
  test("by the database, by type and Region, pinned to the project, the cloud and the account in any case", async () => {
    query.mockResolvedValue([
      { type: "AWS::EC2::Instance", region: "eu-west-1", count: 1200 },
      { type: "AWS::EC2::Instance", region: "us-east-1", count: 300 },
      { type: "AWS::SQS::Queue", region: "eu-west-1", count: 40 },
      { type: "", region: "", count: 2 },
    ]);

    const summary: CloudAccountResourceSummary =
      await CloudAccountService.refreshSummary({
        id: ACCOUNT_ROW,
        projectId: PROJECT,
        provider: CloudProvider.AWS,
        accountId: "123456789012",
      });

    const [sql, parameters] = query.mock.calls[0]! as [string, Array<unknown>];
    expect(sql).toContain(`"projectId" = $1`);
    expect(sql).toContain(`"cloudProvider" = $2`);
    expect(sql).toContain(`LOWER("cloudAccountId") = LOWER($3)`);
    expect(sql).toContain(`"isArchived" = false`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
    expect(sql).toContain("GROUP BY");
    expect(parameters).toEqual([
      PROJECT.toString(),
      CloudProvider.AWS,
      "123456789012",
    ]);

    // More than a read of rows would have taken: every resource is counted.
    expect(summary).toEqual({
      resourceCount: 1542,
      types: [
        { type: "AWS::EC2::Instance", count: 1500 },
        { type: "AWS::SQS::Queue", count: 40 },
      ],
      regions: [
        { region: "eu-west-1", count: 1240 },
        { region: "us-east-1", count: 300 },
      ],
    });
    expect(updates).toEqual([
      {
        id: ACCOUNT_ROW,
        data: {
          resourceCount: 1542,
          regionCount: 2,
          resourceSummary: summary,
        },
      },
    ]);
  });

  test("an account with no resources is counted as none", async () => {
    const summary: CloudAccountResourceSummary =
      await CloudAccountService.refreshSummary({
        id: ACCOUNT_ROW,
        projectId: PROJECT,
        provider: CloudProvider.GCP,
        accountId: "acme-prod",
      });

    expect(summary).toEqual({ resourceCount: 0, types: [], regions: [] });
    expect(updates[0]!.data["resourceCount"]).toBe(0);
  });
});
