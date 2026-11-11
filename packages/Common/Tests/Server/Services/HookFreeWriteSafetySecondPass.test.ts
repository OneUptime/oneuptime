import SmsLogService, {
  Service as SmsLogServiceClass,
} from "../../../Server/Services/SmsLogService";
import WorkflowLogService, {
  Service as WorkflowLogServiceClass,
} from "../../../Server/Services/WorkflowLogService";
import WhatsAppLogService, {
  Service as WhatsAppLogServiceClass,
} from "../../../Server/Services/WhatsAppLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import SmsLog from "../../../Models/DatabaseModels/SmsLog";
import WorkflowLog from "../../../Models/DatabaseModels/WorkflowLog";
import WhatsAppLog from "../../../Models/DatabaseModels/WhatsAppLog";
import { describe, expect, test } from "@jest/globals";

/*
 * Second-pass hookless-write conversions: SmsLog and WorkflowLog status
 * stamps were moved off the full updateOneById pipeline onto
 * DatabaseService.updateColumnsByIdWithoutHooks (one raw parameterized
 * UPDATE; skips ALL on-update hooks — workflow HTTP triggers, audit-log
 * inserts, realtime events, service onBeforeUpdate/onUpdateSuccess):
 *
 *   - App/FeatureSet/Notification/Services/SmsService.ts
 *       SmsLog.status/statusMessage/smsCostInUSDCents/errorCode after send
 *   - App/FeatureSet/Notification/API/SMS.ts
 *       SmsLog.status/statusMessage/errorCode on delivery callbacks
 *   - App/FeatureSet/Workflow/Services/RunWorkflow.ts
 *       WorkflowLog.workflowStatus/logs/started-completed-resume stamps
 *   - App/FeatureSet/Workers/Jobs/Workflow/TimeoutJobs.ts
 *       WorkflowLog.workflowStatus/completedAt/logs on stalled runs
 *   - App/FeatureSet/Notification/Services/WhatsAppService.ts
 *       WhatsAppLog.status/statusMessage/whatsAppCostInUSDCents/
 *       whatsAppMessageId after send - the log is created (full pipeline)
 *       Queued just before the message is handed to Meta (issue #6684)
 *   - App/FeatureSet/Notification/API/WhatsApp.ts
 *       WhatsAppLog.status/statusMessage on Meta's status webhooks
 *
 * These conversions dropped NOTHING: none of these models has update
 * workflows, audit logging, or realtime events, and none of the services
 * overrides the update hooks — so the old pipeline's hook stages were inert for these
 * writes. But the fast path skips hooks UNCONDITIONALLY: if someone later
 * adds a decorator to SmsLog/WorkflowLog/WhatsAppLog or an onUpdateSuccess
 * override to their services, nothing at the call sites fails — the new hook is just
 * silently never fired for these status stamps. This suite turns that
 * silent drift into a loud test failure: when an assertion here starts
 * failing, revisit the fast-path call sites above before changing it.
 *
 * Pure model-metadata + class-shape tests — no Postgres, no Redis.
 */

describe("second-pass hookless write safety preconditions", () => {
  describe("SmsLog model (status stamps in SmsService.ts / SMS.ts)", () => {
    /*
     * SmsLog DOES declare @EnableWorkflow — but with update: false. The
     * distinguishing shape (metadata present, update explicitly off) is
     * pinned exactly so that flipping update to true is caught even though
     * `enableWorkflowOn?.update` would also be falsy on a model with no
     * decorator at all.
     */
    test("declares @EnableWorkflow with update explicitly disabled", () => {
      const smsLog: SmsLog = new SmsLog();
      expect(smsLog.enableWorkflowOn).toBeDefined();
      expect(smsLog.enableWorkflowOn?.create).toBe(true);
      expect(smsLog.enableWorkflowOn?.update).toBe(false);
    });

    test("has no on-update audit log", () => {
      const smsLog: SmsLog = new SmsLog();
      expect(smsLog.enableAuditLogOn?.update).toBeFalsy();
    });

    test("has no realtime events", () => {
      const smsLog: SmsLog = new SmsLog();
      expect(smsLog.enableRealtimeEventsOn).toBeFalsy();
    });
  });

  describe("WhatsAppLog model (send result in WhatsAppService.ts, status webhooks in WhatsApp.ts)", () => {
    /*
     * Like SmsLog: @EnableWorkflow on create only. A workflow triggered on
     * a WhatsApp Log's creation sees it Queued - the send's result is a
     * hookless write that triggers nothing - so update must stay off.
     */
    test("declares @EnableWorkflow with update explicitly disabled", () => {
      const whatsAppLog: WhatsAppLog = new WhatsAppLog();
      expect(whatsAppLog.enableWorkflowOn).toBeDefined();
      expect(whatsAppLog.enableWorkflowOn?.create).toBe(true);
      expect(whatsAppLog.enableWorkflowOn?.update).toBe(false);
    });

    test("has no on-update audit log", () => {
      const whatsAppLog: WhatsAppLog = new WhatsAppLog();
      expect(whatsAppLog.enableAuditLogOn?.update).toBeFalsy();
    });

    test("has no realtime events", () => {
      const whatsAppLog: WhatsAppLog = new WhatsAppLog();
      expect(whatsAppLog.enableRealtimeEventsOn).toBeFalsy();
    });
  });

  describe("WorkflowLog model (status stamps in RunWorkflow.ts / TimeoutJobs.ts)", () => {
    /*
     * WorkflowLog has no @EnableWorkflow decorator AT ALL — the accessor is
     * entirely unset, which is the other shape that resolves to "no update
     * workflow". If this becomes defined, someone added @EnableWorkflow to
     * WorkflowLog and must decide whether the fast-path stamps should keep
     * skipping it.
     */
    test("has no @EnableWorkflow metadata at all", () => {
      const workflowLog: WorkflowLog = new WorkflowLog();
      expect(workflowLog.enableWorkflowOn).toBeFalsy();
      expect(workflowLog.enableWorkflowOn?.update).toBeFalsy();
    });

    test("has no on-update audit log", () => {
      const workflowLog: WorkflowLog = new WorkflowLog();
      expect(workflowLog.enableAuditLogOn?.update).toBeFalsy();
    });

    test("has no realtime events", () => {
      const workflowLog: WorkflowLog = new WorkflowLog();
      expect(workflowLog.enableRealtimeEventsOn).toBeFalsy();
    });
  });

  describe("fast-path columns exist on their entities", () => {
    /*
     * updateColumnsByIdWithoutHooks validates column names against entity
     * metadata at runtime and throws BadDataException on an unknown column.
     * Pinning column existence here means a rename breaks this suite at CI
     * time instead of breaking every SMS/workflow status stamp at runtime.
     */
    test("SmsLog has every column the SMS status stamps write", () => {
      const smsLog: SmsLog = new SmsLog();
      const fastPathColumns: Array<string> = [
        "status",
        "statusMessage",
        "smsCostInUSDCents",
        "errorCode",
      ];
      for (const column of fastPathColumns) {
        expect(smsLog.isTableColumn(column)).toBe(true);
      }
      // Negative control: isTableColumn actually discriminates.
      expect(smsLog.isTableColumn("notARealColumn")).toBe(false);
    });

    test("WhatsAppLog has every column the send's result and the status webhooks write", () => {
      const whatsAppLog: WhatsAppLog = new WhatsAppLog();
      const fastPathColumns: Array<string> = [
        "status",
        "statusMessage",
        "whatsAppCostInUSDCents",
        "whatsAppMessageId",
      ];
      for (const column of fastPathColumns) {
        expect(whatsAppLog.isTableColumn(column)).toBe(true);
      }
      expect(whatsAppLog.isTableColumn("notARealColumn")).toBe(false);
    });

    test("WorkflowLog has every column the workflow status stamps write", () => {
      const workflowLog: WorkflowLog = new WorkflowLog();
      const fastPathColumns: Array<string> = [
        "workflowStatus",
        "logs",
        "startedAt",
        "completedAt",
        "resumeAt",
        "resumeData",
      ];
      for (const column of fastPathColumns) {
        expect(workflowLog.isTableColumn(column)).toBe(true);
      }
      expect(workflowLog.isTableColumn("notARealColumn")).toBe(false);
    });
  });

  describe("services define no update hooks of their own", () => {
    /*
     * DatabaseService's base onBeforeUpdate/onUpdateSuccess are no-op
     * pass-throughs; a service only gets update behavior by OVERRIDING them.
     * Own-property checks on the concrete service prototypes pin that
     * none of SmsLogService, WhatsAppLogService and WorkflowLogService does — so the fast path
     * skips nothing. If an override appears, these fail loudly and the
     * call sites above must be re-evaluated.
     */
    const updateHooks: Array<string> = ["onBeforeUpdate", "onUpdateSuccess"];

    test("SmsLogService does not override onBeforeUpdate/onUpdateSuccess", () => {
      for (const hook of updateHooks) {
        expect(
          Object.prototype.hasOwnProperty.call(
            SmsLogServiceClass.prototype,
            hook,
          ),
        ).toBe(false);
      }
      // The default export is an instance of the class checked above.
      expect(SmsLogService).toBeInstanceOf(SmsLogServiceClass);
    });

    test("WhatsAppLogService does not override onBeforeUpdate/onUpdateSuccess", () => {
      for (const hook of updateHooks) {
        expect(
          Object.prototype.hasOwnProperty.call(
            WhatsAppLogServiceClass.prototype,
            hook,
          ),
        ).toBe(false);
      }
      expect(WhatsAppLogService).toBeInstanceOf(WhatsAppLogServiceClass);
    });

    test("WorkflowLogService does not override onBeforeUpdate/onUpdateSuccess", () => {
      for (const hook of updateHooks) {
        expect(
          Object.prototype.hasOwnProperty.call(
            WorkflowLogServiceClass.prototype,
            hook,
          ),
        ).toBe(false);
      }
      expect(WorkflowLogService).toBeInstanceOf(WorkflowLogServiceClass);
    });

    /*
     * Positive control: the hooks DO exist on the DatabaseService base
     * prototype, so the own-property checks above cannot pass vacuously
     * (e.g. after a rename of the hook methods themselves).
     */
    test("the base DatabaseService prototype defines both hooks", () => {
      for (const hook of updateHooks) {
        expect(
          Object.prototype.hasOwnProperty.call(DatabaseService.prototype, hook),
        ).toBe(true);
      }
    });
  });
});
