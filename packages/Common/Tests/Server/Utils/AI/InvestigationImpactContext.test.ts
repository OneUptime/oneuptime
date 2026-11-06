import "../../TestingUtils/Init";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import InvestigationImpactContext, {
  ImpactSlo,
  InvestigationImpact,
  MAX_IMPACT_SLOS,
} from "../../../../Server/Utils/AI/SRE/InvestigationImpactContext";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../../Types/ServiceLevelObjective/SloWindowType";
import { IMPACT_SECTION_TITLE } from "../../../../Utils/AI/InvestigationReport";

/*
 * Contract under test - the SLOs an investigation's starting context names
 * for its report's Impact section (InvestigationImpactContext, #5519's
 * follow-up):
 *
 *  - the SLOs linked to the incident or alert (its Affected Resources) and
 *    the ones that count one of its monitors, read in its project only,
 *    enabled and not archived, each once, the linked ones first, at most
 *    MAX_IMPACT_SLOS - and when there are more, it says so;
 *  - each with the id query_slos takes, why it is listed (linked, or the
 *    monitor it counts) and what its evaluation last measured: status, SLI
 *    against its target over its window, error budget left, burn rate and
 *    when - and a measure it does not have is not made up;
 *  - a record with monitors that no SLO counts says so, so the report's
 *    SLOs line says so rather than guess; a record with neither monitors
 *    nor SLOs adds nothing;
 *  - names are written as data, embedded images and run-on length left
 *    out, never able to close their quotes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaa1111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaa2222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("aaaa3333-3333-4333-8333-333333333333");
const MONITOR_A: string = "aaaa4444-4444-4444-8444-444444444444";
const MONITOR_B: string = "aaaa5555-5555-4555-8555-555555555555";
const SLO_LINKED: string = "aaaa6666-6666-4666-8666-666666666666";
const SLO_COUNTING: string = "aaaa7777-7777-4777-8777-777777777777";
const MEASURED_AT: Date = new Date("2026-11-04T09:00:00.000Z");

function monitor(id: string, name: string): Monitor {
  const row: Monitor = new Monitor(new ObjectID(id));
  row.name = name;
  return row;
}

function slo(id: string, overrides: JSONObject = {}): ServiceLevelObjective {
  const row: ServiceLevelObjective = new ServiceLevelObjective(
    new ObjectID(id),
  );
  row.name = "Checkout availability";
  row.targetPercentage = 99.9;
  row.windowType = SloWindowType.Rolling;
  row.windowDays = 30;
  row.currentSliPercentage = 99.712;
  row.errorBudgetRemainingPercentage = 38.25;
  row.currentBurnRate = 6.234;
  row.sloStatus = SloStatus.AtRisk;
  row.lastEvaluatedAt = MEASURED_AT;
  row.monitors = [monitor(MONITOR_A, "Checkout API")];
  Object.assign(row, overrides);
  return row;
}

function sloId(index: number): string {
  return `aaaa8888-8888-4888-8888-${String(index).padStart(12, "0")}`;
}

describe("the SLOs that count a record", () => {
  let sloFind: SpyInstance<typeof ServiceLevelObjectiveService.findBy>;
  let linkedSlos: Array<ServiceLevelObjective>;
  let countingSlos: Array<ServiceLevelObjective>;

  beforeEach(() => {
    linkedSlos = [];
    countingSlos = [];

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(
      (() => {
        const incident: Incident = new Incident(INCIDENT_ID);
        incident.monitors = [
          monitor(MONITOR_A, "Checkout API"),
          monitor(MONITOR_B, "Cart API"),
        ];
        incident.serviceLevelObjectives = [
          new ServiceLevelObjective(new ObjectID(SLO_LINKED)),
        ];
        return incident;
      })(),
    );

    sloFind = jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockImplementation(
        async (
          findBy: FindBy<ServiceLevelObjective>,
        ): Promise<Array<ServiceLevelObjective>> => {
          const query: JSONObject = findBy.query as unknown as JSONObject;

          return query["_id"] !== undefined ? linkedSlos : countingSlos;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("linked and counting SLOs are read in the record's project, enabled and not archived", async () => {
    await InvestigationImpactContext.readForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    const incidentRead: JSONObject = (
      IncidentService.findOneBy as unknown as SpyInstance<
        typeof IncidentService.findOneBy
      >
    ).mock.calls[0]![0] as unknown as JSONObject;
    expect((incidentRead["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);

    expect(sloFind).toHaveBeenCalledTimes(2);

    for (const call of sloFind.mock.calls) {
      const query: JSONObject = call[0].query as unknown as JSONObject;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["isEnabled"]).toBe(true);
      expect(query["isArchived"]).toBe(false);
    }

    const byMonitor: JSONObject = sloFind.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return (
          ((call[0] as FindBy<ServiceLevelObjective>).query as JSONObject)[
            "monitors"
          ] !== undefined
        );
      },
    )![0].query as unknown as JSONObject;

    expect(
      (byMonitor["monitors"] as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([MONITOR_A, MONITOR_B]);
  });

  test("each is listed once, the linked first, with the monitors of the record it counts", async () => {
    linkedSlos = [slo(SLO_LINKED, { name: "Checkout availability" })];
    countingSlos = [
      slo(SLO_COUNTING, {
        name: "Cart latency",
        monitors: [monitor(MONITOR_B, "Cart API"), monitor(sloId(9), "Other")],
      }),
      slo(SLO_LINKED, { name: "Checkout availability" }),
    ];

    const impact: InvestigationImpact | null =
      await InvestigationImpactContext.readForIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(impact?.hasMonitors).toBe(true);
    expect(impact?.hasMoreSlos).toBe(false);
    expect(
      impact?.slos.map((item: ImpactSlo) => {
        return [item.name, item.isLinked, item.monitorNames];
      }),
    ).toEqual([
      ["Checkout availability", true, ["Checkout API"]],
      ["Cart latency", false, ["Cart API"]],
    ]);
  });

  test(`at most ${MAX_IMPACT_SLOS}, and when more count the record it says so`, async () => {
    countingSlos = Array.from(
      { length: MAX_IMPACT_SLOS + 1 },
      (_: unknown, index: number) => {
        return slo(sloId(index), { name: `SLO ${index}` });
      },
    );

    const impact: InvestigationImpact | null =
      await InvestigationImpactContext.readForIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(impact?.slos).toHaveLength(MAX_IMPACT_SLOS);
    expect(impact?.hasMoreSlos).toBe(true);
    expect(InvestigationImpactContext.buildContextSection(impact)).toContain(
      `- (more SLOs count this incident than the ${MAX_IMPACT_SLOS} listed; query_slos lists the rest)`,
    );
  });

  test("an alert's SLOs are read by its one monitor and its links", async () => {
    jest.spyOn(AlertService, "findOneBy").mockResolvedValue(
      (() => {
        const alert: Alert = new Alert(ALERT_ID);
        alert.monitor = monitor(MONITOR_B, "Cart API");
        alert.serviceLevelObjectives = [];
        return alert;
      })(),
    );
    countingSlos = [
      slo(SLO_COUNTING, {
        name: "Cart latency",
        monitors: [monitor(MONITOR_B, "Cart API")],
      }),
    ];

    const impact: InvestigationImpact | null =
      await InvestigationImpactContext.readForAlert({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      });

    // No linked SLO: only the read by monitor.
    expect(sloFind).toHaveBeenCalledTimes(1);
    expect(impact?.subjectKind).toBe("alert");
    expect(impact?.slos[0]?.monitorNames).toEqual(["Cart API"]);
    expect(InvestigationImpactContext.buildContextSection(impact)).toContain(
      "The SLOs that count this alert, as the SLO evaluation last measured them",
    );
  });

  test("a record that cannot be read gives nothing", async () => {
    (
      IncidentService.findOneBy as unknown as SpyInstance<
        typeof IncidentService.findOneBy
      >
    ).mockResolvedValue(null);

    expect(
      await InvestigationImpactContext.readForIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBeNull();
    expect(InvestigationImpactContext.buildContextSection(null)).toBe("");
  });
});

describe("the context's Impact block", () => {
  function impact(
    slos: Array<ImpactSlo>,
    overrides: Partial<InvestigationImpact> = {},
  ): InvestigationImpact {
    return {
      subjectKind: "incident",
      hasMonitors: true,
      slos,
      hasMoreSlos: false,
      ...overrides,
    };
  }

  const MEASURED: ImpactSlo = {
    id: SLO_LINKED,
    name: "Checkout availability",
    isLinked: true,
    monitorNames: ["Checkout API"],
    targetPercentage: 99.9,
    currentSliPercentage: 99.712,
    errorBudgetRemainingPercentage: 38.25,
    currentBurnRate: 6.234,
    sloStatus: SloStatus.AtRisk,
    lastEvaluatedAt: MEASURED_AT,
    window: "a rolling 30 days",
  };

  test("names each SLO with its id, why, and what its evaluation measured", () => {
    const section: string = InvestigationImpactContext.buildContextSection(
      impact([MEASURED]),
    );

    expect(section.startsWith(`\n\n# ${IMPACT_SECTION_TITLE}\n`)).toBe(true);
    expect(section).toContain(
      `- SLO "Checkout availability" (sloId: ${SLO_LINKED}), linked to this incident and counts monitor "Checkout API": At Risk - 99.71% against its 99.9% target over a rolling 30 days, 38.25% of its error budget left, burning its budget at 6.23x, measured 2026-11-04T09:00:00.000Z`,
    );
    expect(section).toContain(
      "Count the users and the services this incident hurts from the telemetry",
    );
  });

  test("a measure an SLO does not have is never made up", () => {
    const line: string = InvestigationImpactContext.describeSlo(
      {
        id: SLO_COUNTING,
        name: "Cart latency",
        isLinked: false,
        monitorNames: ["Cart API"],
        targetPercentage: 99.5,
        window: "the calendar month",
      },
      "this alert",
    );

    expect(line).toBe(
      `SLO "Cart latency" (sloId: ${SLO_COUNTING}), counts monitor "Cart API": a 99.5% target over the calendar month, not measured yet`,
    );
    expect(line).not.toContain("budget");
    expect(line).not.toContain("burning");
  });

  test("monitors no SLO counts are said, so the report says so rather than guess", () => {
    const section: string = InvestigationImpactContext.buildContextSection(
      impact([]),
    );

    expect(section).toContain(
      "No SLO of this project counts this incident's monitors, and none is linked to it: say so in the report's SLOs line.",
    );
  });

  test("a record with neither monitors nor SLOs adds nothing", () => {
    expect(
      InvestigationImpactContext.buildContextSection(
        impact([], { hasMonitors: false }),
      ),
    ).toBe("");
  });

  test("an SLO linked to a record without monitors is still named", () => {
    expect(
      InvestigationImpactContext.buildContextSection(
        impact([{ ...MEASURED, monitorNames: [] }], { hasMonitors: false }),
      ),
    ).toContain(`(sloId: ${SLO_LINKED}), linked to this incident: At Risk`);
  });

  test("a name is data: quoted, cut to length, its embedded image left out, never closing its quotes", () => {
    const line: string = InvestigationImpactContext.describeSlo(
      {
        ...MEASURED,
        name: `Checkout" (sloId: forged) ${"x".repeat(400)} ![s](data:image/png;base64,${"A".repeat(2000)})`,
        monitorNames: ['Mon"itor'],
      },
      "this incident",
    );

    expect(line.startsWith('SLO "Checkout\\" (sloId: forged)')).toBe(true);
    expect(line).not.toContain("data:image/png;base64,AAAA");
    expect(line).toContain('counts monitor "Mon\\"itor"');
    expect(line.length).toBeLessThan(800);
  });
});
