import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertInternalNoteService from "../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A NOTE THAT RIDES ALONG WITH A STATE CHANGE IS WRITTEN ONCE THE CHANGE IS.
 *
 * Changing an alert's state can carry an internal note, and changing a
 * scheduled maintenance event's state a public note. Those notes were created
 * in onBeforeCreate - before the state change passed DatabaseService's
 * permission check and before it was saved - so a refused or failed change
 * could still leave its note behind. Like the incident timeline's public
 * note, they are now created in onCreateSuccess.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1f000000-0000-4000-8000-000000000001",
);
const ALERT_ID: ObjectID = new ObjectID("1f000000-0000-4000-8000-000000000002");
const ALERT_STATE_ID: ObjectID = new ObjectID(
  "1f000000-0000-4000-8000-000000000003",
);
const EVENT_ID: ObjectID = new ObjectID("1f000000-0000-4000-8000-000000000004");
const EVENT_STATE_ID: ObjectID = new ObjectID(
  "1f000000-0000-4000-8000-000000000005",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "1f000000-0000-4000-8000-000000000006",
);
const STARTS_AT: Date = new Date("2026-10-05T08:00:00.000Z");

// Thrown by the first call after the note, so a test stops right there.
const STOP: string = "stopped after the note";

type Hook = (input: unknown, second?: unknown) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  return (service as Record<string, Hook>)[name]!.bind(service);
}

beforeEach(() => {
  getJestSpyOn(
    ProjectScopedReferenceValidator,
    "validateReferencesBelongToProject",
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AlertStateTimelineService: the internal note", () => {
  let createNote: jest.SpyInstance;

  beforeEach(() => {
    createNote = getJestSpyOn(AlertInternalNoteService, "create").mockResolvedValue(
      new AlertInternalNote(),
    );
    getJestSpyOn(AlertStateTimelineService, "findOneBy").mockResolvedValue(
      null,
    );
  });

  test("is not written before the state change is saved, only carried forward", async () => {
    const result: { carryForward: Record<string, unknown> } = (await hookOf(
      AlertStateTimelineService,
      "onBeforeCreate",
    )({
      data: {
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
        alertStateId: ALERT_STATE_ID,
        startsAt: STARTS_AT,
      },
      miscDataProps: { internalNote: "Rolled back the deploy." },
      props: { isRoot: true },
    })) as { carryForward: Record<string, unknown> };

    expect(createNote).not.toHaveBeenCalled();
    expect(result.carryForward["internalNote"]).toBe("Rolled back the deploy.");
  });

  test("is written once the state change exists, at the change's time, as the caller", async () => {
    getJestSpyOn(AlertService, "updateOneBy").mockResolvedValue(1);
    getJestSpyOn(AlertStateService, "findOneBy").mockResolvedValue(null);
    getJestSpyOn(AlertService, "getAlertNumber").mockResolvedValue({
      number: 7,
      numberWithPrefix: "ALT-7",
    } as never);
    getJestSpyOn(AlertService, "getAlertLinkInDashboard").mockResolvedValue(
      "https://oneuptime.test/alert" as never,
    );
    getJestSpyOn(AlertFeedService, "createAlertFeedItem").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(AlertService, "refreshAlertMetrics").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(AlertStateTimelineService, "isLastAlertState").mockRejectedValue(
      new Error(STOP),
    );

    const created: AlertStateTimeline = new AlertStateTimeline();
    created._id = TIMELINE_ID.toString();
    created.alertId = ALERT_ID;
    created.projectId = PROJECT_ID;
    created.alertStateId = ALERT_STATE_ID;
    created.startsAt = STARTS_AT;

    const props: Record<string, unknown> = { isRoot: true };

    await expect(
      hookOf(AlertStateTimelineService, "onCreateSuccess")(
        {
          createBy: { data: created, props: props },
          carryForward: {
            statusTimelineBeforeThisStatus: null,
            statusTimelineAfterThisStatus: null,
            internalNote: "Rolled back the deploy.",
            privateNote: undefined,
            mutex: null,
          },
        },
        created,
      ),
    ).rejects.toThrow(STOP);

    expect(createNote).toHaveBeenCalledTimes(1);
    const request: { data: AlertInternalNote; props: unknown } = createNote.mock
      .calls[0]![0] as { data: AlertInternalNote; props: unknown };
    expect(request.data.note).toBe("Rolled back the deploy.");
    expect(request.data.alertId?.toString()).toBe(ALERT_ID.toString());
    expect(request.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(request.data.createdAt).toEqual(STARTS_AT);
    expect(request.props).toBe(props);
  });
});

describe("ScheduledMaintenanceStateTimelineService: the public note", () => {
  let createNote: jest.SpyInstance;

  beforeEach(() => {
    createNote = getJestSpyOn(
      ScheduledMaintenancePublicNoteService,
      "create",
    ).mockResolvedValue(new ScheduledMaintenancePublicNote());
    getJestSpyOn(
      ScheduledMaintenanceStateTimelineService,
      "findOneBy",
    ).mockResolvedValue(null);
  });

  test("is not written before the state change is saved; the change's own notification status is still decided there", async () => {
    const result: {
      createBy: { data: ScheduledMaintenanceStateTimeline };
      carryForward: Record<string, unknown>;
    } = (await hookOf(ScheduledMaintenanceStateTimelineService, "onBeforeCreate")(
      {
        data: {
          scheduledMaintenanceId: EVENT_ID,
          projectId: PROJECT_ID,
          scheduledMaintenanceStateId: EVENT_STATE_ID,
          startsAt: STARTS_AT,
          shouldStatusPageSubscribersBeNotified: false,
        },
        miscDataProps: { publicNote: "Work has started." },
        props: { isRoot: true },
      },
    )) as {
      createBy: { data: ScheduledMaintenanceStateTimeline };
      carryForward: Record<string, unknown>;
    };

    expect(createNote).not.toHaveBeenCalled();
    expect(result.carryForward["publicNote"]).toBe("Work has started.");
    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("is written once the state change exists, at the change's time, as the caller", async () => {
    getJestSpyOn(ScheduledMaintenanceService, "updateOneBy").mockResolvedValue(
      1,
    );
    getJestSpyOn(
      ScheduledMaintenanceStateService,
      "findOneBy",
    ).mockRejectedValue(new Error(STOP));

    const created: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    created._id = TIMELINE_ID.toString();
    created.scheduledMaintenanceId = EVENT_ID;
    created.projectId = PROJECT_ID;
    created.scheduledMaintenanceStateId = EVENT_STATE_ID;
    created.startsAt = STARTS_AT;
    created.shouldStatusPageSubscribersBeNotified = true;

    const props: Record<string, unknown> = { isRoot: true };

    await expect(
      hookOf(ScheduledMaintenanceStateTimelineService, "onCreateSuccess")(
        {
          createBy: { data: created, props: props },
          carryForward: {
            statusTimelineBeforeThisStatus: null,
            statusTimelineAfterThisStatus: null,
            publicNote: "Work has started.",
            mutex: null,
          },
        },
        created,
      ),
    ).rejects.toThrow(STOP);

    expect(createNote).toHaveBeenCalledTimes(1);
    const request: { data: ScheduledMaintenancePublicNote; props: unknown } =
      createNote.mock.calls[0]![0] as {
        data: ScheduledMaintenancePublicNote;
        props: unknown;
      };
    expect(request.data.note).toBe("Work has started.");
    expect(request.data.scheduledMaintenanceId?.toString()).toBe(
      EVENT_ID.toString(),
    );
    expect(request.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(request.data.postedAt).toEqual(STARTS_AT);
    expect(request.data.createdAt).toEqual(STARTS_AT);
    expect(
      request.data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated,
    ).toBe(true);
    expect(request.props).toBe(props);
  });
});
