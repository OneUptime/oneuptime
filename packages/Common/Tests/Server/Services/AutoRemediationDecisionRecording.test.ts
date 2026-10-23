import AutoRemediationRuleEngineService, {
  MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR,
  MAX_SUGGESTIONS_PER_SUBJECT,
  hasMcpFix,
  isDefaultRunbookPick,
  mayMcpFixChangeWithoutAsking,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationDecisionService from "../../../Server/Services/AutoRemediationDecisionService";
import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import RunbookService from "../../../Server/Services/RunbookService";
import ExternalMcpServerService from "../../../Server/Services/ExternalMcpServerService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import logger from "../../../Server/Utils/Logger";
import Alert from "../../../Models/DatabaseModels/Alert";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import { ExternalMcpServerAllowance } from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

/*
 * Contract under test - the rule engine writes down what it did with every
 * incident and alert, so the signal's Remediation card can say why nothing
 * was fixed instead of hiding itself:
 *
 * - every evaluation saves exactly one Evaluated AutoRemediationDecision
 *   for its subject, however it ends - acting, finding nothing to do, or
 *   stopping on an error (which is recorded, after what came before it);
 * - each fix path says what it did or why it did nothing: Enable AI, the
 *   per-signal cap, every linked Kubernetes cluster (fixes off, not ready
 *   with the gaps that block fixes, already has a round, started, could
 *   not start, out of budget), every linked infrastructure resource (the
 *   same, plus "another resource got the one round"), and every rule
 *   (none set up, none matched, already proposed, no LLM provider, AI
 *   composing / picking, proposed, started, could not start, circuit
 *   breaker, no runbooks, out of budget);
 * - a signal linked to nothing names its monitors, read once, project-
 *   scoped, so the card can send the reader to link them;
 * - a project that cannot be read saves nothing; a failed save never fails
 *   the evaluation;
 * - the create hook either evaluates now or, with an AI investigation
 *   queued, records that remediation waits for it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const ALERT_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CLUSTER_A: string = "33333333-3333-4333-8333-333333333331";
const CLUSTER_B: string = "33333333-3333-4333-8333-333333333332";
const CLUSTER_C: string = "33333333-3333-4333-8333-333333333333";
const RESOURCE_A: string = "55555555-5555-4555-8555-555555555551";
const RESOURCE_B: string = "55555555-5555-4555-8555-555555555552";
const RESOURCE_C: string = "55555555-5555-4555-8555-555555555553";
const RESOURCE_D: string = "55555555-5555-4555-8555-555555555554";
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111112",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666661",
);
const OTHER_RUNBOOK_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666662",
);

type EngineInternals = {
  startClusterCommandRun: (data: unknown) => Promise<boolean>;
  startResourceCommandRun: (data: unknown) => Promise<boolean>;
  startAiCommandRun: (data: unknown) => Promise<boolean>;
  startAiPlanning: (data: unknown) => Promise<boolean>;
  suggestRunbook: (data: unknown) => Promise<void>;
  autoExecuteRunbook: (data: unknown) => Promise<boolean>;
  startMcpFix: (data: unknown) => Promise<boolean>;
};

const engine: EngineInternals =
  AutoRemediationRuleEngineService as unknown as EngineInternals;

function cluster(
  id: string,
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: id,
    clusterName: `cluster-${id.slice(-1)}`,
    runner: null,
    accessMethod: "ai_agent",
    aiAgent: null,
    automaticInvestigation: { incidents: true, alerts: true },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Automatic,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  } as KubernetesClusterAiAccessStatus;
}

function gap(
  code: string,
  blocks: KubernetesAiAccessGap["blocks"],
): KubernetesAiAccessGap {
  return {
    code: code as KubernetesAiAccessGap["code"],
    title: `${code} title`,
    description: `${code} description`,
    nextStep: `${code} next step`,
    blocks,
  };
}

function resource(
  id: string,
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: id,
    resourceName: `docker-${id.slice(-1)}`,
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    agent: null,
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  } as unknown as ResourceAiAccessStatus;
}

function runbook(id: ObjectID, name: string): Runbook {
  const model: Runbook = new Runbook();
  model._id = id.toString();
  model.name = name;
  return model;
}

function rule(
  overrides: Partial<AutoRemediationRule> = {},
): AutoRemediationRule {
  const model: AutoRemediationRule = new AutoRemediationRule();
  model._id = RULE_ID.toString();
  model.name = "Restart checkout";
  model.executionMode = AutoRemediationExecutionMode.Suggest;
  // A rule with no AI flag runs its runbooks, as it did before Fix With.
  model.remediationAction =
    overrides.aiSelectsRunbook || overrides.aiComposesCommands
      ? AutoRemediationAction.OneUptimeAI
      : AutoRemediationAction.Runbooks;
  model.runbooks = [runbook(RUNBOOK_ID, "Restart the checkout pods")];
  Object.assign(model, overrides);
  return model;
}

function incident(): Incident {
  return {
    id: INCIDENT_ID,
    _id: INCIDENT_ID.toString(),
    projectId: PROJECT_ID,
    title: "Checkout website is down",
    monitors: [{ id: MONITOR_ID, _id: MONITOR_ID.toString() }],
    labels: [],
  } as unknown as Incident;
}

function alert(): Alert {
  return {
    id: ALERT_ID,
    _id: ALERT_ID.toString(),
    projectId: PROJECT_ID,
    title: "Checkout website is down",
    monitorId: MONITOR_ID,
  } as unknown as Alert;
}

interface Harness {
  saved: Array<AutoRemediationDecision>;
  monitorReads: SpyInstance<typeof MonitorService.findBy>;
  clusterStatuses: SpyInstance<
    typeof KubernetesClusterAiAccessService.getStatusesForSubject
  >;
  resourceStatuses: SpyInstance<
    typeof ResourceAiAccessService.getStatusesForSubject
  >;
}

function mockEngine(data: {
  enableAi?: boolean | undefined;
  // "Fix new incidents automatically" and its alert twin; on unless said.
  remediationOn?: boolean | undefined;
  projectMissing?: boolean | undefined;
  existing?: Array<AutoRemediationSuggestion> | undefined;
  clusters?: Array<KubernetesClusterAiAccessStatus> | Error | undefined;
  resources?: Array<ResourceAiAccessStatus> | Error | undefined;
  rules?: Array<AutoRemediationRule> | Error | undefined;
  matchingRuleIds?: Array<string> | undefined;
  hasLlmProvider?: boolean | undefined;
  autoExecutedInLastHour?: number | undefined;
  /*
   * How many enabled runbooks OneUptime AI could pick from. None unless
   * said: with none, OneUptime AI picks no runbook and says nothing of it.
   */
  enabledRunbooks?: number | undefined;
  /*
   * Whether an external MCP server the fix may use could make it. No
   * unless said: with none, OneUptime AI starts no fix through them and
   * says nothing of it.
   */
  mcpServersMayFix?: boolean | Error | undefined;
}): Harness {
  const saved: Array<AutoRemediationDecision> = [];

  // The runbooks the rules name are the project's (RuleRecordScope).
  stubProjectDirectory({});

  for (const level of ["error", "warn", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
    data.projectMissing
      ? null
      : ({
          enableAi: data.enableAi ?? true,
          enableAutomaticIncidentRemediation: data.remediationOn ?? true,
          enableAutomaticAlertRemediation: data.remediationOn ?? true,
        } as unknown as Project),
  );
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockResolvedValue(data.existing || []);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(data.autoExecutedInLastHour || 0));

  const clusterStatuses: Harness["clusterStatuses"] = jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
    .mockImplementation(async () => {
      if (data.clusters instanceof Error) {
        throw data.clusters;
      }
      return data.clusters || [];
    });
  const resourceStatuses: Harness["resourceStatuses"] = jest
    .spyOn(ResourceAiAccessService, "getStatusesForSubject")
    .mockImplementation(async () => {
      if (data.resources instanceof Error) {
        throw data.resources;
      }
      return data.resources || [];
    });

  jest
    .spyOn(AutoRemediationRuleService, "findBy")
    .mockImplementation(async () => {
      if (data.rules instanceof Error) {
        throw data.rules;
      }
      return data.rules || [];
    });
  jest
    .spyOn(AutoRemediationRuleEngineService, "doesIncidentMatchRule")
    .mockImplementation(async (_subject: Incident, r: AutoRemediationRule) => {
      return (data.matchingRuleIds || []).includes(r.id?.toString() || "");
    });
  jest
    .spyOn(AutoRemediationRuleEngineService, "doesAlertMatchRule")
    .mockImplementation(async (_subject: Alert, r: AutoRemediationRule) => {
      return (data.matchingRuleIds || []).includes(r.id?.toString() || "");
    });
  jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockResolvedValue(
      data.hasLlmProvider ? (new LlmProvider() as never) : (null as never),
    );
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(RunbookService, "countBy")
    .mockResolvedValue(new PositiveNumber(data.enabledRunbooks || 0));
  jest
    .spyOn(ExternalMcpServerService, "hasServersThatMayFix")
    .mockImplementation(async () => {
      if (data.mcpServersMayFix instanceof Error) {
        throw data.mcpServersMayFix;
      }
      return data.mcpServersMayFix === true;
    });

  const monitorReads: Harness["monitorReads"] = jest
    .spyOn(MonitorService, "findBy")
    .mockResolvedValue([
      Object.assign(new Monitor(), {
        _id: MONITOR_ID.toString(),
        name: "Checkout website",
      }),
    ]);

  jest
    .spyOn(AutoRemediationDecisionService, "create")
    .mockImplementation(async (createBy: unknown) => {
      const decision: AutoRemediationDecision = (
        createBy as { data: AutoRemediationDecision }
      ).data;
      saved.push(decision);
      return decision;
    });

  return { saved, monitorReads, clusterStatuses, resourceStatuses };
}

function entriesOf(harness: Harness): Array<AutoRemediationDecisionEntry> {
  expect(harness.saved).toHaveLength(1);
  return (harness.saved[0]!.entries ||
    []) as unknown as Array<AutoRemediationDecisionEntry>;
}

function reasonsOf(harness: Harness): Array<string> {
  return entriesOf(harness).map((entry: AutoRemediationDecisionEntry) => {
    return entry.reason;
  });
}

function entryFor(
  harness: Harness,
  reason: AutoRemediationDecisionReason,
): AutoRemediationDecisionEntry {
  const entry: AutoRemediationDecisionEntry | undefined = entriesOf(
    harness,
  ).find((candidate: AutoRemediationDecisionEntry): boolean => {
    return candidate.reason === reason;
  });
  expect(entry).toBeDefined();
  return entry!;
}

describe("AutoRemediationRuleEngineService records its decision", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("project", () => {
    it("says Enable AI is off, and reads no fix path", async () => {
      const harness: Harness = mockEngine({ enableAi: false });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.EnableAiOff,
      ]);
      const decision: AutoRemediationDecision = harness.saved[0]!;
      expect(decision.stage).toBe(AutoRemediationDecisionStage.Evaluated);
      expect(decision.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(decision.incidentId?.toString()).toBe(INCIDENT_ID.toString());
      expect(decision.alertId).toBeUndefined();
      expect(entriesOf(harness)[0]!.lane).toBe(
        AutoRemediationDecisionLane.Project,
      );
      expect(harness.clusterStatuses).not.toHaveBeenCalled();
      expect(harness.resourceStatuses).not.toHaveBeenCalled();
    });

    it("saves nothing when the project cannot be read", async () => {
      const harness: Harness = mockEngine({ projectMissing: true });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(harness.saved).toHaveLength(0);
    });

    it("says the signal already has the most suggestions it can get", async () => {
      const existing: Array<AutoRemediationSuggestion> = Array.from(
        { length: MAX_SUGGESTIONS_PER_SUBJECT },
        () => {
          return new AutoRemediationSuggestion();
        },
      );
      const harness: Harness = mockEngine({ existing });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.SuggestionLimitReached,
      ]);
      expect(harness.clusterStatuses).not.toHaveBeenCalled();
    });

    it("records an error after what came before it, saves, and does not throw", async () => {
      jest
        .spyOn(engine, "suggestRunbook")
        .mockRejectedValue(new Error("suggestion table is gone"));
      const harness: Harness = mockEngine({
        clusters: [
          cluster(CLUSTER_A, {
            remediationMode: KubernetesAiRemediationMode.Disabled,
            isRemediationReady: false,
          }),
        ],
        rules: [
          rule({
            remediationAction: AutoRemediationAction.OneUptimeAI,
            executionMode: AutoRemediationExecutionMode.FullAuto,
            runbooks: [],
          }),
          rule({ _id: OTHER_RULE_ID.toString() }),
        ],
        matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
      });

      await expect(
        AutoRemediationRuleEngineService.applyRulesToIncident(incident()),
      ).resolves.toBeUndefined();

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.ClusterFixesOff,
        AutoRemediationDecisionReason.ResourceNoneLinked,
        AutoRemediationDecisionReason.RuleMatchedAiFix,
        AutoRemediationDecisionReason.EvaluationFailed,
      ]);
      expect(
        entryFor(harness, AutoRemediationDecisionReason.EvaluationFailed).lane,
      ).toBe(AutoRemediationDecisionLane.Project);
    });

    /*
     * The rules decide which signals are fixed, so they are read before any
     * cluster or resource is: a failure to read them fixes nothing (and
     * says so), rather than fixing a signal no rule may have meant.
     */
    it("fixes nothing when the rules cannot be read, and says an error stopped it", async () => {
      const harness: Harness = mockEngine({
        clusters: [
          cluster(CLUSTER_A, {
            remediationMode: KubernetesAiRemediationMode.Disabled,
            isRemediationReady: false,
          }),
        ],
        rules: new Error("rules table is gone"),
      });

      await expect(
        AutoRemediationRuleEngineService.applyRulesToIncident(incident()),
      ).resolves.toBeUndefined();

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.EvaluationFailed,
      ]);
      expect(harness.clusterStatuses).not.toHaveBeenCalled();
      expect(
        entryFor(harness, AutoRemediationDecisionReason.EvaluationFailed).lane,
      ).toBe(AutoRemediationDecisionLane.Project);
    });

    it("never fails the evaluation when the decision cannot be saved", async () => {
      mockEngine({});
      jest
        .spyOn(AutoRemediationDecisionService, "create")
        .mockRejectedValue(new Error("database is down"));

      await expect(
        AutoRemediationRuleEngineService.applyRulesToIncident(incident()),
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("linked to nothing", () => {
    it("names the signal's monitors on both lanes, read once and project-scoped", async () => {
      const harness: Harness = mockEngine({});

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      // No rule set up: every incident is in scope, and that needs no line.
      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.ClusterNoneLinked,
        AutoRemediationDecisionReason.ResourceNoneLinked,
      ]);

      const monitors: Array<{ id: string; name: string }> = [
        { id: MONITOR_ID.toString(), name: "Checkout website" },
      ];
      expect(
        entryFor(harness, AutoRemediationDecisionReason.ClusterNoneLinked)
          .monitors,
      ).toEqual(monitors);
      expect(
        entryFor(harness, AutoRemediationDecisionReason.ResourceNoneLinked)
          .monitors,
      ).toEqual(monitors);

      expect(harness.monitorReads).toHaveBeenCalledTimes(1);
      const query: Record<string, unknown> = harness.monitorReads.mock
        .calls[0]![0].query as Record<string, unknown>;
      expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
      expect(harness.monitorReads.mock.calls[0]![0].props).toEqual({
        isRoot: true,
      });
    });

    it("names monitors the create hook holds as bare rows", async () => {
      const harness: Harness = mockEngine({});

      await AutoRemediationRuleEngineService.applyRulesToIncident({
        ...incident(),
        monitors: [{ _id: MONITOR_ID.toString() }],
      } as unknown as Incident);

      expect(harness.monitorReads).toHaveBeenCalledTimes(1);
      expect(
        entryFor(harness, AutoRemediationDecisionReason.ClusterNoneLinked)
          .monitors,
      ).toEqual([{ id: MONITOR_ID.toString(), name: "Checkout website" }]);
    });

    it("names the monitor an alert came from", async () => {
      const harness: Harness = mockEngine({});

      await AutoRemediationRuleEngineService.applyRulesToAlert(alert());

      const decision: AutoRemediationDecision = harness.saved[0]!;
      expect(decision.alertId?.toString()).toBe(ALERT_ID.toString());
      expect(decision.incidentId).toBeUndefined();
      expect(
        entryFor(harness, AutoRemediationDecisionReason.ClusterNoneLinked)
          .monitors,
      ).toEqual([{ id: MONITOR_ID.toString(), name: "Checkout website" }]);
    });

    it("names no monitor, and reads none, for a signal without one", async () => {
      const harness: Harness = mockEngine({});

      await AutoRemediationRuleEngineService.applyRulesToIncident({
        ...incident(),
        monitors: [],
      } as unknown as Incident);

      // An empty list is not stored at all.
      expect(
        entryFor(harness, AutoRemediationDecisionReason.ClusterNoneLinked)
          .monitors,
      ).toBeUndefined();
      expect(harness.monitorReads).not.toHaveBeenCalled();
    });
  });

  describe("Kubernetes clusters", () => {
    it("says fixes are off, and which gaps block a cluster whose fixes are on", async () => {
      const harness: Harness = mockEngine({
        clusters: [
          cluster(CLUSTER_A, {
            remediationMode: KubernetesAiRemediationMode.Disabled,
            isRemediationReady: false,
          }),
          cluster(CLUSTER_B, {
            remediationMode: KubernetesAiRemediationMode.RequireApproval,
            isRemediationReady: false,
            gaps: [
              gap("investigation_disabled", "investigation"),
              gap("remediation_write_access_missing", "remediation"),
              gap("ai_agent_not_connected", "both"),
            ],
          }),
        ],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(
        entryFor(harness, AutoRemediationDecisionReason.ClusterFixesOff),
      ).toMatchObject({
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        kubernetesClusterId: CLUSTER_A,
        kubernetesClusterName: "cluster-1",
        remediationMode: KubernetesAiRemediationMode.Disabled,
      });

      const notReady: AutoRemediationDecisionEntry = entryFor(
        harness,
        AutoRemediationDecisionReason.ClusterNotReady,
      );
      expect(notReady.kubernetesClusterId).toBe(CLUSTER_B);
      expect(notReady.remediationMode).toBe(
        KubernetesAiRemediationMode.RequireApproval,
      );
      // Only what blocks fixes - an investigation-only gap is left out.
      expect(notReady.gaps).toEqual([
        {
          code: "remediation_write_access_missing",
          title: "remediation_write_access_missing title",
          description: "remediation_write_access_missing description",
          nextStep: "remediation_write_access_missing next step",
        },
        {
          code: "ai_agent_not_connected",
          title: "ai_agent_not_connected title",
          description: "ai_agent_not_connected description",
          nextStep: "ai_agent_not_connected next step",
        },
      ]);
    });

    it("says a round started on a ready cluster, in its mode, and that resources were left to it", async () => {
      jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(true);
      const harness: Harness = mockEngine({
        clusters: [
          cluster(CLUSTER_A, {
            remediationMode: KubernetesAiRemediationMode.BypassApproval,
          }),
        ],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.ClusterRoundStarted,
        AutoRemediationDecisionReason.ResourceSkippedForClusterRound,
      ]);
      expect(
        entryFor(harness, AutoRemediationDecisionReason.ClusterRoundStarted),
      ).toMatchObject({
        kubernetesClusterId: CLUSTER_A,
        kubernetesClusterName: "cluster-1",
        remediationMode: KubernetesAiRemediationMode.BypassApproval,
      });
      expect(harness.resourceStatuses).not.toHaveBeenCalled();
    });

    it("says a round could not start, and still tries the resources", async () => {
      jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(false);
      const harness: Harness = mockEngine({ clusters: [cluster(CLUSTER_A)] });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.ClusterRoundNotStarted,
        AutoRemediationDecisionReason.ResourceNoneLinked,
      ]);
      expect(harness.resourceStatuses).toHaveBeenCalledTimes(1);
    });

    it("says a cluster already has a round, and leaves the resources to it", async () => {
      const startCluster: SpyInstance<
        EngineInternals["startClusterCommandRun"]
      > = jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(true);
      const existingRound: AutoRemediationSuggestion = Object.assign(
        new AutoRemediationSuggestion(),
        { kubernetesClusterId: new ObjectID(CLUSTER_A) },
      );
      const harness: Harness = mockEngine({
        existing: [existingRound],
        clusters: [cluster(CLUSTER_A)],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.ClusterAlreadyHasRound,
        AutoRemediationDecisionReason.ResourceSkippedForOtherRound,
      ]);
      expect(startCluster).not.toHaveBeenCalled();
    });

    it("says the clusters could not be checked", async () => {
      const harness: Harness = mockEngine({
        clusters: new Error("cluster table is locked"),
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)[0]).toBe(
        AutoRemediationDecisionReason.ClusterLookupFailed,
      );
    });

    it("says which clusters ran out of budget, and that resources were not tried", async () => {
      jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(true);
      const harness: Harness = mockEngine({
        // One suggestion already: two rounds left for three clusters.
        existing: [new AutoRemediationSuggestion()],
        clusters: [cluster(CLUSTER_A), cluster(CLUSTER_B), cluster(CLUSTER_C)],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      // No rule set up, so no rule waits on the budget either.
      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.ClusterRoundStarted,
        AutoRemediationDecisionReason.ClusterRoundStarted,
        AutoRemediationDecisionReason.ClusterSkippedLimit,
        AutoRemediationDecisionReason.ResourceSkippedLimit,
      ]);
      expect(
        entryFor(harness, AutoRemediationDecisionReason.ClusterSkippedLimit)
          .kubernetesClusterId,
      ).toBe(CLUSTER_C);
    });
  });

  describe("infrastructure resources", () => {
    it("says what each linked resource did: off, blocked, chosen, and not chosen", async () => {
      const startResource: SpyInstance<
        EngineInternals["startResourceCommandRun"]
      > = jest.spyOn(engine, "startResourceCommandRun").mockResolvedValue(true);
      const harness: Harness = mockEngine({
        resources: [
          resource(RESOURCE_A, {
            aiRemediationMode: ResourceAiRemediationMode.Disabled,
            isRemediationReady: false,
          }),
          resource(RESOURCE_B, {
            isRemediationReady: false,
            gaps: [
              {
                code: "agent_offline",
                title: "The agent is offline",
                nextStep: "Start the agent",
                blocksInvestigation: true,
                blocksRemediation: true,
              },
              {
                code: "investigation_disabled",
                title: "Investigation is off",
                nextStep: "Turn it on",
                blocksInvestigation: true,
                blocksRemediation: false,
              },
            ] as unknown as ResourceAiAccessStatus["gaps"],
          }),
          resource(RESOURCE_C, {
            resourceType: AiResourceType.Host,
            resourceName: "web-host",
          }),
          resource(RESOURCE_D, {
            aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
          }),
        ],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(
        entryFor(harness, AutoRemediationDecisionReason.ResourceFixesOff),
      ).toMatchObject({
        lane: AutoRemediationDecisionLane.Resource,
        resourceId: RESOURCE_A,
        resourceType: AiResourceType.DockerHost,
      });
      expect(
        entryFor(harness, AutoRemediationDecisionReason.ResourceNotReady).gaps,
      ).toEqual([
        {
          code: "agent_offline",
          title: "The agent is offline",
          nextStep: "Start the agent",
        },
      ]);

      // The Docker host comes first in the AI resource order, so it is the one.
      expect(
        entryFor(harness, AutoRemediationDecisionReason.ResourceRoundStarted),
      ).toMatchObject({
        resourceId: RESOURCE_D,
        remediationMode: ResourceAiRemediationMode.RequireApproval,
      });
      expect(
        entryFor(harness, AutoRemediationDecisionReason.ResourceNotChosen),
      ).toMatchObject({
        resourceId: RESOURCE_C,
        resourceType: AiResourceType.Host,
        resourceName: "web-host",
      });
      expect(startResource).toHaveBeenCalledTimes(1);
    });

    it("says a resource round could not start, whether it returned false or threw", async () => {
      jest.spyOn(engine, "startResourceCommandRun").mockResolvedValue(false);
      let harness: Harness = mockEngine({ resources: [resource(RESOURCE_A)] });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(
        entryFor(harness, AutoRemediationDecisionReason.ResourceRoundNotStarted)
          .resourceId,
      ).toBe(RESOURCE_A);

      jest.restoreAllMocks();
      jest
        .spyOn(engine, "startResourceCommandRun")
        .mockRejectedValue(new Error("queue is down"));
      harness = mockEngine({ resources: [resource(RESOURCE_A)] });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(
        entryFor(harness, AutoRemediationDecisionReason.ResourceRoundNotStarted)
          .resourceId,
      ).toBe(RESOURCE_A);
    });

    it("says the resources could not be checked", async () => {
      const harness: Harness = mockEngine({
        resources: new Error("resource lookup failed"),
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.ResourceLookupFailed,
      );
    });
  });

  describe("AI rules", () => {
    /*
     * An AI rule that only investigates ("Don't fix") fixes nothing it
     * matches: with rules, a signal is fixed only when a rule that fixes
     * matches it (Types/AI/AiRule). Its Remediation card says which rule
     * matched, and why nothing was fixed.
     */
    it("reads whether each rule fixes", async () => {
      const harness: Harness = mockEngine({
        rules: [rule()],
        matchingRuleIds: [],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(
        (
          AutoRemediationRuleService.findBy as unknown as {
            mock: { calls: Array<Array<{ select?: Record<string, unknown> }>> };
          }
        ).mock.calls[0]![0]!.select,
      ).toMatchObject({ fixes: true });
      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.NotMatchedByAnyRule,
      ]);
    });

    it("a signal that matches only rules that do not fix is not fixed, and says which rule matched", async () => {
      const suggest: SpyInstance<EngineInternals["suggestRunbook"]> = jest
        .spyOn(engine, "suggestRunbook")
        .mockResolvedValue(undefined);
      const harness: Harness = mockEngine({
        clusters: [cluster(CLUSTER_A)],
        rules: [
          rule({ name: "Payments: investigate only", fixes: false }),
          rule({
            _id: OTHER_RULE_ID.toString(),
            name: "Checkout: investigate only",
            fixes: false,
          }),
        ],
        matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.MatchedRulesDoNotFix,
      ]);
      expect(
        entryFor(harness, AutoRemediationDecisionReason.MatchedRulesDoNotFix),
      ).toMatchObject({
        lane: AutoRemediationDecisionLane.Rule,
        ruleId: RULE_ID.toString(),
        ruleName: "Payments: investigate only",
        rulesChecked: 2,
      });
      // Nothing is fixed: no runbook, no cluster round.
      expect(suggest).not.toHaveBeenCalled();
      expect(harness.clusterStatuses).not.toHaveBeenCalled();
    });

    it("a rule that fixes acts on its match, whatever rules that do not fix also match", async () => {
      const suggest: SpyInstance<EngineInternals["suggestRunbook"]> = jest
        .spyOn(engine, "suggestRunbook")
        .mockResolvedValue(undefined);
      const harness: Harness = mockEngine({
        rules: [
          rule({
            _id: OTHER_RULE_ID.toString(),
            name: "Payments: investigate only",
            fixes: false,
          }),
          rule({ fixes: true }),
        ],
        matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).not.toContain(
        AutoRemediationDecisionReason.MatchedRulesDoNotFix,
      );
      expect(
        entryFor(harness, AutoRemediationDecisionReason.RuleRunbookProposed),
      ).toMatchObject({
        ruleId: RULE_ID.toString(),
        ruleName: "Restart checkout",
      });
      // Only the rule that fixes proposed anything.
      expect(suggest).toHaveBeenCalledTimes(1);
    });

    it("a rule read without the column fixes, as every auto remediation rule did", async () => {
      const suggest: SpyInstance<EngineInternals["suggestRunbook"]> = jest
        .spyOn(engine, "suggestRunbook")
        .mockResolvedValue(undefined);
      const harness: Harness = mockEngine({
        rules: [rule()],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.RuleRunbookProposed,
      );
      expect(suggest).toHaveBeenCalledTimes(1);
    });

    it("an alert that matches only rules that do not fix is not fixed either", async () => {
      const harness: Harness = mockEngine({
        rules: [rule({ name: "Payments: investigate only", fixes: false })],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToAlert(alert());

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.MatchedRulesDoNotFix,
      ]);
      expect(
        entryFor(harness, AutoRemediationDecisionReason.MatchedRulesDoNotFix)
          .rulesChecked,
      ).toBe(1);
    });

    it("rules that do not fix and do not match leave the signal unfixed, counted with the rest", async () => {
      const harness: Harness = mockEngine({
        rules: [
          rule({ fixes: false }),
          rule({ _id: OTHER_RULE_ID.toString(), fixes: true }),
        ],
        matchingRuleIds: [],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.NotMatchedByAnyRule,
      ]);
      expect(
        entryFor(harness, AutoRemediationDecisionReason.NotMatchedByAnyRule)
          .rulesChecked,
      ).toBe(2);
    });

    it("says how many rules were checked when none matched, and fixes nothing else", async () => {
      const harness: Harness = mockEngine({
        clusters: [cluster(CLUSTER_A)],
        rules: [rule(), rule({ _id: OTHER_RULE_ID.toString() })],
        matchingRuleIds: [],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.NotMatchedByAnyRule,
      ]);
      expect(
        entryFor(harness, AutoRemediationDecisionReason.NotMatchedByAnyRule),
      ).toMatchObject({
        lane: AutoRemediationDecisionLane.Rule,
        rulesChecked: 2,
      });
      // With rules set up, a signal none of them matches is not fixed at all.
      expect(harness.clusterStatuses).not.toHaveBeenCalled();
    });

    it("says fixing is off, and reads nothing else, while the switch is off", async () => {
      const harness: Harness = mockEngine({
        remediationOn: false,
        clusters: [cluster(CLUSTER_A)],
        rules: [rule()],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.RemediationOff,
      ]);
      expect(
        entryFor(harness, AutoRemediationDecisionReason.RemediationOff).lane,
      ).toBe(AutoRemediationDecisionLane.Project);
      expect(harness.clusterStatuses).not.toHaveBeenCalled();
    });

    it("says a matching runbook rule leaves the clusters alone", async () => {
      jest.spyOn(engine, "suggestRunbook").mockResolvedValue(undefined);
      const harness: Harness = mockEngine({
        clusters: [cluster(CLUSTER_A)],
        rules: [rule()],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)[0]).toBe(
        AutoRemediationDecisionReason.NoAiFixRuleMatched,
      );
      expect(harness.clusterStatuses).not.toHaveBeenCalled();
    });

    it.each([
      [AutoRemediationExecutionMode.FullAuto, "RuleMatchedAiFix"],
      [AutoRemediationExecutionMode.Suggest, "RuleMatchedAiFixAsks"],
    ])(
      "says a matching %s OneUptime AI rule has OneUptime AI fix the signal",
      async (mode: AutoRemediationExecutionMode, reason: string) => {
        jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(true);
        const harness: Harness = mockEngine({
          clusters: [cluster(CLUSTER_A)],
          rules: [
            rule({
              remediationAction: AutoRemediationAction.OneUptimeAI,
              executionMode: mode,
              runbooks: [],
            }),
          ],
          matchingRuleIds: [RULE_ID.toString()],
        });

        await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

        expect(reasonsOf(harness)).toContain(
          AutoRemediationDecisionReason.ClusterRoundStarted,
        );
        expect(
          entryFor(harness, reason as AutoRemediationDecisionReason),
        ).toMatchObject({
          lane: AutoRemediationDecisionLane.Rule,
          ruleName: "Restart checkout",
        });
      },
    );

    it("names the rule and each runbook it proposed", async () => {
      const suggest: SpyInstance<EngineInternals["suggestRunbook"]> = jest
        .spyOn(engine, "suggestRunbook")
        .mockResolvedValue(undefined);
      const harness: Harness = mockEngine({
        rules: [
          rule({
            runbooks: [
              runbook(RUNBOOK_ID, "Restart the checkout pods"),
              runbook(OTHER_RUNBOOK_ID, "Flush the CDN"),
            ],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      const proposed: Array<AutoRemediationDecisionEntry> = entriesOf(
        harness,
      ).filter((entry: AutoRemediationDecisionEntry): boolean => {
        return (
          entry.reason === AutoRemediationDecisionReason.RuleRunbookProposed
        );
      });
      expect(proposed).toEqual([
        expect.objectContaining({
          ruleId: RULE_ID.toString(),
          ruleName: "Restart checkout",
          runbookId: RUNBOOK_ID.toString(),
          runbookName: "Restart the checkout pods",
        }),
        expect.objectContaining({
          runbookId: OTHER_RUNBOOK_ID.toString(),
          runbookName: "Flush the CDN",
        }),
      ]);
      expect(suggest).toHaveBeenCalledTimes(2);
    });

    it("says a Full Auto rule started its runbook, or could not", async () => {
      jest.spyOn(engine, "autoExecuteRunbook").mockResolvedValue(true);
      let harness: Harness = mockEngine({
        rules: [rule({ executionMode: AutoRemediationExecutionMode.FullAuto })],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(
        entryFor(harness, AutoRemediationDecisionReason.RuleRunbookStarted),
      ).toMatchObject({
        ruleName: "Restart checkout",
        runbookName: "Restart the checkout pods",
      });

      jest.restoreAllMocks();
      jest.spyOn(engine, "autoExecuteRunbook").mockResolvedValue(false);
      harness = mockEngine({
        rules: [rule({ executionMode: AutoRemediationExecutionMode.FullAuto })],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.RuleRunbookNotStarted,
      );
    });

    it("says a Full Auto rule proposed instead of starting once its circuit breaker tripped", async () => {
      const autoExecute: SpyInstance<EngineInternals["autoExecuteRunbook"]> =
        jest.spyOn(engine, "autoExecuteRunbook").mockResolvedValue(true);
      jest.spyOn(engine, "suggestRunbook").mockResolvedValue(undefined);
      const harness: Harness = mockEngine({
        rules: [rule({ executionMode: AutoRemediationExecutionMode.FullAuto })],
        matchingRuleIds: [RULE_ID.toString()],
        autoExecutedInLastHour: MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR,
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.RuleRunbookProposedByCircuitBreaker,
      );
      expect(autoExecute).not.toHaveBeenCalled();
    });

    it("says an AI rule was skipped for want of an LLM provider", async () => {
      const harness: Harness = mockEngine({
        rules: [rule({ aiComposesCommands: true })],
        matchingRuleIds: [RULE_ID.toString()],
        hasLlmProvider: false,
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(
        entryFor(
          harness,
          AutoRemediationDecisionReason.RuleSkippedNoLlmProvider,
        ).ruleName,
      ).toBe("Restart checkout");
    });

    it("says AI is composing commands, or that its run could not start", async () => {
      jest.spyOn(engine, "startAiCommandRun").mockResolvedValue(true);
      let harness: Harness = mockEngine({
        rules: [rule({ aiComposesCommands: true })],
        matchingRuleIds: [RULE_ID.toString()],
        hasLlmProvider: true,
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.RuleAiComposingCommands,
      );

      jest.restoreAllMocks();
      jest.spyOn(engine, "startAiCommandRun").mockResolvedValue(false);
      harness = mockEngine({
        rules: [rule({ aiComposesCommands: true })],
        matchingRuleIds: [RULE_ID.toString()],
        hasLlmProvider: true,
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.RuleAiRunNotStarted,
      );
    });

    it("says AI is picking the runbook", async () => {
      jest.spyOn(engine, "startAiPlanning").mockResolvedValue(true);
      const harness: Harness = mockEngine({
        rules: [rule({ aiSelectsRunbook: true })],
        matchingRuleIds: [RULE_ID.toString()],
        hasLlmProvider: true,
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.RuleAiPickingRunbook,
      );
    });

    it("says a rule already proposed, and one with nothing to run did nothing", async () => {
      const proposed: AutoRemediationSuggestion = Object.assign(
        new AutoRemediationSuggestion(),
        { autoRemediationRuleId: RULE_ID },
      );
      const harness: Harness = mockEngine({
        existing: [proposed],
        rules: [
          rule(),
          rule({
            _id: OTHER_RULE_ID.toString(),
            name: "Empty rule",
            runbooks: [],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(
        entryFor(harness, AutoRemediationDecisionReason.RuleAlreadyProposed)
          .ruleId,
      ).toBe(RULE_ID.toString());
      expect(
        entryFor(harness, AutoRemediationDecisionReason.RuleHasNoRunbooks)
          .ruleName,
      ).toBe("Empty rule");
    });

    it("says which matched rule ran out of budget", async () => {
      jest.spyOn(engine, "suggestRunbook").mockResolvedValue(undefined);
      const harness: Harness = mockEngine({
        // Two suggestions already: one left, for the first rule's runbook.
        existing: [
          new AutoRemediationSuggestion(),
          new AutoRemediationSuggestion(),
        ],
        rules: [
          rule(),
          rule({ _id: OTHER_RULE_ID.toString(), name: "Second rule" }),
        ],
        matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(
        entryFor(harness, AutoRemediationDecisionReason.RuleRunbookProposed)
          .ruleId,
      ).toBe(RULE_ID.toString());
      expect(
        entryFor(harness, AutoRemediationDecisionReason.RuleSkippedLimit)
          .ruleName,
      ).toBe("Second rule");
    });
  });

  it("saves exactly one decision per evaluation", async () => {
    jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(true);
    jest.spyOn(engine, "suggestRunbook").mockResolvedValue(undefined);
    const harness: Harness = mockEngine({
      clusters: [cluster(CLUSTER_A)],
      rules: [rule()],
      matchingRuleIds: [RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(harness.saved).toHaveLength(1);
    expect(AutoRemediationDecisionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ props: { isRoot: true } }),
    );
  });
});

describe("AutoRemediationRuleEngineService on a new incident or alert", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("evaluates a new incident at once when no investigation was queued", async () => {
    const apply: SpyInstance<
      typeof AutoRemediationRuleEngineService.applyRulesToIncident
    > = jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(undefined);
    const create: SpyInstance<typeof AutoRemediationDecisionService.create> =
      jest.spyOn(AutoRemediationDecisionService, "create");

    await AutoRemediationRuleEngineService.onIncidentCreated({
      incident: incident(),
      isInvestigationQueued: false,
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("records that a new incident's remediation waits for its investigation", async () => {
    const apply: SpyInstance<
      typeof AutoRemediationRuleEngineService.applyRulesToIncident
    > = jest.spyOn(AutoRemediationRuleEngineService, "applyRulesToIncident");
    const harness: Harness = mockEngine({});

    await AutoRemediationRuleEngineService.onIncidentCreated({
      incident: incident(),
      isInvestigationQueued: true,
    });

    expect(apply).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]!.stage).toBe(
      AutoRemediationDecisionStage.WaitingForInvestigation,
    );
    expect(harness.saved[0]!.entries).toEqual([]);
    expect(harness.saved[0]!.incidentId?.toString()).toBe(
      INCIDENT_ID.toString(),
    );
  });

  it("evaluates a new alert at once, or records that it waits", async () => {
    const apply: SpyInstance<
      typeof AutoRemediationRuleEngineService.applyRulesToAlert
    > = jest
      .spyOn(AutoRemediationRuleEngineService, "applyRulesToAlert")
      .mockResolvedValue(undefined);
    const harness: Harness = mockEngine({});

    await AutoRemediationRuleEngineService.onAlertCreated({
      alert: alert(),
      isInvestigationQueued: false,
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(harness.saved).toHaveLength(0);

    await AutoRemediationRuleEngineService.onAlertCreated({
      alert: alert(),
      isInvestigationQueued: true,
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]!.stage).toBe(
      AutoRemediationDecisionStage.WaitingForInvestigation,
    );
    expect(harness.saved[0]!.alertId?.toString()).toBe(ALERT_ID.toString());
  });

  /*
   * "Remediation runs once the investigation finishes" is only true while
   * fixing is on: with it off, nothing is said until the evaluation that
   * follows the investigation says why nothing was fixed.
   */
  it.each([
    ["the incident fixing switch is off", { remediationOn: false }],
    ["Enable AI is off", { enableAi: false }],
  ])(
    "does not say a new incident waits for its investigation while %s",
    async (
      _label: string,
      project: { remediationOn?: boolean; enableAi?: boolean },
    ) => {
      const apply: SpyInstance<
        typeof AutoRemediationRuleEngineService.applyRulesToIncident
      > = jest.spyOn(AutoRemediationRuleEngineService, "applyRulesToIncident");
      const harness: Harness = mockEngine(project);

      await AutoRemediationRuleEngineService.onIncidentCreated({
        incident: incident(),
        isInvestigationQueued: true,
      });

      expect(apply).not.toHaveBeenCalled();
      expect(harness.saved).toHaveLength(0);
    },
  );

  it("an alert waits only while the alert switch is on, whatever the incident switch says", async () => {
    const harness: Harness = mockEngine({});
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: true,
      enableAutomaticIncidentRemediation: true,
      enableAutomaticAlertRemediation: false,
    } as unknown as Project);

    await AutoRemediationRuleEngineService.onAlertCreated({
      alert: alert(),
      isInvestigationQueued: true,
    });

    expect(harness.saved).toHaveLength(0);
  });

  it("still says it waits when the project cannot be read", async () => {
    const harness: Harness = mockEngine({});
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("database is down"));

    await AutoRemediationRuleEngineService.onIncidentCreated({
      incident: incident(),
      isInvestigationQueued: true,
    });

    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]!.stage).toBe(
      AutoRemediationDecisionStage.WaitingForInvestigation,
    );
  });

  it("never throws when the waiting record cannot be saved", async () => {
    mockEngine({});
    jest
      .spyOn(AutoRemediationDecisionService, "create")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      AutoRemediationRuleEngineService.onIncidentCreated({
        incident: incident(),
        isInvestigationQueued: true,
      }),
    ).resolves.toBeUndefined();
  });
});

/*
 * "Fix new incidents automatically" (and its alert twin) is the master
 * switch for fixing, off by default. With it on, the rules decide which
 * signals are fixed, and how: with no rule every signal is, by OneUptime AI
 * on the clusters and resources it is linked to; with rules only the ones
 * that match one are, each the way its matching rules say - OneUptime AI
 * (asking first or not), or their runbooks. Rules saved before Fix With keep
 * doing what they did.
 */
describe("the fixing switch and the rules decide which signals are fixed, and how", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function clusterRunArgs(
    start: SpyInstance<EngineInternals["startClusterCommandRun"]>,
  ): Array<{ askFirstReason?: string | undefined }> {
    return start.mock.calls.map((call: Array<unknown>) => {
      return call[0] as { askFirstReason?: string | undefined };
    });
  }

  function aiRule(
    id: ObjectID,
    name: string,
    mode: AutoRemediationExecutionMode,
  ): AutoRemediationRule {
    return rule({
      _id: id.toString(),
      name,
      remediationAction: AutoRemediationAction.OneUptimeAI,
      executionMode: mode,
      runbooks: [],
    });
  }

  it("the alert switch decides for alerts, and the incident switch never does", async () => {
    jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(true);
    const harness: Harness = mockEngine({ clusters: [cluster(CLUSTER_A)] });
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: true,
      enableAutomaticIncidentRemediation: true,
      enableAutomaticAlertRemediation: false,
    } as unknown as Project);

    await AutoRemediationRuleEngineService.applyRulesToAlert(alert());

    expect(reasonsOf(harness)).toEqual([
      AutoRemediationDecisionReason.RemediationOff,
    ]);
    expect(harness.clusterStatuses).not.toHaveBeenCalled();
    expect(AutoRemediationRuleService.findBy).not.toHaveBeenCalled();
  });

  it("with the switch on and no rule, OneUptime AI fixes the signal in the cluster's own mode", async () => {
    const start: SpyInstance<EngineInternals["startClusterCommandRun"]> = jest
      .spyOn(engine, "startClusterCommandRun")
      .mockResolvedValue(true);
    const harness: Harness = mockEngine({ clusters: [cluster(CLUSTER_A)] });

    await AutoRemediationRuleEngineService.applyRulesToAlert(alert());

    expect(reasonsOf(harness)).toContain(
      AutoRemediationDecisionReason.ClusterRoundStarted,
    );
    expect(clusterRunArgs(start)).toEqual([
      expect.objectContaining({ askFirstReason: undefined }),
    ]);
    expect(
      entryFor(harness, AutoRemediationDecisionReason.ClusterRoundStarted)
        .ruleName,
    ).toBeUndefined();
  });

  it("reads only the enabled rules of the signal's own kind", async () => {
    mockEngine({ rules: [] });

    await AutoRemediationRuleEngineService.applyRulesToAlert(alert());

    const query: Record<string, unknown> = (
      (
        AutoRemediationRuleService.findBy as unknown as {
          mock: { calls: Array<Array<{ query: Record<string, unknown> }>> };
        }
      ).mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query).toMatchObject({
      projectId: PROJECT_ID,
      isEnabled: true,
      triggerEntityType: AutoRemediationTriggerEntity.Alert,
    });
  });

  it("a matching OneUptime AI rule that fixes without asking leaves the cluster's mode as it is", async () => {
    const start: SpyInstance<EngineInternals["startClusterCommandRun"]> = jest
      .spyOn(engine, "startClusterCommandRun")
      .mockResolvedValue(true);
    const harness: Harness = mockEngine({
      clusters: [cluster(CLUSTER_A)],
      rules: [
        aiRule(RULE_ID, "Production", AutoRemediationExecutionMode.FullAuto),
      ],
      matchingRuleIds: [RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(clusterRunArgs(start)).toEqual([
      expect.objectContaining({ askFirstReason: undefined }),
    ]);
    expect(
      entryFor(harness, AutoRemediationDecisionReason.ClusterRoundStarted),
    ).toMatchObject({
      remediationMode: KubernetesAiRemediationMode.Automatic,
    });
    expect(
      entryFor(harness, AutoRemediationDecisionReason.RuleMatchedAiFix),
    ).toMatchObject({ ruleName: "Production" });
  });

  it("a matching OneUptime AI rule that asks first makes an unattended cluster ask, and says which rule", async () => {
    const start: SpyInstance<EngineInternals["startClusterCommandRun"]> = jest
      .spyOn(engine, "startClusterCommandRun")
      .mockResolvedValue(true);
    const harness: Harness = mockEngine({
      clusters: [cluster(CLUSTER_A)],
      rules: [
        aiRule(RULE_ID, "Payments ask", AutoRemediationExecutionMode.Suggest),
      ],
      matchingRuleIds: [RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(clusterRunArgs(start)).toEqual([
      expect.objectContaining({
        askFirstReason: 'AI rule "Payments ask" asks before fixing',
      }),
    ]);
    expect(
      entryFor(harness, AutoRemediationDecisionReason.ClusterRoundStarted),
    ).toMatchObject({
      remediationMode: KubernetesAiRemediationMode.RequireApproval,
      ruleName: "Payments ask",
    });
    expect(
      entryFor(harness, AutoRemediationDecisionReason.RuleMatchedAiFixAsks),
    ).toMatchObject({ ruleName: "Payments ask" });
  });

  it("a cluster that asks anyway is recorded in its own mode, with no rule named", async () => {
    jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(true);
    const harness: Harness = mockEngine({
      clusters: [
        cluster(CLUSTER_A, {
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
      ],
      rules: [
        aiRule(RULE_ID, "Payments ask", AutoRemediationExecutionMode.Suggest),
      ],
      matchingRuleIds: [RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(
      entryFor(harness, AutoRemediationDecisionReason.ClusterRoundStarted)
        .ruleName,
    ).toBeUndefined();
  });

  it("of several matching OneUptime AI rules, the one that asks wins", async () => {
    const start: SpyInstance<EngineInternals["startClusterCommandRun"]> = jest
      .spyOn(engine, "startClusterCommandRun")
      .mockResolvedValue(true);
    mockEngine({
      clusters: [cluster(CLUSTER_A)],
      rules: [
        aiRule(RULE_ID, "Everything", AutoRemediationExecutionMode.FullAuto),
        aiRule(
          OTHER_RULE_ID,
          "Databases ask",
          AutoRemediationExecutionMode.Suggest,
        ),
      ],
      matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(clusterRunArgs(start)).toEqual([
      expect.objectContaining({
        askFirstReason: 'AI rule "Databases ask" asks before fixing',
      }),
    ]);
  });

  it("a rule that asks but does not match changes nothing", async () => {
    const start: SpyInstance<EngineInternals["startClusterCommandRun"]> = jest
      .spyOn(engine, "startClusterCommandRun")
      .mockResolvedValue(true);
    mockEngine({
      clusters: [cluster(CLUSTER_A)],
      rules: [
        aiRule(RULE_ID, "Everything", AutoRemediationExecutionMode.FullAuto),
        aiRule(
          OTHER_RULE_ID,
          "Databases ask",
          AutoRemediationExecutionMode.Suggest,
        ),
      ],
      matchingRuleIds: [RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(clusterRunArgs(start)).toEqual([
      expect.objectContaining({ askFirstReason: undefined }),
    ]);
  });

  it("a matching resource round asks first too when its rule asks", async () => {
    const startResource: SpyInstance<
      EngineInternals["startResourceCommandRun"]
    > = jest.spyOn(engine, "startResourceCommandRun").mockResolvedValue(true);
    const harness: Harness = mockEngine({
      resources: [resource(RESOURCE_A)],
      rules: [
        aiRule(RULE_ID, "Staging asks", AutoRemediationExecutionMode.Suggest),
      ],
      matchingRuleIds: [RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(startResource.mock.calls[0]![0]).toMatchObject({
      askFirstReason: 'AI rule "Staging asks" asks before fixing',
    });
    expect(
      entryFor(harness, AutoRemediationDecisionReason.ResourceRoundStarted),
    ).toMatchObject({ ruleName: "Staging asks" });
  });

  it("matching runbook and OneUptime AI rules both act: the clusters are fixed and the runbooks proposed", async () => {
    jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(true);
    const suggest: SpyInstance<EngineInternals["suggestRunbook"]> = jest
      .spyOn(engine, "suggestRunbook")
      .mockResolvedValue(undefined);
    const harness: Harness = mockEngine({
      clusters: [cluster(CLUSTER_A)],
      rules: [
        aiRule(RULE_ID, "Production", AutoRemediationExecutionMode.FullAuto),
        rule({ _id: OTHER_RULE_ID.toString(), name: "Restart checkout" }),
      ],
      matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(reasonsOf(harness)).toEqual(
      expect.arrayContaining([
        AutoRemediationDecisionReason.ClusterRoundStarted,
        AutoRemediationDecisionReason.RuleMatchedAiFix,
        AutoRemediationDecisionReason.RuleRunbookProposed,
      ]),
    );
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it("a rule marked Runbooks runs its runbooks, whatever AI flag it still carries", async () => {
    const suggest: SpyInstance<EngineInternals["suggestRunbook"]> = jest
      .spyOn(engine, "suggestRunbook")
      .mockResolvedValue(undefined);
    const compose: SpyInstance<EngineInternals["startAiCommandRun"]> = jest
      .spyOn(engine, "startAiCommandRun")
      .mockResolvedValue(true);
    const harness: Harness = mockEngine({
      clusters: [cluster(CLUSTER_A)],
      hasLlmProvider: true,
      rules: [
        rule({
          remediationAction: AutoRemediationAction.Runbooks,
          aiComposesCommands: true,
        }),
      ],
      matchingRuleIds: [RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(compose).not.toHaveBeenCalled();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(harness.clusterStatuses).not.toHaveBeenCalled();
  });

  it.each([
    [
      "composes commands on Runners",
      { aiComposesCommands: true },
      "startAiCommandRun",
      AutoRemediationDecisionReason.RuleAiComposingCommands,
    ],
    [
      "picks a runbook",
      { aiSelectsRunbook: true },
      "startAiPlanning",
      AutoRemediationDecisionReason.RuleAiPickingRunbook,
    ],
  ])(
    "a rule saved before Fix With that %s keeps doing that, and leaves the clusters alone",
    async (
      _name: string,
      flags: Partial<AutoRemediationRule>,
      starter: string,
      reason: AutoRemediationDecisionReason,
    ) => {
      const start: SpyInstance<(data: unknown) => Promise<boolean>> = jest
        .spyOn(engine, starter as "startAiCommandRun")
        .mockResolvedValue(true);
      const harness: Harness = mockEngine({
        clusters: [cluster(CLUSTER_A)],
        hasLlmProvider: true,
        rules: [
          rule({
            ...flags,
            executionMode: AutoRemediationExecutionMode.Suggest,
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(start).toHaveBeenCalledTimes(1);
      expect(reasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.NoAiFixRuleMatched,
        reason,
      ]);
      // It neither turns the cluster rounds on nor makes them ask.
      expect(harness.clusterStatuses).not.toHaveBeenCalled();
    },
  );

  it("a rule saved before Fix With that asks does not make a matching OneUptime AI rule's rounds ask", async () => {
    const start: SpyInstance<EngineInternals["startClusterCommandRun"]> = jest
      .spyOn(engine, "startClusterCommandRun")
      .mockResolvedValue(true);
    jest.spyOn(engine, "startAiPlanning").mockResolvedValue(true);
    mockEngine({
      clusters: [cluster(CLUSTER_A)],
      hasLlmProvider: true,
      rules: [
        aiRule(RULE_ID, "Production", AutoRemediationExecutionMode.FullAuto),
        rule({
          _id: OTHER_RULE_ID.toString(),
          aiSelectsRunbook: true,
          executionMode: AutoRemediationExecutionMode.Suggest,
        }),
      ],
      matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(clusterRunArgs(start)).toEqual([
      expect.objectContaining({ askFirstReason: undefined }),
    ]);
  });

  it("an alert matched by no rule is not fixed, and the decision counts the rules", async () => {
    const harness: Harness = mockEngine({
      clusters: [cluster(CLUSTER_A)],
      rules: [
        aiRule(RULE_ID, "Production", AutoRemediationExecutionMode.FullAuto),
      ],
      matchingRuleIds: [],
    });

    await AutoRemediationRuleEngineService.applyRulesToAlert(alert());

    expect(reasonsOf(harness)).toEqual([
      AutoRemediationDecisionReason.NotMatchedByAnyRule,
    ]);
    expect(
      entryFor(harness, AutoRemediationDecisionReason.NotMatchedByAnyRule)
        .rulesChecked,
    ).toBe(1);
    expect(harness.clusterStatuses).not.toHaveBeenCalled();
  });
});

/*
 * ONEUPTIME AI FIXES BY DEFAULT, WITH ANY RUNBOOK OR ONLY THE ALLOWED ONES.
 *
 * The maintainer: "Can oneuptime AI do things by default, and I can
 * whitelist some Runbook for AI to pick and run? If I do not whitelist any
 * Runbook, it can basically run any Runbook by default. ... In fact, in the
 * auto remediation rule, you could ask which runner we should use to run
 * the remediation."
 *
 * So, besides the AI agents' rounds, OneUptime AI picks the runbook that
 * fits a signal - with no rule set up, or for a OneUptime AI rule, from the
 * rule's runbooks or any of the project's when it names none - and, for a
 * rule that picks a Runner, composes commands of its own there. A pick
 * starts on its own only for a rule that fixes without asking and names its
 * runbooks, while no other matching rule asks and no AI agent is fixing the
 * signal (AutoRemediationFix.mayAiPickedRunbookStartWithoutAsking).
 */
describe("OneUptime AI picks a runbook, and runs commands on a rule's Runner", () => {
  const RUNNER_ID: string = "77777777-7777-4777-8777-777777777771";

  interface PlanningCall {
    rule: AutoRemediationRule | null;
    executionMode: AutoRemediationExecutionMode;
    isAnnounced: boolean;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function oneUptimeAiRule(
    overrides: Partial<AutoRemediationRule> = {},
  ): AutoRemediationRule {
    return rule({
      remediationAction: AutoRemediationAction.OneUptimeAI,
      executionMode: AutoRemediationExecutionMode.Suggest,
      runbooks: [],
      ...overrides,
    });
  }

  function spyPlanning(
    started: boolean = true,
  ): SpyInstance<EngineInternals["startAiPlanning"]> {
    return jest.spyOn(engine, "startAiPlanning").mockResolvedValue(started);
  }

  function planningCalls(
    spy: SpyInstance<EngineInternals["startAiPlanning"]>,
  ): Array<PlanningCall> {
    return spy.mock.calls.map((call: Array<unknown>): PlanningCall => {
      return call[0] as PlanningCall;
    });
  }

  // What the rules lane said, in order: the AI agents' lanes say their own.
  function ruleReasonsOf(harness: Harness): Array<string> {
    return entriesOf(harness)
      .filter((entry: AutoRemediationDecisionEntry): boolean => {
        return entry.lane === AutoRemediationDecisionLane.Rule;
      })
      .map((entry: AutoRemediationDecisionEntry): string => {
        return entry.reason;
      });
  }

  describe("with no rule set up", () => {
    it("proposes the runbook OneUptime AI picks from any of the project's, and says it is picking", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 3,
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(planningCalls(planning)).toEqual([
        expect.objectContaining({
          rule: null,
          executionMode: AutoRemediationExecutionMode.Suggest,
          isAnnounced: false,
        }),
      ]);
      const entry: AutoRemediationDecisionEntry = entryFor(
        harness,
        AutoRemediationDecisionReason.AiPickingRunbook,
      );
      expect(entry.lane).toBe(AutoRemediationDecisionLane.Project);
    });

    it("an alert gets the same pick", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 1,
      });

      await AutoRemediationRuleEngineService.applyRulesToAlert(alert());

      expect(planning).toHaveBeenCalledTimes(1);
      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.AiPickingRunbook,
      );
    });

    it("says so when the pick could not start", async () => {
      spyPlanning(false);
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 3,
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.AiRunbookPickNotStarted,
      );
      expect(reasonsOf(harness)).not.toContain(
        AutoRemediationDecisionReason.AiPickingRunbook,
      );
    });

    it.each([
      ["the project has no enabled runbook", { enabledRunbooks: 0 }],
      ["the project has no LLM provider", { hasLlmProvider: false }],
    ])(
      "picks nothing, and says nothing of it, when %s",
      async (_name: string, facts: Record<string, unknown>) => {
        const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
          spyPlanning();
        const harness: Harness = mockEngine({
          hasLlmProvider: true,
          enabledRunbooks: 3,
          ...facts,
        });

        await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

        expect(planning).not.toHaveBeenCalled();
        for (const reason of [
          AutoRemediationDecisionReason.AiPickingRunbook,
          AutoRemediationDecisionReason.AiRunbookPickNotStarted,
        ]) {
          expect(reasonsOf(harness)).not.toContain(reason);
        }
      },
    );

    it("picks once per signal: an earlier pass's pick stands", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 3,
        existing: [new AutoRemediationSuggestion()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(planning).not.toHaveBeenCalled();
    });

    it("picks nothing while fixing new incidents is off", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 3,
        remediationOn: false,
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(planning).not.toHaveBeenCalled();
    });
  });

  describe("a OneUptime AI rule", () => {
    it("that names no runbook has OneUptime AI pick from any, and always propose it", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 3,
        rules: [
          oneUptimeAiRule({
            executionMode: AutoRemediationExecutionMode.FullAuto,
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(planningCalls(planning)).toEqual([
        expect.objectContaining({
          executionMode: AutoRemediationExecutionMode.Suggest,
          isAnnounced: false,
        }),
      ]);
      expect(planningCalls(planning)[0]!.rule?.id?.toString()).toBe(
        RULE_ID.toString(),
      );
      expect(ruleReasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.RuleMatchedAiFix,
        AutoRemediationDecisionReason.RuleAiPickingRunbook,
      ]);
    });

    it("that names its runbooks and fixes without asking starts the pick, when nothing else is fixing", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 1,
        rules: [
          oneUptimeAiRule({
            executionMode: AutoRemediationExecutionMode.FullAuto,
            runbooks: [runbook(RUNBOOK_ID, "Restart the checkout pods")],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(planningCalls(planning)).toEqual([
        expect.objectContaining({
          executionMode: AutoRemediationExecutionMode.FullAuto,
        }),
      ]);
    });

    it("that names its runbooks but asks first proposes the pick", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 1,
        rules: [
          oneUptimeAiRule({
            runbooks: [runbook(RUNBOOK_ID, "Restart the checkout pods")],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(planningCalls(planning)).toEqual([
        expect.objectContaining({
          executionMode: AutoRemediationExecutionMode.Suggest,
        }),
      ]);
    });

    it("proposes its pick while the AI agent fixes the signal on a cluster", async () => {
      jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(true);
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      const harness: Harness = mockEngine({
        clusters: [cluster(CLUSTER_A)],
        hasLlmProvider: true,
        enabledRunbooks: 1,
        rules: [
          oneUptimeAiRule({
            executionMode: AutoRemediationExecutionMode.FullAuto,
            runbooks: [runbook(RUNBOOK_ID, "Restart the checkout pods")],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.ClusterRoundStarted,
      );
      expect(planningCalls(planning)).toEqual([
        expect.objectContaining({
          executionMode: AutoRemediationExecutionMode.Suggest,
        }),
      ]);
    });

    it("proposes its pick when an earlier pass's AI agent round is fixing the signal", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 1,
        existing: [
          Object.assign(new AutoRemediationSuggestion(), {
            resourceId: new ObjectID(RESOURCE_A),
          }),
        ],
        rules: [
          oneUptimeAiRule({
            executionMode: AutoRemediationExecutionMode.FullAuto,
            runbooks: [runbook(RUNBOOK_ID, "Restart the checkout pods")],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(planningCalls(planning)).toEqual([
        expect.objectContaining({
          executionMode: AutoRemediationExecutionMode.Suggest,
        }),
      ]);
    });

    it("proposes its pick while another matching rule asks first", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 1,
        rules: [
          oneUptimeAiRule({
            executionMode: AutoRemediationExecutionMode.FullAuto,
            runbooks: [runbook(RUNBOOK_ID, "Restart the checkout pods")],
          }),
          oneUptimeAiRule({
            _id: OTHER_RULE_ID.toString(),
            name: "Ask first",
            runbooks: [runbook(OTHER_RUNBOOK_ID, "Fail over")],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(
        planningCalls(planning).map((call: PlanningCall) => {
          return call.executionMode;
        }),
      ).toEqual([
        AutoRemediationExecutionMode.Suggest,
        AutoRemediationExecutionMode.Suggest,
      ]);
    });

    it("picks nothing when none of its runbooks is enabled", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 0,
        rules: [
          oneUptimeAiRule({
            runbooks: [runbook(RUNBOOK_ID, "Restart the checkout pods")],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(planning).not.toHaveBeenCalled();
      expect(ruleReasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.RuleMatchedAiFixAsks,
      ]);
    });

    it("counts only its own enabled runbooks", async () => {
      spyPlanning();
      mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 1,
        rules: [
          oneUptimeAiRule({
            runbooks: [runbook(RUNBOOK_ID, "Restart the checkout pods")],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      // The harness answers RunbookService.countBy: one read, for the rule.
      const countCalls: Array<Array<unknown>> = jest.mocked(
        RunbookService.countBy,
      ).mock.calls as unknown as Array<Array<unknown>>;
      expect(countCalls).toHaveLength(1);
      const query: Record<string, unknown> = (
        countCalls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["projectId"]).toEqual(PROJECT_ID);
      expect(query["isEnabled"]).toBe(true);
      expect(JSON.stringify(query["_id"])).toContain(RUNBOOK_ID.toString());
    });

    it("says it was skipped without an LLM provider, and picks nothing", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      const harness: Harness = mockEngine({
        hasLlmProvider: false,
        enabledRunbooks: 1,
        rules: [
          oneUptimeAiRule({
            runbooks: [runbook(RUNBOOK_ID, "Restart the checkout pods")],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(planning).not.toHaveBeenCalled();
      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.RuleSkippedNoLlmProvider,
      );
    });

    it("two rules that name no runbook ask OneUptime AI for one pick, not two", async () => {
      const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
        spyPlanning();
      mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 3,
        rules: [
          oneUptimeAiRule(),
          oneUptimeAiRule({ _id: OTHER_RULE_ID.toString(), name: "Other" }),
        ],
        matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(planning).toHaveBeenCalledTimes(1);
    });

    it("that picks a Runner has OneUptime AI compose commands there too", async () => {
      spyPlanning();
      const compose: SpyInstance<EngineInternals["startAiCommandRun"]> = jest
        .spyOn(engine, "startAiCommandRun")
        .mockResolvedValue(true);
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 1,
        rules: [oneUptimeAiRule({ runnerId: new ObjectID(RUNNER_ID) })],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(compose).toHaveBeenCalledTimes(1);
      expect(
        (
          compose.mock.calls[0]![0] as { rule: AutoRemediationRule }
        ).rule.id?.toString(),
      ).toBe(RULE_ID.toString());
      expect(ruleReasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.RuleMatchedAiFixAsks,
        AutoRemediationDecisionReason.RuleAiPickingRunbook,
        AutoRemediationDecisionReason.RuleAiComposingCommands,
      ]);
    });

    it("that picks no Runner composes no commands", async () => {
      spyPlanning();
      const compose: SpyInstance<EngineInternals["startAiCommandRun"]> = jest
        .spyOn(engine, "startAiCommandRun")
        .mockResolvedValue(true);
      mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 1,
        rules: [oneUptimeAiRule()],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(compose).not.toHaveBeenCalled();
    });

    it("that picks a Runner says so when its commands could not start", async () => {
      jest.spyOn(engine, "startAiCommandRun").mockResolvedValue(false);
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        enabledRunbooks: 0,
        rules: [oneUptimeAiRule({ runnerId: new ObjectID(RUNNER_ID) })],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(ruleReasonsOf(harness)).toEqual([
        AutoRemediationDecisionReason.RuleMatchedAiFixAsks,
        AutoRemediationDecisionReason.RuleAiRunNotStarted,
      ]);
    });
  });

  it("a rule that runs its runbooks every time has OneUptime AI pick nothing, nor compose commands", async () => {
    const planning: SpyInstance<EngineInternals["startAiPlanning"]> =
      spyPlanning();
    const compose: SpyInstance<EngineInternals["startAiCommandRun"]> = jest
      .spyOn(engine, "startAiCommandRun")
      .mockResolvedValue(true);
    jest.spyOn(engine, "suggestRunbook").mockResolvedValue(undefined);
    mockEngine({
      hasLlmProvider: true,
      enabledRunbooks: 3,
      rules: [rule({ runnerId: new ObjectID(RUNNER_ID) })],
      matchingRuleIds: [RULE_ID.toString()],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(planning).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
  });
});

describe("OneUptime AI fixes through the project's external MCP servers", () => {
  const AWS_ID: string = "88888888-8888-4888-8888-888888888881";

  interface McpFixCall {
    rule: AutoRemediationRule | null;
    executionMode: AutoRemediationExecutionMode;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function server(id: string): ExternalMcpServer {
    const model: ExternalMcpServer = new ExternalMcpServer();
    model._id = id;
    return model;
  }

  function oneUptimeAiRule(
    overrides: Partial<AutoRemediationRule> = {},
  ): AutoRemediationRule {
    return rule({
      remediationAction: AutoRemediationAction.OneUptimeAI,
      executionMode: AutoRemediationExecutionMode.Suggest,
      runbooks: [],
      ...overrides,
    });
  }

  function spyMcpFix(
    started: boolean = true,
  ): SpyInstance<EngineInternals["startMcpFix"]> {
    return jest.spyOn(engine, "startMcpFix").mockResolvedValue(started);
  }

  function mcpFixCalls(
    spy: SpyInstance<EngineInternals["startMcpFix"]>,
  ): Array<McpFixCall> {
    return spy.mock.calls.map((call: Array<unknown>): McpFixCall => {
      return call[0] as McpFixCall;
    });
  }

  // The servers each check asked about.
  function askedAllowances(): Array<ExternalMcpServerAllowance> {
    return (
      ExternalMcpServerService.hasServersThatMayFix as unknown as SpyInstance<
        typeof ExternalMcpServerService.hasServersThatMayFix
      >
    ).mock.calls.map((call: Array<unknown>): ExternalMcpServerAllowance => {
      return (call[0] as { allowance: ExternalMcpServerAllowance }).allowance;
    });
  }

  describe("with no rule set up", () => {
    it("works out a fix through any server and proposes every change, saying so", async () => {
      const fix: SpyInstance<EngineInternals["startMcpFix"]> = spyMcpFix();
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        mcpServersMayFix: true,
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(mcpFixCalls(fix)).toEqual([
        expect.objectContaining({
          rule: null,
          executionMode: AutoRemediationExecutionMode.Suggest,
        }),
      ]);
      expect(askedAllowances()).toEqual([
        { isEveryServer: true, serverIds: [] },
      ]);
      expect(
        entryFor(
          harness,
          AutoRemediationDecisionReason.AiFixingThroughMcpServers,
        ).lane,
      ).toBe(AutoRemediationDecisionLane.Project);
    });

    it("says so when the fix could not start", async () => {
      spyMcpFix(false);
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        mcpServersMayFix: true,
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.AiMcpFixNotStarted,
      );
    });

    it.each([
      ["no server could make a change", { mcpServersMayFix: false }],
      ["the project has no LLM provider", { hasLlmProvider: false }],
      [
        "the signal already has a fix through MCP servers",
        {
          existing: [
            Object.assign(new AutoRemediationSuggestion(), {
              suggestionType: AutoRemediationSuggestionType.McpToolCalls,
            }),
          ],
        },
      ],
      ["fixing new incidents is off", { remediationOn: false }],
    ])(
      "starts nothing, and says nothing of it, when %s",
      async (_name: string, facts: Record<string, unknown>) => {
        const fix: SpyInstance<EngineInternals["startMcpFix"]> = spyMcpFix();
        const harness: Harness = mockEngine({
          hasLlmProvider: true,
          mcpServersMayFix: true,
          ...facts,
        });

        await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

        expect(fix).not.toHaveBeenCalled();
        for (const reason of [
          AutoRemediationDecisionReason.AiFixingThroughMcpServers,
          AutoRemediationDecisionReason.AiMcpFixNotStarted,
        ]) {
          expect(reasonsOf(harness)).not.toContain(reason);
        }
      },
    );

    it("servers that cannot be read start no fix through them, and stop nothing else", async () => {
      const fix: SpyInstance<EngineInternals["startMcpFix"]> = spyMcpFix();
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        mcpServersMayFix: new Error("database is down"),
        clusters: [cluster(CLUSTER_A)],
      });
      jest.spyOn(engine, "startClusterCommandRun").mockResolvedValue(true);

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(fix).not.toHaveBeenCalled();
      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.ClusterRoundStarted,
      );
      expect(reasonsOf(harness)).not.toContain(
        AutoRemediationDecisionReason.EvaluationFailed,
      );
    });
  });

  describe("a OneUptime AI rule", () => {
    it("that fixes without asking and names its servers makes its changes itself", async () => {
      const fix: SpyInstance<EngineInternals["startMcpFix"]> = spyMcpFix();
      const harness: Harness = mockEngine({
        hasLlmProvider: true,
        mcpServersMayFix: true,
        rules: [
          oneUptimeAiRule({
            executionMode: AutoRemediationExecutionMode.FullAuto,
            externalMcpServers: [server(AWS_ID)],
          }),
        ],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(mcpFixCalls(fix)).toEqual([
        expect.objectContaining({
          executionMode: AutoRemediationExecutionMode.FullAuto,
        }),
      ]);
      expect(askedAllowances()).toEqual([
        { isEveryServer: false, serverIds: [AWS_ID] },
      ]);
      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.RuleAiFixingThroughMcpServers,
      );
    });

    it.each([
      [
        "names no server",
        [
          oneUptimeAiRule({
            executionMode: AutoRemediationExecutionMode.FullAuto,
          }),
        ],
      ],
      [
        "asks before fixing",
        [oneUptimeAiRule({ externalMcpServers: [server(AWS_ID)] })],
      ],
    ])(
      "that %s proposes every change",
      async (_name: string, rules: Array<AutoRemediationRule>) => {
        const fix: SpyInstance<EngineInternals["startMcpFix"]> = spyMcpFix();
        mockEngine({
          hasLlmProvider: true,
          mcpServersMayFix: true,
          rules,
          matchingRuleIds: [RULE_ID.toString()],
        });

        await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

        expect(mcpFixCalls(fix)).toEqual([
          expect.objectContaining({
            executionMode: AutoRemediationExecutionMode.Suggest,
          }),
        ]);
      },
    );

    it("proposes while another matching rule asks first", async () => {
      const fix: SpyInstance<EngineInternals["startMcpFix"]> = spyMcpFix();
      jest.spyOn(engine, "startAiPlanning").mockResolvedValue(true);
      mockEngine({
        hasLlmProvider: true,
        mcpServersMayFix: true,
        rules: [
          oneUptimeAiRule({
            executionMode: AutoRemediationExecutionMode.FullAuto,
            externalMcpServers: [server(AWS_ID)],
          }),
          oneUptimeAiRule({
            _id: OTHER_RULE_ID.toString(),
            name: "Ask about checkout",
          }),
        ],
        matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(fix).toHaveBeenCalled();
      for (const call of mcpFixCalls(fix)) {
        expect(call.executionMode).toBe(AutoRemediationExecutionMode.Suggest);
      }
    });

    it("two rules that name no server start one fix through all of them, not two", async () => {
      const fix: SpyInstance<EngineInternals["startMcpFix"]> = spyMcpFix();
      mockEngine({
        hasLlmProvider: true,
        mcpServersMayFix: true,
        rules: [
          oneUptimeAiRule(),
          oneUptimeAiRule({
            _id: OTHER_RULE_ID.toString(),
            name: "Fix checkout too",
          }),
        ],
        matchingRuleIds: [RULE_ID.toString(), OTHER_RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(fix).toHaveBeenCalledTimes(1);
    });

    it("says it has no LLM provider rather than starting one", async () => {
      const fix: SpyInstance<EngineInternals["startMcpFix"]> = spyMcpFix();
      const harness: Harness = mockEngine({
        hasLlmProvider: false,
        mcpServersMayFix: true,
        rules: [oneUptimeAiRule({ externalMcpServers: [server(AWS_ID)] })],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(fix).not.toHaveBeenCalled();
      expect(reasonsOf(harness)).toContain(
        AutoRemediationDecisionReason.RuleSkippedNoLlmProvider,
      );
    });

    it("a rule that runs its runbooks every time fixes through no MCP server", async () => {
      const fix: SpyInstance<EngineInternals["startMcpFix"]> = spyMcpFix();
      jest.spyOn(engine, "suggestRunbook").mockResolvedValue(undefined);
      mockEngine({
        hasLlmProvider: true,
        mcpServersMayFix: true,
        rules: [rule({ externalMcpServers: [server(AWS_ID)] })],
        matchingRuleIds: [RULE_ID.toString()],
      });

      await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

      expect(fix).not.toHaveBeenCalled();
    });
  });

  describe("the rules of a fix through MCP servers", () => {
    it("changes without asking only for a rule that fixes without asking, names its servers, and runs alone", () => {
      const alone: Parameters<typeof mayMcpFixChangeWithoutAsking>[0] = {
        executionMode: AutoRemediationExecutionMode.FullAuto,
        namesMcpServers: true,
        anotherRuleAsksFirst: false,
        agentRoundStarted: false,
        unattendedPickStarted: false,
      };

      expect(mayMcpFixChangeWithoutAsking(alone)).toBe(true);
      expect(
        mayMcpFixChangeWithoutAsking({
          ...alone,
          executionMode: AutoRemediationExecutionMode.Suggest,
        }),
      ).toBe(false);
      expect(
        mayMcpFixChangeWithoutAsking({ ...alone, namesMcpServers: false }),
      ).toBe(false);
      expect(
        mayMcpFixChangeWithoutAsking({ ...alone, anotherRuleAsksFirst: true }),
      ).toBe(false);
      expect(
        mayMcpFixChangeWithoutAsking({ ...alone, agentRoundStarted: true }),
      ).toBe(false);
      expect(
        mayMcpFixChangeWithoutAsking({ ...alone, unattendedPickStarted: true }),
      ).toBe(false);
    });

    it("a fix through MCP servers is not the default runbook pick, and is found as one", () => {
      const mcpFix: { suggestionType: AutoRemediationSuggestionType } = {
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
      };

      expect(isDefaultRunbookPick(mcpFix)).toBe(false);
      expect(hasMcpFix([mcpFix])).toBe(true);
      expect(
        hasMcpFix([{ suggestionType: AutoRemediationSuggestionType.Runbook }]),
      ).toBe(false);
    });
  });
});
