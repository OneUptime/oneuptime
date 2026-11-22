import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../../Server/Services/CodeRepositoryService";
import DataSecurityIssueGroupService from "../../../../Server/Services/DataSecurityIssueGroupService";
import DataSecurityIssueGrouper, {
  CODE_LOOKUP_KEPT_FOR_IN_HOURS,
  IssueGroupingOutcome,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGrouper";
import DataSecurityStoreCreators from "../../../../Server/Utils/DataSecurity/DataSecurityStoreCreators";
import { ResolvableRepository } from "../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import {
  DataSecurityIssueGroupCause,
  DataSecurityIssueGroupFacts,
  readDataSecurityIssueGroupFacts,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroup";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import ObjectID from "../../../../Types/ObjectID";
import IssueGroupsWorld, {
  WorldGroup,
  WorldIssue,
  WorldStore,
} from "./IssueGroupsWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";

/*
 * GROUPING A PROJECT'S ISSUES BY WHAT MADE THEM (#10370), as the job after
 * each evaluation runs it: the groups the facts make, kept; each issue's
 * group written; a group that counts its issues as they resolve, says when
 * the last of them did, and goes once nothing holds it.
 */

const REPOSITORY: ResolvableRepository = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "infra",
  organizationName: "acme",
  repositoryName: "infra",
} as unknown as ResolvableRepository;

let world: IssueGroupsWorld;
let treeReads: number = 0;
let creators: Map<string, string> = new Map();

function moduleBuckets(
  count: number,
  module: string = "static-site",
): Array<{
  store: WorldStore;
  issue: WorldIssue;
}> {
  const made: Array<{ store: WorldStore; issue: WorldIssue }> = [];

  for (let index: number = 1; index <= count; index++) {
    made.push(
      world.addStoreWithIssue({
        name: `site-${index}-assets`,
        cloudTags: { module, "managed-by": "terraform" },
      }),
    );
  }

  return made;
}

async function run(now?: Date): Promise<IssueGroupingOutcome> {
  return await DataSecurityIssueGrouper.groupProject({
    projectId: new ObjectID(world.projectId),
    now,
  });
}

function factsOf(group: WorldGroup): DataSecurityIssueGroupFacts {
  return readDataSecurityIssueGroupFacts(group.facts)!;
}

beforeEach(() => {
  world = new IssueGroupsWorld();
  world.install();
  treeReads = 0;
  creators = new Map();

  jest
    .spyOn(DataSecurityStoreCreators, "read")
    .mockImplementation((async () => {
      return creators;
    }) as never);
  jest
    .spyOn(CodeRepositoryService, "getResolvableRepositories")
    .mockResolvedValue([REPOSITORY] as never);
  jest
    .spyOn(CodeRepositoryServiceClass, "getRepositoryTreePaths")
    .mockImplementation((async () => {
      treeReads++;
      return [
        "modules/static-site/main.tf",
        "modules/static-site/variables.tf",
        "modules/uploads/main.tf",
        "README.md",
      ];
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("forty buckets one module made", () => {
  test("are one group of the code that declares them, holding all forty issues", async () => {
    const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
      moduleBuckets(40);

    const outcome: IssueGroupingOutcome = await run();

    expect(outcome.created).toBe(1);
    expect(outcome.openGroups).toBe(1);
    expect(outcome.issuesMoved).toBe(40);
    expect(world.groups).toHaveLength(1);

    const group: WorldGroup = world.groups[0]!;

    expect(group.issueCount).toBe(40);
    expect(group.openIssueCount).toBe(40);
    expect(group.fixedAt).toBeNull();
    expect(group.checkId).toBe("access-not-logged");
    expect(group.cause).toBe(DataSecurityIssueGroupCause.DeclaredCode);
    expect(factsOf(group).code).toEqual({
      repositoryId: REPOSITORY.id,
      repositoryName: "acme/infra",
      paths: [
        "modules/static-site/main.tf",
        "modules/static-site/variables.tf",
      ],
      codeKind: "Terraform",
      reason: "has-named-file",
    });

    for (const bucket of buckets) {
      expect(world.groupOf(bucket.issue)?.id).toBe(group.id);
    }
  });

  test("a second run changes nothing, and reads no repository again for a day", async () => {
    moduleBuckets(5);

    await run();
    const readsAfterFirst: number = treeReads;
    const before: string = JSON.stringify(world.groups[0]!.facts);
    const second: IssueGroupingOutcome = await run();

    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.issuesMoved).toBe(0);
    expect(second.changedGroupIds).toEqual([]);
    expect(treeReads).toBe(readsAfterFirst);
    expect(JSON.stringify(world.groups[0]!.facts)).toBe(before);

    // A day later the code is looked up again.
    await run(
      new Date(
        Date.now() + (CODE_LOOKUP_KEPT_FOR_IN_HOURS + 1) * 60 * 60 * 1000,
      ),
    );

    expect(treeReads).toBeGreaterThan(readsAfterFirst);
  });

  test("with no repository connected, the group is of the module's tag", async () => {
    jest
      .spyOn(CodeRepositoryService, "getResolvableRepositories")
      .mockResolvedValue([] as never);
    moduleBuckets(3);

    await run();

    expect(world.groups[0]!.cause).toBe(DataSecurityIssueGroupCause.Tags);
    expect(factsOf(world.groups[0]!).code).toBeUndefined();
  });

  test("a repository that cannot be read leaves the group of its tag, and grouping goes on", async () => {
    jest
      .spyOn(CodeRepositoryServiceClass, "getRepositoryTreePaths")
      .mockRejectedValue(new Error("GitHub said no") as never);
    moduleBuckets(3);

    await run();

    expect(world.groups).toHaveLength(1);
    expect(world.groups[0]!.cause).toBe(DataSecurityIssueGroupCause.Tags);
  });
});

describe("twelve buckets one person made in the console", () => {
  test("are one group of the identity that created them", async () => {
    for (let index: number = 1; index <= 12; index++) {
      const made: { store: WorldStore; issue: WorldIssue } =
        world.addStoreWithIssue(
          { name: `bucket${index}x`, cloudResourceId: undefined },
          { checkId: "public-access-not-blocked" },
        );

      creators.set(made.store.id, "user/alice");
    }

    await run();

    expect(world.groups).toHaveLength(1);
    expect(world.groups[0]!.cause).toBe(DataSecurityIssueGroupCause.Creator);
    expect(factsOf(world.groups[0]!).creator).toBe("user/alice");
    expect(world.groups[0]!.issueCount).toBe(12);
  });

  test("the change log is asked only about stores whose tags name nothing that made them", async () => {
    moduleBuckets(2);
    const console: { store: WorldStore } = world.addStoreWithIssue({
      name: "loner",
    });

    await run();

    const asked: Array<string> = (
      (DataSecurityStoreCreators.read as unknown as Mock).mock.calls[0]![0] as {
        stores: Array<{ id: string }>;
      }
    ).stores.map((store: { id: string }): string => {
      return store.id;
    });

    expect(asked).toEqual([console.store.id]);
  });
});

describe("a group follows its issues to the end", () => {
  test("it counts its issues as they resolve, says when the last one did, and opens again", async () => {
    const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
      moduleBuckets(4);

    await run();

    world.resolve(buckets[0]!.issue);
    world.resolve(buckets[1]!.issue);
    await run();

    const group: WorldGroup = world.groups[0]!;

    expect(group.issueCount).toBe(4);
    expect(group.openIssueCount).toBe(2);
    expect(group.fixedAt).toBeNull();
    // A resolved issue keeps its group.
    expect(world.groupOf(buckets[0]!.issue)?.id).toBe(group.id);

    world.resolve(buckets[2]!.issue);
    world.resolve(buckets[3]!.issue);
    const fixedAt: Date = new Date("2026-11-22T10:00:00.000Z");

    await run(fixedAt);

    expect(world.groups[0]!.openIssueCount).toBe(0);
    expect(world.groups[0]!.fixedAt).toBe(fixedAt.toISOString());

    // The check fails again on one store.
    world.issueById(buckets[3]!.issue.id)!.status =
      DataSecurityIssueStatus.Open;
    await run();

    expect(world.groups[0]!.openIssueCount).toBe(1);
    expect(world.groups[0]!.fixedAt).toBeNull();
    expect(world.groupOf(buckets[3]!.issue)?.id).toBe(world.groups[0]!.id);
  });

  test("a new issue of the same cause joins the group", async () => {
    moduleBuckets(3);
    await run();
    const groupId: string = world.groups[0]!.id;

    const late: { issue: WorldIssue } = world.addStoreWithIssue({
      name: "site-late-assets",
      cloudTags: { module: "static-site", "managed-by": "terraform" },
    });

    const outcome: IssueGroupingOutcome = await run();

    expect(world.groupOf(late.issue)?.id).toBe(groupId);
    expect(world.groups[0]!.issueCount).toBe(4);
    expect(
      outcome.changedGroupIds.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    ).toEqual([groupId]);
  });

  test("an issue whose store no longer shares the group's fact leaves it, and a group nothing holds goes", async () => {
    const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
      moduleBuckets(2);

    await run();
    expect(world.groups).toHaveLength(1);

    // Its module tag was changed to one no other store has.
    world.stores.find((store: WorldStore): boolean => {
      return store.id === buckets[0]!.store.id;
    })!.cloudTags = { module: "uploads", "managed-by": "terraform" };

    const outcome: IssueGroupingOutcome = await run();

    expect(outcome.deleted).toBe(1);
    expect(world.groups).toHaveLength(0);
    expect(
      world.issueById(buckets[0]!.issue.id)!.dataSecurityIssueGroupId,
    ).toBeNull();
    expect(
      world.issueById(buckets[1]!.issue.id)!.dataSecurityIssueGroupId,
    ).toBeNull();
  });

  test("a group with a fix of its own stays, however few it holds", async () => {
    const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
      moduleBuckets(2);

    await run();
    world.groups[0]!.codeTaskId = "22222222-2222-4222-8222-222222222222";
    world.stores.find((store: WorldStore): boolean => {
      return store.id === buckets[0]!.store.id;
    })!.cloudTags = {};

    await run();

    expect(world.groups).toHaveLength(1);
    expect(world.membersOf(world.groups[0]!)).toHaveLength(1);
  });
});

describe("what is never grouped", () => {
  test("issues of checks whose cause differs store by store, and archived stores", async () => {
    for (let index: number = 1; index <= 3; index++) {
      world.addStoreWithIssue(
        { name: `t${index}`, cloudTags: { module: "site" } },
        { checkId: "sensitive-data-in-telemetry" },
      );
      world.addStoreWithIssue(
        { name: `o${index}`, cloudTags: { module: "site" } },
        { checkId: "no-owner" },
      );
      world.addStoreWithIssue(
        { name: `a${index}`, cloudTags: { module: "site" }, isArchived: true },
        { checkId: "access-not-logged" },
      );
    }

    await run();

    expect(world.groups).toEqual([]);
  });

  test("resolved, accepted and dismissed issues form no group", async () => {
    for (const status of [
      DataSecurityIssueStatus.Resolved,
      DataSecurityIssueStatus.Accepted,
      DataSecurityIssueStatus.NotAnIssue,
    ]) {
      world.addStoreWithIssue(
        { name: `s-${status}`, cloudTags: { module: "site" } },
        { status },
      );
    }

    await run();

    expect(world.groups).toEqual([]);
  });

  test("a failure says so and changes nothing", async () => {
    moduleBuckets(3);
    jest
      .spyOn(DataSecurityIssueGroupService, "findBy")
      .mockRejectedValue(new Error("the database is down") as never);

    const outcome: IssueGroupingOutcome = await run();

    expect(outcome.created).toBe(0);
    expect(world.groups).toEqual([]);
  });
});
