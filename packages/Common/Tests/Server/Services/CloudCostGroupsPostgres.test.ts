import Entities from "../../../Models/DatabaseModels/Index";
import CloudCostGroup from "../../../Models/DatabaseModels/CloudCostGroup";
import CloudCostLineItem from "../../../Models/DatabaseModels/CloudCostLineItem";
import CloudCostView from "../../../Models/DatabaseModels/CloudCostView";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import CloudCostGroupService, {
  CLOUD_COST_GROUP_AUTOMATIC_RULES_ERROR,
  CLOUD_COST_GROUP_PERCENTAGES_VIEW_ERROR,
  CLOUD_COST_GROUP_SPLIT_ERROR,
} from "../../../Server/Services/CloudCostGroupService";
import CloudCostLineItemService, {
  CLOUD_COST_LINE_ITEM_AMOUNT_ERROR,
  CLOUD_COST_LINE_ITEM_CURRENCY_ERROR,
  CLOUD_COST_LINE_ITEM_TARGET_ERROR,
} from "../../../Server/Services/CloudCostLineItemService";
import CloudCostService from "../../../Server/Services/CloudCostService";
import CloudCostViewService, {
  CLOUD_COST_VIEW_TAG_KEY_ERROR,
} from "../../../Server/Services/CloudCostViewService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CloudCostAllocation from "../../../Server/Utils/CloudCost/CloudCostAllocation";
import CloudCostAllocationFacts from "../../../Server/Utils/CloudCost/CloudCostAllocationFacts";
import CloudCostViewSync from "../../../Server/Utils/CloudCost/CloudCostViewSync";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { getCloudCostResourceKey } from "../../../Types/Cloud/CloudCost";
import {
  CloudCostLineItemKind,
  CloudCostLineItemRecurrence,
  CloudCostSharedSplit,
  CloudCostViewGrouping,
} from "../../../Types/Cloud/CloudCostAllocation";
import {
  CloudCostRule,
  CloudCostRuleField,
  CloudCostRuleOperator,
} from "../../../Types/Cloud/CloudCostRules";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { DataSource } from "typeorm";

/*
 * COST GROUPS (#11006) EXECUTED ON POSTGRES. The ClickHouse suites read a
 * year of costs with Postgres' reads stood in for; only a real database
 * shows what the services and the raw SQL do to real rows:
 *
 *   - a view is unique by name in its project, and one per tag value needs
 *     its tag;
 *   - groups take their place at the end of their view, a name is unique
 *     within it, their rules keep their shape and name only the project's
 *     records, and a shared group's fixed percentages name the view's
 *     other groups and add up to 100;
 *   - a custom line item goes on one of the project's accounts or groups,
 *     never both, for a positive amount in a three-letter currency;
 *   - the facts a read sends ClickHouse - each resource's owner teams, the
 *     labels a rule names on resources and accounts - come from the owner
 *     and label rows by the key costs are billed under, leaving deleted
 *     rows and other projects out;
 *   - a view by owner team gets one group per owning team, once, and a
 *     group OneUptime made keeps its rules while a person renames it;
 *   - who may read and write groups, and a group's own read: a member who
 *     may read the cloud's spend reads one group alone; one who may not is
 *     refused before anything is read.
 *
 * Opt in with RUN_POSTGRES_CLOUD_COST_GROUP_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The STRUCTURE of every table the
 * services and the facts read is cloned into a unique schema (search_path
 * holds only that schema), dropped afterwards. ClickHouse is not reached:
 * the read of a group answers from a stand-in for CloudCost's query, which
 * the ClickHouse suites run for real. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from CLOUD_COST_GROUP_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from CLOUD_COST_GROUP_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_CLOUD_COST_GROUP_TESTS"] === "true"
    ? describe
    : describe.skip;

// The tables the services write, cloned whole.
const SERVICE_TABLES: Array<string> = [
  "CloudCostView",
  "CloudCostGroup",
  "CloudCostLineItem",
];

/*
 * The tables they read, filled here by hand: every NOT NULL but the keys
 * is relaxed, so a fixture row names only what the test is about.
 */
const FIXTURE_TABLES: Array<string> = [
  "Team",
  "Label",
  "CloudAccount",
  "CloudAccountLabel",
  "CloudResource",
  "CloudResourceLabel",
  "CloudResourceOwnerTeam",
  "KubernetesCluster",
  "CloudApp",
];

const KEPT_NOT_NULL: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "cloudResourceId",
  "cloudAccountId",
  "labelId",
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const MEMBER_ID: ObjectID = ObjectID.generate();

const PAYMENTS_TEAM: string = ObjectID.generate().toString();
const SEARCH_TEAM: string = ObjectID.generate().toString();
const OTHER_PROJECT_TEAM: string = ObjectID.generate().toString();
const PROD_LABEL: string = ObjectID.generate().toString();
const UNNAMED_LABEL: string = ObjectID.generate().toString();
const ACCOUNT: string = ObjectID.generate().toString();
const OTHER_PROJECT_ACCOUNT: string = ObjectID.generate().toString();

const CHECKOUT_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:service/shop/checkout";
const SEARCH_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:service/shop/search";
const GONE_ARN: string = "arn:aws:ecs:us-east-1:123456789012:service/shop/gone";
const AZURE_ID: string =
  "/subscriptions/0000/resourceGroups/Shop/providers/Microsoft.Web/sites/Ledger";

function memberProps(
  permissions: Array<Permission>,
  projectId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    tenantId: projectId,
    userId: MEMBER_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

const ADMIN: DatabaseCommonInteractionProps = memberProps([
  Permission.ProjectAdmin,
]);
const OTHER_ADMIN: DatabaseCommonInteractionProps = memberProps(
  [Permission.ProjectAdmin],
  OTHER_PROJECT_ID,
);
// May read the cloud's spend, and nothing more.
const CLOUD_READER: DatabaseCommonInteractionProps = memberProps([
  Permission.ReadCloudResource,
]);
// A member of the project who may not read the cloud at all.
const DASHBOARD_READER: DatabaseCommonInteractionProps = memberProps([
  Permission.ReadDashboard,
]);

function rule(
  field: CloudCostRuleField,
  values: Array<string>,
  key?: string,
): CloudCostRule {
  return {
    conditions: [
      {
        field,
        operator: CloudCostRuleOperator.Is,
        values,
        ...(key ? { key } : {}),
      },
    ],
  };
}

describePostgres("Cost groups against Postgres", () => {
  const schema: string = `cloud_cost_groups_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  async function insert(
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        return row[column];
      }),
    );
  }

  async function createView(data: {
    name: string;
    grouping?: CloudCostViewGrouping;
    tagKey?: string;
    props?: DatabaseCommonInteractionProps;
    projectId?: ObjectID;
  }): Promise<CloudCostView> {
    const view: CloudCostView = new CloudCostView();
    view.projectId = data.projectId || PROJECT_ID;
    view.name = data.name;
    view.grouping = data.grouping || CloudCostViewGrouping.Rules;

    if (data.tagKey) {
      view.tagKey = data.tagKey;
    }

    return CloudCostViewService.create({
      data: view,
      props: data.props || ADMIN,
    });
  }

  async function createGroup(data: {
    view: CloudCostView;
    name: string;
    rules?: Array<CloudCostRule>;
    isShared?: boolean;
    sharedSplit?: CloudCostSharedSplit;
    sharedPercentages?: Record<string, number>;
    props?: DatabaseCommonInteractionProps;
  }): Promise<CloudCostGroup> {
    const group: CloudCostGroup = new CloudCostGroup();
    group.projectId = data.view.projectId!;
    group.cloudCostViewId = data.view.id!;
    group.name = data.name;
    group.rules = data.rules || [];
    group.isShared = Boolean(data.isShared);

    if (data.sharedSplit) {
      group.sharedSplit = data.sharedSplit;
    }

    if (data.sharedPercentages) {
      group.sharedPercentages = data.sharedPercentages;
    }

    return CloudCostGroupService.create({
      data: group,
      props: data.props || ADMIN,
    });
  }

  async function createLineItem(data: {
    name: string;
    amount: number;
    currency?: string;
    cloudAccountId?: string;
    cloudCostGroupId?: ObjectID;
    props?: DatabaseCommonInteractionProps;
  }): Promise<CloudCostLineItem> {
    const item: CloudCostLineItem = new CloudCostLineItem();
    item.projectId = PROJECT_ID;
    item.name = data.name;
    item.kind = CloudCostLineItemKind.Charge;
    item.amount = data.amount;
    item.currency = data.currency || "USD";
    item.recurrence = CloudCostLineItemRecurrence.Monthly;
    item.startDate = new Date("2026-10-01T00:00:00.000Z");

    if (data.cloudAccountId) {
      item.cloudAccountId = new ObjectID(data.cloudAccountId);
    }

    if (data.cloudCostGroupId) {
      item.cloudCostGroupId = data.cloudCostGroupId;
    }

    return CloudCostLineItemService.create({
      data: item,
      props: data.props || ADMIN,
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["CLOUD_COST_GROUP_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["CLOUD_COST_GROUP_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["CLOUD_COST_GROUP_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of [...SERVICE_TABLES, ...FIXTURE_TABLES]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const table of FIXTURE_TABLES) {
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'`,
        [schema, table],
      );

      for (const column of columns) {
        if (!KEPT_NOT_NULL.includes(column.column_name)) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const service of [
      CloudCostViewService,
      CloudCostGroupService,
      CloudCostLineItemService,
    ] as Array<DatabaseService<any>>) {
      jest.spyOn(service, "onTriggerRealtime").mockResolvedValue();
      jest.spyOn(service, "onTriggerWorkflow").mockResolvedValue();
    }

    /*
     * A saved view's groups are made right after the save without waiting
     * for it; each test makes them itself, so none is made twice at once.
     */
    jest
      .spyOn(
        CloudCostViewService as unknown as { makeGroupsSoon: () => void },
        "makeGroupsSoon",
      )
      .mockImplementation(() => {});

    // Two teams of the project, and one of another.
    await insert("Team", {
      _id: PAYMENTS_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Payments",
    });
    await insert("Team", {
      _id: SEARCH_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Search",
    });
    await insert("Team", {
      _id: OTHER_PROJECT_TEAM,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Elsewhere",
    });
    await insert("Label", {
      _id: PROD_LABEL,
      projectId: PROJECT_ID.toString(),
      name: "prod",
    });
    await insert("Label", {
      _id: UNNAMED_LABEL,
      projectId: PROJECT_ID.toString(),
      name: "staging",
    });
    await insert("CloudAccount", {
      _id: ACCOUNT,
      projectId: PROJECT_ID.toString(),
      name: "Production AWS",
    });
    await insert("CloudAccount", {
      _id: OTHER_PROJECT_ACCOUNT,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Elsewhere AWS",
    });
    await insert("CloudAccountLabel", {
      cloudAccountId: ACCOUNT,
      labelId: PROD_LABEL,
    });

    /*
     * Checkout is owned by both teams and labelled prod; Search by Search,
     * once through an owner row since removed; a removed resource's owner
     * is left out, and so is another project's resource owned by its team.
     */
    const checkout: string = ObjectID.generate().toString();
    const search: string = ObjectID.generate().toString();
    const gone: string = ObjectID.generate().toString();
    const ledger: string = ObjectID.generate().toString();
    const elsewhere: string = ObjectID.generate().toString();

    for (const resource of [
      { id: checkout, provider: "aws", key: CHECKOUT_ARN },
      { id: search, provider: "aws", key: SEARCH_ARN },
      { id: ledger, provider: "azure", key: AZURE_ID },
    ]) {
      await insert("CloudResource", {
        _id: resource.id,
        projectId: PROJECT_ID.toString(),
        cloudProvider: resource.provider,
        providerResourceId: resource.key,
        cloudAccountId: ACCOUNT,
      });
    }

    await insert("CloudResource", {
      _id: gone,
      projectId: PROJECT_ID.toString(),
      cloudProvider: "aws",
      providerResourceId: GONE_ARN,
      deletedAt: new Date(),
    });
    await insert("CloudResource", {
      _id: elsewhere,
      projectId: OTHER_PROJECT_ID.toString(),
      cloudProvider: "aws",
      providerResourceId: CHECKOUT_ARN,
    });

    for (const owner of [
      { resource: checkout, team: PAYMENTS_TEAM, deleted: false },
      { resource: checkout, team: SEARCH_TEAM, deleted: false },
      { resource: search, team: SEARCH_TEAM, deleted: false },
      { resource: search, team: PAYMENTS_TEAM, deleted: true },
      { resource: ledger, team: PAYMENTS_TEAM, deleted: false },
      { resource: gone, team: PAYMENTS_TEAM, deleted: false },
    ]) {
      await insert("CloudResourceOwnerTeam", {
        _id: ObjectID.generate().toString(),
        projectId: PROJECT_ID.toString(),
        cloudResourceId: owner.resource,
        teamId: owner.team,
        deletedAt: owner.deleted ? new Date() : null,
      });
    }

    await insert("CloudResourceOwnerTeam", {
      _id: ObjectID.generate().toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      cloudResourceId: elsewhere,
      teamId: OTHER_PROJECT_TEAM,
    });

    await insert("CloudResourceLabel", {
      cloudResourceId: checkout,
      labelId: PROD_LABEL,
    });
    await insert("CloudResourceLabel", {
      cloudResourceId: search,
      labelId: UNNAMED_LABEL,
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  describe("cost views", () => {
    test("a view is unique by name in its project; another project may use the name", async () => {
      await createView({ name: "By product" });

      await expect(createView({ name: "By product" })).rejects.toThrow();

      const elsewhere: CloudCostView = await createView({
        name: "By product",
        projectId: OTHER_PROJECT_ID,
        props: OTHER_ADMIN,
      });

      expect(elsewhere.id).toBeTruthy();
    });

    test("a view with a group per tag value needs its tag's key", async () => {
      await expect(
        createView({
          name: "By cost center",
          grouping: CloudCostViewGrouping.TagValue,
        }),
      ).rejects.toThrow(CLOUD_COST_VIEW_TAG_KEY_ERROR);

      const view: CloudCostView = await createView({
        name: "By cost center",
        grouping: CloudCostViewGrouping.TagValue,
        tagKey: " cost-center ",
      });
      const stored: CloudCostView | null =
        await CloudCostViewService.findOneById({
          id: view.id!,
          select: { tagKey: true, grouping: true },
          props: { isRoot: true },
        });

      expect(stored?.grouping).toBe(CloudCostViewGrouping.TagValue);
      expect(stored?.tagKey).toBe("cost-center");
    });
  });

  describe("cost groups", () => {
    test("each group takes its place at the end of its view; a name is unique within the view alone", async () => {
      const view: CloudCostView = await createView({ name: "Ordered" });
      const first: CloudCostGroup = await createGroup({ view, name: "First" });
      const second: CloudCostGroup = await createGroup({
        view,
        name: "Second",
      });
      const third: CloudCostGroup = await createGroup({ view, name: "Third" });
      const stored: Array<CloudCostGroup> = await CloudCostGroupService.findBy({
        query: { cloudCostViewId: view.id! },
        select: { _id: true, order: true },
        props: { isRoot: true },
        skip: 0,
        limit: 10,
      });
      const orderOf: (group: CloudCostGroup) => number | undefined = (
        group: CloudCostGroup,
      ): number | undefined => {
        return stored.find((row: CloudCostGroup): boolean => {
          return row.id!.toString() === group.id!.toString();
        })?.order;
      };

      expect([orderOf(first), orderOf(second), orderOf(third)]).toEqual([
        1, 2, 3,
      ]);

      await expect(createGroup({ view, name: "Second" })).rejects.toThrow();

      const otherView: CloudCostView = await createView({ name: "Ordered 2" });

      expect(
        (await createGroup({ view: otherView, name: "Second" })).id,
      ).toBeTruthy();
    });

    test("rules keep their shape, and name only the project's records", async () => {
      const view: CloudCostView = await createView({ name: "References" });

      // An operator no rule has.
      await expect(
        createGroup({
          view,
          name: "Broken",
          rules: [
            {
              conditions: [
                {
                  field: CloudCostRuleField.Service,
                  operator: "sounds like" as CloudCostRuleOperator,
                  values: ["EC2"],
                },
              ],
            },
          ],
        }),
      ).rejects.toThrow();

      // Another project's team is never named: the same answer as none.
      await expect(
        createGroup({
          view,
          name: "Elsewhere",
          rules: [rule(CloudCostRuleField.OwnerTeam, [OTHER_PROJECT_TEAM])],
        }),
      ).rejects.toThrow(OTHER_PROJECT_TEAM);
      await expect(
        createGroup({
          view,
          name: "Elsewhere account",
          rules: [rule(CloudCostRuleField.Account, [OTHER_PROJECT_ACCOUNT])],
        }),
      ).rejects.toThrow(OTHER_PROJECT_ACCOUNT);

      // A team since removed may stay named: the page says it is gone.
      const removed: string = ObjectID.generate().toString();
      const kept: CloudCostGroup = await createGroup({
        view,
        name: "Payments",
        rules: [
          rule(CloudCostRuleField.OwnerTeam, [PAYMENTS_TEAM, removed]),
          rule(CloudCostRuleField.Account, [ACCOUNT]),
          rule(CloudCostRuleField.Tag, ["payments"], "team"),
        ],
      });
      const stored: CloudCostGroup | null =
        await CloudCostGroupService.findOneById({
          id: kept.id!,
          select: { rules: true },
          props: { isRoot: true },
        });

      expect(stored?.rules).toEqual([
        rule(CloudCostRuleField.OwnerTeam, [PAYMENTS_TEAM, removed]),
        rule(CloudCostRuleField.Account, [ACCOUNT]),
        rule(CloudCostRuleField.Tag, ["payments"], "team"),
      ]);
    });

    test("a group goes only in a view of its own project", async () => {
      const elsewhere: CloudCostView = await createView({
        name: "Their view",
        projectId: OTHER_PROJECT_ID,
        props: OTHER_ADMIN,
      });
      const group: CloudCostGroup = new CloudCostGroup();
      group.projectId = PROJECT_ID;
      group.cloudCostViewId = elsewhere.id!;
      group.name = "Sneaky";
      group.rules = [];

      await expect(
        CloudCostGroupService.create({ data: group, props: ADMIN }),
      ).rejects.toThrow();
    });

    test("a shared group splits by a way it knows, with fixed percentages naming the view's other groups and adding up to 100", async () => {
      const view: CloudCostView = await createView({ name: "Shared" });
      const payments: CloudCostGroup = await createGroup({
        view,
        name: "Payments",
      });
      const search: CloudCostGroup = await createGroup({
        view,
        name: "Search",
      });
      const otherView: CloudCostView = await createView({ name: "Shared 2" });
      const foreign: CloudCostGroup = await createGroup({
        view: otherView,
        name: "Foreign",
      });

      await expect(
        createGroup({
          view,
          name: "Support",
          isShared: true,
          sharedSplit: "Randomly" as CloudCostSharedSplit,
        }),
      ).rejects.toThrow(CLOUD_COST_GROUP_SPLIT_ERROR);
      await expect(
        createGroup({
          view,
          name: "Support",
          isShared: true,
          sharedSplit: CloudCostSharedSplit.Fixed,
          sharedPercentages: {
            [payments.id!.toString()]: 60,
            [search.id!.toString()]: 30,
          },
        }),
      ).rejects.toThrow();
      await expect(
        createGroup({
          view,
          name: "Support",
          isShared: true,
          sharedSplit: CloudCostSharedSplit.Fixed,
          sharedPercentages: {
            [payments.id!.toString()]: 60,
            [foreign.id!.toString()]: 40,
          },
        }),
      ).rejects.toThrow(CLOUD_COST_GROUP_PERCENTAGES_VIEW_ERROR);

      const support: CloudCostGroup = await createGroup({
        view,
        name: "Support",
        isShared: true,
        sharedSplit: CloudCostSharedSplit.Fixed,
        sharedPercentages: {
          [payments.id!.toString()]: 60,
          [search.id!.toString()]: 40,
        },
      });
      const stored: CloudCostGroup | null =
        await CloudCostGroupService.findOneById({
          id: support.id!,
          select: {
            isShared: true,
            sharedSplit: true,
            sharedPercentages: true,
          },
          props: { isRoot: true },
        });

      expect(stored?.isShared).toBe(true);
      expect(stored?.sharedSplit).toBe(CloudCostSharedSplit.Fixed);
      expect(stored?.sharedPercentages).toEqual({
        [payments.id!.toString().toLowerCase()]: 60,
        [search.id!.toString().toLowerCase()]: 40,
      });

      // A group never names itself among its shares.
      await expect(
        CloudCostGroupService.updateOneById({
          id: support.id!,
          data: {
            sharedPercentages: {
              [support.id!.toString()]: 50,
              [payments.id!.toString()]: 50,
            },
          },
          props: ADMIN,
        }),
      ).rejects.toThrow(CLOUD_COST_GROUP_PERCENTAGES_VIEW_ERROR);
    });
  });

  describe("custom line items", () => {
    test("go on one of the project's accounts or groups, never both and never none", async () => {
      const view: CloudCostView = await createView({ name: "Line items" });
      const group: CloudCostGroup = await createGroup({
        view,
        name: "Platform",
      });

      await expect(
        createLineItem({
          name: "Both",
          amount: 10,
          cloudAccountId: ACCOUNT,
          cloudCostGroupId: group.id!,
        }),
      ).rejects.toThrow(CLOUD_COST_LINE_ITEM_TARGET_ERROR);
      await expect(
        createLineItem({ name: "Neither", amount: 10 }),
      ).rejects.toThrow(CLOUD_COST_LINE_ITEM_TARGET_ERROR);
      await expect(
        createLineItem({
          name: "Elsewhere",
          amount: 10,
          cloudAccountId: OTHER_PROJECT_ACCOUNT,
        }),
      ).rejects.toThrow();

      const onAccount: CloudCostLineItem = await createLineItem({
        name: "Support contract share",
        amount: 1200.5,
        cloudAccountId: ACCOUNT,
      });
      const onGroup: CloudCostLineItem = await createLineItem({
        name: "Platform fee",
        amount: 300,
        cloudCostGroupId: group.id!,
      });
      const stored: Array<CloudCostLineItem> =
        await CloudCostLineItemService.findBy({
          query: { projectId: PROJECT_ID },
          select: {
            _id: true,
            amount: true,
            cloudAccountId: true,
            cloudCostGroupId: true,
          },
          props: { isRoot: true },
          skip: 0,
          limit: 10,
        });
      const byId: (item: CloudCostLineItem) => CloudCostLineItem | undefined = (
        item: CloudCostLineItem,
      ): CloudCostLineItem | undefined => {
        return stored.find((row: CloudCostLineItem): boolean => {
          return row.id!.toString() === item.id!.toString();
        });
      };

      expect(Number(byId(onAccount)?.amount)).toBe(1200.5);
      expect(byId(onAccount)?.cloudAccountId?.toString()).toBe(ACCOUNT);
      expect(byId(onGroup)?.cloudCostGroupId?.toString()).toBe(
        group.id!.toString(),
      );
    });

    test("are a positive amount in a three-letter currency", async () => {
      await expect(
        createLineItem({
          name: "Negative",
          amount: -5,
          cloudAccountId: ACCOUNT,
        }),
      ).rejects.toThrow(CLOUD_COST_LINE_ITEM_AMOUNT_ERROR);
      await expect(
        createLineItem({
          name: "Odd currency",
          amount: 5,
          currency: "DOLLARS",
          cloudAccountId: ACCOUNT,
        }),
      ).rejects.toThrow(CLOUD_COST_LINE_ITEM_CURRENCY_ERROR);

      const item: CloudCostLineItem = await createLineItem({
        name: "Lower case",
        amount: 5,
        currency: "eur",
        cloudAccountId: ACCOUNT,
      });
      const stored: CloudCostLineItem | null =
        await CloudCostLineItemService.findOneById({
          id: item.id!,
          select: { currency: true },
          props: { isRoot: true },
        });

      expect(stored?.currency).toBe("EUR");
    });
  });

  describe("the facts a read sends ClickHouse", () => {
    test("each resource's owner teams, by the key its costs are billed under, without removed rows or other projects", async () => {
      const owners: Map<
        string,
        Set<string>
      > = await CloudCostAllocationFacts.readOwnerTeams(PROJECT_ID);
      const asLists: Record<string, Array<string>> = {};

      for (const [key, teams] of owners) {
        asLists[key] = Array.from(teams).sort();
      }

      expect(asLists).toEqual({
        // A resource owned by two teams is split between them.
        [CHECKOUT_ARN]: [PAYMENTS_TEAM, SEARCH_TEAM].sort(),
        // The owner row since removed is not read.
        [SEARCH_ARN]: [SEARCH_TEAM],
        // An Azure id is keyed in lower case, as Cost Management writes it.
        [getCloudCostResourceKey("azure", AZURE_ID)]: [PAYMENTS_TEAM],
      });
      expect(getCloudCostResourceKey("azure", AZURE_ID)).toBe(
        AZURE_ID.toLowerCase(),
      );
    });

    test("the labels a rule names, on resources and on accounts", async () => {
      const resources: Map<
        string,
        Set<string>
      > = await CloudCostAllocationFacts.readResourceLabels({
        projectId: PROJECT_ID,
        labelIds: [PROD_LABEL],
      });
      const accounts: Map<
        string,
        Array<string>
      > = await CloudCostAllocationFacts.readAccountLabels({
        projectId: PROJECT_ID,
        labelIds: [PROD_LABEL],
      });

      // Only the label the rule names: staging is not read.
      expect(
        Array.from(resources.entries()).map(
          ([key, labels]: [string, Set<string>]) => {
            return [key, Array.from(labels)];
          },
        ),
      ).toEqual([[CHECKOUT_ARN, [PROD_LABEL]]]);
      expect(Array.from(accounts.entries())).toEqual([[ACCOUNT, [PROD_LABEL]]]);

      // Another project never reads this project's labels.
      expect(
        (
          await CloudCostAllocationFacts.readResourceLabels({
            projectId: OTHER_PROJECT_ID,
            labelIds: [PROD_LABEL],
          })
        ).size,
      ).toBe(0);
    });

    test("what a read loads for a view's rules: owners only when a rule asks about them", async () => {
      const withoutOwners: Awaited<
        ReturnType<typeof CloudCostAllocationFacts.load>
      > = await CloudCostAllocationFacts.load({
        projectId: PROJECT_ID,
        groups: [{ rules: [rule(CloudCostRuleField.Account, [ACCOUNT])] }],
        platformRows: async () => {
          return [];
        },
      });

      expect(withoutOwners.splitsByOwner).toBe(false);

      const withOwners: Awaited<
        ReturnType<typeof CloudCostAllocationFacts.load>
      > = await CloudCostAllocationFacts.load({
        projectId: PROJECT_ID,
        groups: [
          { rules: [rule(CloudCostRuleField.OwnerTeam, [PAYMENTS_TEAM])] },
          { rules: [rule(CloudCostRuleField.Label, [PROD_LABEL])] },
        ],
        platformRows: async () => {
          return [];
        },
      });

      expect(withOwners.splitsByOwner).toBe(true);
      expect(withOwners.accountLabels.get(ACCOUNT)).toEqual([PROD_LABEL]);
    });
  });

  describe("a view by owner team", () => {
    test("gets one group per owning team, linked to it, once; a name already taken gets a number", async () => {
      const view: CloudCostView = await createView({
        name: "By team",
        grouping: CloudCostViewGrouping.OwnerTeam,
      });

      // A group of the person's own already called Search.
      await createGroup({
        view,
        name: "Search",
        rules: [rule(CloudCostRuleField.Tag, ["search"], "team")],
      });

      expect(await CloudCostViewSync.makeGroupsForView(view.id!)).toBe(2);
      // Nothing left to make the second time.
      expect(await CloudCostViewSync.makeGroupsForView(view.id!)).toBe(0);

      const groups: Array<CloudCostGroup> = await CloudCostGroupService.findBy({
        query: { cloudCostViewId: view.id! },
        select: {
          name: true,
          rules: true,
          teamId: true,
          automaticKey: true,
          order: true,
        },
        props: { isRoot: true },
        skip: 0,
        limit: 10,
      });
      const made: Array<{
        name: string | undefined;
        teamId: string | undefined;
        rules: unknown;
        automatic: boolean;
      }> = groups
        .filter((group: CloudCostGroup): boolean => {
          return Boolean(group.automaticKey);
        })
        .map((group: CloudCostGroup) => {
          return {
            name: group.name,
            teamId: group.teamId?.toString(),
            rules: group.rules,
            automatic: Boolean(group.automaticKey),
          };
        })
        .sort(
          (
            a: { name: string | undefined },
            b: { name: string | undefined },
          ): number => {
            return String(a.name).localeCompare(String(b.name));
          },
        );

      expect(made).toEqual([
        {
          name: "Payments",
          teamId: PAYMENTS_TEAM,
          rules: [rule(CloudCostRuleField.OwnerTeam, [PAYMENTS_TEAM])],
          automatic: true,
        },
        {
          name: "Search (2)",
          teamId: SEARCH_TEAM,
          rules: [rule(CloudCostRuleField.OwnerTeam, [SEARCH_TEAM])],
          automatic: true,
        },
      ]);
      // Another project's team never gets a group here.
      expect(JSON.stringify(groups)).not.toContain(OTHER_PROJECT_TEAM);
    });

    test("a group OneUptime made keeps its rules: a person may rename it, never rewrite them", async () => {
      const view: CloudCostView = await createView({
        name: "By owner",
        grouping: CloudCostViewGrouping.OwnerTeam,
      });

      await CloudCostViewSync.makeGroupsForView(view.id!);

      const payments: CloudCostGroup | null =
        await CloudCostGroupService.findOneBy({
          query: { cloudCostViewId: view.id!, name: "Payments" },
          select: { _id: true, rules: true },
          props: { isRoot: true },
        });

      expect(payments?.id).toBeTruthy();

      await CloudCostGroupService.updateOneById({
        id: payments!.id!,
        data: { name: "Payments & Billing" },
        props: ADMIN,
      });
      // The same rules sent back with a rename are no rewrite.
      await CloudCostGroupService.updateOneById({
        id: payments!.id!,
        data: { name: "Payments", rules: payments!.rules! },
        props: ADMIN,
      });
      await expect(
        CloudCostGroupService.updateOneById({
          id: payments!.id!,
          data: { rules: [rule(CloudCostRuleField.Tag, ["x"], "team")] },
          props: ADMIN,
        }),
      ).rejects.toThrow(CLOUD_COST_GROUP_AUTOMATIC_RULES_ERROR);

      const stored: CloudCostGroup | null =
        await CloudCostGroupService.findOneById({
          id: payments!.id!,
          select: { name: true, rules: true },
          props: { isRoot: true },
        });

      expect(stored?.name).toBe("Payments");
      expect(stored?.rules).toEqual([
        rule(CloudCostRuleField.OwnerTeam, [PAYMENTS_TEAM]),
      ]);
    });
  });

  describe("who may read and write cost groups", () => {
    test("a member who may read the cloud's spend reads groups but makes none; one who may not reads none", async () => {
      const view: CloudCostView = await createView({ name: "Access" });
      await createGroup({ view, name: "Readable" });

      const read: Array<CloudCostGroup> = await CloudCostGroupService.findBy({
        query: { cloudCostViewId: view.id! },
        select: { name: true },
        props: CLOUD_READER,
        skip: 0,
        limit: 10,
      });

      expect(
        read.map((group: CloudCostGroup) => {
          return group.name;
        }),
      ).toEqual(["Readable"]);
      await expect(
        createGroup({ view, name: "Not allowed", props: CLOUD_READER }),
      ).rejects.toThrow();
      await expect(
        CloudCostGroupService.findBy({
          query: { cloudCostViewId: view.id! },
          select: { name: true },
          props: DASHBOARD_READER,
          skip: 0,
          limit: 10,
        }),
      ).rejects.toThrow();
      // Another project's admin is no member of this one.
      await expect(
        CloudCostGroupService.findBy({
          query: { cloudCostViewId: view.id! },
          select: { name: true },
          props: memberProps([Permission.ProjectAdmin], OTHER_PROJECT_ID),
          skip: 0,
          limit: 10,
        }),
      ).resolves.toEqual([]);
    });

    test("a group's own page reads the group alone, as its reader may; anyone else is refused before anything is read", async () => {
      const view: CloudCostView = await createView({ name: "Pages" });
      const payments: CloudCostGroup = await createGroup({
        view,
        name: "Payments",
        rules: [rule(CloudCostRuleField.OwnerTeam, [PAYMENTS_TEAM])],
      });
      await createGroup({
        view,
        name: "Search",
        rules: [rule(CloudCostRuleField.OwnerTeam, [SEARCH_TEAM])],
      });

      // CloudCost's ClickHouse reads stood in for: no costs this month.
      const query: jest.SpyInstance = jest
        .spyOn(CloudCostService, "executeQuery")
        .mockResolvedValue({
          json: async () => {
            return { data: [] };
          },
        } as never);

      const read: Awaited<ReturnType<typeof CloudCostAllocation.readGroup>> =
        await CloudCostAllocation.readGroup({
          projectId: PROJECT_ID,
          groupId: payments.id!,
          startDate: new Date("2026-11-01T00:00:00.000Z"),
          endDate: new Date("2026-11-20T00:00:00.000Z"),
          currency: "USD",
          props: CLOUD_READER,
          now: new Date("2026-11-20T12:00:00.000Z"),
        });

      expect(read.group.id).toBe(payments.id!.toString().toLowerCase());
      expect(read.group.name).toBe("Payments");
      expect(read.group.total).toBe(0);
      expect(query).toHaveBeenCalled();

      query.mockClear();

      await expect(
        CloudCostAllocation.readGroup({
          projectId: PROJECT_ID,
          groupId: payments.id!,
          startDate: new Date("2026-11-01T00:00:00.000Z"),
          endDate: new Date("2026-11-20T00:00:00.000Z"),
          currency: "USD",
          props: DASHBOARD_READER,
        }),
      ).rejects.toThrow();
      // Refused before ClickHouse was asked anything.
      expect(query).not.toHaveBeenCalled();

      // A group of another project is not found, as one that never was.
      await expect(
        CloudCostAllocation.readGroup({
          projectId: OTHER_PROJECT_ID,
          groupId: payments.id!,
          startDate: new Date("2026-11-01T00:00:00.000Z"),
          endDate: new Date("2026-11-20T00:00:00.000Z"),
          currency: "USD",
          props: OTHER_ADMIN,
        }),
      ).rejects.toThrow("This cost group was not found");
      expect(query).not.toHaveBeenCalled();

      query.mockRestore();
    });
  });
});

describe("the cost groups' Postgres suite wiring", () => {
  test("runs in a shard of the Postgres Schema Drift workflow", async () => {
    const fs: typeof import("fs") = await import("fs");
    const path: typeof import("path") = await import("path");
    const workflow: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../../.github/workflows/postgres-schema-drift.yaml",
      ),
      "utf8",
    );

    expect(workflow).toContain(
      "Tests/Server/Services/CloudCostGroupsPostgres.test.ts",
    );
    expect(workflow).toContain('RUN_POSTGRES_CLOUD_COST_GROUP_TESTS: "true"');
  });
});
