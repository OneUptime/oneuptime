import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The undeletable project came from writes, not from deletes: an incident was
 * saved holding another project's severity / state / monitor status id, and
 * the ON DELETE NO ACTION foreign key then refused to let that other project
 * go. The repair migration cleans up the rows that already exist; these tests
 * cover the other half — the write paths that produced them must now refuse.
 *
 * Each service is checked twice: that it asks the validator about the columns
 * that can carry a foreign id, and that a rejection stops the write before any
 * side effect (notably before the project's incident/alert counter is burned).
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

type ValidatorCall = {
  projectId: ObjectID | undefined;
  references: Array<{ modelName: string; id: unknown }>;
};

function spyOnValidator(rejects?: boolean): jest.Mock {
  const spy: jest.Mock = jest.fn(async () => {
    if (rejects) {
      throw new BadDataException(
        "This incident references records that belong to a different project.",
      );
    }
    return undefined;
  }) as unknown as jest.Mock;

  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockImplementation(spy as never);

  return spy;
}

function referencedIds(spy: jest.Mock): Record<string, unknown> {
  const referenced: Record<string, unknown> = {};

  for (const call of spy.mock.calls as unknown as Array<[ValidatorCall]>) {
    for (const reference of call[0].references) {
      if (reference.id) {
        referenced[reference.modelName] = reference.id;
      }
    }
  }

  return referenced;
}

describe("cross-project reference guard on write", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("IncidentService.onBeforeCreate", () => {
    function mockCreateDeps(): jest.Mock {
      const createdState: IncidentState = new IncidentState();
      createdState._id = STATE_ID.toString();

      jest
        .spyOn(IncidentStateService, "findOneBy")
        .mockResolvedValue(createdState as never);

      return jest.fn() as unknown as jest.Mock;
    }

    async function createIncident(data: Partial<Incident>): Promise<void> {
      await (
        IncidentService as unknown as {
          onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        }
      ).onBeforeCreate({
        data: data as Incident,
        props: { tenantId: PROJECT_ID },
      });
    }

    test("checks the state, the severity and the monitor status against the project", async () => {
      mockCreateDeps();
      const validator: jest.Mock = spyOnValidator();
      jest
        .spyOn(ProjectService, "incrementAndGetIncidentCounter")
        .mockResolvedValue({ counter: 1, prefix: undefined } as never);

      await createIncident({
        title: "test",
        incidentSeverityId: SEVERITY_ID,
        changeMonitorStatusToId: MONITOR_STATUS_ID,
      });

      expect(validator).toHaveBeenCalled();
      expect(referencedIds(validator)).toEqual({
        "Incident State": STATE_ID,
        "Incident Severity": SEVERITY_ID,
        "Monitor Status": MONITOR_STATUS_ID,
      });
    });

    test("rejects the create, and burns no incident number, when a reference is foreign", async () => {
      mockCreateDeps();
      spyOnValidator(true);
      const counter: jest.Mock = jest.fn() as unknown as jest.Mock;
      jest
        .spyOn(ProjectService, "incrementAndGetIncidentCounter")
        .mockImplementation(counter as never);

      await expect(
        createIncident({ title: "test", incidentSeverityId: SEVERITY_ID }),
      ).rejects.toThrow("belong to a different project");

      expect(counter).not.toHaveBeenCalled();
    });
  });

  describe("IncidentService.onBeforeUpdate", () => {
    async function updateIncident(
      data: Partial<Incident>,
      tenantId?: ObjectID | undefined,
    ): Promise<void> {
      await (
        IncidentService as unknown as {
          onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
        }
      ).onBeforeUpdate({
        data: data,
        query: {},
        props: tenantId ? { tenantId: tenantId } : { isRoot: true },
      });
    }

    test("checks a severity change on update", async () => {
      const validator: jest.Mock = spyOnValidator();

      await updateIncident({ incidentSeverityId: SEVERITY_ID }, PROJECT_ID);

      expect(referencedIds(validator)).toEqual({
        "Incident Severity": SEVERITY_ID,
      });
    });

    test("does not look anything up when no reference column is being written", async () => {
      const validator: jest.Mock = spyOnValidator();

      await updateIncident({ title: "renamed" }, PROJECT_ID);

      expect(validator).not.toHaveBeenCalled();
    });

    test("falls back to the projects of the matched rows when the update has no tenant", async () => {
      /*
       * Root and API updates do not always carry a tenantId. Skipping the
       * check there would leave the exact hole this guard exists to close.
       */
      const incident: Incident = new Incident();
      incident.projectId = PROJECT_ID;

      jest
        .spyOn(IncidentService, "findBy")
        .mockResolvedValue([incident] as never);

      const validator: jest.Mock = spyOnValidator();

      await updateIncident({ incidentSeverityId: SEVERITY_ID });

      expect(validator).toHaveBeenCalledTimes(1);
      expect(
        (validator.mock.calls[0] as unknown as [ValidatorCall])[0].projectId,
      ).toBe(PROJECT_ID);
    });

    test("rejects the update when a reference is foreign", async () => {
      spyOnValidator(true);

      await expect(
        updateIncident({ incidentSeverityId: SEVERITY_ID }, PROJECT_ID),
      ).rejects.toThrow("belong to a different project");
    });
  });

  describe("AlertService.onBeforeCreate", () => {
    test("checks the severity and the monitor status, and burns no alert number when rejected", async () => {
      const createdState: AlertState = new AlertState();
      createdState._id = STATE_ID.toString();

      jest
        .spyOn(AlertStateService, "findOneBy")
        .mockResolvedValue(createdState as never);

      spyOnValidator(true);

      const counter: jest.Mock = jest.fn() as unknown as jest.Mock;
      jest
        .spyOn(ProjectService, "incrementAndGetAlertCounter")
        .mockImplementation(counter as never);

      await expect(
        (
          AlertService as unknown as {
            onBeforeCreate: (createBy: unknown) => Promise<unknown>;
          }
        ).onBeforeCreate({
          data: {
            title: "test",
            alertSeverityId: SEVERITY_ID,
            monitorStatusWhenThisAlertWasCreatedId: MONITOR_STATUS_ID,
          } as Alert,
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("belong to a different project");

      expect(counter).not.toHaveBeenCalled();
    });
  });

  describe("ScheduledMaintenanceService.onBeforeCreate", () => {
    test("checks the monitor status it switches monitors to", async () => {
      const scheduledState: ScheduledMaintenanceState =
        new ScheduledMaintenanceState();
      scheduledState._id = STATE_ID.toString();

      jest
        .spyOn(ScheduledMaintenanceStateService, "findOneBy")
        .mockResolvedValue(scheduledState as never);

      spyOnValidator(true);

      const counter: jest.Mock = jest.fn() as unknown as jest.Mock;
      jest
        .spyOn(ProjectService, "incrementAndGetScheduledMaintenanceCounter")
        .mockImplementation(counter as never);

      await expect(
        (
          ScheduledMaintenanceService as unknown as {
            onBeforeCreate: (createBy: unknown) => Promise<unknown>;
          }
        ).onBeforeCreate({
          data: {
            title: "test",
            changeMonitorStatusToId: MONITOR_STATUS_ID,
          } as ScheduledMaintenance,
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("belong to a different project");

      expect(counter).not.toHaveBeenCalled();
    });
  });

  describe("IncidentTemplateService.onBeforeCreate", () => {
    test("checks every reference a template copies onto the incidents it creates", async () => {
      const validator: jest.Mock = spyOnValidator();

      await (
        IncidentTemplateService as unknown as {
          onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        }
      ).onBeforeCreate({
        data: {
          templateName: "test",
          initialIncidentStateId: STATE_ID,
          incidentSeverityId: SEVERITY_ID,
          changeMonitorStatusToId: MONITOR_STATUS_ID,
        } as IncidentTemplate,
        props: { tenantId: PROJECT_ID },
      });

      expect(referencedIds(validator)).toEqual({
        "Incident State": STATE_ID,
        "Incident Severity": SEVERITY_ID,
        "Monitor Status": MONITOR_STATUS_ID,
      });
    });

    test("rejects a template that points at another project's records", async () => {
      spyOnValidator(true);

      await expect(
        (
          IncidentTemplateService as unknown as {
            onBeforeCreate: (createBy: unknown) => Promise<unknown>;
          }
        ).onBeforeCreate({
          data: {
            templateName: "test",
            incidentSeverityId: SEVERITY_ID,
          } as IncidentTemplate,
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("belong to a different project");
    });
  });
});
