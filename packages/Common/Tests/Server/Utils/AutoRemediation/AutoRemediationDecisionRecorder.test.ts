import AutoRemediationDecision from "../../../../Models/DatabaseModels/AutoRemediationDecision";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AutoRemediationDecisionService from "../../../../Server/Services/AutoRemediationDecisionService";
import MonitorService from "../../../../Server/Services/MonitorService";
import AutoRemediationDecisionRecorder from "../../../../Server/Utils/AutoRemediation/AutoRemediationDecisionRecorder";
import logger from "../../../../Server/Utils/Logger";
import {
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
  MAX_DECISION_MONITORS,
} from "../../../../Types/AutoRemediation/AutoRemediationDecision";
import { JSONObject } from "../../../../Types/JSON";
import {
  KubernetesAiAccessGap,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import { ResourceAiAccessStatus } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The recorder the rule engine writes its decision with. Saving is
 * observability: it never throws, it saves nothing for a subject that is
 * gone, and it stores what was collected - an incident's or an alert's,
 * never both. The monitors an entry names are read once per evaluation,
 * scoped to the project, and only when asked for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const ALERT_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

function monitorId(index: number): ObjectID {
  return new ObjectID(`44444444-4444-4444-8444-44444444444${index}`);
}

describe("AutoRemediationDecisionRecorder", () => {
  let saved: Array<AutoRemediationDecision>;

  beforeEach(() => {
    saved = [];
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(AutoRemediationDecisionService, "create")
      .mockImplementation(async (createBy: unknown) => {
        const decision: AutoRemediationDecision = (
          createBy as { data: AutoRemediationDecision }
        ).data;
        saved.push(decision);
        return decision;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("saves what was collected as one Evaluated decision of the incident", async () => {
    const recorder: AutoRemediationDecisionRecorder =
      new AutoRemediationDecisionRecorder({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    recorder.add({
      lane: AutoRemediationDecisionLane.KubernetesCluster,
      reason: AutoRemediationDecisionReason.ClusterFixesOff,
      kubernetesClusterId: "c-1",
      kubernetesClusterName: "prod-east",
      gaps: [],
    });
    recorder.add({
      lane: AutoRemediationDecisionLane.Rule,
      reason: AutoRemediationDecisionReason.NoRulesConfigured,
    });

    await recorder.save();

    expect(saved).toHaveLength(1);
    expect(saved[0]!.stage).toBe(AutoRemediationDecisionStage.Evaluated);
    expect(saved[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(saved[0]!.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(saved[0]!.alertId).toBeUndefined();
    // Stored without what the entry does not say.
    expect(saved[0]!.entries).toEqual([
      {
        lane: "KubernetesCluster",
        reason: "ClusterFixesOff",
        kubernetesClusterId: "c-1",
        kubernetesClusterName: "prod-east",
      },
      { lane: "Rule", reason: "NoRulesConfigured" },
    ]);
    expect(AutoRemediationDecisionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ props: { isRoot: true } }),
    );
  });

  it("saves an alert's decision on the alert", async () => {
    const recorder: AutoRemediationDecisionRecorder =
      new AutoRemediationDecisionRecorder({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      });

    await recorder.save();

    expect(saved[0]!.alertId?.toString()).toBe(ALERT_ID.toString());
    expect(saved[0]!.incidentId).toBeUndefined();
    expect(saved[0]!.entries).toEqual([]);
  });

  it("saves nothing once discarded, or without a subject", async () => {
    const discarded: AutoRemediationDecisionRecorder =
      new AutoRemediationDecisionRecorder({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });
    discarded.discard();
    await discarded.save();

    await new AutoRemediationDecisionRecorder({
      projectId: PROJECT_ID,
    }).save();

    expect(saved).toHaveLength(0);
  });

  it("never throws when saving fails, and says so in the log", async () => {
    jest
      .spyOn(AutoRemediationDecisionService, "create")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      new AutoRemediationDecisionRecorder({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }).save(),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("records that remediation waits for the investigation", async () => {
    await AutoRemediationDecisionRecorder.recordWaitingForInvestigation({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]!.stage).toBe(
      AutoRemediationDecisionStage.WaitingForInvestigation,
    );
    expect(saved[0]!.entries).toEqual([]);
  });

  it("hands out a copy of the entries", () => {
    const recorder: AutoRemediationDecisionRecorder =
      new AutoRemediationDecisionRecorder({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });
    recorder.add({
      lane: AutoRemediationDecisionLane.Project,
      reason: AutoRemediationDecisionReason.EnableAiOff,
    });

    recorder.getEntries().pop();

    expect(recorder.getEntries()).toHaveLength(1);
  });

  describe("the signal's monitors", () => {
    it("reads them once, deduped, capped and scoped to the project", async () => {
      const read: jest.SpiedFunction<typeof MonitorService.findBy> = jest
        .spyOn(MonitorService, "findBy")
        .mockResolvedValue([
          Object.assign(new Monitor(), {
            _id: monitorId(1).toString(),
            name: "Checkout website",
          }),
          Object.assign(new Monitor(), { _id: monitorId(2).toString() }),
        ]);

      const ids: Array<ObjectID> = [
        monitorId(1),
        monitorId(1),
        ...[2, 3, 4, 5, 6, 7].map(monitorId),
      ];
      const recorder: AutoRemediationDecisionRecorder =
        new AutoRemediationDecisionRecorder({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
          monitorIds: ids,
        });

      const first: Array<{ id: string; name: string }> =
        await recorder.getSubjectMonitors();
      const second: Array<{ id: string; name: string }> =
        await recorder.getSubjectMonitors();

      expect(first).toEqual([
        { id: monitorId(1).toString(), name: "Checkout website" },
        { id: monitorId(2).toString(), name: "" },
      ]);
      expect(second).toBe(first);
      expect(read).toHaveBeenCalledTimes(1);

      const args: Parameters<typeof MonitorService.findBy>[0] =
        read.mock.calls[0]![0];
      const query: JSONObject = args.query as unknown as JSONObject;
      expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
      expect(args.limit).toBe(MAX_DECISION_MONITORS);
      expect(args.props).toEqual({ isRoot: true });
    });

    it("reads nothing for a signal without monitors", async () => {
      const read: jest.SpiedFunction<typeof MonitorService.findBy> = jest.spyOn(
        MonitorService,
        "findBy",
      );

      await expect(
        new AutoRemediationDecisionRecorder({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        }).getSubjectMonitors(),
      ).resolves.toEqual([]);
      expect(read).not.toHaveBeenCalled();
    });

    it("names none, without throwing, when the read fails", async () => {
      jest
        .spyOn(MonitorService, "findBy")
        .mockRejectedValue(new Error("database is down"));

      await expect(
        new AutoRemediationDecisionRecorder({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
          monitorIds: [monitorId(1)],
        }).getSubjectMonitors(),
      ).resolves.toEqual([]);
    });
  });

  describe("readiness gaps", () => {
    it("keeps a cluster's gaps that block fixes, in the page's words", () => {
      const gaps: Array<KubernetesAiAccessGap> = [
        {
          code: "investigation_disabled",
          title: "Investigation is off",
          description: "d1",
          nextStep: "n1",
          blocks: "investigation",
        },
        {
          code: "remediation_write_access_missing",
          title: "The agent is read-only",
          description: "d2",
          nextStep: "n2",
          blocks: "remediation",
        },
        {
          code: "ai_agent_not_connected",
          title: "The agent is not connected",
          description: "d3",
          nextStep: "n3",
          blocks: "both",
        },
      ];

      expect(
        AutoRemediationDecisionRecorder.getClusterRemediationGaps({
          gaps,
        } as unknown as KubernetesClusterAiAccessStatus),
      ).toEqual([
        {
          code: "remediation_write_access_missing",
          title: "The agent is read-only",
          description: "d2",
          nextStep: "n2",
        },
        {
          code: "ai_agent_not_connected",
          title: "The agent is not connected",
          description: "d3",
          nextStep: "n3",
        },
      ]);
    });

    it("keeps a resource's gaps that block fixes", () => {
      expect(
        AutoRemediationDecisionRecorder.getResourceRemediationGaps({
          gaps: [
            {
              code: "agent_offline",
              title: "Offline",
              nextStep: "Start it",
              blocksInvestigation: true,
              blocksRemediation: true,
            },
            {
              code: "investigation_disabled",
              title: "Off",
              nextStep: "Turn it on",
              blocksInvestigation: true,
              blocksRemediation: false,
            },
          ],
        } as unknown as ResourceAiAccessStatus),
      ).toEqual([
        { code: "agent_offline", title: "Offline", nextStep: "Start it" },
      ]);
    });

    it("reads no gaps as none", () => {
      expect(
        AutoRemediationDecisionRecorder.getClusterRemediationGaps(
          {} as unknown as KubernetesClusterAiAccessStatus,
        ),
      ).toEqual([]);
      expect(
        AutoRemediationDecisionRecorder.getResourceRemediationGaps(
          {} as unknown as ResourceAiAccessStatus,
        ),
      ).toEqual([]);
    });
  });
});
