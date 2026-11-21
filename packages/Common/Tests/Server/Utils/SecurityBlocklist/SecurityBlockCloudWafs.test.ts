import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import SecurityBlockCloudWaf from "../../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import SecurityBlockCloudWafService from "../../../../Server/Services/SecurityBlockCloudWafService";
import AwsWafBlocklistGroup from "../../../../Server/Utils/CloudConnection/Aws/AwsWafBlocklist";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { AwsWafBlockDestinationSource } from "../../../../Server/Utils/SecurityBlocklist/AwsWafBlockDestination";
import SecurityBlockCloudWafs from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockCloudWafs";
import SecurityBlocklistJobs from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import { SECURITY_BLOCKLIST_LOCK_NAMESPACE } from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  AwsWafScope,
  getAwsWafBlocklistRuleNames,
  getAwsWafBlocklistSets,
} from "../../../../Types/CloudConnection/AwsWafBlocklist";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { getAwsExternalIdForProject } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafLeftItem,
  SecurityBlockCloudWafLeftKind,
  SecurityBlockCloudWafStatus,
} from "../../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import InMemoryLocks from "../../TestingUtils/InMemoryLocks";
import {
  FAKE_WAF_ACCOUNT_ID,
  FakeAwsWaf,
  FakeWafIpSet,
  FakeWafWebAcl,
  WAF_ERRORS,
  bumpIpSet,
  bumpWebAcl,
  createFakeAwsWaf,
} from "../CloudConnection/FakeAwsWaf";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * CHECK AGAIN AND REMOVE, FOR A WEB ACL THAT ENFORCES THE BLOCKLIST
 * (#10344) - SecurityBlockCloudWafs - against AWS WAF as it answers
 * (FakeAwsWaf), the web ACLs' rows and the connection held in memory.
 *
 * A check makes OneUptime's IP sets and, when OneUptime adds its rule,
 * places it - so a web ACL is ready, and its rule shown with its sets'
 * ARNs, before the first block - and records where the web ACL stands;
 * what AWS refuses is that status, never an error. A removal takes
 * OneUptime's rule out and its sets away - never the team's rules, never a
 * set another web ACL still uses - and refuses, removing nothing, when AWS
 * does; "from OneUptime only" touches nothing at AWS and names what stays.
 * Both take the lock a pass of the reconciler takes for the sets.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const EXTERNAL_ID: string = getAwsExternalIdForProject(PROJECT_ID.toString());
const RULES: { block: string; challenge: string } =
  getAwsWafBlocklistRuleNames(EXTERNAL_ID);
const SETS: ReturnType<typeof getAwsWafBlocklistSets> =
  getAwsWafBlocklistSets(EXTERNAL_ID);
const REGION: string = "eu-west-1";
const LOCK_KEY: string = AwsWafBlocklistGroup.getLockKey({
  projectId: PROJECT_ID.toString(),
  accountId: FAKE_WAF_ACCOUNT_ID,
  region: REGION,
  scope: AwsWafScope.Regional,
});
const NOW: Date = new Date("2026-11-21T10:42:00.000Z");

let fake: FakeAwsWaf;
let clock: number;
let locks: InMemoryLocks;
let rows: Map<string, SecurityBlockCloudWaf>;
let wafBlocklist: string;
let deleted: Array<string>;
let reconcile: ReturnType<typeof jest.fn>;

function sameId(left: unknown, right: unknown): boolean {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function setName(key: string): string {
  return SETS.find((set: { key: string }): boolean => {
    return set.key === key;
  })!.name;
}

function ipSet(key: string): FakeWafIpSet | undefined {
  return fake.getIpSet(REGION, "REGIONAL", setName(key));
}

function rulesOf(name: string): Array<[unknown, unknown]> {
  return fake
    .getRules(REGION, "REGIONAL", name)
    .map((rule: JSONObject): [unknown, unknown] => {
      return [rule["Name"], rule["Priority"]];
    });
}

function writesOf(action: string): number {
  return fake.actions().filter((name: string): boolean => {
    return name === action;
  }).length;
}

function customerRule(name: string, priority: number): JSONObject {
  return {
    Name: name,
    Priority: priority,
    Action: { Block: {} },
    Statement: { GeoMatchStatement: { CountryCodes: ["KP"] } },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: name,
    },
  };
}

// The rules a team keeps in code, blocking and challenging through OneUptime's sets.
function teamRules(): Array<JSONObject> {
  const reference: (key: string) => JSONObject = (key: string) => {
    return { IPSetReferenceStatement: { ARN: ipSet(key)!.arn } };
  };

  return [
    {
      Name: "oneuptime-blocklist",
      Priority: 0,
      Action: { Block: {} },
      Statement: {
        OrStatement: {
          Statements: [reference("block-ipv4"), reference("block-ipv6")],
        },
      },
      VisibilityConfig: {
        SampledRequestsEnabled: true,
        CloudWatchMetricsEnabled: true,
        MetricName: "oneuptime-blocklist",
      },
    },
    {
      Name: "oneuptime-challenge",
      Priority: 1,
      Action: { Challenge: {} },
      Statement: {
        OrStatement: {
          Statements: [
            reference("challenge-ipv4"),
            reference("challenge-ipv6"),
          ],
        },
      },
      VisibilityConfig: {
        SampledRequestsEnabled: true,
        CloudWatchMetricsEnabled: true,
        MetricName: "oneuptime-challenge",
      },
    },
  ];
}

// A web ACL at AWS, and the row that picked it.
function picked(data: {
  index: number;
  name: string;
  rules?: Array<JSONObject> | undefined;
}): { acl: FakeWafWebAcl; row: SecurityBlockCloudWaf } {
  const acl: FakeWafWebAcl = fake.addWebAcl({
    region: REGION,
    scope: "REGIONAL",
    name: data.name,
    rules: data.rules,
  });
  const row: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();

  row._id = `cccccccc-cccc-4ccc-8ccc-${String(data.index).padStart(12, "0")}`;
  row.projectId = PROJECT_ID;
  row.cloudConnectionId = CONNECTION_ID;
  row.cloudProvider = CloudProvider.AWS;
  row.wafId = acl.webAcl["ARN"] as string;
  row.name = data.name;
  row.region = REGION;
  row.clientAddress = SecurityBlockClientAddress.SourceIp;
  row.status = SecurityBlockCloudWafStatus.Checking;
  rows.set(row._id, row);

  return { acl, row };
}

function stored(row: SecurityBlockCloudWaf): SecurityBlockCloudWaf | undefined {
  return rows.get(row._id!);
}

async function check(
  row: SecurityBlockCloudWaf,
): Promise<SecurityBlockCloudWaf> {
  return await SecurityBlockCloudWafs.check({
    projectId: PROJECT_ID,
    cloudWafId: new ObjectID(row._id!),
  });
}

async function remove(
  row: SecurityBlockCloudWaf,
  keepInCloud: boolean = false,
): Promise<{ leftInCloud: Array<SecurityBlockCloudWafLeftItem> }> {
  return await SecurityBlockCloudWafs.remove({
    projectId: PROJECT_ID,
    cloudWafId: new ObjectID(row._id!),
    keepInCloud,
  });
}

beforeEach(() => {
  fake = createFakeAwsWaf();
  clock = NOW.getTime();
  rows = new Map();
  wafBlocklist = "rule";
  deleted = [];

  locks = new InMemoryLocks();
  locks.install();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(clock);
  });

  AwsWafBlockDestinationSource.setCallOptionsForTests({
    transport: fake.transport,
    now: (): Date => {
      return new Date(clock);
    },
    sleep: async (milliseconds: number): Promise<void> => {
      clock += milliseconds;
    },
  });

  jest
    .spyOn(SecurityBlockCloudWafService, "findOneBy")
    .mockImplementation((async (
      args: unknown,
    ): Promise<SecurityBlockCloudWaf | null> => {
      const query: JSONObject = (args as { query: JSONObject }).query;
      const row: SecurityBlockCloudWaf | undefined = Array.from(
        rows.values(),
      ).find((candidate: SecurityBlockCloudWaf): boolean => {
        return (
          sameId(candidate._id, query["_id"]) &&
          sameId(candidate.projectId, query["projectId"])
        );
      });

      return row ? Object.assign(new SecurityBlockCloudWaf(), row) : null;
    }) as never);

  jest
    .spyOn(SecurityBlockCloudWafService, "findForProject")
    .mockImplementation((async (): Promise<Array<SecurityBlockCloudWaf>> => {
      return Array.from(rows.values()).map(
        (row: SecurityBlockCloudWaf): SecurityBlockCloudWaf => {
          return Object.assign(new SecurityBlockCloudWaf(), row);
        },
      );
    }) as never);

  jest
    .spyOn(SecurityBlockCloudWafService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<void> => {
      const data: { id: ObjectID; data: JSONObject } = args as {
        id: ObjectID;
        data: JSONObject;
      };
      const row: SecurityBlockCloudWaf | undefined = rows.get(
        data.id.toString(),
      );

      if (row) {
        Object.assign(row, data.data);
      }
    }) as never);

  jest
    .spyOn(SecurityBlockCloudWafService, "deleteOneBy")
    .mockImplementation((async (args: unknown): Promise<void> => {
      const id: string = String(
        (args as { query: JSONObject }).query["_id"],
      ).toLowerCase();

      rows.delete(id);
      deleted.push(id);
    }) as never);

  jest.spyOn(CloudConnectionService, "findOneBy").mockImplementation((async (
    args: unknown,
  ): Promise<CloudConnection | null> => {
    const query: JSONObject = (args as { query: JSONObject }).query;

    if (
      !sameId(query["_id"], CONNECTION_ID) ||
      !sameId(query["projectId"], PROJECT_ID)
    ) {
      return null;
    }

    const connection: CloudConnection = new CloudConnection();
    connection._id = CONNECTION_ID.toString();
    connection.projectId = PROJECT_ID;
    connection.provider = CloudProvider.AWS;
    connection.config = { wafBlocklist };

    return connection;
  }) as never);

  jest
    .spyOn(CloudConnectionService, "getConnectorSettings")
    .mockImplementation((async (): Promise<CloudConnectionSettings> => {
      return {
        provider: CloudProvider.AWS,
        projectId: PROJECT_ID.toString(),
        config: {
          authMethod: CloudConnectionAuthMethod.AwsAccessKey,
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          wafBlocklist,
        },
        secrets: {
          secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        },
      };
    }) as never);

  reconcile = jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockResolvedValue(undefined) as unknown as ReturnType<typeof jest.fn>;
});

afterEach(() => {
  AwsWafBlockDestinationSource.setCallOptionsForTests(undefined);
  jest.restoreAllMocks();
});

describe("Check Again - and the check as soon as a web ACL is picked", () => {
  test("OneUptime adds its rule: its four IP sets made, its two rules placed below the team's first, and the web ACL recorded as enforcing with the sets' ARNs", async () => {
    const { row } = picked({
      index: 1,
      name: "prod-alb",
      rules: [customerRule("geo", 10)],
    });

    const checked: SecurityBlockCloudWaf = await check(row);

    expect(checked.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(
      SETS.map((set: { key: string }): Array<string> | undefined => {
        return ipSet(set.key)?.addresses;
      }),
    ).toEqual([[], [], [], []]);
    expect(rulesOf("prod-alb")).toEqual([
      ["geo", 10],
      [RULES.block, 8],
      [RULES.challenge, 9],
    ]);

    const now: SecurityBlockCloudWaf = stored(row)!;
    const details: JSONObject = now.ruleDetails as JSONObject;

    expect(now.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    // When the check ended: its writes to AWS are a second apart.
    expect(now.checkedAt).toEqual(new Date(clock));
    expect(clock).toBeGreaterThan(NOW.getTime());
    expect(details["addsRule"]).toBe(true);
    expect(details["setArns"]).toEqual(
      Object.fromEntries(
        SETS.map((set: { key: string }): [string, string] => {
          return [set.key, ipSet(set.key)!.arn];
        }),
      ),
    );
    expect(details["priorities"]).toEqual({ block: 8, challenge: 9 });

    // Its blocks reach the sets at once.
    expect(reconcile).toHaveBeenCalledWith(PROJECT_ID);
    // Under the lock a pass takes for these sets.
    expect(locks.eventsOf("lock")).toEqual([
      `lock:${SECURITY_BLOCKLIST_LOCK_NAMESPACE}/${LOCK_KEY}`,
    ]);
    expect(locks.eventsOf("release")).toHaveLength(1);
  });

  test("checked again with nothing changed, it writes nothing at AWS", async () => {
    const { row } = picked({ index: 1, name: "prod-alb" });

    await check(row);

    const writes: number =
      writesOf("CreateIPSet") +
      writesOf("UpdateIPSet") +
      writesOf("UpdateWebACL");

    await check(row);

    expect(
      writesOf("CreateIPSet") +
        writesOf("UpdateIPSet") +
        writesOf("UpdateWebACL"),
    ).toBe(writes);
    expect(stored(row)!.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
  });

  test("a web ACL kept in code: the four sets made, nothing written to the web ACL, and its rule waited for, naming the sets - then enforcing once its team's rule is there", async () => {
    wafBlocklist = "code";
    const { acl, row } = picked({ index: 1, name: "prod-alb" });

    const checked: SecurityBlockCloudWaf = await check(row);

    expect(checked.status).toBe(SecurityBlockCloudWafStatus.WaitingForRule);
    expect(checked.statusMessage).toBe(
      `prod-alb has no rule that blocks ${SETS.map((set: { name: string }) => {
        return set.name;
      }).join(", ")} yet. Add OneUptime's rule to it, as its Rule tab shows.`,
    );
    expect(writesOf("UpdateWebACL")).toBe(0);

    // The Rule tab's Terraform names every set by its ARN.
    const details: JSONObject = stored(row)!.ruleDetails as JSONObject;

    expect(details["addsRule"]).toBe(false);
    expect(Object.keys(details["setArns"] as JSONObject).sort()).toEqual(
      SETS.map((set: { key: string }): string => {
        return set.key;
      }).sort(),
    );

    bumpWebAcl(acl, teamRules());

    expect((await check(row)).status).toBe(
      SecurityBlockCloudWafStatus.Enforcing,
    );
    expect(writesOf("UpdateWebACL")).toBe(0);
  });

  test("what AWS refuses is the web ACL's status, not an error: a connection whose role may not write web ACLs says how to let it", async () => {
    const { row } = picked({ index: 1, name: "prod-alb" });

    fake.failNext("UpdateWebACL", WAF_ERRORS.denied("wafv2:UpdateWebACL"));

    const checked: SecurityBlockCloudWaf = await check(row);

    expect(checked.status).toBe(SecurityBlockCloudWafStatus.Failed);
    expect(checked.statusMessage).toBe(
      'OneUptime could not add its rules to prod-alb: AWS refused wafv2:UpdateWebACL on web ACL prod-alb: the access key may not call it. Pick "On, and OneUptime adds its rule" under Block addresses in AWS WAF for the connection and run its setup command again, or add the rule to the web ACL in code.',
    );
    expect(stored(row)!.status).toBe(SecurityBlockCloudWafStatus.Failed);
  });

  test("a web ACL with no free priority below its first rule says so, and no rule of the team's is renumbered", async () => {
    const { row } = picked({
      index: 1,
      name: "prod-alb",
      rules: [customerRule("first", 0)],
    });

    const checked: SecurityBlockCloudWaf = await check(row);

    expect(checked.status).toBe(SecurityBlockCloudWafStatus.NoFreePriority);
    expect(checked.statusMessage).toBe(
      "prod-alb has no free priority below its first rule (priority 0) for OneUptime's two rules, and OneUptime never renumbers your rules. Free two priorities below it, and OneUptime adds them there.",
    );
    expect(rulesOf("prod-alb")).toEqual([["first", 0]]);
  });

  test("while a pass holds the sets' lock longer than a check waits, it says to try again, and nothing is written", async () => {
    const { row } = picked({ index: 1, name: "prod-alb" });

    locks.busy.add(LOCK_KEY);

    await expect(check(row)).rejects.toThrow(
      new BadDataException(
        "OneUptime is writing these IP sets right now. Try again in a minute.",
      ),
    );
    expect(fake.calls).toHaveLength(0);
    expect(stored(row)!.checkedAt).toBeUndefined();
    expect(reconcile).not.toHaveBeenCalled();
  });

  test("a web ACL no longer picked - or another project's - is said to be gone", async () => {
    const { row } = picked({ index: 1, name: "prod-alb" });

    await expect(
      SecurityBlockCloudWafs.check({
        projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        cloudWafId: new ObjectID(row._id!),
      }),
    ).rejects.toThrow("This web ACL no longer enforces your blocklist.");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("Remove", () => {
  test("takes OneUptime's rules out - the team's stay - empties and deletes its sets, then the web ACL", async () => {
    const { row } = picked({
      index: 1,
      name: "prod-alb",
      rules: [customerRule("geo", 10)],
    });

    await check(row);
    bumpIpSet(ipSet("block-ipv4")!, ["35.205.11.131/32"]);
    reconcile.mockClear();

    const removal: { leftInCloud: Array<SecurityBlockCloudWafLeftItem> } =
      await remove(row);

    expect(removal).toEqual({ leftInCloud: [] });
    expect(rulesOf("prod-alb")).toEqual([["geo", 10]]);
    expect(
      SETS.map((set: { key: string }): FakeWafIpSet | undefined => {
        return ipSet(set.key);
      }),
    ).toEqual([undefined, undefined, undefined, undefined]);
    expect(stored(row)).toBeUndefined();
    expect(deleted).toEqual([row._id]);
    expect(reconcile).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("another web ACL of the Region still uses the sets: only this one's rules come out", async () => {
    const prod: { row: SecurityBlockCloudWaf } = picked({
      index: 1,
      name: "prod-alb",
    });
    picked({ index: 2, name: "api-alb" });

    await check(prod.row);
    await check(
      rows.get(`cccccccc-cccc-4ccc-8ccc-${String(2).padStart(12, "0")}`)!,
    );
    bumpIpSet(ipSet("block-ipv4")!, ["35.205.11.131/32"]);

    expect(await remove(prod.row)).toEqual({ leftInCloud: [] });

    expect(rulesOf("prod-alb")).toEqual([]);
    expect(rulesOf("api-alb")).toEqual([
      [RULES.block, 0],
      [RULES.challenge, 1],
    ]);
    expect(ipSet("block-ipv4")!.addresses).toEqual(["35.205.11.131/32"]);
    expect(writesOf("DeleteIPSet")).toBe(0);
  });

  test("a web ACL kept in code, whose team's rule still references the sets: they are emptied - blocking nothing - and named as left, for the team to delete", async () => {
    wafBlocklist = "code";
    const { acl, row } = picked({ index: 1, name: "prod-alb" });

    await check(row);
    bumpWebAcl(acl, teamRules());
    bumpIpSet(ipSet("block-ipv4")!, ["35.205.11.131/32"]);

    const removal: { leftInCloud: Array<SecurityBlockCloudWafLeftItem> } =
      await remove(row);

    expect(removal.leftInCloud).toEqual(
      SETS.map((set: { name: string }): SecurityBlockCloudWafLeftItem => {
        return { kind: SecurityBlockCloudWafLeftKind.IpSet, name: set.name };
      }),
    );
    expect(
      SETS.map((set: { key: string }): Array<string> | undefined => {
        return ipSet(set.key)?.addresses;
      }),
    ).toEqual([[], [], [], []]);
    // The team's rules are theirs: OneUptime never writes the web ACL.
    expect(writesOf("UpdateWebACL")).toBe(0);
    expect(rulesOf("prod-alb")).toEqual([
      ["oneuptime-blocklist", 0],
      ["oneuptime-challenge", 1],
    ]);
    expect(stored(row)).toBeUndefined();
  });

  test("when AWS refuses, nothing is removed - not the row, not a set - and it says what to do", async () => {
    const { row } = picked({ index: 1, name: "prod-alb" });

    await check(row);
    bumpIpSet(ipSet("block-ipv4")!, ["35.205.11.131/32"]);
    fake.failNext("UpdateWebACL", WAF_ERRORS.denied("wafv2:UpdateWebACL"));
    reconcile.mockClear();

    await expect(remove(row)).rejects.toThrow(
      new BadDataException(
        'OneUptime could not take its rule and IP sets out of prod-alb: AWS refused wafv2:UpdateWebACL on web ACL prod-alb: the access key may not call it. Pick "On, and OneUptime adds its rule" under Block addresses in AWS WAF for the connection and run its setup command again, or add the rule to the web ACL in code. Try again, or remove it from OneUptime only and delete them in AWS WAF yourself.',
      ),
    );
    expect(stored(row)).toBeDefined();
    expect(ipSet("block-ipv4")!.addresses).toEqual(["35.205.11.131/32"]);
    expect(rulesOf("prod-alb")).toEqual([
      [RULES.block, 0],
      [RULES.challenge, 1],
    ]);
    expect(reconcile).not.toHaveBeenCalled();
  });

  test("from OneUptime only: nothing at AWS is touched, and what stays there - still blocking what its sets hold - is named", async () => {
    const { row } = picked({ index: 1, name: "prod-alb" });

    await check(row);

    const calls: number = fake.calls.length;
    const removal: { leftInCloud: Array<SecurityBlockCloudWafLeftItem> } =
      await remove(row, true);

    expect(fake.calls).toHaveLength(calls);
    expect(removal.leftInCloud).toEqual([
      {
        kind: SecurityBlockCloudWafLeftKind.Rule,
        name: RULES.block,
        webAcl: "prod-alb",
      },
      {
        kind: SecurityBlockCloudWafLeftKind.Rule,
        name: RULES.challenge,
        webAcl: "prod-alb",
      },
      ...SETS.map((set: { name: string }): SecurityBlockCloudWafLeftItem => {
        return { kind: SecurityBlockCloudWafLeftKind.IpSet, name: set.name };
      }),
    ]);
    expect(stored(row)).toBeUndefined();
    expect(rulesOf("prod-alb")).toHaveLength(2);
  });

  test("from OneUptime only, while another web ACL of the Region uses the sets: only its rules are named, never the sets the other still needs", async () => {
    const { row } = picked({ index: 1, name: "prod-alb" });
    const other: { row: SecurityBlockCloudWaf } = picked({
      index: 2,
      name: "api-alb",
    });

    await check(row);
    await check(other.row);

    const removal: { leftInCloud: Array<SecurityBlockCloudWafLeftItem> } =
      await remove(row, true);

    expect(
      removal.leftInCloud.map((item: SecurityBlockCloudWafLeftItem): string => {
        return item.kind;
      }),
    ).toEqual([
      SecurityBlockCloudWafLeftKind.Rule,
      SecurityBlockCloudWafLeftKind.Rule,
    ]);
  });

  test("while a pass holds the sets' lock longer than a removal waits, it says to try again, and nothing is removed", async () => {
    const { row } = picked({ index: 1, name: "prod-alb" });

    await check(row);
    locks.busy.add(LOCK_KEY);

    await expect(remove(row)).rejects.toThrow(
      "OneUptime is writing these IP sets right now. Try again in a minute.",
    );
    expect(stored(row)).toBeDefined();
    expect(rulesOf("prod-alb")).toHaveLength(2);
  });
});
