import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import ObjectID from "../../../Types/ObjectID";

/*
 * Incidents and scheduled maintenance events carry many-to-many lists —
 * monitors, labels, on-call policies, status pages — that nothing checked
 * against the record's project. DatabaseService turns each id into a join row
 * and the permission layer never looks at relation ids, so an API caller in
 * one project could attach another project's records. On create,
 * IncidentService then changed the status of those foreign monitors and
 * executed the foreign on-call policies for this project's incident.
 *
 * These tests drive the real ProjectScopedReferenceValidator through the
 * service hooks and only stub the lookups it makes, so a foreign or unknown id
 * has to be caught by the actual check. Rejections assert the record's name
 * as the lookup returned it: that name only exists on the record registered
 * under the right service, so validating labels against the monitor table
 * (say) cannot pass them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "3376855b-361c-427c-8982-bad7ada30414",
);

const OWN_MONITOR_ID: string = "0e7c5d0e-8b44-4b53-9d3c-0f4e7a1b2c01";
const SECOND_OWN_MONITOR_ID: string = "0e7c5d0e-8b44-4b53-9d3c-0f4e7a1b2c02";
const FOREIGN_MONITOR_ID: string = "b1d0f6c2-3a5e-4c7d-8e9f-a0b1c2d3e4f5";
const OWN_LABEL_ID: string = "5f1e2d3c-4b5a-4968-8776-655443322110";
const FOREIGN_LABEL_ID: string = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";
const OWN_POLICY_ID: string = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const FOREIGN_POLICY_ID: string = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const OWN_STATUS_PAGE_ID: string = "7e6d5c4b-3a29-4180-9f8e-7d6c5b4a3928";
const FOREIGN_STATUS_PAGE_ID: string = "8f7e6d5c-4b3a-4291-8e0f-9a8b7c6d5e4f";
const UNKNOWN_ID: string = "9c0ba0b3-2f8e-4c02-a8d5-6a4d2f5b9c11";
const STATE_ID: string = "2b0a94a4-2f8c-49f0-8a2e-0f1ff5df41c9";
const SEVERITY_ID: string = "6a56b0f9-6c8f-4f76-9b53-0a1a5b0ec1a2";
const TEMPLATE_ID: string = "1d2c3b4a-5968-4776-8a5b-4c3d2e1f0a9b";
const INCIDENT_ID: string = "a2eb67d4-bd2e-4186-9187-dad799c9316c";
const SECOND_INCIDENT_ID: string = "a2eb67d4-bd2e-4186-9187-dad799c9316d";
const EVENT_ID: string = "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f";

function nameOf(id: string): string {
  return `record ${id}`;
}

function withProject<T extends DatabaseBaseModel>(
  model: T,
  id: string,
  projectId: ObjectID,
): T {
  model._id = id;
  model.setValue("projectId", projectId);
  model.setValue("name", nameOf(id));
  return model;
}

function stubOf<T extends DatabaseBaseModel>(ctor: new () => T, id: string): T {
  const model: T = new ctor();
  model._id = id;
  return model;
}

// Stand-in for the database: every record the validator can find, by service.
function registerRecords(): void {
  const byService: Array<{
    service: { findBy: unknown };
    records: Array<DatabaseBaseModel>;
  }> = [
    {
      service: MonitorService,
      records: [
        withProject(new Monitor(), OWN_MONITOR_ID, PROJECT_ID),
        withProject(new Monitor(), SECOND_OWN_MONITOR_ID, PROJECT_ID),
        withProject(new Monitor(), FOREIGN_MONITOR_ID, OTHER_PROJECT_ID),
      ],
    },
    {
      service: LabelService,
      records: [
        withProject(new Label(), OWN_LABEL_ID, PROJECT_ID),
        withProject(new Label(), FOREIGN_LABEL_ID, OTHER_PROJECT_ID),
      ],
    },
    {
      service: OnCallDutyPolicyService,
      records: [
        withProject(new OnCallDutyPolicy(), OWN_POLICY_ID, PROJECT_ID),
        withProject(
          new OnCallDutyPolicy(),
          FOREIGN_POLICY_ID,
          OTHER_PROJECT_ID,
        ),
      ],
    },
    {
      service: StatusPageService,
      records: [
        withProject(new StatusPage(), OWN_STATUS_PAGE_ID, PROJECT_ID),
        withProject(new StatusPage(), FOREIGN_STATUS_PAGE_ID, OTHER_PROJECT_ID),
      ],
    },
    {
      service: IncidentStateService,
      records: [withProject(new IncidentState(), STATE_ID, PROJECT_ID)],
    },
    {
      service: IncidentSeverityService,
      records: [withProject(new IncidentSeverity(), SEVERITY_ID, PROJECT_ID)],
    },
  ];

  for (const { service, records } of byService) {
    jest
      .spyOn(service as never, "findBy" as never)
      .mockImplementation((async (findBy: {
        query: { _id?: unknown };
      }): Promise<Array<DatabaseBaseModel>> => {
        // The validator looks ids up with QueryHelper.any (a Raw IN operator).
        const idFilter: FindOperator<unknown> = findBy.query
          ._id as FindOperator<unknown>;
        const requestedIds: Array<string> = (
          Object.values(idFilter.objectLiteralParameters || {}) as Array<
            Array<string>
          >
        )
          .flat()
          .map((id: string) => {
            return id.toLowerCase();
          });

        return records.filter((record: DatabaseBaseModel) => {
          return requestedIds.includes(record._id!.toLowerCase());
        });
      }) as never);
  }
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

function foreignMessage(modelName: string, id: string): string {
  return `belong to a different project: ${modelName} "${nameOf(id)}"`;
}

describe("cross-project relation guard on write", () => {
  beforeEach(() => {
    registerRecords();

    jest
      .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("IncidentService create", () => {
    let counter: jest.Mock;

    beforeEach(() => {
      const createdState: IncidentState = new IncidentState();
      createdState._id = STATE_ID;
      jest
        .spyOn(IncidentStateService, "findOneBy")
        .mockResolvedValue(createdState as never);

      counter = jest.fn(async () => {
        return { counter: 1, prefix: undefined };
      }) as unknown as jest.Mock;
      jest
        .spyOn(ProjectService, "incrementAndGetIncidentCounter")
        .mockImplementation(counter as never);
    });

    function incidentWith(relations: Partial<Incident>): Incident {
      const incident: Incident = new Incident();
      incident.title = "test";
      incident.incidentSeverityId = new ObjectID(SEVERITY_ID);
      Object.assign(incident, relations);
      return incident;
    }

    test("rejects another project's monitor before it can change that monitor's status", async () => {
      await expect(
        callHook(IncidentService, "onBeforeCreate", {
          data: incidentWith({
            monitors: [stubOf(Monitor, FOREIGN_MONITOR_ID)],
          }),
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(foreignMessage("Monitor", FOREIGN_MONITOR_ID));

      // Rejected before the counter, so no incident number is burned.
      expect(counter).not.toHaveBeenCalled();
    });

    test("rejects another project's label", async () => {
      await expect(
        callHook(IncidentService, "onBeforeCreate", {
          data: incidentWith({ labels: [stubOf(Label, FOREIGN_LABEL_ID)] }),
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(foreignMessage("Label", FOREIGN_LABEL_ID));
    });

    test("rejects another project's on-call policy before it can be executed", async () => {
      await expect(
        callHook(IncidentService, "onBeforeCreate", {
          data: incidentWith({
            onCallDutyPolicies: [stubOf(OnCallDutyPolicy, FOREIGN_POLICY_ID)],
          }),
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(foreignMessage("On-Call Policy", FOREIGN_POLICY_ID));
    });

    test("names every foreign record in one error", async () => {
      await expect(
        callHook(IncidentService, "onBeforeCreate", {
          data: incidentWith({
            monitors: [
              stubOf(Monitor, OWN_MONITOR_ID),
              stubOf(Monitor, FOREIGN_MONITOR_ID),
            ],
            labels: [stubOf(Label, FOREIGN_LABEL_ID)],
            onCallDutyPolicies: [stubOf(OnCallDutyPolicy, FOREIGN_POLICY_ID)],
          }),
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(
        `belong to a different project: Monitor "${nameOf(
          FOREIGN_MONITOR_ID,
        )}", Label "${nameOf(FOREIGN_LABEL_ID)}", On-Call Policy "${nameOf(
          FOREIGN_POLICY_ID,
        )}"`,
      );
    });

    test("rejects a monitor id that matches no record", async () => {
      await expect(
        callHook(IncidentService, "onBeforeCreate", {
          data: incidentWith({ monitors: [stubOf(Monitor, UNKNOWN_ID)] }),
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(`do not exist: Monitor "${UNKNOWN_ID}"`);
    });

    test("root creates are checked against the project on the payload", async () => {
      /*
       * Slack, Teams and the workers create as root with projectId on the
       * data rather than a tenant on the props.
       */
      const incident: Incident = incidentWith({
        onCallDutyPolicies: [stubOf(OnCallDutyPolicy, FOREIGN_POLICY_ID)],
      });
      incident.projectId = PROJECT_ID;

      await expect(
        callHook(IncidentService, "onBeforeCreate", {
          data: incident,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(foreignMessage("On-Call Policy", FOREIGN_POLICY_ID));
    });

    test("relations copied from an incident template are checked too", async () => {
      /*
       * A caller that sends only createdIncidentTemplateId has the server
       * copy the template's lists onto the incident. Templates never had
       * their relations checked, so the copy is validated like any other
       * payload rather than trusted.
       */
      const template: IncidentTemplate = new IncidentTemplate();
      template._id = TEMPLATE_ID;
      template.monitors = [stubOf(Monitor, FOREIGN_MONITOR_ID)];

      jest
        .spyOn(IncidentTemplateService, "findOneBy")
        .mockResolvedValue(template as never);

      await expect(
        callHook(IncidentService, "onBeforeCreate", {
          data: incidentWith({
            createdIncidentTemplateId: TEMPLATE_ID,
          }),
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(foreignMessage("Monitor", FOREIGN_MONITOR_ID));

      expect(counter).not.toHaveBeenCalled();
    });

    test("accepts this project's monitors, labels and on-call policies in every shape", async () => {
      const incident: Incident = incidentWith({
        monitors: [
          stubOf(Monitor, OWN_MONITOR_ID),
          // A bare uuid string, as an API client may send it.
          SECOND_OWN_MONITOR_ID as unknown as Monitor,
        ],
        labels: [{ _id: OWN_LABEL_ID } as unknown as Label],
        onCallDutyPolicies: [
          // Upper case: Postgres reads uuids back lower-cased.
          stubOf(OnCallDutyPolicy, OWN_POLICY_ID.toUpperCase()),
        ],
      });

      await expect(
        callHook(IncidentService, "onBeforeCreate", {
          data: incident,
          props: { tenantId: PROJECT_ID },
        }),
      ).resolves.toBeDefined();

      expect(counter).toHaveBeenCalledTimes(1);
    });

    test("does not look relations up when none are sent", async () => {
      await callHook(IncidentService, "onBeforeCreate", {
        data: incidentWith({}),
        props: { tenantId: PROJECT_ID },
      });

      expect(MonitorService.findBy).not.toHaveBeenCalled();
      expect(LabelService.findBy).not.toHaveBeenCalled();
      expect(OnCallDutyPolicyService.findBy).not.toHaveBeenCalled();
    });
  });

  describe("IncidentService update", () => {
    /*
     * The rows the update query matches, as the hook reads them back. Each
     * test sets what they already store.
     */
    let matchedIncidents: Array<Incident> = [];

    beforeEach(() => {
      matchedIncidents = [];

      jest.spyOn(IncidentService, "findBy").mockImplementation((async () => {
        return matchedIncidents;
      }) as never);
    });

    function storedIncident(data: {
      id: string;
      projectId: ObjectID;
      monitorIds?: Array<string>;
      labelIds?: Array<string>;
      policyIds?: Array<string>;
    }): Incident {
      const incident: Incident = new Incident();
      incident._id = data.id;
      incident.projectId = data.projectId;
      incident.monitors = (data.monitorIds || []).map((id: string) => {
        return stubOf(Monitor, id);
      });
      incident.labels = (data.labelIds || []).map((id: string) => {
        return stubOf(Label, id);
      });
      incident.onCallDutyPolicies = (data.policyIds || []).map((id: string) => {
        return stubOf(OnCallDutyPolicy, id);
      });
      return incident;
    }

    test("rejects adding another project's monitor", async () => {
      matchedIncidents = [
        storedIncident({
          id: INCIDENT_ID,
          projectId: PROJECT_ID,
          monitorIds: [OWN_MONITOR_ID],
        }),
      ];

      await expect(
        callHook(IncidentService, "onBeforeUpdate", {
          data: {
            monitors: [OWN_MONITOR_ID, FOREIGN_MONITOR_ID],
          },
          query: { _id: INCIDENT_ID },
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(foreignMessage("Monitor", FOREIGN_MONITOR_ID));
    });

    test("rejects adding another project's label or on-call policy", async () => {
      matchedIncidents = [
        storedIncident({ id: INCIDENT_ID, projectId: PROJECT_ID }),
      ];

      await expect(
        callHook(IncidentService, "onBeforeUpdate", {
          data: {
            labels: [{ _id: FOREIGN_LABEL_ID }],
            onCallDutyPolicies: [new ObjectID(FOREIGN_POLICY_ID)],
          },
          query: { _id: INCIDENT_ID },
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(
        `belong to a different project: Label "${nameOf(
          FOREIGN_LABEL_ID,
        )}", On-Call Policy "${nameOf(FOREIGN_POLICY_ID)}"`,
      );
    });

    test("re-saving a list keeps an id the incident already holds", async () => {
      /*
       * Incidents created before this guard — or by a monitor whose criteria
       * still carried a stale label — can already hold another project's
       * record. Refusing to save the list they already have would lock the
       * user out of editing it; only ids the update adds are checked.
       */
      matchedIncidents = [
        storedIncident({
          id: INCIDENT_ID,
          projectId: PROJECT_ID,
          labelIds: [FOREIGN_LABEL_ID],
        }),
      ];

      await expect(
        callHook(IncidentService, "onBeforeUpdate", {
          data: {
            labels: [FOREIGN_LABEL_ID.toUpperCase(), OWN_LABEL_ID],
          },
          query: { _id: INCIDENT_ID },
          props: { tenantId: PROJECT_ID },
        }),
      ).resolves.toBeDefined();

      // Only the added label was looked up.
      expect(LabelService.findBy).toHaveBeenCalledTimes(1);
    });

    test("an id held by one matched incident is still checked for the others", async () => {
      /*
       * A bulk update writes the same list onto every matched incident, so a
       * foreign id is only exempt when every one of them already holds it.
       */
      matchedIncidents = [
        storedIncident({
          id: INCIDENT_ID,
          projectId: PROJECT_ID,
          policyIds: [FOREIGN_POLICY_ID],
        }),
        storedIncident({ id: SECOND_INCIDENT_ID, projectId: PROJECT_ID }),
      ];

      await expect(
        callHook(IncidentService, "onBeforeUpdate", {
          data: {
            onCallDutyPolicies: [FOREIGN_POLICY_ID],
          },
          query: {},
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(foreignMessage("On-Call Policy", FOREIGN_POLICY_ID));
    });

    test("an incident from another project does not exempt an id for this one", async () => {
      // The read runs as root, so it can see rows outside the tenant.
      matchedIncidents = [
        storedIncident({
          id: SECOND_INCIDENT_ID,
          projectId: OTHER_PROJECT_ID,
          monitorIds: [FOREIGN_MONITOR_ID],
        }),
      ];

      await expect(
        callHook(IncidentService, "onBeforeUpdate", {
          data: { monitors: [FOREIGN_MONITOR_ID] },
          query: {},
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(foreignMessage("Monitor", FOREIGN_MONITOR_ID));
    });

    test("updates without a tenant are checked against each matched incident's project", async () => {
      matchedIncidents = [
        storedIncident({ id: INCIDENT_ID, projectId: PROJECT_ID }),
      ];

      await expect(
        callHook(IncidentService, "onBeforeUpdate", {
          data: { monitors: [{ _id: FOREIGN_MONITOR_ID }] },
          query: { _id: INCIDENT_ID },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(foreignMessage("Monitor", FOREIGN_MONITOR_ID));
    });

    test("accepts this project's records and clearing a list", async () => {
      matchedIncidents = [
        storedIncident({
          id: INCIDENT_ID,
          projectId: PROJECT_ID,
          monitorIds: [OWN_MONITOR_ID],
          labelIds: [OWN_LABEL_ID],
        }),
      ];

      await expect(
        callHook(IncidentService, "onBeforeUpdate", {
          data: {
            monitors: [OWN_MONITOR_ID, SECOND_OWN_MONITOR_ID],
            labels: [],
            onCallDutyPolicies: [{ _id: OWN_POLICY_ID }],
          },
          query: { _id: INCIDENT_ID },
          props: { tenantId: PROJECT_ID },
        }),
      ).resolves.toBeDefined();
    });

    test("an update that writes no relation list reads nothing back", async () => {
      await callHook(IncidentService, "onBeforeUpdate", {
        data: { title: "renamed" },
        query: { _id: INCIDENT_ID },
        props: { tenantId: PROJECT_ID },
      });

      expect(IncidentService.findBy).not.toHaveBeenCalled();
      expect(MonitorService.findBy).not.toHaveBeenCalled();
    });
  });

  describe("ScheduledMaintenanceService create", () => {
    let counter: jest.Mock;

    beforeEach(() => {
      const scheduledState: ScheduledMaintenanceState =
        new ScheduledMaintenanceState();
      scheduledState._id = STATE_ID;
      jest
        .spyOn(ScheduledMaintenanceStateService, "findOneBy")
        .mockResolvedValue(scheduledState as never);

      counter = jest.fn(async () => {
        return { counter: 1, prefix: undefined };
      }) as unknown as jest.Mock;
      jest
        .spyOn(ProjectService, "incrementAndGetScheduledMaintenanceCounter")
        .mockImplementation(counter as never);
    });

    function eventWith(
      relations: Partial<ScheduledMaintenance>,
    ): ScheduledMaintenance {
      const event: ScheduledMaintenance = new ScheduledMaintenance();
      event.title = "test";
      Object.assign(event, relations);
      return event;
    }

    test("rejects another project's monitor", async () => {
      await expect(
        callHook(ScheduledMaintenanceService, "onBeforeCreate", {
          data: eventWith({ monitors: [stubOf(Monitor, FOREIGN_MONITOR_ID)] }),
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(foreignMessage("Monitor", FOREIGN_MONITOR_ID));

      expect(counter).not.toHaveBeenCalled();
    });

    test("rejects another project's label", async () => {
      await expect(
        callHook(ScheduledMaintenanceService, "onBeforeCreate", {
          data: eventWith({ labels: [stubOf(Label, FOREIGN_LABEL_ID)] }),
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(foreignMessage("Label", FOREIGN_LABEL_ID));
    });

    test("rejects another project's status page", async () => {
      await expect(
        callHook(ScheduledMaintenanceService, "onBeforeCreate", {
          data: eventWith({
            statusPages: [stubOf(StatusPage, FOREIGN_STATUS_PAGE_ID)],
          }),
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(foreignMessage("Status Page", FOREIGN_STATUS_PAGE_ID));
    });

    test("root creates are checked against the project on the payload", async () => {
      const event: ScheduledMaintenance = eventWith({
        monitors: [stubOf(Monitor, FOREIGN_MONITOR_ID)],
      });
      event.projectId = PROJECT_ID;

      await expect(
        callHook(ScheduledMaintenanceService, "onBeforeCreate", {
          data: event,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(foreignMessage("Monitor", FOREIGN_MONITOR_ID));
    });

    test("accepts this project's monitors, labels and status pages", async () => {
      await expect(
        callHook(ScheduledMaintenanceService, "onBeforeCreate", {
          data: eventWith({
            monitors: [stubOf(Monitor, OWN_MONITOR_ID)],
            labels: [stubOf(Label, OWN_LABEL_ID)],
            statusPages: [stubOf(StatusPage, OWN_STATUS_PAGE_ID)],
          }),
          props: { tenantId: PROJECT_ID },
        }),
      ).resolves.toBeDefined();

      expect(counter).toHaveBeenCalledTimes(1);
    });
  });

  describe("ScheduledMaintenanceService update", () => {
    let matchedEvents: Array<ScheduledMaintenance> = [];

    beforeEach(() => {
      matchedEvents = [];

      jest
        .spyOn(ScheduledMaintenanceService, "findBy")
        .mockImplementation((async () => {
          return matchedEvents;
        }) as never);
    });

    function storedEvent(data: {
      projectId: ObjectID;
      statusPageIds?: Array<string>;
    }): ScheduledMaintenance {
      const event: ScheduledMaintenance = new ScheduledMaintenance();
      event._id = EVENT_ID;
      event.projectId = data.projectId;
      event.monitors = [];
      event.labels = [];
      event.statusPages = (data.statusPageIds || []).map((id: string) => {
        return stubOf(StatusPage, id);
      });
      return event;
    }

    test("rejects adding another project's monitor, label or status page", async () => {
      matchedEvents = [storedEvent({ projectId: PROJECT_ID })];

      await expect(
        callHook(ScheduledMaintenanceService, "onBeforeUpdate", {
          data: {
            monitors: [FOREIGN_MONITOR_ID],
            labels: [{ _id: FOREIGN_LABEL_ID }],
            statusPages: [stubOf(StatusPage, FOREIGN_STATUS_PAGE_ID)],
          },
          query: { _id: EVENT_ID },
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(
        `belong to a different project: Monitor "${nameOf(
          FOREIGN_MONITOR_ID,
        )}", Label "${nameOf(FOREIGN_LABEL_ID)}", Status Page "${nameOf(
          FOREIGN_STATUS_PAGE_ID,
        )}"`,
      );
    });

    test("re-saving a list keeps a status page the event already holds", async () => {
      matchedEvents = [
        storedEvent({
          projectId: PROJECT_ID,
          statusPageIds: [FOREIGN_STATUS_PAGE_ID],
        }),
      ];

      await expect(
        callHook(ScheduledMaintenanceService, "onBeforeUpdate", {
          data: {
            statusPages: [FOREIGN_STATUS_PAGE_ID, OWN_STATUS_PAGE_ID],
          },
          query: { _id: EVENT_ID },
          props: { tenantId: PROJECT_ID },
        }),
      ).resolves.toBeDefined();
    });

    test("updates without a tenant are checked against the matched event's project", async () => {
      matchedEvents = [storedEvent({ projectId: PROJECT_ID })];

      await expect(
        callHook(ScheduledMaintenanceService, "onBeforeUpdate", {
          data: { statusPages: [FOREIGN_STATUS_PAGE_ID] },
          query: { _id: EVENT_ID },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(foreignMessage("Status Page", FOREIGN_STATUS_PAGE_ID));
    });
  });
});
