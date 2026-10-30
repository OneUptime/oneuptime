import InvestigationThread, {
  INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
  InvestigationThreadLatestInvestigation,
  InvestigationThreadSubject,
  InvestigationThreadSubjectDetails,
  InvestigationThreadTurnContext,
  MAX_THREAD_REPORT_CHARS,
} from "../../../../Server/Utils/AI/SRE/InvestigationThread";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunService from "../../../../Server/Services/AIRunService";
import IncidentService from "../../../../Server/Services/IncidentService";
import AlertService from "../../../../Server/Services/AlertService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import { READ_TOOL_OUTPUT_TOOL_NAME } from "../../../../Server/Utils/AI/Chat/ToolOutputPager";
import { ChatExtraTool } from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AIChatPageContextType from "../../../../Types/AI/AIChatPageContext";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { KubernetesClusterAiAccessStatus } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { ResourceAiAccessStatus } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME } from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What an incident's shared thread knows about its incident. These pin the
 * promises the thread makes to responders: one thread per subject (even
 * when two people ask at once), a prompt that names who asked and says
 * there is no budget, the autonomous report handed over as its own earlier
 * work (with the old run's citation markers removed), and the same
 * read-only command tools the investigation had — context that degrades,
 * never fails, when a lookup breaks.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const ALERT_ID: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const RUN_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

// The person asking: the turn's commands are theirs.
const ASKER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
  tenantId: PROJECT_ID,
  isMultiTenantRequest: false,
} as DatabaseCommonInteractionProps;

const INCIDENT_SUBJECT: InvestigationThreadSubject = {
  type: "incident",
  id: INCIDENT_ID,
};
const ALERT_SUBJECT: InvestigationThreadSubject = {
  type: "alert",
  id: ALERT_ID,
};

function incident(): Incident {
  const model: Incident = new Incident(INCIDENT_ID);
  model.title = "Node memory at 93%";
  model.description = "gke-db-pool node memory alert";
  model.incidentNumber = 42;
  model.createdAt = new Date("2026-09-30T10:00:00.000Z");
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  model.incidentSeverity = severity;
  const state: IncidentState = new IncidentState();
  state.name = "Investigating";
  model.currentIncidentState = state;
  const monitor: Monitor = new Monitor();
  monitor.name = "db-pool memory";
  model.monitors = [monitor];
  return model;
}

function readyCluster(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: "11111111-1111-4111-8111-111111111111",
    clusterName: "gke-test-cluster",
    clusterIdentifier: "gke-test-cluster",
    isInvestigationReady: true,
    isRemediationReady: false,
    runner: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "kubernetes-agent",
    },
    gaps: [],
  } as unknown as KubernetesClusterAiAccessStatus;
}

describe("InvestigationThread.getSubjectQuery", () => {
  test("scopes an incident thread by incident and an alert thread by alert", () => {
    expect(InvestigationThread.getSubjectQuery(INCIDENT_SUBJECT)).toEqual({
      incidentId: INCIDENT_ID,
    });
    expect(InvestigationThread.getSubjectQuery(ALERT_SUBJECT)).toEqual({
      alertId: ALERT_ID,
    });
  });
});

describe("InvestigationThread.findOrCreateThread", () => {
  test("returns the existing thread without creating another", async () => {
    const existing: AIConversation = new AIConversation(ObjectID.generate());
    jest
      .spyOn(AIConversationService, "findOneBy")
      .mockResolvedValue(existing as never);
    const create: jest.SpyInstance = jest.spyOn(
      AIConversationService,
      "create",
    );

    const thread: AIConversation = await InvestigationThread.findOrCreateThread(
      {
        projectId: PROJECT_ID,
        subject: INCIDENT_SUBJECT,
        title: "Incident #42: Node memory",
      },
    );

    expect(thread).toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });

  test("creates a subject thread owned by nobody, as root", async () => {
    const created: AIConversation = new AIConversation(ObjectID.generate());
    jest
      .spyOn(AIConversationService, "findOneBy")
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(created as never);
    const create: jest.SpyInstance = jest
      .spyOn(AIConversationService, "create")
      .mockResolvedValue(created as never);

    const thread: AIConversation = await InvestigationThread.findOrCreateThread(
      {
        projectId: PROJECT_ID,
        subject: INCIDENT_SUBJECT,
        title: "x".repeat(200),
      },
    );

    expect(thread).toBe(created);

    const args: { data: AIConversation; props: JSONObject } = create.mock
      .calls[0]![0] as never;
    expect(args.props).toEqual({ isRoot: true });
    expect(args.data.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(args.data.alertId).toBeUndefined();
    expect(args.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(args.data.createdByUserId).toBeUndefined();
    expect(args.data.title?.length).toBe(90);
  });

  test("an alert thread is keyed by the alert", async () => {
    const created: AIConversation = new AIConversation(ObjectID.generate());
    jest
      .spyOn(AIConversationService, "findOneBy")
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(created as never);
    const create: jest.SpyInstance = jest
      .spyOn(AIConversationService, "create")
      .mockResolvedValue(created as never);

    await InvestigationThread.findOrCreateThread({
      projectId: PROJECT_ID,
      subject: ALERT_SUBJECT,
      title: "Alert #7",
    });

    const args: { data: AIConversation } = create.mock.calls[0]![0] as never;
    expect(args.data.alertId?.toString()).toBe(ALERT_ID.toString());
    expect(args.data.incidentId).toBeUndefined();
  });

  test("two responders asking at once end up in the same (oldest) thread", async () => {
    const oldest: AIConversation = new AIConversation(ObjectID.generate());
    const ours: AIConversation = new AIConversation(ObjectID.generate());

    jest
      .spyOn(AIConversationService, "findOneBy")
      .mockResolvedValueOnce(null as never) // nothing yet when we looked
      .mockResolvedValueOnce(oldest as never); // the other request won
    jest
      .spyOn(AIConversationService, "create")
      .mockResolvedValue(ours as never);
    const deleteOneById: jest.SpyInstance = jest
      .spyOn(AIConversationService, "deleteOneById")
      .mockResolvedValue(undefined as never);

    const thread: AIConversation = await InvestigationThread.findOrCreateThread(
      {
        projectId: PROJECT_ID,
        subject: INCIDENT_SUBJECT,
        title: "Incident #42",
      },
    );

    expect(thread).toBe(oldest);
    expect(deleteOneById).toHaveBeenCalledWith({
      id: ours.id,
      props: { isRoot: true },
    });
  });

  test("a failed duplicate cleanup still returns the shared thread", async () => {
    const oldest: AIConversation = new AIConversation(ObjectID.generate());

    jest
      .spyOn(AIConversationService, "findOneBy")
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(oldest as never);
    jest
      .spyOn(AIConversationService, "create")
      .mockResolvedValue(new AIConversation(ObjectID.generate()) as never);
    jest
      .spyOn(AIConversationService, "deleteOneById")
      .mockRejectedValue(new Error("db down") as never);

    await expect(
      InvestigationThread.findOrCreateThread({
        projectId: PROJECT_ID,
        subject: INCIDENT_SUBJECT,
        title: "Incident #42",
      }),
    ).resolves.toBe(oldest);
  });
});

describe("InvestigationThread.describeIncident / describeAlert", () => {
  test("summarizes an incident and points the page context at it", () => {
    const details: InvestigationThreadSubjectDetails =
      InvestigationThread.describeIncident(incident(), INCIDENT_ID);

    expect(details.label).toBe("Incident #42");
    expect(details.title).toBe("Node memory at 93%");
    expect(details.summary).toContain("# Incident #42: Node memory at 93%");
    expect(details.summary).toContain(`incidentId: ${INCIDENT_ID.toString()}`);
    expect(details.summary).toContain("Severity: Critical");
    expect(details.summary).toContain("Current state: Investigating");
    expect(details.summary).toContain("Affected monitors: db-pool memory");
    expect(details.pageContext).toEqual({
      type: AIChatPageContextType.Incident,
      entityId: INCIDENT_ID.toString(),
      entityTitle: "#42 Node memory at 93%",
    });
  });

  test("prefers the incident's prefixed number", () => {
    const model: Incident = incident();
    model.incidentNumberWithPrefix = "INC-42";

    expect(InvestigationThread.describeIncident(model, INCIDENT_ID).label).toBe(
      "Incident INC-42",
    );
  });

  test("survives a missing incident", () => {
    const details: InvestigationThreadSubjectDetails =
      InvestigationThread.describeIncident(null, INCIDENT_ID);

    expect(details.label).toBe("Incident");
    expect(details.title).toBe("Untitled incident");
    expect(details.summary).toContain("Severity: N/A");
  });

  test("summarizes an alert with its monitor", () => {
    const alert: Alert = new Alert(ALERT_ID);
    alert.title = "High error rate";
    alert.alertNumber = 7;
    const monitor: Monitor = new Monitor();
    monitor.name = "checkout-api";
    alert.monitor = monitor;

    const details: InvestigationThreadSubjectDetails =
      InvestigationThread.describeAlert(alert, ALERT_ID);

    expect(details.label).toBe("Alert #7");
    expect(details.summary).toContain("Monitor: checkout-api");
    expect(details.pageContext.type).toBe(AIChatPageContextType.Alert);
    expect(details.pageContext.entityId).toBe(ALERT_ID.toString());
  });
});

/*
 * An alert's thread names it as its page does - by the number the project
 * gave it, ALT-7, before its title - not by the bare #7 that every alert of
 * a project with a prefix also shows on its page as ALT-7. An alert
 * numbered before numbers kept their prefix is still #7.
 */
describe("InvestigationThread names an alert by its own number", () => {
  function alertNumbered(withPrefix: string | undefined): Alert {
    const alert: Alert = new Alert(ALERT_ID);
    alert.title = "High error rate";
    alert.alertNumber = 7;
    if (withPrefix !== undefined) {
      alert.alertNumberWithPrefix = withPrefix;
    }
    return alert;
  }

  test("the prefix the project numbered it with", () => {
    const details: InvestigationThreadSubjectDetails =
      InvestigationThread.describeAlert(alertNumbered("ALT-7"), ALERT_ID);

    expect(details.label).toBe("Alert ALT-7");
    expect(details.summary).toContain("# Alert ALT-7: High error rate");
    expect(details.pageContext.entityTitle).toBe("ALT-7 High error rate");
  });

  test("an alert numbered before numbers kept their prefix: #7", () => {
    const details: InvestigationThreadSubjectDetails =
      InvestigationThread.describeAlert(alertNumbered(undefined), ALERT_ID);

    expect(details.label).toBe("Alert #7");
    expect(details.pageContext.entityTitle).toBe("#7 High error rate");
  });

  test("an alert without a number is just an alert", () => {
    const alert: Alert = new Alert(ALERT_ID);
    alert.title = "High error rate";

    const details: InvestigationThreadSubjectDetails =
      InvestigationThread.describeAlert(alert, ALERT_ID);

    expect(details.label).toBe("Alert");
    expect(details.pageContext.entityTitle).toBe("High error rate");
  });

  test("an incident's number reads the same way: its prefix, else #42", () => {
    const prefixed: Incident = incident();
    prefixed.incidentNumberWithPrefix = "INC-42";

    expect(
      InvestigationThread.describeIncident(prefixed, INCIDENT_ID).pageContext
        .entityTitle,
    ).toBe("INC-42 Node memory at 93%");
    expect(
      InvestigationThread.describeIncident(incident(), INCIDENT_ID).label,
    ).toBe("Incident #42");
  });

  test("the alert's number with its prefix is read for the thread", async () => {
    const findAlert: jest.SpyInstance = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alertNumbered("ALT-7") as never);

    const details: InvestigationThreadSubjectDetails =
      await InvestigationThread.getSubjectDetails({
        projectId: PROJECT_ID,
        subject: ALERT_SUBJECT,
      });

    const select: JSONObject = (
      findAlert.mock.calls[0]![0] as { select: JSONObject }
    ).select;
    expect(select).toMatchObject({
      alertNumber: true,
      alertNumberWithPrefix: true,
    });
    expect(details.label).toBe("Alert ALT-7");
  });
});

describe("InvestigationThread.buildInvestigationSection", () => {
  const base: InvestigationThreadLatestInvestigation = {
    status: null,
    analysisMarkdown: null,
  };

  test("no investigation: investigate from scratch", () => {
    expect(
      InvestigationThread.buildInvestigationSection(base, "incident"),
    ).toContain("No autonomous AI investigation has run for this incident");
  });

  test("still running: says the report is not ready", () => {
    const section: string = InvestigationThread.buildInvestigationSection(
      { ...base, status: AIRunStatus.Running },
      "incident",
    );
    expect(section).toContain("still running");
    expect(section).toContain("report is not ready yet");
  });

  test("queued: says so", () => {
    expect(
      InvestigationThread.buildInvestigationSection(
        { ...base, status: AIRunStatus.Queued },
        "alert",
      ),
    ).toContain("still queued");
  });

  test("failed: carries the reason", () => {
    const section: string = InvestigationThread.buildInvestigationSection(
      { ...base, status: AIRunStatus.Error, errorMessage: "provider down" },
      "incident",
    );
    expect(section).toContain("did not finish (provider down)");
  });

  test("completed without a report", () => {
    expect(
      InvestigationThread.buildInvestigationSection(
        { ...base, status: AIRunStatus.Completed },
        "incident",
      ),
    ).toContain("finished without publishing a report");
  });

  test("hands over the report as its own work, without the old citation markers", () => {
    const section: string = InvestigationThread.buildInvestigationSection(
      {
        ...base,
        status: AIRunStatus.Completed,
        analysisMarkdown:
          "## Summary\nClickHouse uses 120Gi [C1] and pgbouncer 2Gi [C2].",
      },
      "incident",
    );

    expect(section).toContain("Treat it as your own earlier work");
    expect(section).toContain("<investigation_report>");
    expect(section).toContain("ClickHouse uses 120Gi and pgbouncer 2Gi.");
    expect(section).not.toContain("[C1]");
    expect(section).toContain("never cite them");
  });

  test("bounds a pathological report", () => {
    const section: string = InvestigationThread.buildInvestigationSection(
      {
        ...base,
        status: AIRunStatus.Completed,
        analysisMarkdown: "y".repeat(MAX_THREAD_REPORT_CHARS * 2),
      },
      "incident",
    );

    expect(section.length).toBeLessThan(MAX_THREAD_REPORT_CHARS + 2_000);
    expect(section).toContain(
      "the rest of the report is on the incident timeline",
    );
  });
});

describe("InvestigationThread.buildThreadInstructions", () => {
  const instructions: string = InvestigationThread.buildThreadInstructions({
    subjectLabel: "Incident #42",
    subjectTitle: "Node memory at 93%",
    subjectNoun: "incident",
    hasClusterAccess: true,
    hasInfrastructureAccess: false,
  });

  test("explains the shared thread and the attribution format", () => {
    expect(instructions).toContain("SHARED thread");
    expect(instructions).toContain('"[Name asks]"');
    expect(instructions).toContain('Incident #42 "Node memory at 93%"');
  });

  test("promises no budget and full reads", () => {
    expect(instructions).toContain("There is no time or query budget");
    expect(instructions).toContain(READ_TOOL_OUTPUT_TOOL_NAME);
  });

  test("acts on clear requests only, and says what it did", () => {
    expect(instructions).toContain(
      "Only act on what a responder clearly asked",
    );
    expect(instructions).toContain("say exactly what you did");
  });

  test("describes kubectl access only when there is some", () => {
    expect(instructions).toContain("run_kubectl");
    expect(instructions).toContain("kubectl top pods -A --sort-by=memory");
    expect(instructions).not.toContain("run_infrastructure_command");

    const none: string = InvestigationThread.buildThreadInstructions({
      subjectLabel: "Alert #7",
      subjectTitle: "High error rate",
      subjectNoun: "alert",
      hasClusterAccess: false,
      hasInfrastructureAccess: false,
    });
    expect(none).not.toContain("run_kubectl");
    expect(none).not.toContain("Commands here are read-only");
  });

  test("never claims to change infrastructure", () => {
    expect(instructions).toContain("never claim you changed infrastructure");
  });
});

describe("InvestigationThread.buildTurnContext", () => {
  function installLookups(data: {
    clusters?: Array<KubernetesClusterAiAccessStatus>;
    clusterError?: boolean;
    resources?: Array<ResourceAiAccessStatus>;
    resourceError?: boolean;
    run?: AIRun | null;
    report?: string | null;
    // The linked clusters and resources the asker may view; all by default.
    viewableClusterIds?: Array<string>;
    viewableResourceIds?: Array<string>;
  }): void {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident() as never);
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(null as never);
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue((data.run ?? null) as never);
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue((data.report ?? null) as never);

    const clusters: jest.SpyInstance = jest.spyOn(
      KubernetesClusterAiAccessService,
      "getStatusesForSubject",
    );
    if (data.clusterError) {
      clusters.mockRejectedValue(new Error("cluster lookup failed") as never);
    } else {
      clusters.mockResolvedValue((data.clusters ?? []) as never);
    }

    const resources: jest.SpyInstance = jest.spyOn(
      ResourceAiAccessService,
      "getStatusesForSubject",
    );
    if (data.resourceError) {
      resources.mockRejectedValue(new Error("resource lookup failed") as never);
    } else {
      resources.mockResolvedValue((data.resources ?? []) as never);
    }

    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesViewableBy")
      .mockImplementation((async (args: {
        statuses: Array<KubernetesClusterAiAccessStatus>;
      }): Promise<Array<KubernetesClusterAiAccessStatus>> => {
        return args.statuses.filter(
          (status: KubernetesClusterAiAccessStatus): boolean => {
            return (
              !data.viewableClusterIds ||
              data.viewableClusterIds.includes(status.clusterId)
            );
          },
        );
      }) as never);

    jest
      .spyOn(ResourceAiAccessService, "getStatusesViewableBy")
      .mockImplementation((async (args: {
        statuses: Array<ResourceAiAccessStatus>;
      }): Promise<Array<ResourceAiAccessStatus>> => {
        return args.statuses.filter(
          (status: ResourceAiAccessStatus): boolean => {
            return (
              !data.viewableResourceIds ||
              data.viewableResourceIds.includes(status.resourceId)
            );
          },
        );
      }) as never);
  }

  function completedRun(): AIRun {
    const run: AIRun = new AIRun(RUN_ID);
    run.status = AIRunStatus.Completed;
    run.completedAt = new Date("2026-09-30T10:05:00.000Z");
    return run;
  }

  test("assembles instructions, the subject, the report and the page context", async () => {
    installLookups({
      run: completedRun(),
      report: "## Summary\nMemory is high [C1].",
    });

    const context: InvestigationThreadTurnContext =
      await InvestigationThread.buildTurnContext({
        projectId: PROJECT_ID,
        subject: INCIDENT_SUBJECT,
        aiRunId: ObjectID.generate(),
        props: ASKER_PROPS,
      });

    expect(context.additionalSystemInstructions).toContain(
      "# This conversation",
    );
    expect(context.additionalSystemInstructions).toContain(
      "# Incident #42: Node memory at 93%",
    );
    expect(context.additionalSystemInstructions).toContain("Memory is high.");
    expect(context.pageContext.entityId).toBe(INCIDENT_ID.toString());
    expect(context.title).toBe("Incident #42: Node memory at 93%");
    // No reachable cluster or resource: no command tools, no pager.
    expect(context.extraTools).toEqual([]);
  });

  test("looks up the investigation for this incident only", async () => {
    installLookups({});

    await InvestigationThread.buildTurnContext({
      projectId: PROJECT_ID,
      subject: INCIDENT_SUBJECT,
      aiRunId: ObjectID.generate(),
      props: ASKER_PROPS,
    });

    const query: JSONObject = (
      (AIRunService.findOneBy as unknown as jest.SpyInstance).mock
        .calls[0]![0] as { query: JSONObject }
    ).query;

    expect(query["runType"]).toBe(AIRunType.Investigation);
    expect(query["triggeredByIncidentId"]).toBe(INCIDENT_ID);
    expect(query["projectId"]).toBe(PROJECT_ID);
  });

  test("offers read-only kubectl and read_tool_output for a reachable cluster", async () => {
    installLookups({ clusters: [readyCluster()] });

    const context: InvestigationThreadTurnContext =
      await InvestigationThread.buildTurnContext({
        projectId: PROJECT_ID,
        subject: INCIDENT_SUBJECT,
        aiRunId: ObjectID.generate(),
        props: ASKER_PROPS,
      });

    const names: Array<string> = context.extraTools.map(
      (tool: ChatExtraTool): string => {
        return tool.definition.name;
      },
    );

    expect(names).toEqual([
      "list_cluster_access",
      "run_kubectl",
      READ_TOOL_OUTPUT_TOOL_NAME,
    ]);
    expect(
      context.extraTools.every((tool: ChatExtraTool): boolean => {
        return tool.isMutation !== true;
      }),
    ).toBe(true);
    expect(context.additionalSystemInstructions).toContain(
      'Cluster "gke-test-cluster"',
    );
    expect(context.additionalSystemInstructions).toContain(
      "read-only terminal",
    );
  });

  test("a failed cluster lookup degrades to OneUptime data, never a failed turn", async () => {
    installLookups({ clusterError: true, resourceError: true });

    const context: InvestigationThreadTurnContext =
      await InvestigationThread.buildTurnContext({
        projectId: PROJECT_ID,
        subject: INCIDENT_SUBJECT,
        aiRunId: ObjectID.generate(),
        props: ASKER_PROPS,
      });

    expect(context.extraTools).toEqual([]);
    expect(context.additionalSystemInstructions).toContain(
      "# This conversation",
    );
  });

  test("a failed investigation lookup still gives a usable context", async () => {
    installLookups({});
    (AIRunService.findOneBy as unknown as jest.SpyInstance).mockRejectedValue(
      new Error("db down") as never,
    );

    const context: InvestigationThreadTurnContext =
      await InvestigationThread.buildTurnContext({
        projectId: PROJECT_ID,
        subject: INCIDENT_SUBJECT,
        aiRunId: ObjectID.generate(),
        props: ASKER_PROPS,
      });

    expect(context.additionalSystemInstructions).toContain(
      "No autonomous AI investigation has run",
    );
  });

  /*
   * The commands are the person asking's: read-only kubectl and
   * infrastructure commands reach only the linked clusters and resources
   * that person may view (the services' getStatusesViewableBy, which the
   * Postgres suite KubernetesClusterEditScopePostgres runs for real).
   */
  describe("commands reach only what the person asking may view", () => {
    const OTHER_CLUSTER_ID: string = "33333333-3333-4333-8333-333333333333";
    const HOST_ID: string = "44444444-4444-4444-8444-444444444444";
    const OTHER_HOST_ID: string = "55555555-5555-4555-8555-555555555555";

    function otherCluster(): KubernetesClusterAiAccessStatus {
      return {
        ...readyCluster(),
        clusterId: OTHER_CLUSTER_ID,
        clusterName: "payments-prod",
        clusterIdentifier: "payments-prod",
      } as KubernetesClusterAiAccessStatus;
    }

    function readyHost(id: string, name: string): ResourceAiAccessStatus {
      return {
        resourceType: AiResourceType.DockerHost,
        resourceId: id,
        resourceName: name,
        isAiInvestigationEnabled: true,
        aiCommandAllowlist: [],
        agent: {
          agentId: "66666666-6666-4666-8666-666666666666",
          isOnline: true,
        },
        gaps: [],
        isInvestigationReady: true,
        isRemediationReady: false,
      } as unknown as ResourceAiAccessStatus;
    }

    async function listed(
      context: InvestigationThreadTurnContext,
      toolName: string,
    ): Promise<string> {
      const tool: ChatExtraTool | undefined = context.extraTools.find(
        (candidate: ChatExtraTool): boolean => {
          return candidate.definition.name === toolName;
        },
      );

      return tool ? (await tool.execute({})).result?.dataForLlm || "" : "";
    }

    test("asks which linked clusters and resources the person asking may view, with that person's props, in this project", async () => {
      installLookups({
        clusters: [readyCluster(), otherCluster()],
        resources: [readyHost(HOST_ID, "web-host")],
      });

      await InvestigationThread.buildTurnContext({
        projectId: PROJECT_ID,
        subject: INCIDENT_SUBJECT,
        aiRunId: ObjectID.generate(),
        props: ASKER_PROPS,
      });

      const clusterCheck: jest.SpyInstance =
        KubernetesClusterAiAccessService.getStatusesViewableBy as unknown as jest.SpyInstance;
      const resourceCheck: jest.SpyInstance =
        ResourceAiAccessService.getStatusesViewableBy as unknown as jest.SpyInstance;

      expect(clusterCheck).toHaveBeenCalledTimes(1);
      expect(clusterCheck.mock.calls[0]![0]).toEqual({
        props: ASKER_PROPS,
        projectId: PROJECT_ID,
        statuses: [readyCluster(), otherCluster()],
      });
      expect(resourceCheck).toHaveBeenCalledTimes(1);
      expect(resourceCheck.mock.calls[0]![0]).toEqual({
        props: ASKER_PROPS,
        projectId: PROJECT_ID,
        statuses: [readyHost(HOST_ID, "web-host")],
      });
    });

    test("offers kubectl only on the clusters the person asking may view, and names none of the others", async () => {
      installLookups({
        clusters: [readyCluster(), otherCluster()],
        viewableClusterIds: [readyCluster().clusterId],
      });

      const context: InvestigationThreadTurnContext =
        await InvestigationThread.buildTurnContext({
          projectId: PROJECT_ID,
          subject: INCIDENT_SUBJECT,
          aiRunId: ObjectID.generate(),
          props: ASKER_PROPS,
        });

      const clusters: string = await listed(context, "list_cluster_access");

      expect(clusters).toContain(readyCluster().clusterId);
      expect(clusters).not.toContain(OTHER_CLUSTER_ID);
      expect(context.additionalSystemInstructions).toContain(
        'Cluster "gke-test-cluster"',
      );
      expect(context.additionalSystemInstructions).not.toContain(
        "payments-prod",
      );
      expect(context.additionalSystemInstructions).not.toContain(
        OTHER_CLUSTER_ID,
      );
      expect(context.additionalSystemInstructions).toContain(
        INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
      );

      const runKubectl: ChatExtraTool | undefined = context.extraTools.find(
        (tool: ChatExtraTool): boolean => {
          return tool.definition.name === "run_kubectl";
        },
      );

      // Asked to run on the other cluster anyway: refused before anything runs.
      const outcome: { success: boolean; textForLlm?: string | undefined } =
        await runKubectl!.execute({
          clusterId: OTHER_CLUSTER_ID,
          command: "kubectl auth can-i --list",
          rationale: "What may the agent do?",
        });

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toContain(
        "is not one of the clusters OneUptime AI may inspect",
      );
    });

    test("a person who may view none of the linked clusters gets no terminal, and the answer can say why", async () => {
      installLookups({
        clusters: [readyCluster(), otherCluster()],
        viewableClusterIds: [],
      });

      const context: InvestigationThreadTurnContext =
        await InvestigationThread.buildTurnContext({
          projectId: PROJECT_ID,
          subject: INCIDENT_SUBJECT,
          aiRunId: ObjectID.generate(),
          props: ASKER_PROPS,
        });

      expect(context.extraTools).toEqual([]);
      expect(context.additionalSystemInstructions).not.toContain(
        "read-only terminal",
      );
      expect(context.additionalSystemInstructions).not.toContain(
        "# Cluster access",
      );
      expect(context.additionalSystemInstructions).toContain(
        INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
      );
    });

    test("infrastructure resources follow the same rule", async () => {
      installLookups({
        resources: [
          readyHost(HOST_ID, "web-host"),
          readyHost(OTHER_HOST_ID, "payments-host"),
        ],
        viewableResourceIds: [HOST_ID],
      });

      const context: InvestigationThreadTurnContext =
        await InvestigationThread.buildTurnContext({
          projectId: PROJECT_ID,
          subject: INCIDENT_SUBJECT,
          aiRunId: ObjectID.generate(),
          props: ASKER_PROPS,
        });

      const hosts: string = await listed(
        context,
        LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
      );

      expect(hosts).toContain(HOST_ID);
      expect(hosts).not.toContain(OTHER_HOST_ID);
      expect(context.additionalSystemInstructions).not.toContain(
        "payments-host",
      );
      expect(context.additionalSystemInstructions).toContain(
        INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
      );
    });

    test("with everything in view, nothing is said to be out of view", async () => {
      installLookups({
        clusters: [readyCluster(), otherCluster()],
        resources: [readyHost(HOST_ID, "web-host")],
      });

      const context: InvestigationThreadTurnContext =
        await InvestigationThread.buildTurnContext({
          projectId: PROJECT_ID,
          subject: INCIDENT_SUBJECT,
          aiRunId: ObjectID.generate(),
          props: ASKER_PROPS,
        });

      expect(await listed(context, "list_cluster_access")).toContain(
        OTHER_CLUSTER_ID,
      );
      expect(context.additionalSystemInstructions).not.toContain(
        INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
      );
    });

    test("a view check that fails fails the context, so the turn answers without commands", async () => {
      installLookups({ clusters: [readyCluster()] });
      (
        KubernetesClusterAiAccessService.getStatusesViewableBy as unknown as jest.SpyInstance
      ).mockRejectedValue(new Error("permission read failed") as never);

      await expect(
        InvestigationThread.buildTurnContext({
          projectId: PROJECT_ID,
          subject: INCIDENT_SUBJECT,
          aiRunId: ObjectID.generate(),
          props: ASKER_PROPS,
        }),
      ).rejects.toThrow("permission read failed");
    });
  });
});
