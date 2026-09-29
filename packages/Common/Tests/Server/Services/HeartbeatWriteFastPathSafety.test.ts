import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import ObjectID from "../../../Types/ObjectID";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Four hot bookkeeping writes were moved off the full updateOneById/
 * updateOneBy pipeline onto DatabaseService.updateColumnsByIdWithoutHooks
 * (one raw parameterized UPDATE; skips ALL on-update hooks — workflow HTTP
 * triggers, audit-log inserts, realtime events, service onUpdateSuccess):
 *
 *   - Common/Server/Utils/Monitor/MonitorResource.ts
 *       MonitorProbe.lastMonitoringLog, on every probe check result
 *   - App/FeatureSet/Workers/Jobs/IncomingRequestMonitor/CheckHeartbeat.ts
 *       Monitor.incomingRequestMonitorHeartbeatCheckedAt
 *   - App/FeatureSet/Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus.ts
 *       Monitor.incomingEmailMonitorHeartbeatCheckedAt
 *   - App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts
 *       Monitor.telemetryMonitorLastMonitorAt + telemetryMonitorNextMonitorAt
 *
 * Those conversions are behavior-preserving only under the model-decorator
 * preconditions pinned below. The fast path skips hooks UNCONDITIONALLY, so
 * if someone later adds a decorator (or a column rename breaks a fast-path
 * write), nothing at the call sites fails — the new hook is just silently
 * never fired for these writes. This suite turns that silent drift into a
 * loud test failure: when one of these assertions starts failing, revisit
 * the corresponding fast-path call site before changing the assertion.
 *
 * Pure model-metadata + mocked-service tests — no Postgres, no Redis.
 */

describe("heartbeat write fast-path safety preconditions", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("MonitorProbe (lastMonitoringLog write in MonitorResource.ts)", () => {
    /*
     * The MonitorProbe conversion dropped NOTHING: the model has no
     * @EnableWorkflow, no @EnableAuditLog and no realtime events, so the
     * old updateOneBy pipeline's hooks were inert for this row anyway.
     * If any assertion here starts failing, a decorator was added to
     * MonitorProbe and the fast-path write in MonitorResource.ts now
     * silently skips it — revisit that call site.
     */
    test("has no on-update workflow trigger", () => {
      const probe: MonitorProbe = new MonitorProbe();
      expect(probe.enableWorkflowOn?.update).toBeFalsy();
    });

    test("has no on-update audit log", () => {
      const probe: MonitorProbe = new MonitorProbe();
      expect(probe.enableAuditLogOn?.update).toBeFalsy();
    });

    test("has no realtime events", () => {
      const probe: MonitorProbe = new MonitorProbe();
      expect(probe.enableRealtimeEventsOn).toBeFalsy();
    });
  });

  describe("Monitor (heartbeat/scheduler timestamp writes in worker jobs)", () => {
    /*
     * Monitor DOES have @EnableWorkflow({ update: true }) and
     * @EnableAuditLog(). The heartbeat/scheduler conversions DELIBERATELY
     * skip both for these machine-stamped bookkeeping columns — firing a
     * workflow HTTP trigger plus an audit-log insert per monitor per 30s/60s
     * tick is exactly the load the fast path removes (documented precedent:
     * the lastMonitoringLog write in MonitorResource.ts). These assertions
     * pin that tradeoff so it stays a documented decision: if Monitor's
     * decorators change shape, re-evaluate the worker-job call sites rather
     * than assuming the skip is still the intended behavior.
     */
    test("still has on-update workflow enabled (the skip is deliberate)", () => {
      const monitor: Monitor = new Monitor();
      expect(monitor.enableWorkflowOn?.update).toBe(true);
    });

    test("still has on-update audit log enabled (the skip is deliberate)", () => {
      const monitor: Monitor = new Monitor();
      expect(monitor.enableAuditLogOn?.update).toBe(true);
    });

    /*
     * Nothing ELSE was dropped: Monitor has no realtime events, so
     * workflow + audit are the only hooks the fast path bypasses. If this
     * starts failing, realtime updates on Monitor rows would silently never
     * fire for the heartbeat writes — revisit the worker-job call sites.
     */
    test("has no realtime events (so only workflow+audit are skipped)", () => {
      const monitor: Monitor = new Monitor();
      expect(monitor.enableRealtimeEventsOn).toBeFalsy();
    });
  });

  describe("fast-path columns exist on their entities", () => {
    /*
     * updateColumnsByIdWithoutHooks validates column names against entity
     * metadata at runtime and throws BadDataException on an unknown column.
     * Pinning column existence here means a rename breaks this suite at CI
     * time instead of breaking every heartbeat write at runtime.
     */
    test("Monitor has every column the worker jobs stamp", () => {
      const monitor: Monitor = new Monitor();
      const fastPathColumns: Array<string> = [
        "incomingRequestMonitorHeartbeatCheckedAt",
        "incomingEmailMonitorHeartbeatCheckedAt",
        "telemetryMonitorLastMonitorAt",
        "telemetryMonitorNextMonitorAt",
      ];
      for (const column of fastPathColumns) {
        expect(monitor.isTableColumn(column)).toBe(true);
      }
      // Negative control: isTableColumn actually discriminates.
      expect(monitor.isTableColumn("notARealColumn")).toBe(false);
    });

    test("MonitorProbe has the lastMonitoringLog column", () => {
      const probe: MonitorProbe = new MonitorProbe();
      expect(probe.isTableColumn("lastMonitoringLog")).toBe(true);
      expect(probe.isTableColumn("notARealColumn")).toBe(false);
    });
  });

  describe("MonitorProbeService.onUpdateSuccess early-exit", () => {
    /*
     * The old updateOneBy path for lastMonitoringLog also ran
     * MonitorProbeService.onUpdateSuccess, but that hook early-exits unless
     * updateBy.data.isEnabled is set — so skipping it for a
     * lastMonitoringLog-only write changes nothing. If the early-exit
     * condition ever widens (e.g. the hook starts reacting to other
     * columns), the no-op test below fails and the MonitorResource.ts
     * fast-path write must be revisited.
     */
    test("is a no-op when data lacks isEnabled (the fast-path case)", async () => {
      const findBySpy: jest.SpyInstance = jest
        .spyOn(MonitorProbeService, "findBy")
        .mockResolvedValue([]);
      const refreshSpy: jest.SpyInstance = jest
        .spyOn(MonitorService, "refreshMonitorProbeStatus")
        .mockResolvedValue(undefined as never);

      const onUpdate: OnUpdate<MonitorProbe> = {
        updateBy: {
          query: {},
          // What the old pipeline would have passed for the converted write.
          data: { lastMonitoringLog: {} },
          props: { isRoot: true },
        } as UpdateBy<MonitorProbe>,
        carryForward: null,
      };

      const result: OnUpdate<MonitorProbe> = await (MonitorProbeService as any)[
        "onUpdateSuccess"
      ](onUpdate, [ObjectID.generate()]);

      expect(result).toBe(onUpdate);
      expect(findBySpy).not.toHaveBeenCalled();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    /*
     * Positive control: proves the spies above would have observed the hook
     * doing work, so the no-op test cannot pass vacuously.
     */
    test("does refresh monitor status when isEnabled IS in data", async () => {
      const monitorId: ObjectID = ObjectID.generate();
      const probeRow: MonitorProbe = new MonitorProbe();
      probeRow.monitorId = monitorId;

      const findBySpy: jest.SpyInstance = jest
        .spyOn(MonitorProbeService, "findBy")
        .mockResolvedValue([probeRow]);
      const refreshSpy: jest.SpyInstance = jest
        .spyOn(MonitorService, "refreshMonitorProbeStatus")
        .mockResolvedValue(undefined as never);

      const onUpdate: OnUpdate<MonitorProbe> = {
        updateBy: {
          query: {},
          data: { isEnabled: false },
          props: { isRoot: true },
        } as UpdateBy<MonitorProbe>,
        carryForward: null,
      };

      await (MonitorProbeService as any)["onUpdateSuccess"](onUpdate, [
        ObjectID.generate(),
      ]);

      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(refreshSpy).toHaveBeenCalledWith(monitorId);
    });
  });
});
