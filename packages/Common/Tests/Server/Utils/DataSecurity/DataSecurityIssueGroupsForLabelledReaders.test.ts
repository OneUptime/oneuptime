import AIRun from "../../../../Models/DatabaseModels/AIRun";
import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import AIService from "../../../../Server/Services/AIService";
import DataSecurityAiProposalService from "../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityFixTarget from "../../../../Server/Utils/AI/CodeFix/DataSecurityFixTarget";
import DataSecurityIssueGroupTimelines, {
  GroupProposalExpiry,
} from "../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueGroupTimelines";
import { QueryDataSecurityIssuesTool } from "../../../../Server/Utils/AI/Toolbox/DataSecurityTools";
import { ToolExecutionResult } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import DataSecurityIssueGrouper from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGrouper";
import DataSecurityIssueGroupFix, {
  CLOUD_FIX_REFUSED_MESSAGE,
  GROUP_FIX_HELD_READER_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  GROUP_PULL_REQUEST_REFUSED_MESSAGE,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGroupFix";
import DataSecurityIssueGroups, {
  IssueGroupReadScope,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGroups";
import { PlaybookStepOutcome } from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import SecurityPlaybookResponseSteps from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookResponseSteps";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityIssueGroupCause,
  DataSecurityIssueGroupJSON,
  DataSecurityIssueGroupsJSON,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroup";
import {
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupLeftOutJSON,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import { DataSecurityResponseAction } from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { DeclaredCodeChangeState } from "../../../../Utils/AiRemediation/DeclaredCodeChange";
import {
  GroupFixCalls,
  installGroupFixStubs,
  personWith,
} from "./IssueGroupFixStubs";
import IssueGroupsWorld, {
  WorldGroup,
  WorldIssue,
  WorldStore,
  makeId,
} from "./IssueGroupsWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * GROUPS OF ISSUES ONE MISTAKE MADE, FOR A READER HELD TO LABELS (#10739).
 *
 * One Terraform module, static-site, made five buckets: three for the
 * payments team (label Payments) and two for marketing (label Marketing),
 * in another region and account, with a tag that names the repository
 * their code is in. A reader whose read of Data Security issues is held to
 * Payments gets the group cut down to the payments stores - three issues,
 * one cause: the static-site module - and nothing about the marketing
 * stores reaches them, on any surface a group appears on: the Issues list,
 * the group's page and its Fix the Cause dialog, the routes, Ask AI's
 * tools, a case's playbook step, and the issues' timelines. Every name,
 * region, account, tag and repository of a marketing store is a needle no
 * answer may hold.
 */

const PAYMENTS: string = "aaaaaaaa-1111-4111-8111-111111111111";
const MARKETING: string = "bbbbbbbb-2222-4222-8222-222222222222";
const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
const TASK_ID: string = "cccccccc-3333-4333-8333-333333333333";

// What no answer to a Payments reader may hold: the marketing stores' every fact.
const MARKETING_NEEDLES: Array<string> = [
  "mkt-launch",
  "mkt-cdn",
  "eu-west-3",
  "999988887777",
  "campaigns",
  "acme/marketing-sites",
  "marketing",
];

let world: IssueGroupsWorld;
let calls: GroupFixCalls;

interface Fixture {
  site: Array<{ store: WorldStore; issue: WorldIssue }>;
  marketingSite: Array<{ store: WorldStore; issue: WorldIssue }>;
  cdn: Array<{ store: WorldStore; issue: WorldIssue }>;
  marketingCdn: { store: WorldStore; issue: WorldIssue };
  exports: Array<{ store: WorldStore; issue: WorldIssue }>;
  promo: Array<{ store: WorldStore; issue: WorldIssue }>;
  payPromo: { store: WorldStore; issue: WorldIssue };
}

function build(): Fixture {
  const site: Array<{ store: WorldStore; issue: WorldIssue }> = [1, 2, 3].map(
    (index: number) => {
      return world.addStoreWithIssue({
        name: `pay-site-${index}`,
        region: "us-east-1",
        cloudAccountNumber: "111122223333",
        cloudTags: {
          module: "static-site",
          "managed-by": "terraform",
          component: "checkout",
        },
        labelIds: [PAYMENTS],
      });
    },
  );
  const marketingSite: Array<{ store: WorldStore; issue: WorldIssue }> = [
    1, 2,
  ].map((index: number) => {
    return world.addStoreWithIssue({
      name: `mkt-launch-${index}`,
      region: "eu-west-3",
      cloudAccountNumber: "999988887777",
      cloudTags: {
        module: "static-site",
        "managed-by": "terraform",
        component: "campaigns",
        repository: "acme/marketing-sites",
      },
      labelIds: [MARKETING],
    });
  });
  // Made in the console, for a CDN: two of payments, one of marketing marked Public By Design.
  const cdn: Array<{ store: WorldStore; issue: WorldIssue }> = [1, 2].map(
    (index: number) => {
      return world.addStoreWithIssue(
        {
          name: `pay-cdn-${index}`,
          cloudConnectionId: CONNECTION_ID,
          cloudTags: { component: "cdn" },
          labelIds: [PAYMENTS],
        },
        { checkId: "public-read", severity: "Critical", riskScore: 95 },
      );
    },
  );
  const marketingCdn: { store: WorldStore; issue: WorldIssue } =
    world.addStoreWithIssue(
      {
        name: "mkt-cdn-3",
        region: "eu-west-3",
        cloudAccountNumber: "999988887777",
        cloudConnectionId: CONNECTION_ID,
        cloudTags: { component: "cdn" },
        isPublicByDesign: true,
        labelIds: [MARKETING],
      },
      { checkId: "public-read", severity: "Critical", riskScore: 95 },
    );
  // A group of payments' stores alone.
  const exports: Array<{ store: WorldStore; issue: WorldIssue }> = [1, 2].map(
    (index: number) => {
      return world.addStoreWithIssue(
        {
          name: `pay-exports-${index}`,
          cloudConnectionId: CONNECTION_ID,
          labelIds: [PAYMENTS],
        },
        { checkId: "object-acls-enabled", severity: "Low", riskScore: 20 },
      );
    },
  );
  // A group of which payments may read one issue only.
  const promo: Array<{ store: WorldStore; issue: WorldIssue }> = [1, 2].map(
    (index: number) => {
      return world.addStoreWithIssue(
        {
          name: `mkt-promo-${index}`,
          region: "eu-west-3",
          cloudAccountNumber: "999988887777",
          cloudTags: { stack: "promo" },
          labelIds: [MARKETING],
        },
        { checkId: "public-access-not-blocked", riskScore: 50 },
      );
    },
  );
  const payPromo: { store: WorldStore; issue: WorldIssue } =
    world.addStoreWithIssue(
      {
        name: "pay-promo-3",
        cloudTags: { stack: "promo" },
        labelIds: [PAYMENTS],
      },
      { checkId: "public-access-not-blocked", riskScore: 50 },
    );

  return { site, marketingSite, cdn, marketingCdn, exports, promo, payPromo };
}

function admin(): DatabaseCommonInteractionProps {
  return personWith(world.projectId, [Permission.SecurityAdmin]);
}

// A Security Viewer of the Payments stores only.
function payments(): DatabaseCommonInteractionProps {
  return personWith(
    world.projectId,
    [Permission.SecurityViewer],
    [new ObjectID(PAYMENTS)],
  );
}

function marketing(): DatabaseCommonInteractionProps {
  return personWith(
    world.projectId,
    [Permission.SecurityMember],
    [new ObjectID(MARKETING)],
  );
}

// Who may change issues and stores everywhere, but read the Payments issues only.
function paymentsEditor(): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = personWith(world.projectId, [
    Permission.EditDataSecurityIssue,
    Permission.EditDataStore,
  ]);

  props.userTenantAccessPermission![world.projectId]!.permissions.push({
    _type: "UserPermission",
    permission: Permission.ReadDataSecurityIssue,
    labelIds: [new ObjectID(PAYMENTS)],
    isBlockPermission: false,
  });

  return props;
}

function nobody(): DatabaseCommonInteractionProps {
  return personWith(world.projectId, [Permission.ReadMonitor]);
}

async function group(): Promise<void> {
  await DataSecurityIssueGrouper.groupProject({
    projectId: new ObjectID(world.projectId),
  });
}

// The group a store's issue is in.
function groupOf(entry: { issue: WorldIssue }): WorldGroup {
  const found: WorldGroup | undefined = world.groupOf(entry.issue);

  expect(found).toBeDefined();

  return found!;
}

async function listFor(
  props: DatabaseCommonInteractionProps,
  groupIds?: Array<string>,
): Promise<DataSecurityIssueGroupsJSON> {
  return await DataSecurityIssueGroups.list({
    projectId: new ObjectID(world.projectId),
    props,
    ...(groupIds ? { groupIds } : {}),
  });
}

function listed(
  answer: DataSecurityIssueGroupsJSON,
  groupId: string,
): DataSecurityIssueGroupJSON | undefined {
  return answer.groups.find((candidate: DataSecurityIssueGroupJSON) => {
    return candidate.groupId === groupId;
  });
}

function expectNoNeedle(said: unknown): void {
  const text: string = JSON.stringify(said ?? null).toLowerCase();

  for (const needle of MARKETING_NEEDLES) {
    expect(text).not.toContain(needle);
  }
}

// A pull request task that fixes these issues, as DataSecurityFixTarget reads it.
function taskFixing(issueIds: Array<string>): void {
  const task: AIRun = new AIRun();

  task.id = new ObjectID(TASK_ID);
  jest.spyOn(DataSecurityFixTarget, "readTask").mockResolvedValue(task as never);
  jest
    .spyOn(DataSecurityFixTarget, "issueIdsOfTask")
    .mockReturnValue(issueIds as never);
}

let fixture: Fixture;

beforeEach(async () => {
  world = new IssueGroupsWorld();
  world.install();
  calls = installGroupFixStubs({ connections: [{ id: CONNECTION_ID }] });
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true as never);
  fixture = build();
  await group();

  // OneUptime AI named the whole group from all its stores' facts.
  groupOf(fixture.site[0]!).name =
    "the static-site module turns off access logs in acme/marketing-sites";
  groupOf(fixture.exports[0]!).name = "pay exports keep object ACLs on";
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who reads which groups", () => {
  test("a reader of the whole project reads each group whole; one held to labels, as their stores make it; anyone else, none", () => {
    expect(DataSecurityIssueGroups.getReadScope(admin())).toBe(
      IssueGroupReadScope.Whole,
    );
    expect(DataSecurityIssueGroups.getReadScope({ isRoot: true })).toBe(
      IssueGroupReadScope.Whole,
    );
    expect(
      DataSecurityIssueGroups.getReadScope({
        ...nobody(),
        isMasterAdmin: true,
      }),
    ).toBe(IssueGroupReadScope.Whole);
    expect(DataSecurityIssueGroups.getReadScope(payments())).toBe(
      IssueGroupReadScope.Held,
    );
    expect(DataSecurityIssueGroups.getReadScope(paymentsEditor())).toBe(
      IssueGroupReadScope.Held,
    );
    expect(DataSecurityIssueGroups.getReadScope(nobody())).toBe(
      IssueGroupReadScope.None,
    );
    expect(DataSecurityIssueGroups.canRead(payments())).toBe(false);
    expect(DataSecurityIssueGroups.canReadAny(payments())).toBe(true);
    expect(DataSecurityIssueGroups.canReadAny(nobody())).toBe(false);
  });

  test("a reader of the whole project a block with labels takes stores away from is held too", () => {
    const blocked: DatabaseCommonInteractionProps = admin();

    blocked.userTenantAccessPermission![world.projectId]!.permissions.push({
      _type: "UserPermission",
      permission: Permission.SecurityAdmin,
      labelIds: [new ObjectID(MARKETING)],
      isBlockPermission: true,
    });

    expect(DataSecurityIssueGroups.getReadScope(blocked)).toBe(
      IssueGroupReadScope.Held,
    );
  });
});

describe("the Issues list", () => {
  test("a reader of the whole project gets the group whole: all five, its code, OneUptime AI's name", async () => {
    const whole: DataSecurityIssueGroupJSON | undefined = listed(
      await listFor(admin()),
      groupOf(fixture.site[0]!).id,
    );

    expect(whole).toEqual(
      expect.objectContaining({
        issueCount: 5,
        openIssueCount: 5,
        cause: DataSecurityIssueGroupCause.DeclaredCode,
        name: "the static-site module turns off access logs in acme/marketing-sites",
      }),
    );
    expect(whole?.facts.code?.repositoryName).toBe("acme/infra");
  });

  test("a reader held to Payments gets it cut down to their three stores, with the facts of those alone", async () => {
    const cut: DataSecurityIssueGroupJSON | undefined = listed(
      await listFor(payments()),
      groupOf(fixture.site[0]!).id,
    );

    expect(cut).toBeDefined();
    expect(cut!.issueCount).toBe(3);
    expect(cut!.openIssueCount).toBe(3);
    expect(cut!.fixedIssueCount).toBe(0);
    // The module, every store's fact: not the code the grouping found through all of them.
    expect(cut!.cause).toBe(DataSecurityIssueGroupCause.Tags);
    expect(cut!.facts.tag).toEqual(["module", "static-site"]);
    expect(cut!.facts.code).toBeUndefined();
    // What their stores all are: one region, one account, the checkout component.
    expect(cut!.facts.region).toBe("us-east-1");
    expect(cut!.facts.accountNumber).toBe("111122223333");
    expect(cut!.facts.tags).toContainEqual(["component", "checkout"]);
    // OneUptime AI's name describes the whole group: a cut-down group goes by its cause's words.
    expect(cut!.name).toBeUndefined();
    expectNoNeedle(cut);
  });

  test("nothing in the whole answer to Payments is of a marketing store", async () => {
    const answer: DataSecurityIssueGroupsJSON = await listFor(payments());

    expectNoNeedle(answer);
    expect(answer.groups).toHaveLength(3);
  });

  test("a group of payments' stores alone is theirs whole, with its name", async () => {
    const whole: DataSecurityIssueGroupJSON | undefined = listed(
      await listFor(payments()),
      groupOf(fixture.exports[0]!).id,
    );

    expect(whole).toEqual(
      expect.objectContaining({
        issueCount: 2,
        name: "pay exports keep object ACLs on",
      }),
    );
  });

  test("a group of which they may read one issue is none of theirs: a group of one would say there are others", async () => {
    const answer: DataSecurityIssueGroupsJSON = await listFor(payments());

    expect(listed(answer, groupOf(fixture.payPromo).id)).toBeUndefined();
    // Asked for by its id, as the list asks for a group a filter brought in.
    expect(
      (await listFor(payments(), [groupOf(fixture.payPromo).id])).groups,
    ).toEqual([]);
    // The whole project reads it.
    expect(
      listed(await listFor(admin()), groupOf(fixture.payPromo).id),
    ).toBeDefined();
  });

  test("their counts follow their own issues as they resolve, never a marketing one", async () => {
    world.resolve(fixture.site[0]!.issue);
    world.resolve(fixture.marketingSite[0]!.issue);
    await group();

    const cut: DataSecurityIssueGroupJSON | undefined = listed(
      await listFor(payments()),
      groupOf(fixture.site[0]!).id,
    );
    const whole: DataSecurityIssueGroupJSON | undefined = listed(
      await listFor(admin()),
      groupOf(fixture.site[0]!).id,
    );

    expect(cut).toEqual(
      expect.objectContaining({
        issueCount: 3,
        openIssueCount: 2,
        fixedIssueCount: 1,
      }),
    );
    expect(whole).toEqual(
      expect.objectContaining({
        issueCount: 5,
        openIssueCount: 3,
        fixedIssueCount: 2,
      }),
    );
  });

  test("Group by cause starts on by the largest group they read, not the whole project's", async () => {
    expect((await listFor(admin())).largestGroupSize).toBe(5);
    expect((await listFor(payments())).largestGroupSize).toBe(3);
  });

  test("a reader held to Marketing gets their own part, and nothing of payments'", async () => {
    const answer: DataSecurityIssueGroupsJSON = await listFor(marketing());
    const cut: DataSecurityIssueGroupJSON | undefined = listed(
      answer,
      groupOf(fixture.site[0]!).id,
    );

    expect(cut?.issueCount).toBe(2);
    expect(cut?.facts.region).toBe("eu-west-3");
    expect(JSON.stringify(answer)).not.toContain("pay-");
    expect(JSON.stringify(answer)).not.toContain("checkout");
    expect(JSON.stringify(answer)).not.toContain("111122223333");
  });

  test("someone who reads no Data Security issue gets no group", async () => {
    expect(await listFor(nobody())).toEqual({
      groups: [],
      largestGroupSize: 0,
    });
  });

  test("a cut-down group shows its pull request only when that pull request fixes one of their issues", async () => {
    groupOf(fixture.site[0]!).codeTaskId = TASK_ID;
    jest.spyOn(DataSecurityIssueGroupFix, "readFixState").mockResolvedValue({
      taskId: TASK_ID,
      state: DeclaredCodeChangeState.Opened,
      repositoryName: "acme/infra",
    } as never);

    // A pull request opened for the marketing stores alone.
    taskFixing(
      fixture.marketingSite.map((entry: { issue: WorldIssue }) => {
        return entry.issue.id;
      }),
    );

    expect(
      listed(await listFor(payments()), groupOf(fixture.site[0]!).id)?.fix,
    ).toBeUndefined();
    expect(
      listed(await listFor(admin()), groupOf(fixture.site[0]!).id)?.fix?.state,
    ).toBe(DeclaredCodeChangeState.Opened);

    // One that fixes a payments store too.
    taskFixing([fixture.site[1]!.issue.id, fixture.marketingSite[0]!.issue.id]);

    expect(
      listed(await listFor(payments()), groupOf(fixture.site[0]!).id)?.fix
        ?.state,
    ).toBe(DeclaredCodeChangeState.Opened);
  });
});

describe("an issue's own page", () => {
  test("points at the group as the reader reads it", async () => {
    const theirs: DataSecurityIssueGroupJSON | null =
      await DataSecurityIssueGroups.forIssue({
        projectId: new ObjectID(world.projectId),
        issueId: new ObjectID(fixture.site[0]!.issue.id),
        props: payments(),
      });

    expect(theirs?.issueCount).toBe(3);
    expect(theirs?.name).toBeUndefined();
    expectNoNeedle(theirs);
    expect(
      (
        await DataSecurityIssueGroups.forIssue({
          projectId: new ObjectID(world.projectId),
          issueId: new ObjectID(fixture.site[0]!.issue.id),
          props: admin(),
        })
      )?.issueCount,
    ).toBe(5);
  });

  test("points at nothing for an issue they may not read, or one whose group is not theirs", async () => {
    for (const issueId of [
      fixture.marketingSite[0]!.issue.id,
      fixture.payPromo.issue.id,
    ]) {
      expect(
        await DataSecurityIssueGroups.forIssue({
          projectId: new ObjectID(world.projectId),
          issueId: new ObjectID(issueId),
          props: payments(),
        }),
      ).toBeNull();
    }
  });

  test("each issue of a list, by issue: Ask AI's list reads them so", async () => {
    const byIssue: Map<string, DataSecurityIssueGroupJSON> =
      await DataSecurityIssueGroups.forIssues({
        projectId: new ObjectID(world.projectId),
        issues: [
          fixture.site[0]!.issue,
          fixture.payPromo.issue,
          fixture.exports[0]!.issue,
        ].map((issue: WorldIssue) => {
          return {
            _id: issue.id,
            id: new ObjectID(issue.id),
            dataSecurityIssueGroupId: new ObjectID(
              issue.dataSecurityIssueGroupId!,
            ),
          };
        }) as never,
        props: payments(),
      });

    expect(byIssue.get(fixture.site[0]!.issue.id)?.issueCount).toBe(3);
    expect(byIssue.has(fixture.payPromo.issue.id)).toBe(false);
    expect(byIssue.get(fixture.exports[0]!.issue.id)?.issueCount).toBe(2);
    expectNoNeedle(Array.from(byIssue.values()));
  });
});

describe("Fix the Cause", () => {
  async function planFor(
    entry: { issue: WorldIssue },
    props: DatabaseCommonInteractionProps,
  ): Promise<DataSecurityIssueGroupFixPlanJSON> {
    return await DataSecurityIssueGroupFix.plan({
      projectId: new ObjectID(world.projectId),
      groupId: groupOf(entry).id,
      props,
    });
  }

  test("a reader held to Payments sees the pull request for their stores, with no code the grouping found through others", async () => {
    const plan: DataSecurityIssueGroupFixPlanJSON = await planFor(
      fixture.site[0]!,
      payments(),
    );

    expect(
      plan.pullRequest?.stores
        .map((store: { name: string }) => {
          return store.name;
        })
        .sort(),
    ).toEqual(["pay-site-1", "pay-site-2", "pay-site-3"]);
    expect(plan.pullRequest?.location).toBeUndefined();
    expect(plan.pullRequest?.refusal).toBe(GROUP_PULL_REQUEST_REFUSED_MESSAGE);
    expect(plan.leftOut).toEqual([]);
    expectNoNeedle(plan);
    // The whole project's plan holds all five, and its code.
    const whole: DataSecurityIssueGroupFixPlanJSON = await planFor(
      fixture.site[0]!,
      admin(),
    );

    expect(whole.pullRequest?.stores).toHaveLength(5);
    expect(whole.pullRequest?.location?.repositoryName).toBe("acme/infra");
    expect(plan.planFingerprint).not.toBe(whole.planFingerprint);
  });

  test("what the one approval leaves out names only their stores", async () => {
    const whole: DataSecurityIssueGroupFixPlanJSON = await planFor(
      fixture.cdn[0]!,
      admin(),
    );
    const plan: DataSecurityIssueGroupFixPlanJSON = await planFor(
      fixture.cdn[0]!,
      payments(),
    );

    expect(
      whole.leftOut.map((store: DataSecurityIssueGroupLeftOutJSON) => {
        return store.name;
      }),
    ).toEqual(["mkt-cdn-3"]);
    expect(plan.leftOut).toEqual([]);
    expect(plan.cloud?.stores).toHaveLength(2);
    expect(plan.cloud?.action).toBe(
      DataSecurityResponseAction.BlockPublicAccess,
    );
    expect(plan.cloud?.refusal).toBe(CLOUD_FIX_REFUSED_MESSAGE);
    expectNoNeedle(plan);
  });

  test("a reader held to labels who may change issues and stores everywhere still asks for no part", async () => {
    const plan: DataSecurityIssueGroupFixPlanJSON = await planFor(
      fixture.site[0]!,
      paymentsEditor(),
    );
    const cdn: DataSecurityIssueGroupFixPlanJSON = await planFor(
      fixture.cdn[0]!,
      paymentsEditor(),
    );

    expect(plan.pullRequest?.refusal).toBe(GROUP_FIX_HELD_READER_MESSAGE);
    expect(plan.pullRequest?.candidates).toEqual([]);
    expect(cdn.cloud?.refusal).toBe(GROUP_FIX_HELD_READER_MESSAGE);
  });

  test("the pull request on its way shows only when it fixes one of their issues", async () => {
    groupOf(fixture.site[0]!).codeTaskId = TASK_ID;
    jest.spyOn(DataSecurityIssueGroupFix, "readFixState").mockResolvedValue({
      taskId: TASK_ID,
      state: DeclaredCodeChangeState.Writing,
    } as never);
    taskFixing([fixture.marketingSite[0]!.issue.id]);

    expect(
      (await planFor(fixture.site[0]!, payments())).pullRequest?.existing,
    ).toBeUndefined();

    taskFixing([fixture.site[2]!.issue.id]);

    expect(
      (await planFor(fixture.site[0]!, payments())).pullRequest?.existing
        ?.state,
    ).toBe(DeclaredCodeChangeState.Writing);
  });

  test("a group that is not theirs is not found, as one that does not exist", async () => {
    await expect(planFor(fixture.payPromo, payments())).rejects.toThrow(
      GROUP_NOT_FOUND_MESSAGE,
    );
    await expect(planFor(fixture.site[0]!, nobody())).rejects.toThrow(
      GROUP_NOT_FOUND_MESSAGE,
    );
  });

  test("a press by a reader held to labels makes nothing", async () => {
    for (const entry of [fixture.site[0]!, fixture.cdn[0]!]) {
      await expect(
        DataSecurityIssueGroupFix.run({
          projectId: new ObjectID(world.projectId),
          groupId: groupOf(entry).id,
          props: paymentsEditor(),
        }),
      ).rejects.toThrow(GROUP_FIX_HELD_READER_MESSAGE);
    }

    expect(calls.queued).toHaveLength(0);
    expect(calls.responses).toHaveLength(0);
  });
});

describe("Ask AI", () => {
  async function ask(
    args: JSONObject,
    props: DatabaseCommonInteractionProps,
  ): Promise<string> {
    const result: ToolExecutionResult =
      await QueryDataSecurityIssuesTool.execute(args, {
        projectId: new ObjectID(world.projectId),
        props,
      });

    return result.dataForLlm;
  }

  test("an issue's group, as a reader held to Payments reads it: their count, their cause, no name", async () => {
    const said: string = await ask(
      { dataSecurityIssueId: fixture.site[0]!.issue.id },
      payments(),
    );

    expect(said).toContain("static-site");
    expect(said).toContain("issueGroupIssues=3");
    expect(said).toContain("issueGroupOpen=3");
    expectNoNeedle(said);
  });

  test("the same issue, to the whole project: all five, and OneUptime AI's name", async () => {
    const said: string = await ask(
      { dataSecurityIssueId: fixture.site[0]!.issue.id },
      admin(),
    );

    expect(said).toContain("issueGroupIssues=5");
    expect(said).toContain("acme/marketing-sites");
  });

  test("an issue in a group that is not theirs says no group", async () => {
    const said: string = await ask(
      { dataSecurityIssueId: fixture.payPromo.issue.id },
      payments(),
    );

    expect(said).not.toContain("issueGroup");
  });

  test("the list of their issues says each one's group as they read it, and never a marketing store", async () => {
    // Every status: the world holds open issues only.
    const said: string = await ask({ status: "all", limit: 50 }, payments());

    // Their eight issues: three of the site, two of the CDN, two exports, one promo.
    expect(said.match(/^- dataSecurityIssueId=/gm)).toHaveLength(8);
    expect(said).not.toContain(fixture.marketingSite[0]!.issue.id);

    expect(said).toContain("issueGroupIssues=3");
    expect(said).toContain("issueGroupIssues=2");
    expect(said).not.toContain("issueGroupIssues=5");
    expectNoNeedle(said);
  });
});

describe("a Data Security case's playbook step", () => {
  test("names the cause by the case's own store, and counts nothing of the group", async () => {
    const caseId: string = makeId();

    fixture.site[0]!.issue.securityCaseId = caseId;

    const securityCase: SecurityCase = new SecurityCase();

    securityCase.id = new ObjectID(caseId);
    securityCase.source = SecurityDetectionSource.DataSecurity;

    const outcome: PlaybookStepOutcome =
      await SecurityPlaybookResponseSteps.fixWithAi({
        projectId: new ObjectID(world.projectId),
        runId: new ObjectID(makeId()),
        playbookName: "Data exposure",
        step: {
          id: "fix",
          action: SecurityPlaybookActionType.FixWithAi,
          config: {},
          requiresApproval: false,
          continueOnFailure: true,
          onlyIfThreatIntelMatched: false,
        },
        stepNumber: 2,
        securityCase,
      });
    const said: string = `${outcome.summary.toString()}\n${outcome.detailsInMarkdown?.toString() || ""}`;

    expect(outcome.summary.toString()).toContain("static-site");
    expectNoNeedle(said);
    expect(said).not.toMatch(/\b5\b/);
    expect(said).not.toContain("acme/infra");
    // OneUptime fixes the whole group's cause: its pull request holds every store.
    expect(calls.queued).toHaveLength(1);
  });
});

describe("the issues' timelines", () => {
  function waiting(
    kind: DataSecurityAiProposalKind,
    plan: JSONObject,
    groupId: string,
  ): DataSecurityAiProposal {
    const proposal: DataSecurityAiProposal = new DataSecurityAiProposal();

    proposal.id = new ObjectID(makeId());
    proposal.kind = kind;
    proposal.plan = plan;
    proposal.status = DataSecurityAiProposalStatus.Proposed;
    proposal.dataSecurityIssueGroupId = new ObjectID(groupId);

    return proposal;
  }

  beforeEach(() => {
    (
      DataSecurityIssueGroupTimelines.onProposed as unknown as {
        mockRestore: () => void;
      }
    ).mockRestore();
    (
      DataSecurityIssueGroupTimelines.expireWaitingForGroup as unknown as {
        mockRestore: () => void;
      }
    ).mockRestore();
    jest
      .spyOn(DataSecurityAiProposalService, "attemptTransition")
      .mockResolvedValue(1 as never);
  });

  function linesOn(issueIds: Array<string>): Array<string> {
    return calls.feedLines
      .filter((line: { issueId: string }) => {
        return issueIds.includes(line.issueId);
      })
      .map((line: { markdown: string }) => {
        return line.markdown;
      });
  }

  test("what OneUptime AI proposes for the group says nothing on a payments issue of a marketing store", async () => {
    const groupId: string = groupOf(fixture.site[0]!).id;
    const issueIds: Array<string> = [
      ...fixture.site,
      ...fixture.marketingSite,
    ].map((entry: { issue: WorldIssue }) => {
      return entry.issue.id;
    });

    await DataSecurityIssueGroupTimelines.onProposed({
      projectId: new ObjectID(world.projectId),
      proposalId: makeId(),
      kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
      plan: { groupId, issueIds, repositoryId: "repo" },
      groupId: new ObjectID(groupId),
    });

    const payLines: Array<string> = linesOn(
      fixture.site.map((entry: { issue: WorldIssue }) => {
        return entry.issue.id;
      }),
    );

    expect(payLines).toHaveLength(3);

    for (const line of payLines) {
      expectNoNeedle(line);
      // No count of the group, and no store's name at all - the link's address aside.
      expect(line.replace(/\]\([^)]*\)/g, "]")).not.toMatch(/\d/);
      expect(line).not.toContain("pay-site");
      expect(line).toContain("/data-security/ai");
    }
  });

  test("a dismissal and an expiry say nothing of the reason, the count or another store", async () => {
    const groupId: string = groupOf(fixture.cdn[0]!).id;
    const issueIds: Array<string> = fixture.cdn.map(
      (entry: { issue: WorldIssue }) => {
        return entry.issue.id;
      },
    );
    const proposal: DataSecurityAiProposal = waiting(
      DataSecurityAiProposalKind.FixIssueGroupInCloud,
      {
        groupId,
        action: DataSecurityResponseAction.BlockPublicAccess,
        actions: [
          {
            action: DataSecurityResponseAction.BlockPublicAccess,
            kind: "AWS S3 Bucket",
            storeIds: fixture.cdn.map((entry: { store: WorldStore }) => {
              return entry.store.id;
            }),
            issueIds,
          },
        ],
        storeIds: fixture.cdn.map((entry: { store: WorldStore }) => {
          return entry.store.id;
        }),
        issueIds,
        leftOutStoreIds: [fixture.marketingCdn.store.id],
      },
      groupId,
    );

    await DataSecurityIssueGroupTimelines.onDismissed({
      projectId: new ObjectID(world.projectId),
      proposal,
      userId: new ObjectID(makeId()),
    });
    jest
      .spyOn(DataSecurityAiProposalService, "findBy")
      .mockResolvedValue([proposal] as never);
    await DataSecurityIssueGroupTimelines.expireWaitingForGroup({
      projectId: new ObjectID(world.projectId),
      groupId: new ObjectID(groupId),
      at: new Date(),
      why: GroupProposalExpiry.NoLongerNeeded,
    });

    const lines: Array<string> = linesOn(issueIds);

    expect(lines).toHaveLength(4);

    for (const line of lines) {
      expectNoNeedle(line);
      expect(line).not.toContain("pay-cdn");
    }
  });
});
