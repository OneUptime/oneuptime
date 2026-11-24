import AIRun from "../../../../Models/DatabaseModels/AIRun";
import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import AIService from "../../../../Server/Services/AIService";
import DataSecurityAiProposalService from "../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityFixTarget from "../../../../Server/Utils/AI/CodeFix/DataSecurityFixTarget";
import DataSecurityIssueGroupFixProof from "../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueGroupFixProof";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import DataSecurityIssueResolution from "../../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataSecurityIssueGrouper from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGrouper";
import DataSecurityIssueGroupFix from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGroupFix";
import DataSecurityIssueGroups from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGroups";
import { PlaybookStepOutcome } from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import SecurityPlaybookResponseSteps from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookResponseSteps";
import SecurityPlaybookIssueGroupFix from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookIssueGroupFix";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import {
  InfrastructureFixTaskContext,
  getInfrastructureFixTaskContext,
} from "../../../../Types/AI/CodeFixTaskContext";
import {
  DataSecurityIssueGroupCause,
  DataSecurityIssueGroupJSON,
  DataSecurityIssueGroupsJSON,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroup";
import {
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupFixResultJSON,
  DataSecurityIssueGroupLeftOutReason,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import { DataSecurityResponseAction } from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { DeclaredCodeChangeState } from "../../../../Utils/AiRemediation/DeclaredCodeChange";
import {
  GroupFixCalls,
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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ISSUES ONE MISTAKE MADE, FROM THE FIRST EVALUATION TO THE LAST FIX
 * (#10370), on one project's issues, stores and groups held in memory:
 *
 *   1. forty buckets one Terraform module made get one pull request;
 *   2. twelve buckets made in the console are fixed with one approval,
 *      leaving out the one marked Public By Design;
 *   3. the group's issues resolve, and its count drops to none;
 *   4. a playbook's Fix With AI step on a Data Security case starts it.
 */

let world: IssueGroupsWorld;
let calls: GroupFixCalls;

const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";

const ADMIN: () => ReturnType<typeof personWith> = () => {
  return personWith(world.projectId, [Permission.SecurityAdmin]);
};

function moduleBuckets(count: number): Array<{
  store: WorldStore;
  issue: WorldIssue;
}> {
  const made: Array<{ store: WorldStore; issue: WorldIssue }> = [];

  for (let index: number = 1; index <= count; index++) {
    made.push(
      world.addStoreWithIssue({
        name: `site-${index}-assets`,
        cloudTags: { module: "static-site", "managed-by": "terraform" },
      }),
    );
  }

  return made;
}

async function group(): Promise<void> {
  await DataSecurityIssueGrouper.groupProject({
    projectId: new ObjectID(world.projectId),
  });
}

const FIX_WITH_AI_STEP: SecurityPlaybookStep = {
  id: "fix",
  action: SecurityPlaybookActionType.FixWithAi,
  config: {},
  requiresApproval: false,
  continueOnFailure: true,
  onlyIfThreatIntelMatched: false,
};

function onlyGroup(): WorldGroup {
  expect(world.groups).toHaveLength(1);

  return world.groups[0]!;
}

beforeEach(() => {
  world = new IssueGroupsWorld();
  world.install();
  calls = installGroupFixStubs({
    connections: [{ id: CONNECTION_ID }],
  });
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("forty buckets one module made", () => {
  test("are one group, fixed with one pull request to the module that lists every store", async () => {
    const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
      moduleBuckets(40);

    await group();

    const made: WorldGroup = onlyGroup();

    expect(made.cause).toBe(DataSecurityIssueGroupCause.DeclaredCode);
    expect(world.membersOf(made)).toHaveLength(40);

    const plan: DataSecurityIssueGroupFixPlanJSON =
      await DataSecurityIssueGroupFix.plan({
        projectId: new ObjectID(world.projectId),
        groupId: made.id,
        props: ADMIN(),
      });

    expect(plan.pullRequest?.stores).toHaveLength(40);
    expect(plan.pullRequest?.refusal).toBeUndefined();
    expect(plan.pullRequest?.location?.repositoryId).toBe(REPOSITORY_ID);
    expect(plan.pullRequest?.location?.paths).toEqual([
      "modules/static-site/main.tf",
      "modules/static-site/variables.tf",
    ]);
    // Declared as code: nothing for the console's one approval.
    expect(plan.cloud).toBeUndefined();

    const result: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: made.id,
        props: ADMIN(),
        codeRepositoryId: REPOSITORY_ID,
        expectedPlanFingerprint: plan.planFingerprint,
      });

    expect(result.pullRequest?.aiRunId).toBeTruthy();
    // One pull request for the forty.
    expect(calls.queued).toHaveLength(1);

    const queued: (typeof calls.queued)[number] = calls.queued[0]!;
    const context: InfrastructureFixTaskContext | null =
      getInfrastructureFixTaskContext(queued.taskContext?.infrastructureFix);

    expect(queued.taskType).toBe(CodeFixTaskType.FixInfrastructureCode);
    expect(queued.codeRepositoryId?.toString()).toBe(REPOSITORY_ID);
    expect(context?.groupId).toBe(made.id);
    expect(context?.storeCount).toBe(40);
    expect(
      context?.stores.map((store: { issueId: string }): string => {
        return store.issueId;
      }),
    ).toEqual(
      expect.arrayContaining(
        buckets.map((bucket: { issue: WorldIssue }): string => {
          return bucket.issue.id;
        }),
      ),
    );
    // The request is the builder's, about the module, never one bucket's resource.
    expect(context?.request).toContain("static-site");
    // The group keeps its task, and each issue's timeline says it was asked.
    expect(made.codeTaskId).toBe(result.pullRequest?.aiRunId?.toLowerCase());
    expect(new Set(calls.feedIssueIds).size).toBe(40);
    // What OneUptime AI proposed for the pull request no longer waits.
    expect(calls.expired).toEqual([
      { groupId: made.id, kinds: ["FixIssueGroupInCode"] },
    ]);
  });

  test("a second press while it is written opens no second pull request", async () => {
    moduleBuckets(6);
    await group();

    const made: WorldGroup = onlyGroup();

    jest
      .spyOn(DataSecurityIssueGroupFix, "readFixState")
      .mockResolvedValue(null as never);

    await DataSecurityIssueGroupFix.run({
      projectId: new ObjectID(world.projectId),
      groupId: made.id,
      props: ADMIN(),
      codeRepositoryId: REPOSITORY_ID,
    });

    jest.spyOn(DataSecurityIssueGroupFix, "readFixState").mockResolvedValue({
      taskId: made.codeTaskId!,
      state: DeclaredCodeChangeState.Writing,
    } as never);

    const again: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: made.id,
        props: ADMIN(),
        codeRepositoryId: REPOSITORY_ID,
      });

    expect(again.pullRequest?.wasAlreadyAsked).toBe(true);
    expect(calls.queued).toHaveLength(1);
  });
});

describe("twelve buckets made in the console", () => {
  function consoleBuckets(): Array<{ store: WorldStore; issue: WorldIssue }> {
    const made: Array<{ store: WorldStore; issue: WorldIssue }> = [];

    for (let index: number = 1; index <= 12; index++) {
      made.push(
        world.addStoreWithIssue(
          {
            name: `acme-exports-${index}`,
            cloudConnectionId: CONNECTION_ID,
            // The thirteenth's public by design: the website's own images.
            isPublicByDesign: index === 12,
          },
          { checkId: "public-read", severity: "Critical", riskScore: 90 },
        ),
      );
    }

    return made;
  }

  test("are fixed with one approval, leaving out the one marked Public By Design", async () => {
    const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
      consoleBuckets();

    await group();

    const made: WorldGroup = onlyGroup();

    expect(made.cause).toBe(DataSecurityIssueGroupCause.NamePattern);

    const plan: DataSecurityIssueGroupFixPlanJSON =
      await DataSecurityIssueGroupFix.plan({
        projectId: new ObjectID(world.projectId),
        groupId: made.id,
        props: ADMIN(),
      });

    expect(plan.pullRequest).toBeUndefined();
    expect(plan.cloud?.action).toBe(
      DataSecurityResponseAction.BlockPublicAccess,
    );
    expect(plan.cloud?.stores).toHaveLength(11);
    expect(plan.leftOut).toEqual([
      expect.objectContaining({
        dataStoreId: buckets[11]!.store.id,
        part: DataSecurityIssueGroupFixPart.Cloud,
        reason: DataSecurityIssueGroupLeftOutReason.PublicByDesign,
        canInclude: false,
      }),
    ]);

    const result: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: made.id,
        props: ADMIN(),
        expectedPlanFingerprint: plan.planFingerprint,
        // Ticking a store the fix may never change does nothing.
        includeDataStoreIds: [buckets[11]!.store.id],
      });

    expect(result.cloud).toEqual(
      expect.objectContaining({
        action: DataSecurityResponseAction.BlockPublicAccess,
        changed: 11,
        failed: [],
      }),
    );
    expect(result.leftOut).toBe(1);
    expect(calls.responses).toHaveLength(11);
    expect(
      calls.responses.map((response: { dataStoreId: string }): string => {
        return response.dataStoreId;
      }),
    ).not.toContain(buckets[11]!.store.id);
    expect(calls.queued).toHaveLength(0);
  });
});

describe("a group that follows its issues to the end", () => {
  test("counts how many are left as they resolve, and says when the last did", async () => {
    const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
      moduleBuckets(40);

    await group();

    const made: WorldGroup = onlyGroup();

    await DataSecurityIssueGroupFix.run({
      projectId: new ObjectID(world.projectId),
      groupId: made.id,
      props: ADMIN(),
      codeRepositoryId: REPOSITORY_ID,
    });
    jest.spyOn(DataSecurityIssueGroupFix, "readFixState").mockResolvedValue({
      taskId: made.codeTaskId!,
      state: DeclaredCodeChangeState.Opened,
      repositoryName: "acme/infra",
    } as never);

    // The pull request is merged and applied: fifteen checks pass first.
    for (const bucket of buckets.slice(0, 15)) {
      world.resolve(bucket.issue);
    }

    await group();

    let listed: DataSecurityIssueGroupsJSON =
      await DataSecurityIssueGroups.list({
        projectId: new ObjectID(world.projectId),
        props: ADMIN(),
      });
    let shown: DataSecurityIssueGroupJSON = listed.groups[0]!;

    expect(shown).toEqual(
      expect.objectContaining({
        groupId: made.id,
        issueCount: 40,
        openIssueCount: 25,
        fixedIssueCount: 15,
      }),
    );
    expect(shown.fix?.state).toBe(DeclaredCodeChangeState.Opened);
    expect(made.fixedAt).toBeNull();

    // Then the rest.
    for (const bucket of buckets.slice(15)) {
      world.resolve(bucket.issue);
    }

    await group();

    listed = await DataSecurityIssueGroups.list({
      projectId: new ObjectID(world.projectId),
      props: ADMIN(),
    });
    shown = listed.groups[0]!;

    expect(shown.openIssueCount).toBe(0);
    expect(shown.fixedIssueCount).toBe(40);
    expect(made.openIssueCount).toBe(0);
    expect(made.fixedAt).toBeTruthy();
    // The group is kept: it holds its pull request, for #10368 to follow.
    expect(
      await DataSecurityIssueGroupFix.getFixTaskId({
        projectId: new ObjectID(world.projectId),
        groupId: new ObjectID(made.id),
      }),
    ).toEqual(new ObjectID(made.codeTaskId!));
    // What still waited for it is settled once none is left.
    expect(calls.expired).toContainEqual({
      groupId: made.id,
      kinds: undefined,
    });
  });

  /*
   * #10738: what OneUptime AI fixed for the group is proven - and counted
   * among the changes that worked - once every issue it fixed passed its
   * check by the fix itself, as #10368's resolutions say.
   */
  describe("and proves the fix OneUptime AI made", () => {
    let proposal: DataSecurityAiProposal;
    let proven: Array<string>;

    // The group's pull request, opened as an approved proposal of OneUptime AI's.
    async function fixedByProposal(count: number): Promise<{
      buckets: Array<{ store: WorldStore; issue: WorldIssue }>;
      made: WorldGroup;
    }> {
      const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
        moduleBuckets(count);

      await group();

      const made: WorldGroup = onlyGroup();

      await DataSecurityIssueGroupFix.run({
        projectId: new ObjectID(world.projectId),
        groupId: made.id,
        props: ADMIN(),
        codeRepositoryId: REPOSITORY_ID,
      });

      const queued: (typeof calls.queued)[number] = calls.queued[0]!;
      const task: AIRun = new AIRun();

      task.id = new ObjectID(made.codeTaskId!);
      task.projectId = new ObjectID(world.projectId);
      task.codeFixTaskType = queued.taskType;
      task.taskContext = queued.taskContext as never;
      jest
        .spyOn(DataSecurityFixTarget, "readTask")
        .mockResolvedValue(task as never);

      proposal = new DataSecurityAiProposal();
      proposal.id = new ObjectID(makeId());
      proposal.kind = DataSecurityAiProposalKind.FixIssueGroupInCode;
      proposal.status = DataSecurityAiProposalStatus.Applied;
      proposal.appliedAt = new Date();
      proposal.result = { aiRunId: made.codeTaskId! };
      proposal.dataSecurityIssueGroupId = new ObjectID(made.id);

      return { buckets, made };
    }

    // An issue whose production check found the pull request applied (StoreConfigurationFixWatch).
    function fixedInCode(issue: WorldIssue, taskId: string): void {
      const row: WorldIssue = world.issueById(issue.id)!;

      row.status = DataSecurityIssueStatus.Resolved;
      row.resolution = DataSecurityIssueResolution.FixedInInfrastructureCode;
      row.resolvedAt = new Date().toISOString();
      row.resolutionDetails = {
        at: row.resolvedAt,
        fix: { pullRequestId: makeId(), taskId },
      };
    }

    beforeEach(() => {
      proven = [];
      proposal = undefined as unknown as DataSecurityAiProposal;
      (
        DataSecurityIssueGroupFixProof.proveForProject as unknown as {
          mockRestore: () => void;
        }
      ).mockRestore();
      jest
        .spyOn(DataSecurityAiProposalService, "findBy")
        .mockImplementation((async () => {
          return proposal && !proven.includes(proposal.id!.toString())
            ? [proposal]
            : [];
        }) as never);
      jest
        .spyOn(DataSecurityAiProposalService, "markGroupFixProven")
        .mockImplementation((async (data: { proposalId: ObjectID }) => {
          proven.push(data.proposalId.toString());

          return 1;
        }) as never);
    });

    test("once every issue it fixed resolved by its pull request: not while one is open, nor while one only passed its check", async () => {
      const { buckets, made } = await fixedByProposal(6);
      const taskId: string = made.codeTaskId!;

      // Three applied and verified.
      for (const bucket of buckets.slice(0, 3)) {
        fixedInCode(bucket.issue, taskId);
      }

      await group();
      expect(proven).toEqual([]);

      // The rest pass their check before the production check reads them again.
      for (const bucket of buckets.slice(3)) {
        const row: WorldIssue = world.issueById(bucket.issue.id)!;

        row.status = DataSecurityIssueStatus.Resolved;
        row.resolution = DataSecurityIssueResolution.CheckPassed;
        row.resolvedAt = new Date().toISOString();
      }

      await group();
      // The group is fixed, but nothing says yet that its pull request did it.
      expect(made.openIssueCount).toBe(0);
      expect(proven).toEqual([]);

      // The production check upgrades them: the pull request did it.
      for (const bucket of buckets.slice(3)) {
        fixedInCode(bucket.issue, taskId);
      }

      await group();
      expect(proven).toEqual([proposal.id!.toString()]);

      // Proven once: a later grouping reads it as proven already.
      await group();
      expect(proven).toHaveLength(1);
    });

    test.each([
      DataSecurityIssueStatus.Accepted,
      DataSecurityIssueStatus.NotAnIssue,
    ])(
      "never when an issue was %s instead of fixed",
      async (status: DataSecurityIssueStatus) => {
        const { buckets, made } = await fixedByProposal(4);

        for (const bucket of buckets.slice(1)) {
          fixedInCode(bucket.issue, made.codeTaskId!);
        }

        world.issueById(buckets[0]!.issue.id)!.status = status;

        await group();

        expect(made.openIssueCount).toBe(0);
        expect(proven).toEqual([]);
      },
    );
  });
});

describe("a playbook's Fix With AI step on a Data Security case", () => {
  test("starts the group's one pull request, kept on the case", async () => {
    const caseId: string = makeId();
    const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
      moduleBuckets(8);

    buckets[0]!.issue.securityCaseId = caseId;
    await group();

    const securityCase: SecurityCase = new SecurityCase();

    securityCase.id = new ObjectID(caseId);
    securityCase._id = caseId;
    securityCase.source = SecurityDetectionSource.DataSecurity;

    const outcome: PlaybookStepOutcome =
      await SecurityPlaybookResponseSteps.fixWithAi({
        projectId: new ObjectID(world.projectId),
        runId: new ObjectID(makeId()),
        playbookName: "Data exposure",
        step: FIX_WITH_AI_STEP,
        stepNumber: 2,
        securityCase,
      });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toContain("static-site");
    expect(calls.queued).toHaveLength(1);
    expect(calls.queued[0]!.triggeredBySecurityCaseId?.toString()).toBe(caseId);
    expect(calls.queued[0]!.userId).toBeUndefined();
    expect(
      getInfrastructureFixTaskContext(
        calls.queued[0]!.taskContext?.infrastructureFix,
      )?.storeCount,
    ).toBe(8);
  });

  test("never changes the stores made in the console: they wait for one approval", async () => {
    const caseId: string = makeId();

    for (let index: number = 1; index <= 3; index++) {
      const made: { store: WorldStore; issue: WorldIssue } =
        world.addStoreWithIssue(
          { name: `acme-exports-${index}`, cloudConnectionId: CONNECTION_ID },
          { checkId: "public-read", severity: "Critical" },
        );

      made.issue.securityCaseId = caseId;
    }

    await group();

    const securityCase: SecurityCase = new SecurityCase();

    securityCase.id = new ObjectID(caseId);
    securityCase.source = SecurityDetectionSource.DataSecurity;

    const outcome: PlaybookStepOutcome =
      await SecurityPlaybookResponseSteps.fixWithAi({
        projectId: new ObjectID(world.projectId),
        runId: new ObjectID(makeId()),
        playbookName: "Data exposure",
        step: FIX_WITH_AI_STEP,
        stepNumber: 2,
        securityCase,
      });

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "always asks a person",
    );
    expect(calls.responses).toHaveLength(0);
    expect(calls.queued).toHaveLength(0);
  });

  test("leaves a case another source opened to the exceptions its requests threw", async () => {
    const caseId: string = makeId();
    const buckets: Array<{ store: WorldStore; issue: WorldIssue }> =
      moduleBuckets(3);

    buckets[0]!.issue.securityCaseId = caseId;
    await group();

    const securityCase: SecurityCase = new SecurityCase();

    securityCase.id = new ObjectID(caseId);
    securityCase.source = SecurityDetectionSource.DetectionRule;

    expect(
      await SecurityPlaybookIssueGroupFix.fixIssuesOfCase({
        projectId: new ObjectID(world.projectId),
        runId: new ObjectID(makeId()),
        playbookName: "Data exposure",
        step: FIX_WITH_AI_STEP,
        stepNumber: 2,
        securityCase,
      }),
    ).toBeNull();
    expect(calls.queued).toHaveLength(0);
  });
});
