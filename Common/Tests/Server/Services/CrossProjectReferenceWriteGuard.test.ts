import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceTemplateService from "../../../Server/Services/ScheduledMaintenanceTemplateService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import BadDataException from "../../../Types/Exception/BadDataException";
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
 * The undeletable project came from writes, not from deletes: a record was
 * saved holding another project's state / severity / monitor status id, and
 * the ON DELETE NO ACTION foreign key then refused to let that other project
 * go. The repair migration cleans up the rows that already exist; these tests
 * cover the other half — the write paths that produced them must now refuse.
 *
 * Each captured reference is asserted as the full triple (model name, id,
 * lookup service). The service is the part that picks the table the id is
 * checked against, so a test that ignores it passes even when a column is
 * validated against the wrong model — which is exactly what a mutation run
 * showed the first version of this file doing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0b5fbbd0-8d1c-4a72-9a2b-4b8bd1cba0e9",
);
const STATE_ID: ObjectID = new ObjectID("2b0a94a4-2f8c-49f0-8a2e-0f1ff5df41c9");
const SEVERITY_ID: ObjectID = new ObjectID(
  "6a56b0f9-6c8f-4f76-9b53-0a1a5b0ec1a2",
);
const MONITOR_STATUS_ID: ObjectID = new ObjectID(
  "8ff02a3f-3f18-4c1d-9db1-6cf27bb2a4a1",
);

// Identity -> readable name, so an assertion can name the service it expects.
const SERVICE_NAMES: Map<unknown, string> = new Map<unknown, string>([
  [IncidentStateService, "IncidentStateService"],
  [IncidentSeverityService, "IncidentSeverityService"],
  [AlertStateService, "AlertStateService"],
  [AlertSeverityService, "AlertSeverityService"],
  [ScheduledMaintenanceStateService, "ScheduledMaintenanceStateService"],
  [MonitorStatusService, "MonitorStatusService"],
]);

type CapturedReference = {
  subject: string;
  modelName: string;
  id: string;
  service: string;
};

type ValidatorCall = {
  projectId: ObjectID | undefined;
  subject?: string | undefined;
  references: Array<{
    modelName: string;
    id: ObjectID | string | undefined | null;
    service: DatabaseService<DatabaseBaseModel>;
  }>;
};

let captured: Array<CapturedReference> = [];
let validatorCalls: Array<ValidatorCall> = [];

/*
 * Records every (subject, model, id, service) the production code asks about,
 * and optionally rejects. `rejects` throws only when the call carries at least
 * one id, so a guard that has been emptied out cannot masquerade as a working
 * one by throwing anyway.
 */
function spyOnValidator(rejects?: boolean): void {
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockImplementation((async (data: ValidatorCall): Promise<void> => {
      validatorCalls.push(data);

      let hasId: boolean = false;

      for (const reference of data.references) {
        if (!reference.id) {
          continue;
        }

        hasId = true;

        captured.push({
          subject: data.subject || "",
          modelName: reference.modelName,
          id: reference.id.toString(),
          service: SERVICE_NAMES.get(reference.service) || "UNKNOWN_SERVICE",
        });
      }

      if (rejects && hasId) {
        throw new BadDataException(
          "This record references records that belong to a different project.",
        );
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

describe("cross-project reference guard on write", () => {
  beforeEach(() => {
    captured = [];
    validatorCalls = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("IncidentService", () => {
    function mockCreatedState(): void {
      const createdState: IncidentState = new IncidentState();
      createdState._id = STATE_ID.toString();
      jest
        .spyOn(IncidentStateService, "findOneBy")
        .mockResolvedValue(createdState as never);
    }

    test("create checks state, severity and monitor status against the right models", async () => {
      mockCreatedState();
      spyOnValidator();
      jest
        .spyOn(ProjectService, "incrementAndGetIncidentCounter")
        .mockResolvedValue({ counter: 1, prefix: undefined } as never);

      await callHook(IncidentService, "onBeforeCreate", {
        data: {
          title: "test",
          incidentSeverityId: SEVERITY_ID,
          changeMonitorStatusToId: MONITOR_STATUS_ID,
        } as Incident,
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "incident",
          modelName: "Incident State",
          id: STATE_ID.toString(),
          service: "IncidentStateService",
        },
        {
          subject: "incident",
          modelName: "Incident Severity",
          id: SEVERITY_ID.toString(),
          service: "IncidentSeverityService",
        },
        {
          subject: "incident",
          modelName: "Monitor Status",
          id: MONITOR_STATUS_ID.toString(),
          service: "MonitorStatusService",
        },
      ]);
    });

    test("create is rejected, and burns no incident number, when a reference is foreign", async () => {
      mockCreatedState();
      spyOnValidator(true);
      const counter: jest.Mock = jest.fn() as unknown as jest.Mock;
      jest
        .spyOn(ProjectService, "incrementAndGetIncidentCounter")
        .mockImplementation(counter as never);

      await expect(
        callHook(IncidentService, "onBeforeCreate", {
          data: { title: "test", incidentSeverityId: SEVERITY_ID } as Incident,
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("belong to a different project");

      expect(counter).not.toHaveBeenCalled();
    });

    test("update checks every reference column it writes", async () => {
      spyOnValidator();

      /*
       * Writing changeMonitorStatusToId also sends onBeforeUpdate into its
       * monitor-status-propagation branch, which reads the matched incidents
       * with the caller's own props. Unrelated to the guard — stub it out.
       */
      jest.spyOn(IncidentService, "findBy").mockResolvedValue([] as never);

      await callHook(IncidentService, "onBeforeUpdate", {
        data: {
          currentIncidentStateId: STATE_ID,
          incidentSeverityId: SEVERITY_ID,
          changeMonitorStatusToId: MONITOR_STATUS_ID,
        },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "incident",
          modelName: "Incident State",
          id: STATE_ID.toString(),
          service: "IncidentStateService",
        },
        {
          subject: "incident",
          modelName: "Incident Severity",
          id: SEVERITY_ID.toString(),
          service: "IncidentSeverityService",
        },
        {
          subject: "incident",
          modelName: "Monitor Status",
          id: MONITOR_STATUS_ID.toString(),
          service: "MonitorStatusService",
        },
      ]);
    });

    test("update catches the bare-string relation shape the API accepts", async () => {
      /*
       * PUT /api/incident with {"incidentSeverity": "<uuid>"} leaves a plain
       * string in the relation slot until sanitizeCreateOrUpdate turns it into
       * an entity — which happens after this hook. Reading ?._id alone missed
       * it and the guard silently passed.
       */
      spyOnValidator();

      await callHook(IncidentService, "onBeforeUpdate", {
        data: { incidentSeverity: SEVERITY_ID.toString() },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "incident",
          modelName: "Incident Severity",
          id: SEVERITY_ID.toString(),
          service: "IncidentSeverityService",
        },
      ]);
    });

    test("update catches the relation-object shape", async () => {
      spyOnValidator();

      await callHook(IncidentService, "onBeforeUpdate", {
        data: { incidentSeverity: { _id: SEVERITY_ID.toString() } },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]?.id).toBe(SEVERITY_ID.toString());
    });

    test("update looks nothing up when no reference column is written", async () => {
      spyOnValidator();

      await callHook(IncidentService, "onBeforeUpdate", {
        data: { title: "renamed" },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(validatorCalls).toHaveLength(0);
    });

    test("update falls back to the projects of the matched rows when there is no tenant", async () => {
      /*
       * Root and API updates do not always carry a tenantId. Skipping the
       * check there would leave the exact hole this guard exists to close.
       */
      const incident: Incident = new Incident();
      incident.projectId = PROJECT_ID;

      jest
        .spyOn(IncidentService, "findBy")
        .mockResolvedValue([incident] as never);

      spyOnValidator();

      await callHook(IncidentService, "onBeforeUpdate", {
        data: { incidentSeverityId: SEVERITY_ID },
        query: {},
        props: { isRoot: true },
      });

      expect(validatorCalls).toHaveLength(1);
      expect(validatorCalls[0]?.projectId).toBe(PROJECT_ID);
    });

    test("update is rejected when a reference is foreign", async () => {
      spyOnValidator(true);

      await expect(
        callHook(IncidentService, "onBeforeUpdate", {
          data: { incidentSeverityId: SEVERITY_ID },
          query: {},
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("belong to a different project");
    });
  });

  describe("AlertService", () => {
    function mockCreatedState(): void {
      const createdState: AlertState = new AlertState();
      createdState._id = STATE_ID.toString();
      jest
        .spyOn(AlertStateService, "findOneBy")
        .mockResolvedValue(createdState as never);
    }

    test("create checks severity and monitor status against the right models", async () => {
      mockCreatedState();
      spyOnValidator();
      jest
        .spyOn(ProjectService, "incrementAndGetAlertCounter")
        .mockResolvedValue({ counter: 1, prefix: undefined } as never);

      await callHook(AlertService, "onBeforeCreate", {
        data: {
          title: "test",
          alertSeverityId: SEVERITY_ID,
          monitorStatusWhenThisAlertWasCreatedId: MONITOR_STATUS_ID,
        } as Alert,
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "alert",
          modelName: "Alert Severity",
          id: SEVERITY_ID.toString(),
          service: "AlertSeverityService",
        },
        {
          subject: "alert",
          modelName: "Monitor Status",
          id: MONITOR_STATUS_ID.toString(),
          service: "MonitorStatusService",
        },
      ]);
    });

    test("create is rejected, and burns no alert number, when a reference is foreign", async () => {
      mockCreatedState();
      spyOnValidator(true);
      const counter: jest.Mock = jest.fn() as unknown as jest.Mock;
      jest
        .spyOn(ProjectService, "incrementAndGetAlertCounter")
        .mockImplementation(counter as never);

      await expect(
        callHook(AlertService, "onBeforeCreate", {
          data: { title: "test", alertSeverityId: SEVERITY_ID } as Alert,
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("belong to a different project");

      expect(counter).not.toHaveBeenCalled();
    });

    test("update checks state, severity and monitor status", async () => {
      spyOnValidator();

      await callHook(AlertService, "onBeforeUpdate", {
        data: {
          currentAlertStateId: STATE_ID,
          alertSeverityId: SEVERITY_ID,
          monitorStatusWhenThisAlertWasCreatedId: MONITOR_STATUS_ID,
        },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "alert",
          modelName: "Alert State",
          id: STATE_ID.toString(),
          service: "AlertStateService",
        },
        {
          subject: "alert",
          modelName: "Alert Severity",
          id: SEVERITY_ID.toString(),
          service: "AlertSeverityService",
        },
        {
          subject: "alert",
          modelName: "Monitor Status",
          id: MONITOR_STATUS_ID.toString(),
          service: "MonitorStatusService",
        },
      ]);
    });
  });

  describe("ScheduledMaintenanceService", () => {
    function mockScheduledState(): void {
      const scheduledState: ScheduledMaintenanceState =
        new ScheduledMaintenanceState();
      scheduledState._id = STATE_ID.toString();
      jest
        .spyOn(ScheduledMaintenanceStateService, "findOneBy")
        .mockResolvedValue(scheduledState as never);
    }

    test("create checks the monitor status it switches monitors to", async () => {
      mockScheduledState();
      spyOnValidator();
      jest
        .spyOn(ProjectService, "incrementAndGetScheduledMaintenanceCounter")
        .mockResolvedValue({ counter: 1, prefix: undefined } as never);

      await callHook(ScheduledMaintenanceService, "onBeforeCreate", {
        data: {
          title: "test",
          changeMonitorStatusToId: MONITOR_STATUS_ID,
        } as ScheduledMaintenance,
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "scheduled maintenance event",
          modelName: "Monitor Status",
          id: MONITOR_STATUS_ID.toString(),
          service: "MonitorStatusService",
        },
      ]);
    });

    test("create is rejected, and burns no event number, when the status is foreign", async () => {
      mockScheduledState();
      spyOnValidator(true);
      const counter: jest.Mock = jest.fn() as unknown as jest.Mock;
      jest
        .spyOn(ProjectService, "incrementAndGetScheduledMaintenanceCounter")
        .mockImplementation(counter as never);

      await expect(
        callHook(ScheduledMaintenanceService, "onBeforeCreate", {
          data: {
            title: "test",
            changeMonitorStatusToId: MONITOR_STATUS_ID,
          } as ScheduledMaintenance,
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("belong to a different project");

      expect(counter).not.toHaveBeenCalled();
    });

    test("update checks the state and the monitor status", async () => {
      spyOnValidator();

      await callHook(ScheduledMaintenanceService, "onBeforeUpdate", {
        data: {
          currentScheduledMaintenanceStateId: STATE_ID,
          changeMonitorStatusToId: MONITOR_STATUS_ID,
        },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "scheduled maintenance event",
          modelName: "Scheduled Maintenance State",
          id: STATE_ID.toString(),
          service: "ScheduledMaintenanceStateService",
        },
        {
          subject: "scheduled maintenance event",
          modelName: "Monitor Status",
          id: MONITOR_STATUS_ID.toString(),
          service: "MonitorStatusService",
        },
      ]);
    });
  });

  describe("IncidentTemplateService", () => {
    test("create checks every reference the template copies onto its incidents", async () => {
      spyOnValidator();

      await callHook(IncidentTemplateService, "onBeforeCreate", {
        data: {
          templateName: "test",
          initialIncidentStateId: STATE_ID,
          incidentSeverityId: SEVERITY_ID,
          changeMonitorStatusToId: MONITOR_STATUS_ID,
        } as IncidentTemplate,
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "incident template",
          modelName: "Incident State",
          id: STATE_ID.toString(),
          service: "IncidentStateService",
        },
        {
          subject: "incident template",
          modelName: "Incident Severity",
          id: SEVERITY_ID.toString(),
          service: "IncidentSeverityService",
        },
        {
          subject: "incident template",
          modelName: "Monitor Status",
          id: MONITOR_STATUS_ID.toString(),
          service: "MonitorStatusService",
        },
      ]);
    });

    test("update checks the same references", async () => {
      spyOnValidator();

      await callHook(IncidentTemplateService, "onBeforeUpdate", {
        data: { incidentSeverityId: SEVERITY_ID },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "incident template",
          modelName: "Incident Severity",
          id: SEVERITY_ID.toString(),
          service: "IncidentSeverityService",
        },
      ]);
    });

    test("create is rejected when a reference is foreign", async () => {
      spyOnValidator(true);

      await expect(
        callHook(IncidentTemplateService, "onBeforeCreate", {
          data: {
            templateName: "test",
            incidentSeverityId: SEVERITY_ID,
          } as IncidentTemplate,
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("belong to a different project");
    });
  });

  describe("ScheduledMaintenanceTemplateService", () => {
    test("create checks the monitor status the template carries", async () => {
      spyOnValidator();

      await callHook(ScheduledMaintenanceTemplateService, "onBeforeCreate", {
        data: {
          templateName: "test",
          title: "test",
          description: "test",
          changeMonitorStatusToId: MONITOR_STATUS_ID,
        } as ScheduledMaintenanceTemplate,
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "scheduled maintenance template",
          modelName: "Monitor Status",
          id: MONITOR_STATUS_ID.toString(),
          service: "MonitorStatusService",
        },
      ]);
    });

    test("create is rejected when the status is foreign", async () => {
      spyOnValidator(true);

      await expect(
        callHook(ScheduledMaintenanceTemplateService, "onBeforeCreate", {
          data: {
            templateName: "test",
            title: "test",
            description: "test",
            changeMonitorStatusToId: MONITOR_STATUS_ID,
          } as ScheduledMaintenanceTemplate,
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("belong to a different project");
    });
  });

  describe("episodes", () => {
    /*
     * IncidentEpisode and AlertEpisode hold the same state and severity
     * columns on equally NO ACTION foreign keys. Leaving them unguarded means
     * a single API call re-creates the undeletable project the migration just
     * repaired, and there is no second repair scheduled.
     */
    test("incident episode create checks the severity", async () => {
      const createdState: IncidentState = new IncidentState();
      createdState._id = STATE_ID.toString();
      jest
        .spyOn(IncidentStateService, "findOneBy")
        .mockResolvedValue(createdState as never);
      jest
        .spyOn(ProjectService, "incrementAndGetIncidentEpisodeCounter")
        .mockResolvedValue({ counter: 1, prefix: undefined } as never);
      spyOnValidator();

      await callHook(IncidentEpisodeService, "onBeforeCreate", {
        data: {
          title: "test",
          incidentSeverityId: SEVERITY_ID,
        } as IncidentEpisode,
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "incident episode",
          modelName: "Incident Severity",
          id: SEVERITY_ID.toString(),
          service: "IncidentSeverityService",
        },
      ]);
    });

    test("incident episode update checks state and severity", async () => {
      spyOnValidator();

      await callHook(IncidentEpisodeService, "onBeforeUpdate", {
        data: {
          currentIncidentStateId: STATE_ID,
          incidentSeverityId: SEVERITY_ID,
        },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "incident episode",
          modelName: "Incident State",
          id: STATE_ID.toString(),
          service: "IncidentStateService",
        },
        {
          subject: "incident episode",
          modelName: "Incident Severity",
          id: SEVERITY_ID.toString(),
          service: "IncidentSeverityService",
        },
      ]);
    });

    test("alert episode update checks state and severity", async () => {
      spyOnValidator();

      await callHook(AlertEpisodeService, "onBeforeUpdate", {
        data: {
          currentAlertStateId: STATE_ID,
          alertSeverityId: SEVERITY_ID,
        },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "alert episode",
          modelName: "Alert State",
          id: STATE_ID.toString(),
          service: "AlertStateService",
        },
        {
          subject: "alert episode",
          modelName: "Alert Severity",
          id: SEVERITY_ID.toString(),
          service: "AlertSeverityService",
        },
      ]);
    });

    test("alert episode create checks the severity", async () => {
      const createdState: AlertState = new AlertState();
      createdState._id = STATE_ID.toString();
      jest
        .spyOn(AlertStateService, "findOneBy")
        .mockResolvedValue(createdState as never);
      jest
        .spyOn(ProjectService, "incrementAndGetAlertEpisodeCounter")
        .mockResolvedValue({ counter: 1, prefix: undefined } as never);
      spyOnValidator();

      await callHook(AlertEpisodeService, "onBeforeCreate", {
        data: {
          title: "test",
          alertSeverityId: SEVERITY_ID,
        } as AlertEpisode,
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "alert episode",
          modelName: "Alert Severity",
          id: SEVERITY_ID.toString(),
          service: "AlertSeverityService",
        },
      ]);
    });
  });

  describe("MonitorService", () => {
    /*
     * Monitor.currentMonitorStatusId is the one project-scoped reference that
     * intentionally keeps ON DELETE NO ACTION, and it is writable by any
     * project member — so it can block a project delete on its own. The
     * 1785240000000 migration repaired the rows that existed then; this is
     * what stops new ones.
     */
    test("update checks currentMonitorStatusId", async () => {
      spyOnValidator();

      await callHook(MonitorService, "onBeforeUpdate", {
        data: { currentMonitorStatusId: MONITOR_STATUS_ID },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(captured).toEqual([
        {
          subject: "monitor",
          modelName: "Monitor Status",
          id: MONITOR_STATUS_ID.toString(),
          service: "MonitorStatusService",
        },
      ]);
    });

    test("update is rejected when the status belongs to another project", async () => {
      spyOnValidator(true);

      await expect(
        callHook(MonitorService, "onBeforeUpdate", {
          data: { currentMonitorStatusId: MONITOR_STATUS_ID },
          query: {},
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("belong to a different project");
    });

    test("update looks nothing up when neither monitorSteps nor the status is written", async () => {
      spyOnValidator();

      await callHook(MonitorService, "onBeforeUpdate", {
        data: { description: "renamed" },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(validatorCalls).toHaveLength(0);
    });
  });
});
