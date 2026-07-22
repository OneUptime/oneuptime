import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepTraceMonitorUtil } from "../../../Types/Monitor/MonitorStepTraceMonitor";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import { MonitorStepExceptionMonitorUtil } from "../../../Types/Monitor/MonitorStepExceptionMonitor";

/*
 * Regression coverage for the "log monitors do not work" bug: a telemetry
 * monitor step created on defaults must persist its own type's sub-config
 * (logMonitor / traceMonitor / metricMonitor / exceptionMonitor) rather than
 * leaving it undefined. When it was left undefined, the worker's
 * monitorLogs()/monitorTrace()/... threw "<type> query/config is missing" on
 * every evaluation, so the monitor never ran and its criteria never applied.
 */
describe("MonitorStep.getDefaultMonitorStep telemetry sub-config seeding", () => {
  const buildArgs: (
    monitorType: MonitorType,
  ) => Parameters<typeof MonitorStep.getDefaultMonitorStep>[0] = (
    monitorType: MonitorType,
  ) => {
    const id: ObjectID = ObjectID.generate();
    return {
      monitorName: `${monitorType} monitor`,
      monitorType,
      onlineMonitorStatusId: id,
      offlineMonitorStatusId: id,
      defaultIncidentSeverityId: id,
      defaultAlertSeverityId: id,
    };
  };

  describe("seeds exactly the matching type's sub-config", () => {
    test("Logs monitor seeds logMonitor equal to its util default", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
        buildArgs(MonitorType.Logs),
      );

      expect(step.data?.logMonitor).toBeDefined();
      expect(step.data?.logMonitor).toEqual(
        MonitorStepLogMonitorUtil.getDefault(),
      );
      // The default query config must be usable (positive time window).
      expect(step.data?.logMonitor?.lastXSecondsOfLogs).toBeGreaterThan(0);
      expect(step.data?.traceMonitor).toBeUndefined();
      expect(step.data?.metricMonitor).toBeUndefined();
      expect(step.data?.exceptionMonitor).toBeUndefined();
    });

    test("Traces monitor seeds traceMonitor equal to its util default", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
        buildArgs(MonitorType.Traces),
      );

      expect(step.data?.traceMonitor).toBeDefined();
      expect(step.data?.traceMonitor).toEqual(
        MonitorStepTraceMonitorUtil.getDefault(),
      );
      expect(step.data?.traceMonitor?.lastXSecondsOfSpans).toBeGreaterThan(0);
      expect(step.data?.logMonitor).toBeUndefined();
      expect(step.data?.metricMonitor).toBeUndefined();
      expect(step.data?.exceptionMonitor).toBeUndefined();
    });

    test("Metrics monitor seeds metricMonitor equal to its util default", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
        buildArgs(MonitorType.Metrics),
      );

      expect(step.data?.metricMonitor).toBeDefined();
      expect(step.data?.metricMonitor).toEqual(
        MonitorStepMetricMonitorUtil.getDefault(),
      );
      expect(step.data?.metricMonitor?.metricViewConfig).toBeDefined();
      expect(step.data?.logMonitor).toBeUndefined();
      expect(step.data?.traceMonitor).toBeUndefined();
      expect(step.data?.exceptionMonitor).toBeUndefined();
    });

    test("Exceptions monitor seeds exceptionMonitor equal to its util default", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
        buildArgs(MonitorType.Exceptions),
      );

      expect(step.data?.exceptionMonitor).toBeDefined();
      expect(step.data?.exceptionMonitor).toEqual(
        MonitorStepExceptionMonitorUtil.getDefault(),
      );
      expect(step.data?.logMonitor).toBeUndefined();
      expect(step.data?.traceMonitor).toBeUndefined();
      expect(step.data?.metricMonitor).toBeUndefined();
    });
  });

  describe("does not seed a telemetry sub-config for other types", () => {
    /*
     * Only the four telemetry types offered by the Telemetry picker are
     * seeded here. Infra metric monitors (Kubernetes/Docker/Host/...) carry
     * their own sub-config from templates, and non-telemetry monitors have
     * no telemetry sub-config at all — none must get a logMonitor/traceMonitor
     * /metricMonitor/exceptionMonitor from the generic default step.
     */
    const nonSeededTypes: Array<MonitorType> = [
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Server,
      MonitorType.SSLCertificate,
      MonitorType.IncomingRequest,
      MonitorType.SyntheticMonitor,
      MonitorType.CustomJavaScriptCode,
      MonitorType.SQLQuery,
      MonitorType.Manual,
      MonitorType.Profiles,
      MonitorType.Kubernetes,
      MonitorType.Docker,
      MonitorType.Host,
      MonitorType.Podman,
      MonitorType.DockerSwarm,
      MonitorType.Proxmox,
      MonitorType.Ceph,
      MonitorType.IoTDevice,
    ];

    test.each(nonSeededTypes)(
      "%s seeds no telemetry sub-config",
      (monitorType: MonitorType) => {
        const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
          buildArgs(monitorType),
        );

        expect(step.data?.logMonitor).toBeUndefined();
        expect(step.data?.traceMonitor).toBeUndefined();
        expect(step.data?.metricMonitor).toBeUndefined();
        expect(step.data?.exceptionMonitor).toBeUndefined();
      },
    );
  });

  test("still seeds the default criteria and a step id", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Logs),
    );

    expect(step.data?.id).toBeDefined();
    expect(step.data?.monitorCriteria).toBeDefined();
    expect(
      step.data?.monitorCriteria.data?.monitorCriteriaInstanceArray.length,
    ).toBeGreaterThan(0);
  });

  test("seeds a fresh sub-config object per call (no shared mutable state)", () => {
    const a: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Logs),
    );
    const b: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Logs),
    );

    expect(a.data?.logMonitor).not.toBe(b.data?.logMonitor);

    // Mutating one must not bleed into the other.
    a.data!.logMonitor!.lastXSecondsOfLogs = 999;
    expect(b.data?.logMonitor?.lastXSecondsOfLogs).not.toBe(999);
  });
});
