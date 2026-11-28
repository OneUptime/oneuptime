import { mockRouter } from "../../API/Helpers";
import PostgresListRouteHarness from "../../API/PostgresListRouteHarness";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudRequiredTag from "../../../../Models/DatabaseModels/CloudRequiredTag";
import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import CloudCostService from "../../../../Server/Services/CloudCostService";
import CloudRequiredTagService, {
  CLOUD_REQUIRED_TAG_DUPLICATE_ERROR,
  CLOUD_REQUIRED_TAG_KEY_ERROR,
} from "../../../../Server/Services/CloudRequiredTagService";
import MailService from "../../../../Server/Services/MailService";
import CloudHostLinks, {
  CloudLinkedHost,
  CloudLinkedVm,
} from "../../../../Server/Utils/CloudConnection/CloudHostLinks";
import {
  getResourceAllTagsConditionSql,
  getResourceTagConditionSql,
} from "../../../../Server/Utils/CloudConnection/CloudTagConditions";
import CloudTagCoverageReader from "../../../../Server/Utils/CloudConnection/CloudTagCoverageReader";
import CloudTagWatcher, {
  CloudTagWatchResult,
} from "../../../../Server/Utils/CloudConnection/CloudTagWatcher";
import { CloudResourceKind } from "../../../../Types/Cloud/CloudResourceKind";
import {
  CLOUD_HOST_VM_TYPES,
  CloudVmFacts,
} from "../../../../Types/Cloud/CloudHostLink";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudRequiredTagRule,
  CloudTagProblem,
  evaluateCloudTags,
  findAllowedCloudTagValue,
} from "../../../../Types/Cloud/CloudRequiredTags";
import {
  CloudTagCoverageJSON,
  CloudTagUntaggedResourceJSON,
} from "../../../../Types/Cloud/CloudTagCoverage";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { ChangeEventStatus } from "../../../../Utils/Telemetry/ChangeEventFields";
import { getJestSpyOn } from "../../../Spy";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * REQUIRED TAGS AND HOST LINKS ON MIGRATED POSTGRES (#11012, #11013).
 *
 *   - "Carries the tag" as Postgres SQL over a resource's jsonb tags
 *     (getResourceTagConditionSql) means what it means in code, edge by
 *     edge, as the ClickHouse suite holds the costs' SQL to it.
 *   - A required tag's key is one per place - the project's, each
 *     account's - whatever its case, and is refused written on two lines.
 *   - A host is linked to the VM it is by the IDs each cloud keeps where
 *     it keeps them: an EC2 instance's ARN, a Compute Engine VM's numeric
 *     ID in its telemetry, an Azure VM's vmId in its properties - the last
 *     two read from their JSON columns by SQL of their own. A clone links
 *     nothing, nor does a Kubernetes node.
 *   - The watcher, run whole twice an hour apart: new resources without a
 *     required tag found, who created one read from the change log and
 *     told by email, what each tag is for said, the day's coverage
 *     counted, a tagged one closed, and one with no creator told to the
 *     project's owners once it waited for the log.
 *   - Cloud > Tags' resource shares and its list of what lacks a tag.
 *
 * The tables are copied from a migrated database into a schema of the
 * suite's own (PostgresListRouteHarness); ClickHouse and email are stood
 * in for. Opt in, with the database the harness reads:
 *
 *   RUN_POSTGRES_CLOUD_TAGS_TESTS=true \
 *   PICKER_SEARCH_TEST_DATABASE_HOST=127.0.0.1 \
 *   PICKER_SEARCH_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Utils/CloudConnection/CloudTagsAndHostLinksPostgres.test.ts --forceExit
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CLOUD_TAGS_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

jest.mock("../../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// The data source is the harness's; the app's own needs no migrations.
jest.mock(
  "../../../../Server/Infrastructure/Postgres/DataSourceOptions",
  () => {
    return {};
  },
);

jest.setTimeout(240000);

const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
  schemaPrefix: "cloud_tags",
  tables: [
    "CloudAccount",
    "CloudResource",
    "CloudRequiredTag",
    "CloudTagSetting",
    "CloudTagFinding",
    "CloudTagCoverageDay",
    "Host",
    "CloudResourceOwnerTeam",
    "CloudResourceOwnerUser",
  ],
});

const PROJECT: ObjectID = new ObjectID("11012000-0000-4000-8000-00000000a001");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "11012000-0000-4000-8000-00000000a002",
);
const CONNECTION: ObjectID = new ObjectID(
  "11012000-0000-4000-8000-00000000c001",
);
const AWS_ACCOUNT: string = "123456789012";

let resourceCount: number = 0;

// One cloud resource, as a connection lists it.
async function insertResource(data: {
  projectId?: ObjectID;
  name: string;
  provider?: string;
  type?: string;
  accountId?: string;
  region?: string;
  providerResourceId?: string;
  tags?: unknown;
  telemetryAttributes?: JSONObject;
  properties?: JSONObject;
  isArchived?: boolean;
  createdAt?: Date;
}): Promise<ObjectID> {
  const id: ObjectID = ObjectID.generate();
  resourceCount++;

  await harness.insert("CloudResource", {
    _id: id,
    projectId: data.projectId || PROJECT,
    name: data.name,
    slug: `${data.name}-${resourceCount}`,
    resourceIdentifier: `${data.name}-${resourceCount}`,
    version: 1,
    cloudProvider: data.provider || "aws",
    cloudResourceType: data.type || "AWS::EC2::Instance",
    cloudResourceKind: CloudResourceKind.Resource,
    cloudConnectionId: CONNECTION,
    cloudAccountId: data.accountId || AWS_ACCOUNT,
    cloudRegion: data.region || "eu-west-1",
    providerResourceId:
      data.providerResourceId ||
      `arn:aws:ec2:eu-west-1:${AWS_ACCOUNT}:instance/i-${String(resourceCount).padStart(8, "0")}`,
    cloudTags: JSON.stringify(data.tags === undefined ? {} : data.tags),
    telemetryAttributes: JSON.stringify(data.telemetryAttributes || {}),
    cloudProperties: JSON.stringify(data.properties || {}),
    isArchived: data.isArchived === true,
    ...(data.createdAt ? { createdAt: data.createdAt } : {}),
  });

  return id;
}

async function insertHost(data: {
  name: string;
  hostId: string;
  provider: string;
  accountId: string;
  region: string;
  kubernetesClusterId?: ObjectID;
}): Promise<ObjectID> {
  const id: ObjectID = ObjectID.generate();

  await harness.insert("Host", {
    _id: id,
    projectId: PROJECT,
    name: data.name,
    slug: `${data.name}-${id.toString()}`,
    hostIdentifier: data.name,
    version: 1,
    hostId: data.hostId,
    cloudProvider: data.provider,
    cloudAccountId: data.accountId,
    cloudRegion: data.region,
    ...(data.kubernetesClusterId
      ? { kubernetesClusterId: data.kubernetesClusterId }
      : {}),
    isArchived: false,
  });

  return id;
}

function rule(
  key: string,
  allowedValues: Array<string> = [],
): CloudRequiredTagRule {
  return {
    id: `${key}|${allowedValues.join(",")}`,
    key,
    allowedValues,
    cloudAccountId: null,
  };
}

describePostgres("required tags and host links on migrated Postgres", () => {
  beforeAll(async () => {
    await harness.setUp();
    await harness.insertProject(PROJECT, "Cloud tags");
    await harness.insertProject(OTHER_PROJECT, "Another project");
  });

  afterAll(async () => {
    await harness.tearDown();
  });

  describe("a resource carries a required tag exactly when code says it does", () => {
    const TAGS: Array<unknown> = [
      {},
      { team: "payments" },
      { Team: "Payments" },
      { TEAM: " payments " },
      { team: "" },
      { team: "   " },
      { team: "unknown", Team: "payments" },
      { team: "platform-core" },
      { team: "Platform-X" },
      { env: "prod-eu" },
      { env: "PROD-12" },
      { env: "prod_eu" },
      { env: "100%" },
      { team: "équipe" },
      { team: "ÉQUIPE" },
      { team: "команда" },
      { team: "a\\b" },
      { team: "a_b" },
      { team: "axb" },
      { "cost-center": "4711" },
      { team: 7 },
      // Not a map at all: carries nothing.
      ["team"],
      "team",
      null,
    ];
    const RULES: Array<CloudRequiredTagRule> = [
      rule("team"),
      rule("TEAM", ["payments", "platform-*", "équipe", "команда"]),
      rule("env", ["prod-*", "100%"]),
      rule("env", ["prod-??"]),
      rule("team", ["a_b", "a\\b"]),
      rule("team", ["*_*"]),
      rule("cost-center"),
    ];
    const ids: Array<ObjectID> = [];

    beforeAll(async () => {
      for (let index: number = 0; index < TAGS.length; index++) {
        ids.push(
          await insertResource({
            name: `tags-${index}`,
            tags: TAGS[index],
          }),
        );
      }
    });

    async function carrying(
      condition: string,
      params: Array<unknown>,
    ): Promise<Array<string>> {
      const rows: Array<{ id: string }> = (await harness.query(
        `SELECT r."_id" AS "id" FROM "${harness.schema}"."CloudResource" r WHERE r."projectId" = $1 AND r."name" LIKE 'tags-%' AND ${condition}`,
        params,
      )) as Array<{ id: string }>;

      return rows
        .map((row: { id: string }): string => {
          return row.id;
        })
        .sort();
    }

    function expected(
      carries: (tags: Record<string, unknown> | null) => boolean,
    ): Array<string> {
      return TAGS.map((tags: unknown, index: number): string | null => {
        const map: Record<string, unknown> | null =
          tags && typeof tags === "object" && !Array.isArray(tags)
            ? (tags as Record<string, unknown>)
            : null;

        return carries(map) ? ids[index]!.toString() : null;
      })
        .filter((id: string | null): id is string => {
          return id !== null;
        })
        .sort();
    }

    test("each tag on its own", async () => {
      for (const required of RULES) {
        const params: Array<unknown> = [PROJECT.toString()];
        const condition: string = getResourceTagConditionSql({
          rule: required,
          params,
          tagsColumn: `r."cloudTags"`,
        });

        expect({
          rule: required.id,
          ids: await carrying(condition, params),
        }).toEqual({
          rule: required.id,
          ids: expected((tags: Record<string, unknown> | null): boolean => {
            return Boolean(findAllowedCloudTagValue(tags, required));
          }),
        });
      }
    });

    test("every tag of a set at once, and no tag at all", async () => {
      const set: Array<CloudRequiredTagRule> = [
        rule("team", ["payments"]),
        rule("env", ["prod-*"]),
      ];
      const params: Array<unknown> = [PROJECT.toString()];
      const condition: string = getResourceAllTagsConditionSql({
        rules: set,
        params,
        tagsColumn: `r."cloudTags"`,
      });

      expect(await carrying(condition, params)).toEqual(
        expected((tags: Record<string, unknown> | null): boolean => {
          return evaluateCloudTags(tags, set).length === 0;
        }),
      );
      expect(
        (
          await carrying(
            getResourceAllTagsConditionSql({
              rules: [],
              params: [],
              tagsColumn: `r."cloudTags"`,
            }),
            [PROJECT.toString()],
          )
        ).length,
      ).toBe(TAGS.length);
    });
  });

  describe("a required tag's key, once a place", () => {
    const ACCOUNT_ROW: ObjectID = new ObjectID(
      "11012000-0000-4000-8000-00000000b099",
    );

    beforeAll(async () => {
      await harness.insert("CloudAccount", {
        _id: ACCOUNT_ROW,
        projectId: PROJECT,
        name: "keys-account",
        accountId: "210987654321",
        provider: "aws",
        version: 1,
      });
    });

    function tag(
      key: string,
      cloudAccountId?: ObjectID,
      allowed?: Array<string>,
    ): CloudRequiredTag {
      const model: CloudRequiredTag = new CloudRequiredTag();
      model.projectId = PROJECT;
      model.tagKey = key;
      model.allowedValues = (allowed || []) as never;

      if (cloudAccountId) {
        model.cloudAccountId = cloudAccountId;
      }

      return model;
    }

    async function refusal(write: Promise<unknown>): Promise<string> {
      try {
        await write;
      } catch (error) {
        expect(error).toBeInstanceOf(BadDataException);
        return (error as Error).message;
      }

      throw new Error("Expected the write to be refused.");
    }

    test("kept trimmed, its values once each; the same key again, whatever its case, is refused in its place and allowed in another", async () => {
      const created: CloudRequiredTag = await CloudRequiredTagService.create({
        data: tag("  Owner ", undefined, ["payments", " Payments", "search"]),
        props: { isRoot: true },
      });
      const read: CloudRequiredTag | null =
        await CloudRequiredTagService.findOneById({
          id: created.id!,
          select: { tagKey: true, allowedValues: true },
          props: { isRoot: true },
        });

      expect(read?.tagKey).toBe("Owner");
      expect(read?.allowedValues).toEqual(["payments", "search"]);

      expect(
        await refusal(
          CloudRequiredTagService.create({
            data: tag("OWNER"),
            props: { isRoot: true },
          }),
        ),
      ).toBe(CLOUD_REQUIRED_TAG_DUPLICATE_ERROR);

      // One account's own owner tag is another place.
      const own: CloudRequiredTag = await CloudRequiredTagService.create({
        data: tag("owner", ACCOUNT_ROW),
        props: { isRoot: true },
      });
      expect(own.id).toBeDefined();

      expect(
        await refusal(
          CloudRequiredTagService.create({
            data: tag(" Owner", ACCOUNT_ROW),
            props: { isRoot: true },
          }),
        ),
      ).toBe(CLOUD_REQUIRED_TAG_DUPLICATE_ERROR);

      // The account named by the relation instead of its id is the same place.
      const byRelation: CloudRequiredTag = tag("OWNER");
      byRelation.cloudAccount = Object.assign(new CloudAccount(), {
        _id: ACCOUNT_ROW.toString(),
      });
      expect(
        await refusal(
          CloudRequiredTagService.create({
            data: byRelation,
            props: { isRoot: true },
          }),
        ),
      ).toBe(CLOUD_REQUIRED_TAG_DUPLICATE_ERROR);

      // Renaming another tag onto the key is refused too.
      const other: CloudRequiredTag = await CloudRequiredTagService.create({
        data: tag("department"),
        props: { isRoot: true },
      });
      expect(
        await refusal(
          CloudRequiredTagService.updateOneById({
            id: other.id!,
            data: { tagKey: "OwNeR" } as never,
            props: { isRoot: true },
          }),
        ),
      ).toBe(CLOUD_REQUIRED_TAG_DUPLICATE_ERROR);
      // A tag written again with its own key is no clash with itself.
      await CloudRequiredTagService.updateOneById({
        id: created.id!,
        data: { tagKey: "owner" } as never,
        props: { isRoot: true },
      });
    });

    test("a key on two lines, too long, or empty is refused", async () => {
      for (const key of ["team\nname", "x".repeat(129), "   "]) {
        expect(
          await refusal(
            CloudRequiredTagService.create({
              data: tag(key),
              props: { isRoot: true },
            }),
          ),
        ).toBe(CLOUD_REQUIRED_TAG_KEY_ERROR);
      }
    });

    afterAll(async () => {
      await harness.query(
        `DELETE FROM "${harness.schema}"."CloudRequiredTag" WHERE "projectId" = $1`,
        [PROJECT.toString()],
      );
    });
  });

  describe("the host a VM is", () => {
    const AWS_INSTANCE: string = "i-0abc123def4567890";
    const CLONED_INSTANCE: string = "i-0bbb123def4567890";
    const NODE_INSTANCE: string = "i-0ccc123def4567890";
    const GCE_ID: string = "4728196572738160511";
    const AZURE_VM_ID: string = "a795d522-f96c-433d-93df-d1657a8f80b3";
    const SUBSCRIPTION: string = "5b31f3ff-7021-4486-8b6b-9b0e156c9b2c";
    const vms: Record<string, ObjectID> = {};
    const hosts: Record<string, ObjectID> = {};

    beforeAll(async () => {
      vms["aws"] = await insertResource({
        name: "vm-aws",
        providerResourceId: `arn:aws:ec2:eu-west-1:${AWS_ACCOUNT}:instance/${AWS_INSTANCE}`,
      });
      vms["clone"] = await insertResource({
        name: "vm-clone",
        providerResourceId: `arn:aws:ec2:eu-west-1:${AWS_ACCOUNT}:instance/${CLONED_INSTANCE}`,
      });
      vms["node"] = await insertResource({
        name: "vm-node",
        providerResourceId: `arn:aws:ec2:eu-west-1:${AWS_ACCOUNT}:instance/${NODE_INSTANCE}`,
      });
      vms["gce"] = await insertResource({
        name: "vm-gce",
        provider: "gcp",
        type: CLOUD_HOST_VM_TYPES[CloudProvider.GCP],
        accountId: "shop-prod",
        region: "us-central1",
        providerResourceId:
          "//compute.googleapis.com/projects/shop-prod/zones/us-central1-a/instances/web-1",
        telemetryAttributes: { "resource.instance_id": GCE_ID },
      });
      vms["azure"] = await insertResource({
        name: "vm-azure",
        provider: "azure",
        type: CLOUD_HOST_VM_TYPES[CloudProvider.Azure],
        accountId: SUBSCRIPTION.toUpperCase(),
        region: "eastus",
        providerResourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/dev/providers/Microsoft.Compute/virtualMachines/dev`,
        properties: { vmId: AZURE_VM_ID.toUpperCase() },
      });

      hosts["aws"] = await insertHost({
        name: "web-aws",
        hostId: AWS_INSTANCE,
        provider: "aws",
        accountId: AWS_ACCOUNT,
        region: "eu-west-1",
      });
      hosts["clone-1"] = await insertHost({
        name: "clone-1",
        hostId: CLONED_INSTANCE,
        provider: "aws",
        accountId: AWS_ACCOUNT,
        region: "eu-west-1",
      });
      hosts["clone-2"] = await insertHost({
        name: "clone-2",
        hostId: CLONED_INSTANCE,
        provider: "aws",
        accountId: AWS_ACCOUNT,
        region: "eu-west-1",
      });
      hosts["node"] = await insertHost({
        name: "k8s-node",
        hostId: NODE_INSTANCE,
        provider: "aws",
        accountId: AWS_ACCOUNT,
        region: "eu-west-1",
        kubernetesClusterId: ObjectID.generate(),
      });
      hosts["gce"] = await insertHost({
        name: "web-gce",
        hostId: GCE_ID,
        provider: "gcp",
        accountId: "shop-prod",
        region: "us-central1",
      });
      hosts["azure"] = await insertHost({
        name: "web-azure",
        hostId: AZURE_VM_ID,
        provider: "azure",
        accountId: SUBSCRIPTION,
        region: "eastus",
      });
      // Off a cloud: the machine-id, which no VM is.
      hosts["bare"] = await insertHost({
        name: "bare-metal",
        hostId: "4d5c0e9a2b1f4e7c8a3b6d9e0f1a2b3c",
        provider: "",
        accountId: "",
        region: "",
      });
    });

    test("each VM to the one host that is it, read from where each cloud keeps its ID", async () => {
      const facts: Array<CloudVmFacts> = [];

      for (const name of Object.keys(vms)) {
        const rows: Array<Record<string, unknown>> = (await harness.query(
          `SELECT "_id", "name", "cloudProvider", "cloudResourceType", "cloudAccountId", "cloudRegion", "providerResourceId", "telemetryAttributes", "cloudProperties" FROM "${harness.schema}"."CloudResource" WHERE "_id" = $1`,
          [vms[name]!.toString()],
        )) as Array<Record<string, unknown>>;
        const row: Record<string, unknown> = rows[0]!;

        facts.push({
          id: String(row["_id"]),
          provider: row["cloudProvider"] as string,
          type: row["cloudResourceType"] as string,
          accountId: row["cloudAccountId"] as string,
          region: row["cloudRegion"] as string,
          providerResourceId: row["providerResourceId"] as string,
          telemetryAttributes: row["telemetryAttributes"] as Record<
            string,
            unknown
          >,
          properties: row["cloudProperties"] as JSONObject,
        });
      }

      const links: Map<string, CloudLinkedHost> =
        await CloudHostLinks.hostsOfVms({
          projectId: PROJECT,
          vms: facts,
        });

      expect(
        Object.fromEntries(
          Array.from(links.entries()).map(
            ([vmId, host]: [string, CloudLinkedHost]): [string, string] => {
              return [vmId, host.id.toString()];
            },
          ),
        ),
      ).toEqual({
        [vms["aws"]!.toString()]: hosts["aws"]!.toString(),
        [vms["gce"]!.toString()]: hosts["gce"]!.toString(),
        [vms["azure"]!.toString()]: hosts["azure"]!.toString(),
      });
      expect(links.get(vms["aws"]!.toString())?.hostIdentifier).toBe("web-aws");
    });

    test("a host's page finds its VM, and a VM's page its host; a clone, a node or a bare machine none", async () => {
      for (const name of ["aws", "gce", "azure"]) {
        const vm: CloudLinkedVm | null = await CloudHostLinks.vmOfHost({
          projectId: PROJECT,
          hostId: hosts[name]!,
          props: { isRoot: true },
        });

        expect({ name, vm: vm?.id.toString() }).toEqual({
          name,
          vm: vms[name]!.toString(),
        });

        const host: CloudLinkedHost | null = await CloudHostLinks.hostOfVm({
          projectId: PROJECT,
          cloudResourceId: vms[name]!,
          props: { isRoot: true },
        });

        expect({ name, host: host?.id.toString() }).toEqual({
          name,
          host: hosts[name]!.toString(),
        });
      }

      expect(
        (
          await CloudHostLinks.vmOfHost({
            projectId: PROJECT,
            hostId: hosts["azure"]!,
            props: { isRoot: true },
          })
        )?.instanceId,
      ).toBe(AZURE_VM_ID);

      for (const name of ["clone-1", "clone-2", "node", "bare"]) {
        expect({
          name,
          vm: await CloudHostLinks.vmOfHost({
            projectId: PROJECT,
            hostId: hosts[name]!,
            props: { isRoot: true },
          }),
        }).toEqual({ name, vm: null });
      }

      for (const name of ["clone", "node"]) {
        expect({
          name,
          host: await CloudHostLinks.hostOfVm({
            projectId: PROJECT,
            cloudResourceId: vms[name]!,
            props: { isRoot: true },
          }),
        }).toEqual({ name, host: null });
      }
    });
  });

  describe("the watcher, run whole", () => {
    const ACCOUNT_ROW: ObjectID = new ObjectID(
      "11012000-0000-4000-8000-00000000b001",
    );
    const OWNER: ObjectID = new ObjectID(
      "11012000-0000-4000-8000-00000000e001",
    );
    const LISTED_AT: Date = new Date("2026-11-20T08:00:00.000Z");
    const FIRST_RUN: Date = new Date("2026-11-20T10:00:00.000Z");
    const SECOND_RUN: Date = new Date("2026-11-20T11:00:00.000Z");
    const WATCH_ACCOUNT: string = "345678901234";
    const ids: Record<string, ObjectID> = {};
    let changeRows: Array<JSONObject> = [];
    let mails: Array<{ to: string; subject: string; html: string }> = [];

    beforeAll(async () => {
      await harness.insertMember({
        userId: OWNER,
        projectId: PROJECT,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectOwner,
      });
      await harness.insert("CloudAccount", {
        _id: ACCOUNT_ROW,
        projectId: PROJECT,
        name: "prod",
        accountId: WATCH_ACCOUNT,
        provider: "aws",
        version: 1,
        inventoryListedAt: LISTED_AT,
      });

      for (const [key, allowed, description] of [
        [
          "team",
          ["payments", "search"],
          "The team that pays for the resource.",
        ],
        ["env", [], null],
      ] as Array<[string, Array<string>, string | null]>) {
        await harness.insert("CloudRequiredTag", {
          _id: ObjectID.generate(),
          projectId: PROJECT,
          tagKey: key,
          allowedValues: JSON.stringify(allowed),
          ...(description ? { description } : {}),
          version: 1,
          createdAt: new Date("2026-11-19T09:00:00.000Z"),
        });
      }

      const at: (time: string) => Date = (time: string): Date => {
        return new Date(`2026-11-20T${time}:00.000Z`);
      };
      const arn: (instance: string) => string = (instance: string): string => {
        return `arn:aws:ec2:eu-west-1:${WATCH_ACCOUNT}:instance/${instance}`;
      };

      ids["new"] = await insertResource({
        name: "web-new",
        accountId: WATCH_ACCOUNT,
        providerResourceId: arn("i-0aaa000000000001"),
        tags: { env: "prod" },
        createdAt: at("09:30"),
      });
      ids["tagged"] = await insertResource({
        name: "web-tagged",
        accountId: WATCH_ACCOUNT,
        providerResourceId: arn("i-0aaa000000000002"),
        tags: { Team: "Payments", env: "prod" },
        createdAt: at("09:40"),
      });
      ids["envless"] = await insertResource({
        name: "web-envless",
        accountId: WATCH_ACCOUNT,
        providerResourceId: arn("i-0aaa000000000003"),
        tags: { team: "search" },
        createdAt: at("09:50"),
      });
      // Listed before the account's first full listing: not new.
      ids["old"] = await insertResource({
        name: "web-old",
        accountId: WATCH_ACCOUNT,
        providerResourceId: arn("i-0aaa000000000004"),
        createdAt: at("07:00"),
      });
      ids["archived"] = await insertResource({
        name: "web-archived",
        accountId: WATCH_ACCOUNT,
        providerResourceId: arn("i-0aaa000000000005"),
        isArchived: true,
        createdAt: at("09:45"),
      });
      ids["elsewhere"] = await insertResource({
        projectId: OTHER_PROJECT,
        name: "web-elsewhere",
        accountId: WATCH_ACCOUNT,
        providerResourceId: arn("i-0aaa000000000006"),
        createdAt: at("09:45"),
      });
    });

    beforeEach(() => {
      getJestSpyOn(ChangeEventService, "executeQuery").mockImplementation(
        (async (): Promise<unknown> => {
          return {
            json: async (): Promise<{ data: Array<JSONObject> }> => {
              return { data: changeRows };
            },
          };
        }) as never,
      );
      getJestSpyOn(MailService, "sendMail").mockImplementation((async (mail: {
        toEmail: unknown;
        subject?: string;
        vars: JSONObject;
      }): Promise<void> => {
        mails.push({
          to: String(mail.toEmail),
          subject: String(mail.subject || ""),
          html: String(mail.vars["message"] || ""),
        });
      }) as never);
    });

    async function findings(): Promise<Array<Record<string, unknown>>> {
      return (await harness.query(
        `SELECT "cloudResourceId", "cloudAccountId", "missingTags", "creatorActor", "creatorUserId", "foundAt", "notifiedAt", "resolvedAt" FROM "${harness.schema}"."CloudTagFinding" WHERE "projectId" = $1 ORDER BY "foundAt", "cloudResourceId"`,
        [PROJECT.toString()],
      )) as Array<Record<string, unknown>>;
    }

    function findingOf(
      rows: Array<Record<string, unknown>>,
      name: string,
    ): Record<string, unknown> | undefined {
      return rows.find((row: Record<string, unknown>): boolean => {
        return String(row["cloudResourceId"]) === ids[name]!.toString();
      });
    }

    test("the first run: new resources without a tag found, the one whose creator the log names told, the day counted", async () => {
      mails = [];
      changeRows = [
        {
          time: "2026-11-20 09:29:00.000",
          provider: "aws",
          operation: "ec2:RunInstances",
          actor: `AWSReservedSSO_Admin_0abc/${OWNER.toString()}@example.com`,
          resourceIds: "i-0aaa000000000001",
          resourceId: "i-0aaa000000000001",
          resourceRowId: "",
          status: ChangeEventStatus.Succeeded,
        },
      ];

      const result: CloudTagWatchResult = await CloudTagWatcher.runForProject({
        projectId: PROJECT,
        now: FIRST_RUN,
      });

      expect(result.found).toBe(2);
      expect(result.creatorsFound).toBe(1);
      expect(result.emailsSent).toBe(1);
      /*
       * Each of the project's accounts has its day counted: this one, and
       * "keys-account" of the required tags' keys above, whose connection
       * listed nothing. 0 is a count (CloudTagCoverageDayService), so its
       * day is kept as 0 of 0, not refused as missing.
       */
      expect(result.daysCounted).toBe(2);

      const rows: Array<Record<string, unknown>> = await findings();
      expect(rows).toHaveLength(2);

      const newOne: Record<string, unknown> | undefined = findingOf(
        rows,
        "new",
      );
      expect(newOne?.["missingTags"]).toEqual([
        expect.objectContaining({
          key: "team",
          problem: CloudTagProblem.Missing,
        }),
      ]);
      expect(newOne?.["creatorActor"]).toBe(
        `AWSReservedSSO_Admin_0abc/${OWNER.toString()}@example.com`,
      );
      expect(String(newOne?.["creatorUserId"])).toBe(OWNER.toString());
      expect(String(newOne?.["cloudAccountId"])).toBe(ACCOUNT_ROW.toString());
      expect(newOne?.["notifiedAt"]).not.toBeNull();

      // No creator yet: it waits for the change log, untold.
      const envless: Record<string, unknown> | undefined = findingOf(
        rows,
        "envless",
      );
      expect(envless?.["missingTags"]).toEqual([
        expect.objectContaining({
          key: "env",
          problem: CloudTagProblem.Missing,
        }),
      ]);
      expect(envless?.["notifiedAt"]).toBeNull();

      // One email, to its creator: the resource, what it lacks, what the tag is for.
      expect(mails).toHaveLength(1);
      expect(mails[0]!.to).toBe(`${OWNER.toString()}@example.com`);
      expect(mails[0]!.subject).toBe(
        "A new cloud resource is missing required tags: web-new",
      );
      expect(mails[0]!.html).toContain("web-new");
      expect(mails[0]!.html).toContain("Missing: team.");
      expect(mails[0]!.html).toContain(
        "team: The team that pays for the resource.",
      );

      // The day's count: four listed (not the archived, not the other project's), one carrying both.
      const days: Array<Record<string, unknown>> = (await harness.query(
        `SELECT "resourceCount", "coveredCount", "keyCounts", "day" FROM "${harness.schema}"."CloudTagCoverageDay" WHERE "cloudAccountId" = $1`,
        [ACCOUNT_ROW.toString()],
      )) as Array<Record<string, unknown>>;
      expect(days).toHaveLength(1);
      expect(Number(days[0]!["resourceCount"])).toBe(4);
      expect(Number(days[0]!["coveredCount"])).toBe(1);
      expect(days[0]!["keyCounts"]).toEqual({ team: 2, env: 2 });

      // The project's other account listed nothing: 0 of 0, each tag on none.
      const emptyDays: Array<Record<string, unknown>> = (await harness.query(
        `SELECT "resourceCount", "coveredCount", "keyCounts" FROM "${harness.schema}"."CloudTagCoverageDay" WHERE "projectId" = $1 AND "cloudAccountId" <> $2`,
        [PROJECT.toString(), ACCOUNT_ROW.toString()],
      )) as Array<Record<string, unknown>>;
      expect(emptyDays).toHaveLength(1);
      expect(Number(emptyDays[0]!["resourceCount"])).toBe(0);
      expect(Number(emptyDays[0]!["coveredCount"])).toBe(0);
      expect(emptyDays[0]!["keyCounts"]).toEqual({ team: 0, env: 0 });

      // What the watcher keeps: the account's first listing, the email's hour, the day.
      const settings: Array<Record<string, unknown>> = (await harness.query(
        `SELECT "watchState" FROM "${harness.schema}"."CloudTagSetting" WHERE "projectId" = $1`,
        [PROJECT.toString()],
      )) as Array<Record<string, unknown>>;
      expect(settings[0]!["watchState"]).toEqual({
        accounts: { [ACCOUNT_ROW.toString()]: LISTED_AT.toISOString() },
        lastDigestAt: FIRST_RUN.toISOString(),
        lastCountedDay: "2026-11-20",
      });
    });

    test("an hour on: a resource tagged since is closed, and one whose creator the log never named is told to the project's owners", async () => {
      mails = [];
      changeRows = [];
      await harness.query(
        `UPDATE "${harness.schema}"."CloudResource" SET "cloudTags" = $1 WHERE "_id" = $2`,
        [
          JSON.stringify({ team: "payments", env: "prod" }),
          ids["new"]!.toString(),
        ],
      );

      const result: CloudTagWatchResult = await CloudTagWatcher.runForProject({
        projectId: PROJECT,
        now: SECOND_RUN,
      });

      expect(result.found).toBe(0);
      expect(result.resolved).toBe(1);
      expect(result.emailsSent).toBe(1);
      // Counted once a day.
      expect(result.daysCounted).toBe(0);

      const rows: Array<Record<string, unknown>> = await findings();
      expect(rows).toHaveLength(2);
      expect(findingOf(rows, "new")?.["resolvedAt"]).not.toBeNull();
      expect(findingOf(rows, "envless")?.["notifiedAt"]).not.toBeNull();

      expect(mails).toHaveLength(1);
      expect(mails[0]!.to).toBe(`${OWNER.toString()}@example.com`);
      expect(mails[0]!.subject).toBe(
        "A new cloud resource is missing required tags: web-envless",
      );
    });

    test("a third run tells nobody again", async () => {
      mails = [];

      const result: CloudTagWatchResult = await CloudTagWatcher.runForProject({
        projectId: PROJECT,
        now: new Date("2026-11-20T12:30:00.000Z"),
      });

      expect(result.found).toBe(0);
      expect(result.emailsSent).toBe(0);
      expect(mails).toHaveLength(0);
    });
  });

  describe("Cloud > Tags' resources", () => {
    test("each account's share of its resources, and what lacks a tag listed with what it lacks", async () => {
      getJestSpyOn(CloudCostService, "executeQuery").mockImplementation(
        (async (): Promise<unknown> => {
          return {
            json: async (): Promise<{ data: Array<JSONObject> }> => {
              return { data: [] };
            },
          };
        }) as never,
      );

      const coverage: CloudTagCoverageJSON = await CloudTagCoverageReader.read({
        projectId: PROJECT,
        cloudAccountId: new ObjectID("11012000-0000-4000-8000-00000000b001"),
        props: { isRoot: true },
        now: new Date("2026-11-20T12:00:00.000Z"),
      });

      expect(coverage.hasRules).toBe(true);
      expect(
        coverage.requiredTags.map((entry: { key: string }): string => {
          return entry.key;
        }),
      ).toEqual(["env", "team"]);
      expect(coverage.accounts).toHaveLength(1);
      // web-new (tagged since), web-tagged, web-envless, web-old: two carry both now.
      expect(coverage.accounts[0]!.resources.all).toEqual({
        covered: 2,
        total: 4,
      });
      expect(coverage.untaggedCount).toBe(2);
      expect(
        coverage.untagged
          .map((resource: CloudTagUntaggedResourceJSON): string => {
            return resource.name;
          })
          .sort(),
      ).toEqual(["web-envless", "web-old"]);

      const old: CloudTagUntaggedResourceJSON | undefined =
        coverage.untagged.find((resource: CloudTagUntaggedResourceJSON) => {
          return resource.name === "web-old";
        });
      expect(
        old?.missing
          .map((missing: { key: string }): string => {
            return missing.key;
          })
          .sort(),
      ).toEqual(["env", "team"]);
    });
  });
});
