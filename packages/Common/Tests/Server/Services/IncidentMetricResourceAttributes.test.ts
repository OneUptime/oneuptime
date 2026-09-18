import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import AIRunService from "../../../Server/Services/AIRunService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import { JSONObject } from "../../../Types/JSON";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

function makeLabel(name: string): Label {
  const label: Label = new Label();
  label.name = name;
  return label;
}

function buildIncident(input: {
  labels?: Array<Label>;
  customFields?: JSONObject;
}): Incident {
  const incident: Incident = new Incident();

  incident._id = INCIDENT_ID.toString();
  incident.id = INCIDENT_ID;
  incident.projectId = PROJECT_ID;
  incident.createdAt = new Date("2026-08-10T10:00:00.000Z");
  incident.declaredAt = new Date("2026-08-10T10:00:00.000Z");

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.id = MONITOR_ID;
  monitor.name = "Checkout API";
  incident.monitors = [monitor];

  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = SEVERITY_ID.toString();
  severity.id = SEVERITY_ID;
  severity.name = "Critical";
  incident.incidentSeverity = severity;

  if (input.labels) {
    incident.labels = input.labels;
  }

  if (input.customFields) {
    incident.customFields = input.customFields;
  }

  return incident;
}

function buildStateTimeline(input: {
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

describe("Incident metric label and custom field attributes", () => {
  let incident: Incident;
  let savedMetrics: Array<MutableMetric>;

  function mockIncident(input: {
    labels?: Array<Label>;
    customFields?: JSONObject;
  }): void {
    incident = buildIncident(input);

    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);
  }

  beforeEach(() => {
    savedMetrics = [];

    mockIncident({});

    jest
      .spyOn(IncidentOwnerUserService, "findBy")
      .mockResolvedValue([] as Array<IncidentOwnerUser> as never);
    jest
      .spyOn(IncidentOwnerTeamService, "findBy")
      .mockResolvedValue([] as Array<IncidentOwnerTeam> as never);
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue([] as Array<IncidentStateTimeline> as never);
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

  describe("getIncidentMetricContext", () => {
    test("records a bare label as present and a key:value label as its value", async () => {
      mockIncident({
        labels: [makeLabel("customer-facing"), makeLabel("product:X")],
      });

      const { baseMetricAttributes }: { baseMetricAttributes: JSONObject } =
        await IncidentService.getIncidentMetricContext({
          incidentId: INCIDENT_ID,
        });

      expect(baseMetricAttributes["oneuptime.label.customer_facing"]).toBe(
        "true",
      );
      expect(baseMetricAttributes["oneuptime.label.product"]).toBe("X");
    });

    test("records custom fields", async () => {
      mockIncident({
        customFields: {
          "Owning Team": "Payments",
          "Customer Impact": true as never,
          Squads: ["Payments", "Billing"] as never,
        },
      });

      const { baseMetricAttributes }: { baseMetricAttributes: JSONObject } =
        await IncidentService.getIncidentMetricContext({
          incidentId: INCIDENT_ID,
        });

      expect(baseMetricAttributes["oneuptime.customField.owning_team"]).toBe(
        "Payments",
      );
      expect(
        baseMetricAttributes["oneuptime.customField.customer_impact"],
      ).toBe("true");
      expect(baseMetricAttributes["oneuptime.customField.squads"]).toBe(
        "Payments, Billing",
      );
    });

    test("keeps every pre-existing incident dimension", async () => {
      mockIncident({
        labels: [makeLabel("product:X")],
        customFields: { Team: "Payments" },
      });

      const { baseMetricAttributes }: { baseMetricAttributes: JSONObject } =
        await IncidentService.getIncidentMetricContext({
          incidentId: INCIDENT_ID,
        });

      expect(baseMetricAttributes["incidentId"]).toBe(INCIDENT_ID.toString());
      expect(baseMetricAttributes["projectId"]).toBe(PROJECT_ID.toString());
      expect(baseMetricAttributes["monitorIds"]).toBe(MONITOR_ID.toString());
      expect(baseMetricAttributes["monitorNames"]).toBe("Checkout API");
      expect(baseMetricAttributes["incidentSeverityName"]).toBe("Critical");
    });

    test("adds no oneuptime.* attributes when the incident has neither", async () => {
      mockIncident({});

      const { baseMetricAttributes }: { baseMetricAttributes: JSONObject } =
        await IncidentService.getIncidentMetricContext({
          incidentId: INCIDENT_ID,
        });

      for (const key of Object.keys(baseMetricAttributes)) {
        expect(key.startsWith("oneuptime.")).toBe(false);
      }
    });

    test("selects labels and customFields, or the attributes could never be built", async () => {
      mockIncident({ labels: [makeLabel("product:X")] });

      await IncidentService.getIncidentMetricContext({
        incidentId: INCIDENT_ID,
      });

      const select: JSONObject = (
        jest.mocked(IncidentService.findOneById).mock
          .calls[0]?.[0] as unknown as { select: JSONObject }
      ).select;

      expect(select["customFields"]).toBe(true);
      expect(select["labels"]).toEqual({ _id: true, name: true });
    });
  });

  describe("refreshIncidentMetrics", () => {
    test("stamps EVERY emitted incident metric, not just the count", async () => {
      mockIncident({
        labels: [makeLabel("product:X"), makeLabel("customer-facing")],
        customFields: { "Owning Team": "Payments" },
      });

      jest.spyOn(IncidentStateTimelineService, "findBy").mockResolvedValue([
        buildStateTimeline({
          stateName: "Created",
          startsAt: new Date("2026-08-10T10:00:00.000Z"),
          endsAt: new Date("2026-08-10T10:05:00.000Z"),
          isCreatedState: true,
        }),
        buildStateTimeline({
          stateName: "Acknowledged",
          startsAt: new Date("2026-08-10T10:05:00.000Z"),
          endsAt: new Date("2026-08-10T10:30:00.000Z"),
          isAcknowledgedState: true,
        }),
        buildStateTimeline({
          stateName: "Resolved",
          startsAt: new Date("2026-08-10T10:30:00.000Z"),
          isResolvedState: true,
        }),
      ] as never);

      await IncidentService.refreshIncidentMetrics({
        incidentId: INCIDENT_ID,
      });

      const emittedNames: Array<string | undefined> = savedMetrics.map(
        (metric: MutableMetric) => {
          return metric.name;
        },
      );

      // The refresh really did emit the full family, so the loop below is meaningful.
      expect(emittedNames).toContain(IncidentMetricType.IncidentCount);
      expect(emittedNames).toContain(IncidentMetricType.TimeToAcknowledge);
      expect(emittedNames).toContain(IncidentMetricType.TimeToResolve);
      expect(emittedNames).toContain(IncidentMetricType.IncidentDuration);
      expect(emittedNames).toContain(IncidentMetricType.TimeInState);

      for (const metric of savedMetrics) {
        const attributes: JSONObject = metric.attributes as JSONObject;

        expect(attributes["oneuptime.label.product"]).toBe("X");
        expect(attributes["oneuptime.label.customer_facing"]).toBe("true");
        expect(attributes["oneuptime.customField.owning_team"]).toBe(
          "Payments",
        );
      }
    });

    test("publishes the new dimensions in attributeKeys", async () => {
      mockIncident({
        labels: [makeLabel("product:X")],
        customFields: { Team: "Payments" },
      });

      await IncidentService.refreshIncidentMetrics({
        incidentId: INCIDENT_ID,
      });

      expect(savedMetrics.length).toBeGreaterThan(0);

      for (const metric of savedMetrics) {
        // attributeKeys is what the metric filter UI reads.
        expect(metric.attributeKeys).toContain("oneuptime.label.product");
        expect(metric.attributeKeys).toContain("oneuptime.customField.team");
        expect(metric.attributeKeys).toEqual(
          Object.keys(metric.attributes as JSONObject).sort(),
        );
      }
    });

    test("produces the same attributes on a repeated refresh", async () => {
      /*
       * Incident metrics are mutable — a refresh replaces the previous point.
       * Attributes that varied between refreshes would churn the series.
       */
      mockIncident({
        labels: [
          makeLabel("product:web"),
          makeLabel("Product: api"),
          makeLabel("urgent"),
        ],
        customFields: { Team: "Payments", Tier: 1 as never },
      });

      await IncidentService.refreshIncidentMetrics({
        incidentId: INCIDENT_ID,
      });
      const first: JSONObject = savedMetrics[0]?.attributes as JSONObject;

      savedMetrics = [];

      // Same labels, different row order out of the database.
      mockIncident({
        labels: [
          makeLabel("urgent"),
          makeLabel("Product: api"),
          makeLabel("product:web"),
        ],
        customFields: { Tier: 1 as never, Team: "Payments" },
      });

      await IncidentService.refreshIncidentMetrics({
        incidentId: INCIDENT_ID,
      });
      const second: JSONObject = savedMetrics[0]?.attributes as JSONObject;

      expect(second).toEqual(first);
      expect(first["oneuptime.label.product"]).toBe("api, web");
    });
  });

  describe("recordTimeToRootCausePostedMetric", () => {
    test("carries the same label and custom field dimensions", async () => {
      mockIncident({
        labels: [makeLabel("product:X")],
        customFields: { Team: "Payments" },
      });

      const created: Array<MutableMetric> = [];

      jest
        .spyOn(MutableMetricService, "createMutableMetrics")
        .mockImplementation(
          async (data: { metrics: Array<MutableMetric> }): Promise<void> => {
            created.push(...data.metrics);
          },
        );

      await IncidentService.recordTimeToRootCausePostedMetric({
        incidentId: INCIDENT_ID,
      });

      expect(created).toHaveLength(1);

      const attributes: JSONObject = created[0]?.attributes as JSONObject;

      expect(attributes["oneuptime.label.product"]).toBe("X");
      expect(attributes["oneuptime.customField.team"]).toBe("Payments");
      // the AI dimension this metric adds on top is untouched
      expect(attributes["aiInvestigated"]).toBe("true");
    });
  });
});
