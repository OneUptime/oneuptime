import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Contract under test: issue #3039 — the write paths that used to accept a
 * reference id matching no record at all.
 *
 * Two distinct halves are covered here.
 *
 * The four *StateTimeline services are the choke point every status/state
 * change funnels through. A bogus id used to travel all the way to Postgres and
 * come back as a raw 23503 ("violates foreign key constraint
 * FK_574feb4161c5216c2c7ee0faaf8" — the error in the issue), which is an opaque
 * 500 over the API and a job that retries forever in the probe worker. The
 * three sibling services DID look their state up, but only inside the ordering
 * branch, so the FIRST timeline row for a record always went through unchecked.
 *
 * MonitorService and MonitorTemplateService own the monitorSteps blob, which
 * has no foreign key behind it at all. They must pass what is currently stored
 * to the validator, so that an id the record ALREADY holds is exempt: a monitor
 * saved broken before this guard existed has to stay editable.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0b5fbbd0-8d1c-4a72-9a2b-4b8bd1cba0e9",
);
const MONITOR_STATUS_ID: ObjectID = new ObjectID(
  "8ff02a3f-3f18-4c1d-9db1-6cf27bb2a4a1",
);
const INCIDENT_STATE_ID: ObjectID = new ObjectID(
  "2b0a94a4-2f8c-49f0-8a2e-0f1ff5df41c9",
);
const ALERT_STATE_ID: ObjectID = new ObjectID(
  "6a56b0f9-6c8f-4f76-9b53-0a1a5b0ec1a2",
);
const SCHEDULED_MAINTENANCE_STATE_ID: ObjectID = new ObjectID(
  "7c2f6b40-6a1b-4f18-9d0e-2c5ba2d3f0a7",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "1b7c5d3e-9a4f-4c2b-8e61-3d5a7f9b1c22",
);

type ValidatorCall = {
  projectId: ObjectID | undefined;
  subject?: string | undefined;
  references: Array<{
    modelName: string;
    id: ObjectID | string | undefined | null;
    service: DatabaseService<DatabaseBaseModel>;
    mustExist?: boolean | undefined;
  }>;
};

// Identity -> readable name, so an assertion can name the service it expects.
const SERVICE_NAMES: Map<unknown, string> = new Map<unknown, string>([
  [MonitorStatusService, "MonitorStatusService"],
  [IncidentStateService, "IncidentStateService"],
  [AlertStateService, "AlertStateService"],
  [ScheduledMaintenanceStateService, "ScheduledMaintenanceStateService"],
]);

type StepsValidatorCall = {
  monitorSteps?: unknown;
  projectId: ObjectID | undefined;
  alreadyStoredMonitorSteps?: unknown;
};

let validatorCalls: Array<ValidatorCall> = [];

/*
 * Records what each service asks the validator about. `rejects` throws only
 * when the call carries at least one id, so a guard that has been emptied out
 * cannot masquerade as a working one by throwing anyway.
 */
function spyOnValidator(rejects?: boolean): void {
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockImplementation((async (data: ValidatorCall): Promise<void> => {
      validatorCalls.push(data);

      const hasId: boolean = data.references.some(
        (reference: { id: ObjectID | string | undefined | null }) => {
          return Boolean(reference.id);
        },
      );

      if (rejects && hasId) {
        throw new Error("references records that do not exist");
      }
    }) as never);
}

function callHook(
  service: unknown,
  hook: "onBeforeCreate" | "onBeforeUpdate",
  payload: unknown,
): Promise<unknown> {
  return (service as Record<string, (input: unknown) => Promise<unknown>>)[
    hook
  ]!(payload);
}

function serviceNameOf(service: unknown): string {
  return SERVICE_NAMES.get(service) || "unknown";
}

const stepsReferencing: (statusId: string) => JSONObject = (
  statusId: string,
): JSONObject => {
  return {
    _type: ObjectType.MonitorSteps,
    value: {
      defaultMonitorStatusId: statusId,
      monitorStepsInstanceArray: [],
    },
  };
};

describe("missing-reference guard on write", () => {
  beforeEach(() => {
    validatorCalls = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("MonitorStatusTimelineService", () => {
    /*
     * This is the exact insert the issue reports failing. It is checked before
     * the dedupe lookups so a bad id costs one query rather than three.
     */
    test("create checks the monitor status against MonitorStatusService", async () => {
      spyOnValidator();
      jest
        .spyOn(MonitorStatusTimelineService, "findOneBy")
        .mockResolvedValue(null as never);

      await callHook(MonitorStatusTimelineService, "onBeforeCreate", {
        data: {
          monitorId: MONITOR_ID,
          projectId: PROJECT_ID,
          monitorStatusId: MONITOR_STATUS_ID,
        },
        props: {},
      });

      expect(validatorCalls).toHaveLength(1);
      expect(validatorCalls[0]!.subject).toBe("monitor status timeline");
      expect(validatorCalls[0]!.references).toHaveLength(1);
      expect(validatorCalls[0]!.references[0]!.modelName).toBe(
        "Monitor Status",
      );
      expect(validatorCalls[0]!.references[0]!.id).toBe(MONITOR_STATUS_ID);
      expect(serviceNameOf(validatorCalls[0]!.references[0]!.service)).toBe(
        "MonitorStatusService",
      );
      expect(validatorCalls[0]!.projectId).toBe(PROJECT_ID);
      /*
       * The whole point is that the record must EXIST. Passing
       * `mustExist: false` here would opt this column out of issue #3039's fix
       * while every other assertion in this test still passed, so pin that the
       * service does not — the validator's default is strict.
       */
      expect(validatorCalls[0]!.references[0]!.mustExist).not.toBe(false);
    });

    test("create is rejected when the monitor status does not exist", async () => {
      spyOnValidator(true);
      jest
        .spyOn(MonitorStatusTimelineService, "findOneBy")
        .mockResolvedValue(null as never);

      await expect(
        callHook(MonitorStatusTimelineService, "onBeforeCreate", {
          data: {
            monitorId: MONITOR_ID,
            projectId: PROJECT_ID,
            monitorStatusId: MONITOR_STATUS_ID,
          },
          props: {},
        }),
      ).rejects.toThrow("do not exist");
    });

    test("create falls back to the write's tenant when the row carries no project", async () => {
      spyOnValidator();
      jest
        .spyOn(MonitorStatusTimelineService, "findOneBy")
        .mockResolvedValue(null as never);

      await callHook(MonitorStatusTimelineService, "onBeforeCreate", {
        data: {
          monitorId: MONITOR_ID,
          monitorStatusId: MONITOR_STATUS_ID,
        },
        props: { tenantId: PROJECT_ID },
      });

      expect(validatorCalls[0]!.projectId).toBe(PROJECT_ID);
    });
  });

  describe("IncidentStateTimelineService", () => {
    test("create checks the incident state against IncidentStateService", async () => {
      spyOnValidator();
      jest
        .spyOn(IncidentStateTimelineService, "findOneBy")
        .mockResolvedValue(null as never);

      await callHook(IncidentStateTimelineService, "onBeforeCreate", {
        data: {
          incidentId: MONITOR_ID,
          projectId: PROJECT_ID,
          incidentStateId: INCIDENT_STATE_ID,
        },
        props: {},
      });

      expect(validatorCalls).toHaveLength(1);
      expect(validatorCalls[0]!.subject).toBe("incident state timeline");
      expect(validatorCalls[0]!.references[0]!.modelName).toBe(
        "Incident State",
      );
      expect(validatorCalls[0]!.references[0]!.id).toBe(INCIDENT_STATE_ID);
      expect(serviceNameOf(validatorCalls[0]!.references[0]!.service)).toBe(
        "IncidentStateService",
      );
      expect(validatorCalls[0]!.references[0]!.mustExist).not.toBe(false);
    });

    test("create is rejected when the incident state does not exist", async () => {
      spyOnValidator(true);
      jest
        .spyOn(IncidentStateTimelineService, "findOneBy")
        .mockResolvedValue(null as never);

      await expect(
        callHook(IncidentStateTimelineService, "onBeforeCreate", {
          data: {
            incidentId: MONITOR_ID,
            projectId: PROJECT_ID,
            incidentStateId: INCIDENT_STATE_ID,
          },
          props: {},
        }),
      ).rejects.toThrow("do not exist");
    });
  });

  describe("AlertStateTimelineService", () => {
    test("create checks the alert state against AlertStateService", async () => {
      spyOnValidator();
      jest
        .spyOn(AlertStateTimelineService, "findOneBy")
        .mockResolvedValue(null as never);

      await callHook(AlertStateTimelineService, "onBeforeCreate", {
        data: {
          alertId: MONITOR_ID,
          projectId: PROJECT_ID,
          alertStateId: ALERT_STATE_ID,
        },
        props: {},
      });

      expect(validatorCalls).toHaveLength(1);
      expect(validatorCalls[0]!.subject).toBe("alert state timeline");
      expect(validatorCalls[0]!.references[0]!.modelName).toBe("Alert State");
      expect(validatorCalls[0]!.references[0]!.id).toBe(ALERT_STATE_ID);
      expect(serviceNameOf(validatorCalls[0]!.references[0]!.service)).toBe(
        "AlertStateService",
      );
      expect(validatorCalls[0]!.references[0]!.mustExist).not.toBe(false);
    });

    test("create is rejected when the alert state does not exist", async () => {
      spyOnValidator(true);
      jest
        .spyOn(AlertStateTimelineService, "findOneBy")
        .mockResolvedValue(null as never);

      await expect(
        callHook(AlertStateTimelineService, "onBeforeCreate", {
          data: {
            alertId: MONITOR_ID,
            projectId: PROJECT_ID,
            alertStateId: ALERT_STATE_ID,
          },
          props: {},
        }),
      ).rejects.toThrow("do not exist");
    });
  });

  describe("ScheduledMaintenanceStateTimelineService", () => {
    test("create checks the state against ScheduledMaintenanceStateService", async () => {
      spyOnValidator();
      jest
        .spyOn(ScheduledMaintenanceStateTimelineService, "findOneBy")
        .mockResolvedValue(null as never);

      await callHook(
        ScheduledMaintenanceStateTimelineService,
        "onBeforeCreate",
        {
          data: {
            scheduledMaintenanceId: MONITOR_ID,
            projectId: PROJECT_ID,
            scheduledMaintenanceStateId: SCHEDULED_MAINTENANCE_STATE_ID,
          },
          props: {},
        },
      );

      expect(validatorCalls).toHaveLength(1);
      expect(validatorCalls[0]!.subject).toBe(
        "scheduled maintenance state timeline",
      );
      expect(validatorCalls[0]!.references[0]!.modelName).toBe(
        "Scheduled Maintenance State",
      );
      expect(validatorCalls[0]!.references[0]!.id).toBe(
        SCHEDULED_MAINTENANCE_STATE_ID,
      );
      expect(serviceNameOf(validatorCalls[0]!.references[0]!.service)).toBe(
        "ScheduledMaintenanceStateService",
      );
      expect(validatorCalls[0]!.references[0]!.mustExist).not.toBe(false);
    });

    test("create is rejected when the state does not exist", async () => {
      spyOnValidator(true);
      jest
        .spyOn(ScheduledMaintenanceStateTimelineService, "findOneBy")
        .mockResolvedValue(null as never);

      await expect(
        callHook(ScheduledMaintenanceStateTimelineService, "onBeforeCreate", {
          data: {
            scheduledMaintenanceId: MONITOR_ID,
            projectId: PROJECT_ID,
            scheduledMaintenanceStateId: SCHEDULED_MAINTENANCE_STATE_ID,
          },
          props: {},
        }),
      ).rejects.toThrow("do not exist");
    });
  });

  describe("MonitorService passes the stored monitorSteps to the validator", () => {
    /*
     * Without this the guard would refuse every edit of a monitor that already
     * holds a dangling id — including renaming it — over a field the user never
     * touched and cannot see is wrong.
     */
    function spyOnStepsValidator(): Array<StepsValidatorCall> {
      const calls: Array<StepsValidatorCall> = [];

      jest
        .spyOn(
          MonitorStepsProjectValidator,
          "validateMonitorStepsBelongToProject",
        )
        .mockImplementation((async (
          data: StepsValidatorCall,
        ): Promise<void> => {
          calls.push({
            monitorSteps: data.monitorSteps,
            projectId: data.projectId,
            alreadyStoredMonitorSteps: data.alreadyStoredMonitorSteps,
          });
        }) as never);

      return calls;
    }

    test("update hands over what each matched monitor currently stores", async () => {
      spyOnValidator();
      const calls: Array<StepsValidatorCall> = spyOnStepsValidator();

      const stored: JSONObject = stepsReferencing(MONITOR_STATUS_ID.toString());
      const incoming: JSONObject = stepsReferencing(
        MONITOR_STATUS_ID.toString(),
      );

      const monitor: Monitor = new Monitor();
      monitor.projectId = PROJECT_ID;
      monitor.monitorSteps = stored as never;

      jest
        .spyOn(MonitorService, "findBy")
        .mockResolvedValue([monitor] as never);

      await callHook(MonitorService, "onBeforeUpdate", {
        data: { monitorSteps: incoming },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.projectId).toBe(PROJECT_ID);
      /*
       * Identity, not equality, on both blobs: `stored` and `incoming` are
       * structurally identical, so a swap of the two arguments — validating the
       * incoming payload as if it were what was already saved, which would
       * exempt every id from the check — passes a deep-equality assertion.
       */
      expect(calls[0]!.monitorSteps).toBe(incoming);
      expect(calls[0]!.alreadyStoredMonitorSteps).toBe(stored);
    });

    test("update validates each matched monitor against its own project", async () => {
      /*
       * A root/API update does not always carry a tenantId, so the project has
       * to come from the monitor the query actually matched.
       */
      spyOnValidator();
      const calls: Array<StepsValidatorCall> = spyOnStepsValidator();

      const first: Monitor = new Monitor();
      first.projectId = PROJECT_ID;
      const second: Monitor = new Monitor();
      second.projectId = MONITOR_ID;

      jest
        .spyOn(MonitorService, "findBy")
        .mockResolvedValue([first, second] as never);

      await callHook(MonitorService, "onBeforeUpdate", {
        data: { monitorSteps: stepsReferencing(MONITOR_STATUS_ID.toString()) },
        query: {},
        props: {},
      });

      expect(
        calls.map((call: { projectId: ObjectID | undefined }) => {
          return call.projectId;
        }),
      ).toEqual([PROJECT_ID, MONITOR_ID]);
    });

    test("create grandfathers nothing, because a create introduces every id it carries", async () => {
      spyOnValidator();
      const calls: Array<StepsValidatorCall> = spyOnStepsValidator();

      /*
       * onBeforeCreate resolves the project's operational status for the new
       * monitor after validating, and that lookup would otherwise hit the
       * database. The plan lookup runs before it and only when billing is
       * enabled, which depends on the environment this suite is run in.
       */
      jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
        plan: null,
        isSubscriptionUnpaid: false,
      } as never);
      jest
        .spyOn(MonitorStatusService, "findOneBy")
        .mockResolvedValue({ id: MONITOR_STATUS_ID } as never);
      jest
        .spyOn(MonitorService, "addDefaultProbesToMonitor")
        .mockResolvedValue(undefined as never);

      await callHook(MonitorService, "onBeforeCreate", {
        data: {
          monitorType: "Manual",
          monitorSteps: stepsReferencing(MONITOR_STATUS_ID.toString()),
        },
        props: { tenantId: PROJECT_ID },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.alreadyStoredMonitorSteps).toBeUndefined();
    });
  });

  describe("MonitorTemplateService", () => {
    /*
     * A template's monitorSteps reaches real monitors through "create monitor
     * from template" and through syncLinkedMonitors, which pushes the blob onto
     * every linked monitor. Validating it here is what makes the error land on
     * the template the bad id was typed into rather than on a monitor sync days
     * later.
     */
    test("create validates the template's monitorSteps", async () => {
      const calls: Array<{ projectId: ObjectID | undefined }> = [];

      jest
        .spyOn(
          MonitorStepsProjectValidator,
          "validateMonitorStepsBelongToProject",
        )
        .mockImplementation((async (data: {
          projectId: ObjectID | undefined;
        }): Promise<void> => {
          calls.push({ projectId: data.projectId });
        }) as never);

      await callHook(MonitorTemplateService, "onBeforeCreate", {
        data: { monitorSteps: stepsReferencing(MONITOR_STATUS_ID.toString()) },
        props: { tenantId: PROJECT_ID },
      });

      expect(calls).toEqual([{ projectId: PROJECT_ID }]);
    });

    test("create is rejected when the template names a status that does not exist", async () => {
      jest
        .spyOn(
          MonitorStepsProjectValidator,
          "validateMonitorStepsBelongToProject",
        )
        .mockImplementation((async (): Promise<void> => {
          throw new Error("references records that do not exist");
        }) as never);

      await expect(
        callHook(MonitorTemplateService, "onBeforeCreate", {
          data: {
            monitorSteps: stepsReferencing(MONITOR_STATUS_ID.toString()),
          },
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("do not exist");
    });

    test("update hands over what the template currently stores", async () => {
      const calls: Array<{ alreadyStoredMonitorSteps: unknown }> = [];

      jest
        .spyOn(
          MonitorStepsProjectValidator,
          "validateMonitorStepsBelongToProject",
        )
        .mockImplementation((async (data: {
          alreadyStoredMonitorSteps: unknown;
        }): Promise<void> => {
          calls.push({
            alreadyStoredMonitorSteps: data.alreadyStoredMonitorSteps,
          });
        }) as never);

      const stored: JSONObject = stepsReferencing(MONITOR_STATUS_ID.toString());

      const template: MonitorTemplate = new MonitorTemplate();
      template.projectId = PROJECT_ID;
      template.monitorSteps = stored as never;

      jest
        .spyOn(MonitorTemplateService, "findBy")
        .mockResolvedValue([template] as never);

      await callHook(MonitorTemplateService, "onBeforeUpdate", {
        data: { monitorSteps: stepsReferencing(MONITOR_STATUS_ID.toString()) },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.alreadyStoredMonitorSteps).toBe(stored);
    });

    test("update looks nothing up when monitorSteps is not being written", async () => {
      const calls: Array<unknown> = [];

      jest
        .spyOn(
          MonitorStepsProjectValidator,
          "validateMonitorStepsBelongToProject",
        )
        .mockImplementation((async (): Promise<void> => {
          calls.push(true);
        }) as never);

      const findBy: unknown = jest
        .spyOn(MonitorTemplateService, "findBy")
        .mockResolvedValue([] as never);

      await callHook(MonitorTemplateService, "onBeforeUpdate", {
        data: { description: "renamed" },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(calls).toHaveLength(0);
      expect(findBy).not.toHaveBeenCalled();
    });
  });
});
