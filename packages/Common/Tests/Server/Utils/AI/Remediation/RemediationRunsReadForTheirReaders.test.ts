import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ExternalMcpServer from "../../../../../Models/DatabaseModels/ExternalMcpServer";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Project from "../../../../../Models/DatabaseModels/Project";
import Runbook from "../../../../../Models/DatabaseModels/Runbook";
import AutoRemediationRuleService from "../../../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../../../Server/Services/AutoRemediationSuggestionService";
import ExternalMcpServerService from "../../../../../Server/Services/ExternalMcpServerService";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import KubernetesClusterAiAccessService from "../../../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../../../Server/Services/ResourceAiAccessService";
import RunbookService from "../../../../../Server/Services/RunbookService";
import RunnerJobService from "../../../../../Server/Services/RunnerJobService";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import McpRemediationRunner from "../../../../../Server/Utils/AI/Remediation/McpRemediationRunner";
import RemediationCodeRepositories from "../../../../../Server/Utils/AI/Remediation/RemediationCodeRepositories";
import RemediationExecutionRunner from "../../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import RemediationPlanRunner from "../../../../../Server/Utils/AI/Remediation/RemediationPlanRunner";
import RemediationTrackRecordReader from "../../../../../Server/Utils/AI/Remediation/RemediationTrackRecordReader";
import PostedRootCause from "../../../../../Server/Utils/AI/SRE/PostedRootCause";
import RecentChangesContext from "../../../../../Server/Utils/AI/SRE/RecentChangesContext";
import RemediationChatMessage from "../../../../../Server/Utils/AutoRemediation/RemediationChatMessage";
import logger from "../../../../../Server/Utils/Logger";
import ReadAudienceReader from "../../../../../Server/Utils/ReadAudience/ReadAudienceReader";
import { AiRemediationCommandPlan } from "../../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationExecutionMode from "../../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { RemediationTrackRecord } from "../../../../../Types/AutoRemediation/RemediationTrackRecord";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ReadAudience from "../../../../../Types/BaseDatabase/ReadAudience";
import { EVERY_CODE_REPOSITORY } from "../../../../../Types/CodeRepository/CodeRepositoryAllowance";
import Dictionary from "../../../../../Types/Dictionary";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import AiResourceType from "../../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  keptForAudience,
  readAudienceOf,
  readAudienceProps,
} from "../../../../Helpers/ReadAudienceFixtures";
import {
  ModelReadingMonitors,
  modelReadsMonitors,
  OPEN_MONITOR_NAME,
  readersOfAProject,
  SET_APART_MONITOR_NAME,
} from "../../../../Helpers/RunReadersHarness";

/*
 * A FIX READS ONLY WHAT EVERYONE WHO MAY SEE ITS INCIDENT MAY READ (#9612).
 *
 * A fix OneUptime AI works out - a runbook it picks, the commands it runs or
 * proposes on a cluster, a resource or a Runner, the changes it makes
 * through the project's MCP servers - posts its plan, reasoning and outcome
 * to the incident's feed, OneUptime AI card and channels. Each run works out
 * those readers (RemediationReadAudience) with what it acts on named, and
 * hands them to the engine, so every tool reads through the permission
 * layer for them.
 *
 * Here the engine runs for real and its model reads the project's monitors
 * with query_monitors, through the props the engine hands every tool
 * (RunReadersHarness): in a project where a team reads every kind only for
 * some labels, the monitor a label sets apart never reaches what the fix
 * posts, and one nobody set apart does; in a project whose roles narrow
 * nobody, both do. Before #9612 a fix read the whole project as OneUptime,
 * so payroll-db reached its reasoning, and these fail.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OPEN_RUNBOOK_ID: string = "33333333-3333-4333-8333-333333333333";
const SET_APART_RUNBOOK_ID: string = "44444444-4444-4444-8444-444444444444";
const OPEN_RUNBOOK_NAME: string = "Restart checkout";
const SET_APART_RUNBOOK_NAME: string = "Rotate payroll keys";
const CLUSTER_ID: string = "55555555-5555-4555-8555-555555555555";
const RESOURCE_ID: string = "66666666-6666-4666-8666-666666666666";
const RUNNER_ID: string = "99999999-9999-4999-8999-999999999999";

// What every fix posts: the suggestion's settled columns and the feed items.
interface Posted {
  settled: Array<Record<string, unknown>>;
  feed: Array<string>;
}

let posted: Posted;

// The readers a project where a team reads every kind only for some labels has.
function narrowedReaders(named: Dictionary<Array<string>>): ReadAudience {
  return readAudienceOf({
    projectId: PROJECT_ID,
    labelledPermissions: [Permission.ProjectMember],
    named: { Incident: [INCIDENT_ID.toString()], ...named },
  });
}

function everythingPosted(): string {
  return JSON.stringify(posted);
}

function suggestionRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    status: AutoRemediationSuggestionStatus.Planning,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    executionMode: AutoRemediationExecutionMode.Suggest,
    autoResolveOnRecovery: false,
    incidentId: INCIDENT_ID,
    verificationWindowMinutes: 15,
    ...overrides,
  };
}

function readsSuggestion(row: Record<string, unknown>): void {
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockImplementation((async (args: {
      select: Record<string, unknown>;
    }): Promise<AutoRemediationSuggestion> => {
      const suggestion: AutoRemediationSuggestion =
        new AutoRemediationSuggestion();
      const picked: Record<string, unknown> = { id: row["id"] };

      // Only what the runner asks for, as a real read.
      for (const key of Object.keys(args.select)) {
        if (key in row) {
          picked[key] = row[key];
        }
      }

      Object.assign(suggestion, picked);
      return suggestion;
    }) as never);
}

function clusterStatus(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-us",
    runner: {
      id: ObjectID.generate().toString(),
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: true },
    },
    accessMethod: "in_cluster",
    aiAgent: null,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
  } as unknown as KubernetesClusterAiAccessStatus;
}

function dockerHost(): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: {
      agentId: ObjectID.generate().toString(),
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: AiResourceType.DockerHost,
        resourceIdentifier: "web-1",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  } as unknown as ResourceAiAccessStatus;
}

beforeEach(() => {
  posted = { settled: [], feed: [] };

  for (const level of ["debug", "warn", "error", "info"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
    requireTwoApprovalsForRiskierFixes: false,
  } as unknown as Project as never);
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    id: INCIDENT_ID,
    title: "Checkout is slow",
    description: "p95 above 2s",
    incidentNumber: 42,
  } as unknown as Incident as never);
  jest.spyOn(PostedRootCause, "getForSubject").mockResolvedValue(null as never);
  jest
    .spyOn(RemediationCodeRepositories, "forRule")
    .mockResolvedValue(EVERY_CODE_REPOSITORY as never);
  jest.spyOn(AiContextReader, "forRule").mockResolvedValue([] as never);
  jest
    .spyOn(RemediationChatMessage, "getProposalBlocks")
    .mockResolvedValue([] as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
    .mockImplementation((async (args: {
      set: Record<string, unknown>;
    }): Promise<number> => {
      posted.settled.push(args.set);
      return 1;
    }) as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation((async (data: {
      feedInfoInMarkdown: string;
    }): Promise<void> => {
      posted.feed.push(data.feedInfoInMarkdown);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a runbook OneUptime AI picks", () => {
  let candidateReads: Array<DatabaseCommonInteractionProps>;
  let trackRecordReads: Array<{ readAudience?: ReadAudience | undefined }>;

  function runbook(id: string, name: string): Runbook {
    const row: Runbook = new Runbook(new ObjectID(id));
    row.name = name;
    row.description = `${name}, as the team wrote it`;
    return row;
  }

  // A pick: its rule's runbooks, or - no rule - the project's own.
  function picks(data: { ruleRunbookIds?: Array<string> | undefined }): void {
    candidateReads = [];
    trackRecordReads = [];

    readsSuggestion(
      suggestionRow({
        suggestionType: AutoRemediationSuggestionType.Runbook,
        ...(data.ruleRunbookIds
          ? {
              autoRemediationRuleId: RULE_ID,
              ruleNameSnapshot: "Fix checkout",
            }
          : {}),
      }),
    );
    jest.spyOn(AutoRemediationRuleService, "findOneById").mockResolvedValue({
      id: RULE_ID,
      aiSelectsRunbook: false,
      runbooks: (data.ruleRunbookIds || []).map((id: string) => {
        return { id: new ObjectID(id) };
      }),
    } as unknown as AutoRemediationRule as never);
    jest.spyOn(RunbookService, "findBy").mockImplementation((async (findBy: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<Runbook>> => {
      candidateReads.push(findBy.props);
      // The ids asked for, when the read names them (QueryHelper.any).
      const asked: Array<string> | null = findBy.query["_id"]
        ? Object.values(
            (findBy.query["_id"] as FindOperator<unknown>)
              .objectLiteralParameters || {},
          )
            .flat()
            .map((id: unknown): string => {
              return String(id).toLowerCase();
            })
        : null;

      return keptForAudience({
        modelType: Runbook,
        rows: [
          runbook(OPEN_RUNBOOK_ID, OPEN_RUNBOOK_NAME),
          runbook(SET_APART_RUNBOOK_ID, SET_APART_RUNBOOK_NAME),
        ],
        props: findBy.props,
        setApartIds: [SET_APART_RUNBOOK_ID],
      }).filter((row: Runbook): boolean => {
        return !asked || asked.includes(row.id!.toString().toLowerCase());
      });
    }) as never);
    jest
      .spyOn(RemediationTrackRecordReader, "readRunbookTrackRecords")
      .mockImplementation((async (data: {
        readAudience?: ReadAudience | undefined;
      }): Promise<Map<string, RemediationTrackRecord>> => {
        trackRecordReads.push(data);
        return new Map<string, RemediationTrackRecord>();
      }) as never);
  }

  async function run(): Promise<void> {
    await RemediationPlanRunner.executePlan({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 1,
    });
  }

  test("its tools read for the incident's readers, with the runbooks its rule names named", async () => {
    readersOfAProject({ narrowedByLabels: true });
    picks({ ruleRunbookIds: [SET_APART_RUNBOOK_ID] });
    const model: ModelReadingMonitors = modelReadsMonitors({
      answerTail: "SelectedRunbook: none",
    });

    await run();

    expect(model.toolProps).toEqual([
      readAudienceProps(narrowedReaders({ Runbook: [SET_APART_RUNBOOK_ID] })),
    ]);
  });

  test("a monitor set apart never reaches its reasoning; one nobody set apart does", async () => {
    readersOfAProject({ narrowedByLabels: true });
    picks({ ruleRunbookIds: [OPEN_RUNBOOK_ID] });
    modelReadsMonitors({ answerTail: `SelectedRunbook: ${OPEN_RUNBOOK_ID}` });

    await run();

    expect(everythingPosted()).toContain(OPEN_MONITOR_NAME);
    expect(everythingPosted()).not.toContain(SET_APART_MONITOR_NAME);
    // It proposed the runbook, by name, on the incident.
    expect(posted.feed.join("\n")).toContain(OPEN_RUNBOOK_NAME);
  });

  test("the project's own pick is offered no runbook set apart, so never names one", async () => {
    readersOfAProject({ narrowedByLabels: true });
    picks({});
    // The model names the runbook it was never offered.
    modelReadsMonitors({
      answerTail: `SelectedRunbook: ${SET_APART_RUNBOOK_ID}`,
    });

    await run();

    expect(candidateReads).toEqual([readAudienceProps(narrowedReaders({}))]);
    expect(everythingPosted()).not.toContain(SET_APART_RUNBOOK_NAME);
    // An id it was never offered is no pick.
    expect(posted.settled).toEqual([
      expect.objectContaining({
        status: AutoRemediationSuggestionStatus.NoneApplicable,
      }),
    ]);
  });

  test("the project's own pick still offers what nobody set apart, and proposes it by name", async () => {
    readersOfAProject({ narrowedByLabels: true });
    picks({});
    modelReadsMonitors({ answerTail: `SelectedRunbook: ${OPEN_RUNBOOK_ID}` });

    await run();

    expect(posted.feed.join("\n")).toContain(OPEN_RUNBOOK_NAME);
    expect(posted.settled[0]).toEqual(
      expect.objectContaining({
        status: AutoRemediationSuggestionStatus.Suggested,
        runbookNameSnapshot: OPEN_RUNBOOK_NAME,
      }),
    );
  });

  test("a runbook its rule names is offered whoever owns it: the rule's author chose it", async () => {
    readersOfAProject({ narrowedByLabels: true });
    picks({ ruleRunbookIds: [SET_APART_RUNBOOK_ID] });
    modelReadsMonitors({
      answerTail: `SelectedRunbook: ${SET_APART_RUNBOOK_ID}`,
    });

    await run();

    expect(posted.feed.join("\n")).toContain(SET_APART_RUNBOOK_NAME);
    expect(posted.settled[0]).toEqual(
      expect.objectContaining({
        status: AutoRemediationSuggestionStatus.Suggested,
        runbookNameSnapshot: SET_APART_RUNBOOK_NAME,
      }),
    );
  });

  test("the runbooks' track records are read for its readers", async () => {
    readersOfAProject({ narrowedByLabels: true });
    picks({ ruleRunbookIds: [OPEN_RUNBOOK_ID] });
    modelReadsMonitors({ answerTail: `SelectedRunbook: ${OPEN_RUNBOOK_ID}` });

    await run();

    // The planner's context, then the record kept with the proposal.
    expect(trackRecordReads).toHaveLength(2);

    for (const read of trackRecordReads) {
      expect(read.readAudience).toEqual(
        narrowedReaders({ Runbook: [OPEN_RUNBOOK_ID] }),
      );
    }
  });

  test("a project whose roles narrow nobody reads every monitor and offers every runbook, as before", async () => {
    readersOfAProject({ narrowedByLabels: false });
    picks({});
    modelReadsMonitors({
      answerTail: `SelectedRunbook: ${SET_APART_RUNBOOK_ID}`,
    });

    await run();

    expect(everythingPosted()).toContain(SET_APART_MONITOR_NAME);
    expect(everythingPosted()).toContain(OPEN_MONITOR_NAME);
    expect(posted.feed.join("\n")).toContain(SET_APART_RUNBOOK_NAME);
  });

  /*
   * Unlike a security case's triage (#9632), a fix counts every row: its
   * plan goes to the incident's Slack and Microsoft Teams channels too,
   * whose readers no permission row tells.
   */
  test("a team that reads every kind only for some labels narrows it though none of its members may read security cases", async () => {
    readersOfAProject({
      narrowedByLabels: true,
      narrowedTeamReadsSecurityCases: false,
    });
    picks({ ruleRunbookIds: [OPEN_RUNBOOK_ID] });
    const model: ModelReadingMonitors = modelReadsMonitors({
      answerTail: `SelectedRunbook: ${OPEN_RUNBOOK_ID}`,
    });

    await run();

    expect(model.toolProps).toEqual([
      readAudienceProps(narrowedReaders({ Runbook: [OPEN_RUNBOOK_ID] })),
    ]);
    expect(everythingPosted()).not.toContain(SET_APART_MONITOR_NAME);
  });
});

describe("the commands a fix runs or proposes", () => {
  let recentChangesReads: Array<{ readAudience?: ReadAudience | undefined }>;
  let earlierFixReads: Array<{ readAudience?: ReadAudience | undefined }>;

  async function run(): Promise<void> {
    await RemediationExecutionRunner.executeRemediation({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 1,
    });
  }

  beforeEach(() => {
    recentChangesReads = [];
    earlierFixReads = [];

    jest.spyOn(RecentChangesContext, "read").mockImplementation((async (data: {
      readAudience?: ReadAudience | undefined;
    }): Promise<null> => {
      recentChangesReads.push(data);
      return null;
    }) as never);
    jest
      .spyOn(RemediationTrackRecordReader, "readEarlierFixes")
      .mockImplementation((async (data: {
        readAudience?: ReadAudience | undefined;
      }): Promise<Array<never>> => {
        earlierFixReads.push(data);
        return [];
      }) as never);
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(clusterStatus() as never);
    jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue(dockerHost() as never);
  });

  describe("a cluster's round", () => {
    beforeEach(() => {
      readsSuggestion(
        suggestionRow({
          kubernetesClusterId: new ObjectID(CLUSTER_ID),
          ruleNameSnapshot: 'AI remediation for cluster "prod-us"',
        }),
      );
    });

    test("its tools read for the incident's readers, with its cluster named", async () => {
      readersOfAProject({ narrowedByLabels: true });
      const model: ModelReadingMonitors = modelReadsMonitors();

      await run();

      expect(model.toolProps).toEqual([
        readAudienceProps(narrowedReaders({ KubernetesCluster: [CLUSTER_ID] })),
      ]);
    });

    test("a monitor set apart never reaches what it posts; one nobody set apart does", async () => {
      readersOfAProject({ narrowedByLabels: true });
      modelReadsMonitors();

      await run();

      expect(everythingPosted()).toContain(OPEN_MONITOR_NAME);
      expect(everythingPosted()).not.toContain(SET_APART_MONITOR_NAME);
    });

    test("the recent changes it can roll back, and the fixes made on its cluster before, are read for its readers", async () => {
      readersOfAProject({ narrowedByLabels: true });
      modelReadsMonitors();

      await run();

      const readers: ReadAudience = narrowedReaders({
        KubernetesCluster: [CLUSTER_ID],
      });

      expect(recentChangesReads).toHaveLength(1);
      expect(recentChangesReads[0]!.readAudience).toEqual(readers);
      expect(earlierFixReads).toHaveLength(1);
      expect(earlierFixReads[0]!.readAudience).toEqual(readers);
    });

    test("a project whose roles narrow nobody reads every monitor, as before", async () => {
      readersOfAProject({ narrowedByLabels: false });
      modelReadsMonitors();

      await run();

      expect(everythingPosted()).toContain(SET_APART_MONITOR_NAME);
    });
  });

  describe("a resource's round", () => {
    beforeEach(() => {
      readsSuggestion(
        suggestionRow({
          resourceType: AiResourceType.DockerHost,
          resourceId: new ObjectID(RESOURCE_ID),
          ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
        }),
      );
    });

    test("its tools read for the incident's readers, with its resource named under its own model", async () => {
      readersOfAProject({ narrowedByLabels: true });
      const model: ModelReadingMonitors = modelReadsMonitors();

      await run();

      expect(model.toolProps).toEqual([
        readAudienceProps(narrowedReaders({ DockerHost: [RESOURCE_ID] })),
      ]);
      expect(earlierFixReads[0]!.readAudience).toEqual(
        narrowedReaders({ DockerHost: [RESOURCE_ID] }),
      );
    });

    test("a monitor set apart never reaches what it posts", async () => {
      readersOfAProject({ narrowedByLabels: true });
      modelReadsMonitors();

      await run();

      expect(everythingPosted()).toContain(OPEN_MONITOR_NAME);
      expect(everythingPosted()).not.toContain(SET_APART_MONITOR_NAME);
    });
  });

  describe("a rule's round on its Runner and the signal's cluster", () => {
    beforeEach(() => {
      readsSuggestion(
        suggestionRow({
          autoRemediationRuleId: RULE_ID,
          ruleNameSnapshot: "Restart the API service",
        }),
      );
      // A rule saved before rules were simplified, composing commands.
      jest.spyOn(AutoRemediationRuleService, "findOneById").mockResolvedValue({
        id: RULE_ID,
        isEnabled: true,
        aiComposesCommands: true,
        executionMode: AutoRemediationExecutionMode.Suggest,
        commandAllowlist: [],
        commandRunners: [{ id: new ObjectID(RUNNER_ID) }],
      } as unknown as AutoRemediationRule as never);
      jest
        .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
        .mockResolvedValue([clusterStatus()] as never);
    });

    test("its tools read for the incident's readers, with the Runner and the cluster it acts on named", async () => {
      readersOfAProject({ narrowedByLabels: true });
      const model: ModelReadingMonitors = modelReadsMonitors();

      await run();

      const readers: ReadAudience = narrowedReaders({
        KubernetesCluster: [CLUSTER_ID],
        Runner: [RUNNER_ID],
      });

      expect(model.toolProps).toEqual([readAudienceProps(readers)]);
      // Rollback first reads the recent changes for them too.
      expect(recentChangesReads[0]!.readAudience).toEqual(readers);
    });

    test("a monitor set apart never reaches what it posts", async () => {
      readersOfAProject({ narrowedByLabels: true });
      modelReadsMonitors();

      await run();

      expect(everythingPosted()).toContain(OPEN_MONITOR_NAME);
      expect(everythingPosted()).not.toContain(SET_APART_MONITOR_NAME);
    });
  });

  describe("a plan a workflow proposes, with no round's readers", () => {
    const PLAN: AiRemediationCommandPlan = { commands: [] };

    test("its track record is read for the incident's readers, worked out for it", async () => {
      const readers: ReadAudience = narrowedReaders({});
      const forSubject: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ReadAudienceReader, "forSubject")
        .mockResolvedValue(readers as never);
      const withTrackRecords: ReturnType<typeof jest.spyOn> = jest
        .spyOn(RemediationTrackRecordReader, "withTrackRecords")
        .mockResolvedValue(PLAN as never);

      await RemediationExecutionRunner.withTrackRecords({
        suggestion: {
          id: SUGGESTION_ID,
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        } as unknown as AutoRemediationSuggestion,
        plan: PLAN,
      });

      expect(forSubject).toHaveBeenCalledWith(
        { projectId: PROJECT_ID, incidentId: INCIDENT_ID, alertId: undefined },
        { withTelemetry: false },
      );
      expect(withTrackRecords).toHaveBeenCalledWith(
        expect.objectContaining({ readAudience: readers }),
      );
    });

    test("readers that cannot be read add no record: it names nobody", async () => {
      jest
        .spyOn(ReadAudienceReader, "forSubject")
        .mockRejectedValue(new Error("database down") as never);
      const withTrackRecords: ReturnType<typeof jest.spyOn> = jest.spyOn(
        RemediationTrackRecordReader,
        "withTrackRecords",
      );

      expect(
        await RemediationExecutionRunner.withTrackRecords({
          suggestion: {
            id: SUGGESTION_ID,
            projectId: PROJECT_ID,
            incidentId: INCIDENT_ID,
          } as unknown as AutoRemediationSuggestion,
          plan: PLAN,
        }),
      ).toBe(PLAN);
      expect(withTrackRecords).not.toHaveBeenCalled();
    });
  });
});

describe("a fix through the project's MCP servers", () => {
  beforeEach(() => {
    readsSuggestion(
      suggestionRow({
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
      }),
    );
    jest
      .spyOn(RemediationExecutionRunner, "checkProjectGates")
      .mockResolvedValue(null as never);

    const server: ExternalMcpServer = new ExternalMcpServer(
      ObjectID.generate(),
    );
    server.name = "Cloud console";
    server.projectId = PROJECT_ID;
    jest
      .spyOn(ExternalMcpServerService, "findServersForRun")
      .mockResolvedValue([server] as never);
  });

  async function run(): Promise<void> {
    await McpRemediationRunner.executeRun({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 1,
    });
  }

  test("OneUptime's own tools read for the incident's readers", async () => {
    readersOfAProject({ narrowedByLabels: true });
    const model: ModelReadingMonitors = modelReadsMonitors();

    await run();

    expect(model.toolProps).toEqual([readAudienceProps(narrowedReaders({}))]);
  });

  test("a monitor set apart never reaches what it posts; one nobody set apart does", async () => {
    readersOfAProject({ narrowedByLabels: true });
    modelReadsMonitors();

    await run();

    expect(everythingPosted()).toContain(OPEN_MONITOR_NAME);
    expect(everythingPosted()).not.toContain(SET_APART_MONITOR_NAME);
  });

  test("a project whose roles narrow nobody reads every monitor, as before", async () => {
    readersOfAProject({ narrowedByLabels: false });
    modelReadsMonitors();

    await run();

    expect(everythingPosted()).toContain(SET_APART_MONITOR_NAME);
  });
});
