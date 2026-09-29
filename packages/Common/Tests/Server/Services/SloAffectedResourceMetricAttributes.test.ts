import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import Search from "../../../Types/BaseDatabase/Search";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import AlertMetricType from "../../../Types/Alerts/AlertMetricType";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE,
  SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE,
} from "../../../Utils/Slo/SloMetricType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An SLO's Metrics page charts the incidents and alerts that affect it by
 * filtering incident / alert metrics on serviceLevelObjectiveIds with a
 * substring Search - the same way a monitor's page filters on monitorIds.
 * Nothing else links those metrics to an SLO: a burn-rate incident has no
 * monitors, so without these attributes the SLO's Incident and Alert tabs
 * would be permanently empty while every chart still rendered.
 *
 * So these pin, through the real services with only their data sources
 * stubbed, that both writers stamp the key the page reads (through the shared
 * constant), with the comma-joined shape a Search can match, on every metric
 * they emit - and that they still select the relation the value comes from.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CHECKOUT_SLO_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SEARCH_SLO_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

function makeSlo(
  id: ObjectID,
  name?: string | undefined,
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = id.toString();
  slo.id = id;

  if (name !== undefined) {
    slo.name = name;
  }

  return slo;
}

function makeMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.id = MONITOR_ID;
  monitor.name = "Checkout API";
  return monitor;
}

/*
 * What a Search on the ids attribute does in ClickHouse: a substring match.
 * Used to prove the stamped value is one an SLO page's filter really selects.
 */
function searchMatches(attributeValue: unknown, sloId: ObjectID): boolean {
  const search: Search<string> = new Search<string>(sloId.toString());

  return (
    typeof attributeValue === "string" && attributeValue.includes(search.value)
  );
}

describe("SLO attributes on incident metrics", () => {
  let savedMetrics: Array<MutableMetric>;

  function mockIncident(
    serviceLevelObjectives: Array<ServiceLevelObjective> | undefined,
  ): void {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.id = INCIDENT_ID;
    incident.projectId = PROJECT_ID;
    incident.createdAt = new Date("2026-08-10T10:00:00.000Z");
    incident.declaredAt = new Date("2026-08-10T10:00:00.000Z");
    incident.monitors = [makeMonitor()];

    if (serviceLevelObjectives) {
      incident.serviceLevelObjectives = serviceLevelObjectives;
    }

    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);
  }

  function stateTimeline(input: {
    stateName: string;
    startsAt: Date;
    endsAt?: Date;
    isCreatedState?: boolean;
    isAcknowledgedState?: boolean;
    isResolvedState?: boolean;
  }): IncidentStateTimeline {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline._id = ObjectID.generate().toString();
    timeline.id = new ObjectID(timeline._id);
    timeline.projectId = PROJECT_ID;
    timeline.incidentStateId = ObjectID.generate();
    timeline.startsAt = input.startsAt;

    if (input.endsAt) {
      timeline.endsAt = input.endsAt;
    }

    const state: IncidentState = new IncidentState();
    state.name = input.stateName;
    state.isCreatedState = input.isCreatedState || false;
    state.isAcknowledgedState = input.isAcknowledgedState || false;
    state.isResolvedState = input.isResolvedState || false;
    timeline.incidentState = state;

    return timeline;
  }

  beforeEach(() => {
    savedMetrics = [];

    mockIncident(undefined);

    jest
      .spyOn(IncidentOwnerUserService, "findBy")
      .mockResolvedValue([] as Array<IncidentOwnerUser> as never);
    jest
      .spyOn(IncidentOwnerTeamService, "findBy")
      .mockResolvedValue([] as Array<IncidentOwnerTeam> as never);
    jest.spyOn(IncidentStateTimelineService, "findBy").mockResolvedValue([
      stateTimeline({
        stateName: "Created",
        startsAt: new Date("2026-08-10T10:00:00.000Z"),
        endsAt: new Date("2026-08-10T10:05:00.000Z"),
        isCreatedState: true,
      }),
      stateTimeline({
        stateName: "Acknowledged",
        startsAt: new Date("2026-08-10T10:05:00.000Z"),
        endsAt: new Date("2026-08-10T10:30:00.000Z"),
        isAcknowledgedState: true,
      }),
      stateTimeline({
        stateName: "Resolved",
        startsAt: new Date("2026-08-10T10:30:00.000Z"),
        isResolvedState: true,
      }),
    ] as never);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MutableMetricService, "replaceEntityMetrics")
      .mockImplementation(
        async (data: { metrics: Array<MutableMetric> }): Promise<void> => {
          savedMetrics.push(...data.metrics);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function contextAttributes(): Promise<JSONObject> {
    const { baseMetricAttributes }: { baseMetricAttributes: JSONObject } =
      await IncidentService.getIncidentMetricContext({
        incidentId: INCIDENT_ID,
      });

    return baseMetricAttributes;
  }

  test("stamps the affected SLOs' ids and names, comma-joined like monitorIds", async () => {
    mockIncident([
      makeSlo(CHECKOUT_SLO_ID, "Checkout availability"),
      makeSlo(SEARCH_SLO_ID, "Search availability"),
    ]);

    const attributes: JSONObject = await contextAttributes();

    expect(attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]).toBe(
      `${CHECKOUT_SLO_ID.toString()}, ${SEARCH_SLO_ID.toString()}`,
    );
    expect(attributes[SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE]).toBe(
      "Checkout availability, Search availability",
    );
  });

  test("the value is one each SLO page's Search filter actually selects", async () => {
    mockIncident([
      makeSlo(CHECKOUT_SLO_ID, "Checkout availability"),
      makeSlo(SEARCH_SLO_ID, "Search availability"),
    ]);

    const attributes: JSONObject = await contextAttributes();

    expect(
      searchMatches(
        attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE],
        CHECKOUT_SLO_ID,
      ),
    ).toBe(true);
    expect(
      searchMatches(
        attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE],
        SEARCH_SLO_ID,
      ),
    ).toBe(true);
  });

  test('an incident affecting no SLO records empty strings - the monitorIds shape - never "undefined"', async () => {
    mockIncident(undefined);

    const attributes: JSONObject = await contextAttributes();

    expect(attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]).toBe("");
    expect(attributes[SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE]).toBe("");
    expect(
      searchMatches(
        attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE],
        CHECKOUT_SLO_ID,
      ),
    ).toBe(false);
  });

  test("an SLO whose name did not load still contributes its id, which is what the page filters on", async () => {
    mockIncident([
      makeSlo(CHECKOUT_SLO_ID),
      makeSlo(SEARCH_SLO_ID, "Search availability"),
    ]);

    const attributes: JSONObject = await contextAttributes();

    expect(attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]).toBe(
      `${CHECKOUT_SLO_ID.toString()}, ${SEARCH_SLO_ID.toString()}`,
    );
    expect(attributes[SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE]).toBe(
      "Search availability",
    );
  });

  test("leaves the monitor dimensions exactly as they were", async () => {
    mockIncident([makeSlo(CHECKOUT_SLO_ID, "Checkout availability")]);

    const attributes: JSONObject = await contextAttributes();

    expect(attributes["monitorIds"]).toBe(MONITOR_ID.toString());
    expect(attributes["monitorNames"]).toBe("Checkout API");
  });

  test("selects the SLO relation's id and name, or the attributes could never be built", async () => {
    await contextAttributes();

    const select: JSONObject = (
      jest.mocked(IncidentService.findOneById).mock
        .calls[0]?.[0] as unknown as { select: JSONObject }
    ).select;

    expect(select["serviceLevelObjectives"]).toEqual({ _id: true, name: true });
  });

  test("refreshIncidentMetrics stamps both keys on EVERY emitted incident metric and publishes them", async () => {
    mockIncident([makeSlo(CHECKOUT_SLO_ID, "Checkout availability")]);

    await IncidentService.refreshIncidentMetrics({ incidentId: INCIDENT_ID });

    const emittedNames: Array<string | undefined> = savedMetrics.map(
      (metric: MutableMetric) => {
        return metric.name;
      },
    );

    // The full family really was emitted, so the loop below means something.
    expect(emittedNames).toContain(IncidentMetricType.IncidentCount);
    expect(emittedNames).toContain(IncidentMetricType.TimeToAcknowledge);
    expect(emittedNames).toContain(IncidentMetricType.TimeToResolve);
    expect(emittedNames).toContain(IncidentMetricType.IncidentDuration);

    for (const metric of savedMetrics) {
      const attributes: JSONObject = metric.attributes as JSONObject;

      expect(attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]).toBe(
        CHECKOUT_SLO_ID.toString(),
      );
      expect(attributes[SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE]).toBe(
        "Checkout availability",
      );
      expect(metric.attributeKeys).toContain(
        SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE,
      );
    }
  });
});

describe("SLO attributes on alert metrics", () => {
  let savedMetrics: Array<MutableMetric>;

  function mockAlert(
    serviceLevelObjectives: Array<ServiceLevelObjective> | undefined,
    options: { withMonitor: boolean } = { withMonitor: true },
  ): void {
    const alert: Alert = new Alert();
    alert._id = ALERT_ID.toString();
    alert.id = ALERT_ID;
    alert.projectId = PROJECT_ID;
    alert.createdAt = new Date("2026-08-10T10:00:00.000Z");

    if (options.withMonitor) {
      alert.monitor = makeMonitor();
    }

    if (serviceLevelObjectives) {
      alert.serviceLevelObjectives = serviceLevelObjectives;
    }

    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert as never);
  }

  function stateTimeline(input: {
    startsAt: Date;
    endsAt?: Date;
    isAcknowledgedState?: boolean;
    isResolvedState?: boolean;
  }): AlertStateTimeline {
    const timeline: AlertStateTimeline = new AlertStateTimeline();
    timeline._id = ObjectID.generate().toString();
    timeline.id = new ObjectID(timeline._id);
    timeline.projectId = PROJECT_ID;
    timeline.alertStateId = ObjectID.generate();
    timeline.startsAt = input.startsAt;

    if (input.endsAt) {
      timeline.endsAt = input.endsAt;
    }

    const state: AlertState = new AlertState();
    state.isAcknowledgedState = input.isAcknowledgedState || false;
    state.isResolvedState = input.isResolvedState || false;
    timeline.alertState = state;

    return timeline;
  }

  beforeEach(() => {
    savedMetrics = [];

    mockAlert(undefined);

    // Created -> Acknowledged -> Resolved, so the refresh emits all four metrics.
    jest.spyOn(AlertStateTimelineService, "findBy").mockResolvedValue([
      stateTimeline({
        startsAt: new Date("2026-08-10T10:00:00.000Z"),
        endsAt: new Date("2026-08-10T10:05:00.000Z"),
      }),
      stateTimeline({
        startsAt: new Date("2026-08-10T10:05:00.000Z"),
        endsAt: new Date("2026-08-10T10:30:00.000Z"),
        isAcknowledgedState: true,
      }),
      stateTimeline({
        startsAt: new Date("2026-08-10T10:30:00.000Z"),
        isResolvedState: true,
      }),
    ] as never);
    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MutableMetricService, "replaceEntityMetrics")
      .mockImplementation(
        async (data: { metrics: Array<MutableMetric> }): Promise<void> => {
          savedMetrics.push(...data.metrics);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectFullAlertFamily(): void {
    const emittedNames: Array<string | undefined> = savedMetrics.map(
      (metric: MutableMetric) => {
        return metric.name;
      },
    );

    expect(emittedNames).toContain(AlertMetricType.AlertCount);
    expect(emittedNames).toContain(AlertMetricType.TimeToAcknowledge);
    expect(emittedNames).toContain(AlertMetricType.TimeToResolve);
    expect(emittedNames).toContain(AlertMetricType.AlertDuration);
  }

  test("stamps the affected SLOs' ids and names on EVERY emitted alert metric", async () => {
    mockAlert([
      makeSlo(CHECKOUT_SLO_ID, "Checkout availability"),
      makeSlo(SEARCH_SLO_ID, "Search availability"),
    ]);

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    expectFullAlertFamily();

    for (const metric of savedMetrics) {
      const attributes: JSONObject = metric.attributes as JSONObject;

      expect(attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]).toBe(
        `${CHECKOUT_SLO_ID.toString()}, ${SEARCH_SLO_ID.toString()}`,
      );
      expect(attributes[SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE]).toBe(
        "Checkout availability, Search availability",
      );
      expect(
        searchMatches(
          attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE],
          SEARCH_SLO_ID,
        ),
      ).toBe(true);
      expect(metric.attributeKeys).toContain(
        SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE,
      );
      expect(metric.attributeKeys).toContain(
        SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE,
      );
    }
  });

  test("a burn-rate alert - an SLO and no monitor - is still attributed to its SLO", async () => {
    mockAlert([makeSlo(CHECKOUT_SLO_ID, "Checkout availability")], {
      withMonitor: false,
    });

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    expectFullAlertFamily();

    for (const metric of savedMetrics) {
      const attributes: JSONObject = metric.attributes as JSONObject;

      expect(attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]).toBe(
        CHECKOUT_SLO_ID.toString(),
      );
      expect(attributes["monitorId"]).toBeUndefined();
    }
  });

  test("an alert affecting no SLO records empty strings and keeps its singular monitorId", async () => {
    mockAlert(undefined);

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    for (const metric of savedMetrics) {
      const attributes: JSONObject = metric.attributes as JSONObject;

      expect(attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]).toBe("");
      expect(attributes[SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE]).toBe(
        "",
      );
      expect(attributes["monitorId"]).toBe(MONITOR_ID.toString());
      expect(attributes["monitorName"]).toBe("Checkout API");
    }
  });

  test("every alert metric carries the identical SLO attributes", async () => {
    mockAlert([makeSlo(CHECKOUT_SLO_ID, "Checkout availability")]);

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    const distinctValues: Set<string> = new Set(
      savedMetrics.map((metric: MutableMetric): string => {
        const attributes: JSONObject = metric.attributes as JSONObject;

        return `${attributes[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]}|${attributes[SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE]}`;
      }),
    );

    expect(savedMetrics.length).toBeGreaterThan(1);
    expect(distinctValues.size).toBe(1);
  });

  test("selects the SLO relation's id and name, or the attributes could never be built", async () => {
    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    const select: JSONObject = (
      jest.mocked(AlertService.findOneById).mock.calls[0]?.[0] as unknown as {
        select: JSONObject;
      }
    ).select;

    expect(select["serviceLevelObjectives"]).toEqual({ _id: true, name: true });
  });
});
