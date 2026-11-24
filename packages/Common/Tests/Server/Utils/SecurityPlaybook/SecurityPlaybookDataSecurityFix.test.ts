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
import TelemetryLeakFix, {
  TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE,
} from "../../../../Server/Utils/DataSecurity/TelemetryLeakFix";
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
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
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
    expect(outcome.summary.toString()).toContain("buckets/customer-exports.tf");
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

  /*
   * The files its declared code is in are listed each as written, joined
   * with FeedMarkdown.join: one with a Markdown sign in its name is
   * escaped once, never a second time as part of a joined string
   * (FeedAndChatPlainTextEscapedGuard, rule C).
   */
  test("names each file its store is declared in, each escaped once", async () => {
    const made: { store: WorldStore; issue: WorldIssue } =
      declaredStore("customer-exports");
    const paths: Array<string> = [
      "buckets/customer-exports.tf",
      "modules/[legacy]_exports/main.tf",
    ];

    declared.set(made.store.id, { repositoryName: "acme/infra", paths });

    const summary: string = (await runStep()).summary.toString();
    const escapedOnce: Array<string> = paths.map((file: string): string => {
      return mdText`${file}`.toString();
    });

    expect(escapedOnce[1]).not.toBe(paths[1]);
    expect(summary).toContain(`(${escapedOnce.join(", ")})`);
    expect(summary).not.toContain(mdText`${escapedOnce[1]!}`.toString());
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
    jest.spyOn(DataSecurityIssueDossier, "readDeclaredCode").mockResolvedValue({
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
      declaredStore(
        `store${index}`,
        {
          kind: index % 2 === 0 ? "AWS S3 Bucket" : "AWS RDS Instance",
          cloudTags: { "managed-by": "terraform", owner: `team${index}` },
        },
        { checkId: index % 2 === 0 ? "public-read" : "not-encrypted-at-rest" },
      );
    }

    const outcome: PlaybookStepOutcome = await runStep();

    expect(started).toHaveLength(MAX_CASE_ISSUES_FIXED);
    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
  });
});

/*
 * A LEAK IN A SERVICE'S TELEMETRY (#10367, #10740): the step asks for the
 * service's one pull request for its leaks, as Fix with AI on the issue
 * asks it - planned as OneUptime, in the repository its leaks are written
 * in - and keeps it on the case. A service is asked for once.
 */
describe("a case about a leak in a service's telemetry", () => {
  const SERVICE_ID: string = "10740000-0000-4000-8000-0000000005e1";
  let planned: Array<string>;
  let asked: Array<{
    serviceId: string;
    props: unknown;
    repositoryId: unknown;
    caseId: string | undefined;
  }>;
  let answer: { message: string; aiRunId?: string; wasAlreadyAsked?: boolean };
  let hasRepository: boolean;

  function telemetryIssue(name: string): {
    store: WorldStore;
    issue: WorldIssue;
  } {
    return world.addStoreWithIssue(
      { name, kind: "Telemetry Logs", cloudTags: {} },
      {
        checkId: "sensitive-data-in-telemetry",
        securityCaseId: securityCase._id!.toString(),
      },
    );
  }

  beforeEach(() => {
    planned = [];
    asked = [];
    hasRepository = true;
    answer = {
      message: "OneUptime AI is working on it.",
      aiRunId: "10740000-0000-4000-8000-0000000000f7",
    };
    jest
      .spyOn(TelemetryLeakFix, "planForIssue")
      .mockImplementation((async (data: {
        issueId: ObjectID;
        props: { isRoot?: boolean };
      }) => {
        expect(data.props.isRoot).toBe(true);
        planned.push(data.issueId.toString());

        return {
          result: { plan: {} },
          plan: {
            serviceId: SERVICE_ID,
            serviceName: "checkout",
            repository: hasRepository
              ? {
                  id: REPOSITORY_ID,
                  name: "acme/checkout",
                  organizationName: "acme",
                  repositoryName: "checkout",
                  mainBranchName: "main",
                  gitHubAppInstallationId: null,
                }
              : null,
          },
        };
      }) as never);
    jest.spyOn(TelemetryLeakFix, "start").mockImplementation((async (data: {
      plan: { serviceId: string };
      props: unknown;
      requestedRepositoryId?: unknown;
      triggeredBySecurityCaseId?: ObjectID;
    }) => {
      asked.push({
        serviceId: data.plan.serviceId,
        props: data.props,
        repositoryId: data.requestedRepositoryId,
        caseId: data.triggeredBySecurityCaseId?.toString(),
      });

      return answer;
    }) as never);
  });

  test("asks the service's one pull request, as OneUptime, in the repository its leaks are written in, kept on the case", async () => {
    const made: { store: WorldStore; issue: WorldIssue } =
      telemetryIssue("checkout logs");
    const outcome: PlaybookStepOutcome = await runStep();

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(planned).toEqual([made.issue.id]);
    expect(asked).toEqual([
      {
        serviceId: SERVICE_ID,
        props: { isRoot: true },
        repositoryId: REPOSITORY_ID,
        caseId: securityCase._id!.toString(),
      },
    ]);
    expect(outcome.summary.toString()).toContain(
      "one pull request that stops checkout writing sensitive data to its telemetry, in acme/checkout",
    );
    // Not the declared code's path, and never a change through a cloud connection.
    expect(started).toHaveLength(0);
    expect(calls.responses).toHaveLength(0);
  });

  test("two of the case's issues of one service: one pull request fixes both", async () => {
    telemetryIssue("checkout logs");
    telemetryIssue("cart spans");

    const outcome: PlaybookStepOutcome = await runStep();

    expect(planned).toHaveLength(2);
    expect(asked).toHaveLength(1);
    expect(
      said(outcome).match(/one pull request that stops checkout/g),
    ).toHaveLength(1);
  });

  test("nothing says which repository holds the service's code: a person picks it on the issue", async () => {
    hasRepository = false;
    telemetryIssue("checkout logs");

    const outcome: PlaybookStepOutcome = await runStep();

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(asked).toHaveLength(0);
    expect(said(outcome)).toContain(
      "checkout: OneUptime could not tell which repository holds the code that writes its telemetry. Ask for the fix from its issue, where you pick the repository.",
    );
  });

  test("a store no service's, or nothing left to fix: the step says why, as Fix with AI does", async () => {
    jest.spyOn(TelemetryLeakFix, "planForIssue").mockResolvedValue({
      result: { plan: null, message: TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE },
      plan: null,
    } as never);
    telemetryIssue("checkout logs");

    const outcome: PlaybookStepOutcome = await runStep();

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(asked).toHaveLength(0);
    expect(said(outcome)).toContain(
      `checkout logs: ${TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE}`,
    );
  });

  test("a fix on its way for the service is said to be, not asked twice", async () => {
    answer = { ...answer, wasAlreadyAsked: true };
    telemetryIssue("checkout logs");

    const outcome: PlaybookStepOutcome = await runStep();

    expect(outcome.summary.toString()).toContain("(already on its way)");
  });

  test("what stops Code is said as Code says it, and nothing is asked", async () => {
    answer = { message: "Turn on OneUptime AI for this project first." };
    telemetryIssue("checkout logs");

    const outcome: PlaybookStepOutcome = await runStep();

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(said(outcome)).toContain(
      "checkout: Turn on OneUptime AI for this project first.",
    );
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
        index === 1 ? { securityCaseId: securityCase._id!.toString() } : {},
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
