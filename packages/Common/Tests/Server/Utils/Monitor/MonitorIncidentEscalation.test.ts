import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import MonitorIncidentEscalation from "../../../../Server/Utils/Monitor/MonitorIncidentEscalation";
import { CriteriaIncident } from "../../../../Types/Monitor/CriteriaIncident";
import ObjectID from "../../../../Types/ObjectID";

describe("monitor incident escalation", () => {
  const minor: ObjectID = ObjectID.generate();
  const major: ObjectID = ObjectID.generate();
  const state: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();
  const incidentId: ObjectID = ObjectID.generate();
  const now: Date = new Date("2026-11-27T12:05:00.000Z");

  const criteriaIncident: CriteriaIncident = {
    id: "offline",
    title: "Monitor offline",
    description: "",
    incidentSeverityId: minor,
    escalationSeverityId: major,
    escalationAfterMinutes: 5,
  };

  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = projectId;
  const incident: Incident = new Incident();
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(now.getTime());
    incident.createdAt = new Date("2026-11-27T12:00:00.000Z");
    incident.currentIncidentStateId = state;
    timeline.startsAt = incident.createdAt;
    timeline.monitorStatus = new MonitorStatus();
    timeline.monitorStatus.isOfflineState = true;
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([state]);
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(timeline);
    jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue([
      Object.assign(new IncidentSeverity(), {
        _id: minor.toString(),
        order: 3,
      }),
      Object.assign(new IncidentSeverity(), {
        _id: major.toString(),
        order: 2,
      }),
    ]);
    jest.spyOn(IncidentService, "updateOneBy").mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("changes only severity on the same open incident after five minutes", async () => {
    const keepEvaluationLock: jest.Mock = jest
      .fn()
      .mockResolvedValue(undefined);
    await MonitorIncidentEscalation.apply({
      monitor,
      incidentId,
      criteriaIncident,
      keepEvaluationLock,
    });
    expect(keepEvaluationLock).toHaveBeenCalledTimes(1);
    expect(IncidentService.updateOneBy).toHaveBeenCalledWith({
      query: {
        _id: incidentId,
        projectId,
        incidentSeverityId: minor,
        currentIncidentStateId: state,
      },
      data: { incidentSeverityId: major },
      props: { isRoot: true, tenantId: projectId },
    });
  });

  it("waits for the latest offline interval after an intervening recovery", async () => {
    timeline.startsAt = new Date("2026-11-27T12:04:00.000Z");
    await MonitorIncidentEscalation.apply({
      monitor,
      incidentId,
      criteriaIncident,
    });
    expect(IncidentService.updateOneBy).not.toHaveBeenCalled();
  });

  it("waits while the incident itself is less than five minutes old", async () => {
    incident.createdAt = new Date("2026-11-27T12:04:59.000Z");
    await MonitorIncidentEscalation.apply({
      monitor,
      incidentId,
      criteriaIncident,
    });
    expect(IncidentService.updateOneBy).not.toHaveBeenCalled();
  });

  it("skips a resolved or previously upgraded incident", async () => {
    jest.mocked(IncidentService.findOneBy).mockResolvedValue(null);
    await MonitorIncidentEscalation.apply({
      monitor,
      incidentId,
      criteriaIncident,
    });
    expect(IncidentService.updateOneBy).not.toHaveBeenCalled();
  });

  it("ignores a target severity no longer available in this project", async () => {
    jest.mocked(IncidentSeverityService.findBy).mockResolvedValue([]);
    await MonitorIncidentEscalation.apply({
      monitor,
      incidentId,
      criteriaIncident,
    });
    expect(IncidentService.updateOneBy).not.toHaveBeenCalled();
  });
});
