import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import InvestigationGrader from "../../../Server/Utils/AI/SRE/InvestigationGrader";
import OnCallAcknowledgementTimeout from "../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import StateChangeLock from "../../../Server/Utils/StateChangeLock";
import StateChangeNote from "../../../Server/Utils/StateChangeNote";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
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
 * RESOLVING AN ALERT CAN CARRY ITS ROOT CAUSE, AND ITS INVESTIGATION IS
 * GRADED (#7765).
 *
 * The Resolve dialog's "Add the root cause" sends it with the state change
 * (writtenRootCause). The alert timeline:
 *
 *   - asks, before it locks the alert, whether the person may write it,
 *     with the alert's own update check - and refuses the whole change,
 *     saying how to change the state anyway, when they may not;
 *   - once the change is saved, writes it as the alert's root cause, as
 *     the person who resolved it;
 *   - grades OneUptime AI's investigation of the alert when the change
 *     resolves it - against the root cause written with it, when it was
 *     written - never blocking the resolve.
 *
 * Driven through the real hooks, everything around them stubbed.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ALERT_ID: ObjectID = ObjectID.generate();
const ACKNOWLEDGED_STATE_ID: ObjectID = ObjectID.generate();
const RESOLVED_STATE_ID: ObjectID = ObjectID.generate();
const CLOSED_STATE_ID: ObjectID = ObjectID.generate();

const PERSON: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: PROJECT_ID,
};

const ROOT_CAUSE: string = "A batch container took the host's CPU.";

// The states each one counts as resolved: Resolved and Closed, after it.
const RESOLVED_STATE_IDS: Array<string> = [
  RESOLVED_STATE_ID.toString(),
  CLOSED_STATE_ID.toString(),
];

type Hook = (...args: Array<unknown>) => Promise<unknown>;

function hook(name: string): Hook {
  return (
    (AlertStateTimelineService as unknown as Record<string, Hook>)[name] as Hook
  ).bind(AlertStateTimelineService);
}

interface Spies {
  writeAlert: SpyInstance<typeof AlertService.updateOneById>;
  grade: SpyInstance<typeof InvestigationGrader.gradeInvestigationOnResolve>;
}

let spies: Spies;

beforeEach(() => {
  jest
    .spyOn(AlertStateTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest.spyOn(AlertService, "updateOneBy").mockResolvedValue(undefined as never);
  jest
    .spyOn(StateChangeLock, "giveBackFor")
    .mockResolvedValue(undefined as never);
  jest.spyOn(AlertStateService, "findOneBy").mockResolvedValue({
    name: "Resolved",
    isCreatedState: false,
  } as unknown as AlertState);
  jest
    .spyOn(AlertStateService, "isResolvedAlertState")
    .mockImplementation(
      async (data: { alertStateId: ObjectID }): Promise<boolean> => {
        return RESOLVED_STATE_IDS.includes(data.alertStateId.toString());
      },
    );
  jest
    .spyOn(AlertStateService, "isAcknowledgedAlertState")
    .mockResolvedValue(true);
  jest
    .spyOn(ProjectMilestoneService, "reachInBackground")
    .mockReturnValue(undefined as never);
  jest.spyOn(AlertService, "getAlertNumber").mockResolvedValue({
    number: 7,
    numberWithPrefix: "ALR-7",
  });
  jest
    .spyOn(AlertService, "getAlertLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/alert"));
  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(StateChangeNote, "postPrivateNotes")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallAcknowledgementTimeout, "onRecordStateChanged")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      AlertStateTimelineService as unknown as {
        isLastAlertState: () => Promise<boolean>;
      },
      "isLastAlertState",
    )
    .mockResolvedValue(false);

  spies = {
    writeAlert: jest
      .spyOn(AlertService, "updateOneById")
      .mockResolvedValue(undefined as never),
    grade: jest
      .spyOn(InvestigationGrader, "gradeInvestigationOnResolve")
      .mockResolvedValue(undefined),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A saved move of the alert from one state to another, with what came with it.
async function move(data: {
  from: ObjectID;
  to: ObjectID;
  writtenRootCause?: string | undefined;
}): Promise<void> {
  const before: AlertStateTimeline = new AlertStateTimeline();
  before._id = ObjectID.generate().toString();
  before.alertStateId = data.from;

  const created: AlertStateTimeline = new AlertStateTimeline();
  created._id = ObjectID.generate().toString();
  created.projectId = PROJECT_ID;
  created.alertId = ALERT_ID;
  created.alertStateId = data.to;
  created.startsAt = new Date("2026-11-19T10:00:00.000Z");

  await hook("onCreateSuccess")(
    {
      createBy: { data: created, props: PERSON },
      carryForward: {
        statusTimelineBeforeThisStatus: before,
        statusTimelineAfterThisStatus: null,
        privateNotesToPost: [],
        writtenRootCause: data.writtenRootCause,
        mutex: null,
      },
    },
    created,
  );
}

describe("once the change is saved", () => {
  test("a root cause that came with it is the alert's own, written as the person who resolved it", async () => {
    await move({
      from: ACKNOWLEDGED_STATE_ID,
      to: RESOLVED_STATE_ID,
      writtenRootCause: ROOT_CAUSE,
    });

    expect(spies.writeAlert).toHaveBeenCalledTimes(1);
    expect(spies.writeAlert).toHaveBeenCalledWith({
      id: ALERT_ID,
      data: { rootCause: ROOT_CAUSE },
      props: PERSON,
    });
  });

  test("resolving it grades its investigation against that root cause", async () => {
    await move({
      from: ACKNOWLEDGED_STATE_ID,
      to: RESOLVED_STATE_ID,
      writtenRootCause: ROOT_CAUSE,
    });

    expect(spies.grade).toHaveBeenCalledTimes(1);
    expect(spies.grade).toHaveBeenCalledWith({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
      writtenRootCause: ROOT_CAUSE,
    });
    // Written first, so the grade and the alert agree.
    expect(spies.writeAlert.mock.invocationCallOrder[0]!).toBeLessThan(
      spies.grade.mock.invocationCallOrder[0]!,
    );
  });

  test("resolving it with no root cause still grades it - the grader decides whose root cause the alert holds", async () => {
    await move({ from: ACKNOWLEDGED_STATE_ID, to: RESOLVED_STATE_ID });

    expect(spies.writeAlert).not.toHaveBeenCalled();
    expect(spies.grade).toHaveBeenCalledWith({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
      writtenRootCause: undefined,
    });
  });

  test("a root cause that could not be written is not graded against, and the resolve stands", async () => {
    spies.writeAlert.mockRejectedValue(new Error("database is down"));

    await expect(
      move({
        from: ACKNOWLEDGED_STATE_ID,
        to: RESOLVED_STATE_ID,
        writtenRootCause: ROOT_CAUSE,
      }),
    ).resolves.toBeUndefined();

    expect(spies.grade).toHaveBeenCalledWith(
      expect.objectContaining({ writtenRootCause: undefined }),
    );
  });

  test("a grading that fails never fails the resolve", async () => {
    spies.grade.mockRejectedValue(new Error("provider down"));

    await expect(
      move({
        from: ACKNOWLEDGED_STATE_ID,
        to: RESOLVED_STATE_ID,
        writtenRootCause: ROOT_CAUSE,
      }),
    ).resolves.toBeUndefined();
  });

  test("a change that does not resolve it writes the root cause and grades nothing", async () => {
    await move({
      from: ObjectID.generate(),
      to: ACKNOWLEDGED_STATE_ID,
      writtenRootCause: ROOT_CAUSE,
    });

    expect(spies.writeAlert).toHaveBeenCalledTimes(1);
    expect(spies.grade).not.toHaveBeenCalled();
  });

  test("moving from one resolved state to another is no new resolve", async () => {
    await move({ from: RESOLVED_STATE_ID, to: CLOSED_STATE_ID });

    expect(spies.grade).not.toHaveBeenCalled();
  });
});

describe("before the change is saved", () => {
  // What the hook is handed for a move into the resolved state.
  function resolveWith(miscDataProps: JSONObject): {
    data: AlertStateTimeline;
    props: DatabaseCommonInteractionProps;
    miscDataProps: JSONObject;
  } {
    const data: AlertStateTimeline = new AlertStateTimeline();
    data.projectId = PROJECT_ID;
    data.alertId = ALERT_ID;
    data.alertStateId = RESOLVED_STATE_ID;

    return { data, props: PERSON, miscDataProps };
  }

  beforeEach(() => {
    jest
      .spyOn(ProjectReferencesService.prototype, "onBeforeCreate" as never)
      .mockImplementation((async (createBy: unknown) => {
        return { createBy, carryForward: null };
      }) as never);
  });

  test("a root cause the person may not write refuses the whole change, before the alert is locked", async () => {
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to edit Alert. You need one of these permissions: Project Owner, Edit Alert",
        ),
      );
    const lock: SpyInstance<typeof StateChangeLock.take> = jest.spyOn(
      StateChangeLock,
      "take",
    );

    await expect(
      hook("onBeforeCreate")(resolveWith({ writtenRootCause: ROOT_CAUSE })),
    ).rejects.toThrow(
      "The state was not changed: it comes with a root cause, which you may not write.",
    );
    expect(lock).not.toHaveBeenCalled();
  });

  test("the person's permission to write it is asked with the alert's own update check", async () => {
    const check: SpyInstance<
      typeof ModelPermission.checkUpdateQueryPermissions
    > = jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockRejectedValue(new NotAuthorizedException("No."));
    jest.spyOn(StateChangeLock, "take");

    await expect(
      hook("onBeforeCreate")(resolveWith({ writtenRootCause: ROOT_CAUSE })),
    ).rejects.toThrow(NotAuthorizedException);

    expect(check).toHaveBeenCalledWith(
      expect.anything(),
      { _id: ALERT_ID.toString() },
      { rootCause: ROOT_CAUSE },
      PERSON,
    );
    expect(check.mock.calls[0]![0].name).toBe("Alert");
  });
});
