import Monitor from "../../../../Models/DatabaseModels/Monitor";
import UserService from "../../../../Server/Services/UserService";
import MonitorCriteriaReplaced, {
  CriteriaChangeResolved,
  CriteriaReplacedBecause,
} from "../../../../Server/Utils/Monitor/MonitorCriteriaReplaced";
import MonitorTurnedOff, {
  MonitorTurnedOffResult,
} from "../../../../Server/Utils/Monitor/MonitorTurnedOff";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import { readStatusChangeNote } from "../../../../Utils/Monitor/StatusChangeNotes";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT A MONITOR'S OLD CRITERIA LEAVE OPEN WHEN A WRITE TAKES THEM OFF IT
 * (issues #11260, #11266, #11453): resolved, as turning monitoring off
 * resolves what the monitor can no longer resolve itself (MonitorTurnedOff),
 * for the criteria the write removed and only those, with a note of
 * OneUptime's own on each record's timeline that says why - a link, an
 * unlink, a template's sync or any other change of the criteria - and
 * counted for the change that made the writes.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OLD_TEMPLATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const NEW_TEMPLATE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const USER_LINK: string = "[Jane Doe](https://oneuptime.example/users/jane)";

interface CriteriaShape {
  id: string;
  // Its incident resolves on its own: true unless said.
  resolvesIncidents?: boolean;
  // It has an alert, resolving on its own.
  alertResolves?: boolean;
}

function stepsWith(criteria: Array<CriteriaShape>): MonitorSteps {
  return {
    data: {
      monitorStepsInstanceArray: [
        {
          data: {
            monitorCriteria: {
              data: {
                monitorCriteriaInstanceArray: criteria.map(
                  (entry: CriteriaShape) => {
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
                        alerts: entry.alertResolves
                          ? [
                              {
                                id: `${entry.id}-alert`,
                                title: "Degraded",
                                description: "",
                                autoResolveAlert: true,
                              },
                            ]
                          : [],
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

type ResolveSpy = SpyInstance<
  typeof MonitorTurnedOff.resolveWhatItWouldResolve
>;

function resolvesWith(result: MonitorTurnedOffResult): ResolveSpy {
  return jest
    .spyOn(MonitorTurnedOff, "resolveWhatItWouldResolve")
    .mockResolvedValue(result);
}

function askedOf(
  spy: ResolveSpy,
  call: number = 0,
): Parameters<typeof MonitorTurnedOff.resolveWhatItWouldResolve>[0] {
  return spy.mock.calls[call]![0];
}

const readTemplateName: (templateId: ObjectID) => Promise<string> = async (
  templateId: ObjectID,
): Promise<string> => {
  return templateId.toString() === NEW_TEMPLATE_ID.toString()
    ? "WB Ping Monitor Template v2"
    : "WB Ping Monitor Template v1";
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("resolveWhatRemovedCriteriaLeftOpen", () => {
  it("asks MonitorTurnedOff for the criteria the write removed, with the monitor named", async () => {
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: ["incident-1"],
      resolvedAlertIds: [],
    });

    const result: MonitorTurnedOffResult =
      await MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitorName: "WB1500KSK02",
        templateIds: {
          incidents: { "v1-offline": ["v1-offline-incident"] },
          alerts: {},
        },
        because: CriteriaReplacedBecause.LinkedToTemplate,
        getTemplateName: async (): Promise<string> => {
          return "WB Ping Monitor Template v2";
        },
      });

    expect(result.resolvedIncidentIds).toEqual(["incident-1"]);

    const monitor: Monitor = askedOf(spy).monitor;

    expect(askedOf(spy).templateIds).toEqual({
      incidents: { "v1-offline": ["v1-offline-incident"] },
      alerts: {},
    });
    expect(monitor.id?.toString()).toBe(MONITOR_ID.toString());
    expect(monitor.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(monitor.name).toBe("WB1500KSK02");

    const rootCause: string = await askedOf(spy).getRootCause("incident");

    expect(rootCause).toContain("**WB1500KSK02**");
    expect(rootCause).toContain("**WB Ping Monitor Template v2**");
  });

  it("asks nothing when nothing that resolves on its own was removed", async () => {
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
    });

    const result: MonitorTurnedOffResult =
      await MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitorName: "WB1500KSK02",
        templateIds: { incidents: {}, alerts: {} },
        because: CriteriaReplacedBecause.CriteriaChanged,
        getTemplateName: async (): Promise<string> => {
          return "";
        },
      });

    expect(result).toEqual({ resolvedIncidentIds: [], resolvedAlertIds: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads the template's name and the person once, and only when a root cause is asked for", async () => {
    let templateReads: number = 0;
    const userSpy: SpyInstance<typeof UserService.getUserMarkdownString> = jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue(FeedMarkdown.asMarkdown(USER_LINK));
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: ["incident-1"],
      resolvedAlertIds: ["alert-1"],
    });

    await MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorName: "Checkout API",
      templateIds: {
        incidents: { gone: ["gone-incident"] },
        alerts: { gone: ["gone-alert"] },
      },
      because: CriteriaReplacedBecause.CriteriaChanged,
      getTemplateName: async (): Promise<string> => {
        templateReads++;
        return "";
      },
      changedByUserId: USER_ID,
    });

    expect(userSpy).not.toHaveBeenCalled();

    const incidentCause: string = await askedOf(spy).getRootCause("incident");
    const alertCause: string = await askedOf(spy).getRootCause("alert");

    expect(templateReads).toBe(1);
    expect(userSpy).toHaveBeenCalledTimes(1);
    expect(userSpy.mock.calls[0]![0]).toEqual({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
    expect(incidentCause).toContain("Jane Doe");
    expect(incidentCause).toContain("this incident");
    expect(alertCause).toContain("this alert");
  });

  it("names nobody for a change no person made: an API key, Terraform", async () => {
    const userSpy: SpyInstance<typeof UserService.getUserMarkdownString> =
      jest.spyOn(UserService, "getUserMarkdownString");
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: ["incident-1"],
      resolvedAlertIds: [],
    });

    await MonitorCriteriaReplaced.resolveWhatRemovedCriteriaLeftOpen({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorName: "Checkout API",
      templateIds: { incidents: { gone: ["gone-incident"] }, alerts: {} },
      because: CriteriaReplacedBecause.CriteriaChanged,
      getTemplateName: async (): Promise<string> => {
        return "";
      },
    });

    const rootCause: string = await askedOf(spy).getRootCause("incident");

    expect(userSpy).not.toHaveBeenCalled();
    expect(rootCause).toBe(
      MonitorCriteriaReplaced.getRootCause({
        kind: "incident",
        because: CriteriaReplacedBecause.CriteriaChanged,
        monitorName: "Checkout API",
        templateName: "",
      }),
    );
  });
});

describe("resolveAfterWrite: what a write of steps took off the monitor", () => {
  it("resolves for the criteria the write removed and only those: a criteria it keeps, by its id, goes on resolving its own", async () => {
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: ["incident-1"],
      resolvedAlertIds: ["alert-1"],
    });

    await MonitorCriteriaReplaced.resolveAfterWrite({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorName: "WB1500KSK02",
      stepsBefore: stepsWith([
        { id: "removed", alertResolves: true },
        { id: "kept", alertResolves: true },
      ]),
      stepsAfter: stepsWith([{ id: "kept" }, { id: "added" }]),
      templateIdBefore: null,
      writtenTemplate: { isWritten: false, id: null },
      readTemplateName: readTemplateName,
    });

    expect(askedOf(spy).templateIds).toEqual({
      incidents: { removed: ["removed-incident"] },
      alerts: { removed: ["removed-alert"] },
    });
  });

  it("never resolves what a person resolves by hand: a removed criteria with auto-resolve off asks nothing", async () => {
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
    });

    const result: MonitorTurnedOffResult =
      await MonitorCriteriaReplaced.resolveAfterWrite({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitorName: "WB1500KSK02",
        stepsBefore: stepsWith([
          { id: "by-hand", resolvesIncidents: false },
          { id: "kept" },
        ]),
        stepsAfter: stepsWith([{ id: "kept" }]),
        templateIdBefore: OLD_TEMPLATE_ID,
        writtenTemplate: { isWritten: false, id: null },
        readTemplateName: readTemplateName,
      });

    expect(result).toEqual({ resolvedIncidentIds: [], resolvedAlertIds: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("asks nothing for a write that keeps every criteria: Terraform resending the steps", async () => {
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
    });

    await MonitorCriteriaReplaced.resolveAfterWrite({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorName: "WB1500KSK02",
      stepsBefore: stepsWith([{ id: "a" }, { id: "b", alertResolves: true }]),
      stepsAfter: stepsWith([{ id: "b" }, { id: "a" }]),
      templateIdBefore: null,
      writtenTemplate: { isWritten: false, id: null },
      readTemplateName: readTemplateName,
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves for every criteria when the write clears the steps", async () => {
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: ["incident-1", "incident-2"],
      resolvedAlertIds: [],
    });

    await MonitorCriteriaReplaced.resolveAfterWrite({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorName: "WB1500KSK02",
      stepsBefore: stepsWith([{ id: "a" }, { id: "b" }]),
      stepsAfter: null,
      templateIdBefore: null,
      writtenTemplate: { isWritten: false, id: null },
      readTemplateName: readTemplateName,
    });

    expect(askedOf(spy).templateIds).toEqual({
      incidents: { a: ["a-incident"], b: ["b-incident"] },
      alerts: {},
    });
  });

  it("reads a write of another template as a link to it, named in the root cause", async () => {
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: ["incident-1"],
      resolvedAlertIds: [],
    });

    await MonitorCriteriaReplaced.resolveAfterWrite({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorName: "WB1500KSK02",
      stepsBefore: stepsWith([{ id: "v1-offline" }]),
      stepsAfter: stepsWith([{ id: "v2-offline" }]),
      templateIdBefore: OLD_TEMPLATE_ID,
      writtenTemplate: { isWritten: true, id: NEW_TEMPLATE_ID },
      readTemplateName: readTemplateName,
    });

    expect(await askedOf(spy).getRootCause("incident")).toBe(
      MonitorCriteriaReplaced.getRootCause({
        kind: "incident",
        because: CriteriaReplacedBecause.LinkedToTemplate,
        monitorName: "WB1500KSK02",
        templateName: "WB Ping Monitor Template v2",
      }),
    );
  });

  it("reads a write of no template, with criteria taken off, as an unlink that cleared them, naming the template it left", async () => {
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: ["incident-1"],
      resolvedAlertIds: [],
    });

    await MonitorCriteriaReplaced.resolveAfterWrite({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorName: "WB1500KSK02",
      stepsBefore: stepsWith([{ id: "v1-offline" }]),
      stepsAfter: stepsWith([]),
      templateIdBefore: OLD_TEMPLATE_ID,
      writtenTemplate: { isWritten: true, id: null },
      readTemplateName: readTemplateName,
    });

    expect(await askedOf(spy).getRootCause("alert")).toBe(
      MonitorCriteriaReplaced.getRootCause({
        kind: "alert",
        because: CriteriaReplacedBecause.ClearedOnUnlink,
        monitorName: "WB1500KSK02",
        templateName: "WB Ping Monitor Template v1",
      }),
    );
  });

  it("reads any other write as a change of the monitor's criteria, by the person who made it", async () => {
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue(FeedMarkdown.asMarkdown(USER_LINK));
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: ["incident-1"],
      resolvedAlertIds: [],
    });

    await MonitorCriteriaReplaced.resolveAfterWrite({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorName: "Checkout API",
      stepsBefore: stepsWith([{ id: "slow" }, { id: "down" }]),
      stepsAfter: stepsWith([{ id: "down" }]),
      // Linked to a template, written as it is: no link, no unlink.
      templateIdBefore: OLD_TEMPLATE_ID,
      writtenTemplate: { isWritten: true, id: OLD_TEMPLATE_ID },
      changedByUserId: USER_ID,
      readTemplateName: readTemplateName,
    });

    expect(await askedOf(spy).getRootCause("incident")).toBe(
      MonitorCriteriaReplaced.getRootCause({
        kind: "incident",
        because: CriteriaReplacedBecause.CriteriaChanged,
        monitorName: "Checkout API",
        templateName: "",
        changedBy: FeedMarkdown.asMarkdown(USER_LINK),
      }),
    );
  });

  it("takes the reason and the template's name of the change it runs in, and reads no name", async () => {
    let reads: number = 0;
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: ["incident-1"],
      resolvedAlertIds: [],
    });

    await MonitorCriteriaReplaced.withinChange(
      {
        because: CriteriaReplacedBecause.SyncedFromTemplate,
        templateName: "Production API Health",
      },
      async (): Promise<void> => {
        await MonitorCriteriaReplaced.resolveAfterWrite({
          monitorId: MONITOR_ID,
          projectId: PROJECT_ID,
          monitorName: "Checkout API",
          stepsBefore: stepsWith([{ id: "slow" }, { id: "down" }]),
          stepsAfter: stepsWith([{ id: "down" }]),
          templateIdBefore: OLD_TEMPLATE_ID,
          writtenTemplate: { isWritten: false, id: null },
          changedByUserId: USER_ID,
          readTemplateName: async (): Promise<string> => {
            reads++;
            return "read";
          },
        });
      },
    );

    expect(await askedOf(spy).getRootCause("incident")).toBe(
      MonitorCriteriaReplaced.getRootCause({
        kind: "incident",
        because: CriteriaReplacedBecause.SyncedFromTemplate,
        monitorName: "Checkout API",
        templateName: "Production API Health",
      }),
    );
    expect(reads).toBe(0);
  });
});

describe("withinChange: what a change's writes resolved, counted", () => {
  it("counts what every write within it resolved, each record once", async () => {
    resolvesWith({
      resolvedIncidentIds: ["incident-1", "incident-2"],
      resolvedAlertIds: ["alert-1"],
    });

    const result: { value: string } & CriteriaChangeResolved =
      await MonitorCriteriaReplaced.withinChange(
        {
          because: CriteriaReplacedBecause.SyncedFromTemplate,
          templateName: "Production API Health",
        },
        async (): Promise<string> => {
          for (let write: number = 0; write < 2; write++) {
            await MonitorCriteriaReplaced.resolveAfterWrite({
              monitorId: MONITOR_ID,
              projectId: PROJECT_ID,
              monitorName: "Checkout API",
              stepsBefore: stepsWith([{ id: "slow" }]),
              stepsAfter: stepsWith([]),
              templateIdBefore: OLD_TEMPLATE_ID,
              writtenTemplate: { isWritten: false, id: null },
              readTemplateName: readTemplateName,
            });
          }

          return "synced";
        },
      );

    expect(result).toEqual({
      value: "synced",
      resolvedIncidentCount: 2,
      resolvedAlertCount: 1,
    });
  });

  it("counts nothing for a change whose writes took nothing off", async () => {
    const result: { value: number } & CriteriaChangeResolved =
      await MonitorCriteriaReplaced.withinChange(
        {
          because: CriteriaReplacedBecause.LinkedToTemplate,
          templateName: "WB Ping Monitor Template v2",
        },
        async (): Promise<number> => {
          return 7;
        },
      );

    expect(result).toEqual({
      value: 7,
      resolvedIncidentCount: 0,
      resolvedAlertCount: 0,
    });
  });

  it("adds a change within another to the outer one, which keeps its own reason", async () => {
    const spy: ResolveSpy = resolvesWith({
      resolvedIncidentIds: ["inner-incident"],
      resolvedAlertIds: [],
    });

    const outer: CriteriaChangeResolved =
      await MonitorCriteriaReplaced.withinChange(
        {
          because: CriteriaReplacedBecause.LinkedToTemplate,
          templateName: "Outer",
        },
        async (): Promise<void> => {
          await MonitorCriteriaReplaced.withinChange(
            {
              because: CriteriaReplacedBecause.ClearedOnUnlink,
              templateName: "Inner",
            },
            async (): Promise<void> => {
              await MonitorCriteriaReplaced.resolveAfterWrite({
                monitorId: MONITOR_ID,
                projectId: PROJECT_ID,
                monitorName: "Checkout API",
                stepsBefore: stepsWith([{ id: "slow" }]),
                stepsAfter: stepsWith([]),
                templateIdBefore: OLD_TEMPLATE_ID,
                writtenTemplate: { isWritten: true, id: null },
                readTemplateName: readTemplateName,
              });
            },
          );

          expect(
            MonitorCriteriaReplaced.getReasonOfWrite({
              templateIdBefore: OLD_TEMPLATE_ID,
              writtenTemplate: { isWritten: false, id: null },
            }).because,
          ).toBe(CriteriaReplacedBecause.LinkedToTemplate);
        },
      );

    expect(await askedOf(spy).getRootCause("incident")).toContain("**Inner**");
    expect(outer.resolvedIncidentCount).toBe(1);
  });

  it("does not reach a write that runs outside it, after it", async () => {
    await MonitorCriteriaReplaced.withinChange(
      {
        because: CriteriaReplacedBecause.SyncedFromTemplate,
        templateName: "Production API Health",
      },
      async (): Promise<void> => {
        return;
      },
    );

    expect(
      MonitorCriteriaReplaced.getReasonOfWrite({
        templateIdBefore: OLD_TEMPLATE_ID,
        writtenTemplate: { isWritten: false, id: null },
      }),
    ).toEqual({
      because: CriteriaReplacedBecause.CriteriaChanged,
      templateId: null,
    });
  });
});

describe("the root causes", () => {
  it("writes each as one of OneUptime's own notes, which the timeline reads back with its values", () => {
    const cases: Array<{
      because: CriteriaReplacedBecause;
      changedBy?: string;
      values: Array<string>;
    }> = [
      {
        because: CriteriaReplacedBecause.LinkedToTemplate,
        values: ["monitor", "template"],
      },
      {
        because: CriteriaReplacedBecause.ClearedOnUnlink,
        values: ["monitor", "template"],
      },
      {
        because: CriteriaReplacedBecause.SyncedFromTemplate,
        values: ["monitor", "template"],
      },
      {
        because: CriteriaReplacedBecause.CriteriaChanged,
        changedBy: USER_LINK,
        values: ["monitor", "user"],
      },
      {
        because: CriteriaReplacedBecause.CriteriaChanged,
        values: ["monitor"],
      },
    ];

    for (const entry of cases) {
      for (const kind of ["incident", "alert"] as const) {
        const stored: string = MonitorCriteriaReplaced.getRootCause({
          kind: kind,
          because: entry.because,
          monitorName: "core*sw_01",
          templateName: "WB [Ping] v2",
          changedBy: entry.changedBy
            ? FeedMarkdown.asMarkdown(entry.changedBy)
            : undefined,
        });

        const read: ReturnType<typeof readStatusChangeNote> =
          readStatusChangeNote(stored);

        expect({ entry, kind, read: Boolean(read) }).toEqual({
          entry,
          kind,
          read: true,
        });
        expect(read!.note.written).toMatch(
          kind === "incident" ? /this incident/i : /this alert/i,
        );
        expect(Object.keys(read!.values).sort()).toEqual(entry.values);
      }
    }
  });

  it("says a different sentence for each reason", () => {
    const sentences: Set<string> = new Set<string>(
      [
        CriteriaReplacedBecause.LinkedToTemplate,
        CriteriaReplacedBecause.ClearedOnUnlink,
        CriteriaReplacedBecause.SyncedFromTemplate,
        CriteriaReplacedBecause.CriteriaChanged,
      ].map((because: CriteriaReplacedBecause): string => {
        return MonitorCriteriaReplaced.getRootCause({
          kind: "incident",
          because: because,
          monitorName: "Checkout API",
          templateName: "Production API Health",
        });
      }),
    );

    expect(sentences.size).toBe(4);
  });
});
