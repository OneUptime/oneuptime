import { describe, expect, test } from "@jest/globals";
import CloudTagNotifier, {
  CLOUD_TAG_EMAIL_MAX_RESOURCES,
  CloudTagNotice,
  describeCloudTagMissing,
  describeCloudTagResource,
  getCloudTagEmailHtml,
  getCloudTagEmailSubject,
  getCloudTagPurposes,
} from "../../../../Server/Utils/CloudConnection/CloudTagNotifier";
import {
  CLOUD_TAG_CREATOR_WAIT_MINUTES,
  CLOUD_TAG_DIGEST_EVERY_MINUTES,
  isCloudTagDigestDue,
  isCloudTagFindingDue,
  readCloudTagWatchState,
} from "../../../../Server/Utils/CloudConnection/CloudTagWatcher";
import {
  getCloudTagRequiredTagsShown,
  startOfUtcWeek,
} from "../../../../Server/Utils/CloudConnection/CloudTagCoverageReader";
import URL from "../../../../Types/API/URL";
import { getCloudProviderLabel } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudRequiredTagRule,
  CloudTagProblem,
  CloudTagSuggestionSource,
} from "../../../../Types/Cloud/CloudRequiredTags";
import { getCloudResourceTypeDisplayName } from "../../../../Types/Cloud/CloudResourceCatalog";
import {
  CloudCreateCall,
  findCloudCreateCall,
  getCloudActorEmail,
  getCloudResourceLogIds,
  isCloudCreateOperation,
} from "../../../../Types/Cloud/CloudResourceCreator";
import { NO_BREAK_SPACE } from "../../../../Types/NoBreakSpaces";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE NEW-RESOURCE WATCHER'S PIECES (#11012), apart from the databases
 * (CloudTagWatcherPostgres runs it whole): who created a resource, from
 * its account's change log; when a finding may be told, and when the
 * hourly email is due; what the email says - every value escaped - and
 * what each tag is for; the alert's fingerprint; and which required tags
 * a page names to its reader.
 */

const ACCOUNT_ROW: string = "10000000-0000-4000-8000-0000000000b1";

function call(overrides: Partial<CloudCreateCall> = {}): CloudCreateCall {
  return {
    time: new Date("2026-11-20T10:00:00.000Z"),
    provider: "aws",
    operation: "ec2:RunInstances",
    actor: "AWSReservedSSO_Admin_0abc/alice@example.com",
    resourceIds: ["i-0abc123def4567890"],
    resourceRowId: null,
    failed: false,
    ...overrides,
  };
}

function notice(overrides: Partial<CloudTagNotice> = {}): CloudTagNotice {
  return {
    findingId: new ObjectID("10000000-0000-4000-8000-0000000000f1"),
    resourceId: new ObjectID("10000000-0000-4000-8000-0000000000c1"),
    resourceName: "web-4",
    provider: "aws",
    type: "AWS::EC2::Instance",
    accountRowId: new ObjectID(ACCOUNT_ROW),
    accountName: "prod",
    creatorActor: "alice@example.com",
    creatorUserId: null,
    missing: [{ key: "team", problem: CloudTagProblem.Missing }],
    declaredCode: null,
    ...overrides,
  };
}

describe("a create call, as each cloud's log names it", () => {
  test.each([
    ["aws", "ec2:RunInstances", true],
    ["aws", "rds:CreateDBInstance", true],
    ["aws", "ec2:AllocateAddress", true],
    ["aws", "LaunchInstances", true],
    ["aws", "ec2:ModifyInstanceAttribute", false],
    ["aws", "ec2:DeleteVolume", false],
    // Tagging is no creation, though AWS names it as one.
    ["aws", "ec2:CreateTags", false],
    ["aws", "autoscaling:CreateOrUpdateTags", false],
    ["azure", "Microsoft.Compute/virtualMachines/write", true],
    ["azure", "Microsoft.Compute/virtualMachines/delete", false],
    ["azure", "Microsoft.Resources/tags/write", false],
    ["gcp", "v1.compute.instances.insert", true],
    ["gcp", "storage.buckets.create", true],
    ["gcp", "google.container.v1.ClusterManager.CreateCluster", true],
    ["gcp", "v1.compute.instances.setLabels", false],
    ["openstack", "compute.instance.create", false],
    ["aws", "", false],
  ])("%s %s: %s", (provider: string, operation: string, creates: boolean) => {
    expect(isCloudCreateOperation(provider, operation)).toBe(creates);
  });
});

describe("the person a caller is", () => {
  test("the last email address the caller carries, in lower case", () => {
    expect(
      getCloudActorEmail("AWSReservedSSO_Admin_0abc/Alice@Example.com"),
    ).toBe("alice@example.com");
    expect(getCloudActorEmail("bob@corp.example.org")).toBe(
      "bob@corp.example.org",
    );
    expect(
      getCloudActorEmail("assumed-role/old@example.com/new@example.com"),
    ).toBe("new@example.com");
  });

  test("never a name alone, which anyone can give a session, nor a service account", () => {
    expect(getCloudActorEmail("deploy-bot")).toBeNull();
    expect(getCloudActorEmail("AWSReservedSSO_Admin_0abc/alice")).toBeNull();
    expect(
      getCloudActorEmail("ci@shop-prod.iam.gserviceaccount.com"),
    ).toBeNull();
    expect(
      getCloudActorEmail("123456789@cloudservices.gserviceaccount.com"),
    ).toBeNull();
    expect(getCloudActorEmail(null)).toBeNull();
  });
});

describe("the call that created a resource", () => {
  test("the earliest create call that names it, by any of its names or by its row", () => {
    const calls: Array<CloudCreateCall> = [
      call({
        time: new Date("2026-11-20T11:00:00.000Z"),
        actor: "later@example.com",
      }),
      call({ actor: "first@example.com" }),
      call({
        time: new Date("2026-11-20T09:00:00.000Z"),
        operation: "ec2:CreateTags",
        actor: "tagger@example.com",
        resourceIds: ["i-0abc123def4567890"],
      }),
    ];

    expect(
      findCloudCreateCall({
        calls,
        resourceRowId: "row-1",
        resourceIds: [" I-0ABC123DEF4567890 "],
      })?.actor,
    ).toBe("first@example.com");

    expect(
      findCloudCreateCall({
        calls: [call({ resourceIds: [], resourceRowId: "row-1" })],
        resourceRowId: "row-1",
        resourceIds: [],
      }),
    ).not.toBeNull();
  });

  test("a call that failed, or that does not create, created nothing", () => {
    expect(
      findCloudCreateCall({
        calls: [
          call({ failed: true }),
          call({ operation: "ec2:StopInstances" }),
        ],
        resourceRowId: "row-1",
        resourceIds: ["i-0abc123def4567890"],
      }),
    ).toBeNull();
  });

  test("the names each cloud's log gives a resource", () => {
    expect(
      getCloudResourceLogIds(
        "aws",
        "arn:aws:ec2:eu-west-1:123456789012:instance/i-0ABC",
      ),
    ).toEqual(["arn:aws:ec2:eu-west-1:123456789012:instance/i-0abc", "i-0abc"]);
    expect(getCloudResourceLogIds("aws", "arn:aws:s3:::my-bucket")).toEqual([
      "arn:aws:s3:::my-bucket",
      "my-bucket",
    ]);
    expect(
      getCloudResourceLogIds(
        "gcp",
        "//compute.googleapis.com/projects/p/zones/z/instances/web-1",
      ),
    ).toEqual([
      "//compute.googleapis.com/projects/p/zones/z/instances/web-1",
      "projects/p/zones/z/instances/web-1",
    ]);
    // Azure's log names its whole ARM id: a name alone is many resources'.
    expect(
      getCloudResourceLogIds(
        "azure",
        "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/web-1",
      ),
    ).toEqual([
      "/subscriptions/s/resourcegroups/rg/providers/microsoft.compute/virtualmachines/web-1",
    ]);
    expect(getCloudResourceLogIds("aws", "  ")).toEqual([]);
  });
});

describe("when the watcher tells", () => {
  const NOW: Date = new Date("2026-11-20T12:00:00.000Z");

  test(`a finding once its creator is known, or after ${CLOUD_TAG_CREATOR_WAIT_MINUTES} minutes waiting for the change log`, () => {
    expect(
      isCloudTagFindingDue({
        creatorActor: "alice@example.com",
        foundAt: NOW,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isCloudTagFindingDue({
        creatorActor: null,
        foundAt: new Date(NOW.getTime() - 10 * 60 * 1000),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isCloudTagFindingDue({
        creatorActor: null,
        foundAt: new Date(
          NOW.getTime() - CLOUD_TAG_CREATOR_WAIT_MINUTES * 60 * 1000,
        ),
        now: NOW,
      }),
    ).toBe(true);
  });

  test(`the email every ${CLOUD_TAG_DIGEST_EVERY_MINUTES} minutes, a run of the 15-minute job early being on time`, () => {
    expect(isCloudTagDigestDue({ lastDigestAt: undefined, now: NOW })).toBe(
      true,
    );
    expect(
      isCloudTagDigestDue({
        lastDigestAt: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isCloudTagDigestDue({
        lastDigestAt: new Date(NOW.getTime() - 56 * 60 * 1000).toISOString(),
        now: NOW,
      }),
    ).toBe(true);
    expect(isCloudTagDigestDue({ lastDigestAt: "garbage", now: NOW })).toBe(
      true,
    );
  });

  test("what the watcher kept is read back with care", () => {
    expect(
      readCloudTagWatchState({
        accounts: { a: "2026-11-19T00:00:00.000Z", b: "not a date", c: 3 },
        lastDigestAt: "2026-11-20T11:00:00.000Z",
        lastCountedDay: "2026-11-19",
      }),
    ).toEqual({
      accounts: { a: "2026-11-19T00:00:00.000Z" },
      lastDigestAt: "2026-11-20T11:00:00.000Z",
      lastCountedDay: "2026-11-19",
    });
    expect(readCloudTagWatchState(null)).toEqual({ accounts: {} });
    expect(readCloudTagWatchState(["x"])).toEqual({ accounts: {} });
  });
});

describe("what the email says", () => {
  test("a resource in a line, its type and account named; what it lacks, with the suggested value and where it came from", () => {
    expect(describeCloudTagResource(notice())).toBe(
      `web-4 (${
        getCloudResourceTypeDisplayName("aws", "AWS::EC2::Instance") ||
        "AWS::EC2::Instance"
      }, ${getCloudProviderLabel("aws")} account prod)`,
    );
    expect(describeCloudTagResource(notice({ accountName: "" }))).toContain(
      `, ${getCloudProviderLabel("aws")})`,
    );

    expect(
      describeCloudTagMissing([
        {
          key: "team",
          problem: CloudTagProblem.Missing,
          suggestion: {
            key: "team",
            value: "payments",
            source: CloudTagSuggestionSource.OwnerTeam,
            detail: "Payments",
          },
        },
        { key: "env", problem: CloudTagProblem.NotAllowed, value: "qa" },
      ]),
    ).toBe(
      'team, suggested: payments (from its owner team, Payments); env (has "qa", which is not allowed)',
    );
  });

  test("its subject names the one resource, or how many", () => {
    expect(getCloudTagEmailSubject([notice()])).toBe(
      "A new cloud resource is missing required tags: web-4",
    );
    expect(getCloudTagEmailSubject([notice(), notice(), notice()])).toBe(
      `3${NO_BREAK_SPACE}new cloud resources are missing required tags`,
    );
  });

  test("every value it holds is escaped: a resource named to inject HTML is only text", () => {
    const html: string = getCloudTagEmailHtml({
      notices: [
        notice({
          resourceName: '<img src=x onerror="alert(1)">',
          creatorActor: "<b>mallory</b>",
          missing: [
            {
              key: "team",
              problem: CloudTagProblem.Missing,
              command:
                "aws resourcegroupstaggingapi tag-resources --tags 'team=<x>'",
            },
          ],
        }),
      ],
      tagsLink: URL.fromString(
        "https://oneuptime.example.com/dashboard/p/cloud/tags",
      ),
    });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>mallory");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<code>");
    expect(html).toContain(
      '<a href="https://oneuptime.example.com/dashboard/p/cloud/tags">',
    );
  });

  test("a resource declared in code says to tag the code, and gives no command that a deploy would undo", () => {
    const html: string = getCloudTagEmailHtml({
      notices: [
        notice({
          declaredCode: 'CloudFormation stack "web"',
          missing: [
            {
              key: "team",
              problem: CloudTagProblem.Missing,
              command: "aws resourcegroupstaggingapi tag-resources",
            },
          ],
        }),
      ],
      tagsLink: null,
    });

    expect(html).toContain("add the tags there");
    expect(html).not.toContain("<code>");
  });

  test(`it lists at most ${CLOUD_TAG_EMAIL_MAX_RESOURCES} resources, and says how many more`, () => {
    const many: Array<CloudTagNotice> = Array.from(
      { length: CLOUD_TAG_EMAIL_MAX_RESOURCES + 3 },
      (_value: unknown, index: number): CloudTagNotice => {
        return notice({ resourceName: `vm-${index}` });
      },
    );
    const html: string = getCloudTagEmailHtml({
      notices: many,
      tagsLink: null,
    });

    expect(html).toContain(`vm-${CLOUD_TAG_EMAIL_MAX_RESOURCES - 1}`);
    expect(html).not.toContain(`vm-${CLOUD_TAG_EMAIL_MAX_RESOURCES} `);
    expect(html).toContain(`And 3${NO_BREAK_SPACE}more.`);
  });

  test("what each tag the resources lack is for, as the resource's account requires it, once each", () => {
    const rules: Array<CloudRequiredTagRule> = [
      {
        id: "p",
        key: "team",
        allowedValues: [],
        cloudAccountId: null,
        description: "The team that pays for the resource.",
      },
      {
        id: "a",
        key: "Team",
        allowedValues: [],
        cloudAccountId: ACCOUNT_ROW,
        description: "Prod's paying team.",
      },
      { id: "e", key: "env", allowedValues: [], cloudAccountId: null },
    ];
    const missing: CloudTagNotice["missing"] = [
      { key: "team", problem: CloudTagProblem.Missing },
      { key: "env", problem: CloudTagProblem.Missing },
    ];

    expect(
      getCloudTagPurposes({
        notices: [
          notice({ missing }),
          notice({ missing }),
          notice({ missing, accountRowId: null }),
        ],
        rules,
      }),
    ).toEqual([
      "Team: Prod's paying team.",
      "team: The team that pays for the resource.",
    ]);

    const html: string = getCloudTagEmailHtml({
      notices: [notice({ missing })],
      tagsLink: null,
      rules,
    });
    expect(html).toContain("What the tags are for:");
    expect(html).toContain("Team: Prod&#39;s paying team.");
    expect(
      getCloudTagEmailHtml({ notices: [notice()], tagsLink: null }),
    ).not.toContain("What the tags are for:");
  });

  test("an account's alert is raised once an hour at most", () => {
    const now: Date = new Date("2026-11-20T12:34:56.000Z");

    expect(
      CloudTagNotifier.getAlertFingerprint({ accountRowId: ACCOUNT_ROW, now }),
    ).toBe(`cloud-required-tags:${ACCOUNT_ROW}:2026-11-20T12`);
    expect(
      CloudTagNotifier.getAlertFingerprint({
        accountRowId: ACCOUNT_ROW,
        now: new Date("2026-11-20T12:59:59.000Z"),
      }),
    ).toBe(
      CloudTagNotifier.getAlertFingerprint({ accountRowId: ACCOUNT_ROW, now }),
    );
  });
});

describe("the required tags a page names", () => {
  const rules: Array<CloudRequiredTagRule> = [
    {
      id: "a",
      key: "Team",
      allowedValues: ["platform"],
      cloudAccountId: "acc-a",
    },
    { id: "p", key: "team", allowedValues: ["payments"], cloudAccountId: null },
    { id: "b", key: "owner", allowedValues: [], cloudAccountId: "acc-b" },
  ];

  test("every account's: the project's first, then each readable account's own", () => {
    expect(
      getCloudTagRequiredTagsShown({
        rules,
        readableAccountIds: ["acc-a"],
        cloudAccountId: null,
      }),
    ).toEqual([
      { key: "team", allowedValues: ["payments"], cloudAccountId: null },
      { key: "Team", allowedValues: ["platform"], cloudAccountId: "acc-a" },
    ]);
  });

  test("one account's: its own replacing the project's; another reader's account names nothing", () => {
    expect(
      getCloudTagRequiredTagsShown({
        rules,
        readableAccountIds: ["ACC-A"],
        cloudAccountId: "acc-a",
      }),
    ).toEqual([
      { key: "Team", allowedValues: ["platform"], cloudAccountId: "acc-a" },
    ]);
    expect(
      getCloudTagRequiredTagsShown({
        rules,
        readableAccountIds: [],
        cloudAccountId: "acc-b",
      }),
    ).toEqual([]);
  });

  test("a week starts on its Monday, in UTC", () => {
    expect(
      startOfUtcWeek(new Date("2026-11-22T23:30:00.000Z")).toISOString(),
    ).toBe("2026-11-16T00:00:00.000Z");
    expect(
      startOfUtcWeek(new Date("2026-11-16T00:00:00.000Z")).toISOString(),
    ).toBe("2026-11-16T00:00:00.000Z");
    expect(
      startOfUtcWeek(new Date("2026-11-17T08:00:00.000Z")).toISOString(),
    ).toBe("2026-11-16T00:00:00.000Z");
  });
});
