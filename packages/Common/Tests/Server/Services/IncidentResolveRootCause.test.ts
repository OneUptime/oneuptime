import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import AIIncidentPostmortemRunner from "../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import InvestigationGrader from "../../../Server/Utils/AI/SRE/InvestigationGrader";
import OnCallAcknowledgementTimeout from "../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import StateChangeLock from "../../../Server/Utils/StateChangeLock";
import StateChangeNote from "../../../Server/Utils/StateChangeNote";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * RESOLVING AN INCIDENT CAN CARRY ITS ROOT CAUSE TOO (#7765).
 *
 * The incident's Resolve dialog asks for it as the alert's does. The
 * incident timeline asks whether the person may write it before it locks
 * the incident, writes it as the incident's root cause once the change is
 * saved - before the resolve grades OneUptime AI's investigation - and
 * hands it to the grader. Driven through the real hooks, everything around
 * them stubbed.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();

function stateRow(order: number, isResolvedState: boolean): IncidentState {
  const state: IncidentState = new IncidentState(ObjectID.generate());
  state.order = order;
  state.isResolvedState = isResolvedState;
  state.isAcknowledgedState = order === 2;
  state.isCreatedState = order === 1;
  state.name = ["Created", "Acknowledged", "Resolved"][order - 1] || "";
  return state;
}

const STATES: Array<IncidentState> = [
  stateRow(1, false),
  stateRow(2, false),
  stateRow(3, true),
];
const ACKNOWLEDGED: IncidentState = STATES[1]!;
const RESOLVED: IncidentState = STATES[2]!;

const PERSON: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: PROJECT_ID,
};

const ROOT_CAUSE: string = "The v2.14.0 deploy reads percentOff.";

type Hook = (...args: Array<unknown>) => Promise<unknown>;

function hook(name: string): Hook {
  return (
    (IncidentStateTimelineService as unknown as Record<string, Hook>)[
      name
    ] as Hook
  ).bind(IncidentStateTimelineService);
}

let writeIncident: SpyInstance<typeof IncidentService.updateOneById>;
let grade: SpyInstance<typeof InvestigationGrader.gradeInvestigationOnResolve>;

beforeEach(() => {
  jest
    .spyOn(IncidentStateTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentService, "updateOneBy")
    .mockResolvedValue(undefined as never);
  jest.spyOn(IncidentStateService, "findOneBy").mockResolvedValue(RESOLVED);
  jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockResolvedValue(STATES);
  jest
    .spyOn(StateChangeLock, "giveBackFor")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentAlertService, "cascadeIncidentStateToLinkedAlerts")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectMilestoneService, "reachInBackground")
    .mockReturnValue(undefined as never);
  jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
    number: 12,
    numberWithPrefix: "INC-12",
  });
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/incident"));
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      IncidentStateTimelineService as unknown as {
        autoAssignIncidentCommander: () => Promise<void>;
      },
      "autoAssignIncidentCommander",
    )
    .mockResolvedValue(undefined);
  jest.spyOn(IncidentService, "findOneBy").mockResolvedValue({
    projectId: PROJECT_ID,
    monitors: [],
    holdsMonitors: false,
  } as unknown as Incident);
  jest
    .spyOn(AIIncidentPostmortemRunner, "draftPostmortemOnResolve")
    .mockResolvedValue(undefined);
  jest
    .spyOn(StateChangeNote, "postPrivateNotes")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentService, "refreshIncidentMetrics")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallAcknowledgementTimeout, "onRecordStateChanged")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      IncidentStateTimelineService as unknown as {
        trackSlaStateChange: () => Promise<void>;
      },
      "trackSlaStateChange",
    )
    .mockResolvedValue(undefined);
  jest
    .spyOn(
      IncidentStateTimelineService as unknown as {
        isLastIncidentState: () => Promise<boolean>;
      },
      "isLastIncidentState",
    )
    .mockResolvedValue(false);

  writeIncident = jest
    .spyOn(IncidentService, "updateOneById")
    .mockResolvedValue(undefined as never);
  grade = jest
    .spyOn(InvestigationGrader, "gradeInvestigationOnResolve")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function move(data: {
  from: IncidentState;
  to: IncidentState;
  writtenRootCause?: string | undefined;
}): Promise<void> {
  const before: IncidentStateTimeline = new IncidentStateTimeline();
  before._id = ObjectID.generate().toString();
  before.incidentStateId = data.from.id!;

  const created: IncidentStateTimeline = new IncidentStateTimeline();
  created._id = ObjectID.generate().toString();
  created.projectId = PROJECT_ID;
  created.incidentId = INCIDENT_ID;
  created.incidentStateId = data.to.id!;
  created.startsAt = new Date("2026-11-19T10:00:00.000Z");

  await hook("onCreateSuccess")(
    {
      createBy: { data: created, props: PERSON },
      carryForward: {
        statusTimelineBeforeThisStatus: before,
        statusTimelineAfterThisStatus: null,
        publicNote: undefined,
        publicNoteToPost: undefined,
        privateNotesToPost: [],
        writtenRootCause: data.writtenRootCause,
        mutex: null,
      },
    },
    created,
  );
}

describe("once the change is saved", () => {
  test("the root cause that came with it is the incident's own, written as the person, before the investigation is graded against it", async () => {
    await move({
      from: ACKNOWLEDGED,
      to: RESOLVED,
      writtenRootCause: ROOT_CAUSE,
    });

    expect(writeIncident).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      data: { rootCause: ROOT_CAUSE },
      props: PERSON,
    });
    expect(grade).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      writtenRootCause: ROOT_CAUSE,
    });
    expect(writeIncident.mock.invocationCallOrder[0]!).toBeLessThan(
      grade.mock.invocationCallOrder[0]!,
    );
  });

  test("resolved with none, it is graded as before: the grader reads the root cause the incident holds", async () => {
    await move({ from: ACKNOWLEDGED, to: RESOLVED });

    expect(writeIncident).not.toHaveBeenCalled();
    expect(grade).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      writtenRootCause: undefined,
    });
  });

  test("a root cause that could not be written is not graded against, and the resolve stands", async () => {
    writeIncident.mockRejectedValue(new Error("database is down"));

    await expect(
      move({ from: ACKNOWLEDGED, to: RESOLVED, writtenRootCause: ROOT_CAUSE }),
    ).resolves.toBeUndefined();

    expect(grade).toHaveBeenCalledWith(
      expect.objectContaining({ writtenRootCause: undefined }),
    );
  });

  test("a change that does not resolve it still writes the root cause, and grades nothing", async () => {
    await move({
      from: STATES[0]!,
      to: ACKNOWLEDGED,
      writtenRootCause: ROOT_CAUSE,
    });

    expect(writeIncident).toHaveBeenCalledTimes(1);
    expect(grade).not.toHaveBeenCalled();
  });
});

describe("before the change is saved", () => {
  beforeEach(() => {
    jest
      .spyOn(ProjectReferencesService.prototype, "onBeforeCreate" as never)
      .mockImplementation((async (createBy: unknown) => {
        return { createBy, carryForward: null };
      }) as never);
  });

  test("a root cause the person may not write refuses the whole change, before the incident is locked", async () => {
    const check: SpyInstance<
      typeof ModelPermission.checkUpdateQueryPermissions
    > = jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to edit Incident. You need one of these permissions: Project Owner, Edit Incident",
        ),
      );
    const lock: SpyInstance<typeof StateChangeLock.take> = jest.spyOn(
      StateChangeLock,
      "take",
    );
    const data: IncidentStateTimeline = new IncidentStateTimeline();
    data.projectId = PROJECT_ID;
    data.incidentId = INCIDENT_ID;
    data.incidentStateId = RESOLVED.id!;

    await expect(
      hook("onBeforeCreate")({
        data,
        props: PERSON,
        miscDataProps: { writtenRootCause: ROOT_CAUSE },
      }),
    ).rejects.toThrow(
      "The state was not changed: it comes with a root cause, which you may not write. You do not have permissions to edit Incident.",
    );
    expect(lock).not.toHaveBeenCalled();
    expect(check.mock.calls[0]![0].name).toBe("Incident");
    expect(check).toHaveBeenCalledWith(
      expect.anything(),
      { _id: INCIDENT_ID.toString() },
      { rootCause: ROOT_CAUSE },
      PERSON,
    );
  });
});
