import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaReplaced, {
  CriteriaReplacedBecause,
} from "../../../../Server/Utils/Monitor/MonitorCriteriaReplaced";
import MonitorTurnedOff from "../../../../Server/Utils/Monitor/MonitorTurnedOff";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../../Types/ObjectID";
import { readStatusChangeNote } from "../../../../Utils/Monitor/StatusChangeNotes";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT A MONITOR'S OLD CRITERIA LEAVE OPEN WHEN A TEMPLATE TAKES THEM OFF IT
 * (issues #11260, #11266): resolved, as turning monitoring off resolves
 * what the monitor can no longer resolve itself (MonitorTurnedOff), for the
 * criteria the write removed and only those, with a note of OneUptime's
 * own on each record's timeline.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function stepsWith(
  criteria: Array<{ id: string; resolvesIncidents?: boolean }>,
): MonitorSteps {
  return {
    data: {
      monitorStepsInstanceArray: [
        {
          data: {
            monitorCriteria: {
              data: {
                monitorCriteriaInstanceArray: criteria.map(
                  (entry: { id: string; resolvesIncidents?: boolean }) => {
                    return {
                      data: {
                        id: entry.id,
                        incidents: [
                          {
                            id: `${entry.id}-incident`,
                            title: "Offline",
                            description: "",
                            autoResolveIncident:
                              entry.resolvesIncidents !== false,
                          },
                        ],
                        alerts: [],
                      },
                    } as unknown as MonitorCriteriaInstance;
                  },
                ),
              },
            },
          },
        },
      ],
    },
  } as unknown as MonitorSteps;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("resolving what removed criteria left open", () => {
  it("resolves for the criteria the write removed, with the monitor named", async () => {
    const resolveSpy: SpyInstance<
      typeof MonitorTurnedOff.resolveWhatItWouldResolve
    > = jest
      .spyOn(MonitorTurnedOff, "resolveWhatItWouldResolve")
      .mockResolvedValue({
        resolvedIncidentIds: ["incident-1"],
        resolvedAlertIds: [],
      });

    const result: Awaited<
      ReturnType<
        typeof MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen
      >
    > = await MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorName: "WB1500KSK02",
      templateName: "WB Ping Monitor Template v2",
      stepsBefore: stepsWith([{ id: "v1-offline" }, { id: "kept" }]),
      stepsAfter: stepsWith([{ id: "kept" }, { id: "v2-offline" }]),
      because: CriteriaReplacedBecause.LinkedToTemplate,
    });

    expect(result.resolvedIncidentIds).toEqual(["incident-1"]);

    const asked: Parameters<
      typeof MonitorTurnedOff.resolveWhatItWouldResolve
    >[0] = resolveSpy.mock.calls[0]![0];
    const monitor: Monitor = asked.monitor;

    expect(asked.templateIds).toEqual({
      incidents: { "v1-offline": ["v1-offline-incident"] },
      alerts: {},
    });
    expect(monitor.id?.toString()).toBe(MONITOR_ID.toString());
    expect(monitor.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(monitor.name).toBe("WB1500KSK02");

    const rootCause: string = await asked.getRootCause("incident");

    expect(rootCause).toContain("**WB1500KSK02**");
    expect(rootCause).toContain("**WB Ping Monitor Template v2**");
  });

  it("asks nothing when no criteria that resolves on its own was removed", async () => {
    const resolveSpy: SpyInstance<
      typeof MonitorTurnedOff.resolveWhatItWouldResolve
    > = jest.spyOn(MonitorTurnedOff, "resolveWhatItWouldResolve");

    const result: Awaited<
      ReturnType<
        typeof MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen
      >
    > = await MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorName: "WB1500KSK02",
      templateName: "WB Ping",
      stepsBefore: stepsWith([
        { id: "kept" },
        { id: "by-hand", resolvesIncidents: false },
      ]),
      stepsAfter: stepsWith([{ id: "kept" }]),
      because: CriteriaReplacedBecause.ClearedOnUnlink,
    });

    expect(result).toEqual({ resolvedIncidentIds: [], resolvedAlertIds: [] });
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("writes each root cause as one of OneUptime's own notes, which the timeline reads back with its values", () => {
    for (const because of [
      CriteriaReplacedBecause.LinkedToTemplate,
      CriteriaReplacedBecause.ClearedOnUnlink,
    ]) {
      for (const kind of ["incident", "alert"] as const) {
        const stored: string = MonitorCriteriaReplaced.getRootCause({
          kind: kind,
          because: because,
          monitorName: "core*sw_01",
          templateName: "WB [Ping] v2",
        });

        const read: ReturnType<typeof readStatusChangeNote> =
          readStatusChangeNote(stored);

        expect({ because, kind, read: Boolean(read) }).toEqual({
          because,
          kind,
          read: true,
        });
        expect(read!.note.written).toMatch(
          kind === "incident" ? /this incident/i : /this alert/i,
        );
        expect(Object.keys(read!.values).sort()).toEqual([
          "monitor",
          "template",
        ]);
      }
    }
  });
});
