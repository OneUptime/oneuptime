import MetricType from "../../../../Models/DatabaseModels/MetricType";
import MutableMetric from "../../../../Models/AnalyticsModels/MutableMetric";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import IncidentOwnerTeamService from "../../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../../Server/Services/IncidentService";
import MetricService from "../../../../Server/Services/MetricService";
import MutableMetricService from "../../../../Server/Services/MutableMetricService";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import NetworkDeviceMetricUtil from "../../../../Server/Utils/Monitor/NetworkDeviceMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import AlertMetricType from "../../../../Types/Alerts/AlertMetricType";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../../Types/Dashboard/DashboardTemplates";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../../Types/Dashboard/DashboardViewConfig";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import PingMonitorResponse from "../../../../Types/Monitor/PingMonitor/PingMonitorResponse";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The SLO dashboard template queries metric series by NAME and scopes them
 * with a variable bound to one attribute KEY. Neither the name nor the key
 * is declared anywhere shared: the template names them, and four unrelated
 * emitters decide what actually lands in the metric store. Rename either
 * side and nothing fails to compile — the dashboard just renders empty
 * widgets in every project.
 *
 * So this suite drives the template side from getTemplateConfig and the
 * emitter side from the real emitters (never from source text), and
 * asserts they still meet. Everything it pins is a claim the template's
 * own comments make about code in other files:
 *
 *   - MonitorMetricUtil stamps the BARE `monitorName` (no `resource.`
 *     prefix) on both series the template queries.
 *   - NetworkDeviceMetricUtil writes those SAME two names off a device
 *     poll with `deviceName` / `networkDeviceId` and NO `monitorName` —
 *     the contamination that makes the unscoped view "every monitor PLUS
 *     every network device".
 *   - IncidentService stamps `monitorNames` (plural, comma-joined), which
 *     the Monitor variable can never match — the reason incident METRICS
 *     are off this dashboard.
 *   - AlertService stamps the singular `monitorName`, which it can match —
 *     so alert metrics are off the dashboard for a different reason
 *     (a burn-rate alert carries no monitor at all), not this one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const ALERT_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const SEVERITY_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const MONITOR_NAME: string = "Checkout API";
const DEVICE_NAME: string = "core-sw-01";

/*
 * The singular key the template's Monitor variable binds to, and the
 * plural key IncidentService writes instead. Spelled out here because the
 * whole point is that the two are one character apart.
 */
const SINGULAR_MONITOR_KEY: string = "monitorName";
const PLURAL_MONITOR_KEY: string = "monitorNames";

// -- Template-side helpers (read from getTemplateConfig, never literals) ----

type WidgetArguments = Record<string, unknown>;

function sloTemplateConfig(): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Slo,
  );
  expect(config).not.toBeNull();
  return config as DashboardViewConfig;
}

function argumentsOf(component: DashboardBaseComponent): WidgetArguments {
  return (component.arguments as WidgetArguments | undefined) || {};
}

function metricQueryConfigOf(
  component: DashboardBaseComponent,
): WidgetArguments {
  return (
    (argumentsOf(component)["metricQueryConfig"] as
      | WidgetArguments
      | undefined) || {}
  );
}

function metricNameOf(component: DashboardBaseComponent): string | undefined {
  const queryData: WidgetArguments =
    (metricQueryConfigOf(component)["metricQueryData"] as
      | WidgetArguments
      | undefined) || {};
  const filterData: WidgetArguments =
    (queryData["filterData"] as WidgetArguments | undefined) || {};
  const value: unknown = filterData["metricName"];

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/*
 * Only Chart widgets keep metricAliasData — the Value factory routes
 * through buildMetricQueryData, which drops it — so this returns undefined
 * for tiles by construction, not by accident.
 */
function legendUnitOf(component: DashboardBaseComponent): string | undefined {
  const aliasData: WidgetArguments =
    (metricQueryConfigOf(component)["metricAliasData"] as
      | WidgetArguments
      | undefined) || {};
  const value: unknown = aliasData["legendUnit"];

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Every distinct metric series the shipped SLO template asks for. */
function metricNamesQueriedBySloTemplate(): Array<string> {
  const names: Set<string> = new Set<string>();

  for (const component of sloTemplateConfig().components) {
    const name: string | undefined = metricNameOf(component);

    if (name) {
      names.add(name);
    }
  }

  return Array.from(names).sort();
}

/** The attribute key the template's Monitor variable scopes those series by. */
function monitorVariableAttributeKey(): string {
  const telemetryVariables: Array<DashboardVariable> = (
    sloTemplateConfig().variables || []
  ).filter((variable: DashboardVariable): boolean => {
    return variable.type === DashboardVariableType.TelemetryAttribute;
  });

  expect(telemetryVariables).toHaveLength(1);

  const attributeKey: string | undefined = telemetryVariables[0]?.attributeKey;

  expect(typeof attributeKey).toBe("string");

  return attributeKey as string;
}

// -- Emitter-side helpers --------------------------------------------------

function attributesOfRow(row: JSONObject): JSONObject {
  return (row["attributes"] as JSONObject | undefined) || {};
}

function rowsNamed(
  rows: Array<JSONObject>,
  metricName: string,
): Array<JSONObject> {
  return rows.filter((row: JSONObject): boolean => {
    return row["name"] === metricName;
  });
}

describe("SLO template metric emitter contract", () => {
  let insertedRows: Array<JSONObject>;
  let indexedMetricTypes: Dictionary<MetricType>;
  let savedMutableMetrics: Array<MutableMetric>;

  beforeEach(() => {
    insertedRows = [];
    indexedMetricTypes = {};
    savedMutableMetrics = [];

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertedRows.push(...rows);
      });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          Object.assign(indexedMetricTypes, data.metricNameServiceNameMap);
        },
      );
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    jest
      .spyOn(MutableMetricService, "replaceEntityMetrics")
      .mockImplementation(
        async (data: { metrics: Array<MutableMetric> }): Promise<void> => {
          savedMutableMetrics.push(...data.metrics);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * One probe check, exactly as the probe pipeline hands it over. isOnline
   * and responseTimeInMs together produce the only two series this
   * dashboard charts.
   */
  async function saveProbeMetrics(input: { isOnline: boolean }): Promise<void> {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        monitorStepId: ObjectID.generate(),
        probeId: PROBE_ID,
        failureCause: "",
        isOnline: input.isOnline,
        responseTimeInMs: 250,
        responseCode: 200,
      } as ProbeMonitorResponse,
      monitorName: MONITOR_NAME,
      probeName: "London Probe",
    });
  }

  /** One network-device poll that both pinged and walked the device. */
  async function saveDeviceMetrics(): Promise<void> {
    const walk: SnmpMonitorResponse = {
      isOnline: true,
      responseTimeInMs: 42,
      failureCause: "",
      oidResponses: [],
    };

    const ping: PingMonitorResponse = {
      packetsSent: 2,
      packetsReceived: 2,
      packetLossPercent: 0,
      avgRoundTripTimeInMs: 1.5,
    };

    await NetworkDeviceMetricUtil.saveWalkMetrics({
      projectId: PROJECT_ID,
      networkDeviceId: DEVICE_ID,
      deviceName: DEVICE_NAME,
      probeId: PROBE_ID,
      snmpResponse: walk,
      responseTimeInMs: walk.responseTimeInMs,
      isOnline: true,
      pingResponse: ping,
    });
  }

  function mockIncident(): void {
    const incident: Incident = new Incident();

    incident._id = INCIDENT_ID.toString();
    incident.id = INCIDENT_ID;
    incident.projectId = PROJECT_ID;
    incident.createdAt = new Date("2026-08-10T10:00:00.000Z");
    incident.declaredAt = new Date("2026-08-10T10:00:00.000Z");

    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID.toString();
    monitor.id = MONITOR_ID;
    monitor.name = MONITOR_NAME;
    incident.monitors = [monitor];

    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = SEVERITY_ID.toString();
    severity.id = SEVERITY_ID;
    severity.name = "Critical";
    incident.incidentSeverity = severity;

    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);
    jest
      .spyOn(IncidentOwnerUserService, "findBy")
      .mockResolvedValue([] as Array<IncidentOwnerUser> as never);
    jest
      .spyOn(IncidentOwnerTeamService, "findBy")
      .mockResolvedValue([] as Array<IncidentOwnerTeam> as never);
  }

  function mockAlert(): void {
    const alert: Alert = new Alert();

    alert._id = ALERT_ID.toString();
    alert.id = ALERT_ID;
    alert.projectId = PROJECT_ID;
    alert.createdAt = new Date("2026-08-10T10:00:00.000Z");

    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID.toString();
    monitor.id = MONITOR_ID;
    monitor.name = MONITOR_NAME;
    alert.monitor = monitor;

    const severity: AlertSeverity = new AlertSeverity();
    severity._id = SEVERITY_ID.toString();
    severity.id = SEVERITY_ID;
    severity.name = "Critical";
    alert.alertSeverity = severity;

    const createdState: AlertStateTimeline = new AlertStateTimeline();
    createdState._id = ObjectID.generate().toString();
    createdState.projectId = PROJECT_ID;
    createdState.startsAt = new Date("2026-08-10T10:00:00.000Z");
    createdState.alertState = new AlertState();

    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert as never);
    jest
      .spyOn(AlertStateTimelineService, "findBy")
      .mockResolvedValue([createdState] as never);
  }

  describe("the series the template asks for", () => {
    test("queries exactly IsOnline and ResponseTime, and nothing else", () => {
      /*
       * A third series added to the template is a decision, not a typo:
       * whoever adds it has to come here and satisfy themselves that the
       * new emitter also stamps the bare monitorName, or the Monitor
       * variable will empty that widget alone.
       */
      const queried: Array<string> = metricNamesQueriedBySloTemplate();

      expect(queried).toEqual(
        [MonitorMetricType.IsOnline, MonitorMetricType.ResponseTime].sort(),
      );
    });

    test("names every series through MonitorMetricType, never as a loose string", () => {
      const known: Array<string> = Object.values(MonitorMetricType);
      const queried: Array<string> = metricNamesQueriedBySloTemplate();

      // The template really does query something, so the loop below bites.
      expect(queried.length).toBeGreaterThan(0);

      for (const metricName of queried) {
        expect(
          `${metricName}: is a MonitorMetricType=${known.includes(metricName)}`,
        ).toBe(`${metricName}: is a MonitorMetricType=true`);
      }
    });
  });

  describe("MonitorMetricUtil, the emitter the template queries", () => {
    test("stamps the BARE monitorName on every series the template queries", async () => {
      await saveProbeMetrics({ isOnline: true });

      const queried: Array<string> = metricNamesQueriedBySloTemplate();

      expect(queried.length).toBeGreaterThan(0);

      for (const metricName of queried) {
        const rows: Array<JSONObject> = rowsNamed(insertedRows, metricName);

        // An empty series here means the template charts a name nobody emits.
        expect(`${metricName}: rows emitted=${rows.length > 0}`).toBe(
          `${metricName}: rows emitted=true`,
        );

        for (const row of rows) {
          const attributes: JSONObject = attributesOfRow(row);

          expect(
            `${metricName}: ${SINGULAR_MONITOR_KEY}=${String(
              attributes[SINGULAR_MONITOR_KEY],
            )}`,
          ).toBe(`${metricName}: ${SINGULAR_MONITOR_KEY}=${MONITOR_NAME}`);

          /*
           * A `resource.`-prefixed key would compile on both sides and
           * hand the reader an empty variable picker, so pin its absence
           * rather than only the presence of the bare key.
           */
          const prefixedKeys: Array<string> = Object.keys(attributes).filter(
            (key: string): boolean => {
              return key.startsWith("resource.");
            },
          );

          expect(
            `${metricName}: resource-prefixed keys=${prefixedKeys.join(", ")}`,
          ).toBe(`${metricName}: resource-prefixed keys=`);
        }
      }
    });

    test("stamps the exact attribute key the template's Monitor variable binds to", async () => {
      /*
       * Both sides read from code: the key comes out of the template, the
       * attributes out of the emitter. A rename on either side lands here.
       */
      await saveProbeMetrics({ isOnline: true });

      const attributeKey: string = monitorVariableAttributeKey();
      const queried: Array<string> = metricNamesQueriedBySloTemplate();

      expect(queried.length).toBeGreaterThan(0);

      for (const metricName of queried) {
        const rows: Array<JSONObject> = rowsNamed(insertedRows, metricName);

        expect(`${metricName}: rows emitted=${rows.length > 0}`).toBe(
          `${metricName}: rows emitted=true`,
        );

        for (const row of rows) {
          const attributes: JSONObject = attributesOfRow(row);

          expect(
            `${metricName}: variable key ${attributeKey} stamped=${Object.prototype.hasOwnProperty.call(
              attributes,
              attributeKey,
            )}`,
          ).toBe(`${metricName}: variable key ${attributeKey} stamped=true`);
        }
      }
    });

    test("publishes the variable's key in attributeKeys, which the picker reads", async () => {
      await saveProbeMetrics({ isOnline: true });

      const attributeKey: string = monitorVariableAttributeKey();
      const rows: Array<JSONObject> = rowsNamed(
        insertedRows,
        MonitorMetricType.IsOnline,
      );

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        const attributeKeys: Array<string> =
          (row["attributeKeys"] as Array<string> | undefined) || [];

        /*
         * attributeKeys, not attributes, is what the variable's option
         * list is built from — a stamped-but-unpublished key offers an
         * empty dropdown.
         */
        expect(
          `IsOnline: ${attributeKey} in attributeKeys=${attributeKeys.includes(
            attributeKey,
          )}`,
        ).toBe(`IsOnline: ${attributeKey} in attributeKeys=true`);
      }
    });

    test('emits IsOnline as 1 when up, 0 when down, with unit ""', async () => {
      await saveProbeMetrics({ isOnline: true });

      const upValues: Array<unknown> = rowsNamed(
        insertedRows,
        MonitorMetricType.IsOnline,
      ).map((row: JSONObject): unknown => {
        return row["value"];
      });

      expect(upValues).toEqual([1]);

      insertedRows = [];
      await saveProbeMetrics({ isOnline: false });

      const downValues: Array<unknown> = rowsNamed(
        insertedRows,
        MonitorMetricType.IsOnline,
      ).map((row: JSONObject): unknown => {
        return row["value"];
      });

      expect(downValues).toEqual([0]);

      /*
       * Unit "" is why the template's tile is "Monitor Uptime (avg)": an
       * Avg over a 0/1 series is a ratio in [0, 1]. If this ever became
       * "%" the emitter would be writing 1 for 100% and every "%"-labelled
       * widget in the product would be off by two orders of magnitude.
       */
      expect(
        `IsOnline: unit=${String(
          indexedMetricTypes[MonitorMetricType.IsOnline]?.unit,
        )}`,
      ).toBe("IsOnline: unit=");
    });

    test("declares the same unit the template prints beside the series", async () => {
      await saveProbeMetrics({ isOnline: true });

      let compared: number = 0;

      for (const component of sloTemplateConfig().components) {
        const metricName: string | undefined = metricNameOf(component);
        const legendUnit: string | undefined = legendUnitOf(component);

        if (!metricName || !legendUnit) {
          continue;
        }

        compared++;

        /*
         * The chart prints this string under the values it plots. The
         * emitter decides what those values actually are, so a unit change
         * on one side without the other mislabels real numbers.
         */
        expect(
          `${metricName}: template legendUnit=${legendUnit}, emitted unit=${String(
            indexedMetricTypes[metricName]?.unit,
          )}`,
        ).toBe(
          `${metricName}: template legendUnit=${legendUnit}, emitted unit=${legendUnit}`,
        );
      }

      // Without this the loop would pass by never running.
      expect(compared).toBeGreaterThan(0);
    });
  });

  describe("NetworkDeviceMetricUtil, the other writer of the same names", () => {
    test("writes the very same metric names off a device poll", async () => {
      await saveDeviceMetrics();

      const queried: Array<string> = metricNamesQueriedBySloTemplate();

      expect(queried.length).toBeGreaterThan(0);

      for (const metricName of queried) {
        /*
         * This is the contamination the template's comment documents: an
         * unscoped uptime/response-time widget is "every probeable monitor
         * PLUS every network device". The day this stops being true the
         * comment is wrong and should be deleted, so fail here rather than
         * let it rot.
         */
        expect(
          `${metricName}: also written by device polls=${
            rowsNamed(insertedRows, metricName).length > 0
          }`,
        ).toBe(`${metricName}: also written by device polls=true`);
      }
    });

    test("stamps deviceName and networkDeviceId, never monitorName", async () => {
      await saveDeviceMetrics();

      const attributeKey: string = monitorVariableAttributeKey();
      const queried: Array<string> = metricNamesQueriedBySloTemplate();

      expect(queried.length).toBeGreaterThan(0);

      for (const metricName of queried) {
        const rows: Array<JSONObject> = rowsNamed(insertedRows, metricName);

        expect(`${metricName}: device rows=${rows.length > 0}`).toBe(
          `${metricName}: device rows=true`,
        );

        for (const row of rows) {
          const attributes: JSONObject = attributesOfRow(row);

          expect(
            `${metricName}: deviceName=${String(attributes["deviceName"])}`,
          ).toBe(`${metricName}: deviceName=${DEVICE_NAME}`);

          expect(
            `${metricName}: networkDeviceId=${String(
              attributes["networkDeviceId"],
            )}`,
          ).toBe(`${metricName}: networkDeviceId=${DEVICE_ID.toString()}`);

          /*
           * Because the device rows carry no monitorName, picking a
           * monitor in the toolbar DROPS them rather than making them
           * selectable — they are never an option in the picker either.
           * If a device row ever gained this key the template's Monitor
           * variable would start offering device names as "monitors".
           */
          expect(
            `${metricName}: ${attributeKey} stamped=${Object.prototype.hasOwnProperty.call(
              attributes,
              attributeKey,
            )}`,
          ).toBe(`${metricName}: ${attributeKey} stamped=false`);
        }
      }
    });
  });

  describe("IncidentService, which the template deliberately cannot scope", () => {
    test("stamps monitorNames (plural) and not the singular key", async () => {
      mockIncident();

      const { baseMetricAttributes }: { baseMetricAttributes: JSONObject } =
        await IncidentService.getIncidentMetricContext({
          incidentId: INCIDENT_ID,
        });

      expect(
        `incident: ${PLURAL_MONITOR_KEY}=${String(
          baseMetricAttributes[PLURAL_MONITOR_KEY],
        )}`,
      ).toBe(`incident: ${PLURAL_MONITOR_KEY}=${MONITOR_NAME}`);

      /*
       * The singular key is what the Monitor variable filters on. Its
       * absence is why no incident METRIC widget is on this dashboard:
       * one pick would empty it while the uptime tiles beside it stayed
       * populated. If IncidentService ever adds the singular key, incident
       * metrics become scopeable and that decision can be revisited.
       */
      expect(
        `incident: ${SINGULAR_MONITOR_KEY} stamped=${Object.prototype.hasOwnProperty.call(
          baseMetricAttributes,
          SINGULAR_MONITOR_KEY,
        )}`,
      ).toBe(`incident: ${SINGULAR_MONITOR_KEY} stamped=false`);
    });

    test("carries no key the template's Monitor variable could match", async () => {
      mockIncident();

      const attributeKey: string = monitorVariableAttributeKey();

      const { baseMetricAttributes }: { baseMetricAttributes: JSONObject } =
        await IncidentService.getIncidentMetricContext({
          incidentId: INCIDENT_ID,
        });

      // The context really was built, so the check below is about content.
      expect(Object.keys(baseMetricAttributes).length).toBeGreaterThan(0);

      expect(
        `incident: variable key ${attributeKey} present=${Object.prototype.hasOwnProperty.call(
          baseMetricAttributes,
          attributeKey,
        )}`,
      ).toBe(`incident: variable key ${attributeKey} present=false`);
    });
  });

  describe("AlertService, which the template could scope but does not", () => {
    test("stamps the singular monitorName on every alert metric", async () => {
      mockAlert();

      await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

      const alertCountMetrics: Array<MutableMetric> =
        savedMutableMetrics.filter((metric: MutableMetric): boolean => {
          return metric.name === AlertMetricType.AlertCount;
        });

      // A refresh that emitted nothing would make every assertion vacuous.
      expect(alertCountMetrics.length).toBeGreaterThan(0);

      for (const metric of alertCountMetrics) {
        const attributes: JSONObject = (metric.attributes || {}) as JSONObject;

        /*
         * Alert metrics ARE scopeable by the Monitor variable — which is
         * exactly why the template's reason for leaving them off is a
         * different one (a burn-rate alert is created with no monitor
         * attached, so it carries no value for this key at all). Pinning
         * the key here keeps that distinction checkable.
         */
        expect(
          `alert: ${SINGULAR_MONITOR_KEY}=${String(
            attributes[SINGULAR_MONITOR_KEY],
          )}`,
        ).toBe(`alert: ${SINGULAR_MONITOR_KEY}=${MONITOR_NAME}`);

        expect(
          `alert: ${PLURAL_MONITOR_KEY} stamped=${Object.prototype.hasOwnProperty.call(
            attributes,
            PLURAL_MONITOR_KEY,
          )}`,
        ).toBe(`alert: ${PLURAL_MONITOR_KEY} stamped=false`);
      }
    });

    test("uses the same key the template's Monitor variable binds to", async () => {
      mockAlert();

      const attributeKey: string = monitorVariableAttributeKey();

      await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });

      expect(savedMutableMetrics.length).toBeGreaterThan(0);

      for (const metric of savedMutableMetrics) {
        const attributes: JSONObject = (metric.attributes || {}) as JSONObject;

        expect(
          `${String(metric.name)}: ${attributeKey}=${String(
            attributes[attributeKey],
          )}`,
        ).toBe(`${String(metric.name)}: ${attributeKey}=${MONITOR_NAME}`);
      }
    });
  });
});
