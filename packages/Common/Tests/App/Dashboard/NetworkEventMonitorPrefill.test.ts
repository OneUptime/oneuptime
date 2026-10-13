import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  NETWORK_EVENT_ALERT_QUERY_PARAM,
  NETWORK_EVENT_DEVICE_QUERY_PARAM,
  NETWORK_EVENT_UNKNOWN_ALERT_ERROR,
  NetworkEventMonitorSeedIds,
  buildNetworkEventMonitorPrefill,
  getNetworkEventAlertRoute,
  getNetworkEventMonitorCreateRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NetworkEventMonitorPrefill";
import { NETWORK_EVENT_ALERT_TEMPLATE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventAlertTemplateCopy";
import { NETWORK_EVENT_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventCopy";
import NetworkEventAlertTemplates, {
  NetworkEventAlertTemplate,
  NetworkEventAlertTemplateId,
} from "../../../Types/NetworkEvent/NetworkEventAlertTemplates";
import NetworkEventType, {
  NETWORK_EVENT_DEFINITIONS,
  NetworkEventDefinition,
} from "../../../Types/NetworkEvent/NetworkEventType";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * "Create alert" on a network event opens Create Monitor filled in. The
 * monitor it fills in must be one the form accepts as it is - a Logs
 * monitor that counts the event, raises one alert per device and per
 * thing on it, and is resolved by the event that says it is over - so a
 * click and Save makes a working monitor. And it must degrade, not break,
 * for a project missing a status or a severity.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const DEVICE_ID: string = "84858d6c-0000-4000-8000-000000000001";

const OPERATIONAL: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEGRADED: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const INCIDENT_SEV1: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444441",
);
const INCIDENT_SEV2: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444442",
);
const ALERT_HIGH: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555551",
);
const ALERT_LOW: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555552",
);

const SEEDS: NetworkEventMonitorSeedIds = {
  operationalMonitorStatusId: OPERATIONAL,
  unhealthyMonitorStatusId: DEGRADED,
  rankedIncidentSeverityIds: [INCIDENT_SEV1, INCIDENT_SEV2],
  rankedAlertSeverityIds: [ALERT_HIGH, ALERT_LOW],
};

const NO_SEEDS: NetworkEventMonitorSeedIds = {
  operationalMonitorStatusId: null,
  unhealthyMonitorStatusId: null,
  rankedIncidentSeverityIds: [],
  rankedAlertSeverityIds: [],
};

const FEATURED_IDS: Array<NetworkEventAlertTemplateId> = Object.values(
  NetworkEventAlertTemplateId,
);

// The prefill as the create form reads it back: through the steps' JSON.
function stepsOf(prefill: JSONObject): MonitorSteps {
  return MonitorSteps.fromJSON(prefill["monitorSteps"] as JSONObject);
}

function stepOf(prefill: JSONObject): MonitorStep {
  return stepsOf(prefill).data!.monitorStepsInstanceArray[0]!;
}

function logMonitorOf(prefill: JSONObject): MonitorStepLogMonitor {
  return MonitorStepLogMonitorUtil.fromJSON(
    MonitorStepLogMonitorUtil.toJSON(stepOf(prefill).data!.logMonitor!),
  );
}

function criteriaOf(prefill: JSONObject): Array<MonitorCriteriaInstance> {
  return stepOf(prefill).data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray;
}

function prefillFor(
  alertId: string,
  options: {
    seeds?: NetworkEventMonitorSeedIds | undefined;
    device?: { id: string; name: string } | null | undefined;
  } = {},
): JSONObject {
  const prefill: JSONObject | null = buildNetworkEventMonitorPrefill({
    alertId: alertId,
    device: options.device,
    seeds: options.seeds || SEEDS,
  });

  expect(prefill).not.toBeNull();

  return prefill!;
}

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a featured alert", () => {
  test.each(FEATURED_IDS)(
    "%s opens a Logs monitor the create form accepts as it is",
    (id: NetworkEventAlertTemplateId) => {
      const prefill: JSONObject = prefillFor(id);

      expect(prefill["monitorType"]).toBe(MonitorType.Logs);
      expect(prefill["name"]).toBe(
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].monitorName,
      );
      expect(prefill["description"]).toBe(
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].monitorDescription,
      );
      expect(
        MonitorSteps.getValidationError(stepsOf(prefill), MonitorType.Logs),
      ).toBeNull();
    },
  );

  test.each(FEATURED_IDS)(
    "%s counts, groups and resolves what its template says",
    (id: NetworkEventAlertTemplateId) => {
      const template: NetworkEventAlertTemplate =
        NetworkEventAlertTemplates.get(id)!;
      const logMonitor: MonitorStepLogMonitor = logMonitorOf(prefillFor(id));

      expect(logMonitor.attributes).toEqual(template.attributes);
      expect(logMonitor.groupByAttributes).toEqual(template.groupByAttributes);
      expect(logMonitor.resolvedByAttributes).toEqual(
        template.resolvedByAttributes,
      );
      expect(logMonitor.lastXSecondsOfLogs).toBe(300);

      // Nothing else narrows it: every device, every severity, any text.
      expect(logMonitor.body).toBe("");
      expect(logMonitor.severityTexts).toEqual([]);
      expect(logMonitor.telemetryServiceIds).toEqual([]);
      expect(logMonitor.entityKeys).toEqual([]);

      // The worker reads it as a monitor resolved by a log, or not, as meant.
      expect(MonitorStepLogMonitorUtil.isResolvedByLog(logMonitor)).toBe(
        Object.keys(template.resolvedByAttributes).length > 0,
      );
    },
  );

  test.each(FEATURED_IDS)(
    "%s has one criteria: more logs than its threshold raises an alert that resolves itself",
    (id: NetworkEventAlertTemplateId) => {
      const template: NetworkEventAlertTemplate =
        NetworkEventAlertTemplates.get(id)!;
      const criteria: Array<MonitorCriteriaInstance> = criteriaOf(
        prefillFor(id),
      );

      /*
       * One, not a pair: a grouped monitor with nothing to alert on meets
       * no criteria and returns to its default status, so a "healthy"
       * criteria would never be met.
       */
      expect(criteria).toHaveLength(1);

      const [alerting] = criteria;

      expect(alerting?.data?.filterCondition).toBe(FilterCondition.All);
      expect(alerting?.data?.filters).toEqual([
        {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: template.moreThan,
        },
      ]);
      expect(alerting?.data?.monitorStatusId?.toString()).toBe(
        DEGRADED.toString(),
      );
      expect(alerting?.data?.changeMonitorStatus).toBe(true);
      expect(alerting?.data?.isEnabled).toBe(true);

      expect(alerting?.data?.createAlerts).toBe(true);
      expect(alerting?.data?.alerts).toHaveLength(1);
      expect(alerting?.data?.alerts?.[0]).toMatchObject({
        title: NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].monitorName,
        description: NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].alertDescription,
        autoResolveAlert: true,
        onCallPolicyIds: [],
      });
      expect(alerting?.data?.name).toBe(
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].monitorName,
      );
    },
  );

  test.each(FEATURED_IDS)(
    "%s comes with an incident filled in and switched off",
    (id: NetworkEventAlertTemplateId) => {
      const [alerting] = criteriaOf(prefillFor(id));

      // An alert, not an incident - until a team flips the switch.
      expect(alerting?.data?.createIncidents).toBe(false);
      expect(alerting?.data?.incidents).toHaveLength(1);
      expect(alerting?.data?.incidents?.[0]).toMatchObject({
        title: NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].monitorName,
        autoResolveIncident: true,
      });
    },
  );

  test("a critical alert takes the project's most severe severity, a warning its second", () => {
    const severityOf: (id: string) => string | undefined = (
      id: string,
    ): string | undefined => {
      return criteriaOf(
        prefillFor(id),
      )[0]?.data?.alerts?.[0]?.alertSeverityId?.toString();
    };
    const incidentSeverityOf: (id: string) => string | undefined = (
      id: string,
    ): string | undefined => {
      return criteriaOf(
        prefillFor(id),
      )[0]?.data?.incidents?.[0]?.incidentSeverityId?.toString();
    };

    for (const id of FEATURED_IDS) {
      const isCritical: boolean =
        NetworkEventAlertTemplates.get(id)!.severity === "Critical";

      expect({ id, alert: severityOf(id) }).toEqual({
        id,
        alert: (isCritical ? ALERT_HIGH : ALERT_LOW).toString(),
      });
      expect({ id, incident: incidentSeverityOf(id) }).toEqual({
        id,
        incident: (isCritical ? INCIDENT_SEV1 : INCIDENT_SEV2).toString(),
      });
    }
  });

  test("the monitor starts operational: a prefilled monitor carries its default status itself", () => {
    for (const id of FEATURED_IDS) {
      expect(
        stepsOf(prefillFor(id)).data?.defaultMonitorStatusId?.toString(),
      ).toBe(OPERATIONAL.toString());
    }
  });

  test("every featured template has its words", () => {
    expect(Object.keys(NETWORK_EVENT_ALERT_TEMPLATE_COPY).sort()).toEqual(
      NetworkEventAlertTemplates.getFeatured()
        .map((template: NetworkEventAlertTemplate): string => {
          return template.id;
        })
        .sort(),
    );

    for (const id of FEATURED_IDS) {
      for (const text of [
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].title,
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].description,
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].monitorName,
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].monitorDescription,
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].alertDescription,
      ]) {
        expect(text.trim().length).toBeGreaterThan(0);
        // The group is added to an alert's title when it is raised.
        expect(text).not.toContain("{{");
      }
    }
  });

  test("a card that says an alert is closed by a recovery is one whose monitor names the recovery", () => {
    for (const id of FEATURED_IDS) {
      const saysItCloses: boolean =
        NETWORK_EVENT_ALERT_TEMPLATE_COPY[id].description.includes(
          "closed when",
        );
      const isResolvedByLog: boolean =
        MonitorStepLogMonitorUtil.isResolvedByLog(logMonitorOf(prefillFor(id)));

      expect({ id, saysItCloses }).toEqual({
        id,
        saysItCloses: isResolvedByLog,
      });
    }
  });

  test("the failed sign-ins card states the threshold and window its monitor uses", () => {
    const template: NetworkEventAlertTemplate =
      NetworkEventAlertTemplates.get("failed-logins")!;
    const copy: (typeof NETWORK_EVENT_ALERT_TEMPLATE_COPY)[NetworkEventAlertTemplateId] =
      NETWORK_EVENT_ALERT_TEMPLATE_COPY[
        NetworkEventAlertTemplateId.FailedLogins
      ];
    const sentence: string = `more than ${template.moreThan} failed sign-ins in ${template.windowInSeconds / 60} minutes`;

    expect(copy.description).toContain(sentence);
    expect(copy.monitorDescription).toContain(sentence);
    expect(copy.alertDescription).toContain(
      `more than ${template.moreThan} failed sign-ins in the last ${template.windowInSeconds / 60} minutes`,
    );
  });
});

describe("an alert for any event", () => {
  test.each(
    NETWORK_EVENT_DEFINITIONS.map(
      (definition: NetworkEventDefinition): NetworkEventType => {
        return definition.type;
      },
    ),
  )("%s opens a monitor named after the event", (type: NetworkEventType) => {
    const prefill: JSONObject = prefillFor(type);
    const logMonitor: MonitorStepLogMonitor = logMonitorOf(prefill);

    expect(prefill["monitorType"]).toBe(MonitorType.Logs);
    expect(prefill["name"]).toBe(NETWORK_EVENT_COPY[type].title);
    expect(String(prefill["description"])).toContain(
      NETWORK_EVENT_COPY[type].title,
    );
    expect(logMonitor.attributes).toEqual({
      "event.domain": "network",
      "event.name": type,
    });
    expect(criteriaOf(prefill)[0]?.data?.alerts?.[0]).toMatchObject({
      title: NETWORK_EVENT_COPY[type].title,
      description: NETWORK_EVENT_COPY[type].description,
    });
    expect(
      MonitorSteps.getValidationError(stepsOf(prefill), MonitorType.Logs),
    ).toBeNull();
  });

  test("every event has a title and a sentence, and no two events share a title", () => {
    const titles: Array<string> = [];

    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      const copy: { title: string; description: string } =
        NETWORK_EVENT_COPY[definition.type];

      expect(copy.title.trim().length).toBeGreaterThan(0);
      expect(copy.description.trim().length).toBeGreaterThan(0);
      expect(copy.description.endsWith(".")).toBe(true);
      titles.push(copy.title);
    }

    expect(new Set(titles).size).toBe(titles.length);
    expect(Object.keys(NETWORK_EVENT_COPY).sort()).toEqual(
      NETWORK_EVENT_DEFINITIONS.map(
        (definition: NetworkEventDefinition): string => {
          return definition.type;
        },
      ).sort(),
    );
  });

  test("an event a project named itself opens a monitor called by its name", () => {
    const prefill: JSONObject = prefillFor("ups.on_battery");

    expect(prefill["name"]).toBe("ups.on_battery");
    expect(prefill["description"]).toBe(
      "Alerts you when a device reports the network event ups.on_battery, once per device.",
    );
    expect(logMonitorOf(prefill).attributes).toEqual({
      "event.domain": "network",
      "event.name": "ups.on_battery",
    });
    expect(logMonitorOf(prefill).groupByAttributes).toEqual(["event.device"]);
    expect(criteriaOf(prefill)[0]?.data?.alerts?.[0]?.description).toBe(
      "A device reported the network event ups.on_battery.",
    );
  });

  test("a link that names nothing an alert can be made of opens no form", () => {
    for (const alertId of [
      "",
      "Not An Event",
      "<script>",
      null,
      undefined,
      5,
    ]) {
      expect(
        buildNetworkEventMonitorPrefill({ alertId: alertId, seeds: SEEDS }),
      ).toBeNull();
    }

    expect(NETWORK_EVENT_UNKNOWN_ALERT_ERROR).toContain("Network > Events");
  });
});

describe("an alert for one device", () => {
  const DEVICE: { id: string; name: string } = {
    id: DEVICE_ID,
    name: "Core Switch",
  };

  test("counts and resolves that device's events only, and says so in its name", () => {
    const prefill: JSONObject = prefillFor("interface-down", {
      device: DEVICE,
    });
    const logMonitor: MonitorStepLogMonitor = logMonitorOf(prefill);

    expect(prefill["name"]).toBe("Interface down - Core Switch");
    expect(logMonitor.attributes).toEqual({
      "event.domain": "network",
      "event.name": "interface.down",
      "networkDevice.id": DEVICE_ID,
    });
    expect(logMonitor.resolvedByAttributes).toEqual({
      "event.domain": "network",
      "event.name": "interface.up",
      "networkDevice.id": DEVICE_ID,
    });
    // Still one alert per interface of it.
    expect(logMonitor.groupByAttributes).toEqual([
      "event.device",
      "network.interface.name",
    ]);
    expect(
      MonitorSteps.getValidationError(stepsOf(prefill), MonitorType.Logs),
    ).toBeNull();
  });

  test("a device whose name could not be read still scopes the monitor, by its id", () => {
    const prefill: JSONObject = prefillFor("device-reboot", {
      device: { id: DEVICE_ID, name: "" },
    });

    expect(prefill["name"]).toBe("Device restarted");
    expect(logMonitorOf(prefill).attributes["networkDevice.id"]).toBe(
      DEVICE_ID,
    );
  });

  test("no device given is every device", () => {
    for (const device of [null, undefined, { id: "", name: "Core Switch" }]) {
      const prefill: JSONObject = prefillFor("interface-down", { device });

      expect(Object.keys(logMonitorOf(prefill).attributes)).not.toContain(
        "networkDevice.id",
      );
      expect(prefill["name"]).toBe(
        device?.name ? "Interface down - Core Switch" : "Interface down",
      );
    }
  });

  test("building one alert never changes the next", () => {
    prefillFor("interface-down", { device: DEVICE });

    expect(
      Object.keys(logMonitorOf(prefillFor("interface-down")).attributes),
    ).not.toContain("networkDevice.id");
  });
});

describe("a project missing a status or a severity", () => {
  test("gets a monitor that asks for what is missing, never one that cannot be opened", () => {
    for (const id of FEATURED_IDS) {
      const prefill: JSONObject = prefillFor(id, { seeds: NO_SEEDS });
      const [alerting] = criteriaOf(prefill);

      expect(alerting?.data?.monitorStatusId).toBeUndefined();
      expect(alerting?.data?.changeMonitorStatus).toBe(false);
      expect(alerting?.data?.alerts).toEqual([]);
      expect(alerting?.data?.createAlerts).toBe(false);
      expect(alerting?.data?.incidents).toEqual([]);
      expect(alerting?.data?.createIncidents).toBe(false);

      // What it counts is all there.
      expect(logMonitorOf(prefill).attributes).toEqual(
        NetworkEventAlertTemplates.get(id)!.attributes,
      );
      expect(stepsOf(prefill).data?.defaultMonitorStatusId).toBeUndefined();
    }
  });

  test("a project with one severity uses it for both a critical and a warning", () => {
    const seeds: NetworkEventMonitorSeedIds = {
      ...SEEDS,
      rankedAlertSeverityIds: [ALERT_HIGH],
      rankedIncidentSeverityIds: [INCIDENT_SEV1],
    };

    for (const id of ["vpn-tunnel-down", "interface-down"]) {
      expect(
        criteriaOf(
          prefillFor(id, { seeds }),
        )[0]?.data?.alerts?.[0]?.alertSeverityId?.toString(),
      ).toBe(ALERT_HIGH.toString());
    }
  });
});

describe("two alerts made from the same template", () => {
  test("never share an id: the form tells criteria, alerts and incidents apart by theirs", () => {
    const first: MonitorCriteriaInstance = criteriaOf(
      prefillFor("interface-down"),
    )[0]!;
    const second: MonitorCriteriaInstance = criteriaOf(
      prefillFor("interface-down"),
    )[0]!;

    expect(first.data?.id).not.toBe(second.data?.id);
    expect(first.data?.alerts?.[0]?.id).not.toBe(second.data?.alerts?.[0]?.id);
    expect(first.data?.incidents?.[0]?.id).not.toBe(
      second.data?.incidents?.[0]?.id,
    );
  });
});

describe("the routes to Create Monitor", () => {
  test("a card opens Create Monitor on its alert", () => {
    const route: Route = getNetworkEventAlertRoute("vpn-tunnel-down");
    const [path, query] = route.toString().split("?");

    expect(path).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(
      new URLSearchParams(query).get(NETWORK_EVENT_ALERT_QUERY_PARAM),
    ).toBe("vpn-tunnel-down");
    expect(
      new URLSearchParams(query).get(NETWORK_EVENT_DEVICE_QUERY_PARAM),
    ).toBeNull();
  });

  test("from one device's page it names the device too", () => {
    const [, query] = getNetworkEventAlertRoute("interface.down", DEVICE_ID)
      .toString()
      .split("?");

    expect(
      new URLSearchParams(query).get(NETWORK_EVENT_ALERT_QUERY_PARAM),
    ).toBe("interface.down");
    expect(
      new URLSearchParams(query).get(NETWORK_EVENT_DEVICE_QUERY_PARAM),
    ).toBe(DEVICE_ID);
  });

  test("the parameters are not the ones another prefill of the page reads", () => {
    // Create Monitor already opens on ?networkDeviceId= for a device's own monitor.
    expect(NETWORK_EVENT_DEVICE_QUERY_PARAM).not.toBe("networkDeviceId");
    expect(NETWORK_EVENT_ALERT_QUERY_PARAM).toBe("networkEventAlert");
    expect(NETWORK_EVENT_DEVICE_QUERY_PARAM).toBe("networkEventDeviceId");
  });

  test("Create alert from scratch opens Create Monitor on the Logs type alone", () => {
    const [path, query] = getNetworkEventMonitorCreateRoute()
      .toString()
      .split("?");

    expect(path).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(new URLSearchParams(query).get("monitorType")).toBe(
      MonitorType.Logs,
    );
  });
});
