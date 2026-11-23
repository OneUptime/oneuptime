import DataSecurityIssueGrouper from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGrouper";
import DataSecurityIssueGroupFix, {
  CLOUD_FIX_REFUSED_MESSAGE,
  GROUP_FIX_CHANGED_MESSAGE,
  GROUP_FIX_NOTHING_TO_DO_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  GROUP_PULL_REQUEST_REFUSED_MESSAGE,
  getWhatTheFixBreaks,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGroupFix";
import DataSecurityIssueGroups from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGroups";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { readDataSecurityIssueAnalysis } from "../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import {
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupFixResultJSON,
  DataSecurityIssueGroupLeftOutJSON,
  DataSecurityIssueGroupLeftOutReason,
  countIssueGroupFixStores,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import { DataSecurityResponseAction } from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  GroupFixCalls,
  GroupFixStubOptions,
  REPOSITORY_ID,
  installGroupFixStubs,
  personWith,
} from "./IssueGroupFixStubs";
import IssueGroupsWorld, {
  WorldGroup,
  WorldIssue,
  WorldStore,
  makeId,
} from "./IssueGroupsWorld";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ONE FIX FOR A GROUP OF ISSUES (#10370): what each part leaves out, and
 * why; who may make each part; and a press that no longer matches what was
 * shown.
 */

const ON: string = "44444444-4444-4444-8444-444444444441";
const OFF: string = "44444444-4444-4444-8444-444444444442";
const DISABLED: string = "44444444-4444-4444-8444-444444444443";
const GONE: string = "44444444-4444-4444-8444-444444444444";

let world: IssueGroupsWorld;
let calls: GroupFixCalls;

function setUp(options: GroupFixStubOptions = {}): void {
  world = new IssueGroupsWorld();
  world.install();
  calls = installGroupFixStubs({
    connections: [
      { id: ON },
      { id: OFF, response: "off" },
      { id: DISABLED, isEnabled: false },
    ],
    ...options,
  });
}

// What an analysis keeps when the fix takes away access the CDN still used last week.
function analysisThatBreaks(principal: string): JSONObject {
  return {
    verdict: "Real",
    language: "en",
    lines: {},
    facts: [
      {
        id: "G1",
        kind: "Grant",
        recordIds: [],
        principal,
        principalType: "Role",
        accessLevel: "Read",
        grantedVia: "Bucket policy",
        isPublic: true,
        isExternal: false,
        lastUsed: "Week",
        isRemovedByFix: true,
      },
    ],
  };
}

function bucket(
  name: string,
  store: Partial<WorldStore> = {},
  issue: Partial<WorldIssue> = {},
): { store: WorldStore; issue: WorldIssue } {
  return world.addStoreWithIssue(
    { name, cloudConnectionId: ON, ...store },
    { checkId: "public-read", severity: "Critical", riskScore: 90, ...issue },
  );
}

async function groupOne(): Promise<WorldGroup> {
  await DataSecurityIssueGrouper.groupProject({
    projectId: new ObjectID(world.projectId),
  });

  expect(world.groups).toHaveLength(1);

  return world.groups[0]!;
}

async function planFor(
  group: WorldGroup,
  props: DatabaseCommonInteractionProps,
): Promise<DataSecurityIssueGroupFixPlanJSON> {
  return await DataSecurityIssueGroupFix.plan({
    projectId: new ObjectID(world.projectId),
    groupId: group.id,
    props,
  });
}

function leftOutBy(
  plan: DataSecurityIssueGroupFixPlanJSON,
): Map<string, DataSecurityIssueGroupLeftOutJSON> {
  return new Map(
    plan.leftOut.map(
      (
        store: DataSecurityIssueGroupLeftOutJSON,
      ): [string, DataSecurityIssueGroupLeftOutJSON] => {
        return [store.name, store];
      },
    ),
  );
}

function admin(): DatabaseCommonInteractionProps {
  return personWith(world.projectId, [Permission.SecurityAdmin]);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the one approval leaves out, and why", () => {
  test("a store whose connection cannot change it, and one marked Public By Design", async () => {
    setUp();
    bucket("acme-exports-1");
    bucket("acme-exports-2");
    bucket("acme-exports-3", { isPublicByDesign: true });
    bucket("acme-exports-4", { cloudConnectionId: OFF });
    bucket("acme-exports-5", { cloudConnectionId: DISABLED });
    bucket("acme-exports-6", { cloudConnectionId: GONE });
    bucket("acme-exports-7", { cloudConnectionId: undefined });
    // A store whose kind takes no action for the check: fixed in its console.
    bucket("acme-exports-8", { kind: "AWS RDS Instance" });

    const plan: DataSecurityIssueGroupFixPlanJSON = await planFor(
      await groupOne(),
      admin(),
    );
    const leftOut: Map<string, DataSecurityIssueGroupLeftOutJSON> =
      leftOutBy(plan);

    expect(
      plan.cloud?.stores.map((store: { name: string }): string => {
        return store.name;
      }),
    ).toEqual(["acme-exports-1", "acme-exports-2"]);
    expect(leftOut.get("acme-exports-3")?.reason).toBe(
      DataSecurityIssueGroupLeftOutReason.PublicByDesign,
    );
    expect(leftOut.get("acme-exports-4")).toEqual(
      expect.objectContaining({
        reason: DataSecurityIssueGroupLeftOutReason.ResponseOff,
        cloudConnectionId: OFF,
      }),
    );
    expect(leftOut.get("acme-exports-5")?.reason).toBe(
      DataSecurityIssueGroupLeftOutReason.ConnectionGone,
    );
    expect(leftOut.get("acme-exports-6")?.reason).toBe(
      DataSecurityIssueGroupLeftOutReason.ConnectionGone,
    );
    expect(leftOut.get("acme-exports-7")?.reason).toBe(
      DataSecurityIssueGroupLeftOutReason.NotThroughACloud,
    );
    expect(leftOut.get("acme-exports-8")?.reason).toBe(
      DataSecurityIssueGroupLeftOutReason.NothingToRun,
    );
    // None of these can be ticked in.
    expect(
      plan.leftOut.some((store: DataSecurityIssueGroupLeftOutJSON) => {
        return store.canInclude;
      }),
    ).toBe(false);
  });

  test("Public By Design leaves a store out of closing an exposure only, never out of a protection", async () => {
    setUp();

    for (let index: number = 1; index <= 3; index++) {
      bucket(
        `acme-archive-${index}`,
        { isPublicByDesign: index === 1 },
        { checkId: "deleted-data-not-recoverable", severity: "High" },
      );
    }

    const plan: DataSecurityIssueGroupFixPlanJSON = await planFor(
      await groupOne(),
      admin(),
    );

    expect(plan.cloud?.action).toBe(
      DataSecurityResponseAction.TurnOnVersioning,
    );
    expect(plan.cloud?.stores).toHaveLength(3);
    expect(plan.leftOut).toEqual([]);
  });

  test("a store the fix would break waits for the person to tick it in, and is changed once ticked", async () => {
    setUp();
    bucket("acme-exports-1");
    bucket("acme-exports-2");
    const breaks: { store: WorldStore; issue: WorldIssue } = bucket(
      "acme-exports-3",
      {},
      { aiAnalysis: analysisThatBreaks("role/cdn-reader") },
    );

    const group: WorldGroup = await groupOne();
    const plan: DataSecurityIssueGroupFixPlanJSON = await planFor(
      group,
      admin(),
    );

    expect(leftOutBy(plan).get("acme-exports-3")).toEqual(
      expect.objectContaining({
        reason: DataSecurityIssueGroupLeftOutReason.FixWouldBreak,
        canInclude: true,
        breaks: ["role/cdn-reader"],
      }),
    );
    expect(countIssueGroupFixStores(plan)).toBe(2);
    expect(countIssueGroupFixStores(plan, [breaks.store.id])).toBe(3);

    const untouched: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: group.id,
        props: admin(),
      });

    expect(untouched.cloud?.changed).toBe(2);
    expect(untouched.leftOut).toBe(1);

    calls.responses = [];

    const ticked: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: group.id,
        props: admin(),
        includeDataStoreIds: [breaks.store.id],
      });

    expect(ticked.cloud?.changed).toBe(3);
    expect(ticked.leftOut).toBe(0);
    expect(
      calls.responses.map((response: { dataStoreId: string }): string => {
        return response.dataStoreId;
      }),
    ).toContain(breaks.store.id);
  });

  test("an approved proposal changes only the stores it listed, even one that joined the group since", async () => {
    setUp();
    const first: { store: WorldStore; issue: WorldIssue } =
      bucket("acme-exports-1");
    bucket("acme-exports-2");
    bucket("acme-exports-3");

    const result: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: (await groupOne()).id,
        props: admin(),
        onlyDataStoreIds: [first.store.id],
      });

    expect(result.cloud?.changed).toBe(1);
    expect(calls.responses).toEqual([
      {
        dataStoreId: first.store.id,
        action: DataSecurityResponseAction.BlockPublicAccess,
      },
    ]);
  });

  test("a store the cloud refuses says why, and stops no other", async () => {
    const failing: string = makeId();

    setUp({ failingStoreIds: [failing] });
    bucket("acme-exports-1");
    bucket("acme-exports-2", { id: failing });
    bucket("acme-exports-3");

    const result: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: (await groupOne()).id,
        props: admin(),
      });

    expect(result.cloud?.changed).toBe(2);
    expect(result.cloud?.failed).toEqual([
      {
        dataStoreId: failing,
        name: "acme-exports-2",
        message: "The cloud refused the change.",
      },
    ]);
  });
});

describe("who may make each part", () => {
  function mixedGroup(): void {
    // Four buckets of one stack: two declared as code, two made in its console.
    for (let index: number = 1; index <= 4; index++) {
      bucket(`media-${index}`, {
        cloudTags:
          index <= 2
            ? { stack: "media", "managed-by": "terraform" }
            : { stack: "media" },
      });
    }
  }

  test("someone who may read the issues sees both parts, each refused, and nothing changes", async () => {
    setUp();
    mixedGroup();

    const group: WorldGroup = await groupOne();
    const viewer: DatabaseCommonInteractionProps = personWith(world.projectId, [
      Permission.SecurityViewer,
    ]);
    const plan: DataSecurityIssueGroupFixPlanJSON = await planFor(
      group,
      viewer,
    );

    expect(plan.pullRequest?.stores).toHaveLength(2);
    expect(plan.pullRequest?.refusal).toBe(GROUP_PULL_REQUEST_REFUSED_MESSAGE);
    expect(plan.cloud?.stores).toHaveLength(2);
    expect(plan.cloud?.refusal).toBe(CLOUD_FIX_REFUSED_MESSAGE);

    const result: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: group.id,
        props: viewer,
        codeRepositoryId: REPOSITORY_ID,
      });

    expect(result.pullRequest).toEqual({
      message: GROUP_PULL_REQUEST_REFUSED_MESSAGE,
    });
    expect(result.cloud?.refusal).toBe(CLOUD_FIX_REFUSED_MESSAGE);
    expect(calls.queued).toHaveLength(0);
    expect(calls.responses).toHaveLength(0);
  });

  test("each part takes its own permission: editing stores runs the approval, not the pull request", async () => {
    setUp();
    mixedGroup();

    const group: WorldGroup = await groupOne();
    const storeEditor: DatabaseCommonInteractionProps = personWith(
      world.projectId,
      [Permission.EditDataStore, Permission.ReadDataSecurityIssue],
    );
    const result: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: group.id,
        props: storeEditor,
        codeRepositoryId: REPOSITORY_ID,
      });

    expect(result.pullRequest?.message).toBe(
      GROUP_PULL_REQUEST_REFUSED_MESSAGE,
    );
    expect(result.cloud?.changed).toBe(2);
    expect(calls.queued).toHaveLength(0);
    // Only the part that was made settles what OneUptime AI proposed for it.
    expect(calls.expired).toEqual([
      { groupId: group.id, kinds: ["FixIssueGroupInCloud"] },
    ]);
  });

  test("a permission held on some labels only reads no group, and makes no part", async () => {
    setUp();
    mixedGroup();

    const group: WorldGroup = await groupOne();
    const labelled: DatabaseCommonInteractionProps = personWith(
      world.projectId,
      [Permission.SecurityAdmin],
      [new ObjectID(makeId())],
    );

    expect(DataSecurityIssueGroups.canRead(labelled)).toBe(false);
    expect(
      (
        await DataSecurityIssueGroups.list({
          projectId: new ObjectID(world.projectId),
          props: labelled,
        })
      ).groups,
    ).toEqual([]);

    const plan: DataSecurityIssueGroupFixPlanJSON = await planFor(
      group,
      labelled,
    );

    expect(plan.pullRequest?.refusal).toBe(GROUP_PULL_REQUEST_REFUSED_MESSAGE);
    expect(plan.cloud?.refusal).toBe(CLOUD_FIX_REFUSED_MESSAGE);
  });

  test("the pull request is refused while the server has Code switched off, or its gate says why", async () => {
    setUp({ isCodeOff: true });
    mixedGroup();

    let plan: DataSecurityIssueGroupFixPlanJSON = await planFor(
      await groupOne(),
      admin(),
    );

    expect(plan.pullRequest?.refusal).toBeTruthy();
    expect(plan.pullRequest?.refusal).not.toBe(
      GROUP_PULL_REQUEST_REFUSED_MESSAGE,
    );
    expect(plan.cloud?.refusal).toBeUndefined();

    jest.restoreAllMocks();
    setUp({ gateRefusal: "Turn on AI for this project first." });
    mixedGroup();
    plan = await planFor(await groupOne(), admin());

    expect(plan.pullRequest?.refusal).toBe(
      "Turn on AI for this project first.",
    );
  });
});

describe("a press that no longer matches", () => {
  test("is refused when the group changed since its plan was shown", async () => {
    setUp();
    bucket("acme-exports-1");
    bucket("acme-exports-2");
    const third: { store: WorldStore; issue: WorldIssue } =
      bucket("acme-exports-3");

    const group: WorldGroup = await groupOne();
    const plan: DataSecurityIssueGroupFixPlanJSON = await planFor(
      group,
      admin(),
    );

    world.resolve(third.issue);

    await expect(
      DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: group.id,
        props: admin(),
        expectedPlanFingerprint: plan.planFingerprint,
      }),
    ).rejects.toThrow(GROUP_FIX_CHANGED_MESSAGE);
    expect(calls.responses).toHaveLength(0);
  });

  test("a group of another project is not found, and a group nothing can fix says so", async () => {
    setUp();
    bucket("acme-exports-1", { cloudConnectionId: OFF });
    bucket("acme-exports-2", { cloudConnectionId: OFF });

    const group: WorldGroup = await groupOne();

    await expect(
      DataSecurityIssueGroupFix.plan({
        projectId: new ObjectID(makeId()),
        groupId: group.id,
        props: admin(),
      }),
    ).rejects.toThrow(GROUP_NOT_FOUND_MESSAGE);
    await expect(
      DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: group.id,
        props: admin(),
        parts: [DataSecurityIssueGroupFixPart.PullRequest],
      }),
    ).rejects.toThrow(GROUP_FIX_NOTHING_TO_DO_MESSAGE);
  });
});

describe("what the fix would break", () => {
  test("is read from the analysis's own facts: grants the fix removes, used lately", () => {
    expect(
      getWhatTheFixBreaks(
        readDataSecurityIssueAnalysis(analysisThatBreaks("role/cdn-reader")),
      ),
    ).toEqual(["role/cdn-reader"]);

    const unused: JSONObject = analysisThatBreaks("role/old-reader");

    ((unused["facts"] as Array<JSONObject>)[0] as JSONObject)["lastUsed"] =
      "Never";

    expect(getWhatTheFixBreaks(readDataSecurityIssueAnalysis(unused))).toEqual(
      [],
    );
    expect(getWhatTheFixBreaks(null)).toEqual([]);
  });
});
