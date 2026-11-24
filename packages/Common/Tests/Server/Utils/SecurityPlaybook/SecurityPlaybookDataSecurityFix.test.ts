import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import AIService from "../../../../Server/Services/AIService";
import CodeTaskRuns from "../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import { DATA_SECURITY_PLAYBOOK_FIX_FEED_MESSAGE } from "../../../../Server/Utils/AI/DataSecurity/DataSecurityCodeTask";
import DataSecurityIssueDossier from "../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueDossier";
import DataSecurityIssueGrouper from "../../../../Server/Utils/DataSecurity/DataSecurityIssueGrouper";
import ProjectDataTypeNames from "../../../../Server/Utils/DataSecurity/ProjectDataTypeNames";
import { PlaybookStepOutcome } from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import SecurityPlaybookIssueGroupFix, {
  MAX_CASE_ISSUES_FIXED,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookIssueGroupFix";
import SecurityPlaybookResponseSteps from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookResponseSteps";
import SecurityCaseEvidence from "../../../../Server/Utils/SecurityPlaybook/SecurityCaseEvidence";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import ObjectID from "../../../../Types/ObjectID";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  GroupFixCalls,
  REPOSITORY_ID,
  installGroupFixStubs,
} from "../DataSecurity/IssueGroupFixStubs";
import IssueGroupsWorld, {
  WorldIssue,
  WorldStore,
  makeId,
} from "../DataSecurity/IssueGroupsWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * FIX THE CODE WITH AI, ON A DATA SECURITY CASE WHOSE ISSUE IS IN NO GROUP
 * (#10740).
 *
 * The step asked for each group's one pull request (#10370), and a case
 * whose issue was in no group fell through to the exceptions its requests
 * threw - none - and was skipped. Now it asks Fix with AI for that issue
 * itself, as OneUptime, in the repository its store's declared code points
 * to, keeps the pull request on the case, and says so. It never changes a
 * store through its cloud connection: that always asks a person.
 */

const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";

let world: IssueGroupsWorld;
let calls: GroupFixCalls;
let started: Array<{
  repositoryId: string;
  issueId: string;
  caseId: string | undefined;
  message: string;
}>;
let securityCase: SecurityCase;
let declared: Map<string, { repositoryName: string; paths: Array<string> }>;

function caseOf(source: SecurityDetectionSource): SecurityCase {
  const made: SecurityCase = new SecurityCase();
  const id: string = makeId();

  made.id = new ObjectID(id);
  made._id = id;
  made.source = source;

  return made;
}

// A store declared as Terraform, and its issue, in the case.
function declaredStore(
  name: string,
  more: Partial<WorldStore> = {},
  issue: Partial<WorldIssue> = {},
): { store: WorldStore; issue: WorldIssue } {
  const made: { store: WorldStore; issue: WorldIssue } =
    world.addStoreWithIssue(
      {
        name,
        cloudTags: { "managed-by": "terraform" },
        ...more,
      },
      {
        checkId: "public-read",
        severity: "Critical",
        riskScore: 95,
        securityCaseId: securityCase._id!.toString(),
        ...issue,
      },
    );

  declared.set(made.store.id, {
    repositoryName: "acme/infra",
    paths: [`buckets/${name}.tf`],
  });

  return made;
}

// A store made in the console, and its issue, in the case.
function consoleStore(name: string): { store: WorldStore; issue: WorldIssue } {
  return world.addStoreWithIssue(
    { name, cloudConnectionId: CONNECTION_ID, cloudTags: {} },
    {
      checkId: "public-read",
      severity: "Critical",
      riskScore: 95,
      securityCaseId: securityCase._id!.toString(),
    },
  );
}

async function runStep(): Promise<PlaybookStepOutcome> {
  await DataSecurityIssueGrouper.groupProject({
    projectId: new ObjectID(world.projectId),
  });

  return await SecurityPlaybookResponseSteps.fixWithAi({
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
}

function said(outcome: PlaybookStepOutcome): string {
  return `${outcome.summary.toString()}\n${outcome.detailsInMarkdown?.toString() || ""}`;
}

let findRequests: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  world = new IssueGroupsWorld();
  world.install();
  calls = installGroupFixStubs({ connections: [{ id: CONNECTION_ID }] });
  started = [];
  declared = new Map();
  securityCase = caseOf(SecurityDetectionSource.DataSecurity);

  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true as never);
  jest
    .spyOn(ProjectDataTypeNames, "read")
    .mockResolvedValue(DataTypeNamer.withoutCustomTypes() as never);
  jest
    .spyOn(DataSecurityIssueDossier, "readDeclaredCode")
    .mockImplementation((async (
      _projectId: ObjectID,
      _issue: DataSecurityIssue,
      store: DataStore,
    ) => {
      const found:
        | { repositoryName: string; paths: Array<string> }
        | undefined = declared.get(store.id?.toString().toLowerCase() || "");

      return found
        ? {
            repositoryId: REPOSITORY_ID,
            repositoryName: found.repositoryName,
            paths: found.paths,
            codeKind: "Terraform",
            reason: "HasNamedFile",
          }
        : null;
    }) as never);
  jest
    .spyOn(CodeTaskRuns, "startForDataSecurityIssue")
    .mockImplementation((async (data: {
      repository: CodeRepository;
      message: string;
      triggeredByDataSecurityIssueId: ObjectID;
      triggeredBySecurityCaseId?: ObjectID;
    }) => {
      started.push({
        repositoryId: data.repository.id!.toString(),
        issueId: data.triggeredByDataSecurityIssueId.toString(),
        caseId: data.triggeredBySecurityCaseId?.toString(),
        message: data.message,
      });

      const run: AIRun = new AIRun();

      run.id = new ObjectID(makeId());

      return run;
    }) as never);
  findRequests = jest
    .spyOn(SecurityCaseEvidence, "findRequests")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a case whose issue is in no group", () => {
  test("asks Fix with AI for that issue, as OneUptime, in the repository its declared code points to, kept on the case", async () => {
    const made: { store: WorldStore; issue: WorldIssue } =
      declaredStore("customer-exports");
    const outcome: PlaybookStepOutcome = await runStep();

    expect(world.groups).toHaveLength(0);
    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(started).toEqual([
      {
        repositoryId: REPOSITORY_ID,
        issueId: made.issue.id,
        caseId: securityCase._id!.toString(),
        message: expect.stringContaining("public"),
      },
    ]);
    // The step says what it asked for, and where.
    expect(outcome.summary.toString()).toContain("customer-exports");
    expect(outcome.summary.toString()).toContain("acme/infra");
    expect(outcome.summary.toString()).toContain(
      "buckets/customer-exports.tf",
    );
    expect(outcome.summary.toString()).toContain("Terraform");
    // The issue's timeline says a playbook asked, with nobody named.
    expect(calls.feedLines).toContainEqual({
      issueId: made.issue.id,
      markdown: DATA_SECURITY_PLAYBOOK_FIX_FEED_MESSAGE,
    });
    // Never a change through the cloud connection, and never the exceptions' path.
    expect(calls.responses).toHaveLength(0);
    expect(findRequests).not.toHaveBeenCalled();
  });

  test("a store made in the console has no code to fix: it waits for a person, and nothing is changed through its cloud", async () => {
    consoleStore("customer-uploads");

    const outcome: PlaybookStepOutcome = await runStep();

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(said(outcome)).toContain("Waiting for a person");
    expect(said(outcome)).toContain("customer-uploads");
    expect(said(outcome)).toContain("always asks a person");
    expect(started).toHaveLength(0);
    expect(calls.responses).toHaveLength(0);
  });

  test("a leak in telemetry is left for a person to pick the service's repository", async () => {
    world.addStoreWithIssue(
      { name: "checkout logs", kind: "Telemetry Logs", cloudTags: {} },
      {
        checkId: "sensitive-data-in-telemetry",
        securityCaseId: securityCase._id!.toString(),
      },
    );

    const outcome: PlaybookStepOutcome = await runStep();

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(said(outcome)).toContain("service that writes it");
    expect(started).toHaveLength(0);
  });

  test("no repository OneUptime AI can work in holds its code: the step says so, and asks nothing", async () => {
    const made: { store: WorldStore; issue: WorldIssue } =
      declaredStore("customer-exports");

    declared.delete(made.store.id);

    const outcome: PlaybookStepOutcome = await runStep();

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(said(outcome)).toContain(
      "no repository OneUptime AI can work in holds the code that declares it",
    );
    expect(started).toHaveLength(0);
  });

  test("what stops Code - AI off for the project, no Runner - is said as Code says it", async () => {
    jest.restoreAllMocks();
    world = new IssueGroupsWorld();
    world.install();
    calls = installGroupFixStubs({
      connections: [{ id: CONNECTION_ID }],
      gateRefusal: "Turn on AI for this project first.",
    });
    declared = new Map();
    jest
      .spyOn(DataSecurityIssueDossier, "readDeclaredCode")
      .mockResolvedValue({
        repositoryId: REPOSITORY_ID,
        repositoryName: "acme/infra",
        paths: [],
        codeKind: "Terraform",
        reason: "HasNamedFile",
      } as never);
    jest
      .spyOn(ProjectDataTypeNames, "read")
      .mockResolvedValue(DataTypeNamer.withoutCustomTypes() as never);

    const start: ReturnType<typeof jest.spyOn> = jest.spyOn(
      CodeTaskRuns,
      "startForDataSecurityIssue",
    );

    declaredStore("customer-exports");

    const outcome: PlaybookStepOutcome = await runStep();

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(said(outcome)).toContain("Turn on AI for this project first.");
    expect(start).not.toHaveBeenCalled();
  });

  test("a store gone from its source has no code to fix", async () => {
    declaredStore("customer-exports", { isArchived: true });

    const outcome: PlaybookStepOutcome = await runStep();

    expect(said(outcome)).toContain("gone from its source");
    expect(started).toHaveLength(0);
  });

  test("asks for at most a few issues in no group, each its own pull request", async () => {
    for (let index: number = 1; index <= MAX_CASE_ISSUES_FIXED + 2; index++) {
      // Each of another kind and name: no two make a group.
      declaredStore(`store${index}`, {
        kind: index % 2 === 0 ? "AWS S3 Bucket" : "AWS RDS Instance",
        cloudTags: { "managed-by": "terraform", owner: `team${index}` },
      }, { checkId: index % 2 === 0 ? "public-read" : "not-encrypted-at-rest" });
    }

    const outcome: PlaybookStepOutcome = await runStep();

    expect(started).toHaveLength(MAX_CASE_ISSUES_FIXED);
    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
  });
});

describe("a case with issues in a group and in none", () => {
  test("asks for the group's one pull request and for the other issue's, both kept on the case", async () => {
    // Three buckets of one module: the case holds one of them.
    for (let index: number = 1; index <= 3; index++) {
      world.addStoreWithIssue(
        {
          name: `site-${index}-assets`,
          cloudTags: { module: "static-site", "managed-by": "terraform" },
        },
        index === 1
          ? { securityCaseId: securityCase._id!.toString() }
          : {},
      );
    }

    const single: { store: WorldStore; issue: WorldIssue } = declaredStore(
      "customer-exports",
      { kind: "AWS RDS Instance" },
      { checkId: "not-encrypted-at-rest" },
    );
    const outcome: PlaybookStepOutcome = await runStep();

    expect(world.groups).toHaveLength(1);
    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    // The group's pull request.
    expect(calls.queued).toHaveLength(1);
    expect(calls.queued[0]!.triggeredBySecurityCaseId?.toString()).toBe(
      securityCase._id!.toString(),
    );
    // The other issue's.
    expect(started).toEqual([
      expect.objectContaining({ issueId: single.issue.id }),
    ]);
    expect(outcome.summary.toString()).toContain("static-site");
    expect(outcome.summary.toString()).toContain("customer-exports");
  });
});

describe("a case whose issues are all closed", () => {
  test("says there is no code to fix, and reads no exception", async () => {
    const made: { store: WorldStore; issue: WorldIssue } =
      declaredStore("customer-exports");

    world.issueById(made.issue.id)!.status = DataSecurityIssueStatus.Resolved;

    const outcome: PlaybookStepOutcome = await runStep();

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toContain("closed");
    expect(started).toHaveLength(0);
    expect(findRequests).not.toHaveBeenCalled();
  });
});

describe("a case another source opened", () => {
  test("is the exceptions' path, as before: nothing of Data Security is read", async () => {
    securityCase = caseOf(SecurityDetectionSource.DetectionRule);
    declaredStore("customer-exports");

    expect(
      await SecurityPlaybookIssueGroupFix.fixIssuesOfCase({
        projectId: new ObjectID(world.projectId),
        runId: new ObjectID(makeId()),
        playbookName: "Brute force",
        step: {
          id: "fix",
          action: SecurityPlaybookActionType.FixWithAi,
          config: {},
          requiresApproval: false,
          continueOnFailure: true,
          onlyIfThreatIntelMatched: false,
        },
        stepNumber: 1,
        securityCase,
      }),
    ).toBeNull();
    expect(started).toHaveLength(0);
  });
});
