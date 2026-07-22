import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

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

  test("Logs monitor seeds logMonitor and nothing else", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Logs),
    );

    expect(step.data?.logMonitor).toBeDefined();
    // The default query config must be usable (last-N-seconds window).
    expect(step.data?.logMonitor?.lastXSecondsOfLogs).toBeGreaterThan(0);
    expect(step.data?.traceMonitor).toBeUndefined();
    expect(step.data?.metricMonitor).toBeUndefined();
    expect(step.data?.exceptionMonitor).toBeUndefined();
  });

  test("Traces monitor seeds traceMonitor and nothing else", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Traces),
    );

    expect(step.data?.traceMonitor).toBeDefined();
    expect(step.data?.logMonitor).toBeUndefined();
    expect(step.data?.metricMonitor).toBeUndefined();
    expect(step.data?.exceptionMonitor).toBeUndefined();
  });

  test("Metrics monitor seeds metricMonitor and nothing else", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Metrics),
    );

    expect(step.data?.metricMonitor).toBeDefined();
    expect(step.data?.logMonitor).toBeUndefined();
    expect(step.data?.traceMonitor).toBeUndefined();
    expect(step.data?.exceptionMonitor).toBeUndefined();
  });

  test("Exceptions monitor seeds exceptionMonitor and nothing else", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Exceptions),
    );

    expect(step.data?.exceptionMonitor).toBeDefined();
    expect(step.data?.logMonitor).toBeUndefined();
    expect(step.data?.traceMonitor).toBeUndefined();
    expect(step.data?.metricMonitor).toBeUndefined();
  });

  test("A non-telemetry monitor seeds no telemetry sub-config", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep(
      buildArgs(MonitorType.Ping),
    );

    expect(step.data?.logMonitor).toBeUndefined();
    expect(step.data?.traceMonitor).toBeUndefined();
    expect(step.data?.metricMonitor).toBeUndefined();
    expect(step.data?.exceptionMonitor).toBeUndefined();
  });
});
