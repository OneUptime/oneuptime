import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorAutoResolveTemplates, {
  MonitorAutoResolveTemplateIds,
} from "../../../Utils/Monitor/MonitorAutoResolveTemplates";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH OF ITS INCIDENTS AND ALERTS A MONITOR RESOLVES ON ITS OWN.
 *
 * A check result (MonitorResource) and turning monitoring off
 * (MonitorTurnedOff, issue #6400) both read a monitor's auto-resolving
 * templates here, so they never disagree about which records are the
 * monitor's to resolve. These tests pin what is listed: each criteria's
 * templates set to resolve on their own, by the criteria's id - and the
 * legacy template with no id, listed as it is.
 */

interface TemplateFixture {
  id?: string | undefined;
  autoResolve?: boolean | undefined;
}

function criteria(data: {
  id?: string | undefined;
  incidents?: Array<TemplateFixture>;
  alerts?: Array<TemplateFixture>;
}): MonitorCriteriaInstance {
  return {
    data: {
      id: data.id,
      incidents: (data.incidents || []).map((template: TemplateFixture) => {
        return {
          id: template.id,
          title: "Offline",
          description: "",
          autoResolveIncident: template.autoResolve,
        };
      }),
      alerts: (data.alerts || []).map((template: TemplateFixture) => {
        return {
          id: template.id,
          title: "Offline",
          description: "",
          autoResolveAlert: template.autoResolve,
        };
      }),
    },
  } as unknown as MonitorCriteriaInstance;
}

function steps(
  ...criteriaPerStep: Array<Array<MonitorCriteriaInstance | null>>
): MonitorSteps {
  return {
    data: {
      monitorStepsInstanceArray: criteriaPerStep.map(
        (criteriaInstances: Array<MonitorCriteriaInstance | null>) => {
          return {
            data: {
              monitorCriteria: {
                data: {
                  monitorCriteriaInstanceArray: criteriaInstances,
                },
              },
            },
          };
        },
      ),
    },
  } as unknown as MonitorSteps;
}

describe("MonitorAutoResolveTemplates.fromCriteriaInstances", () => {
  test("lists each criteria's incident and alert templates that resolve on their own, by the criteria's id", () => {
    const templateIds: MonitorAutoResolveTemplateIds =
      MonitorAutoResolveTemplates.fromCriteriaInstances([
        criteria({
          id: "offline",
          incidents: [
            { id: "incident-auto", autoResolve: true },
            { id: "incident-by-hand", autoResolve: false },
            { id: "incident-auto-2", autoResolve: true },
          ],
          alerts: [
            { id: "alert-auto", autoResolve: true },
            { id: "alert-by-hand" },
          ],
        }),
        criteria({
          id: "degraded",
          alerts: [{ id: "alert-degraded", autoResolve: true }],
        }),
      ]);

    expect(templateIds).toEqual({
      incidents: {
        offline: ["incident-auto", "incident-auto-2"],
      },
      alerts: {
        offline: ["alert-auto"],
        degraded: ["alert-degraded"],
      },
    });
  });

  test("a criteria with no auto-resolving template is not listed at all", () => {
    const templateIds: MonitorAutoResolveTemplateIds =
      MonitorAutoResolveTemplates.fromCriteriaInstances([
        criteria({
          id: "offline",
          incidents: [{ id: "incident", autoResolve: false }],
          alerts: [{ id: "alert" }],
        }),
        criteria({ id: "online" }),
      ]);

    expect(templateIds).toEqual({ incidents: {}, alerts: {} });
    expect(MonitorAutoResolveTemplates.isEmpty(templateIds)).toBe(true);
  });

  test("a template with no id (written before templates had ids) is listed as it is, so its criteria still resolves", () => {
    const templateIds: MonitorAutoResolveTemplateIds =
      MonitorAutoResolveTemplates.fromCriteriaInstances([
        criteria({
          id: "offline",
          incidents: [{ autoResolve: true }],
          alerts: [{ autoResolve: true }],
        }),
      ]);

    expect(templateIds.incidents["offline"]).toEqual([undefined]);
    expect(templateIds.alerts["offline"]).toEqual([undefined]);
    expect(MonitorAutoResolveTemplates.isEmpty(templateIds)).toBe(false);
  });

  test("a criteria with no id is left out: nothing it opened can name it", () => {
    expect(
      MonitorAutoResolveTemplates.fromCriteriaInstances([
        criteria({
          incidents: [{ id: "incident", autoResolve: true }],
          alerts: [{ id: "alert", autoResolve: true }],
        }),
      ]),
    ).toEqual({ incidents: {}, alerts: {} });
  });

  test("a criteria with no incidents or alerts at all, or none of its data, is skipped", () => {
    expect(
      MonitorAutoResolveTemplates.fromCriteriaInstances([
        { data: { id: "offline" } } as unknown as MonitorCriteriaInstance,
        { data: undefined } as unknown as MonitorCriteriaInstance,
      ]),
    ).toEqual({ incidents: {}, alerts: {} });
  });

  test("the same criteria id on two steps gathers both steps' templates", () => {
    expect(
      MonitorAutoResolveTemplates.fromMonitorSteps(
        steps(
          [
            criteria({
              id: "offline",
              incidents: [{ id: "first", autoResolve: true }],
            }),
          ],
          [
            criteria({
              id: "offline",
              incidents: [{ id: "second", autoResolve: true }],
            }),
          ],
        ),
      ).incidents,
    ).toEqual({ offline: ["first", "second"] });
  });
});

describe("MonitorAutoResolveTemplates.getCriteriaInstances", () => {
  test("every criteria of every step, in the order of the steps", () => {
    const first: MonitorCriteriaInstance = criteria({ id: "a" });
    const second: MonitorCriteriaInstance = criteria({ id: "b" });
    const third: MonitorCriteriaInstance = criteria({ id: "c" });

    expect(
      MonitorAutoResolveTemplates.getCriteriaInstances(
        steps([first, second], [null], [third]),
      ),
    ).toEqual([first, second, third]);
  });

  test("a monitor with no steps, or steps with no criteria, has none", () => {
    expect(MonitorAutoResolveTemplates.getCriteriaInstances(undefined)).toEqual(
      [],
    );
    expect(MonitorAutoResolveTemplates.getCriteriaInstances(null)).toEqual([]);
    expect(
      MonitorAutoResolveTemplates.getCriteriaInstances({
        data: undefined,
      } as unknown as MonitorSteps),
    ).toEqual([]);
    expect(
      MonitorAutoResolveTemplates.getCriteriaInstances({
        data: {
          monitorStepsInstanceArray: [
            { data: undefined },
            { data: { monitorCriteria: { data: undefined } } },
            null,
          ],
        },
      } as unknown as MonitorSteps),
    ).toEqual([]);
  });
});

describe("MonitorAutoResolveTemplates.fromMonitorSteps", () => {
  test("reads the monitor's steps, as a check result does", () => {
    expect(
      MonitorAutoResolveTemplates.fromMonitorSteps(
        steps([
          criteria({
            id: "offline",
            incidents: [{ id: "incident", autoResolve: true }],
            alerts: [{ id: "alert", autoResolve: true }],
          }),
          criteria({ id: "online" }),
        ]),
      ),
    ).toEqual({
      incidents: { offline: ["incident"] },
      alerts: { offline: ["alert"] },
    });
  });

  test("a monitor with no steps resolves nothing on its own", () => {
    expect(
      MonitorAutoResolveTemplates.isEmpty(
        MonitorAutoResolveTemplates.fromMonitorSteps(undefined),
      ),
    ).toBe(true);
  });
});

describe("MonitorAutoResolveTemplates.isEmpty", () => {
  test("not empty when only incidents, or only alerts, resolve on their own", () => {
    expect(
      MonitorAutoResolveTemplates.isEmpty({
        incidents: { offline: ["incident"] },
        alerts: {},
      }),
    ).toBe(false);
    expect(
      MonitorAutoResolveTemplates.isEmpty({
        incidents: {},
        alerts: { offline: ["alert"] },
      }),
    ).toBe(false);
  });
});

/*
 * WHAT THE CRITERIA A WRITE TOOK OFF A MONITOR RESOLVED ON THEIR OWN
 * (issues #11260, #11266): a template's criteria replace the monitor's on a
 * link that brings its settings, and are cleared on an unlink that clears
 * them. What the removed criteria opened, nothing can resolve once they are
 * gone - a check matches records by their criteria's id - so the write
 * resolves it itself (MonitorCriteriaReplaced).
 */
describe("MonitorAutoResolveTemplates.ofCriteriaRemoved", () => {
  const before: MonitorSteps = steps(
    [
      criteria({
        id: "offline",
        incidents: [{ id: "offline-incident", autoResolve: true }],
        alerts: [{ id: "offline-alert", autoResolve: true }],
      }),
      criteria({
        id: "degraded",
        alerts: [{ id: "degraded-alert", autoResolve: true }],
      }),
    ],
    [
      criteria({
        id: "slow",
        incidents: [{ id: "slow-incident", autoResolve: true }],
      }),
    ],
  );

  test("lists every criteria of before when after has none: an unlink that clears them", () => {
    expect(
      MonitorAutoResolveTemplates.ofCriteriaRemoved({
        before: before,
        after: steps([], []),
      }),
    ).toEqual({
      incidents: {
        offline: ["offline-incident"],
        slow: ["slow-incident"],
      },
      alerts: {
        offline: ["offline-alert"],
        degraded: ["degraded-alert"],
      },
    });
  });

  test("leaves out a criteria after keeps by its id, in any step: it goes on resolving its own records", () => {
    expect(
      MonitorAutoResolveTemplates.ofCriteriaRemoved({
        before: before,
        after: steps(
          [criteria({ id: "brand-new" })],
          [criteria({ id: "offline" })],
        ),
      }),
    ).toEqual({
      incidents: { slow: ["slow-incident"] },
      alerts: { degraded: ["degraded-alert"] },
    });
  });

  test("is empty when after keeps every criteria, or before had none that resolve on their own", () => {
    expect(
      MonitorAutoResolveTemplates.isEmpty(
        MonitorAutoResolveTemplates.ofCriteriaRemoved({
          before: before,
          after: before,
        }),
      ),
    ).toBe(true);

    expect(
      MonitorAutoResolveTemplates.isEmpty(
        MonitorAutoResolveTemplates.ofCriteriaRemoved({
          before: steps([criteria({ id: "by-hand", incidents: [{ id: "x" }] })]),
          after: undefined,
        }),
      ),
    ).toBe(true);
  });

  test("lists everything before resolved when after is missing", () => {
    expect(
      MonitorAutoResolveTemplates.ofCriteriaRemoved({
        before: before,
        after: null,
      }).incidents,
    ).toEqual({
      offline: ["offline-incident"],
      slow: ["slow-incident"],
    });
  });
});
