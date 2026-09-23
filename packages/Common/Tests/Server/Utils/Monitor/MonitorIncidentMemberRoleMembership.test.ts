/*
 * The incident creation path pulls the native isolated-vm addon through
 * its template renderer (MonitorIncident → MonitorTemplateUtil → VMAPI →
 * VMRunner). Nothing under test here touches the sandbox, so stub the module
 * out before anything imports it (see MonitorIncidentResourceLinking.test.ts).
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentMember from "../../../../Models/DatabaseModels/IncidentMember";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import IncidentMemberService from "../../../../Server/Services/IncidentMemberService";
import IncidentService from "../../../../Server/Services/IncidentService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../../Server/Utils/Logger";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import { SeriesResolvedResourceIds } from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
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
 * A monitor criteria can assign incident roles ("make Alice the commander of
 * every incident this raises"). That is saved configuration: it outlives
 * Alice's membership of the project, and new incidents kept giving her the
 * role after she was removed. A user who is no longer a member is now
 * skipped; the other assignments still happen.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const COMMANDER_ROLE: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const SCRIBE_ROLE: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const MEMBER: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const DEPARTED: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Metrics;
  model.name = "Checkout API";
  return model;
}

function criteriaInstance(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Checkout is down";
  instance.data!.createIncidents = true;
  instance.data!.createAlerts = false;
  instance.data!.incidents = [
    {
      id: "incident-template-1",
      title: "Checkout is down",
      description: "The checkout API stopped responding.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: false,
      incidentMemberRoles: [
        { roleId: COMMANDER_ROLE, userId: DEPARTED },
        { roleId: SCRIBE_ROLE, userId: MEMBER },
      ],
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

function emptyResourceContext(): SeriesResolvedResourceIds {
  return {
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
  };
}

describe("MonitorIncident - incident roles from the criteria", () => {
  let memberCheck: any;
  let createdMembers: Array<IncidentMember> = [];

  beforeEach(() => {
    createdMembers = [];

    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });

    // No incident is already open for this monitor.
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);
    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockResolvedValue(emptyResourceContext());
    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });
    jest
      .spyOn(IncidentService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Incident> => {
        const incident: Incident = (createBy as { data: Incident }).data;
        incident._id = INCIDENT_ID.toString();
        return incident;
      });
    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);

    jest
      .spyOn(IncidentMemberService, "create")
      .mockImplementation(async (createBy: unknown) => {
        const member: IncidentMember = (createBy as { data: IncidentMember })
          .data;
        createdMembers.push(member);
        return member;
      });

    memberCheck = jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockImplementation(
        async (data: { projectId: ObjectID; userId: ObjectID }) => {
          return data.userId.toString() === MEMBER.toString();
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("skips a user who has left the project and still assigns the others", async () => {
    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Checkout returned 503",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      props: {},
    });

    expect(createdMembers).toHaveLength(1);
    expect(createdMembers[0]!.userId!.toString()).toBe(MEMBER.toString());
    expect(createdMembers[0]!.incidentRoleId!.toString()).toBe(
      SCRIBE_ROLE.toString(),
    );
    expect(createdMembers[0]!.incidentId!.toString()).toBe(
      INCIDENT_ID.toString(),
    );

    // Membership is asked in the monitor's project, for both users.
    const asked: Array<string> = memberCheck.mock.calls.map(
      (call: Array<any>): string => {
        expect(call[0].projectId.toString()).toBe(PROJECT_ID.toString());
        return call[0].userId.toString();
      },
    );
    expect(asked.sort()).toEqual(
      [DEPARTED.toString(), MEMBER.toString()].sort(),
    );
  });
});
