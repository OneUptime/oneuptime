import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import AlertMetricType from "../../../Types/Alerts/AlertMetricType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
const ALERT_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
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

function buildAlert(input: {
  labels?: Array<Label>;
  customFields?: JSONObject;
}): Alert {
  const alert: Alert = new Alert();

  alert._id = ALERT_ID.toString();
  alert.id = ALERT_ID;
  alert.projectId = PROJECT_ID;
  alert.createdAt = new Date("2026-08-10T10:00:00.000Z");

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.id = MONITOR_ID;
  monitor.name = "Checkout API";
  alert.monitor = monitor;

  const severity: AlertSeverity = new AlertSeverity();
  severity._id = SEVERITY_ID.toString();
  severity.id = SEVERITY_ID;
  severity.name = "Critical";
  alert.alertSeverity = severity;

  if (input.labels) {
    alert.labels = input.labels;
  }

  if (input.customFields) {
    alert.customFields = input.customFields;
  }

  return alert;
}

function buildStateTimeline(input: {
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

/** Created -> Acknowledged -> Resolved, so the refresh emits all four metrics. */
function fullLifecycle(): Array<AlertStateTimeline> {
  return [
    buildStateTimeline({
      startsAt: new Date("2026-08-10T10:00:00.000Z"),
      endsAt: new Date("2026-08-10T10:05:00.000Z"),
    }),
    buildStateTimeline({
      startsAt: new Date("2026-08-10T10:05:00.000Z"),
      endsAt: new Date("2026-08-10T10:30:00.000Z"),
      isAcknowledgedState: true,
    }),
    buildStateTimeline({
      startsAt: new Date("2026-08-10T10:30:00.000Z"),
      isResolvedState: true,
    }),
  ];
}

describe("Alert metric label and custom field attributes", () => {
  let savedMetrics: Array<MutableMetric>;

  function mockAlert(input: {
    labels?: Array<Label>;
    customFields?: JSONObject;
  }): void {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(buildAlert(input) as never);
  }

  beforeEach(() => {
    savedMetrics = [];

    mockAlert({});

    jest
      .spyOn(AlertStateTimelineService, "findBy")
      .mockResolvedValue(fullLifecycle() as never);
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

  function attributesOf(name: AlertMetricType): JSONObject {
    const metric: MutableMetric | undefined = savedMetrics.find(
      (candidate: MutableMetric) => {
        return candidate.name === name;
      },
    );

    return (metric?.attributes as JSONObject) || {};
  }

  test("records a bare label as present and a key:value label as its value", async () => {
    mockAlert({
      labels: [makeLabel("customer-facing"), makeLabel("product:X")],
    });

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    const attributes: JSONObject = attributesOf(AlertMetricType.AlertCount);

    expect(attributes["oneuptime.label.product"]).toBe("X");
    expect(attributes["oneuptime.label.customer_facing"]).toBe("true");
  });

  test("records custom fields", async () => {
    mockAlert({
      customFields: {
        "Owning Team": "Payments",
        Escalated: false as never,
        Squads: ["Payments", "Billing"] as never,
      },
    });

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    const attributes: JSONObject = attributesOf(AlertMetricType.AlertCount);

    expect(attributes["oneuptime.customField.owning_team"]).toBe("Payments");
    expect(attributes["oneuptime.customField.escalated"]).toBe("false");
    expect(attributes["oneuptime.customField.squads"]).toBe(
      "Payments, Billing",
    );
  });

  test("stamps EVERY emitted alert metric, not just the count", async () => {
    mockAlert({
      labels: [makeLabel("product:X")],
      customFields: { Team: "Payments" },
    });

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    const emittedNames: Array<string | undefined> = savedMetrics.map(
      (metric: MutableMetric) => {
        return metric.name;
      },
    );

    // The refresh really did emit the full family, so the loop below is meaningful.
    expect(emittedNames).toContain(AlertMetricType.AlertCount);
    expect(emittedNames).toContain(AlertMetricType.TimeToAcknowledge);
    expect(emittedNames).toContain(AlertMetricType.TimeToResolve);
    expect(emittedNames).toContain(AlertMetricType.AlertDuration);

    for (const metric of savedMetrics) {
      const attributes: JSONObject = metric.attributes as JSONObject;
      expect(attributes["oneuptime.label.product"]).toBe("X");
      expect(attributes["oneuptime.customField.team"]).toBe("Payments");
    }
  });

  test("keeps every pre-existing alert dimension on every metric", async () => {
    mockAlert({ labels: [makeLabel("product:X")] });

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    for (const metric of savedMetrics) {
      const attributes: JSONObject = metric.attributes as JSONObject;

      expect(attributes["alertId"]).toBe(ALERT_ID.toString());
      expect(attributes["projectId"]).toBe(PROJECT_ID.toString());
      expect(attributes["monitorId"]).toBe(MONITOR_ID.toString());
      expect(attributes["monitorName"]).toBe("Checkout API");
      expect(attributes["alertSeverityId"]).toBe(SEVERITY_ID.toString());
      expect(attributes["alertSeverityName"]).toBe("Critical");
    }
  });

  test("publishes the new dimensions in attributeKeys", async () => {
    mockAlert({
      labels: [makeLabel("product:X")],
      customFields: { Team: "Payments" },
    });

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    expect(savedMetrics.length).toBeGreaterThan(0);

    for (const metric of savedMetrics) {
      expect(metric.attributeKeys).toContain("oneuptime.label.product");
      expect(metric.attributeKeys).toContain("oneuptime.customField.team");
      expect(metric.attributeKeys).toEqual(
        Object.keys(metric.attributes as JSONObject).sort(),
      );
    }
  });

  test("adds no oneuptime.* attributes when the alert has neither", async () => {
    mockAlert({});

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    expect(savedMetrics.length).toBeGreaterThan(0);

    for (const metric of savedMetrics) {
      for (const key of Object.keys(metric.attributes as JSONObject)) {
        expect(key.startsWith("oneuptime.")).toBe(false);
      }
    }
  });

  test("every alert metric carries the identical attribute set", async () => {
    /*
     * A dashboard grouped by oneuptime.label.product must not find the
     * dimension on AlertCount but missing from TimeToResolve.
     */
    mockAlert({
      labels: [makeLabel("product:X"), makeLabel("urgent")],
      customFields: { Team: "Payments" },
    });

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    const first: JSONObject = savedMetrics[0]?.attributes as JSONObject;

    for (const metric of savedMetrics) {
      expect(metric.attributes).toEqual(first);
    }
  });

  test("produces the same attributes on a repeated refresh", async () => {
    /*
     * Alert metrics are mutable — a refresh replaces the previous point.
     * Attributes that varied between refreshes would churn the series.
     */
    mockAlert({
      labels: [
        makeLabel("product:web"),
        makeLabel("Product: api"),
        makeLabel("urgent"),
      ],
      customFields: { Team: "Payments", Tier: 2 as never },
    });

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });
    const first: JSONObject = savedMetrics[0]?.attributes as JSONObject;

    savedMetrics = [];

    // Same labels, different row order out of the database.
    mockAlert({
      labels: [
        makeLabel("urgent"),
        makeLabel("Product: api"),
        makeLabel("product:web"),
      ],
      customFields: { Tier: 2 as never, Team: "Payments" },
    });

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });
    const second: JSONObject = savedMetrics[0]?.attributes as JSONObject;

    expect(second).toEqual(first);
    expect(first["oneuptime.label.product"]).toBe("api, web");
  });

  test("selects labels and customFields, or the attributes could never be built", async () => {
    mockAlert({ labels: [makeLabel("product:X")] });

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

    const select: JSONObject = (
      jest.mocked(AlertService.findOneById).mock.calls[0]?.[0] as unknown as {
        select: JSONObject;
      }
    ).select;

    expect(select["customFields"]).toBe(true);
    expect(select["labels"]).toEqual({ _id: true, name: true });
  });
});
