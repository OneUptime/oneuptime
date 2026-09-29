/*
 * The incident creation path pulls the native isolated-vm addon through
 * its template renderer (MonitorIncident → MonitorTemplateUtil → VMAPI →
 * VMRunner). Nothing under test here touches the sandbox, and the
 * prebuilt binary cannot always dlopen in the test environment — so stub
 * the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../Server/Services/LabelService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import logger from "../../../../Server/Utils/Logger";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import Dictionary from "../../../../Types/Dictionary";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A monitor criteria names the on-call policies to page and the labels to
 * put on the incidents it opens. Those ids live in monitorSteps JSON, with no
 * foreign key behind them, so a criteria can still point at a policy that was
 * deleted or at another project's label (the monitorSteps repair could not
 * resolve every id). IncidentService now refuses both on create, and this
 * path runs inside the probe / telemetry ingest workers: letting that throw
 * would fail the whole job for the monitor on every check, with no incident
 * at all. So the stale ids are dropped and logged, and the incident is still
 * opened with everything that is usable.
 *
 * The lookups are stubbed at the service level, so the real
 * ProjectScopedReferenceValidator.isUsableInProject decides.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const OWN_POLICY_ID: string = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const FOREIGN_POLICY_ID: string = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const DELETED_POLICY_ID: string = "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a";
const OWN_LABEL_ID: string = "5f1e2d3c-4b5a-4968-8776-655443322110";
const FOREIGN_LABEL_ID: string = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Metrics;
  model.name = "API latency";
  return model;
}

function criteriaInstance(data: {
  onCallPolicyIds?: Array<ObjectID> | undefined;
  labelIds?: Array<ObjectID> | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Latency > 1s";
  instance.data!.createIncidents = true;
  instance.data!.createAlerts = false;
  instance.data!.incidents = [
    {
      id: "incident-template-1",
      title: "Latency is high",
      description: "API latency breached 1s.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: false,
      onCallPolicyIds: data.onCallPolicyIds,
      labelIds: data.labelIds,
    },
  ];
  return instance;
}

const dataToProcess: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: MONITOR_ID,
  monitoredAt: new Date("2026-09-23T03:33:00.000Z"),
} as unknown as ProbeMonitorResponse;

const NO_AUTO_RESOLVE: Dictionary<Array<string>> = {};

function withProject<T extends DatabaseBaseModel>(
  model: T,
  id: string,
  projectId: ObjectID,
): T {
  model._id = id;
  model.setValue("projectId", projectId);
  return model;
}

/*
 * isUsableInProject reads `{ _id, projectId }` with findOneBy. Answer it the
 * way Postgres would from these rows: a record from another project, or one
 * that is not there, is not found.
 */
function registerRecords(
  service: { findOneBy: unknown },
  records: Array<DatabaseBaseModel>,
): jest.Mock {
  const findOneBy: jest.Mock = jest.fn(async (findBy: unknown) => {
    const query: { _id?: unknown; projectId?: unknown } = (
      findBy as { query: { _id?: unknown; projectId?: unknown } }
    ).query;

    return (
      records.find((record: DatabaseBaseModel) => {
        return (
          record._id === String(query._id).toLowerCase() &&
          record.getValue<ObjectID>("projectId")?.toString() ===
            String(query.projectId)
        );
      }) || null
    );
  }) as unknown as jest.Mock;

  jest
    .spyOn(service as never, "findOneBy" as never)
    .mockImplementation(findOneBy as never);

  return findOneBy;
}

function idsOn(
  relation: Array<{ _id?: string | undefined }> | undefined,
): Array<string> {
  return (relation || []).map((item: { _id?: string | undefined }): string => {
    return String(item._id);
  });
}

async function openIncident(instance: MonitorCriteriaInstance): Promise<void> {
  await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
    criteriaInstance: instance,
    monitor: monitor(),
    dataToProcess: dataToProcess,
    rootCause: "Latency is above 1s",
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
    props: {},
  });
}

describe("MonitorIncident drops criteria references the project cannot use", () => {
  let createdIncidents: Array<Incident> = [];
  let policyLookup: jest.Mock;
  let labelLookup: jest.Mock;

  beforeEach(() => {
    createdIncidents = [];

    // No incident is already open for this monitor.
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);

    registerRecords(IncidentSeverityService, [
      withProject(new IncidentSeverity(), SEVERITY_ID.toString(), PROJECT_ID),
    ]);

    policyLookup = registerRecords(OnCallDutyPolicyService, [
      withProject(new OnCallDutyPolicy(), OWN_POLICY_ID, PROJECT_ID),
      withProject(new OnCallDutyPolicy(), FOREIGN_POLICY_ID, OTHER_PROJECT_ID),
    ]);

    labelLookup = registerRecords(LabelService, [
      withProject(new Label(), OWN_LABEL_ID, PROJECT_ID),
      withProject(new Label(), FOREIGN_LABEL_ID, OTHER_PROJECT_ID),
    ]);

    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockResolvedValue({
        hostIds: [],
        dockerHostIds: [],
        podmanHostIds: [],
        kubernetesClusterIds: [],
        serviceIds: [],
        proxmoxClusterIds: [],
        vmwareVCenterIds: [],
        cephClusterIds: [],
        dockerSwarmClusterIds: [],
        iotFleetIds: [],
        databaseServerIds: [],
      });

    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

    jest
      .spyOn(IncidentService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Incident> => {
        const incident: Incident = (createBy as { data: Incident }).data;
        createdIncidents.push(incident);
        incident._id = new ObjectID(
          "66666666-6666-4666-8666-666666666666",
        ).toString();
        return incident;
      });

    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("opens the incident with the usable on-call policies and logs the rest", async () => {
    await openIncident(
      criteriaInstance({
        onCallPolicyIds: [
          new ObjectID(OWN_POLICY_ID),
          new ObjectID(FOREIGN_POLICY_ID),
          new ObjectID(DELETED_POLICY_ID),
        ],
      }),
    );

    expect(createdIncidents).toHaveLength(1);
    expect(idsOn(createdIncidents[0]!.onCallDutyPolicies)).toEqual([
      OWN_POLICY_ID,
    ]);

    const logged: string = JSON.stringify(
      (logger.error as unknown as jest.Mock).mock.calls,
    );
    expect(logged).toContain(FOREIGN_POLICY_ID);
    expect(logged).toContain(DELETED_POLICY_ID);
    expect(logged).not.toContain(`on-call policy ${OWN_POLICY_ID}`);
  });

  it("opens the incident with the usable labels and logs the rest", async () => {
    await openIncident(
      criteriaInstance({
        labelIds: [new ObjectID(FOREIGN_LABEL_ID), new ObjectID(OWN_LABEL_ID)],
      }),
    );

    expect(createdIncidents).toHaveLength(1);
    expect(idsOn(createdIncidents[0]!.labels)).toEqual([OWN_LABEL_ID]);
    expect(
      JSON.stringify((logger.error as unknown as jest.Mock).mock.calls),
    ).toContain(`label ${FOREIGN_LABEL_ID}`);
  });

  it("checks each list against its own model", async () => {
    /*
     * A label id is not a policy. If the lists were looked up in the wrong
     * table, the own label would be dropped as unknown here.
     */
    await openIncident(
      criteriaInstance({
        onCallPolicyIds: [new ObjectID(OWN_POLICY_ID)],
        labelIds: [new ObjectID(OWN_LABEL_ID)],
      }),
    );

    expect(idsOn(createdIncidents[0]!.onCallDutyPolicies)).toEqual([
      OWN_POLICY_ID,
    ]);
    expect(idsOn(createdIncidents[0]!.labels)).toEqual([OWN_LABEL_ID]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("still opens the incident when every criteria reference is stale", async () => {
    await openIncident(
      criteriaInstance({
        onCallPolicyIds: [new ObjectID(FOREIGN_POLICY_ID)],
        labelIds: [new ObjectID(FOREIGN_LABEL_ID)],
      }),
    );

    expect(createdIncidents).toHaveLength(1);
    /*
     * Empty lists rather than undefined: IncidentService copies an incident
     * template's lists onto the incident only when the payload leaves them
     * undefined.
     */
    expect(createdIncidents[0]!.onCallDutyPolicies).toEqual([]);
    expect(createdIncidents[0]!.labels).toEqual([]);
  });

  it("drops a value that is not a uuid without looking it up", async () => {
    /*
     * Postgres would reject the cast, failing the ingest job just like the
     * create would have.
     */
    await openIncident(
      criteriaInstance({
        labelIds: [
          {
            toString: () => {
              return "not-a-uuid";
            },
          } as unknown as ObjectID,
          new ObjectID(OWN_LABEL_ID),
        ],
      }),
    );

    expect(idsOn(createdIncidents[0]!.labels)).toEqual([OWN_LABEL_ID]);
    expect(labelLookup).toHaveBeenCalledTimes(1);
  });

  it("looks nothing up when the criteria names no policy or label", async () => {
    await openIncident(criteriaInstance({}));

    expect(createdIncidents).toHaveLength(1);
    expect(createdIncidents[0]!.onCallDutyPolicies).toEqual([]);
    expect(createdIncidents[0]!.labels).toEqual([]);
    expect(policyLookup).not.toHaveBeenCalled();
    expect(labelLookup).not.toHaveBeenCalled();
  });
});
