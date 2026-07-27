import MonitorStepsProjectValidator from "../../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test: monitorSteps embeds ids of project-scoped records (the
 * default monitor status, the status each criteria switches to, and the
 * severities used to open incidents and alerts). Saving one that belongs to a
 * *different* project is what tied two projects together in production and
 * left the referenced project undeletable, so it must be rejected on write.
 *
 * The check has to stay narrow: monitorSteps is full of unrelated uuids (step
 * ids, criteria ids, incident/alert template ids) that match no record at all,
 * and those must keep saving fine.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "3376855b-361c-427c-8982-bad7ada30414",
);

const OWN_STATUS_ID: string = "59b5ab80-63f6-4ffd-b3df-31c6ad127695";
const FOREIGN_STATUS_ID: string = "cfc2f04f-79cb-4344-8c54-dafe5e3a290c";
const FOREIGN_ALERT_SEVERITY_ID: string =
  "a2eb67d4-bd2e-4186-9187-dad799c9316c";

type FoundRecords = {
  monitorStatuses?: Array<MonitorStatus>;
  incidentSeverities?: Array<IncidentSeverity>;
  alertSeverities?: Array<AlertSeverity>;
};

const monitorStatus: (id: string, projectId: ObjectID) => MonitorStatus = (
  id: string,
  projectId: ObjectID,
): MonitorStatus => {
  const status: MonitorStatus = new MonitorStatus();
  status._id = id;
  status.name = "Operational";
  status.projectId = projectId;
  return status;
};

const alertSeverity: (id: string, projectId: ObjectID) => AlertSeverity = (
  id: string,
  projectId: ObjectID,
): AlertSeverity => {
  const severity: AlertSeverity = new AlertSeverity();
  severity._id = id;
  severity.name = "High";
  severity.projectId = projectId;
  return severity;
};

const stubLookups: (found: FoundRecords) => void = (
  found: FoundRecords,
): void => {
  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockResolvedValue(found.monitorStatuses || []);
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue(found.incidentSeverities || []);
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue(found.alertSeverities || []);
};

const stepsReferencing: (ids: Array<string>) => JSONObject = (
  ids: Array<string>,
): JSONObject => {
  return {
    _type: "MonitorSteps",
    value: {
      defaultMonitorStatusId: ids[0],
      monitorStepsInstanceArray: ids.slice(1).map((id: string) => {
        return { _type: "MonitorStep", value: { id: id } };
      }),
    },
  };
};

describe("MonitorStepsProjectValidator", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects a monitor status that belongs to another project", async () => {
    stubLookups({
      monitorStatuses: [monitorStatus(FOREIGN_STATUS_ID, OTHER_PROJECT_ID)],
    });

    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsReferencing([FOREIGN_STATUS_ID]),
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("names every offending record in the message", async () => {
    stubLookups({
      monitorStatuses: [monitorStatus(FOREIGN_STATUS_ID, OTHER_PROJECT_ID)],
      alertSeverities: [
        alertSeverity(FOREIGN_ALERT_SEVERITY_ID, OTHER_PROJECT_ID),
      ],
    });

    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsReferencing([
          FOREIGN_STATUS_ID,
          FOREIGN_ALERT_SEVERITY_ID,
        ]),
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(
      /Monitor Status "Operational".*Alert Severity "High"|Alert Severity "High".*Monitor Status "Operational"/,
    );
  });

  it("accepts records that belong to the monitor's own project", async () => {
    stubLookups({
      monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
    });

    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsReferencing([OWN_STATUS_ID]),
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("ignores uuids that are not project-scoped records", async () => {
    // Step ids and criteria ids are uuids too, and match nothing.
    stubLookups({});

    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsReferencing([
          OWN_STATUS_ID,
          "679a113f-669e-4b0f-b3db-31eb2a794ed5",
          "ff11aa22-bb33-cc44-dd55-000000000ee1",
        ]),
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("does no lookups when there are no monitorSteps or no project", async () => {
    const findBy: jest.SpiedFunction<typeof MonitorStatusService.findBy> =
      jest.spyOn(MonitorStatusService, "findBy");

    await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
      monitorSteps: undefined,
      projectId: PROJECT_ID,
    });
    await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
      monitorSteps: stepsReferencing([OWN_STATUS_ID]),
      projectId: undefined,
    });

    expect(findBy).not.toHaveBeenCalled();
  });
});
