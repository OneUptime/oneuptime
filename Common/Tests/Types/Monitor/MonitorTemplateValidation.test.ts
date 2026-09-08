import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { MonitorStepDnssecMonitorUtil } from "../../../Types/Monitor/MonitorStepDnssecMonitor";
import MonitorStepSqlMonitor, {
  MonitorStepSqlMonitorUtil,
} from "../../../Types/Monitor/MonitorStepSqlMonitor";
import MonitorStepDatabaseMonitor, {
  MonitorStepDatabaseMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDatabaseMonitor";
import SqlDatabaseType from "../../../Types/Monitor/SqlDatabaseType";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import { describe, expect, it } from "@jest/globals";

const TEMPLATE_OPTIONS: { isMonitorTemplate: boolean } = {
  isMonitorTemplate: true,
};

function buildStep(monitorType: MonitorType): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "Shared checks",
    monitorType,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });

  if (monitorType === MonitorType.DNSSEC) {
    step.setDnssecMonitor(MonitorStepDnssecMonitorUtil.getDefault());
  }

  if (monitorType === MonitorType.SQLQuery) {
    step.setSqlMonitor({
      ...MonitorStepSqlMonitorUtil.getDefault(),
      query: "SELECT 1",
    });
  }

  return step;
}

function buildSteps(monitorType: MonitorType): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.setDefaultMonitorStatusId(ObjectID.generate());
  steps.setMonitorStepsInstanceArray([buildStep(monitorType)]);
  return steps;
}

const TARGET_MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Port,
  MonitorType.SSLCertificate,
  MonitorType.DNS,
  MonitorType.DNSSEC,
  MonitorType.Domain,
  MonitorType.SQLQuery,
  MonitorType.Database,
  MonitorType.ExternalStatusPage,
  MonitorType.NetworkDevice,
  MonitorType.Kubernetes,
  MonitorType.Docker,
  MonitorType.Host,
  MonitorType.Podman,
  MonitorType.Proxmox,
  MonitorType.DockerSwarm,
  MonitorType.Ceph,
  MonitorType.IoTDevice,
];

describe("monitor template target validation", () => {
  it.each(TARGET_MONITOR_TYPES)(
    "%s allows omitted template targets while keeping new monitors strict",
    (monitorType: MonitorType) => {
      const steps: MonitorSteps = buildSteps(monitorType);

      expect(
        MonitorSteps.getValidationError(steps, monitorType, TEMPLATE_OPTIONS),
      ).toBeNull();
      expect(
        MonitorSteps.getValidationError(steps, monitorType),
      ).not.toBeNull();
      expect(
        MonitorSteps.getValidationError(steps, monitorType, {
          isMonitorTemplate: false,
        }),
      ).toBe(MonitorSteps.getValidationError(steps, monitorType));
    },
  );

  it.each([MonitorType.API, MonitorType.Website, MonitorType.SSLCertificate])(
    "%s accepts a supplied destination in both contexts",
    (monitorType: MonitorType) => {
      const step: MonitorStep = buildStep(monitorType).setMonitorDestination(
        URL.fromString("https://example.com"),
      );

      expect(
        MonitorStep.getValidationError(step, monitorType, TEMPLATE_OPTIONS),
      ).toBeNull();
      expect(MonitorStep.getValidationError(step, monitorType)).toBeNull();
    },
  );

  it("allows a Port template to supply either its host or its port independently", () => {
    const step: MonitorStep = buildStep(MonitorType.Port);
    step.setMonitorDestination(new Hostname("example.com"));

    expect(
      MonitorStep.getValidationError(step, MonitorType.Port, TEMPLATE_OPTIONS),
    ).toBeNull();
    expect(MonitorStep.getValidationError(step, MonitorType.Port)).toBe(
      "Port is required",
    );

    step.setMonitorDestination(undefined).setPort(new Port(443));
    expect(
      MonitorStep.getValidationError(step, MonitorType.Port, TEMPLATE_OPTIONS),
    ).toBeNull();
    expect(MonitorStep.getValidationError(step, MonitorType.Port)).toBe(
      "Monitor Destination is required.",
    );
  });

  it("allows clearing previously provided destination and port values", () => {
    const step: MonitorStep = buildStep(MonitorType.Port)
      .setMonitorDestination(new Hostname("example.com"))
      .setPort(new Port(443));
    step.setMonitorDestination(undefined).setPort(undefined);

    const roundTrip: MonitorStep = MonitorStep.clone(step);
    expect(roundTrip.data!.monitorDestination).toBeUndefined();
    expect(roundTrip.data!.monitorDestinationPort).toBeUndefined();
    expect(
      MonitorStep.getValidationError(
        roundTrip,
        MonitorType.Port,
        TEMPLATE_OPTIONS,
      ),
    ).toBeNull();
  });

  it("still requires criteria, a default status and at least one step", () => {
    const steps: MonitorSteps = buildSteps(MonitorType.Website);
    steps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria =
      undefined as never;
    expect(
      MonitorSteps.getValidationError(
        steps,
        MonitorType.Website,
        TEMPLATE_OPTIONS,
      ),
    ).toBe("Monitor Criteria is required");

    steps.setDefaultMonitorStatusId(undefined);
    expect(
      MonitorSteps.getValidationError(
        steps,
        MonitorType.Website,
        TEMPLATE_OPTIONS,
      ),
    ).toBe("Default Monitor Status is required");

    steps.setMonitorStepsInstanceArray([]);
    expect(
      MonitorSteps.getValidationError(
        steps,
        MonitorType.Website,
        TEMPLATE_OPTIONS,
      ),
    ).toBe("Monitor Steps is required");
  });

  it("checks every step even when earlier steps omit their targets", () => {
    const steps: MonitorSteps = buildSteps(MonitorType.API);
    const invalid: MonitorStep = buildStep(MonitorType.API);
    invalid.data!.requestType = undefined as never;
    steps.data!.monitorStepsInstanceArray.push(invalid);

    expect(
      MonitorSteps.getValidationError(steps, MonitorType.API, TEMPLATE_OPTIONS),
    ).toBe("Request Type is required");
  });

  it.each<[MonitorType, string]>([
    [MonitorType.CustomJavaScriptCode, "Custom Code is required"],
    [MonitorType.SyntheticMonitor, "Playwright code is required."],
  ])(
    "%s keeps its check code required",
    (monitorType: MonitorType, error: string) => {
      expect(
        MonitorStep.getValidationError(
          buildStep(monitorType),
          monitorType,
          TEMPLATE_OPTIONS,
        ),
      ).toBe(error);
    },
  );

  it("keeps SQL query validation while allowing blank connection fields", () => {
    const step: MonitorStep = buildStep(MonitorType.SQLQuery);
    step.data!.sqlMonitor!.query = "   ";
    expect(
      MonitorStep.getValidationError(
        step,
        MonitorType.SQLQuery,
        TEMPLATE_OPTIONS,
      ),
    ).toBe("SQL query is required");

    step.data!.sqlMonitor = undefined;
    expect(
      MonitorStep.getValidationError(
        step,
        MonitorType.SQLQuery,
        TEMPLATE_OPTIONS,
      ),
    ).toBe("SQL monitor configuration is required");
  });

  it.each([MonitorType.SQLQuery, MonitorType.Database])(
    "%s rejects incompatible Windows authentication without a host",
    (monitorType: MonitorType) => {
      const step: MonitorStep = buildStep(monitorType);
      const config: MonitorStepSqlMonitor | MonitorStepDatabaseMonitor =
        monitorType === MonitorType.SQLQuery
          ? step.data!.sqlMonitor!
          : step.data!.databaseMonitor!;
      config.useWindowsIntegratedAuthentication = true;
      config.databaseType = SqlDatabaseType.PostgreSQL;
      expect(
        MonitorStep.getValidationError(step, monitorType, TEMPLATE_OPTIONS),
      ).toBe(
        "Windows Integrated Authentication is only supported for Microsoft SQL Server",
      );
    },
  );

  it("keeps DNSSEC resolvers required when its domain is omitted", () => {
    const step: MonitorStep = buildStep(MonitorType.DNSSEC);
    step.data!.dnssecMonitor!.resolvers = [];
    expect(
      MonitorStep.getValidationError(
        step,
        MonitorType.DNSSEC,
        TEMPLATE_OPTIONS,
      ),
    ).toBe("At least one resolver is required");
  });

  it.each([MonitorType.Website, MonitorType.API])(
    "%s still validates matching TLS credentials without a target",
    (monitorType: MonitorType) => {
      const step: MonitorStep = buildStep(monitorType);
      step.setTlsClientCertificate("certificate");
      expect(
        MonitorStep.getValidationError(step, monitorType, TEMPLATE_OPTIONS),
      ).toBe(
        "Client private key is required when a client certificate is provided",
      );

      step.setTlsClientCertificate(undefined).setTlsClientKey("key");
      expect(
        MonitorStep.getValidationError(step, monitorType, TEMPLATE_OPTIONS),
      ).toBe(
        "Client certificate is required when a client private key is provided",
      );
    },
  );

  it("preserves omitted database connection ports through persistence and cloning", () => {
    const step: MonitorStep = buildStep(MonitorType.Database);
    const serialized: JSONObject = step.toJSON();
    delete (
      (serialized["value"] as JSONObject)["databaseMonitor"] as JSONObject
    )["port"];

    const restored: MonitorStep = MonitorStep.fromJSON(serialized);
    const cloned: MonitorStep = MonitorStep.clone(restored);
    expect(restored.data!.databaseMonitor!.port).toBeUndefined();
    expect(cloned.data!.databaseMonitor!.port).toBeUndefined();
    expect(cloned.data!.databaseMonitor!.enabledMetricGroups).toEqual(
      MonitorStepDatabaseMonitorUtil.getDefault().enabledMetricGroups,
    );
  });

  it("keeps explicitly configured database ports through persistence", () => {
    const step: MonitorStep = buildStep(MonitorType.Database);
    step.data!.databaseMonitor!.port = 15432;
    expect(MonitorStep.clone(step).data!.databaseMonitor!.port).toBe(15432);
  });

  it.each([0, -1, 65536, 123.5])(
    "rejects invalid supplied template database port %s",
    (port: number) => {
      const step: MonitorStep = buildStep(MonitorType.Database);
      step.data!.databaseMonitor!.port = port;
      expect(
        MonitorStep.getValidationError(
          step,
          MonitorType.Database,
          TEMPLATE_OPTIONS,
        ),
      ).toBe("Database port must be a whole number between 1 and 65535");
    },
  );

  it.each([MonitorType.SQLQuery, MonitorType.Database])(
    "%s requires a connection port only when creating a real monitor",
    (monitorType: MonitorType) => {
      const step: MonitorStep = buildStep(monitorType);
      const config: MonitorStepSqlMonitor | MonitorStepDatabaseMonitor =
        monitorType === MonitorType.SQLQuery
          ? step.data!.sqlMonitor!
          : step.data!.databaseMonitor!;
      config.host = "database.example.com";
      config.databaseName = "application";
      config.username = "monitor-user";
      delete (config as Partial<MonitorStepSqlMonitor>).port;

      expect(
        MonitorStep.getValidationError(step, monitorType, TEMPLATE_OPTIONS),
      ).toBeNull();
      expect(MonitorStep.getValidationError(step, monitorType)).toBe(
        "Database port is required",
      );
    },
  );

  it("rejects an unrecognized supplied destination instead of treating it as omitted", () => {
    const serialized: JSONObject = buildStep(MonitorType.Website).toJSON();
    (serialized["value"] as JSONObject)["monitorDestination"] = {
      _type: "NotAValidDestination",
      value: "invalid target",
    };
    expect(() => {
      return MonitorStep.fromJSON(serialized);
    }).toThrow(BadDataException);
  });

  it("validates a request method independently of a supplied URL", () => {
    const step: MonitorStep = buildStep(MonitorType.API);
    step.setRequestType(HTTPMethod.POST);
    expect(
      MonitorStep.getValidationError(step, MonitorType.API, TEMPLATE_OPTIONS),
    ).toBeNull();
  });
});
