import MonitorStepsProjectValidator from "../../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ServiceService from "../../../../Server/Services/ServiceService";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test: monitorSteps embeds ids of other records — the default
 * monitor status, the status each criteria switches to, the severities used to
 * open incidents and alerts, and the on-call policies, labels, teams and users
 * stamped on what those create. Two things can be wrong with one of them.
 *
 * An id belonging to a *different* project ties two projects together and
 * leaves the referenced project undeletable. That is refused whether the field
 * is used at run time or not.
 *
 * An id that exists NOWHERE is issue #3039: the monitor saved fine and then
 * failed on every check, inside the probe worker, with
 *   insert or update on table "MonitorStatusTimeline" violates foreign key
 *   constraint
 * and nothing surfaced to whoever supplied the id. That is refused for the ids
 * the monitor actually reads — and only when the write is INTRODUCING them, so
 * a monitor stored broken before this guard existed can still be saved.
 *
 * monitorSteps is also full of uuids that are NOT references (step ids,
 * criteria ids, incident/alert template ids). Those must keep saving fine.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "3376855b-361c-427c-8982-bad7ada30414",
);

const OWN_STATUS_ID: string = "59b5ab80-63f6-4ffd-b3df-31c6ad127695";
const FOREIGN_STATUS_ID: string = "cfc2f04f-79cb-4344-8c54-dafe5e3a290c";
const UNKNOWN_STATUS_ID: string = "b8a7d5d1-2f5a-45cf-8f2c-2f2b83d1d9aa";
const OWN_INCIDENT_SEVERITY_ID: string = "1de3b8f4-0f2d-4a6f-9a2e-7cf3a1b2c3d4";
const UNKNOWN_INCIDENT_SEVERITY_ID: string =
  "2ef4c905-1a3e-4b70-8b3f-8d04b2c3d4e5";
const UNKNOWN_ALERT_SEVERITY_ID: string =
  "3f05da16-2b4f-4c81-9c40-9e15c3d4e5f6";
const UNKNOWN_ON_CALL_POLICY_ID: string =
  "4016eb27-3c50-4d92-8d51-af26d4e5f607";
const FOREIGN_LABEL_ID: string = "5127fc38-4d61-4ea3-9e62-b037e5f60718";
const UNKNOWN_TELEMETRY_SERVICE_ID: string =
  "62380d49-5e72-4fb4-8f73-c148f6071829";

const STEP_ID: string = "4b752ccd-92e8-4295-9d33-b670e1721fbb";
const CRITERIA_ID: string = "5c863dde-a3f9-43a6-8e44-c781f2832acc";
const INCIDENT_TEMPLATE_ID: string = "6d974eef-b40a-44b7-9f55-d892031943dd";

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

const incidentSeverity: (
  id: string,
  projectId: ObjectID,
) => IncidentSeverity = (id: string, projectId: ObjectID): IncidentSeverity => {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = id;
  severity.name = "Critical";
  severity.projectId = projectId;
  return severity;
};

const label: (id: string, projectId: ObjectID) => Label = (
  id: string,
  projectId: ObjectID,
): Label => {
  const item: Label = new Label();
  item._id = id;
  item.name = "Production";
  item.projectId = projectId;
  return item;
};

type FoundRecords = {
  monitorStatuses?: Array<MonitorStatus>;
  incidentSeverities?: Array<IncidentSeverity>;
  alertSeverities?: Array<AlertSeverity>;
  onCallDutyPolicies?: Array<OnCallDutyPolicy>;
  labels?: Array<Label>;
  telemetryServices?: Array<JSONObject>;
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
  jest
    .spyOn(OnCallDutyPolicyService, "findBy")
    .mockResolvedValue(found.onCallDutyPolicies || []);
  jest.spyOn(LabelService, "findBy").mockResolvedValue(found.labels || []);
  jest
    .spyOn(ServiceService, "findBy")
    .mockResolvedValue((found.telemetryServices || []) as never);
};

const objectIdJSON: (id: string) => JSONObject = (id: string): JSONObject => {
  return { _type: ObjectType.ObjectID, value: id };
};

/*
 * A monitorSteps document with one step and one criteria, shaped exactly the
 * way MonitorSteps.toJSON writes it.
 */
const steps: (data: {
  defaultMonitorStatusId?: string | undefined;
  criteria?: JSONObject | undefined;
  step?: JSONObject | undefined;
}) => JSONObject = (data: {
  defaultMonitorStatusId?: string | undefined;
  criteria?: JSONObject | undefined;
  step?: JSONObject | undefined;
}): JSONObject => {
  return {
    _type: ObjectType.MonitorSteps,
    value: {
      defaultMonitorStatusId: data.defaultMonitorStatusId,
      monitorStepsInstanceArray: [
        {
          _type: ObjectType.MonitorStep,
          value: {
            id: STEP_ID,
            ...(data.step || {}),
            monitorCriteria: {
              _type: ObjectType.MonitorCriteria,
              value: {
                monitorCriteriaInstanceArray: data.criteria
                  ? [
                      {
                        _type: ObjectType.MonitorCriteriaInstance,
                        value: {
                          id: CRITERIA_ID,
                          name: "Monitor is offline",
                          description: "",
                          filterCondition: "all",
                          filters: [],
                          incidents: [],
                          alerts: [],
                          ...data.criteria,
                        },
                      },
                    ]
                  : [],
              },
            },
          },
        },
      ],
    },
  };
};

describe("MonitorStepsProjectValidator", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("references that do not exist (issue #3039)", () => {
    it("rejects a default monitor status that exists nowhere", () => {
      stubLookups({});

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: UNKNOWN_STATUS_ID,
          }),
          projectId: PROJECT_ID,
        }),
      ).rejects.toThrow(BadDataException);
    });

    it("rejects the criteria status that produced the MonitorStatusTimeline foreign key error", () => {
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              monitorStatusId: UNKNOWN_STATUS_ID,
              changeMonitorStatus: true,
            },
          }),
          projectId: PROJECT_ID,
        }),
      ).rejects.toThrow(
        `Monitor Status (criteria "Monitor is offline" monitor status) "${UNKNOWN_STATUS_ID}"`,
      );
    });

    it("rejects an incident severity that exists nowhere", () => {
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              createIncidents: true,
              incidents: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "Down",
                  description: "",
                  incidentSeverityId: objectIdJSON(
                    UNKNOWN_INCIDENT_SEVERITY_ID,
                  ),
                },
              ],
            },
          }),
          projectId: PROJECT_ID,
        }),
      ).rejects.toThrow(
        `Incident Severity (criteria "Monitor is offline" incident severity) "${UNKNOWN_INCIDENT_SEVERITY_ID}"`,
      );
    });

    it("rejects an alert severity that exists nowhere", () => {
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              createAlerts: true,
              alerts: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "Down",
                  description: "",
                  alertSeverityId: objectIdJSON(UNKNOWN_ALERT_SEVERITY_ID),
                },
              ],
            },
          }),
          projectId: PROJECT_ID,
        }),
      ).rejects.toThrow(
        `Alert Severity (criteria "Monitor is offline" alert severity) "${UNKNOWN_ALERT_SEVERITY_ID}"`,
      );
    });

    it("rejects an on-call policy that exists nowhere", () => {
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
        incidentSeverities: [
          incidentSeverity(OWN_INCIDENT_SEVERITY_ID, PROJECT_ID),
        ],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              createIncidents: true,
              incidents: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "Down",
                  description: "",
                  incidentSeverityId: objectIdJSON(OWN_INCIDENT_SEVERITY_ID),
                  onCallPolicyIds: [objectIdJSON(UNKNOWN_ON_CALL_POLICY_ID)],
                },
              ],
            },
          }),
          projectId: PROJECT_ID,
        }),
      ).rejects.toThrow(
        `On-Call Duty Policy (criteria "Monitor is offline" incident on-call policy) "${UNKNOWN_ON_CALL_POLICY_ID}"`,
      );
    });

    it("does not require an id the monitor never reads", () => {
      /*
       * A criteria keeps its monitorStatusId when `changeMonitorStatus` is off,
       * and keeps whole incident templates when `createIncidents` is off, so
       * toggling the switch back on restores what you had. None of that can
       * produce the foreign key violation, and refusing a save over a field
       * that does nothing would be a worse failure than the one being fixed.
       */
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              monitorStatusId: UNKNOWN_STATUS_ID,
              changeMonitorStatus: false,
              createIncidents: false,
              incidents: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "Down",
                  description: "",
                  incidentSeverityId: objectIdJSON(
                    UNKNOWN_INCIDENT_SEVERITY_ID,
                  ),
                },
              ],
            },
          }),
          projectId: PROJECT_ID,
        }),
      ).resolves.toBeUndefined();
    });

    it("does not require a telemetry service the step is scoped to", () => {
      /*
       * A deleted telemetry service leaves the monitor querying nothing, not
       * violating a foreign key, and deleting one is ordinary enough that
       * requiring it would refuse every later edit of a monitor that once
       * watched it.
       */
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            step: {
              metricMonitor: {
                telemetryServiceIds: [
                  objectIdJSON(UNKNOWN_TELEMETRY_SERVICE_ID),
                ],
              },
            },
          }),
          projectId: PROJECT_ID,
        }),
      ).resolves.toBeUndefined();
    });

    it("ignores uuids that are not references at all", () => {
      /*
       * Step ids, criteria ids and incident template ids are uuids too and
       * match no record. The old regex-scraping guard could not tell them apart
       * from a real reference, which is precisely why it could never check
       * existence.
       */
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              createIncidents: true,
              incidents: [
                { id: INCIDENT_TEMPLATE_ID, title: "Down", description: "" },
              ],
            },
          }),
          projectId: PROJECT_ID,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("ids the record already holds", () => {
    it("lets an update through when the dangling id was already stored", () => {
      /*
       * These ids have no foreign key behind them, so one really can end up
       * dangling through no fault of the person now saving — deleting a monitor
       * status does not rewrite the criteria that name it. The dashboard
       * re-submits the whole blob on every save, so a strict check would refuse
       * every edit of such a monitor, including renaming it.
       */
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      const stored: JSONObject = steps({
        defaultMonitorStatusId: OWN_STATUS_ID,
        criteria: {
          monitorStatusId: UNKNOWN_STATUS_ID,
          changeMonitorStatus: true,
        },
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: stored,
          projectId: PROJECT_ID,
          alreadyStoredMonitorSteps: stored,
        }),
      ).resolves.toBeUndefined();
    });

    it("grandfathers regardless of the case the id is re-sent in", () => {
      /*
       * ObjectID keeps whatever case it was handed, so the same id can be
       * stored as Postgres rendered it (lower) and re-sent by a caller in
       * upper. Treating that as a new id would refuse the very save this
       * exemption exists to allow.
       */
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              monitorStatusId: UNKNOWN_STATUS_ID.toUpperCase(),
              changeMonitorStatus: true,
            },
          }),
          projectId: PROJECT_ID,
          alreadyStoredMonitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              monitorStatusId: UNKNOWN_STATUS_ID,
              changeMonitorStatus: true,
            },
          }),
        }),
      ).resolves.toBeUndefined();
    });

    it("still refuses a dangling id the update is introducing", () => {
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              monitorStatusId: UNKNOWN_STATUS_ID,
              changeMonitorStatus: true,
            },
          }),
          projectId: PROJECT_ID,
          alreadyStoredMonitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              monitorStatusId: OWN_STATUS_ID,
              changeMonitorStatus: true,
            },
          }),
        }),
      ).rejects.toThrow("do not exist");
    });

    it("lets an update through when the cross-project id was already stored", () => {
      /*
       * The 1785240000000 repair migration deliberately left behind the
       * cross-project ids it could not map to a local equivalent, and there is
       * no migration for the labels / teams / on-call policies this guard now
       * also covers. Refusing them here would leave those monitors permanently
       * unsaveable — including a rename — with no way out.
       *
       * Letting one ride is safe now in a way it was not before: the writes
       * that would turn it into a real foreign key are guarded at their own
       * choke points, so it can no longer make the other project undeletable.
       */
      stubLookups({
        monitorStatuses: [
          monitorStatus(OWN_STATUS_ID, PROJECT_ID),
          monitorStatus(FOREIGN_STATUS_ID, OTHER_PROJECT_ID),
        ],
      });

      const stored: JSONObject = steps({
        defaultMonitorStatusId: OWN_STATUS_ID,
        criteria: {
          monitorStatusId: FOREIGN_STATUS_ID,
          changeMonitorStatus: true,
        },
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: stored,
          projectId: PROJECT_ID,
          alreadyStoredMonitorSteps: stored,
        }),
      ).resolves.toBeUndefined();
    });

    it("still refuses a cross-project id the update is introducing", () => {
      stubLookups({
        monitorStatuses: [
          monitorStatus(OWN_STATUS_ID, PROJECT_ID),
          monitorStatus(FOREIGN_STATUS_ID, OTHER_PROJECT_ID),
        ],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              monitorStatusId: FOREIGN_STATUS_ID,
              changeMonitorStatus: true,
            },
          }),
          projectId: PROJECT_ID,
          alreadyStoredMonitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
          }),
        }),
      ).rejects.toThrow("belong to a different project");
    });

    it("issues no query at all when the update introduces nothing new", () => {
      /*
       * Template sync pushes one blob onto every linked monitor. If each of
       * them re-validated the ids it already had, one click would fan out into
       * a lookup per model per monitor.
       */
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      const stored: JSONObject = steps({
        defaultMonitorStatusId: OWN_STATUS_ID,
        criteria: {
          monitorStatusId: OWN_STATUS_ID,
          changeMonitorStatus: true,
        },
      });

      return MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stored,
        projectId: PROJECT_ID,
        alreadyStoredMonitorSteps: stored,
      }).then(() => {
        expect(MonitorStatusService.findBy).not.toHaveBeenCalled();
      });
    });
  });

  describe("references that belong to another project", () => {
    it("rejects a monitor status from another project", () => {
      stubLookups({
        monitorStatuses: [monitorStatus(FOREIGN_STATUS_ID, OTHER_PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: FOREIGN_STATUS_ID,
          }),
          projectId: PROJECT_ID,
        }),
      ).rejects.toThrow(
        'Monitor Status (default monitor status) "Operational"',
      );
    });

    it("rejects a label from another project even though labels are never required to exist", () => {
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
        incidentSeverities: [
          incidentSeverity(OWN_INCIDENT_SEVERITY_ID, PROJECT_ID),
        ],
        labels: [label(FOREIGN_LABEL_ID, OTHER_PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              createIncidents: false,
              incidents: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "Down",
                  description: "",
                  labelIds: [objectIdJSON(FOREIGN_LABEL_ID)],
                },
              ],
            },
          }),
          projectId: PROJECT_ID,
        }),
      ).rejects.toThrow("belong to a different project");
    });

    it("names every offending record in the message", () => {
      stubLookups({
        monitorStatuses: [monitorStatus(FOREIGN_STATUS_ID, OTHER_PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: FOREIGN_STATUS_ID,
            criteria: {
              monitorStatusId: UNKNOWN_STATUS_ID,
              changeMonitorStatus: true,
            },
          }),
          projectId: PROJECT_ID,
        }),
      ).rejects.toThrow(
        /belong to a different project: Monitor Status \(default monitor status\) "Operational"[\s\S]*do not exist: Monitor Status/,
      );
    });
  });

  describe("when there is nothing to check", () => {
    it("accepts records that belong to the monitor's own project", () => {
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      return expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
          monitorSteps: steps({
            defaultMonitorStatusId: OWN_STATUS_ID,
            criteria: {
              monitorStatusId: OWN_STATUS_ID,
              changeMonitorStatus: true,
            },
          }),
          projectId: PROJECT_ID,
        }),
      ).resolves.toBeUndefined();
    });

    it("does no lookups when there are no monitorSteps or no project", async () => {
      /*
       * stubLookups installs the spy, so the lookup is asserted on the service
       * method itself. Annotating the spy handle is not an option here: this
       * file takes jest from @jest/globals, so spyOn returns jest-mock's type
       * while the jest.SpyInstance namespace resolves to @types/jest's.
       */
      stubLookups({});

      await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: undefined,
        projectId: PROJECT_ID,
      });
      await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: steps({ defaultMonitorStatusId: OWN_STATUS_ID }),
        projectId: undefined,
      });

      expect(MonitorStatusService.findBy).not.toHaveBeenCalled();
    });

    it("does no lookups when monitorSteps holds no references at all", () => {
      stubLookups({});

      return MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: steps({}),
        projectId: PROJECT_ID,
      }).then(() => {
        expect(MonitorStatusService.findBy).not.toHaveBeenCalled();
      });
    });

    it("only queries the models that are actually referenced", () => {
      /*
       * Every referenced model costs a round trip on the monitor write path, so
       * a monitor that names no label must not pay for a Label lookup.
       */
      stubLookups({
        monitorStatuses: [monitorStatus(OWN_STATUS_ID, PROJECT_ID)],
      });

      return MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: steps({ defaultMonitorStatusId: OWN_STATUS_ID }),
        projectId: PROJECT_ID,
      }).then(() => {
        expect(MonitorStatusService.findBy).toHaveBeenCalledTimes(1);
        expect(LabelService.findBy).not.toHaveBeenCalled();
        expect(OnCallDutyPolicyService.findBy).not.toHaveBeenCalled();
        expect(IncidentSeverityService.findBy).not.toHaveBeenCalled();
        expect(AlertSeverityService.findBy).not.toHaveBeenCalled();
      });
    });
  });
});
